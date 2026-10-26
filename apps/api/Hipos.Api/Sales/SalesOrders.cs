using System.Security.Cryptography;
using System.Text;
using Hipos.Api.Catalog;
using Hipos.Api.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using System.Data.Common;

namespace Hipos.Api.Sales;

public sealed record CreatePosOrder(Guid OrderId, IReadOnlyList<PosOrderItem> Items);
public sealed record CreateWaiterOrder(Guid OrderId, string WaiterId, IReadOnlyList<PosOrderItem> Items);
public sealed record PosOrderItem(Guid ProductId, int Quantity, string? Note = null,
    IReadOnlyList<PosOrderOptionSelection>? Options = null);
public sealed record PosOrderOptionSelection(Guid GroupId, Guid OptionId, int Quantity = 1);
public sealed record SalesOrderOptionSnapshot(Guid? GroupId, Guid? OptionId, string GroupName, string OptionName,
    int Quantity = 1, long PriceDeltaMinor = 0);
public sealed record SalesOrderLine(
    long Id, string ProductId, string ProductName, string Sku, int Quantity,
    long BaseUnitPriceMinor, long UnitPriceMinor, long LineTotalMinor, string Currency, string? Note,
    IReadOnlyList<SalesOrderOptionSnapshot> Options);
public sealed record SalesKitchenLine(
    string ProductId, string ProductName, int Quantity, string? Note,
    IReadOnlyList<SalesOrderOptionSnapshot> Options);
public sealed record SalesOrderDetail(
    string Id, string FirmId, string BranchId, string Source, string Status,
    string PaymentStatus, long TotalMinor, long PaidMinor, long RemainingMinor, string Currency,
    DateTimeOffset CreatedAt, int Version, IReadOnlyList<SalesOrderLine> Items,
    IReadOnlyList<SalesKitchenLine> KitchenItems);
public sealed record SalesOrderResult(SalesOrderDetail? Order, FeatureFailure? Failure, bool Created)
{
    public static SalesOrderResult Rejected(string code, int status, string message) =>
        new(null, new FeatureFailure(code, status, message), false);
}

