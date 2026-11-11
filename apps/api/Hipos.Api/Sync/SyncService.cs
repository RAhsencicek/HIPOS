using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Hipos.Api.Features;
using Hipos.Api.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Hipos.Api.Sync;

public sealed record SyncStatusView(
    string FirmId,
    string BranchId,
    string NodeMode,
    bool LocalApiReachable,
    bool CloudReachable,
    int PendingCount,
    int BlockedCount,
    DateTimeOffset? OldestPendingAt,
    DateTimeOffset? LastAckAt,
    DateTimeOffset? LastCloudCheckAt,
    string? LastError,
    string UiState,
    string OriginNodeId);

public sealed record SyncBatchEventDto(
    Guid EventId,
    string FirmId,
    string BranchId,
    string AggregateType,
    string AggregateId,
    string PartitionKey,
    string EventType,
    string PayloadJson,
    string PayloadHash,
    int SchemaVersion,
    string IdempotencyKey,
    string OriginNodeId,
    DateTimeOffset CreatedAt);

public sealed record SyncBatchRequest(IReadOnlyList<SyncBatchEventDto> Events);

public sealed record SyncBatchItemResult(
    Guid EventId,
    string Status,
    bool Duplicate,
    string? Code = null,
    string? Message = null);

public sealed record SyncBatchResponse(IReadOnlyList<SyncBatchItemResult> Results);

public sealed record SyncFlushResult(
    string NodeMode,
    bool CloudReachable,
    int AttemptedCount,
    int AckedCount,
    int BlockedCount,
    int RemainingPendingCount,
    string? Error);

/// <summary>
/// Şube senkronizasyon modu, merkezi HTTP istemcisi ve arka plan tetikleme kanalı.
/// </summary>
public sealed class SyncCoordinator
{
    private readonly Channel<bool> _wakeChannel = Channel.CreateBounded<bool>(new BoundedChannelOptions(16)
    {
        FullMode = BoundedChannelFullMode.DropOldest,
    });

    public SyncCoordinator(IConfiguration configuration)
    {
        CloudUpstreamUrl = (configuration["HIPOS_CLOUD_SYNC_URL"] ?? Environment.GetEnvironmentVariable("HIPOS_CLOUD_SYNC_URL") ?? "")
            .Trim()
            .TrimEnd('/');
        CloudSyncToken = (configuration["HIPOS_CLOUD_SYNC_TOKEN"] ?? Environment.GetEnvironmentVariable("HIPOS_CLOUD_SYNC_TOKEN") ?? "").Trim();
        OriginNodeId = (configuration["HIPOS_SYNC_NODE_ID"] ?? Environment.GetEnvironmentVariable("HIPOS_SYNC_NODE_ID") ?? Environment.MachineName)
            .Trim();
        if (string.IsNullOrWhiteSpace(OriginNodeId)) OriginNodeId = "hipos-node";
        if (OriginNodeId.Length > 80) OriginNodeId = OriginNodeId[..80];

        Http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
        CloudReachable = !IsLanHub;
    }

    public string CloudUpstreamUrl { get; }
    public string CloudSyncToken { get; }
    public string OriginNodeId { get; }
    public bool IsLanHub => !string.IsNullOrWhiteSpace(CloudUpstreamUrl);
    public string NodeMode => IsLanHub ? "lan_hub" : "cloud";
    public HttpClient Http { get; }

    public bool CloudReachable { get; set; }
    public DateTimeOffset? LastCloudCheckAt { get; set; }
    public string? LastError { get; set; }

    public void SignalFlush() => _wakeChannel.Writer.TryWrite(true);

    public async ValueTask<bool> WaitForSignalAsync(TimeSpan timeout, CancellationToken cancellationToken)
    {
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(timeout);
        try
        {
            return await _wakeChannel.Reader.WaitToReadAsync(timeoutCts.Token) && _wakeChannel.Reader.TryRead(out _);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return false;
        }
    }
}

