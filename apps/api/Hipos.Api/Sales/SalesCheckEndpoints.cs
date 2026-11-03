using System.Data.Common;
using System.Security.Cryptography;
using System.Text;
using Hipos.Api.Cari;
using Hipos.Api.Features;
using Hipos.Api.Service;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Hipos.Api.Sales;

public sealed record CreateSalesCheck(Guid RequestId, Guid FirstOrderId, IReadOnlyList<PosOrderItem> Items,
    string? CustomerId, string? TableId, string? WaiterId);
public sealed record StartCheckPayment(Guid OrderId, Guid AttemptId, long AmountMinor, string Method,
    string SimulatedOutcome, int ExpectedOrderVersion);
public sealed record SplitCheckLine(long OrderLineId, int Quantity);
public sealed record SplitSalesCheck(Guid RequestId, int ExpectedVersion, IReadOnlyList<SplitCheckLine> Items);
public sealed record CreateCheckAdjustment(Guid RequestId, int ExpectedVersion, string Action, string? ValueType,
    int? Value, long? OrderLineId, int Quantity, string Reason);
public sealed record CheckAdjustmentView(Guid RequestId, string Action, string? ValueType, int? Value,
    long? OrderLineId, int Quantity, long AmountMinor, string Reason, string Actor, string ApprovalMode, DateTimeOffset CreatedAt);
