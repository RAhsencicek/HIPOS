using Hipos.Api.Features;
using Hipos.Api.Service;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace Hipos.Api.Sales;

// Yalnız Development: burada dış sağlayıcı çağrısı ve gerçek para hareketi yoktur.
public sealed record StartSimulatedPayment(
    Guid AttemptId, long AmountMinor, string Method, string SimulatedOutcome, int ExpectedOrderVersion);
public sealed record ResolveSimulatedPayment(string Outcome, int ExpectedOrderVersion);
public sealed record PaymentAttemptInfo(
    string Id, string OrderId, long AmountMinor, string Currency, string Method,
    string Status, int Version, bool Simulated, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
public sealed record PaymentCommandResult(
    PaymentAttemptInfo? Attempt, SalesOrderDetail? Order, FeatureFailure? Failure, bool Created)
{
    public static PaymentCommandResult Rejected(string code, int status, string detail) =>
        new(null, null, new FeatureFailure(code, status, detail), false);
}

public sealed class PaymentSimulator(SalesDbContext db, FeatureNewWorkGate gate, PaidCheckTableSettlement settlement)
{
    public async Task<PaymentCommandResult> StartAsync(
        string firmId, string branchId, Guid orderId, StartSimulatedPayment command,
        string actor, CancellationToken cancellationToken, bool requireCheckCapability = false)
    {
        if (command.AttemptId == Guid.Empty || command.AmountMinor <= 0 ||
            command.Method is not ("cash" or "card") ||
            command.SimulatedOutcome is not ("succeeded" or "failed" or "pending" or "unknown"))
            return PaymentCommandResult.Rejected("INVALID_PAYMENT", 400, "Örnek ödeme alanları geçersiz.");
        if (command.ExpectedOrderVersion < 1)
            return PaymentCommandResult.Rejected("INVALID_VERSION", 400, "expectedOrderVersion pozitif olmalı.");

        var existing = await db.PaymentAttempts.AsNoTracking()
            .FirstOrDefaultAsync(row => row.Id == command.AttemptId, cancellationToken);
        if (existing is not null)
            return await ExistingAsync(existing, firmId, branchId, orderId, command, cancellationToken);

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(),
            transaction.GetDbTransaction(), firmId, branchId, "payments.simulator", cancellationToken);
        if (blocked is not null) return new PaymentCommandResult(null, null, blocked, false);
        if (requireCheckCapability)
        {
            blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(),
                transaction.GetDbTransaction(), firmId, branchId, "sales.checks", cancellationToken);
            if (blocked is not null) return new PaymentCommandResult(null, null, blocked, false);
        }
        var order = await LockOrderAsync(firmId, branchId, orderId, cancellationToken);
        if (order is null)
            return PaymentCommandResult.Rejected("ORDER_NOT_FOUND", 404, "Sipariş bu şubede bulunamadı.");
        // Aynı kimlikle eşzamanlı gelen istek, özellik kilidinden sonra tekrar denetlenir.
        existing = await db.PaymentAttempts.AsNoTracking()
            .FirstOrDefaultAsync(row => row.Id == command.AttemptId, cancellationToken);
        if (existing is not null)
            return await ExistingAsync(existing, firmId, branchId, orderId, command, cancellationToken);
        await LoadOrderDetailsAsync(order, cancellationToken);
        if (order.Version != command.ExpectedOrderVersion)
            return PaymentCommandResult.Rejected("VERSION_CONFLICT", 409, "Sipariş başka bir işlemle değişti.");
        if (order.Status != "open" || order.Currency != "TRY")
            return PaymentCommandResult.Rejected("ORDER_NOT_PAYABLE", 409, "Sipariş ödemeye uygun değil.");
        if (order.PaymentAttempts.Any(row => row.Status is "pending" or "unknown"))
            return PaymentCommandResult.Rejected("PAYMENT_UNRESOLVED", 409,
                "Bekleyen veya belirsiz ödeme sonuçlanmadan yeni girişim başlatılamaz.");
        var paid = PaidMinor(order);
        var payableTotal = await PayableOrderTotalAsync(order, cancellationToken);
        if (command.AmountMinor > payableTotal - paid)
            return PaymentCommandResult.Rejected("AMOUNT_EXCEEDS_REMAINING", 409,
                "Tutar siparişin kalan tutarını aşıyor.");

        var now = DateTimeOffset.UtcNow;
        var attempt = new PaymentAttemptRow
        {
            Id = command.AttemptId, CheckId = order.CheckId,
            FirmId = firmId, BranchId = branchId, OrderId = orderId,
            AmountMinor = command.AmountMinor, Currency = "TRY", Method = command.Method,
            Status = command.SimulatedOutcome, RequestedOutcome = command.SimulatedOutcome,
            Version = 1, Actor = actor, CreatedAt = now, UpdatedAt = now,
        };
        order.PaymentAttempts.Add(attempt);
        db.Entry(attempt).State = EntityState.Added;
        UpdateOrderPaymentStatus(order, payableTotal);
        order.Version++;
        AddAudit(attempt, order, actor, "started", now);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            if (attempt.Status == "succeeded")
                await CloseCheckAndReleaseTablesIfSettledAsync(order.CheckId, firmId, branchId, actor, now, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return PaymentCommandResult.Rejected("VERSION_CONFLICT", 409, "Sipariş başka bir işlemle değişti.");
        }
        catch (DbUpdateException error) when (error.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return PaymentCommandResult.Rejected("PAYMENT_ID_CONFLICT", 409, "Ödeme girişimi kimliği zaten kullanılıyor.");
        }
        return new PaymentCommandResult(ToInfo(attempt), SalesOrders.ToDetail(order), null, true);
    }

    public async Task<PaymentCommandResult> ResolveAsync(
        string firmId, string branchId, Guid orderId, Guid attemptId,
        ResolveSimulatedPayment command, string actor, CancellationToken cancellationToken)
    {
        if (command.Outcome is not ("succeeded" or "failed" or "cancelled"))
            return PaymentCommandResult.Rejected("INVALID_PAYMENT", 400, "Çözüm sonucu geçersiz.");
        if (command.ExpectedOrderVersion < 1)
            return PaymentCommandResult.Rejected("INVALID_VERSION", 400, "expectedOrderVersion pozitif olmalı.");

        // Başlatılmış iş, modül sonradan kapansa bile güvenle sonuçlandırılabilir.
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var order = await LockOrderAsync(firmId, branchId, orderId, cancellationToken);
        if (order is null)
            return PaymentCommandResult.Rejected("ORDER_NOT_FOUND", 404, "Sipariş bu şubede bulunamadı.");
        await LoadOrderDetailsAsync(order, cancellationToken);
        var attempt = order.PaymentAttempts.FirstOrDefault(row => row.Id == attemptId);
        if (attempt is null)
            return PaymentCommandResult.Rejected("PAYMENT_NOT_FOUND", 404, "Ödeme girişimi bulunamadı.");
        if (attempt.Status == command.Outcome)
            return new PaymentCommandResult(ToInfo(attempt), SalesOrders.ToDetail(order), null, false);
        if (attempt.Status is not ("pending" or "unknown"))
            return PaymentCommandResult.Rejected("PAYMENT_ALREADY_FINAL", 409, "Sonuçlanmış ödeme değiştirilemez.");
        if (order.Version != command.ExpectedOrderVersion)
            return PaymentCommandResult.Rejected("VERSION_CONFLICT", 409, "Sipariş başka bir işlemle değişti.");
        var now = DateTimeOffset.UtcNow;
        attempt.Status = command.Outcome;
        attempt.Version++;
        attempt.UpdatedAt = now;
        UpdateOrderPaymentStatus(order, await PayableOrderTotalAsync(order, cancellationToken));
        order.Version++;
        AddAudit(attempt, order, actor, "resolved", now);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            if (command.Outcome == "succeeded")
                await CloseCheckAndReleaseTablesIfSettledAsync(order.CheckId, firmId, branchId, actor, now, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return PaymentCommandResult.Rejected("VERSION_CONFLICT", 409, "Sipariş başka bir işlemle değişti.");
        }
        return new PaymentCommandResult(ToInfo(attempt), SalesOrders.ToDetail(order), null, false);
    }

    private async Task CloseCheckAndReleaseTablesIfSettledAsync(Guid checkId, string firmId, string branchId,
        string actor, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var check = await db.Checks.FromSqlInterpolated($"""
            SELECT * FROM sales.checks
            WHERE id = {checkId} AND firm_id = {firmId} AND branch_id = {branchId}
            FOR UPDATE
            """).SingleOrDefaultAsync(cancellationToken);
        if (check is null || check.Status != "open") return;

        var orders = await db.Orders.AsNoTracking().Include(row => row.PaymentAttempts)
            .Where(row => row.CheckId == checkId && row.FirmId == firmId && row.BranchId == branchId)
            .ToArrayAsync(cancellationToken);
        var adjustments = await db.CheckAdjustments.AsNoTracking().Where(row => row.CheckId == checkId &&
            row.FirmId == firmId && row.BranchId == branchId).ToArrayAsync(cancellationToken);
        var due = Math.Max(0, orders.Sum(row => row.TotalMinor) - adjustments.Sum(row => row.AmountMinor));
        var paid = orders.SelectMany(row => row.PaymentAttempts).Where(row => row.Status == "succeeded")
            .Sum(row => row.AmountMinor);
        if (due <= 0 || paid < due) return;

        check.Status = "closed";
        check.ClosedAt = now;
        check.Version++;
        db.CheckAudit.Add(new SalesCheckAuditRow
        {
            CheckId = check.Id, FirmId = firmId, BranchId = branchId, Actor = actor,
            Action = "payment_completed_check_closed", Version = check.Version, OccurredAt = now,
        });
        await db.SaveChangesAsync(cancellationToken);
        if (check.TableId is null) return;
        await settlement.ReleaseAfterPaymentAsync(check.TableId, firmId, branchId, actor, now, cancellationToken);
    }

    public async Task<IReadOnlyList<PaymentAttemptInfo>> ListAsync(
        string firmId, string branchId, Guid orderId, CancellationToken cancellationToken) =>
        (await db.PaymentAttempts.AsNoTracking().Where(row => row.FirmId == firmId &&
            row.BranchId == branchId && row.OrderId == orderId)
            .OrderBy(row => row.CreatedAt).ThenBy(row => row.Id).ToListAsync(cancellationToken))
            .Select(ToInfo).ToArray();

    private async Task<SalesOrderRow?> LockOrderAsync(
        string firmId, string branchId, Guid orderId, CancellationToken cancellationToken) =>
        await db.Orders.FromSqlInterpolated(
            $"SELECT * FROM sales.orders WHERE id = {orderId} AND firm_id = {firmId} AND branch_id = {branchId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);

    private async Task LoadOrderDetailsAsync(SalesOrderRow order, CancellationToken cancellationToken)
    {
        await db.Entry(order).Collection(row => row.Lines).LoadAsync(cancellationToken);
        await db.Entry(order).Collection(row => row.PaymentAttempts).LoadAsync(cancellationToken);
    }

    private async Task<PaymentCommandResult> ExistingAsync(
        PaymentAttemptRow attempt, string firmId, string branchId, Guid orderId,
        StartSimulatedPayment command, CancellationToken cancellationToken)
    {
        if (attempt.FirmId != firmId || attempt.BranchId != branchId || attempt.OrderId != orderId)
            return PaymentCommandResult.Rejected("PAYMENT_NOT_FOUND", 404, "Ödeme girişimi bulunamadı.");
        if (attempt.AmountMinor != command.AmountMinor || attempt.Method != command.Method ||
            attempt.RequestedOutcome != command.SimulatedOutcome)
            return PaymentCommandResult.Rejected("PAYMENT_ID_CONFLICT", 409,
                "Ödeme girişimi kimliği başka bir istek için kullanılıyor.");
        var order = await db.Orders.AsNoTracking().Include(row => row.Lines)
            .Include(row => row.PaymentAttempts).SingleAsync(row => row.Id == orderId, cancellationToken);
        return new PaymentCommandResult(ToInfo(attempt), SalesOrders.ToDetail(order), null, false);
    }

    private static long PaidMinor(SalesOrderRow order) =>
        order.PaymentAttempts.Where(row => row.Status == "succeeded").Sum(row => row.AmountMinor);

    private async Task<long> PayableOrderTotalAsync(SalesOrderRow order, CancellationToken cancellationToken)
    {
        var orders = await db.Orders.AsNoTracking().Where(row => row.CheckId == order.CheckId &&
                row.FirmId == order.FirmId && row.BranchId == order.BranchId)
            .OrderBy(row => row.Id).Select(row => new { row.Id, row.TotalMinor }).ToArrayAsync(cancellationToken);
        var adjustments = await db.CheckAdjustments.AsNoTracking().Where(row => row.CheckId == order.CheckId &&
                row.FirmId == order.FirmId && row.BranchId == order.BranchId)
            .ToArrayAsync(cancellationToken);
        var reductionsByOrder = adjustments.Where(row => (row.Action is "comp" or "void") && row.OrderId != null)
            .GroupBy(row => row.OrderId!.Value).ToDictionary(group => group.Key, group => group.Sum(row => row.AmountMinor));
        var remaining = orders.Select(row => new
        {
            row.Id,
            Base = Math.Max(0, row.TotalMinor - (reductionsByOrder.TryGetValue(row.Id, out var reduction) ? reduction : 0)),
        }).ToArray();
        var discount = adjustments.Where(row => row.Action == "discount").Sum(row => row.AmountMinor);
        var available = remaining.Sum(row => row.Base);
        var appliedDiscount = Math.Min(discount, available);
        if (available == 0) return 0;
        var result = remaining.ToDictionary(row => row.Id, row => row.Base);
        var allocated = 0L;
        foreach (var row in remaining)
        {
            var share = (long)((decimal)appliedDiscount * row.Base / available);
            result[row.Id] -= share;
            allocated += share;
        }
        var left = appliedDiscount - allocated;
        foreach (var row in remaining.Where(row => result[row.Id] > 0).OrderBy(row => row.Id))
        {
            if (left == 0) break;
            result[row.Id]--;
            left--;
        }
        return result.TryGetValue(order.Id, out var payable) ? payable : 0;
    }

    private static void UpdateOrderPaymentStatus(SalesOrderRow order, long payableTotal)
    {
        var paid = PaidMinor(order);
        order.PaymentStatus = order.PaymentAttempts.Any(row => row.Status == "unknown") ? "unknown" :
            order.PaymentAttempts.Any(row => row.Status == "pending") ? "pending" :
            paid >= payableTotal && payableTotal > 0 ? "paid" : paid > 0 ? "partially_paid" : "unpaid";
    }

    private void AddAudit(PaymentAttemptRow attempt, SalesOrderRow order, string actor, string action, DateTimeOffset now)
    {
        db.PaymentAudit.Add(new PaymentAttemptAuditRow
        {
            AttemptId = attempt.Id, OrderId = order.Id, FirmId = order.FirmId,
            BranchId = order.BranchId, Actor = actor, Action = action,
            Status = attempt.Status, Version = attempt.Version, OccurredAt = now,
        });
        db.Audit.Add(new SalesOrderAuditRow
        {
            OrderId = order.Id, FirmId = order.FirmId, BranchId = order.BranchId,
            Actor = actor, Action = $"payment_{action}", Version = order.Version, OccurredAt = now,
        });
    }

    private static PaymentAttemptInfo ToInfo(PaymentAttemptRow row) =>
        new(row.Id.ToString(), row.OrderId.ToString(), row.AmountMinor, row.Currency,
            row.Method, row.Status, row.Version, true, row.CreatedAt, row.UpdatedAt);
}
