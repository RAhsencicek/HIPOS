using System.Data.Common;

namespace Hipos.Api.Features;

// Katalog komutu ile modül kapatma aynı şube satırında kilitlenir; karar ve yazma atomiktir.
public sealed class FeatureNewWorkGate
{
    public async Task<FeatureFailure?> CheckAndLockAsync(
        DbConnection connection, DbTransaction transaction,
        string firmId, string branchId, string featureKey,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            SELECT desired_enabled, effective_for_new_work, lifecycle
            FROM modules.branch_feature_states
            WHERE firm_id = @firm AND branch_id = @branch AND feature_key = @feature
            FOR UPDATE
            """;
        AddParameter(command, "firm", firmId);
        AddParameter(command, "branch", branchId);
        AddParameter(command, "feature", featureKey);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
            return new FeatureFailure("FEATURE_NOT_FOUND", 404, "Özellik bu şubede bulunamadı.");
        var desired = reader.GetBoolean(0);
        var effective = reader.GetBoolean(1);
        var lifecycle = reader.GetString(2);
        if (desired && effective && lifecycle == "ready") return null;
        return lifecycle switch
        {
            "setup_required" => new FeatureFailure("FEATURE_SETUP_REQUIRED", 409, "Özellik kurulumu tamamlanmadı."),
            "provider_pending" => new FeatureFailure("PROVIDER_PENDING", 503, "Özellik sağlayıcısı bekleniyor."),
            "draining" => new FeatureFailure("FEATURE_DRAINING", 409, "Yeni işler kapalı; devam eden işler tamamlanıyor."),
            _ => new FeatureFailure("FEATURE_DISABLED", 409, "Bu şubede yeni işlem kapalı."),
        };
    }

    private static void AddParameter(DbCommand command, string name, string value)
    {
        var parameter = command.CreateParameter();
        parameter.ParameterName = name;
        parameter.Value = value;
        command.Parameters.Add(parameter);
    }
}
