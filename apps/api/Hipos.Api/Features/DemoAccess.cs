namespace Hipos.Api.Features;

public sealed record DemoActor(string Name, bool CanManage, bool CanOperate, IReadOnlySet<string> AllowedBranches)
{
    public bool CanRead(string firmId, string branchId) =>
        AllowedBranches.Contains($"{firmId}:{branchId}");
}

public static class DemoAccess
{
    // Yalnız geliştirme prototipi. Gerçek firma/şube üyeliği veritabanından doğrulanacaktır.
    public static bool CanReadCatalog(DemoActor actor, string firmId, string? branchId)
    {
        if (branchId is not null) return actor.CanRead(firmId, branchId);
        string[] allBranches = firmId switch
        {
            InMemoryFeatureStore.SingleFirm => [InMemoryFeatureStore.SingleBranch],
            InMemoryFeatureStore.MultiFirm =>
            [InMemoryFeatureStore.ModaBranch, InMemoryFeatureStore.BesiktasBranch, InMemoryFeatureStore.AtasehirBranch],
            _ => [],
        };
        return allBranches.Length > 0 && allBranches.All(branch => actor.CanRead(firmId, branch));
    }

    private static readonly IReadOnlyDictionary<string, DemoActor> Actors =
        new Dictionary<string, DemoActor>
        {
            ["manager-single"] = new("manager-single", true, false,
                new HashSet<string> { Scope(InMemoryFeatureStore.SingleFirm, InMemoryFeatureStore.SingleBranch) }),
            ["manager-multi"] = new("manager-multi", true, false,
                new HashSet<string>
                {
                    Scope(InMemoryFeatureStore.MultiFirm, InMemoryFeatureStore.ModaBranch),
                    Scope(InMemoryFeatureStore.MultiFirm, InMemoryFeatureStore.BesiktasBranch),
                    Scope(InMemoryFeatureStore.MultiFirm, InMemoryFeatureStore.AtasehirBranch),
                }),
            ["manager-moda"] = new("manager-moda", true, false,
                new HashSet<string> { Scope(InMemoryFeatureStore.MultiFirm, InMemoryFeatureStore.ModaBranch) }),
            ["viewer-multi"] = new("viewer-multi", false, false,
                new HashSet<string>
                {
                    Scope(InMemoryFeatureStore.MultiFirm, InMemoryFeatureStore.ModaBranch),
                    Scope(InMemoryFeatureStore.MultiFirm, InMemoryFeatureStore.BesiktasBranch),
                    Scope(InMemoryFeatureStore.MultiFirm, InMemoryFeatureStore.AtasehirBranch),
                }),
            ["pos-single"] = new("pos-single", false, true,
                new HashSet<string> { Scope(InMemoryFeatureStore.SingleFirm, InMemoryFeatureStore.SingleBranch) }),
            ["pos-moda"] = new("pos-moda", false, true,
                new HashSet<string> { Scope(InMemoryFeatureStore.MultiFirm, InMemoryFeatureStore.ModaBranch) }),
            ["pos-besiktas"] = new("pos-besiktas", false, true,
                new HashSet<string> { Scope(InMemoryFeatureStore.MultiFirm, InMemoryFeatureStore.BesiktasBranch) }),
        };

    public static DemoActor? Resolve(HttpContext context) =>
        Actors.TryGetValue(context.Request.Headers["X-Demo-Actor"].ToString(), out var actor) ? actor : null;

    private static string Scope(string firmId, string branchId) => $"{firmId}:{branchId}";
}
