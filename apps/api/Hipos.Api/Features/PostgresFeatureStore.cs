using Microsoft.EntityFrameworkCore;

namespace Hipos.Api.Features;

public sealed class PostgresFeatureStore(FeatureDbContext db, FeatureRuntimeCapabilities runtime) : IFeatureStore
{
    public async Task<IReadOnlyList<BranchFeatureState>> ListAsync(
        string firmId, string branchId, CancellationToken cancellationToken)
    {
        var rows = await db.BranchFeatureStates.AsNoTracking()
            .Where(row => row.FirmId == firmId && row.BranchId == branchId)
            .ToListAsync(cancellationToken);
        var byKey = rows.ToDictionary(row => row.Key);
        return FeatureCatalog.All.Where(definition => byKey.ContainsKey(definition.Key))
            .Select(definition => byKey[definition.Key].ToState()).ToArray();
    }

    public async Task<IReadOnlyList<FeatureAuditEvent>> AuditAsync(
        string firmId, string branchId, CancellationToken cancellationToken) =>
        (await db.FeatureAudit.AsNoTracking()
            .Where(row => row.FirmId == firmId && row.BranchId == branchId)
            .OrderBy(row => row.Id).ToListAsync(cancellationToken))
            .Select(row => row.ToEvent()).ToArray();

    public async Task<FeatureCommandResult> SetDesiredAsync(
        string firmId, string branchId, string key, SetFeatureDesiredState command,
        string actor, CancellationToken cancellationToken)
    {
        if (key == "catalog.drafts" && command.DesiredEnabled && !runtime.CatalogDraftsReady)
            return FeatureCommandResult.Rejected("CATALOG_STORAGE_UNAVAILABLE", 503,
                "Ürün taslağı için katalog migration'ı gerekli.");
        if (key == "sales.pos_orders" && command.DesiredEnabled && !runtime.SalesOrdersReady)
            return FeatureCommandResult.Rejected("SALES_STORAGE_UNAVAILABLE", 503,
                "Test POS siparişi için satış migration'ı gerekli.");
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        // Bütün şube satırları kilitlenir: bağımlılık kontrolü ile yazma tek atomik işlem olur.
        var rows = await db.BranchFeatureStates.FromSqlInterpolated(
            $"SELECT * FROM modules.branch_feature_states WHERE firm_id = {firmId} AND branch_id = {branchId} ORDER BY feature_key FOR UPDATE")
            .ToListAsync(cancellationToken);
        var states = rows.ToDictionary(row => row.Key, row => row.ToState());
        var result = FeatureRules.SetDesired(states, key, command,
            (key == "catalog.drafts" && runtime.CatalogDraftsReady) ||
            (key == "sales.pos_orders" && runtime.SalesOrdersReady));
        if (result.Failure is not null || result.State is null) return result;
        var next = result.State;
        if (next.Version == states[key].Version) return result; // Aynı tercih tekrarlandı: audit veya yazma yok.

        rows.First(row => row.Key == key).Apply(next);
        db.FeatureAudit.Add(new FeatureAuditRow
        {
            FirmId = firmId, BranchId = branchId, FeatureKey = key, Actor = actor,
            DesiredEnabled = next.DesiredEnabled, Version = next.Version, OccurredAt = next.UpdatedAt,
        });
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return FeatureCommandResult.Success(next);
        }
        catch (DbUpdateConcurrencyException)
        {
            return FeatureCommandResult.Rejected("VERSION_CONFLICT", 409, "Ayar başka bir işlemle değişti. Güncel durumu yeniden yükleyin.");
        }
    }

    public Task<bool> CanStartNewWorkAsync(
        string firmId, string branchId, string key, CancellationToken cancellationToken) =>
        db.BranchFeatureStates.AsNoTracking().AnyAsync(row =>
            row.FirmId == firmId && row.BranchId == branchId && row.Key == key && row.EffectiveForNewWork &&
            (key != "catalog.drafts" || runtime.CatalogDraftsReady) &&
            (key != "sales.pos_orders" || runtime.SalesOrdersReady),
            cancellationToken);

    public async Task<FeatureCommandResult> CompleteOneInFlightWorkAsync(
        string firmId, string branchId, string key, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var row = await db.BranchFeatureStates.FromSqlInterpolated(
            $"SELECT * FROM modules.branch_feature_states WHERE firm_id = {firmId} AND branch_id = {branchId} AND feature_key = {key} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);
        var result = FeatureRules.CompleteOne(row?.ToState());
        if (result.Failure is not null || result.State is null) return result;
        row!.Apply(result.State);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return result;
        }
        catch (DbUpdateConcurrencyException)
        {
            return FeatureCommandResult.Rejected("VERSION_CONFLICT", 409, "Ayar başka bir işlemle değişti. Güncel durumu yeniden yükleyin.");
        }
    }
}

public static class FeatureDbInitializer
{
    public static async Task EnsureDemoSeedAsync(FeatureDbContext db, CancellationToken cancellationToken)
    {
        if ((await db.Database.GetPendingMigrationsAsync(cancellationToken)).Any())
            throw new InvalidOperationException("Modül veritabanı şeması güncel değil. Önce 'dotnet ef database update' çalıştırın.");
        var demo = new InMemoryFeatureStore();
        var branches = new (string FirmId, string BranchId)[]
        {
            (InMemoryFeatureStore.SingleFirm, InMemoryFeatureStore.SingleBranch),
            (InMemoryFeatureStore.MultiFirm, InMemoryFeatureStore.ModaBranch),
            (InMemoryFeatureStore.MultiFirm, InMemoryFeatureStore.BesiktasBranch),
            (InMemoryFeatureStore.MultiFirm, InMemoryFeatureStore.AtasehirBranch),
        };
        // Yeni katalog özelliği eklenirse yalnız eksik demo satırları eklenir;
        // mevcut tercih, sürüm ve denetim kayıtları asla sıfırlanmaz.
        foreach (var (firmId, branchId) in branches)
        foreach (var state in demo.List(firmId, branchId))
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO modules.branch_feature_states
                    (firm_id, branch_id, feature_key, desired_enabled, effective_for_new_work,
                     lifecycle, in_flight_work_count, version, updated_at)
                VALUES ({state.FirmId}, {state.BranchId}, {state.Key}, {state.DesiredEnabled},
                        {state.EffectiveForNewWork}, {state.Lifecycle}, {state.InFlightWorkCount},
                        {state.Version}, {state.UpdatedAt})
                ON CONFLICT (firm_id, branch_id, feature_key) DO NOTHING
                """, cancellationToken);
    }
}