public sealed record CheckPaymentView(string Id, string OrderId, long AmountMinor, string Currency,
    string Method, string Status, int Version, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
public sealed record SalesCheckDetail(string Id, string FirmId, string BranchId, string Status,
    string? CustomerId, string? TableId, string? WaiterId, string? MergedIntoCheckId, string Currency, long TotalMinor,
    long PaidMinor, long RemainingMinor, string PaymentStatus, DateTimeOffset CreatedAt, int Version,
    IReadOnlyList<SalesOrderDetail> Orders, IReadOnlyList<CheckPaymentView> Payments, long GrossTotalMinor,
    long AdjustmentMinor, IReadOnlyList<CheckAdjustmentView> Adjustments);

public static class SalesCheckEndpoints
{
    public static void MapSalesCheckEndpoints(this WebApplication app, bool salesReady, bool serviceReady,
        bool allowUnapprovedAdjustments)
    {
        var group = app.MapGroup("/api/v1/firms/{firmId}/branches/{branchId}/sales/checks");

        group.MapPost("", async (string firmId, string branchId, CreateSalesCheck command,
            HttpContext context, SalesDbContext db, SalesOrders sales, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, salesReady, true);
            if (denied is not null) return denied;
            if (command.RequestId == Guid.Empty || command.FirstOrderId == Guid.Empty ||
                command.Items is null || command.Items.Count == 0 || command.CustomerId?.Trim().Length > 80 ||
                command.TableId?.Trim().Length > 80 || command.WaiterId?.Trim().Length > 80)
                return Fail(context, "INVALID_CHECK", 400, "Adisyon kimliği, ilk sipariş kimliği, ürün kalemleri veya ilişki kimlikleri geçersiz.");
            if ((command.TableId is not null || command.WaiterId is not null) && !serviceReady)
                return Fail(context, "SERVICE_STORAGE_UNAVAILABLE", 503, "Masa/garson migration'ı uygulanmalı.");
            var actor = DemoAccess.Resolve(context)!.Name;
            var check = new SalesCheckRow
            {
                Id = command.RequestId, FirmId = firmId, BranchId = branchId, Status = "open",
                CustomerId = EmptyToNull(command.CustomerId), TableId = EmptyToNull(command.TableId),
                WaiterId = EmptyToNull(command.WaiterId), Currency = "TRY", CreatedAt = DateTimeOffset.UtcNow,
                Version = 1,
            };
            var result = await sales.CreateAsync(firmId, branchId,
                new CreatePosOrder(command.FirstOrderId, command.Items), actor, context.RequestAborted,
                command.RequestId, check, "sales.checks", "test_pos");
            if (result.Failure is { } failure) return Fail(context, failure.Code, failure.Status, failure.Message);
            var persisted = await DetailAsync(db, firmId, branchId, command.RequestId, context.RequestAborted);
            if (persisted is null) return Fail(context, "CHECK_NOT_FOUND", 404, "Adisyon bulunamadı.");
            if (persisted.CustomerId != check.CustomerId || persisted.TableId != check.TableId || persisted.WaiterId != check.WaiterId)
                return Fail(context, "CHECK_REQUEST_CONFLICT", 409, "requestId farklı adisyon bilgileriyle kullanılmış.");
            return result.Created
                ? Results.Created($"/api/v1/firms/{firmId}/branches/{branchId}/sales/checks/{command.RequestId}", persisted)
                : Results.Ok(persisted);
        });

        group.MapPost("/{checkId:guid}/orders", async (string firmId, string branchId, Guid checkId,
            CreatePosOrder command, HttpContext context, SalesDbContext db, SalesOrders sales) =>
        {
            var denied = Guard(context, firmId, branchId, salesReady, true);
            if (denied is not null) return denied;
            var result = await sales.CreateAsync(firmId, branchId, command,
                DemoAccess.Resolve(context)!.Name, context.RequestAborted, checkId, null, "sales.checks", "test_pos");
            if (result.Failure is { } failure) return Fail(context, failure.Code, failure.Status, failure.Message);
            var detail = await DetailAsync(db, firmId, branchId, checkId, context.RequestAborted);
            return result.Created ? Results.Created($"/api/v1/firms/{firmId}/branches/{branchId}/sales/checks/{checkId}", detail)
                : Results.Ok(detail);
        });

        group.MapPost("/{checkId:guid}/split", async (string firmId, string branchId, Guid checkId,
            SplitSalesCheck command, HttpContext context, SalesDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, salesReady, true);
            if (denied is not null) return denied;
            if (command.RequestId == Guid.Empty || command.ExpectedVersion < 1 || command.Items is null ||
                command.Items.Count == 0 || command.Items.Any(item => item.OrderLineId < 1 || item.Quantity < 1) ||
                command.Items.Select(item => item.OrderLineId).Distinct().Count() != command.Items.Count)
                return Fail(context, "INVALID_SPLIT", 400, "Bölme isteği ve kalem miktarları geçersiz.");

            var normalized = command.Items.OrderBy(item => item.OrderLineId).ToArray();
            var fingerprint = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
                string.Join(";", normalized.Select(item => $"{item.OrderLineId}:{item.Quantity}")))));
            var prior = await db.CheckSplits.AsNoTracking().SingleOrDefaultAsync(row => row.RequestId == command.RequestId &&
                row.FirmId == firmId && row.BranchId == branchId, context.RequestAborted);
            if (prior is not null)
            {
                if (prior.SourceCheckId != checkId || prior.Fingerprint != fingerprint)
                    return Fail(context, "SPLIT_REQUEST_CONFLICT", 409, "requestId farklı bölme isteğiyle kullanılmış.");
                var replay = await DetailAsync(db, firmId, branchId, prior.TargetCheckId, context.RequestAborted);
                return Results.Ok(new { repeated = true, sourceCheckId = checkId, check = replay });
            }

            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            try
            {
                await db.Database.ExecuteSqlInterpolatedAsync($"SELECT id FROM sales.checks WHERE id={checkId} AND firm_id={firmId} AND branch_id={branchId} FOR UPDATE", context.RequestAborted);
                var concurrentReplay = await db.CheckSplits.AsNoTracking().SingleOrDefaultAsync(row => row.RequestId == command.RequestId &&
                    row.FirmId == firmId && row.BranchId == branchId, context.RequestAborted);
                if (concurrentReplay is not null)
                {
                    if (concurrentReplay.SourceCheckId != checkId || concurrentReplay.Fingerprint != fingerprint)
                        return Fail(context, "SPLIT_REQUEST_CONFLICT", 409, "requestId farklı bölme isteğiyle kullanılmış.");
                    var replay = await DetailAsync(db, firmId, branchId, concurrentReplay.TargetCheckId, context.RequestAborted);
                    return Results.Ok(new { repeated = true, sourceCheckId = checkId, check = replay });
                }
                var source = await db.Checks.SingleOrDefaultAsync(row => row.Id == checkId && row.FirmId == firmId &&
                    row.BranchId == branchId && row.Status == "open", context.RequestAborted);
                if (source is null) return Fail(context, "CHECK_NOT_FOUND", 404, "Açık adisyon bulunamadı.");
                if (source.Version != command.ExpectedVersion)
                    return Fail(context, "STALE_CHECK_VERSION", 409, "Adisyon başka bir işlemle değişmiş.");
                var orders = await db.Orders.AsSplitQuery().Include(row => row.Lines).Include(row => row.PaymentAttempts)
                    .Where(row => row.CheckId == checkId && row.FirmId == firmId && row.BranchId == branchId)
                    .ToListAsync(context.RequestAborted);
                if (await db.CheckAdjustments.AnyAsync(row => row.CheckId == checkId && row.FirmId == firmId &&
                    row.BranchId == branchId, context.RequestAborted))
                    return Fail(context, "CHECK_HAS_ADJUSTMENTS", 409, "İndirim veya ikram bulunan adisyon bölünemez. Önce işlemi geri alın veya yeni adisyonu kullanın.");
                if (orders.SelectMany(row => row.PaymentAttempts).Any())
                    return Fail(context, "CHECK_HAS_PAYMENTS", 409, "Ödeme girişimi bulunan adisyon bölünemez.");
                var lineMap = orders.SelectMany(order => order.Lines.Select(line => (Order: order, Line: line)))
                    .ToDictionary(pair => pair.Line.Id);
                foreach (var requested in normalized)
                    if (!lineMap.TryGetValue(requested.OrderLineId, out var pair) || requested.Quantity > pair.Line.Quantity)
                        return Fail(context, "SPLIT_QUANTITY_EXCEEDED", 409, "Kalem adisyona bağlı değil veya istenen miktar mevcut miktarı aşıyor.");
                var selectedTotal = normalized.Sum(item => checked(item.Quantity * lineMap[item.OrderLineId].Line.UnitPriceMinor));
                var sourceTotal = orders.Sum(order => order.TotalMinor);
                if (selectedTotal <= 0 || selectedTotal >= sourceTotal)
                    return Fail(context, "SPLIT_REMAINS_EMPTY", 409, "Kaynak adisyonda en az bir ürün kalemi bırakılmalı.");

                var targetId = Guid.NewGuid();
                var now = DateTimeOffset.UtcNow;
                var target = new SalesCheckRow { Id = targetId, FirmId = firmId, BranchId = branchId,
                    Status = "open", CustomerId = source.CustomerId, TableId = source.TableId,
                    WaiterId = source.WaiterId, Currency = source.Currency, CreatedAt = now, Version = 1 };
                db.Checks.Add(target);
                var targetOrder = new SalesOrderRow { Id = Guid.NewGuid(), CheckId = targetId, FirmId = firmId,
                    BranchId = branchId, Source = "split", Status = "open", PaymentStatus = "unpaid",
                    Currency = source.Currency, RequestFingerprint = fingerprint, CreatedAt = now, Version = 1 };
                var quantities = normalized.ToDictionary(item => item.OrderLineId, item => item.Quantity);
                foreach (var order in orders)
                {
                    var selectedLines = order.Lines.Where(line => quantities.ContainsKey(line.Id)).ToArray();
                    if (selectedLines.Length == 0) continue;
                    if (selectedLines.Length == order.Lines.Count &&
                        selectedLines.All(line => quantities[line.Id] == line.Quantity))
                    {
                        // Sipariş kimliği masa geçmişi ve mutfak fişi tarafından kullanılır; tamamı ayrılırken silinmez.
                        order.CheckId = targetId;
                        order.Version++;
                        continue;
                    }
                    foreach (var line in selectedLines)
                    {
                        var quantity = quantities[line.Id];
                        var movedTotal = checked(quantity * line.UnitPriceMinor);
                        targetOrder.Lines.Add(new SalesOrderLineRow { ProductId = line.ProductId, ProductName = line.ProductName,
                            Sku = line.Sku, Quantity = quantity, BaseUnitPriceMinor = line.BaseUnitPriceMinor,
                            UnitPriceMinor = line.UnitPriceMinor,
                            LineTotalMinor = movedTotal, Currency = line.Currency, Note = line.Note, OptionsJson = line.OptionsJson });
                        line.Quantity -= quantity;
                        line.LineTotalMinor -= movedTotal;
                        if (line.Quantity == 0) db.Lines.Remove(line);
                    }
                    order.Lines.RemoveAll(line => line.Quantity == 0);
                    order.TotalMinor = order.Lines.Sum(line => line.LineTotalMinor);
                    order.Version++;
                }
                if (targetOrder.Lines.Count > 0)
                {
                    targetOrder.TotalMinor = targetOrder.Lines.Sum(line => line.LineTotalMinor);
                    db.Orders.Add(targetOrder);
                }
                source.Version++;
                var actor = DemoAccess.Resolve(context)!.Name;
                db.CheckAudit.AddRange(
                    new SalesCheckAuditRow { CheckId = checkId, FirmId = firmId, BranchId = branchId, Actor = actor, Action = "split_source", Version = source.Version, OccurredAt = now },
                    new SalesCheckAuditRow { CheckId = targetId, FirmId = firmId, BranchId = branchId, Actor = actor, Action = "split_created", Version = 1, OccurredAt = now });
                db.CheckSplits.Add(new SalesCheckSplitRow { RequestId = command.RequestId, SourceCheckId = checkId,
                    TargetCheckId = targetId, FirmId = firmId, BranchId = branchId, Fingerprint = fingerprint, CreatedAt = now });
                await db.SaveChangesAsync(context.RequestAborted);
                await transaction.CommitAsync(context.RequestAborted);
                return Results.Created($"/api/v1/firms/{firmId}/branches/{branchId}/sales/checks/{targetId}",
                    new { repeated = false, sourceCheckId = checkId, source = await DetailAsync(db, firmId, branchId, checkId, context.RequestAborted), check = await DetailAsync(db, firmId, branchId, targetId, context.RequestAborted) });
            }
            catch (DbUpdateConcurrencyException)
            {
                return Fail(context, "STALE_CHECK_VERSION", 409, "Adisyon başka bir işlemle değişmiş.");
            }
        });

        group.MapGet("/{checkId:guid}/adjustments", async (string firmId, string branchId, Guid checkId,
            HttpContext context, SalesDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, salesReady, false);
            if (denied is not null) return denied;
            var checkExists = await db.Checks.AsNoTracking().AnyAsync(row => row.Id == checkId &&
                row.FirmId == firmId && row.BranchId == branchId, context.RequestAborted);
            if (!checkExists) return Fail(context, "CHECK_NOT_FOUND", 404, "Adisyon bulunamadı.");
            var rows = await db.CheckAdjustments.AsNoTracking().Where(row => row.CheckId == checkId &&
                row.FirmId == firmId && row.BranchId == branchId).OrderBy(row => row.CreatedAt).ThenBy(row => row.RequestId)
                .Select(row => new CheckAdjustmentView(row.RequestId, row.Action, row.ValueType, row.Value,
                    row.OrderLineId, row.Quantity, row.AmountMinor, row.Reason, row.Actor, row.ApprovalMode, row.CreatedAt))
                .ToArrayAsync(context.RequestAborted);
            return Results.Ok(new { items = rows, totalAdjustmentMinor = rows.Sum(row => row.AmountMinor) });
        });

        group.MapPost("/{checkId:guid}/adjustments", async (string firmId, string branchId, Guid checkId,
            CreateCheckAdjustment command, HttpContext context, SalesDbContext db, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, salesReady, true);
            if (denied is not null) return denied;
            if (!allowUnapprovedAdjustments)
                return Fail(context, "MANAGER_APPROVAL_REQUIRED", 403,
                    "İndirim, ikram veya iptal için yönetici onayı gerekli. Onaysız test yalnız Development ortamında kullanılabilir.");
            if (command.RequestId == Guid.Empty || command.ExpectedVersion < 1 ||
                command.Action is not ("discount" or "comp" or "void") ||
                string.IsNullOrWhiteSpace(command.Reason) || command.Reason.Trim().Length > 500)
                return Fail(context, "INVALID_ADJUSTMENT", 400, "İşlem, adisyon sürümü ve gerekçe geçerli olmalı.");
            var isDiscount = command.Action == "discount";
            if (isDiscount && (command.ValueType is not ("percentage" or "fixed") || command.Value is null ||
                    command.OrderLineId is not null || command.Quantity != 0 ||
                    command.ValueType == "percentage" && command.Value is < 1 or > 100 ||
                    command.ValueType == "fixed" && command.Value <= 0) ||
                !isDiscount && (command.ValueType is not null || command.Value is not null ||
                    command.OrderLineId is null or < 1 || command.Quantity is < 1 or > 99))
                return Fail(context, "INVALID_ADJUSTMENT", 400, "İndirim oranı/tutarı veya ürün miktarı geçersiz.");

            var fingerprint = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(System.Text.Json.JsonSerializer.Serialize(command with
            { Reason = command.Reason.Trim() }))));
            var prior = await db.CheckAdjustments.AsNoTracking().SingleOrDefaultAsync(row => row.RequestId == command.RequestId,
                context.RequestAborted);
            if (prior is not null)
            {
                if (prior.FirmId != firmId || prior.BranchId != branchId || prior.CheckId != checkId || prior.Fingerprint != fingerprint)
                    return Fail(context, "ADJUSTMENT_REQUEST_CONFLICT", 409, "İstek kimliği farklı bir adisyon işlemi için kullanılmış.");
                return Results.Ok(new { repeated = true, adjustment = ToAdjustmentView(prior), check = await DetailAsync(db, firmId, branchId, checkId, context.RequestAborted) });
            }

            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction(),
                firmId, branchId, "sales.checks", context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            var check = await db.Checks.FromSqlInterpolated($"""
                SELECT * FROM sales.checks WHERE id = {checkId} AND firm_id = {firmId} AND branch_id = {branchId} FOR UPDATE
                """).SingleOrDefaultAsync(context.RequestAborted);
            if (check is null || check.Status != "open") return Fail(context, "CHECK_NOT_FOUND", 404, "Açık adisyon bulunamadı.");
            var concurrentPrior = await db.CheckAdjustments.AsNoTracking().SingleOrDefaultAsync(row => row.RequestId == command.RequestId,
                context.RequestAborted);
            if (concurrentPrior is not null)
            {
                if (concurrentPrior.FirmId != firmId || concurrentPrior.BranchId != branchId || concurrentPrior.CheckId != checkId || concurrentPrior.Fingerprint != fingerprint)
                    return Fail(context, "ADJUSTMENT_REQUEST_CONFLICT", 409, "İstek kimliği farklı bir adisyon işlemi için kullanılmış.");
                return Results.Ok(new { repeated = true, adjustment = ToAdjustmentView(concurrentPrior), check = await DetailAsync(db, firmId, branchId, checkId, context.RequestAborted) });
            }
            if (check.Version != command.ExpectedVersion)
                return Fail(context, "VERSION_CONFLICT", 409, "Adisyon başka bir işlemle değişti; yeniden yükleyin.");
            var orders = await db.Orders.FromSqlInterpolated($"""
                SELECT * FROM sales.orders WHERE check_id = {checkId} AND firm_id = {firmId} AND branch_id = {branchId}
                ORDER BY id FOR UPDATE
                """).Include(row => row.Lines).Include(row => row.PaymentAttempts).ToListAsync(context.RequestAborted);
            if (orders.Count == 0) return Fail(context, "CHECK_EMPTY", 409, "İşlem yapılacak siparişi olmayan adisyon güncellenemez.");
            if (orders.SelectMany(order => order.PaymentAttempts).Any())
                return Fail(context, "CHECK_HAS_PAYMENTS", 409, "Ödeme girişimi olan adisyona indirim veya ikram uygulanamaz.");
            var priorAdjustments = await db.CheckAdjustments.AsNoTracking().Where(row => row.CheckId == checkId &&
                row.FirmId == firmId && row.BranchId == branchId).ToListAsync(context.RequestAborted);
            var gross = orders.Sum(order => order.TotalMinor);
            var applied = priorAdjustments.Sum(row => row.AmountMinor);
            var balance = gross - applied;
            long amount;
            SalesOrderLineRow? line = null;
            SalesOrderRow? orderForLine = null;
            if (isDiscount)
            {
                amount = command.ValueType == "percentage"
                    ? (long)Math.Round(balance * command.Value!.Value / 100m, MidpointRounding.AwayFromZero)
                    : command.Value!.Value;
                if (amount <= 0 || amount > balance)
                    return Fail(context, "INVALID_ADJUSTMENT_AMOUNT", 409, "İndirim adisyonun kalan tutarını aşamaz.");
            }
            else
            {
                var match = orders.SelectMany(order => order.Lines.Select(item => (Order: order, Line: item)))
                    .SingleOrDefault(pair => pair.Line.Id == command.OrderLineId);
                if (match.Line is null) return Fail(context, "ORDER_LINE_NOT_FOUND", 404, "Ürün kalemi bu açık adisyonda bulunamadı.");
                line = match.Line; orderForLine = match.Order;
                var previouslyAdjusted = priorAdjustments.Where(row => row.OrderLineId == line.Id).ToArray();
                var usedQuantity = previouslyAdjusted.Sum(row => row.Quantity);
                if (command.Quantity > line.Quantity - usedQuantity)
                    return Fail(context, "ADJUSTMENT_QUANTITY_EXCEEDED", 409, "İkram/iptal miktarı kalan ürün adedini aşamaz.");
                if (balance <= 0)
                    return Fail(context, "ADJUSTMENT_BALANCE_ZERO", 409, "Adisyon bakiyesi sıfır; bu kalem için tutar etkili işlem yapılamaz.");
                // Kalem brüt fiyatı, daha önceki adisyon indirimi sonrası kalan bakiyeden büyük olabilir.
                // İkram/iptal kalem tutarı kalan bakiyeyle sınırlandırılır; tahsilat hesabı da aynı net tutarı kullanır.
                amount = Math.Min(checked(command.Quantity * line.UnitPriceMinor), balance);
            }
            var actor = DemoAccess.Resolve(context)!.Name;
            var now = DateTimeOffset.UtcNow;
            var row = new SalesCheckAdjustmentRow { RequestId = command.RequestId, CheckId = checkId, FirmId = firmId,
                BranchId = branchId, OrderId = orderForLine?.Id, OrderLineId = line?.Id, Action = command.Action,
                ValueType = command.ValueType, Value = command.Value, Quantity = command.Quantity, AmountMinor = amount,
                Reason = command.Reason.Trim(), Actor = actor, ApprovalMode = "development_bypass", Fingerprint = fingerprint, CreatedAt = now };
            db.CheckAdjustments.Add(row);
            if (command.Action == "void" && line is not null && orderForLine is not null)
            {
                var kitchenLines = System.Text.Json.JsonSerializer.Deserialize<SalesKitchenLine[]>(orderForLine.KitchenItemsJson) ?? [];
                orderForLine.KitchenItemsJson = System.Text.Json.JsonSerializer.Serialize(kitchenLines.Append(
                    new SalesKitchenLine(line.ProductId.ToString(), $"❌ İPTAL BİLDİRİMİ · {line.ProductName}",
                        command.Quantity, $"Mutfağa iptal bildirimi · Gerekçe: {command.Reason.Trim()}",
                        System.Text.Json.JsonSerializer.Deserialize<SalesOrderOptionSnapshot[]>(line.OptionsJson) ?? [])));
                orderForLine.Version++;
            }
            check.Version++;
            db.CheckAudit.Add(new SalesCheckAuditRow { CheckId = checkId, FirmId = firmId, BranchId = branchId,
                Actor = actor, Action = $"{command.Action}_applied", Version = check.Version, OccurredAt = now });
            await db.SaveChangesAsync(context.RequestAborted);
            await transaction.CommitAsync(context.RequestAborted);
            return Results.Created($"/api/v1/firms/{firmId}/branches/{branchId}/sales/checks/{checkId}/adjustments/{row.RequestId}",
                new { repeated = false, adjustment = ToAdjustmentView(row), check = await DetailAsync(db, firmId, branchId, checkId, context.RequestAborted) });
        });

        group.MapGet("", async (string firmId, string branchId, string? tableId, HttpContext context, SalesDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, salesReady, false);
            if (denied is not null) return denied;
            if (tableId is not null && (string.IsNullOrWhiteSpace(tableId) || tableId.Length > 80))
                return Fail(context, "INVALID_TABLE_ID", 400, "Masa kimliği geçersiz.");
            var query = db.Checks.AsNoTracking().Where(row => row.FirmId == firmId && row.BranchId == branchId);
            if (tableId is not null)
                query = query.Where(row => row.TableId == tableId && row.Status == "open");
            query = query.OrderByDescending(row => row.CreatedAt).ThenByDescending(row => row.Id);
            if (tableId is null) query = query.Take(100);
            var checks = await query.ToArrayAsync(context.RequestAborted);
            var ids = checks.Select(row => row.Id).ToArray();
            var orders = ids.Length == 0 ? [] : await db.Orders.AsNoTracking().AsSplitQuery()
                .Include(row => row.Lines).Include(row => row.PaymentAttempts)
                .Where(row => row.FirmId == firmId && row.BranchId == branchId && ids.Contains(row.CheckId))
                .OrderBy(row => row.CreatedAt).ThenBy(row => row.Id).ToArrayAsync(context.RequestAborted);
            var ordersByCheck = orders.GroupBy(row => row.CheckId).ToDictionary(group => group.Key, group => group.ToArray());
            var adjustments = await db.CheckAdjustments.AsNoTracking().Where(row =>
                row.FirmId == firmId && row.BranchId == branchId && ids.Contains(row.CheckId)).ToListAsync(context.RequestAborted);
            var adjustmentsByCheck = adjustments.GroupBy(row => row.CheckId).ToDictionary(group => group.Key, group => group.ToArray());
            var items = checks.Select(check => ToDetail(check,
                ordersByCheck.TryGetValue(check.Id, out var rows) ? rows : [],
                adjustmentsByCheck.TryGetValue(check.Id, out var checkAdjustments) ? checkAdjustments : [])).ToArray();
            return Results.Ok(new { scope = new { firmId, branchId }, items });
        });

        group.MapGet("/{checkId:guid}", async (string firmId, string branchId, Guid checkId,
            HttpContext context, SalesDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, salesReady, false);
            if (denied is not null) return denied;
            var detail = await DetailAsync(db, firmId, branchId, checkId, context.RequestAborted);
            return detail is null ? Fail(context, "CHECK_NOT_FOUND", 404, "Adisyon bu şubede bulunamadı.") : Results.Ok(detail);
        });

        group.MapPost("/{checkId:guid}/payment-attempts", async (string firmId, string branchId, Guid checkId,
            StartCheckPayment command, HttpContext context, SalesDbContext db, PaymentSimulator payments) =>
        {
            var denied = Guard(context, firmId, branchId, salesReady, true);
            if (denied is not null) return denied;
            var orderExists = await db.Orders.AsNoTracking().AnyAsync(row => row.Id == command.OrderId &&
                row.CheckId == checkId && row.FirmId == firmId && row.BranchId == branchId, context.RequestAborted);
            if (!orderExists) return Fail(context, "ORDER_NOT_FOUND", 404, "Sipariş bu adisyona bağlı değil.");
            var payment = await payments.StartAsync(firmId, branchId, command.OrderId,
                new StartSimulatedPayment(command.AttemptId, command.AmountMinor, command.Method,
                    command.SimulatedOutcome, command.ExpectedOrderVersion), DemoAccess.Resolve(context)!.Name,
                context.RequestAborted, requireCheckCapability: true);
            if (payment.Failure is { } failure) return Fail(context, failure.Code, failure.Status, failure.Message);
            var detail = await DetailAsync(db, firmId, branchId, checkId, context.RequestAborted);
            return payment.Created ? Results.Created($"/api/v1/firms/{firmId}/branches/{branchId}/sales/checks/{checkId}/payment-attempts/{command.AttemptId}",
                new { attempt = payment.Attempt, check = detail }) : Results.Ok(new { attempt = payment.Attempt, check = detail });
        });

        group.MapPost("/{checkId:guid}/payment-attempts/{attemptId:guid}/resolve", async (string firmId,
            string branchId, Guid checkId, Guid attemptId, ResolveSimulatedPayment command, HttpContext context,
            SalesDbContext db, PaymentSimulator payments) =>
        {
            var denied = Guard(context, firmId, branchId, salesReady, true);
            if (denied is not null) return denied;
            var attempt = await db.PaymentAttempts.AsNoTracking().SingleOrDefaultAsync(row => row.Id == attemptId &&
                row.CheckId == checkId && row.FirmId == firmId && row.BranchId == branchId, context.RequestAborted);
            if (attempt is null) return Fail(context, "PAYMENT_NOT_FOUND", 404, "Ödeme girişimi bulunamadı.");
            var result = await payments.ResolveAsync(firmId, branchId, attempt.OrderId, attemptId, command,
                DemoAccess.Resolve(context)!.Name, context.RequestAborted);
            if (result.Failure is { } failure) return Fail(context, failure.Code, failure.Status, failure.Message);
            var detail = await DetailAsync(db, firmId, branchId, checkId, context.RequestAborted);
            return Results.Ok(new { attempt = result.Attempt, check = detail });
        });
    }

    private static async Task<SalesCheckDetail?> DetailAsync(SalesDbContext db, string firmId,
        string branchId, Guid checkId, CancellationToken cancellationToken)
    {
        var check = await db.Checks.AsNoTracking().SingleOrDefaultAsync(row => row.Id == checkId &&
            row.FirmId == firmId && row.BranchId == branchId, cancellationToken);
        if (check is null) return null;
        var orders = await db.Orders.AsNoTracking().AsSplitQuery().Include(row => row.Lines).Include(row => row.PaymentAttempts)
            .Where(row => row.CheckId == checkId && row.FirmId == firmId && row.BranchId == branchId)
            .OrderBy(row => row.CreatedAt).ThenBy(row => row.Id).ToListAsync(cancellationToken);
        var adjustments = await db.CheckAdjustments.AsNoTracking().Where(row => row.CheckId == checkId &&
            row.FirmId == firmId && row.BranchId == branchId).OrderBy(row => row.CreatedAt).ThenBy(row => row.RequestId)
            .ToListAsync(cancellationToken);
        return ToDetail(check, orders, adjustments);
    }

    private static SalesCheckDetail ToDetail(SalesCheckRow check, IReadOnlyList<SalesOrderRow> orders,
        IReadOnlyList<SalesCheckAdjustmentRow> adjustments)
    {
        var attempts = orders.SelectMany(row => row.PaymentAttempts).OrderBy(row => row.CreatedAt).ThenBy(row => row.Id).ToArray();
        var gross = orders.Sum(row => row.TotalMinor);
        var adjustmentMinor = adjustments.Sum(row => row.AmountMinor);
        var total = Math.Max(0, gross - adjustmentMinor);
        var paid = attempts.Where(row => row.Status == "succeeded").Sum(row => row.AmountMinor);
        var paymentStatus = attempts.Any(row => row.Status == "unknown") ? "unknown" :
            attempts.Any(row => row.Status == "pending") ? "pending" :
            paid >= total && total > 0 ? "paid" : paid > 0 ? "partially_paid" : "unpaid";
        return new SalesCheckDetail(check.Id.ToString(), check.FirmId, check.BranchId, check.Status, check.CustomerId,
            check.TableId, check.WaiterId, check.MergedIntoCheckId?.ToString(), check.Currency, total, paid, Math.Max(0, total - paid), paymentStatus,
            check.CreatedAt, check.Version, orders.Select(SalesOrders.ToDetail).ToArray(),
            attempts.Select(row => new CheckPaymentView(row.Id.ToString(), row.OrderId.ToString(), row.AmountMinor,
                row.Currency, row.Method, row.Status, row.Version, row.CreatedAt, row.UpdatedAt)).ToArray(),
            gross, adjustmentMinor, adjustments.Select(ToAdjustmentView).ToArray());
    }

    private static CheckAdjustmentView ToAdjustmentView(SalesCheckAdjustmentRow row) =>
        new(row.RequestId, row.Action, row.ValueType, row.Value, row.OrderLineId, row.Quantity, row.AmountMinor,
            row.Reason, row.Actor, row.ApprovalMode, row.CreatedAt);

    private static IResult? Guard(HttpContext context, string firmId, string branchId, bool ready, bool write)
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Fail(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanRead(firmId, branchId) || write && !(actor.CanManage || actor.CanOperate))
            return Fail(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubenin adisyon işlemi için yetki yok.");
        if (!ready) return Fail(context, "SALES_STORAGE_UNAVAILABLE", 503, "Satış migration'ı uygulanmalı.");
        return null;
    }

    private static string? EmptyToNull(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    private static IResult Fail(HttpContext context, string code, int status, string message) =>
        Results.Json(new { code, message, requestId = context.TraceIdentifier }, statusCode: status);
}
