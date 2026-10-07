using Hipos.Api.Features;
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

public sealed class PaymentSimulator(SalesDbContext db, FeatureNewWorkGate gate)
{
    public async Task<PaymentCommandResult> StartAsync(
        string firmId, string branchId, Guid orderId, StartSimulatedPayment command,
        string actor, CancellationToken cancellationToken)
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
        if (command.AmountMinor > order.TotalMinor - paid)
            return PaymentCommandResult.Rejected("AMOUNT_EXCEEDS_REMAINING", 409,
                "Tutar siparişin kalan tutarını aşıyor.");

        var now = DateTimeOffset.UtcNow;
        var attempt = new PaymentAttemptRow
        {
            Id = command.AttemptId, FirmId = firmId, BranchId = branchId, OrderId = orderId,
            AmountMinor = command.AmountMinor, Currency = "TRY", Method = command.Method,
            Status = command.SimulatedOutcome, RequestedOutcome = command.SimulatedOutcome,
            Version = 1, Actor = actor, CreatedAt = now, UpdatedAt = now,
        };
        order.PaymentAttempts.Add(attempt);
        db.Entry(attempt).State = EntityState.Added;
        UpdateOrderPaymentStatus(order);
        order.Version++;
        AddAudit(attempt, order, actor, "started", now);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
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
        UpdateOrderPaymentStatus(order);
        order.Version++;
        AddAudit(attempt, order, actor, "resolved", now);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return PaymentCommandResult.Rejected("VERSION_CONFLICT", 409, "Sipariş başka bir işlemle değişti.");
        }
        return new PaymentCommandResult(ToInfo(attempt), SalesOrders.ToDetail(order), null, false);
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

    private static void UpdateOrderPaymentStatus(SalesOrderRow order)
    {
        var paid = PaidMinor(order);
        order.PaymentStatus = order.PaymentAttempts.Any(row => row.Status == "unknown") ? "unknown" :
            order.PaymentAttempts.Any(row => row.Status == "pending") ? "pending" :
            paid == order.TotalMinor ? "paid" : paid > 0 ? "partially_paid" : "unpaid";
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
