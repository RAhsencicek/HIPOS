using System.Data.Common;
using Hipos.Api.Features;
using Hipos.Api.Realtime;
using Hipos.Api.Service;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace Hipos.Api.Sales;

// Yalnız Development: burada dış sağlayıcı çağrısı ve gerçek para hareketi yoktur.
public sealed record StartSimulatedPayment(
    Guid AttemptId, long AmountMinor, string Method, string SimulatedOutcome, int ExpectedOrderVersion, bool PostToCash = false, Guid? RegisterId = null, string? Provider = null, string? CustomerId = null);
public sealed record ResolveSimulatedPayment(string Outcome, int ExpectedOrderVersion, bool PostToCash = false, Guid? RegisterId = null);
public sealed record PaymentAttemptInfo(
    string Id, string OrderId, long AmountMinor, string Currency, string Method, string? Provider,
    string Status, int Version, bool Simulated, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
public sealed record PaymentCommandResult(
    PaymentAttemptInfo? Attempt, SalesOrderDetail? Order, FeatureFailure? Failure, bool Created)
{
    public static PaymentCommandResult Rejected(string code, int status, string detail) =>
        new(null, null, new FeatureFailure(code, status, detail), false);
}

public sealed class PaymentSimulator(SalesDbContext db, FeatureNewWorkGate gate, PaidCheckTableSettlement settlement,
    FeatureRuntimeCapabilities runtime, IRestaurantEventHub? eventHub = null)
{
    public sealed record CashShiftLink(Guid Id, Guid RegisterId);

    public async Task<PaymentCommandResult> StartAsync(
        string firmId, string branchId, Guid orderId, StartSimulatedPayment command,
        string actor, CancellationToken cancellationToken, bool requireCheckCapability = false)
    {
        if (command.AttemptId == Guid.Empty || command.AmountMinor <= 0 ||
            command.Method is not ("cash" or "card" or "meal" or "transfer" or "cari") ||
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
            var shiftResult = await LockOpenCashShiftAsync(db.Database.GetDbConnection(), firmId, branchId, command.RegisterId, transaction.GetDbTransaction(), cancellationToken);
            if (shiftResult.Count == 0)
                return PaymentCommandResult.Rejected("OPEN_CASH_SHIFT_REQUIRED", 409, command.RegisterId is null ? "Tahsilat için önce yönetim ekranından veya kasadan vardiya açın." : "Seçili kasada açık vardiya yok. Tahsilat için önce kasa açılışını yapın.");
            if (shiftResult.Count > 1)
                return PaymentCommandResult.Rejected("CASH_SHIFT_AMBIGUOUS", 409, "Birden fazla açık kasa vardiyası var. Tahsilattan önce yalnız kullanılacak kasanın vardiyasını açık bırakın.");
            cashShift = shiftResult[0];
        }

        string? resolvedCustomerId = null;
        string? resolvedCustomerName = null;
        if (command.Method == "cari")
        {
            if (!runtime.CariReady)
                return PaymentCommandResult.Rejected("CARI_STORAGE_UNAVAILABLE", 503, "Cari veritabanı hazır değil; cari migration'larını uygulayıp API'yi yeniden başlatın.");

            blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(),
                transaction.GetDbTransaction(), firmId, branchId, "cari.management", cancellationToken);
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

        if (command.Method == "cari")
        {
            resolvedCustomerId = string.IsNullOrWhiteSpace(command.CustomerId) ? null : command.CustomerId.Trim();
            if (string.IsNullOrWhiteSpace(resolvedCustomerId))
            {
                var checkCustomer = await db.Checks.AsNoTracking()
                    .Where(c => c.Id == order.CheckId && c.FirmId == firmId && c.BranchId == branchId)
                    .Select(c => c.CustomerId)
                    .FirstOrDefaultAsync(cancellationToken);
                if (!string.IsNullOrWhiteSpace(checkCustomer))
                    resolvedCustomerId = checkCustomer;
            }

            if (string.IsNullOrWhiteSpace(resolvedCustomerId))
                return PaymentCommandResult.Rejected("CUSTOMER_REQUIRED", 400, "Cariye / veresiye yazmak için lütfen müşteri kartı seçin.");

            await using var cmdParty = db.Database.GetDbConnection().CreateCommand();
            cmdParty.Transaction = transaction.GetDbTransaction();
            cmdParty.CommandText = """
                SELECT name, is_active, types
                FROM cari.parties
                WHERE id = @id AND firm_id = @firm_id AND branch_id = @branch_id
                FOR UPDATE
                """;
            AddParameter(cmdParty, "id", resolvedCustomerId);
            AddParameter(cmdParty, "firm_id", firmId);
            AddParameter(cmdParty, "branch_id", branchId);
            await using var reader = await cmdParty.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
                return PaymentCommandResult.Rejected("CUSTOMER_NOT_FOUND", 404, "Seçilen cari kartı bulunamadı.");
            resolvedCustomerName = reader.GetString(0);
            var isActive = reader.GetBoolean(1);
            var types = (string[])reader.GetValue(2);
            if (!isActive)
                return PaymentCommandResult.Rejected("CUSTOMER_INACTIVE", 409, "Seçilen müşteri kartı pasif durumda.");
            if (!types.Contains("customer"))
                return PaymentCommandResult.Rejected("CUSTOMER_NOT_ELIGIBLE", 409, "Seçilen cari kartı müşteri türünde değil.");
        }

        var paid = PaidMinor(order);
        var payableTotal = await PayableOrderTotalAsync(order, cancellationToken);
        if (command.AmountMinor > payableTotal - paid)
            return PaymentCommandResult.Rejected("AMOUNT_EXCEEDS_REMAINING", 409,
                "Tutar siparişin kalan tutarını aşıyor.");

        var now = DateTimeOffset.UtcNow;
        var provider = string.IsNullOrWhiteSpace(command.Provider) ? null : command.Provider.Trim();
        if (command.Method == "cari" && resolvedCustomerName is not null)
        {
            provider = provider is not null && provider.Contains(resolvedCustomerName) ? provider : $"Cari: {resolvedCustomerName}";
        }

        var attempt = new PaymentAttemptRow
        {
            Id = command.AttemptId, CheckId = order.CheckId,
            FirmId = firmId, BranchId = branchId, OrderId = orderId,
            AmountMinor = command.AmountMinor, Currency = "TRY", Method = command.Method,
            Provider = provider,
            Status = command.SimulatedOutcome, RequestedOutcome = command.SimulatedOutcome,
            Version = 1, Actor = actor, CreatedAt = now, UpdatedAt = now,
        };
        order.PaymentAttempts.Add(attempt);
        db.Entry(attempt).State = EntityState.Added;
        UpdateOrderPaymentStatus(order, payableTotal);
        order.Version++;
        AddAudit(attempt, order, actor, "started", now);

        if (command.Method == "cari" && resolvedCustomerId is not null)
        {
            await using var cmdCheck = db.Database.GetDbConnection().CreateCommand();
            cmdCheck.Transaction = transaction.GetDbTransaction();
            cmdCheck.CommandText = "UPDATE sales.checks SET customer_id = @customer_id, version = version + 1 WHERE id = @check_id AND firm_id = @firm_id AND branch_id = @branch_id AND (customer_id IS NULL OR customer_id = '')";
            AddParameter(cmdCheck, "customer_id", resolvedCustomerId);
            AddParameter(cmdCheck, "check_id", order.CheckId);
            AddParameter(cmdCheck, "firm_id", firmId);
            AddParameter(cmdCheck, "branch_id", branchId);
            await cmdCheck.ExecuteNonQueryAsync(cancellationToken);
        }

        try
        {
            await db.SaveChangesAsync(cancellationToken);
            if (attempt.Status == "succeeded" && attempt.Method == "cari" && resolvedCustomerId is not null && resolvedCustomerName is not null)
                await AddCariChargeAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction()!, firmId, branchId, resolvedCustomerId, resolvedCustomerName, order.CheckId, orderId, attempt, actor, now, cancellationToken);
            if (attempt.Status == "succeeded" && command.PostToCash && cashShift is not null)
                await AddCashMovementAsync(db.Database.GetDbConnection(), cashShift, attempt, actor, now, transaction.GetDbTransaction(), cancellationToken);
            if (attempt.Status == "succeeded")
                await CloseCheckAndReleaseTablesIfSettledAsync(order.CheckId, firmId, branchId, actor, now, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            if (attempt.Status == "succeeded")
            {
                eventHub?.Publish("payment.settled", firmId, branchId, new { attemptId = attempt.Id, orderId = order.Id, checkId = order.CheckId });
                if (attempt.Method == "cari" && resolvedCustomerId is not null)
                {
                    eventHub?.Publish("cari.updated", firmId, branchId, new { partyId = resolvedCustomerId, partyName = resolvedCustomerName, deltaMinor = attempt.AmountMinor, checkId = order.CheckId });
                }
            }
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

    public static async Task<IReadOnlyList<CashShiftLink>> LockOpenCashShiftAsync(DbConnection connection,
        string firmId, string branchId, Guid? registerId,
        DbTransaction transaction, CancellationToken cancellationToken)
    {
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

    public static async Task AddCashMovementAsync(DbConnection connection, CashShiftLink shift, PaymentAttemptRow attempt, string actor,
        DateTimeOffset now, DbTransaction transaction, CancellationToken cancellationToken)
    {
        var tenderTitle = (attempt.Method, attempt.Provider) switch
        {
            ("cash", _) => "Nakit",
            ("card", not null and not "") => attempt.Provider,
            ("card", _) => "Kredi / Banka Kartı",
            ("meal", not null and not "") => attempt.Provider,
            ("meal", _) => "Yemek Kartı",
            ("transfer", _) => "Banka Havalesi / EFT",
            ("cari", not null and not "") => attempt.Provider,
            ("cari", _) => "Cari / Veresiye",
            _ => attempt.Method
        };
        var providerValue = string.IsNullOrWhiteSpace(attempt.Provider)
            ? (attempt.Method == "cash" ? "hipos-cash" : attempt.Method == "cari" ? "hipos-cari" : "hipos-pos")
            : attempt.Provider;

        await using (var movement = connection.CreateCommand())
        {
            movement.Transaction = transaction;
            movement.CommandText = """
                INSERT INTO cash.movements
                    (id, firm_id, branch_id, register_id, shift_id, kind, category, tender_method, amount_minor,
                     currency, description, source, provider, external_reference, provider_event_id, actor, created_at)
                VALUES
                    (@id, @firm_id, @branch_id, @register_id, @shift_id, 'pos_sale', 'cash_sale', @method, @amount,
                     'TRY', @description, 'pos', @provider, @external_reference, @event_id, @actor, @created_at)
                """;
            AddParameter(movement, "id", attempt.Id); AddParameter(movement, "firm_id", attempt.FirmId);
            AddParameter(movement, "branch_id", attempt.BranchId); AddParameter(movement, "register_id", shift.RegisterId);
            AddParameter(movement, "shift_id", shift.Id); AddParameter(movement, "method", attempt.Method);
            AddParameter(movement, "amount", attempt.AmountMinor);
            AddParameter(movement, "description", $"Kasa tahsilatı · {tenderTitle} · Adisyon {attempt.CheckId.ToString()[..8]}");
            AddParameter(movement, "provider", providerValue);
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
            AddParameter(audit, "detail", $"pos_sale;method={attempt.Method};provider={attempt.Provider};amountMinor={attempt.AmountMinor};checkId={attempt.CheckId};orderId={attempt.OrderId}");
            AddParameter(audit, "occurred_at", now);
            await audit.ExecuteNonQueryAsync(cancellationToken);
        }
    }

    public static async Task AddCariChargeAsync(
        DbConnection connection,
        DbTransaction transaction,
        string firmId,
        string branchId,
        string partyId,
        string partyName,
        Guid checkId,
        Guid orderId,
        PaymentAttemptRow attempt,
        string actor,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var movementId = $"pm-sale-{attempt.Id:N}"[..Math.Min(80, 8 + 32)];
        var description = $"Adisyon {checkId.ToString()[..8]} · Veresiye Satış ({partyName})";
        var reference = checkId.ToString();
        var effectiveDate = DateOnly.FromDateTime(now.DateTime);

        await using (var cmd = connection.CreateCommand())
        {
            cmd.Transaction = transaction;
            cmd.CommandText = """
                INSERT INTO cari.movements
                    (id, firm_id, branch_id, party_id, kind, entry_type, delta_minor,
                     currency, description, reference, effective_date, source, actor, created_at)
                VALUES
                    (@id, @firm_id, @branch_id, @party_id, 'customer', 'customer_charge', @delta_minor,
                     'TRY', @description, @reference, @effective_date, 'sales', @actor, @created_at)
                ON CONFLICT (id) DO NOTHING;
                """;
            AddParameter(cmd, "id", movementId);
            AddParameter(cmd, "firm_id", firmId);
            AddParameter(cmd, "branch_id", branchId);
            AddParameter(cmd, "party_id", partyId);
            AddParameter(cmd, "delta_minor", attempt.AmountMinor);
            AddParameter(cmd, "description", description);
            AddParameter(cmd, "reference", reference);
            AddParameter(cmd, "effective_date", effectiveDate);
            AddParameter(cmd, "actor", actor);
            AddParameter(cmd, "created_at", now);
            await cmd.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var cmdParty = connection.CreateCommand())
        {
            cmdParty.Transaction = transaction;
            cmdParty.CommandText = """
                UPDATE cari.parties
                SET version = version + 1, updated_at = @updated_at
                WHERE id = @party_id AND firm_id = @firm_id AND branch_id = @branch_id;
                """;
            AddParameter(cmdParty, "party_id", partyId);
            AddParameter(cmdParty, "firm_id", firmId);
            AddParameter(cmdParty, "branch_id", branchId);
            AddParameter(cmdParty, "updated_at", now);
            await cmdParty.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var cmdAudit = connection.CreateCommand())
        {
            cmdAudit.Transaction = transaction;
            cmdAudit.CommandText = """
                INSERT INTO cari.audit (firm_id, branch_id, party_id, action, actor, detail, occurred_at)
                VALUES (@firm_id, @branch_id, @party_id, 'sales_charge', @actor, @detail, @occurred_at);
                """;
            AddParameter(cmdAudit, "firm_id", firmId);
            AddParameter(cmdAudit, "branch_id", branchId);
            AddParameter(cmdAudit, "party_id", partyId);
            AddParameter(cmdAudit, "actor", actor);
            AddParameter(cmdAudit, "detail", $"customer_charge: {attempt.AmountMinor} TRY kuruş · Adisyon {checkId.ToString()[..8]} · Ödeme {attempt.Id}");
            AddParameter(cmdAudit, "occurred_at", now);
            await cmdAudit.ExecuteNonQueryAsync(cancellationToken);
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
        CashShiftLink? cashShift = null;
        if (command.Outcome == "succeeded" && command.PostToCash)
        {
            if (!runtime.CashReady)
                return PaymentCommandResult.Rejected("CASH_STORAGE_UNAVAILABLE", 503, "Kasa veritabanı hazır değil; kasa migration'larını uygulayıp API'yi yeniden başlatın.");
            var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(),
                transaction.GetDbTransaction(), firmId, branchId, "cash.management", cancellationToken);
            if (blocked is not null) return new PaymentCommandResult(null, null, blocked, false);
            var shiftResult = await LockOpenCashShiftAsync(db.Database.GetDbConnection(), firmId, branchId, command.RegisterId, transaction.GetDbTransaction(), cancellationToken);
            if (shiftResult.Count == 0)
                return PaymentCommandResult.Rejected("OPEN_CASH_SHIFT_REQUIRED", 409, command.RegisterId is null ? "Tahsilat için önce yönetim ekranından veya kasadan vardiya açın." : "Seçili kasada açık vardiya yok. Tahsilat için önce kasa açılışını yapın.");
            if (shiftResult.Count > 1)
                return PaymentCommandResult.Rejected("CASH_SHIFT_AMBIGUOUS", 409, "Birden fazla açık kasa vardiyası var. Tahsilattan önce yalnız kullanılacak kasanın vardiyasını açık bırakın.");
            cashShift = shiftResult[0];
        }
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

        string? resolveCariPartyId = null;
        string? resolveCariPartyName = null;
        if (command.Outcome == "succeeded" && attempt.Method == "cari")
        {
            var checkCustomer = await db.Checks.AsNoTracking()
                .Where(c => c.Id == order.CheckId && c.FirmId == firmId && c.BranchId == branchId)
                .Select(c => c.CustomerId)
                .FirstOrDefaultAsync(cancellationToken);
            if (!string.IsNullOrWhiteSpace(checkCustomer))
            {
                resolveCariPartyId = checkCustomer;
                await using var cmdParty = db.Database.GetDbConnection().CreateCommand();
                cmdParty.Transaction = transaction.GetDbTransaction();
                cmdParty.CommandText = "SELECT name FROM cari.parties WHERE id = @id AND firm_id = @firm_id AND branch_id = @branch_id";
                AddParameter(cmdParty, "id", resolveCariPartyId);
                AddParameter(cmdParty, "firm_id", firmId);
                AddParameter(cmdParty, "branch_id", branchId);
                var nameVal = await cmdParty.ExecuteScalarAsync(cancellationToken);
                if (nameVal is string s) resolveCariPartyName = s;
            }
        }

        try
        {
            await db.SaveChangesAsync(cancellationToken);
            if (command.Outcome == "succeeded" && attempt.Method == "cari" && resolveCariPartyId is not null && resolveCariPartyName is not null)
                await AddCariChargeAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction()!, firmId, branchId, resolveCariPartyId, resolveCariPartyName, order.CheckId, order.Id, attempt, actor, now, cancellationToken);
            if (attempt.Status == "succeeded" && command.PostToCash && cashShift is not null)
                await AddCashMovementAsync(db.Database.GetDbConnection(), cashShift, attempt, actor, now, transaction.GetDbTransaction(), cancellationToken);
            if (command.Outcome == "succeeded")
                await CloseCheckAndReleaseTablesIfSettledAsync(order.CheckId, firmId, branchId, actor, now, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            if (command.Outcome == "succeeded")
            {
                eventHub?.Publish("payment.settled", firmId, branchId, new { attemptId = attempt.Id, orderId = order.Id, checkId = order.CheckId });
                if (attempt.Method == "cari" && resolveCariPartyId is not null)
                {
                    eventHub?.Publish("cari.updated", firmId, branchId, new { partyId = resolveCariPartyId, partyName = resolveCariPartyName, deltaMinor = attempt.AmountMinor, checkId = order.CheckId });
                }
            }
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
        if (runtime.InventoryReady)
        {
            await DepleteInventoryForCheckAsync(db.Database.GetDbConnection(),
                db.Database.CurrentTransaction?.GetDbTransaction(),
                check.Id, firmId, branchId, actor, now, cancellationToken);
        }
        if (check.TableId is not null)
        {
            await settlement.ReleaseAfterPaymentAsync(check.TableId, firmId, branchId, actor, now, cancellationToken);
            eventHub?.Publish("table.updated", firmId, branchId, new { tableId = check.TableId, status = "vacant" });
        }
        eventHub?.Publish("check.closed", firmId, branchId, new { checkId = check.Id, tableId = check.TableId });
        eventHub?.Publish("inventory.stock_updated", firmId, branchId, new { checkId = check.Id, timestamp = now });
    }

    public static async Task DepleteInventoryForCheckAsync(
        DbConnection connection,
        DbTransaction? transaction,
        Guid checkId,
        string firmId,
        string branchId,
        string actor,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        // 1. Şubenin aktif ana deposunu bul
        string? warehouseId = null;
        await using (var cmdWarehouse = connection.CreateCommand())
        {
            if (transaction != null) cmdWarehouse.Transaction = transaction;
            cmdWarehouse.CommandText = "SELECT id FROM inventory.warehouses WHERE firm_id = @firm_id AND branch_id = @branch_id AND is_active = true ORDER BY created_at ASC LIMIT 1";
            AddParameter(cmdWarehouse, "firm_id", firmId);
            AddParameter(cmdWarehouse, "branch_id", branchId);
            var result = await cmdWarehouse.ExecuteScalarAsync(cancellationToken);
            if (result != null && result != DBNull.Value) warehouseId = result.ToString();
        }

        if (string.IsNullOrEmpty(warehouseId)) return;

        // 2. Kapanan adisyondaki tüm sipariş kalemlerini çek
        var orderItems = new List<(Guid ProductId, string ProductName, int Quantity)>();
        await using (var cmdItems = connection.CreateCommand())
        {
            if (transaction != null) cmdItems.Transaction = transaction;
            cmdItems.CommandText = """
                SELECT l.product_id, l.product_name, SUM(l.quantity) AS qty
                FROM sales.order_lines l
                INNER JOIN sales.orders o ON o.id = l.order_id
                WHERE o.check_id = @check_id AND o.firm_id = @firm_id AND o.branch_id = @branch_id
                GROUP BY l.product_id, l.product_name
                """;
            AddParameter(cmdItems, "check_id", checkId);
            AddParameter(cmdItems, "firm_id", firmId);
            AddParameter(cmdItems, "branch_id", branchId);
            await using var reader = await cmdItems.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                orderItems.Add((reader.GetGuid(0), reader.GetString(1), Convert.ToInt32(reader.GetValue(2))));
            }
        }

        if (orderItems.Count == 0) return;

        // 3. Her bir ürünün reçetesini bul ve hammadde düşüm hareketlerini yaz
        foreach (var item in orderItems)
        {
            var recipeLines = new List<(string IngredientId, decimal Quantity, string Unit)>();
            await using (var cmdRecipe = connection.CreateCommand())
            {
                if (transaction != null) cmdRecipe.Transaction = transaction;
                cmdRecipe.CommandText = """
                    SELECT rl.ingredient_id, rl.quantity, rl.unit
                    FROM inventory.recipe_lines rl
                    INNER JOIN inventory.recipes r ON r.id = rl.recipe_id
                    WHERE r.product_id = @product_id AND r.firm_id = @firm_id AND r.branch_id = @branch_id
                    """;
                AddParameter(cmdRecipe, "product_id", item.ProductId);
                AddParameter(cmdRecipe, "firm_id", firmId);
                AddParameter(cmdRecipe, "branch_id", branchId);
                await using var reader = await cmdRecipe.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                {
                    recipeLines.Add((reader.GetString(0), reader.GetDecimal(1), reader.GetString(2)));
                }
            }

            if (recipeLines.Count == 0) continue; // Reçetesiz ürün

            foreach (var line in recipeLines)
            {
                var totalDelta = -(item.Quantity * line.Quantity);
                var movementId = Guid.NewGuid().ToString();
                var description = $"Satış tüketimi · Adisyon {checkId.ToString()[..8]} · {item.Quantity}x {item.ProductName}";

                await using (var cmdMove = connection.CreateCommand())
                {
                    if (transaction != null) cmdMove.Transaction = transaction;
                    cmdMove.CommandText = """
                        INSERT INTO inventory.movements
                            (id, firm_id, branch_id, warehouse_id, ingredient_id, delta, unit, kind, description, actor, created_at)
                        VALUES
                            (@id, @firm_id, @branch_id, @warehouse_id, @ingredient_id, @delta, @unit, 'pos_sale', @description, @actor, @created_at)
                        """;
                    AddParameter(cmdMove, "id", movementId);
                    AddParameter(cmdMove, "firm_id", firmId);
                    AddParameter(cmdMove, "branch_id", branchId);
                    AddParameter(cmdMove, "warehouse_id", warehouseId);
                    AddParameter(cmdMove, "ingredient_id", line.IngredientId);
                    AddParameter(cmdMove, "delta", totalDelta);
                    AddParameter(cmdMove, "unit", line.Unit);
                    AddParameter(cmdMove, "description", description);
                    AddParameter(cmdMove, "actor", actor);
                    AddParameter(cmdMove, "created_at", now);
                    await cmdMove.ExecuteNonQueryAsync(cancellationToken);
                }

                await using (var cmdAudit = connection.CreateCommand())
                {
                    if (transaction != null) cmdAudit.Transaction = transaction;
                    cmdAudit.CommandText = """
                        INSERT INTO inventory.audit
                            (firm_id, branch_id, warehouse_id, entity_id, action, request_id, actor, detail, occurred_at)
                        VALUES
                            (@firm_id, @branch_id, @warehouse_id, @entity_id, 'recipe_depletion', @request_id, @actor, @detail, @occurred_at)
                        """;
                    AddParameter(cmdAudit, "firm_id", firmId);
                    AddParameter(cmdAudit, "branch_id", branchId);
                    AddParameter(cmdAudit, "warehouse_id", warehouseId);
                    AddParameter(cmdAudit, "entity_id", line.IngredientId);
                    AddParameter(cmdAudit, "request_id", movementId);
                    AddParameter(cmdAudit, "actor", actor);
                    AddParameter(cmdAudit, "detail", $"checkId={checkId};product={item.ProductName};qty={item.Quantity};ingredient={line.IngredientId};delta={totalDelta};unit={line.Unit}");
                    AddParameter(cmdAudit, "occurred_at", now);
                    await cmdAudit.ExecuteNonQueryAsync(cancellationToken);
                }
            }
        }
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
            row.Method, row.Provider, row.Status, row.Version, true, row.CreatedAt, row.UpdatedAt);
}
