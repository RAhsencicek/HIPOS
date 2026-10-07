namespace Hipos.Api.Features;

public static class FeatureRules
{
    public static FeatureCommandResult SetDesired(
        IReadOnlyDictionary<string, BranchFeatureState> states,
        string key,
        SetFeatureDesiredState command,
        bool realWorkAvailable = false)
    {
        var definition = FeatureCatalog.All.FirstOrDefault(item => item.Key == key);
        if (definition is null || !states.TryGetValue(key, out var current))
            return FeatureCommandResult.Rejected("FEATURE_NOT_FOUND", 404, "Özellik bulunamadı.");
        if (command.ExpectedVersion != current.Version)
            return FeatureCommandResult.Rejected("VERSION_CONFLICT", 409, "Ayar başka bir işlemle değişti. Güncel durumu yeniden yükleyin.");
        if (current.Lifecycle == "draining")
            return FeatureCommandResult.Rejected("FEATURE_DRAINING", 409, "Devam eden işler bitmeden bu ayar değiştirilemez.");
        if (current.DesiredEnabled == command.DesiredEnabled)
            return FeatureCommandResult.Success(current);

        if (command.DesiredEnabled)
        {
            var missing = definition.Dependencies.Where(dependency =>
                !states.TryGetValue(dependency, out var state) ||
                !state.DesiredEnabled || state.Lifecycle != "ready").ToArray();
            if (missing.Length > 0)
                return FeatureCommandResult.Rejected("DEPENDENCY_NOT_READY", 409,
                    $"Önce şu bağımlılıkları açın: {string.Join(", ", missing)}.");
        }
        else
        {
            var dependents = FeatureCatalog.All.Where(item =>
                item.Dependencies.Contains(key) &&
                states.TryGetValue(item.Key, out var state) && state.DesiredEnabled).Select(item => item.Name).ToArray();
            if (dependents.Length > 0)
                return FeatureCommandResult.Rejected("DEPENDENT_ACTIVE", 409,
                    $"Önce bağlı özellikleri kapatın: {string.Join(", ", dependents)}.");
        }

        var lifecycle = command.DesiredEnabled
            ? definition.SetupRequirements?.Count > 0 ? "setup_required" :
                definition.ProviderRequired ? "provider_pending" : "ready"
            : current.InFlightWorkCount > 0 ? "draining" : "disabled";
        return FeatureCommandResult.Success(current with
        {
            DesiredEnabled = command.DesiredEnabled,
            EffectiveForNewWork = command.DesiredEnabled && lifecycle == "ready" &&
                definition.Availability is ("real" or "backend_preview") && realWorkAvailable,
            Lifecycle = lifecycle,
            Blockers = Blockers(definition, lifecycle),
            Version = current.Version + 1,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
    }

    public static FeatureCommandResult CompleteOne(BranchFeatureState? current)
    {
        if (current is null)
            return FeatureCommandResult.Rejected("FEATURE_NOT_FOUND", 404, "Özellik bulunamadı.");
        if (current.InFlightWorkCount <= 0)
            return FeatureCommandResult.Rejected("NO_IN_FLIGHT_WORK", 409, "Tamamlanacak devam eden iş yok.");
        var remaining = current.InFlightWorkCount - 1;
        return FeatureCommandResult.Success(current with
        {
            InFlightWorkCount = remaining,
            Lifecycle = !current.DesiredEnabled && remaining == 0 ? "disabled" : current.Lifecycle,
            Version = current.Version + 1,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
    }

    public static IReadOnlyList<FeatureBlocker> Blockers(FeatureDefinition definition, string lifecycle) =>
        lifecycle switch
        {
            "setup_required" => definition.SetupRequirements?.Select(message =>
                new FeatureBlocker("SETUP_REQUIRED", message)).ToArray() ?? [],
            "provider_pending" => [new FeatureBlocker("PROVIDER_PENDING", "Sağlayıcı bağlantısı bekleniyor.")],
            _ => [],
        };
}
