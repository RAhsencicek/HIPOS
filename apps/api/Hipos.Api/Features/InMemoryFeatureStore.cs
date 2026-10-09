namespace Hipos.Api.Features;

public sealed record FeatureAuditEvent(
    string FirmId,
    string BranchId,
    string FeatureKey,
    string Actor,
    bool DesiredEnabled,
    int Version,
    DateTimeOffset OccurredAt);

// Prototip deposu: tek sunucu sürecinde yaşar; üretim kalıcılığı veya dağıtık tutarlılık sağlamaz.
public sealed class InMemoryFeatureStore : IFeatureStore
{
    public const string SingleFirm = "11111111-1111-4111-8111-111111111111";
    public const string SingleBranch = "33333333-3333-4333-8333-333333333333";
    public const string MultiFirm = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    public const string ModaBranch = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
    public const string BesiktasBranch = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
    public const string AtasehirBranch = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";

    private static readonly (string FirmId, string BranchId)[] Branches =
    [
        (SingleFirm, SingleBranch),
        (MultiFirm, ModaBranch),
        (MultiFirm, BesiktasBranch),
        (MultiFirm, AtasehirBranch),
    ];

    private static readonly HashSet<string> InitiallyDesired =
    [
        "catalog.products", "catalog.pricing", "sales.monitoring",
        "branches.tables", "staff.records", "kitchen.monitoring", "reports.sales",
        "cari.management",
    ];

    private readonly object gate = new();
    private readonly Dictionary<(string FirmId, string BranchId, string Key), BranchFeatureState> states = [];
    private readonly List<FeatureAuditEvent> audit = [];

    public InMemoryFeatureStore()
    {
        foreach (var (firmId, branchId) in Branches)
        foreach (var definition in FeatureCatalog.All)
        {
            var setupPreview = branchId == ModaBranch && definition.Key == "inventory.items";
            var providerPreview = branchId == ModaBranch && definition.Key == "integrations.delivery";
            var drainingPreview = branchId == AtasehirBranch && definition.Key == "kitchen.monitoring";
            var desired = InitiallyDesired.Contains(definition.Key) || setupPreview || providerPreview;
            var lifecycle = drainingPreview ? "draining" : setupPreview ? "setup_required" :
                providerPreview ? "provider_pending" : desired ? "ready" : "disabled";
            var blockers = FeatureRules.Blockers(definition, lifecycle);
            states[(firmId, branchId, definition.Key)] = new BranchFeatureState(
                definition.Key, firmId, branchId, drainingPreview ? false : desired,
                false, lifecycle, blockers,
                drainingPreview || (branchId == ModaBranch && definition.Key == "kitchen.monitoring") ? 2 : 0,
                1, new DateTimeOffset(2026, 10, 5, 9, 30, 0, TimeSpan.Zero));
        }
    }

    public IReadOnlyList<BranchFeatureState> List(string firmId, string branchId)
    {
        lock (gate)
            return FeatureCatalog.All.Select(definition => Copy(states[(firmId, branchId, definition.Key)])).ToArray();
    }

    public IReadOnlyList<FeatureAuditEvent> Audit(string firmId, string branchId)
    {
        lock (gate)
            return audit.Where(item => item.FirmId == firmId && item.BranchId == branchId).ToArray();
    }

    public FeatureCommandResult SetDesired(
        string firmId, string branchId, string key, SetFeatureDesiredState command, string actor)
    {
        lock (gate)
        {
            var branchStates = states.Where(item => item.Key.FirmId == firmId && item.Key.BranchId == branchId)
                .ToDictionary(item => item.Key.Key, item => item.Value);
            var result = FeatureRules.SetDesired(branchStates, key, command);
            if (result.Failure is not null || result.State is null) return result;
            var next = result.State;
            if (branchStates.TryGetValue(key, out var current) && next.Version == current.Version)
                return FeatureCommandResult.Success(Copy(current));
            states[(firmId, branchId, key)] = next;
            audit.Add(new FeatureAuditEvent(firmId, branchId, key, actor, next.DesiredEnabled, next.Version, next.UpdatedAt));
            if (!next.DesiredEnabled)
            foreach (var dependent in FeatureRules.AutoDisabledDependents(branchStates, key))
            {
                states[(firmId, branchId, dependent.Key)] = dependent;
                audit.Add(new FeatureAuditEvent(firmId, branchId, dependent.Key,
                    $"{actor}:dependency:{key}", false, dependent.Version, dependent.UpdatedAt));
            }
            return FeatureCommandResult.Success(Copy(next));
        }
    }

    public bool CanStartNewWork(string firmId, string branchId, string key)
    {
        lock (gate)
            return states.TryGetValue((firmId, branchId, key), out var state) && state.EffectiveForNewWork;
    }

    // Gerçek operasyon olayı yerine geçen, yalnız geliştirme prototipinde çağrılan tamamlama adımı.
    public FeatureCommandResult CompleteOneInFlightWork(string firmId, string branchId, string key)
    {
        lock (gate)
        {
            states.TryGetValue((firmId, branchId, key), out var current);
            var result = FeatureRules.CompleteOne(current);
            if (result.Failure is not null || result.State is null) return result;
            var next = result.State;
            states[(firmId, branchId, key)] = next;
            return FeatureCommandResult.Success(Copy(next));
        }
    }

    private static BranchFeatureState Copy(BranchFeatureState state) =>
        state with { Blockers = state.Blockers.ToArray() };

    public Task<IReadOnlyList<BranchFeatureState>> ListAsync(string firmId, string branchId, CancellationToken cancellationToken) =>
        Task.FromResult(List(firmId, branchId));

    public Task<IReadOnlyList<FeatureAuditEvent>> AuditAsync(string firmId, string branchId, CancellationToken cancellationToken) =>
        Task.FromResult(Audit(firmId, branchId));

    public Task<FeatureCommandResult> SetDesiredAsync(string firmId, string branchId, string key,
        SetFeatureDesiredState command, string actor, CancellationToken cancellationToken) =>
        Task.FromResult(SetDesired(firmId, branchId, key, command, actor));

    public Task<bool> CanStartNewWorkAsync(string firmId, string branchId, string key, CancellationToken cancellationToken) =>
        Task.FromResult(CanStartNewWork(firmId, branchId, key));

    public Task<FeatureCommandResult> CompleteOneInFlightWorkAsync(string firmId, string branchId, string key,
        CancellationToken cancellationToken) =>
        Task.FromResult(CompleteOneInFlightWork(firmId, branchId, key));

}
