using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Hipos.Api.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace Hipos.Api.Catalog;

public sealed record CreateCatalogOptionGroup(Guid RequestId, string Name, bool IsActive, int SortOrder);
public sealed record UpdateCatalogOptionGroup(Guid RequestId, string Name, bool IsActive,
    int SortOrder, int ExpectedVersion);
public sealed record CreateCatalogOptionItem(Guid RequestId, string Name, long PriceDeltaMinor,
    bool QuantityEnabled, int MaxQuantity, bool IsActive, int SortOrder, int ExpectedVersion);
public sealed record UpdateCatalogOptionItem(Guid RequestId, string Name, long PriceDeltaMinor,
    bool QuantityEnabled, int MaxQuantity, bool IsActive, int SortOrder, int ExpectedVersion);
public sealed record ProductOptionGroupInput(Guid GroupId, int MinSelections, int? MaxSelections, int SortOrder);
public sealed record SaveProductOptionGroups(Guid RequestId, int ExpectedVersion, ProductOptionGroupInput[] Items);
public sealed record CatalogOptionItemMutation(Guid GroupId, int GroupVersion, CatalogOptionItemInfo Item);
public sealed record CatalogOptionCommandResult(object? Value, FeatureFailure? Failure, bool Created)
{
    public static CatalogOptionCommandResult Rejected(string code, int status, string message) =>
        new(null, new FeatureFailure(code, status, message), false);
}

