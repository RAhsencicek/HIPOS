using System.Collections.Concurrent;

namespace Hipos.Api.Printing;

public sealed record BridgePrinterDevice(string Name, string? Port, string? Driver, bool IsDefault);

public sealed record BridgeJobResult(
    string? JobId,
    string Target,
    bool Success,
    string? Transport,
    string? Message,
    DateTimeOffset At);

public sealed record BridgeHeartbeatRequest(
    string? BridgeId,
    string? Hostname,
    string? Platform,
    string[]? LocalIps,
    string? Version,
    BridgePrinterDevice[]? AvailablePrinters,
    BridgeJobResult? LastJobResult,
    string? StreamConnectionId);

public sealed class BridgeStreamSession
{
    public string ConnectionId { get; init; } = "";
    public string ActorName { get; init; } = "PrintBridge";
    public DateTimeOffset ConnectedAt { get; init; } = DateTimeOffset.UtcNow;
}

public sealed class BridgeNodeInfo
{
    public string BridgeId { get; set; } = "";
    public string Hostname { get; set; } = "";
    public string Platform { get; set; } = "";
    public string[] LocalIps { get; set; } = [];
    public string? Version { get; set; }
    public string? StreamConnectionId { get; set; }
    public BridgePrinterDevice[] AvailablePrinters { get; set; } = [];
    public BridgeJobResult? LastJobResult { get; set; }
    public DateTimeOffset LastHeartbeatAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class BridgeStatusSnapshot
{
    public bool Connected { get; init; }
    public int ActiveStreamCount { get; init; }
    public DateTimeOffset? LastSeenAt { get; init; }
    public IReadOnlyList<BridgeNodeInfo> Bridges { get; init; } = [];
    public IReadOnlyList<BridgePrinterDevice> AvailablePrinters { get; init; } = [];
    public BridgeJobResult? LastJobResult { get; init; }
}

/// <summary>
/// Şube bazlı aktif Print Bridge SSE akışlarını ve yerel PC yazıcı envanterini izler.
/// </summary>
public sealed class BridgePresenceRegistry
{
    private readonly ConcurrentDictionary<(string FirmId, string BranchId), ConcurrentDictionary<string, BridgeStreamSession>> _streams = new();
    private readonly ConcurrentDictionary<(string FirmId, string BranchId), ConcurrentDictionary<string, BridgeNodeInfo>> _nodes = new();

    public string RegisterStream(string firmId, string branchId, string actorName)
    {
        var connectionId = Guid.NewGuid().ToString("N")[..12];
        var scope = _streams.GetOrAdd((firmId, branchId), _ => new ConcurrentDictionary<string, BridgeStreamSession>());
        scope[connectionId] = new BridgeStreamSession
        {
            ConnectionId = connectionId,
            ActorName = actorName,
            ConnectedAt = DateTimeOffset.UtcNow
        };
        return connectionId;
    }

    public void UnregisterStream(string firmId, string branchId, string connectionId)
    {
        if (!_streams.TryGetValue((firmId, branchId), out var scope)) return;
        scope.TryRemove(connectionId, out _);

        if (_nodes.TryGetValue((firmId, branchId), out var nodes))
        {
            foreach (var kv in nodes)
            {
                if (string.Equals(kv.Value.StreamConnectionId, connectionId, StringComparison.Ordinal))
                {
                    kv.Value.StreamConnectionId = null;
                }
            }
        }
    }

    public bool HasActiveStream(string firmId, string branchId)
        => _streams.TryGetValue((firmId, branchId), out var scope) && !scope.IsEmpty;

    public BridgeNodeInfo RecordHeartbeat(string firmId, string branchId, BridgeHeartbeatRequest req)
    {
        var now = DateTimeOffset.UtcNow;
        var nodes = _nodes.GetOrAdd((firmId, branchId), _ => new ConcurrentDictionary<string, BridgeNodeInfo>());
        var bridgeId = !string.IsNullOrWhiteSpace(req.BridgeId)
            ? req.BridgeId.Trim()
            : (!string.IsNullOrWhiteSpace(req.Hostname) ? req.Hostname.Trim() : "default-bridge");

        var node = nodes.AddOrUpdate(
            bridgeId,
            _ => new BridgeNodeInfo
            {
                BridgeId = bridgeId,
                Hostname = req.Hostname?.Trim() ?? bridgeId,
                Platform = req.Platform?.Trim() ?? "unknown",
                LocalIps = req.LocalIps ?? [],
                Version = req.Version,
                StreamConnectionId = req.StreamConnectionId,
                AvailablePrinters = req.AvailablePrinters ?? [],
                LastJobResult = req.LastJobResult,
                LastHeartbeatAt = now
            },
            (_, existing) =>
            {
                if (!string.IsNullOrWhiteSpace(req.Hostname)) existing.Hostname = req.Hostname.Trim();
                if (!string.IsNullOrWhiteSpace(req.Platform)) existing.Platform = req.Platform.Trim();
                if (req.LocalIps is not null) existing.LocalIps = req.LocalIps;
                if (!string.IsNullOrWhiteSpace(req.Version)) existing.Version = req.Version;
                if (!string.IsNullOrWhiteSpace(req.StreamConnectionId)) existing.StreamConnectionId = req.StreamConnectionId;
                if (req.AvailablePrinters is not null) existing.AvailablePrinters = req.AvailablePrinters;
                if (req.LastJobResult is not null) existing.LastJobResult = req.LastJobResult;
                existing.LastHeartbeatAt = now;
                return existing;
            });

        // 10 dakikadan eski bayat kayıtları temizle
        var staleThreshold = now.AddMinutes(-10);
        foreach (var kv in nodes)
        {
            if (kv.Value.LastHeartbeatAt < staleThreshold && string.IsNullOrEmpty(kv.Value.StreamConnectionId))
            {
                nodes.TryRemove(kv.Key, out _);
            }
        }

        return node;
    }

    public BridgeStatusSnapshot GetStatus(string firmId, string branchId)
    {
        var now = DateTimeOffset.UtcNow;
        var activeStreams = _streams.TryGetValue((firmId, branchId), out var scope)
            ? scope.Values.OrderByDescending(s => s.ConnectedAt).ToArray()
            : [];

        var activeNodeCutoff = now.AddMinutes(-2);
        var activeNodes = _nodes.TryGetValue((firmId, branchId), out var nodeMap)
            ? nodeMap.Values
                .Where(n => activeStreams.Length > 0 || n.LastHeartbeatAt >= activeNodeCutoff)
                .OrderByDescending(n => n.LastHeartbeatAt)
                .ToArray()
            : [];

        var printers = activeNodes
            .SelectMany(n => n.AvailablePrinters)
            .GroupBy(p => p.Name, StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .ToArray();

        var lastSeen = activeNodes.FirstOrDefault()?.LastHeartbeatAt
            ?? activeStreams.FirstOrDefault()?.ConnectedAt;

        var lastJob = activeNodes
            .Where(n => n.LastJobResult is not null)
            .OrderByDescending(n => n.LastJobResult!.At)
            .Select(n => n.LastJobResult)
            .FirstOrDefault();

        return new BridgeStatusSnapshot
        {
            Connected = activeStreams.Length > 0,
            ActiveStreamCount = activeStreams.Length,
            LastSeenAt = lastSeen,
            Bridges = activeNodes,
            AvailablePrinters = printers,
            LastJobResult = lastJob
        };
    }
}
