using System.Security.Cryptography;
using System.Text;
using Hipos.Api.Features;
using Microsoft.EntityFrameworkCore;

namespace Hipos.Api.Sync;

public static class SyncEndpoints
{
    public static void MapSyncEndpoints(this WebApplication app, bool syncReady)
    {
        var branchGroup = app.MapGroup("/api/v1/firms/{firmId}/branches/{branchId}/sync");

        branchGroup.MapGet("/status", async (
            string firmId,
            string branchId,
            HttpContext context,
            SyncService syncService) =>
        {
            var actor = DemoAccess.Resolve(context);
            if (actor is null) return Fail(context, "UNAUTHENTICATED", 401, "Oturum gerekli.");
            if (!actor.CanRead(firmId, branchId))
                return Fail(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubenin eşitleme durumunu okuma yetkisi yok.");

            var status = await syncService.GetStatusAsync(firmId, branchId, context.RequestAborted);
            return Results.Ok(status);
        });

        branchGroup.MapGet("/outbox", async (
            string firmId,
            string branchId,
            string? status,
            int? limit,
            HttpContext context,
            IServiceProvider services) =>
        {
            var actor = DemoAccess.Resolve(context);
            if (actor is null) return Fail(context, "UNAUTHENTICATED", 401, "Oturum gerekli.");
            if (!actor.CanRead(firmId, branchId) || !actor.CanManage)
                return Fail(context, "UNAUTHORIZED_SCOPE", 403, "Outbox kayıtlarını görüntülemek için yönetici yetkisi gerekli.");
            var db = services.GetService<SyncDbContext>();
            if (!syncReady || db is null)
                return Results.Ok(new { items = Array.Empty<object>(), storageReady = false });

            var query = db.Outbox.AsNoTracking()
                .Where(row => row.FirmId == firmId && row.BranchId == branchId);
            if (!string.IsNullOrWhiteSpace(status))
                query = query.Where(row => row.Status == status.Trim());

            var maxRows = Math.Clamp(limit ?? 50, 1, 200);
            var items = await query
                .OrderByDescending(row => row.CreatedAt)
                .Take(maxRows)
                .Select(row => new
                {
                    row.EventId,
                    row.FirmId,
                    row.BranchId,
                    row.AggregateType,
                    row.AggregateId,
                    row.PartitionKey,
                    row.EventType,
                    row.PayloadHash,
                    row.SchemaVersion,
                    row.IdempotencyKey,
                    row.OriginNodeId,
                    row.Status,
                    row.Attempts,
                    row.NextRetryAt,
                    row.LastError,
                    row.CreatedAt,
                    row.AckedAt,
                })
                .ToListAsync(context.RequestAborted);

            return Results.Ok(new { items, storageReady = true });
        });

        branchGroup.MapPost("/flush", async (
            string firmId,
            string branchId,
            HttpContext context,
            SyncService syncService) =>
        {
            var actor = DemoAccess.Resolve(context);
            if (actor is null) return Fail(context, "UNAUTHENTICATED", 401, "Oturum gerekli.");
            if (!actor.CanRead(firmId, branchId) || !actor.CanOperate)
                return Fail(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubede eşitleme tetikleme yetkisi yok.");

            var authHeader = context.Request.Headers.Authorization.ToString();
            var bearer = authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
                ? authHeader["Bearer ".Length..].Trim()
                : null;

            var result = await syncService.FlushOutboxAsync(firmId, branchId, forceRetryWait: true, bearerTokenOverride: bearer, context.RequestAborted);
            return Results.Ok(result);
        });

        branchGroup.MapPost("/outbox/{eventId:guid}/retry", async (
            string firmId,
            string branchId,
            Guid eventId,
            HttpContext context,
            IServiceProvider services,
            SyncCoordinator coordinator) =>
        {
            var actor = DemoAccess.Resolve(context);
            if (actor is null) return Fail(context, "UNAUTHENTICATED", 401, "Oturum gerekli.");
            if (!actor.CanRead(firmId, branchId) || !actor.CanManage)
                return Fail(context, "UNAUTHORIZED_SCOPE", 403, "Engellenmiş olayı yeniden kuyruğa almak için yönetici yetkisi gerekli.");
            var db = services.GetService<SyncDbContext>();
            if (!syncReady || db is null)
                return Fail(context, "SYNC_STORAGE_UNAVAILABLE", 503, "Sync veritabanı hazır değil.");

            var row = await db.Outbox
                .FirstOrDefaultAsync(x => x.EventId == eventId && x.FirmId == firmId && x.BranchId == branchId, context.RequestAborted);
            if (row is null)
                return Fail(context, "EVENT_NOT_FOUND", 404, "Outbox olayı bulunamadı.");

            row.Status = "pending";
            row.NextRetryAt = DateTimeOffset.UtcNow;
            row.LastError = null;
            await db.SaveChangesAsync(context.RequestAborted);
            coordinator.SignalFlush();

            return Results.Ok(new { eventId = row.EventId, status = row.Status });
        });

        app.MapPost("/api/v1/sync/batch", async (
            SyncBatchRequest command,
            HttpContext context,
            SyncService syncService,
            SyncCoordinator coordinator) =>
        {
            if (!syncReady)
                return Fail(context, "SYNC_STORAGE_UNAVAILABLE", 503, "Sync veritabanı migration'ı uygulanmalı.");

            var hasSyncSecret = IsSyncTokenMatch(context, coordinator.CloudSyncToken);
            DemoActor? actor = hasSyncSecret ? null : DemoAccess.Resolve(context);
            if (!hasSyncSecret && actor is null)
                return Fail(context, "UNAUTHENTICATED", 401, "Geçerli senkronizasyon belirteci veya oturum gerekli.");

            var result = await syncService.ProcessIncomingBatchAsync(
                command,
                item => hasSyncSecret || actor!.IsPlatformAdmin || (actor.CanOperate && actor.CanRead(item.FirmId, item.BranchId)),
                context.RequestAborted);

            return Results.Ok(result);
        });
    }

    private static bool IsSyncTokenMatch(HttpContext context, string configuredToken)
    {
        if (string.IsNullOrWhiteSpace(configuredToken)) return false;

        var candidate = context.Request.Headers["X-Sync-Token"].ToString().Trim();
        if (string.IsNullOrWhiteSpace(candidate))
        {
            var auth = context.Request.Headers.Authorization.ToString();
            if (auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
                candidate = auth["Bearer ".Length..].Trim();
        }
        if (string.IsNullOrWhiteSpace(candidate)) return false;

        var expectedBytes = Encoding.UTF8.GetBytes(configuredToken);
        var actualBytes = Encoding.UTF8.GetBytes(candidate);
        return expectedBytes.Length == actualBytes.Length &&
               CryptographicOperations.FixedTimeEquals(expectedBytes, actualBytes);
    }

    private static IResult Fail(HttpContext context, string code, int status, string detail) =>
        Results.Json(new
        {
            type = $"https://hipos.local/problems/{code.ToLowerInvariant().Replace('_', '-')}",
            title = status switch { 401 => "Oturum gerekli", 403 => "Yetkisiz kapsam", 404 => "Bulunamadı", 409 => "İşlem çakışması", _ => "Senkronizasyon hatası" },
            status,
            detail,
            instance = context.Request.Path.Value,
            code,
            traceId = context.TraceIdentifier,
        }, statusCode: status, contentType: "application/problem+json");
}
