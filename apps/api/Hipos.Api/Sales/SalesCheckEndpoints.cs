using System.Data.Common;
using System.Security.Cryptography;
using System.Text;
using Hipos.Api.Cari;
using Hipos.Api.Features;
using Hipos.Api.Service;
using Microsoft.EntityFrameworkCore;

namespace Hipos.Api.Sales;

public sealed record CreateSalesCheck(Guid RequestId, Guid FirstOrderId, IReadOnlyList<PosOrderItem> Items,
    string? CustomerId, string? TableId, string? WaiterId);
public sealed record StartCheckPayment(Guid OrderId, Guid AttemptId, long AmountMinor, string Method,
    string SimulatedOutcome, int ExpectedOrderVersion);
public sealed record SplitCheckLine(long OrderLineId, int Quantity);
public sealed record SplitSalesCheck(Guid RequestId, int ExpectedVersion, IReadOnlyList<SplitCheckLine> Items);
public sealed record CheckPaymentView(string Id, string OrderId, long AmountMinor, string Currency,
    string Method, string Status, int Version, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
public sealed record SalesCheckDetail(string Id, string FirmId, string BranchId, string Status,
    string? CustomerId, string? TableId, string? WaiterId, string? MergedIntoCheckId, string Currency, long TotalMinor,
    long PaidMinor, long RemainingMinor, string PaymentStatus, DateTimeOffset CreatedAt, int Version,
    IReadOnlyList<SalesOrderDetail> Orders, IReadOnlyList<CheckPaymentView> Payments);

public static class SalesCheckEndpoints
{
    public static void MapSalesCheckEndpoints(this WebApplication app, bool salesReady, bool serviceReady)
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
                command.RequestId, check, "sales.checks");
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
                DemoAccess.Resolve(context)!.Name, context.RequestAborted, checkId, null, "sales.checks");
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
                foreach (var requested in normalized)
                {
                    var line = lineMap[requested.OrderLineId].Line;
                    var movedTotal = checked(requested.Quantity * line.UnitPriceMinor);
                    targetOrder.Lines.Add(new SalesOrderLineRow { ProductId = line.ProductId, ProductName = line.ProductName,
                        Sku = line.Sku, Quantity = requested.Quantity, UnitPriceMinor = line.UnitPriceMinor,
                        LineTotalMinor = movedTotal, Currency = line.Currency });
                    line.Quantity -= requested.Quantity;
                    line.LineTotalMinor -= movedTotal;
                    if (line.Quantity == 0) db.Lines.Remove(line);
                }
                targetOrder.TotalMinor = selectedTotal;
                db.Orders.Add(targetOrder);
                foreach (var order in orders)
                {
                    order.Lines.RemoveAll(line => line.Quantity == 0);
                    if (order.Lines.Count == 0) db.Orders.Remove(order);
                    else { order.TotalMinor = order.Lines.Sum(line => line.LineTotalMinor); order.Version++; }
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

        group.MapGet("", async (string firmId, string branchId, HttpContext context, SalesDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, salesReady, false);
            if (denied is not null) return denied;
            var checks = await db.Checks.AsNoTracking().Where(row => row.FirmId == firmId && row.BranchId == branchId)
                .OrderByDescending(row => row.CreatedAt).ThenByDescending(row => row.Id).Take(100)
                .ToArrayAsync(context.RequestAborted);
            var ids = checks.Select(row => row.Id).ToArray();
            var orders = ids.Length == 0 ? [] : await db.Orders.AsNoTracking().AsSplitQuery()
                .Include(row => row.Lines).Include(row => row.PaymentAttempts)
                .Where(row => row.FirmId == firmId && row.BranchId == branchId && ids.Contains(row.CheckId))
                .OrderBy(row => row.CreatedAt).ThenBy(row => row.Id).ToArrayAsync(context.RequestAborted);
            var ordersByCheck = orders.GroupBy(row => row.CheckId).ToDictionary(group => group.Key, group => group.ToArray());
            var items = checks.Select(check => ToDetail(check,
                ordersByCheck.TryGetValue(check.Id, out var rows) ? rows : [])).ToArray();
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
        return ToDetail(check, orders);
    }

    private static SalesCheckDetail ToDetail(SalesCheckRow check, IReadOnlyList<SalesOrderRow> orders)
    {
        var attempts = orders.SelectMany(row => row.PaymentAttempts).OrderBy(row => row.CreatedAt).ThenBy(row => row.Id).ToArray();
        var total = orders.Sum(row => row.TotalMinor);
        var paid = attempts.Where(row => row.Status == "succeeded").Sum(row => row.AmountMinor);
        var paymentStatus = attempts.Any(row => row.Status == "unknown") ? "unknown" :
            attempts.Any(row => row.Status == "pending") ? "pending" :
            paid >= total && total > 0 ? "paid" : paid > 0 ? "partially_paid" : "unpaid";
        return new SalesCheckDetail(check.Id.ToString(), check.FirmId, check.BranchId, check.Status, check.CustomerId,
            check.TableId, check.WaiterId, check.MergedIntoCheckId?.ToString(), check.Currency, total, paid, Math.Max(0, total - paid), paymentStatus,
            check.CreatedAt, check.Version, orders.Select(SalesOrders.ToDetail).ToArray(),
            attempts.Select(row => new CheckPaymentView(row.Id.ToString(), row.OrderId.ToString(), row.AmountMinor,
                row.Currency, row.Method, row.Status, row.Version, row.CreatedAt, row.UpdatedAt)).ToArray());
    }

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
