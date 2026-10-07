namespace Hipos.Api.Features;

public interface IFeatureStore
{
    Task<IReadOnlyList<BranchFeatureState>> ListAsync(string firmId, string branchId, CancellationToken cancellationToken);
    Task<IReadOnlyList<FeatureAuditEvent>> AuditAsync(string firmId, string branchId, CancellationToken cancellationToken);
    Task<FeatureCommandResult> SetDesiredAsync(string firmId, string branchId, string key,
        SetFeatureDesiredState command, string actor, CancellationToken cancellationToken);
    Task<bool> CanStartNewWorkAsync(string firmId, string branchId, string key, CancellationToken cancellationToken);
    Task<FeatureCommandResult> CompleteOneInFlightWorkAsync(string firmId, string branchId, string key,
        CancellationToken cancellationToken);
}
