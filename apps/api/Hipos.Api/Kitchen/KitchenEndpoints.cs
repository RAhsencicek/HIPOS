using Hipos.Api.Features;
using Hipos.Api.Sales;
using Hipos.Api.Service;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Hipos.Api.Kitchen;

public sealed record ChangeKitchenTaskStatus(Guid RequestId, string NextStatus, int ExpectedVersion);

public static class KitchenEndpoints
{
    public static void MapKitchenEndpoints(this WebApplication app, bool ready)
    {
        var group = app.MapGroup("/api/v1/firms/{firmId}/branches/{branchId}/kitchen/tasks");

        app.MapGet("/api/v1/firms/{firmId}/branches/{branchId}/kitchen/stations", async (
            string firmId, string branchId, HttpContext context, KitchenDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false);
            if (denied is not null) return denied;
            var items = await db.Stations.AsNoTracking()
                .Where(row => row.FirmId == firmId && row.BranchId == branchId && row.IsActive)
                .OrderBy(row => row.Name)
                .Select(row => new { id = row.Id.ToString(), row.Code, row.Name })
                .ToArrayAsync(context.RequestAborted);
            return Results.Ok(new { source = "postgres", items });
        });

        group.MapGet("", async (string firmId, string branchId, string? status, HttpContext context,
            KitchenDbContext db, ServiceDbContext service, SalesDbContext sales) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false);
            if (denied is not null) return denied;
            var statuses = status switch
            {
                null or "active" => new[] { "submitted", "preparing" },
                "ready" => new[] { "ready" },
                "served" => new[] { "served" },
                "cancelled" => new[] { "cancelled" },
                "all" => new[] { "submitted", "preparing", "ready", "served", "cancelled" },
                _ => null,
            };
            if (statuses is null)
                return Fail(context, "INVALID_KITCHEN_STATUS_FILTER", 400,
                    "Durum filtresi active, ready, served, cancelled veya all olmalı.");
            var tasks = await db.Tasks.AsNoTracking()
                .Where(row => row.FirmId == firmId && row.BranchId == branchId && statuses.Contains(row.Status))
                .OrderBy(row => row.SubmittedAt).ThenBy(row => row.Id)
                .ToListAsync(context.RequestAborted);
            var stationIds = tasks.Where(row => row.StationId != null).Select(row => row.StationId!.Value).Distinct().ToArray();
            var stations = await db.Stations.AsNoTracking().Where(row => stationIds.Contains(row.Id))
                .ToDictionaryAsync(row => row.Id, context.RequestAborted);
            var orderIds = tasks.Select(row => row.OrderId).Distinct().ToArray();
            var checkByOrder = await sales.Orders.AsNoTracking()
                .Where(row => row.FirmId == firmId && row.BranchId == branchId && orderIds.Contains(row.Id))
                .ToDictionaryAsync(row => row.Id, row => row.CheckId, context.RequestAborted);
            var checkIds = checkByOrder.Values.Distinct().ToArray();
            var assignments = await service.Assignments.AsNoTracking()
                .Where(row => row.FirmId == firmId && row.BranchId == branchId &&
                    row.ClosedAt == null && checkIds.Contains(row.CheckId))
                .ToListAsync(context.RequestAborted);
            var tables = await service.Tables.AsNoTracking()
                .Where(row => row.FirmId == firmId && row.BranchId == branchId)
                .ToDictionaryAsync(row => row.Id, row => row.Name, context.RequestAborted);
            var waiterIds = assignments.Where(row => row.WaiterId != null).Select(row => row.WaiterId!).Distinct().ToArray();
            var waiters = await service.Employees.AsNoTracking()
                .Where(row => row.FirmId == firmId && row.BranchId == branchId && waiterIds.Contains(row.Id))
                .ToDictionaryAsync(row => row.Id, row => row.Name, context.RequestAborted);
            var assignmentByCheck = assignments.GroupBy(row => row.CheckId).ToDictionary(group => group.Key, group => group.First());
            var items = tasks.Select(task =>
            {
                ServiceAssignmentRow? assignment = null;
                if (checkByOrder.TryGetValue(task.OrderId, out var checkId))
                    assignmentByCheck.TryGetValue(checkId, out assignment);
                var tableName = assignment is not null && tables.TryGetValue(assignment.TableId, out var table) ? table : null;
                var waiterName = assignment?.WaiterId is not null && waiters.TryGetValue(assignment.WaiterId, out var waiter) ? waiter : null;
                var station = task.StationId is not null && stations.TryGetValue(task.StationId.Value, out var found)
                    ? found : null;
                return ToView(task, tableName, waiterName, station);
            }).ToArray();
            return Results.Ok(new { source = "postgres", items });
        });

        group.MapPost("/{taskId}/status", async (string firmId, string branchId, string taskId,
            ChangeKitchenTaskStatus command, HttpContext context, KitchenDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            if (!Guid.TryParse(taskId, out var id) || command.RequestId == Guid.Empty ||
                command.ExpectedVersion < 1 || command.NextStatus is not ("preparing" or "ready" or "served"))
                return Fail(context, "INVALID_KITCHEN_STATUS", 400, "Görev durumu veya sürüm bilgisi geçersiz.");

            var previous = await db.Audit.AsNoTracking().SingleOrDefaultAsync(row => row.RequestId == command.RequestId,
                context.RequestAborted);
            if (previous is not null)
            {
                if (previous.TaskId != id || previous.FirmId != firmId || previous.BranchId != branchId ||
                    previous.Status != command.NextStatus)
                    return Fail(context, "REQUEST_ID_CONFLICT", 409, "İstek kimliği farklı bir mutfak işlemi için kullanılmış.");
                var repeated = await db.Tasks.AsNoTracking().SingleOrDefaultAsync(row => row.Id == id &&
                    row.FirmId == firmId && row.BranchId == branchId, context.RequestAborted);
                return repeated is null ? Fail(context, "KITCHEN_TASK_NOT_FOUND", 404, "Mutfak görevi bulunamadı.")
                    : Results.Ok(ToView(repeated, null, null, null));
            }

            var task = await db.Tasks.SingleOrDefaultAsync(row => row.Id == id && row.FirmId == firmId &&
                row.BranchId == branchId, context.RequestAborted);
            if (task is null) return Fail(context, "KITCHEN_TASK_NOT_FOUND", 404, "Mutfak görevi bulunamadı.");
            var actor = DemoAccess.Resolve(context)!;
            try { task.ChangeStatus(command.NextStatus, command.ExpectedVersion, DateTimeOffset.UtcNow); }
            catch (InvalidOperationException error) when (error.Message == "VERSION_CONFLICT")
            { return Fail(context, "VERSION_CONFLICT", 409, "Görev başka bir cihazda değişti; listeyi yenileyin."); }
            catch (InvalidOperationException)
            { return Fail(context, "INVALID_KITCHEN_STATUS_TRANSITION", 409, "Görev bu duruma geçirilemez."); }
            db.Audit.Add(new KitchenTaskAudit
            {
                RequestId = command.RequestId, TaskId = task.Id, FirmId = firmId, BranchId = branchId,
                Actor = actor.Name, Action = "status_changed", Status = task.Status,
                Version = task.Version, OccurredAt = DateTimeOffset.UtcNow,
            });
            try { await db.SaveChangesAsync(context.RequestAborted); }
            catch (DbUpdateConcurrencyException)
            { return Fail(context, "VERSION_CONFLICT", 409, "Görev başka bir cihazda değişti; listeyi yenileyin."); }
            catch (DbUpdateException error) when (error.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
            { return Fail(context, "REQUEST_ID_CONFLICT", 409, "İstek kimliği daha önce kullanılmış."); }
            return Results.Ok(ToView(task, null, null, null));
        });
    }

    private static object ToView(KitchenTask task, string? tableName, string? waiterName, KitchenStation? station) => new
    {
        id = task.Id.ToString(), orderId = task.OrderId.ToString(), orderLineId = task.OrderLineId,
        task.ProductName, task.Quantity, task.Status, task.Version, task.SubmittedAt,
        task.PreparedAt, task.ReadyAt, task.ServedAt, tableName, waiterName,
        task.CancelledAt, task.CancellationReason, task.CancelledBy,
        stationId = station?.Id.ToString(), stationCode = station?.Code ?? "unassigned",
        stationName = station?.Name ?? "Atanmamış",
    };

    private static IResult? Guard(HttpContext context, string firmId, string branchId, bool ready, bool write)
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Fail(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanRead(firmId, branchId) || write && !(actor.CanManage || actor.CanOperate))
            return Fail(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubenin mutfak görevlerine erişim izni yok.");
        return ready ? null : Fail(context, "KITCHEN_STORAGE_UNAVAILABLE", 503,
            "Mutfak migration'ı uygulanmalı ve API yeniden başlatılmalı.");
    }

    private static IResult Fail(HttpContext context, string code, int status, string detail) => Results.Json(new
    {
        type = $"https://hipos.local/problems/{code.ToLowerInvariant().Replace('_', '-')}",
        title = status switch { 401 => "Oturum gerekli", 403 => "Yetkisiz kapsam", 404 => "Bulunamadı", 409 => "İşlem çakışması", 503 => "Kurulum gerekiyor", _ => "İstek hatası" },
        status, detail, instance = context.Request.Path.Value, code, traceId = context.TraceIdentifier,
    }, statusCode: status, contentType: "application/problem+json");
}