public sealed class SyncService(
    FeatureRuntimeCapabilities capabilities,
    SyncCoordinator coordinator,
    IServiceScopeFactory scopeFactory,
    IRestaurantEventHub eventHub,
    ILogger<SyncService> logger)
{
    private const int CurrentSchemaVersion = 1;
    private static readonly int[] RetryBackoffSeconds = [5, 15, 30, 60, 120, 300];
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public bool IsReady => capabilities.SyncReady;

    public async Task TryEnqueueAsync(
        string firmId,
        string branchId,
        string aggregateType,
        string aggregateId,
        string eventType,
        object payload,
        string idempotencyKey,
        CancellationToken cancellationToken = default)
    {
        if (!capabilities.SyncReady || string.IsNullOrWhiteSpace(firmId) || string.IsNullOrWhiteSpace(branchId))
            return;

        try
        {
            var payloadJson = JsonSerializer.Serialize(payload, JsonOptions);
            var payloadHash = ComputePayloadHash(eventType, aggregateId, payloadJson);
            var eventId = CreateDeterministicEventId($"{firmId}:{branchId}:{eventType}:{aggregateId}:{idempotencyKey}");
            var now = DateTimeOffset.UtcNow;

            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetService<SyncDbContext>();
            if (db is null) return;

            var exists = await db.Outbox.AsNoTracking()
                .AnyAsync(row => row.EventId == eventId, cancellationToken);
            if (exists) return;

            var isLan = coordinator.IsLanHub;
            db.Outbox.Add(new SyncOutboxRow
            {
                EventId = eventId,
                FirmId = firmId,
                BranchId = branchId,
                AggregateType = Truncate(aggregateType, 40),
                AggregateId = Truncate(aggregateId, 80),
                PartitionKey = Truncate($"{firmId}:{branchId}:{aggregateType}:{aggregateId}", 100),
                EventType = Truncate(eventType, 64),
                PayloadJson = payloadJson,
                PayloadHash = payloadHash,
                SchemaVersion = CurrentSchemaVersion,
                IdempotencyKey = Truncate(idempotencyKey, 100),
                OriginNodeId = coordinator.OriginNodeId,
                Status = isLan ? "pending" : "acked",
                Attempts = 0,
                NextRetryAt = now,
                CreatedAt = now,
                AckedAt = isLan ? null : now,
            });

            await db.SaveChangesAsync(cancellationToken);

            if (isLan)
            {
                coordinator.SignalFlush();
                eventHub.Publish("sync.status_updated", firmId, branchId, new { enqueued = eventType });
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Sync outbox kaydı yazılamadı ({EventType} / {AggregateId})", eventType, aggregateId);
        }
    }

    public async Task<SyncStatusView> GetStatusAsync(string firmId, string branchId, CancellationToken cancellationToken)
    {
        if (!capabilities.SyncReady)
        {
            return new SyncStatusView(
                firmId,
                branchId,
                coordinator.NodeMode,
                true,
                coordinator.CloudReachable,
                0,
                0,
                null,
                null,
                coordinator.LastCloudCheckAt,
                coordinator.LastError,
                coordinator.IsLanHub && !coordinator.CloudReachable ? "lan_pending" : "online_synced",
                coordinator.OriginNodeId);
        }

        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SyncDbContext>();

        var pendingCount = await db.Outbox.AsNoTracking()
            .CountAsync(row => row.FirmId == firmId && row.BranchId == branchId &&
                (row.Status == "pending" || row.Status == "sending" || row.Status == "failed_retryable"),
                cancellationToken);
        var blockedCount = await db.Outbox.AsNoTracking()
            .CountAsync(row => row.FirmId == firmId && row.BranchId == branchId && row.Status == "blocked",
                cancellationToken);
        var oldestPendingAt = await db.Outbox.AsNoTracking()
            .Where(row => row.FirmId == firmId && row.BranchId == branchId &&
                (row.Status == "pending" || row.Status == "sending" || row.Status == "failed_retryable"))
            .MinAsync(row => (DateTimeOffset?)row.CreatedAt, cancellationToken);
        var branchRow = await db.BranchStatuses.AsNoTracking()
            .FirstOrDefaultAsync(row => row.FirmId == firmId && row.BranchId == branchId, cancellationToken);
        var lastAckAt = branchRow?.LastAckAt ?? await db.Outbox.AsNoTracking()
            .Where(row => row.FirmId == firmId && row.BranchId == branchId && row.AckedAt != null)
            .MaxAsync(row => row.AckedAt, cancellationToken);

        var cloudReachable = !coordinator.IsLanHub || (branchRow?.CloudReachable ?? coordinator.CloudReachable);
        var lastError = coordinator.IsLanHub ? (branchRow?.LastError ?? coordinator.LastError) : null;
        var lastCheck = coordinator.IsLanHub ? (branchRow?.LastCloudCheckAt ?? coordinator.LastCloudCheckAt) : DateTimeOffset.UtcNow;

        var uiState = blockedCount > 0
            ? "sync_blocked"
            : coordinator.IsLanHub && (!cloudReachable || pendingCount > 0)
                ? "lan_pending"
                : "online_synced";

        return new SyncStatusView(
            firmId,
            branchId,
            coordinator.NodeMode,
            true,
            cloudReachable,
            pendingCount,
            blockedCount,
            oldestPendingAt,
            lastAckAt,
            lastCheck,
            lastError,
            uiState,
            coordinator.OriginNodeId);
    }

    public async Task<SyncBatchResponse> ProcessIncomingBatchAsync(
        SyncBatchRequest request,
        Func<SyncBatchEventDto, bool> isAuthorizedForEvent,
        CancellationToken cancellationToken)
    {
        if (request.Events is null || request.Events.Count == 0)
            return new SyncBatchResponse([]);

        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SyncDbContext>();
        var results = new List<SyncBatchItemResult>(request.Events.Count);
        var touchedBranches = new HashSet<(string FirmId, string BranchId)>();
        var now = DateTimeOffset.UtcNow;

        foreach (var item in request.Events)
        {
            if (!isAuthorizedForEvent(item))
            {
                results.Add(new SyncBatchItemResult(item.EventId, "blocked", false, "UNAUTHORIZED_SCOPE", "Bu olay için şube kapsamı yetkisi yok."));
                continue;
            }

            if (item.EventId == Guid.Empty || string.IsNullOrWhiteSpace(item.FirmId) || string.IsNullOrWhiteSpace(item.BranchId) ||
                string.IsNullOrWhiteSpace(item.EventType) || string.IsNullOrWhiteSpace(item.PayloadHash))
            {
                results.Add(new SyncBatchItemResult(item.EventId, "blocked", false, "INVALID_EVENT", "Olay zorunlu alanları eksik."));
                continue;
            }

            if (item.SchemaVersion < 1 || item.SchemaVersion > CurrentSchemaVersion)
            {
                results.Add(new SyncBatchItemResult(item.EventId, "blocked", false, "UNSUPPORTED_SCHEMA", $"Desteklenmeyen şema sürümü: {item.SchemaVersion}"));
                continue;
            }

            var existing = await db.InboundEvents.AsNoTracking()
                .FirstOrDefaultAsync(row => row.EventId == item.EventId, cancellationToken);
            if (existing is not null)
            {
                if (existing.PayloadHash == item.PayloadHash &&
                    existing.FirmId == item.FirmId &&
                    existing.BranchId == item.BranchId)
                {
                    results.Add(new SyncBatchItemResult(item.EventId, "acked", true));
                }
                else
                {
                    results.Add(new SyncBatchItemResult(
                        item.EventId,
                        "conflict",
                        false,
                        "IDEMPOTENCY_CONFLICT",
                        "Aynı eventId farklı yük özeti veya firma/şube kapsamıyla tekrar gönderildi."));
                }
                continue;
            }

            db.InboundEvents.Add(new SyncInboundEventRow
            {
                EventId = item.EventId,
                FirmId = Truncate(item.FirmId, 64),
                BranchId = Truncate(item.BranchId, 64),
                AggregateType = Truncate(item.AggregateType, 40),
                AggregateId = Truncate(item.AggregateId, 80),
                EventType = Truncate(item.EventType, 64),
                PayloadJson = string.IsNullOrWhiteSpace(item.PayloadJson) ? "{}" : item.PayloadJson,
                PayloadHash = Truncate(item.PayloadHash, 64),
                OriginNodeId = Truncate(string.IsNullOrWhiteSpace(item.OriginNodeId) ? "lan-hub" : item.OriginNodeId, 80),
                SchemaVersion = item.SchemaVersion,
                Status = "applied",
                ReceivedAt = now,
                SourceCreatedAt = item.CreatedAt == default ? now : item.CreatedAt,
            });
            touchedBranches.Add((item.FirmId, item.BranchId));
            results.Add(new SyncBatchItemResult(item.EventId, "acked", false));
        }

        foreach (var (firmId, branchId) in touchedBranches)
        {
            await UpsertBranchStatusAsync(db, firmId, branchId, coordinator.NodeMode, null, true, now, now, null, cancellationToken);
        }

        await db.SaveChangesAsync(cancellationToken);

        foreach (var (firmId, branchId) in touchedBranches)
        {
            eventHub.Publish("sync.batch_applied", firmId, branchId, new { receivedAt = now });
        }

        return new SyncBatchResponse(results);
    }

    public async Task<SyncFlushResult> FlushOutboxAsync(
        string? firmIdFilter = null,
        string? branchIdFilter = null,
        bool forceRetryWait = false,
        string? bearerTokenOverride = null,
        CancellationToken cancellationToken = default)
    {
        if (!capabilities.SyncReady)
        {
            return new SyncFlushResult(coordinator.NodeMode, coordinator.CloudReachable, 0, 0, 0, 0, null);
        }

        if (!coordinator.IsLanHub)
        {
            if (!string.IsNullOrWhiteSpace(firmIdFilter) && !string.IsNullOrWhiteSpace(branchIdFilter))
            {
                using var scope = scopeFactory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<SyncDbContext>();
                var now = DateTimeOffset.UtcNow;
                await UpsertBranchStatusAsync(db, firmIdFilter, branchIdFilter, "cloud", null, true, now, null, null, cancellationToken);
                await db.SaveChangesAsync(cancellationToken);
            }
            return new SyncFlushResult("cloud", true, 0, 0, 0, 0, null);
        }

        var reachable = await ProbeCloudHealthAsync(cancellationToken);
        using var flushScope = scopeFactory.CreateScope();
        var flushDb = flushScope.ServiceProvider.GetRequiredService<SyncDbContext>();
        var checkTime = DateTimeOffset.UtcNow;

        var query = flushDb.Outbox
            .Where(row => row.Status == "pending" || row.Status == "failed_retryable" ||
                (row.Status == "sending" && row.NextRetryAt <= checkTime));

        if (!string.IsNullOrWhiteSpace(firmIdFilter))
            query = query.Where(row => row.FirmId == firmIdFilter);
        if (!string.IsNullOrWhiteSpace(branchIdFilter))
            query = query.Where(row => row.BranchId == branchIdFilter);
        if (!forceRetryWait)
            query = query.Where(row => row.NextRetryAt <= checkTime);

        var dueRows = await query
            .OrderBy(row => row.CreatedAt)
            .Take(50)
            .ToListAsync(cancellationToken);

        if (!reachable)
        {
            var errMsg = coordinator.LastError ?? "Merkez bulut API'sine erişilemiyor.";
            if (!string.IsNullOrWhiteSpace(firmIdFilter) && !string.IsNullOrWhiteSpace(branchIdFilter))
            {
                await UpsertBranchStatusAsync(flushDb, firmIdFilter, branchIdFilter, "lan_hub", coordinator.CloudUpstreamUrl,
                    false, checkTime, null, errMsg, cancellationToken);
                await flushDb.SaveChangesAsync(cancellationToken);
            }
            var remaining = await CountRemainingAsync(flushDb, firmIdFilter, branchIdFilter, cancellationToken);
            return new SyncFlushResult("lan_hub", false, dueRows.Count, 0, 0, remaining, errMsg);
        }

        if (dueRows.Count == 0)
        {
            if (!string.IsNullOrWhiteSpace(firmIdFilter) && !string.IsNullOrWhiteSpace(branchIdFilter))
            {
                await UpsertBranchStatusAsync(flushDb, firmIdFilter, branchIdFilter, "lan_hub", coordinator.CloudUpstreamUrl,
                    true, checkTime, null, null, cancellationToken);
                await flushDb.SaveChangesAsync(cancellationToken);
            }
            var remaining = await CountRemainingAsync(flushDb, firmIdFilter, branchIdFilter, cancellationToken);
            return new SyncFlushResult("lan_hub", true, 0, 0, 0, remaining, null);
        }

        foreach (var row in dueRows)
        {
            row.Status = "sending";
        }
        await flushDb.SaveChangesAsync(cancellationToken);

        var batchPayload = new SyncBatchRequest(dueRows.Select(row => new SyncBatchEventDto(
            row.EventId,
            row.FirmId,
            row.BranchId,
            row.AggregateType,
            row.AggregateId,
            row.PartitionKey,
            row.EventType,
            row.PayloadJson,
            row.PayloadHash,
            row.SchemaVersion,
            row.IdempotencyKey,
            row.OriginNodeId,
            row.CreatedAt)).ToList());

        try
        {
            using var msg = new HttpRequestMessage(HttpMethod.Post, $"{coordinator.CloudUpstreamUrl}/api/v1/sync/batch")
            {
                Content = JsonContent.Create(batchPayload, options: JsonOptions),
            };
            var authToken = !string.IsNullOrWhiteSpace(coordinator.CloudSyncToken)
                ? coordinator.CloudSyncToken
                : bearerTokenOverride;
            if (!string.IsNullOrWhiteSpace(coordinator.CloudSyncToken))
            {
                msg.Headers.Add("X-Sync-Token", coordinator.CloudSyncToken);
            }
            if (!string.IsNullOrWhiteSpace(authToken))
            {
                msg.Headers.Authorization = new AuthenticationHeaderValue("Bearer", authToken);
            }

            using var response = await coordinator.Http.SendAsync(msg, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                var bodyText = await response.Content.ReadAsStringAsync(cancellationToken);
                throw new InvalidOperationException($"HTTP {(int)response.StatusCode}: {Truncate(bodyText, 240)}");
            }

            var batchResp = await response.Content.ReadFromJsonAsync<SyncBatchResponse>(JsonOptions, cancellationToken);
            var byId = (batchResp?.Results ?? []).ToDictionary(r => r.EventId);
            var acked = 0;
            var blocked = 0;
            var now = DateTimeOffset.UtcNow;

            foreach (var row in dueRows)
            {
                if (!byId.TryGetValue(row.EventId, out var res))
                {
                    MarkRetry(row, "Merkez ACK listesinde olay yanıtı dönmedi.", now);
                    continue;
                }

                if (res.Status == "acked")
                {
                    row.Status = "acked";
                    row.AckedAt = now;
                    row.LastError = null;
                    acked++;
                }
                else
                {
                    row.Status = "blocked";
                    row.Attempts++;
                    row.LastError = Truncate($"{res.Code}: {res.Message}", 500);
                    blocked++;
                }
            }

            coordinator.CloudReachable = true;
            coordinator.LastCloudCheckAt = now;
            coordinator.LastError = null;

            foreach (var branchGroup in dueRows.GroupBy(r => (r.FirmId, r.BranchId)))
            {
                await UpsertBranchStatusAsync(flushDb, branchGroup.Key.FirmId, branchGroup.Key.BranchId,
                    "lan_hub", coordinator.CloudUpstreamUrl, true, now, acked > 0 ? now : null, null, cancellationToken);
                eventHub.Publish("sync.status_updated", branchGroup.Key.FirmId, branchGroup.Key.BranchId, new { acked, blocked });
            }

            await flushDb.SaveChangesAsync(cancellationToken);
            var remaining = await CountRemainingAsync(flushDb, firmIdFilter, branchIdFilter, cancellationToken);
            return new SyncFlushResult("lan_hub", true, dueRows.Count, acked, blocked, remaining, null);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            var now = DateTimeOffset.UtcNow;
            var errMsg = Truncate(ex.Message, 500);
            foreach (var row in dueRows)
            {
                MarkRetry(row, errMsg, now);
            }
            coordinator.CloudReachable = false;
            coordinator.LastCloudCheckAt = now;
            coordinator.LastError = errMsg;

            foreach (var branchGroup in dueRows.GroupBy(r => (r.FirmId, r.BranchId)))
            {
                await UpsertBranchStatusAsync(flushDb, branchGroup.Key.FirmId, branchGroup.Key.BranchId,
                    "lan_hub", coordinator.CloudUpstreamUrl, false, now, null, errMsg, cancellationToken);
                eventHub.Publish("sync.status_updated", branchGroup.Key.FirmId, branchGroup.Key.BranchId, new { cloudReachable = false, error = errMsg });
            }
            await flushDb.SaveChangesAsync(cancellationToken);
            var remaining = await CountRemainingAsync(flushDb, firmIdFilter, branchIdFilter, cancellationToken);
            return new SyncFlushResult("lan_hub", false, dueRows.Count, 0, 0, remaining, errMsg);
        }
    }

    public async Task<bool> ProbeCloudHealthAsync(CancellationToken cancellationToken)
    {
        if (!coordinator.IsLanHub)
        {
            coordinator.CloudReachable = true;
            coordinator.LastCloudCheckAt = DateTimeOffset.UtcNow;
            coordinator.LastError = null;
            return true;
        }

        try
        {
            using var res = await coordinator.Http.GetAsync($"{coordinator.CloudUpstreamUrl}/health", cancellationToken);
            coordinator.CloudReachable = res.IsSuccessStatusCode;
            coordinator.LastCloudCheckAt = DateTimeOffset.UtcNow;
            coordinator.LastError = res.IsSuccessStatusCode ? null : $"Bulut sağlık yanıtı HTTP {(int)res.StatusCode}";
            return res.IsSuccessStatusCode;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            coordinator.CloudReachable = false;
            coordinator.LastCloudCheckAt = DateTimeOffset.UtcNow;
            coordinator.LastError = Truncate(ex.Message, 500);
            return false;
        }
    }

    private static void MarkRetry(SyncOutboxRow row, string error, DateTimeOffset now)
    {
        row.Attempts++;
        row.Status = "failed_retryable";
        row.LastError = Truncate(error, 500);
        var delaySec = RetryBackoffSeconds[Math.Min(row.Attempts - 1, RetryBackoffSeconds.Length - 1)];
        row.NextRetryAt = now.AddSeconds(delaySec);
    }

    private static async Task<int> CountRemainingAsync(
        SyncDbContext db,
        string? firmId,
        string? branchId,
        CancellationToken cancellationToken)
    {
        var q = db.Outbox.AsNoTracking()
            .Where(row => row.Status == "pending" || row.Status == "sending" || row.Status == "failed_retryable");
        if (!string.IsNullOrWhiteSpace(firmId)) q = q.Where(row => row.FirmId == firmId);
        if (!string.IsNullOrWhiteSpace(branchId)) q = q.Where(row => row.BranchId == branchId);
        return await q.CountAsync(cancellationToken);
    }

    private static async Task UpsertBranchStatusAsync(
        SyncDbContext db,
        string firmId,
        string branchId,
        string nodeMode,
        string? upstreamUrl,
        bool cloudReachable,
        DateTimeOffset checkAt,
        DateTimeOffset? ackAt,
        string? lastError,
        CancellationToken cancellationToken)
    {
        var row = await db.BranchStatuses
            .FirstOrDefaultAsync(x => x.FirmId == firmId && x.BranchId == branchId, cancellationToken);
        if (row is null)
        {
            row = new BranchSyncStatusRow
            {
                FirmId = firmId,
                BranchId = branchId,
                NodeMode = nodeMode,
                CloudUpstreamUrl = upstreamUrl,
                CloudReachable = cloudReachable,
                LastCloudCheckAt = checkAt,
                LastAckAt = ackAt,
                LastError = lastError is null ? null : Truncate(lastError, 500),
                UpdatedAt = checkAt,
            };
            db.BranchStatuses.Add(row);
        }
        else
        {
            row.NodeMode = nodeMode;
            row.CloudUpstreamUrl = upstreamUrl;
            row.CloudReachable = cloudReachable;
            row.LastCloudCheckAt = checkAt;
            if (ackAt.HasValue) row.LastAckAt = ackAt;
            row.LastError = lastError is null ? null : Truncate(lastError, 500);
            row.UpdatedAt = checkAt;
        }
    }

    public static string ComputePayloadHash(string eventType, string aggregateId, string payloadJson)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes($"{eventType}|{aggregateId}|{payloadJson}"));
        return Convert.ToHexStringLower(bytes);
    }

    public static Guid CreateDeterministicEventId(string key)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(key));
        Span<byte> guidBytes = stackalloc byte[16];
        hash.AsSpan(0, 16).CopyTo(guidBytes);
        guidBytes[6] = (byte)((guidBytes[6] & 0x0F) | 0x40);
        guidBytes[8] = (byte)((guidBytes[8] & 0x3F) | 0x80);
        return new Guid(guidBytes);
    }

    private static string Truncate(string value, int maxLen) =>
        value.Length <= maxLen ? value : value[..maxLen];
}