public sealed class SalesOrders(SalesDbContext db, CatalogQueries catalog, FeatureNewWorkGate gate,
    FeatureRuntimeCapabilities runtime)
{
    public async Task<FeatureFailure?> MergeChecksAsync(DbConnection connection, DbTransaction transaction,
        string firmId, string branchId, Guid targetCheckId, string targetTableId,
        IReadOnlyList<(Guid CheckId, string TableId)> sources, string actor, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        foreach (var checkId in sources.Select(source => source.CheckId).Append(targetCheckId).Distinct().OrderBy(id => id))
            await LockRowsAsync(connection, transaction,
                "SELECT id FROM sales.checks WHERE id=@check AND firm_id=@firm AND branch_id=@branch FOR UPDATE",
                cancellationToken, ("check", checkId), ("firm", firmId), ("branch", branchId));
        foreach (var checkId in sources.Select(source => source.CheckId).Append(targetCheckId).Distinct().OrderBy(id => id))
            await LockRowsAsync(connection, transaction,
                "SELECT id FROM sales.orders WHERE check_id=@check AND firm_id=@firm AND branch_id=@branch ORDER BY id FOR UPDATE",
                cancellationToken, ("check", checkId), ("firm", firmId), ("branch", branchId));

        if (!await ExistsAsync(connection, transaction,
            "SELECT EXISTS (SELECT 1 FROM sales.checks WHERE id=@check AND firm_id=@firm AND branch_id=@branch AND status='open' AND table_id=@table)",
            cancellationToken, ("check", targetCheckId), ("firm", firmId), ("branch", branchId), ("table", targetTableId)))
            return new FeatureFailure("TARGET_CHECK_NOT_OPEN", 409, "Hedef masanın açık adisyonu bulunamadı.");

        var checkIds = sources.Select(source => source.CheckId).Append(targetCheckId).ToArray();
        foreach (var checkId in checkIds)
        {
            if (await ExistsAsync(connection, transaction,
                "SELECT EXISTS (SELECT 1 FROM sales.payment_attempts WHERE check_id=@check AND firm_id=@firm AND branch_id=@branch)",
                cancellationToken, ("check", checkId), ("firm", firmId), ("branch", branchId)))
                return new FeatureFailure("CHECK_HAS_PAYMENTS", 409, "Ödeme girişimi olan adisyon birleştirilemez.");
        }

        foreach (var source in sources)
        {
            if (!await ExistsAsync(connection, transaction,
                "SELECT EXISTS (SELECT 1 FROM sales.checks WHERE id=@check AND firm_id=@firm AND branch_id=@branch AND status='open' AND table_id=@table)",
                cancellationToken, ("check", source.CheckId), ("firm", firmId), ("branch", branchId), ("table", source.TableId)))
                return new FeatureFailure("SOURCE_CHECK_NOT_OPEN", 409, "Kaynak masanın açık adisyonu bulunamadı.");

            await ExecuteAsync(connection, transaction, """
                WITH moved AS (
                    UPDATE sales.orders SET check_id=@target, version=version+1
                    WHERE check_id=@source AND firm_id=@firm AND branch_id=@branch
                    RETURNING id,firm_id,branch_id,version
                )
                INSERT INTO sales.order_audit (order_id,firm_id,branch_id,actor,action,version,occurred_at)
                SELECT id,firm_id,branch_id,@actor,'check_merged',version,@at FROM moved
                """, cancellationToken, ("target", targetCheckId), ("source", source.CheckId),
                ("firm", firmId), ("branch", branchId), ("actor", actor), ("at", now));

            await ExecuteAsync(connection, transaction, """
                UPDATE sales.checks SET status='merged', table_id=NULL, waiter_id=NULL,
                    merged_into_check_id=@target, version=version+1
                WHERE id=@source AND firm_id=@firm AND branch_id=@branch AND status='open'
                """, cancellationToken, ("target", targetCheckId), ("source", source.CheckId),
                ("firm", firmId), ("branch", branchId));
            await ExecuteAsync(connection, transaction, """
                INSERT INTO sales.check_audit (check_id,firm_id,branch_id,actor,action,version,occurred_at)
                SELECT id,firm_id,branch_id,@actor,'merged_into',version,@at FROM sales.checks
                WHERE id=@source AND firm_id=@firm AND branch_id=@branch
                """, cancellationToken, ("source", source.CheckId), ("firm", firmId),
                ("branch", branchId), ("actor", actor), ("at", now));
        }

        await ExecuteAsync(connection, transaction, """
            UPDATE sales.checks SET version=version+1
            WHERE id=@target AND firm_id=@firm AND branch_id=@branch AND status='open'
            """, cancellationToken, ("target", targetCheckId), ("firm", firmId), ("branch", branchId));
        await ExecuteAsync(connection, transaction, """
            INSERT INTO sales.check_audit (check_id,firm_id,branch_id,actor,action,version,occurred_at)
            SELECT id,firm_id,branch_id,@actor,'merge_received',version,@at FROM sales.checks
            WHERE id=@target AND firm_id=@firm AND branch_id=@branch
            """, cancellationToken, ("target", targetCheckId), ("firm", firmId),
            ("branch", branchId), ("actor", actor), ("at", now));
        return null;
    }

    public async Task<SalesOrderResult> CreateAsync(
        string firmId, string branchId, CreatePosOrder command, string actor,
        CancellationToken cancellationToken, Guid checkId,
        SalesCheckRow? checkToCreate, string featureKey, string source)
    {
        if (command.OrderId == Guid.Empty || command.Items is null ||
            command.Items.Count is < 1 or > 20 ||
            command.Items.Any(item => item.ProductId == Guid.Empty || item.Quantity is < 1 or > 99 ||
                item.Note?.Length > 500 || item.Options is { Count: > 100 } ||
                item.Options?.Any(option => option is null || option.GroupId == Guid.Empty || option.OptionId == Guid.Empty ||
                    option.Quantity is < 1 or > 99) == true ||
                item.Options?.Select(option => option.OptionId).Distinct().Count() != item.Options?.Count))
            return SalesOrderResult.Rejected("INVALID_ORDER", 400, "Sipariş kimliği veya kalemleri geçersiz.");

        var sorted = command.Items.OrderBy(item => item.ProductId).ThenBy(item => item.Note)
            .ThenBy(item => System.Text.Json.JsonSerializer.Serialize((item.Options ?? []).OrderBy(option => option.GroupId)
                .ThenBy(option => option.OptionId))).ToArray();
        if (source is not ("test_pos" or "waiter_web"))
            return SalesOrderResult.Rejected("INVALID_ORDER_SOURCE", 400, "Sipariş kaynağı geçersiz.");
        var itemFingerprint = string.Join("|", sorted.Select(item =>
            $"{item.ProductId:N}:{item.Quantity}:{item.Note?.Trim()}:{System.Text.Json.JsonSerializer.Serialize((item.Options ?? [])
                .OrderBy(option => option.GroupId).ThenBy(option => option.OptionId))}"));
        var fingerprint = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
            source == "test_pos" ? itemFingerprint : $"{source}|{itemFingerprint}")));
        if (checkId == Guid.Empty || checkToCreate is not null && checkToCreate.Id != checkId)
            return SalesOrderResult.Rejected("INVALID_CHECK", 400, "Adisyon kimliği geçersiz.");
        var existing = await db.Orders.AsNoTracking().Include(row => row.Lines).Include(row => row.PaymentAttempts)
            .FirstOrDefaultAsync(row => row.Id == command.OrderId, cancellationToken);
        if (existing is not null) return Existing(existing, firmId, branchId, checkId, fingerprint);

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(),
            transaction.GetDbTransaction(), firmId, branchId, featureKey, cancellationToken);
        if (blocked is not null) return new SalesOrderResult(null, blocked, false);
        if (featureKey == "sales.pos_orders")
        {
            blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction(),
                firmId, branchId, "sales.checks", cancellationToken);
            if (blocked is not null) return new SalesOrderResult(null, blocked, false);
        }

        existing = await db.Orders.AsNoTracking().Include(row => row.Lines).Include(row => row.PaymentAttempts)
            .FirstOrDefaultAsync(row => row.Id == command.OrderId, cancellationToken);
        if (existing is not null) return Existing(existing, firmId, branchId, checkId, fingerprint);

        var check = await db.Checks.FromSqlInterpolated(
            $"SELECT * FROM sales.checks WHERE id = {checkId} AND firm_id = {firmId} AND branch_id = {branchId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);
        var createCheck = check is null && checkToCreate is not null;
        if (check is null && !createCheck)
            return SalesOrderResult.Rejected("CHECK_NOT_FOUND", 404, "Adisyon bu şubede bulunamadı.");
        if (check is not null && checkToCreate is not null)
            return SalesOrderResult.Rejected("CHECK_REQUEST_CONFLICT", 409, "Adisyon requestId zaten kullanılmış.");
        if (check is not null && check.Status != "open")
            return SalesOrderResult.Rejected("CHECK_NOT_OPEN", 409, "Adisyona yeni sipariş eklenemez.");

        if (check?.TableId is not null)
        {
            await LockRowsAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction(),
                "SELECT id FROM service.tables WHERE id=@table AND firm_id=@firm AND branch_id=@branch FOR UPDATE",
                cancellationToken, ("table", check.TableId), ("firm", firmId), ("branch", branchId));
            if (await ExistsAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction(),
                "SELECT EXISTS (SELECT 1 FROM service.tables WHERE id=@table AND firm_id=@firm AND branch_id=@branch AND status='reserved')",
                cancellationToken, ("table", check.TableId), ("firm", firmId), ("branch", branchId)))
                return SalesOrderResult.Rejected("TABLE_RESERVED", 409, "Rezerve masaya sipariş eklenemez.");
        }

        if (createCheck)
        {
            var relatedFailure = await ValidateCheckLinksAsync(firmId, branchId, checkToCreate!,
                transaction.GetDbTransaction(), cancellationToken);
            if (relatedFailure is not null) return new SalesOrderResult(null, relatedFailure, false);
        }

        // Kaynak katalogdan alınır; istemci fiyat veya ürün adı gönderemez.
        var lines = new List<SalesOrderLineRow>();
        long total = 0;
        foreach (var item in sorted)
        {
            var product = await catalog.GetAsync(new CatalogScope(firmId, branchId),
                item.ProductId, cancellationToken);
            if (product is null || !product.IsActive || product.Status != "published" ||
                !product.Channels.Contains("pos") || product.Price.AmountMinor <= 0 ||
                product.Price.Currency != "TRY")
                return SalesOrderResult.Rejected(product is { IsActive: false } ? "PRODUCT_INACTIVE" : "PRODUCT_NOT_SELLABLE", 409,
                    "Ürün bu şubede POS satışına açık değil veya geçerli fiyatı yok.");
            var productOptions = await catalog.GetProductOptionGroupsAsync(firmId, item.ProductId, cancellationToken);
            var selected = item.Options ?? [];
            var availableGroups = productOptions?.Items.ToDictionary(group => group.GroupId) ?? [];
            var snapshots = new List<SalesOrderOptionSnapshot>();
            long unitPrice = product.Price.AmountMinor;
            foreach (var group in availableGroups.Values)
            {
                var groupSelections = selected.Where(selection => selection.GroupId == group.GroupId).ToArray();
                if (groupSelections.Length < group.MinSelections ||
                    group.MaxSelections is { } maxSelections && groupSelections.Length > maxSelections)
                    return SalesOrderResult.Rejected("INVALID_PRODUCT_OPTIONS", 409,
                        "Ürün seçenek grubu için seçim sayısı geçersiz.");
            }
            if (selected.Any(selection => !availableGroups.ContainsKey(selection.GroupId)))
                return SalesOrderResult.Rejected("INVALID_PRODUCT_OPTIONS", 409,
                    "Seçilen grup bu ürüne bağlı değil.");
            try
            {
                foreach (var selection in selected.OrderBy(selection => selection.GroupId).ThenBy(selection => selection.OptionId))
                {
                    var group = availableGroups[selection.GroupId];
                    var option = group.Items.SingleOrDefault(candidate => candidate.Id == selection.OptionId);
                    if (option is null || (!option.QuantityEnabled && selection.Quantity != 1) ||
                        selection.Quantity > option.MaxQuantity)
                        return SalesOrderResult.Rejected("INVALID_PRODUCT_OPTIONS", 409,
                            "Seçilen seçenek veya adedi geçerli katalogla eşleşmiyor.");
                    unitPrice = checked(unitPrice + checked(option.PriceDeltaMinor * selection.Quantity));
                    snapshots.Add(new SalesOrderOptionSnapshot(group.GroupId, option.Id, group.Name, option.Name,
                        selection.Quantity, option.PriceDeltaMinor));
                }
                if (unitPrice < 0)
                    return SalesOrderResult.Rejected("INVALID_ORDER_PRICE", 409,
                        "Seçenekler sonrasında ürün birim fiyatı sıfırın altına düşemez.");
            }
            catch (OverflowException)
            {
                return SalesOrderResult.Rejected("INVALID_ORDER", 400, "Sipariş tutarı geçersiz.");
            }
            long lineTotal;
            try
            {
                lineTotal = checked(unitPrice * item.Quantity);
                total = checked(total + lineTotal);
            }
            catch (OverflowException)
            {
                return SalesOrderResult.Rejected("INVALID_ORDER", 400, "Sipariş tutarı geçersiz.");
            }
            lines.Add(new SalesOrderLineRow
            {
                OrderId = command.OrderId, ProductId = item.ProductId,
                ProductName = product.Name, Sku = product.Sku, Quantity = item.Quantity,
                BaseUnitPriceMinor = product.Price.AmountMinor, UnitPriceMinor = unitPrice,
                LineTotalMinor = lineTotal, Currency = "TRY",
                Note = string.IsNullOrWhiteSpace(item.Note) ? null : item.Note.Trim(),
                OptionsJson = System.Text.Json.JsonSerializer.Serialize(snapshots),
            });
        }

        var now = DateTimeOffset.UtcNow;
        check ??= checkToCreate!;
        if (createCheck) db.Checks.Add(check);
        else check.Version++;
        var order = new SalesOrderRow
        {
            Id = command.OrderId, CheckId = checkId, FirmId = firmId, BranchId = branchId,
            Source = source, Status = "open", PaymentStatus = "unpaid",
            TotalMinor = total, Currency = "TRY", RequestFingerprint = fingerprint,
            KitchenItemsJson = System.Text.Json.JsonSerializer.Serialize(lines.Select(line => new SalesKitchenLine(
                line.ProductId.ToString(), line.ProductName, line.Quantity, line.Note,
                DeserializeOptions(line.OptionsJson))).ToArray()),
            CreatedAt = now, Version = 1, Lines = lines,
        };
        db.Orders.Add(order);
        db.CheckAudit.Add(new SalesCheckAuditRow
        {
            CheckId = check.Id, FirmId = firmId, BranchId = branchId,
            Actor = actor, Action = createCheck ? "created" : "order_added", Version = check.Version, OccurredAt = now,
        });
        db.Audit.Add(new SalesOrderAuditRow
        {
            OrderId = order.Id, FirmId = firmId, BranchId = branchId,
            Actor = actor, Action = "created", Version = 1, OccurredAt = now,
        });
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            if (createCheck && check.TableId is not null)
                await CreateServiceAssignmentAsync(check, order, actor, transaction.GetDbTransaction(), cancellationToken);
            else if (check.TableId is not null)
                await ExecuteAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction(), """
                    UPDATE service.tables SET status='occupied', reserved_for=NULL, version=version+1, updated_at=@at
                    WHERE id=@table AND firm_id=@firm AND branch_id=@branch AND status='bill_requested'
                    """, cancellationToken, ("table", check.TableId), ("firm", firmId), ("branch", branchId), ("at", now));
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException error) when (error.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return SalesOrderResult.Rejected("ORDER_ID_CONFLICT", 409,
                "Sipariş kimliği başka bir işlemde kullanıldı; güncel kaydı yükleyin.");
        }
        catch (PostgresException error) when (error.SqlState == PostgresErrorCodes.UniqueViolation && createCheck && check.TableId is not null)
        {
            return SalesOrderResult.Rejected("TABLE_OCCUPIED", 409, "Masada zaten açık adisyon var.");
        }
        return new SalesOrderResult(ToDetail(order), null, true);
    }

    public async Task<IReadOnlyList<SalesOrderDetail>> ListAsync(
        string firmId, string? branchId, CancellationToken cancellationToken)
    {
        var query = db.Orders.AsNoTracking().Where(row => row.FirmId == firmId);
        if (branchId is not null) query = query.Where(row => row.BranchId == branchId);
        var rows = await query.Include(row => row.Lines).Include(row => row.PaymentAttempts)
            .OrderByDescending(row => row.CreatedAt).ThenByDescending(row => row.Id)
            .Take(100).ToListAsync(cancellationToken);
        return rows.Select(ToDetail).ToArray();
    }

    public async Task<SalesOrderDetail?> GetAsync(
        string firmId, string branchId, Guid orderId, CancellationToken cancellationToken)
    {
        var row = await db.Orders.AsNoTracking().Include(order => order.Lines)
            .Include(order => order.PaymentAttempts)
            .SingleOrDefaultAsync(order => order.Id == orderId && order.FirmId == firmId &&
                order.BranchId == branchId, cancellationToken);
        return row is null ? null : ToDetail(row);
    }

    private static SalesOrderResult Existing(
        SalesOrderRow row, string firmId, string branchId, Guid checkId, string fingerprint) =>
        row.FirmId == firmId && row.BranchId == branchId && row.CheckId == checkId && row.RequestFingerprint == fingerprint
            ? new SalesOrderResult(ToDetail(row), null, false)
            : SalesOrderResult.Rejected("ORDER_ID_CONFLICT", 409,
                "Sipariş kimliği başka bir kayıt için kullanılıyor.");

    private async Task<FeatureFailure?> ValidateCheckLinksAsync(string firmId, string branchId,
        SalesCheckRow check, System.Data.Common.DbTransaction transaction, CancellationToken cancellationToken)
    {
        var connection = db.Database.GetDbConnection();
        if (check.CustomerId is not null)
        {
            if (!runtime.CariReady)
                return new FeatureFailure("CARI_STORAGE_UNAVAILABLE", 503, "Müşteri doğrulaması için cari migration'ı uygulanmalı.");
            var blocked = await gate.CheckAndLockAsync(connection, transaction, firmId, branchId,
                "cari.management", cancellationToken);
            if (blocked is not null) return blocked;
            if (!await ExistsAsync(connection, transaction,
                "SELECT EXISTS (SELECT 1 FROM cari.parties WHERE id=@id AND firm_id=@firm AND branch_id=@branch AND is_active AND types @> ARRAY['customer'])",
                cancellationToken, ("id", check.CustomerId), ("firm", firmId), ("branch", branchId)))
                return new FeatureFailure("CUSTOMER_NOT_FOUND", 404, "Bu şubede aktif müşteri carisi bulunamadı.");
        }
        if (check.TableId is not null)
        {
            var blocked = await gate.CheckAndLockAsync(connection, transaction, firmId, branchId,
                "branches.tables", cancellationToken);
            if (blocked is not null) return blocked;
            await LockRowsAsync(connection, transaction,
                "SELECT id FROM service.tables WHERE id=@id AND firm_id=@firm AND branch_id=@branch FOR UPDATE",
                cancellationToken, ("id", check.TableId), ("firm", firmId), ("branch", branchId));
            if (!await ExistsAsync(connection, transaction,
                "SELECT EXISTS (SELECT 1 FROM service.tables WHERE id=@id AND firm_id=@firm AND branch_id=@branch AND is_active)",
                cancellationToken, ("id", check.TableId), ("firm", firmId), ("branch", branchId)))
                return new FeatureFailure("TABLE_NOT_FOUND", 404, "Bu şubede aktif masa bulunamadı.");
            if (await ExistsAsync(connection, transaction,
                "SELECT EXISTS (SELECT 1 FROM service.tables WHERE id=@id AND firm_id=@firm AND branch_id=@branch AND status='reserved')",
                cancellationToken, ("id", check.TableId), ("firm", firmId), ("branch", branchId)))
                return new FeatureFailure("TABLE_RESERVED", 409, "Rezerve masaya sipariş eklenemez.");
            if (await ExistsAsync(connection, transaction,
                "SELECT EXISTS (SELECT 1 FROM service.tables t JOIN service.table_groups g ON g.id=t.table_group_id WHERE t.id=@id AND t.firm_id=@firm AND t.branch_id=@branch AND g.closed_at IS NULL AND g.primary_table_id<>t.id)",
                cancellationToken, ("id", check.TableId), ("firm", firmId), ("branch", branchId)))
                return new FeatureFailure("TABLE_GROUP_PRIMARY_REQUIRED", 409, "Bu masa bir gruba bağlı. Siparişi grubun ana masasından alın.");
            if (await ExistsAsync(connection, transaction,
                "SELECT EXISTS (SELECT 1 FROM service.assignments WHERE table_id=@id AND closed_at IS NULL)",
                cancellationToken, ("id", check.TableId)))
                return new FeatureFailure("TABLE_OCCUPIED", 409, "Masada zaten açık adisyon var.");
        }
        if (check.WaiterId is not null)
        {
            foreach (var feature in new[] { "staff.records", "service.waiters" })
            {
                var blocked = await gate.CheckAndLockAsync(connection, transaction, firmId, branchId,
                    feature, cancellationToken);
                if (blocked is not null) return blocked;
            }
            if (!await ExistsAsync(connection, transaction,
                "SELECT EXISTS (SELECT 1 FROM service.employees WHERE id=@id AND firm_id=@firm AND branch_id=@branch AND is_active AND department='service')",
                cancellationToken, ("id", check.WaiterId), ("firm", firmId), ("branch", branchId)))
                return new FeatureFailure("WAITER_NOT_FOUND", 404, "Bu şubede aktif servis personeli bulunamadı.");
        }
        return null;
    }

    private async Task CreateServiceAssignmentAsync(SalesCheckRow check, SalesOrderRow order, string actor,
        System.Data.Common.DbTransaction transaction, CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        var id = Guid.NewGuid();
        await ExecuteAsync(db.Database.GetDbConnection(), transaction, """
            INSERT INTO service.assignments (id,check_id,firm_id,branch_id,table_id,order_id,waiter_id,opened_at,closed_at,version,created_by,closed_by)
            VALUES (@id,@check,@firm,@branch,@table,@order,@waiter,@opened,NULL,1,@actor,NULL)
            """, cancellationToken, ("id", id), ("check", check.Id), ("firm", check.FirmId),
            ("branch", check.BranchId), ("table", check.TableId!), ("order", order.Id),
            ("waiter", (object?)check.WaiterId ?? DBNull.Value), ("opened", now), ("actor", actor));
        await ExecuteAsync(db.Database.GetDbConnection(), transaction, """
            UPDATE service.tables SET status='occupied', reserved_for=NULL, version=version+1, updated_at=@at
            WHERE id=@table AND firm_id=@firm AND branch_id=@branch
            """, cancellationToken, ("table", check.TableId!), ("firm", check.FirmId),
            ("branch", check.BranchId), ("at", now));
        await ExecuteAsync(db.Database.GetDbConnection(), transaction,
            "INSERT INTO service.audit (firm_id,branch_id,entity_id,action,actor,occurred_at) VALUES (@firm,@branch,@id,'assignment_opened',@actor,@at)",
            cancellationToken, ("firm", check.FirmId), ("branch", check.BranchId), ("id", id.ToString()),
            ("actor", actor), ("at", now));
        await ExecuteAsync(db.Database.GetDbConnection(), transaction, """
            INSERT INTO sales.check_audit (check_id,firm_id,branch_id,actor,action,version,occurred_at)
            VALUES (@check,@firm,@branch,@actor,'table_assigned',@version,@at)
            """, cancellationToken, ("check", check.Id), ("firm", check.FirmId),
            ("branch", check.BranchId), ("actor", actor), ("version", check.Version), ("at", now));
    }

    private static async Task<bool> ExistsAsync(DbConnection connection, DbTransaction transaction, string sql,
        CancellationToken cancellationToken, params (string Name, object? Value)[] parameters)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = sql;
        foreach (var (name, value) in parameters) AddParameter(command, name, value);
        return (bool)(await command.ExecuteScalarAsync(cancellationToken) ?? false);
    }

    private static async Task ExecuteAsync(DbConnection connection, DbTransaction transaction, string sql,
        CancellationToken cancellationToken, params (string Name, object? Value)[] parameters)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = sql;
        foreach (var (name, value) in parameters) AddParameter(command, name, value);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task LockRowsAsync(DbConnection connection, DbTransaction transaction, string sql,
        CancellationToken cancellationToken, params (string Name, object? Value)[] parameters)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = sql;
        foreach (var (name, value) in parameters) AddParameter(command, name, value);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken)) { }
    }

    private static void AddParameter(DbCommand command, string name, object? value)
    {
        var parameter = command.CreateParameter();
        parameter.ParameterName = name;
        parameter.Value = value ?? DBNull.Value;
        command.Parameters.Add(parameter);
    }

    public static SalesOrderDetail ToDetail(SalesOrderRow row) =>
        new(row.Id.ToString(), row.FirmId, row.BranchId, row.Source, row.Status,
            row.PaymentStatus, row.TotalMinor,
            row.PaymentAttempts.Where(attempt => attempt.Status == "succeeded").Sum(attempt => attempt.AmountMinor),
            row.TotalMinor - row.PaymentAttempts.Where(attempt => attempt.Status == "succeeded").Sum(attempt => attempt.AmountMinor),
            row.Currency, row.CreatedAt, row.Version,
            row.Lines.OrderBy(line => line.ProductId).Select(line =>
                new SalesOrderLine(line.Id, line.ProductId.ToString(), line.ProductName, line.Sku,
                    line.Quantity, line.BaseUnitPriceMinor, line.UnitPriceMinor, line.LineTotalMinor, line.Currency, line.Note,
                    DeserializeOptions(line.OptionsJson))).ToArray(),
            System.Text.Json.JsonSerializer.Deserialize<SalesKitchenLine[]>(row.KitchenItemsJson) ?? []);

    private static SalesOrderOptionSnapshot[] DeserializeOptions(string json)
    {
        try { return System.Text.Json.JsonSerializer.Deserialize<SalesOrderOptionSnapshot[]>(json) ?? []; }
        catch (System.Text.Json.JsonException)
        {
            var legacy = System.Text.Json.JsonSerializer.Deserialize<LegacyOrderOption[]>(json) ?? [];
            return legacy.Select(option => new SalesOrderOptionSnapshot(null, null,
                option.GroupName, option.OptionName)).ToArray();
        }
    }

    private sealed record LegacyOrderOption(string GroupName, string OptionName);
}
