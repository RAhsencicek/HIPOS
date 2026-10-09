using Microsoft.EntityFrameworkCore;
using Hipos.Api.Inventory;

namespace Hipos.Api.Features;

public sealed class PostgresFeatureStore(FeatureDbContext db, InventoryDbContext inventoryDb,
    FeatureRuntimeCapabilities runtime) : IFeatureStore
{
    public async Task<IReadOnlyList<BranchFeatureState>> ListAsync(
        string firmId, string branchId, CancellationToken cancellationToken)
    {
        var rows = await db.BranchFeatureStates.AsNoTracking()
            .Where(row => row.FirmId == firmId && row.BranchId == branchId)
            .ToListAsync(cancellationToken);
        var byKey = rows.ToDictionary(row => row.Key);
        return FeatureCatalog.All.Where(definition => byKey.ContainsKey(definition.Key))
            .Select(definition =>
            {
                var state = byKey[definition.Key].ToState();
                return IsCariFeature(definition.Key) && !runtime.CariReady
                    ? state with { EffectiveForNewWork = false, Lifecycle = "setup_required",
                        Blockers = [new FeatureBlocker("CARI_STORAGE_UNAVAILABLE", "Cari hareket defteri migration'ı uygulanmalı.")] }
                    : state;
            }).ToArray();
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
        if (IsCatalogWrite(key) && command.DesiredEnabled && !runtime.CatalogDraftsReady)
            return FeatureCommandResult.Rejected("CATALOG_STORAGE_UNAVAILABLE", 503,
                "Ürün taslağı için katalog migration'ı gerekli.");
        if (key == "sales.pos_orders" && command.DesiredEnabled && !runtime.SalesOrdersReady)
            return FeatureCommandResult.Rejected("SALES_STORAGE_UNAVAILABLE", 503,
                "Test POS siparişi için satış migration'ı gerekli.");
        if (key == "payments.simulator" && command.DesiredEnabled && !runtime.PaymentSimulatorReady)
            return FeatureCommandResult.Rejected("PAYMENT_STORAGE_UNAVAILABLE", 503,
                "Test ödeme için satış migration'ı gerekli.");
        if (key is "branches.tables" or "service.waiters" or "staff.records" && command.DesiredEnabled && !runtime.ServiceTablesReady)
            return FeatureCommandResult.Rejected("SERVICE_STORAGE_UNAVAILABLE", 503,
                "Masa/garson servisi için service migration'ı gerekli.");
        if (IsInventoryFeature(key) && command.DesiredEnabled && !runtime.InventoryReady)
            return FeatureCommandResult.Rejected("INVENTORY_STORAGE_UNAVAILABLE", 503,
                "Stok/reçete/sayım için inventory migration'ı gerekli.");
        if (IsCariFeature(key) && command.DesiredEnabled && !runtime.CariReady)
            return FeatureCommandResult.Rejected("CARI_STORAGE_UNAVAILABLE", 503,
                "Cari hareket defteri migration'ı gerekli.");
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        // Bütün şube satırları kilitlenir: bağımlılık kontrolü ile yazma tek atomik işlem olur.
        var rows = await db.BranchFeatureStates.FromSqlInterpolated(
            $"SELECT * FROM modules.branch_feature_states WHERE firm_id = {firmId} AND branch_id = {branchId} ORDER BY feature_key FOR UPDATE")
            .ToListAsync(cancellationToken);
        if (!command.DesiredEnabled && (key is "inventory.items" or "inventory.counts") &&
            await inventoryDb.Counts.AsNoTracking().AnyAsync(row => row.FirmId == firmId && row.BranchId == branchId && row.Status == "draft", cancellationToken))
            return FeatureCommandResult.Rejected("INVENTORY_COUNT_OPEN", 409,
                "Depoda açık sayım/onay bekliyor. Sayımı onaylayın veya iptal edin; sonra modülü kapatabilirsiniz.");
        var currentKeys = FeatureCatalog.All.Select(definition => definition.Key).ToHashSet(StringComparer.Ordinal);
        var states = rows.Where(row => currentKeys.Contains(row.Key))
            .ToDictionary(row => row.Key, row => row.ToState());
        var result = FeatureRules.SetDesired(states, key, command,
            (IsCatalogWrite(key) && runtime.CatalogDraftsReady) ||
            (key == "sales.pos_orders" && runtime.SalesOrdersReady) ||
            (key == "payments.simulator" && runtime.PaymentSimulatorReady) ||
            (key is "branches.tables" or "service.waiters" or "staff.records" && runtime.ServiceTablesReady) ||
            (IsInventoryFeature(key) && runtime.InventoryReady) ||
            (IsCariFeature(key) && runtime.CariReady));
        if (result.Failure is not null || result.State is null) return result;
        var next = result.State;
        if (next.Version == states[key].Version) return result; // Aynı tercih tekrarlandı: audit veya yazma yok.

        rows.First(row => row.Key == key).Apply(next);
        db.FeatureAudit.Add(new FeatureAuditRow
        {
            FirmId = firmId, BranchId = branchId, FeatureKey = key, Actor = actor,
            DesiredEnabled = next.DesiredEnabled, Version = next.Version, OccurredAt = next.UpdatedAt,
        });
        if (!next.DesiredEnabled)
        foreach (var dependent in FeatureRules.AutoDisabledDependents(states, key))
        {
            rows.First(row => row.Key == dependent.Key).Apply(dependent);
            db.FeatureAudit.Add(new FeatureAuditRow
            {
                FirmId = firmId, BranchId = branchId, FeatureKey = dependent.Key,
                Actor = $"{actor}:dependency:{key}", DesiredEnabled = false,
                Version = dependent.Version, OccurredAt = dependent.UpdatedAt,
            });
        }
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
            (!IsCatalogWrite(key) || runtime.CatalogDraftsReady) &&
            (key != "sales.pos_orders" || runtime.SalesOrdersReady) &&
            (key != "payments.simulator" || runtime.PaymentSimulatorReady) &&
            (key != "branches.tables" && key != "service.waiters" && key != "staff.records" || runtime.ServiceTablesReady) &&
            (!IsInventoryFeature(key) || runtime.InventoryReady) &&
            (!IsCariFeature(key) || runtime.CariReady),
            cancellationToken);

    private static bool IsCatalogWrite(string key) =>
        key is "catalog.drafts" or "catalog.price_drafts" or "catalog.publishing" or "catalog.menus";

    private static bool IsInventoryFeature(string key) =>
        key is "inventory.items" or "inventory.recipes" or "inventory.counts";

    private static bool IsCariFeature(string key) => key == "cari.management";

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
    public static async Task PromoteCariAsync(FeatureDbContext db, CancellationToken cancellationToken)
    {
        var rows = await db.BranchFeatureStates.Where(row =>
            row.Key == "cari.management" && row.DesiredEnabled &&
            row.Lifecycle == "ready" && !row.EffectiveForNewWork).ToListAsync(cancellationToken);
        foreach (var row in rows)
        {
            row.EffectiveForNewWork = true;
            row.Version++;
            row.UpdatedAt = DateTimeOffset.UtcNow;
            db.FeatureAudit.Add(new FeatureAuditRow
            {
                FirmId = row.FirmId, BranchId = row.BranchId, FeatureKey = row.Key,
                Actor = "system:cari-ready", DesiredEnabled = true,
                Version = row.Version, OccurredAt = row.UpdatedAt,
            });
        }
        if (rows.Count > 0) await db.SaveChangesAsync(cancellationToken);
    }

    public static async Task PromoteServiceTablesAsync(FeatureDbContext db, CancellationToken cancellationToken)
    {
        var rows = await db.BranchFeatureStates.Where(row => (row.Key == "branches.tables" || row.Key == "staff.records") &&
            row.DesiredEnabled && row.Lifecycle == "ready" && !row.EffectiveForNewWork)
            .ToListAsync(cancellationToken);
        foreach (var row in rows)
        {
            row.EffectiveForNewWork = true;
            row.Version++;
            row.UpdatedAt = DateTimeOffset.UtcNow;
            db.FeatureAudit.Add(new FeatureAuditRow
            {
                FirmId = row.FirmId, BranchId = row.BranchId, FeatureKey = row.Key,
                Actor = "system:service-ready", DesiredEnabled = true,
                Version = row.Version, OccurredAt = row.UpdatedAt,
            });
        }
        if (rows.Count > 0) await db.SaveChangesAsync(cancellationToken);
    }

    public static async Task EnsureDemoSeedAsync(FeatureDbContext db, CancellationToken cancellationToken)
    {
        if ((await db.Database.GetPendingMigrationsAsync(cancellationToken)).Any())
            throw new InvalidOperationException("Modül veritabanı şeması güncel değil. Önce 'dotnet ef database update' çalıştırın.");
        await MigrateCariCapabilitiesAsync(db, cancellationToken);
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

    private static async Task MigrateCariCapabilitiesAsync(FeatureDbContext db, CancellationToken cancellationToken)
    {
        await db.Database.ExecuteSqlRawAsync("""
            WITH migrated AS (
                INSERT INTO modules.branch_feature_states
                    (firm_id, branch_id, feature_key, desired_enabled, effective_for_new_work,
                     lifecycle, in_flight_work_count, version, updated_at)
                SELECT firm_id, branch_id, 'cari.management',
                       bool_or(desired_enabled),
                       bool_or(desired_enabled AND effective_for_new_work AND lifecycle = 'ready'),
                       CASE WHEN bool_or(desired_enabled) THEN 'ready' ELSE 'disabled' END,
                       0, 1, max(updated_at)
                FROM modules.branch_feature_states
                WHERE feature_key IN ('cari.customers', 'cari.suppliers')
                GROUP BY firm_id, branch_id
                ON CONFLICT (firm_id, branch_id, feature_key) DO NOTHING
                RETURNING firm_id, branch_id, desired_enabled, version, updated_at
            )
            INSERT INTO modules.feature_audit
                (firm_id, branch_id, feature_key, actor, desired_enabled, version, occurred_at)
            SELECT firm_id, branch_id, 'cari.management', 'system:cari-capability-migration',
                   desired_enabled, version, updated_at
            FROM migrated
            """, cancellationToken);
    }
}