public sealed class CatalogOptionGroupCommands(CatalogDbContext db, CatalogQueries queries)
{
    private static readonly JsonSerializerOptions SnapshotJsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<CatalogOptionCommandResult> CreateGroupAsync(
        string firmId, CreateCatalogOptionGroup input, string actor, CancellationToken cancellationToken)
    {
        var name = NormalizeName(input.Name);
        if (input.RequestId == Guid.Empty || name is null || input.SortOrder < 0)
            return CatalogOptionCommandResult.Rejected("INVALID_OPTION_GROUP", 400, "İstek kimliği, grup adı veya sıralama geçersiz.");

        var normalizedInput = input with { Name = name };
        var fingerprint = Fingerprint(new { firmId, action = "create_group", input = normalizedInput });
        await using var tx = await db.Database.BeginTransactionAsync(cancellationToken);
        if (await ReplayAsync(input.RequestId, fingerprint, cancellationToken) is { } replay) return replay;
        var group = new CatalogOptionGroupRow
        {
            Id = input.RequestId, FirmId = firmId, Name = name, IsActive = input.IsActive,
            SortOrder = input.SortOrder, Version = 1, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.OptionGroups.Add(group);
        return await CommitAsync(tx, new CatalogOptionManagementAuditRow
        {
            RequestId = input.RequestId, FirmId = firmId, TargetType = "group", TargetId = group.Id,
            Actor = actor, Action = "created", Fingerprint = fingerprint, Version = 1,
            OccurredAt = DateTimeOffset.UtcNow,
        }, async () => await LoadGroupAsync(firmId, group.Id, cancellationToken), true, cancellationToken);
    }

    public async Task<CatalogOptionCommandResult> UpdateGroupAsync(
        string firmId, Guid groupId, UpdateCatalogOptionGroup input, string actor, CancellationToken cancellationToken)
    {
        var name = NormalizeName(input.Name);
        if (input.RequestId == Guid.Empty || input.ExpectedVersion < 1 || name is null || input.SortOrder < 0)
            return CatalogOptionCommandResult.Rejected("INVALID_OPTION_GROUP", 400, "İstek kimliği, grup alanları veya sürüm geçersiz.");
        var normalizedInput = input with { Name = name };
        var fingerprint = Fingerprint(new { firmId, groupId, action = "update_group", input = normalizedInput });
        await using var tx = await db.Database.BeginTransactionAsync(cancellationToken);
        if (await ReplayAsync(input.RequestId, fingerprint, cancellationToken) is { } replay) return replay;
        var group = await LockGroupAsync(firmId, groupId, cancellationToken);
        if (group is null) return CatalogOptionCommandResult.Rejected("OPTION_GROUP_NOT_FOUND", 404, "Seçenek grubu bulunamadı.");
        if (group.Version != input.ExpectedVersion)
            return CatalogOptionCommandResult.Rejected("VERSION_CONFLICT", 409, "Seçenek grubu başka bir işlemle değişti.");
        if (group.Name == name && group.IsActive == input.IsActive && group.SortOrder == input.SortOrder)
            return await CommitAsync(tx, Audit(input.RequestId, firmId, "group", groupId, actor,
                "unchanged", fingerprint, group.Version),
                async () => await LoadGroupAsync(firmId, groupId, cancellationToken), false, cancellationToken);

        group.Name = name; group.IsActive = input.IsActive; group.SortOrder = input.SortOrder;
        group.Version++; group.UpdatedAt = DateTimeOffset.UtcNow;
        return await CommitAsync(tx, Audit(input.RequestId, firmId, "group", groupId, actor, "updated", fingerprint, group.Version),
            async () => await LoadGroupAsync(firmId, groupId, cancellationToken), false, cancellationToken);
    }

    public async Task<CatalogOptionCommandResult> CreateItemAsync(
        string firmId, Guid groupId, CreateCatalogOptionItem input, string actor, CancellationToken cancellationToken)
    {
        var name = NormalizeName(input.Name);
        if (input.RequestId == Guid.Empty || input.ExpectedVersion < 1 || name is null ||
            !ValidQuantity(input.QuantityEnabled, input.MaxQuantity) || input.SortOrder < 0)
            return CatalogOptionCommandResult.Rejected("INVALID_OPTION_ITEM", 400, "İstek kimliği, seçenek alanları, adet sınırı veya sürüm geçersiz.");
        var normalizedInput = input with { Name = name };
        var fingerprint = Fingerprint(new { firmId, groupId, action = "create_item", input = normalizedInput });
        await using var tx = await db.Database.BeginTransactionAsync(cancellationToken);
        if (await ReplayAsync(input.RequestId, fingerprint, cancellationToken) is { } replay) return replay;
        var group = await LockGroupAsync(firmId, groupId, cancellationToken);
        if (group is null) return CatalogOptionCommandResult.Rejected("OPTION_GROUP_NOT_FOUND", 404, "Seçenek grubu bulunamadı.");
        if (group.Version != input.ExpectedVersion)
            return CatalogOptionCommandResult.Rejected("VERSION_CONFLICT", 409, "Seçenek grubu başka bir işlemle değişti.");
        var item = new CatalogOptionItemRow
        {
            Id = input.RequestId, GroupId = groupId, Name = name, PriceDeltaMinor = input.PriceDeltaMinor,
            QuantityEnabled = input.QuantityEnabled, MaxQuantity = input.MaxQuantity, IsActive = input.IsActive,
            SortOrder = input.SortOrder,
        };
        db.OptionItems.Add(item);
        group.Version++; group.UpdatedAt = DateTimeOffset.UtcNow;
        return await CommitAsync(tx, Audit(input.RequestId, firmId, "group", groupId, actor, "item_created", fingerprint, group.Version),
            async () => new CatalogOptionItemMutation(groupId, group.Version,
                await LoadItemInfoAsync(groupId, item.Id, cancellationToken)), true, cancellationToken);
    }

    public async Task<CatalogOptionCommandResult> UpdateItemAsync(
        string firmId, Guid groupId, Guid itemId, UpdateCatalogOptionItem input,
        string actor, CancellationToken cancellationToken)
    {
        var name = NormalizeName(input.Name);
        if (input.RequestId == Guid.Empty || input.ExpectedVersion < 1 || name is null ||
            !ValidQuantity(input.QuantityEnabled, input.MaxQuantity) || input.SortOrder < 0)
            return CatalogOptionCommandResult.Rejected("INVALID_OPTION_ITEM", 400, "İstek kimliği, seçenek alanları, adet sınırı veya sürüm geçersiz.");
        var normalizedInput = input with { Name = name };
        var fingerprint = Fingerprint(new { firmId, groupId, itemId, action = "update_item", input = normalizedInput });
        await using var tx = await db.Database.BeginTransactionAsync(cancellationToken);
        if (await ReplayAsync(input.RequestId, fingerprint, cancellationToken) is { } replay) return replay;
        var group = await LockGroupAsync(firmId, groupId, cancellationToken);
        if (group is null) return CatalogOptionCommandResult.Rejected("OPTION_GROUP_NOT_FOUND", 404, "Seçenek grubu bulunamadı.");
        if (group.Version != input.ExpectedVersion)
            return CatalogOptionCommandResult.Rejected("VERSION_CONFLICT", 409, "Seçenek grubu başka bir işlemle değişti.");
        var item = await db.OptionItems.SingleOrDefaultAsync(row => row.Id == itemId && row.GroupId == groupId, cancellationToken);
        if (item is null) return CatalogOptionCommandResult.Rejected("OPTION_ITEM_NOT_FOUND", 404, "Seçenek bulunamadı.");
        if (item.Name == name && item.PriceDeltaMinor == input.PriceDeltaMinor &&
            item.QuantityEnabled == input.QuantityEnabled && item.MaxQuantity == input.MaxQuantity &&
            item.IsActive == input.IsActive && item.SortOrder == input.SortOrder)
            return await CommitAsync(tx, Audit(input.RequestId, firmId, "group", groupId, actor,
                "item_unchanged", fingerprint, group.Version),
                async () => new CatalogOptionItemMutation(groupId, group.Version,
                    CatalogQueries.ToOptionItemInfo(item)), false, cancellationToken);

        item.Name = name; item.PriceDeltaMinor = input.PriceDeltaMinor;
        item.QuantityEnabled = input.QuantityEnabled; item.MaxQuantity = input.MaxQuantity;
        item.IsActive = input.IsActive; item.SortOrder = input.SortOrder;
        group.Version++; group.UpdatedAt = DateTimeOffset.UtcNow;
        return await CommitAsync(tx, Audit(input.RequestId, firmId, "group", groupId, actor, "item_updated", fingerprint, group.Version),
            async () => new CatalogOptionItemMutation(groupId, group.Version,
                await LoadItemInfoAsync(groupId, itemId, cancellationToken)), false, cancellationToken);
    }

    public async Task<CatalogOptionCommandResult> SaveProductGroupsAsync(
        string firmId, Guid productId, SaveProductOptionGroups input, string actor, CancellationToken cancellationToken)
    {
        if (input.RequestId == Guid.Empty || input.ExpectedVersion < 1 || input.Items is null || input.Items.Length > 100 ||
            input.Items.Any(item => item is null || item.GroupId == Guid.Empty || item.MinSelections < 0 ||
                item.MaxSelections is { } max && max < item.MinSelections || item.SortOrder < 0) ||
            input.Items.Select(item => item.GroupId).Distinct().Count() != input.Items.Length ||
            input.Items.Select(item => item.SortOrder).Distinct().Count() != input.Items.Length)
            return CatalogOptionCommandResult.Rejected("INVALID_PRODUCT_OPTION_GROUPS", 400, "Ürün seçenek grupları veya seçim sınırları geçersiz.");

        var fingerprint = Fingerprint(new { firmId, productId, action = "save_product_groups", input });
        await using var tx = await db.Database.BeginTransactionAsync(cancellationToken);
        if (await ReplayAsync(input.RequestId, fingerprint, cancellationToken) is { } replay) return replay;
        var product = await db.Products.FromSqlInterpolated(
            $"SELECT * FROM catalog.products WHERE id = {productId} AND firm_id = {firmId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);
        if (product is null) return CatalogOptionCommandResult.Rejected("PRODUCT_NOT_FOUND", 404, "Ürün bulunamadı.");
        if (product.Version != input.ExpectedVersion)
            return CatalogOptionCommandResult.Rejected("VERSION_CONFLICT", 409, "Ürün başka bir işlemle değişti.");

        var groupIds = input.Items.Select(item => item.GroupId).ToArray();
        var groups = await db.OptionGroups.Where(row => row.FirmId == firmId && groupIds.Contains(row.Id))
            .ToDictionaryAsync(row => row.Id, cancellationToken);
        if (groups.Count != groupIds.Length)
            return CatalogOptionCommandResult.Rejected("OPTION_GROUP_NOT_FOUND", 409, "Gruplardan biri bu firmada bulunamadı.");
        var optionCounts = await db.OptionItems.Where(row => groupIds.Contains(row.GroupId))
            .GroupBy(row => row.GroupId).Select(group => new { GroupId = group.Key, Count = group.Count() })
            .ToDictionaryAsync(row => row.GroupId, row => row.Count, cancellationToken);
        if (input.Items.Any(item => item.MinSelections > optionCounts.GetValueOrDefault(item.GroupId)))
            return CatalogOptionCommandResult.Rejected("INVALID_SELECTION_LIMIT", 400, "Grubun zorunlu seçim sayısı seçenek sayısından fazla olamaz.");

        var existingLinks = await db.ProductOptionGroups.Where(row => row.ProductId == productId)
            .OrderBy(row => row.SortOrder).ThenBy(row => row.OptionGroupId).ToListAsync(cancellationToken);
        var same = existingLinks.Count == input.Items.Length && existingLinks.Zip(input.Items.OrderBy(item => item.SortOrder))
            .All(pair => pair.First.OptionGroupId == pair.Second.GroupId &&
                pair.First.MinSelections == pair.Second.MinSelections && pair.First.MaxSelections == pair.Second.MaxSelections &&
                pair.First.SortOrder == pair.Second.SortOrder);
        if (same)
            return await CommitAsync(tx, Audit(input.RequestId, firmId, "product_groups", productId, actor,
                "unchanged", fingerprint, product.Version),
                async () => await queries.GetProductOptionGroupsAsync(firmId, productId, cancellationToken),
                false, cancellationToken);

        await db.ProductOptionGroups.Where(row => row.ProductId == productId).ExecuteDeleteAsync(cancellationToken);
        db.ProductOptionGroups.AddRange(input.Items.Select(item => new CatalogProductOptionGroupRow
        {
            ProductId = productId, OptionGroupId = item.GroupId, MinSelections = item.MinSelections,
            MaxSelections = item.MaxSelections, SortOrder = item.SortOrder,
        }));
        product.Version++; product.UpdatedAt = DateTimeOffset.UtcNow;
        return await CommitAsync(tx, Audit(input.RequestId, firmId, "product_groups", productId, actor,
            "updated", fingerprint, product.Version),
            async () => await queries.GetProductOptionGroupsAsync(firmId, productId, cancellationToken),
            false, cancellationToken);
    }

    private async Task<CatalogOptionCommandResult?> ReplayAsync(
        Guid requestId, string fingerprint, CancellationToken cancellationToken)
    {
        var audit = await db.OptionManagementAudit.AsNoTracking()
            .SingleOrDefaultAsync(row => row.RequestId == requestId, cancellationToken);
        if (audit is null) return null;
        if (audit.Fingerprint != fingerprint)
            return CatalogOptionCommandResult.Rejected("REQUEST_ID_CONFLICT", 409, "Bu istek kimliği farklı içerikle kullanılmış.");
        using var document = JsonDocument.Parse(audit.SnapshotJson);
        return new CatalogOptionCommandResult(document.RootElement.Clone(), null, false);
    }

    private async Task<CatalogOptionCommandResult> CommitAsync(
        IDbContextTransaction tx, CatalogOptionManagementAuditRow audit,
        Func<Task<object?>> snapshot, bool created, CancellationToken cancellationToken)
    {
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            audit.SnapshotJson = JsonSerializer.Serialize(await snapshot(), SnapshotJsonOptions);
            db.OptionManagementAudit.Add(audit);
            await db.SaveChangesAsync(cancellationToken);
            await tx.CommitAsync(cancellationToken);
            return new CatalogOptionCommandResult(JsonDocument.Parse(audit.SnapshotJson).RootElement.Clone(), null, created);
        }
        catch (DbUpdateConcurrencyException)
        {
            return CatalogOptionCommandResult.Rejected("VERSION_CONFLICT", 409, "Kayıt başka bir işlemle değişti.");
        }
        catch (DbUpdateException error) when (error.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return CatalogOptionCommandResult.Rejected("REQUEST_ID_CONFLICT", 409, "İstek kimliği veya katalog kaydı çakışıyor.");
        }
    }

    private async Task<CatalogOptionGroupInfo?> LoadGroupAsync(
        string firmId, Guid groupId, CancellationToken cancellationToken)
    {
        var group = await db.OptionGroups.AsNoTracking()
            .SingleOrDefaultAsync(row => row.Id == groupId && row.FirmId == firmId, cancellationToken);
        if (group is null) return null;
        var items = await db.OptionItems.AsNoTracking().Where(row => row.GroupId == groupId)
            .OrderBy(row => row.SortOrder).ThenBy(row => row.Name).ThenBy(row => row.Id)
            .ToListAsync(cancellationToken);
        return CatalogQueries.ToOptionGroupInfo(group, items);
    }

    private async Task<CatalogOptionItemInfo> LoadItemInfoAsync(
        Guid groupId, Guid itemId, CancellationToken cancellationToken) =>
        CatalogQueries.ToOptionItemInfo(await db.OptionItems.AsNoTracking()
            .SingleAsync(row => row.GroupId == groupId && row.Id == itemId, cancellationToken));

    private Task<CatalogOptionGroupRow?> LockGroupAsync(
        string firmId, Guid groupId, CancellationToken cancellationToken) =>
        db.OptionGroups.FromSqlInterpolated(
            $"SELECT * FROM catalog.option_groups WHERE firm_id = {firmId} AND id = {groupId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);

    private static CatalogOptionManagementAuditRow Audit(
        Guid requestId, string firmId, string targetType, Guid targetId, string actor,
        string action, string fingerprint, int version) => new()
    {
        RequestId = requestId, FirmId = firmId, TargetType = targetType, TargetId = targetId,
        Actor = actor, Action = action, Fingerprint = fingerprint, Version = version,
        OccurredAt = DateTimeOffset.UtcNow,
    };

    private static string? NormalizeName(string? value)
    {
        var name = value?.Trim() ?? "";
        return name.Length is < 1 or > 100 ? null : name;
    }

    private static bool ValidQuantity(bool enabled, int maximum) => maximum >= 1 && (enabled || maximum == 1);

    private static string Fingerprint(object value) => Convert.ToHexString(
        SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value))));
}
