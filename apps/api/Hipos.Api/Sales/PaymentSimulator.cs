using System.Data.Common;
using Hipos.Api.Features;
using Hipos.Api.Service;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace Hipos.Api.Sales;

// Yalnız Development: burada dış sağlayıcı çağrısı ve gerçek para hareketi yoktur.
public sealed record StartSimulatedPayment(
    Guid AttemptId, long AmountMinor, string Method, string SimulatedOutcome, int ExpectedOrderVersion, bool PostToCash = false, Guid? RegisterId = null);
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

public sealed class PaymentSimulator(SalesDbContext db, FeatureNewWorkGate gate, PaidCheckTableSettlement settlement,
    FeatureRuntimeCapabilities runtime)
{
    private sealed record CashShiftLink(Guid Id, Guid RegisterId);

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
        if (command.PostToCash && !runtime.CashReady)
            return PaymentCommandResult.Rejected("CASH_STORAGE_UNAVAILABLE", 503, "Kasa veritabanı hazır değil; kasa migration'larını uygulayıp API'yi yeniden başlatın.");

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
        CashShiftLink? cashShift = null;
        if (command.PostToCash)
        {
            blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(),
                transaction.GetDbTransaction(), firmId, branchId, "cash.management", cancellationToken);
            if (blocked is not null) return new PaymentCommandResult(null, null, blocked, false);
            var shiftResult = await LockOpenCashShiftAsync(firmId, branchId, command.RegisterId, transaction.GetDbTransaction(), cancellationToken);
            if (shiftResult.Count == 0)
                return PaymentCommandResult.Rejected("OPEN_CASH_SHIFT_REQUIRED", 409, command.RegisterId is null ? "Tahsilat için önce yönetim ekranından veya kasadan vardiya açın." : "Seçili kasada açık vardiya yok. Tahsilat için önce kasa açılışını yapın.");
            if (shiftResult.Count > 1)
                return PaymentCommandResult.Rejected("CASH_SHIFT_AMBIGUOUS", 409, "Birden fazla açık kasa vardiyası var. Tahsilattan önce yalnız kullanılacak kasanın vardiyasını açık bırakın.");
            cashShift = shiftResult[0];
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
            if (attempt.Status == "succeeded" && command.PostToCash && cashShift is not null)
                await AddCashMovementAsync(cashShift, attempt, actor, now, transaction.GetDbTransaction(), cancellationToken);
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

    private async Task<IReadOnlyList<CashShiftLink>> LockOpenCashShiftAsync(string firmId, string branchId, Guid? registerId,
        DbTransaction transaction, CancellationToken cancellationToken)
    {
        var connection = db.Database.GetDbConnection();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            SELECT s.id, s.register_id
            FROM cash.shifts s
            INNER JOIN cash.registers r ON r.id = s.register_id AND r.firm_id = s.firm_id AND r.branch_id = s.branch_id
            WHERE s.firm_id = @firm_id AND s.branch_id = @branch_id AND s.status = 'open' AND r.is_active = TRUE
              AND (@register_id::uuid IS NULL OR s.register_id = @register_id::uuid)
            ORDER BY s.opened_at, s.id
            FOR UPDATE OF s
            """;
        var firmParameter = command.CreateParameter(); firmParameter.ParameterName = "firm_id"; firmParameter.Value = firmId;
        var branchParameter = command.CreateParameter(); branchParameter.ParameterName = "branch_id"; branchParameter.Value = branchId;
        command.Parameters.Add(firmParameter); command.Parameters.Add(branchParameter);
        var registerParameter = command.CreateParameter(); registerParameter.ParameterName = "register_id";
        registerParameter.Value = registerId.HasValue ? registerId.Value : DBNull.Value;
        command.Parameters.Add(registerParameter);
        var shifts = new List<CashShiftLink>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken)) shifts.Add(new CashShiftLink(reader.GetGuid(0), reader.GetGuid(1)));
        return shifts;
    }

    private async Task AddCashMovementAsync(CashShiftLink shift, PaymentAttemptRow attempt, string actor,
        DateTimeOffset now, DbTransaction transaction, CancellationToken cancellationToken)
    {
        var connection = db.Database.GetDbConnection();
        await using (var movement = connection.CreateCommand())
        {
            movement.Transaction = transaction;
            movement.CommandText = """
                INSERT INTO cash.movements
                    (id, firm_id, branch_id, register_id, shift_id, kind, category, tender_method, amount_minor,
                     currency, description, source, provider, external_reference, provider_event_id, actor, created_at)
                VALUES
                    (@id, @firm_id, @branch_id, @register_id, @shift_id, 'pos_sale', 'cash_sale', @method, @amount,
                     'TRY', @description, 'pos', 'hipos-simulator', @external_reference, @event_id, @actor, @created_at)
                """;
            AddParameter(movement, "id", attempt.Id); AddParameter(movement, "firm_id", attempt.FirmId);
            AddParameter(movement, "branch_id", attempt.BranchId); AddParameter(movement, "register_id", shift.RegisterId);
            AddParameter(movement, "shift_id", shift.Id); AddParameter(movement, "method", attempt.Method);
            AddParameter(movement, "amount", attempt.AmountMinor);
            AddParameter(movement, "description", $"Kasa tahsilatı · {(attempt.Method == "cash" ? "Nakit" : "Kart")} · Adisyon {attempt.CheckId.ToString()[..8]}");
            AddParameter(movement, "external_reference", $"{attempt.CheckId}:{attempt.OrderId}");
            AddParameter(movement, "event_id", attempt.Id.ToString()); AddParameter(movement, "actor", actor);
            AddParameter(movement, "created_at", now);
            await movement.ExecuteNonQueryAsync(cancellationToken);
        }
        await using (var shiftUpdate = connection.CreateCommand())
        {
            shiftUpdate.Transaction = transaction;
            shiftUpdate.CommandText = "UPDATE cash.shifts SET version = version + 1 WHERE id = @shift_id AND firm_id = @firm_id AND branch_id = @branch_id AND status = 'open'";
            AddParameter(shiftUpdate, "shift_id", shift.Id); AddParameter(shiftUpdate, "firm_id", attempt.FirmId);
            AddParameter(shiftUpdate, "branch_id", attempt.BranchId);
            await shiftUpdate.ExecuteNonQueryAsync(cancellationToken);
        }
        await using (var audit = connection.CreateCommand())
        {
            audit.Transaction = transaction;
            audit.CommandText = """
                INSERT INTO cash.audit (firm_id, branch_id, register_id, shift_id, request_id, entity_type, entity_id, action, actor, detail, occurred_at)
                VALUES (@firm_id, @branch_id, @register_id, @shift_id, @request_id, 'movement', @entity_id, 'sale_payment_linked', @actor,
                    @detail, @occurred_at)
                """;
            AddParameter(audit, "firm_id", attempt.FirmId); AddParameter(audit, "branch_id", attempt.BranchId);
            AddParameter(audit, "register_id", shift.RegisterId); AddParameter(audit, "shift_id", shift.Id);
            AddParameter(audit, "request_id", attempt.Id); AddParameter(audit, "entity_id", attempt.Id);
            AddParameter(audit, "actor", actor);
            AddParameter(audit, "detail", $"pos_sale;method={attempt.Method};amountMinor={attempt.AmountMinor};checkId={attempt.CheckId};orderId={attempt.OrderId}");
            AddParameter(audit, "occurred_at", now);
            await audit.ExecuteNonQueryAsync(cancellationToken);
        }
    }

    private static void AddParameter(DbCommand command, string name, object value)
    {
        var parameter = command.CreateParameter(); parameter.ParameterName = name; parameter.Value = value;
        command.Parameters.Add(parameter);
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
            .OrderBy(row => row.Id).ToArrayAsync(cancellationToken);
        var adjustments = await db.CheckAdjustments.AsNoTracking().Where(row => row.CheckId == order.CheckId &&
                row.FirmId == order.FirmId && row.BranchId == order.BranchId)
            .ToArrayAsync(cancellationToken);
        var result = CalculatePayableOrderTotals(orders, adjustments);
        return result.TryGetValue(order.Id, out var payable) ? payable : 0;
    }

    public static Dictionary<Guid, long> CalculatePayableOrderTotals(IEnumerable<SalesOrderRow> orders, IEnumerable<SalesCheckAdjustmentRow> adjustments)
    {
        var adjustmentRows = adjustments.ToArray();
        var reductionsByOrder = adjustmentRows.Where(row => (row.Action is "comp" or "void") && row.OrderId != null)
            .GroupBy(row => row.OrderId!.Value).ToDictionary(group => group.Key, group => group.Sum(row => row.AmountMinor));
        var remaining = orders.OrderBy(row => row.Id).Select(row => new
        {
            row.Id,
            Base = Math.Max(0, row.TotalMinor - (reductionsByOrder.TryGetValue(row.Id, out var reduction) ? reduction : 0)),
        }).ToArray();
        var discount = adjustmentRows.Where(row => row.Action == "discount").Sum(row => row.AmountMinor);
        var available = remaining.Sum(row => row.Base);
        var appliedDiscount = Math.Min(discount, available);
        if (available == 0) return remaining.ToDictionary(row => row.Id, _ => 0L);
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
        return result;
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
