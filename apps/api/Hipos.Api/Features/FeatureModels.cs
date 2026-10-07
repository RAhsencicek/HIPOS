using System.Text.Json.Serialization;

namespace Hipos.Api.Features;

public sealed record FeatureDefinition(
    string Key,
    string Name,
    string Category,
    string Description,
    string ScopeType,
    string Availability,
    IReadOnlyList<string> Dependencies,
    string Icon,
    IReadOnlyList<string>? SetupRequirements = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] bool ProviderRequired = false);

public sealed record FeatureBlocker(string Code, string Message);

public sealed record BranchFeatureState(
    string Key,
    string FirmId,
    string BranchId,
    bool DesiredEnabled,
    bool EffectiveForNewWork,
    string Lifecycle,
    IReadOnlyList<FeatureBlocker> Blockers,
    int InFlightWorkCount,
    int Version,
    DateTimeOffset UpdatedAt);

public sealed record SetFeatureDesiredState(bool DesiredEnabled, int ExpectedVersion);

public sealed record FeatureFailure(string Code, int Status, string Message);

public sealed record FeatureCommandResult(BranchFeatureState? State, FeatureFailure? Failure)
{
    public static FeatureCommandResult Success(BranchFeatureState state) => new(state, null);
    public static FeatureCommandResult Rejected(string code, int status, string message) =>
        new(null, new FeatureFailure(code, status, message));
}
