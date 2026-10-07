using Hipos.Api.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace Hipos.Api.Catalog;

public sealed record CreateProductDraft(
    Guid DraftId, string Name, string Sku, string CategoryId,
    string CategoryName, string Description);
public sealed record UpdateProductDraft(
    string Name, string Sku, string CategoryId,
    string CategoryName, string Description, int ExpectedVersion);
public sealed record CatalogDraftResult(CatalogProductDetail? Product, FeatureFailure? Failure, bool Created)
{
    public static CatalogDraftResult Rejected(string code, int status, string message) =>
        new(null, new FeatureFailure(code, status, message), false);
    public static CatalogDraftResult Success(CatalogProductDetail product, bool created) =>
        new(product, null, created);
}

public sealed class CatalogDraftCommands(
    CatalogDbContext db, CatalogQueries queries, FeatureNewWorkGate gate)
{
    public async Task<CatalogDraftResult> CreateAsync(
        string firmId, string branchId, CreateProductDraft command, string actor,
        CancellationToken cancellationToken)
    {
        if (command.DraftId == Guid.Empty)
            return CatalogDraftResult.Rejected("INVALID_DRAFT", 400, "draftId geçerli bir UUID olmalı.");
        var values = Normalize(command.Name, command.Sku, command.CategoryId,
            command.CategoryName, command.Description);
        if (values is null)
            return CatalogDraftResult.Rejected("INVALID_DRAFT", 400, "Taslak alanları eksik veya çok uzun.");
        var scope = new CatalogScope(firmId, branchId);
        var existing = await db.Drafts.AsNoTracking().FirstOrDefaultAsync(
            row => row.Id == command.DraftId, cancellationToken);
        if (existing is not null) return await ExistingResult(existing, values, scope, cancellationToken);

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(),
            transaction.GetDbTransaction(), firmId, branchId, "catalog.drafts", cancellationToken);
        if (blocked is not null) return new CatalogDraftResult(null, blocked, false);
        existing = await db.Drafts.AsNoTracking().FirstOrDefaultAsync(
            row => row.Id == command.DraftId, cancellationToken);
        if (existing is not null) return await ExistingResult(existing, values, scope, cancellationToken);
        var category = await LockCategoryAsync(firmId, values.CategoryId, cancellationToken);
        if (category is null)
            return CatalogDraftResult.Rejected("CATEGORY_NOT_FOUND", 409, "Kategori bulunamadı; listeyi yenileyin.");
        if (category.Name != values.CategoryName)
            return CatalogDraftResult.Rejected("CATEGORY_NAME_MISMATCH", 409, "Kategori adı değişti; listeyi yenileyin.");

        var now = DateTimeOffset.UtcNow;
        db.Drafts.Add(new CatalogDraftRow
        {
            Id = command.DraftId, FirmId = firmId, BranchId = branchId,
            Name = values.Name, Sku = values.Sku, CategoryId = values.CategoryId,
            CategoryName = values.CategoryName, Description = values.Description,
            Version = 1, UpdatedAt = now,
        });
        db.Products.Add(new CatalogProductRow
        {
            Id = command.DraftId, FirmId = firmId, BranchIds = [branchId],
            Name = values.Name, Sku = values.Sku, CategoryId = values.CategoryId,
            CategoryName = values.CategoryName, Description = values.Description,
            Status = "draft", Channels = [], Image = "", RecipeLinked = false,
            BasePriceMinor = 0, Currency = "TRY", Allergens = [], OptionGroups = [],
            Version = 1, UpdatedAt = now,
        });
        db.DraftAudit.Add(new CatalogDraftAuditRow
        {
            DraftId = command.DraftId, FirmId = firmId, BranchId = branchId,
            Actor = actor, Action = "created", Version = 1, OccurredAt = now,
        });
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException error) when (IsUniqueViolation(error))
        {
            return CatalogDraftResult.Rejected("DUPLICATE_DRAFT_OR_SKU", 409,
                "Taslak kimliği veya stok kodu zaten kullanılıyor.");
        }
        var product = await queries.GetAsync(scope, command.DraftId, cancellationToken);
        return product is null
            ? CatalogDraftResult.Rejected("DRAFT_INCONSISTENT", 503, "Taslak okunamadı.")
            : CatalogDraftResult.Success(product, true);
    }

    public async Task<CatalogDraftResult> UpdateAsync(
        string firmId, string branchId, Guid draftId, UpdateProductDraft command,
        string actor, CancellationToken cancellationToken)
    {
        if (command.ExpectedVersion < 1)
            return CatalogDraftResult.Rejected("INVALID_VERSION", 400, "expectedVersion pozitif olmalı.");
        var values = Normalize(command.Name, command.Sku, command.CategoryId,
            command.CategoryName, command.Description);
        if (values is null)
            return CatalogDraftResult.Rejected("INVALID_DRAFT", 400, "Taslak alanları eksik veya çok uzun.");
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(),
            transaction.GetDbTransaction(), firmId, branchId, "catalog.drafts", cancellationToken);
        if (blocked is not null) return new CatalogDraftResult(null, blocked, false);

        var category = await LockCategoryAsync(firmId, values.CategoryId, cancellationToken);
        if (category is null)
            return CatalogDraftResult.Rejected("CATEGORY_NOT_FOUND", 409, "Kategori bulunamadı; listeyi yenileyin.");

        var draft = await db.Drafts.FromSqlInterpolated(
            $"SELECT * FROM catalog.drafts WHERE id = {draftId} AND firm_id = {firmId} AND branch_id = {branchId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);
        if (draft is null)
            return CatalogDraftResult.Rejected("PRODUCT_NOT_FOUND", 404, "Taslak bu şubede bulunamadı.");
        if (draft.Version != command.ExpectedVersion)
            return CatalogDraftResult.Rejected("VERSION_CONFLICT", 409, "Taslak başka bir işlemle değişti.");
        if (category.Name != values.CategoryName)
            return CatalogDraftResult.Rejected("CATEGORY_NAME_MISMATCH", 409, "Kategori adı değişti; listeyi yenileyin.");
        if (Same(draft, values))
        {
            var unchanged = await queries.GetAsync(new CatalogScope(firmId, branchId), draftId, cancellationToken);
            return unchanged is null
                ? CatalogDraftResult.Rejected("DRAFT_INCONSISTENT", 503, "Taslak okunamadı.")
                : CatalogDraftResult.Success(unchanged, false);
        }

        var projection = await db.Products.SingleOrDefaultAsync(
            row => row.Id == draftId && row.FirmId == firmId && row.Status == "draft", cancellationToken);
        if (projection is null)
            return CatalogDraftResult.Rejected("DRAFT_INCONSISTENT", 503, "Taslak okuma kaydı eksik.");
        var now = DateTimeOffset.UtcNow;
        draft.Name = projection.Name = values.Name;
        draft.Sku = projection.Sku = values.Sku;
        draft.CategoryId = projection.CategoryId = values.CategoryId;
        draft.CategoryName = projection.CategoryName = values.CategoryName;
        draft.Description = projection.Description = values.Description;
        draft.Version++;
        projection.Version++;
        draft.UpdatedAt = projection.UpdatedAt = now;
        db.DraftAudit.Add(new CatalogDraftAuditRow
        {
            DraftId = draftId, FirmId = firmId, BranchId = branchId,
            Actor = actor, Action = "updated", Version = draft.Version, OccurredAt = now,
        });
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return CatalogDraftResult.Rejected("VERSION_CONFLICT", 409, "Taslak başka bir işlemle değişti.");
        }
        catch (DbUpdateException error) when (IsUniqueViolation(error))
        {
            return CatalogDraftResult.Rejected("DUPLICATE_SKU", 409, "Stok kodu zaten kullanılıyor.");
        }
        var product = await queries.GetAsync(new CatalogScope(firmId, branchId), draftId, cancellationToken);
        return product is null
            ? CatalogDraftResult.Rejected("DRAFT_INCONSISTENT", 503, "Taslak okunamadı.")
            : CatalogDraftResult.Success(product, false);
    }

    private async Task<CatalogDraftResult> ExistingResult(
        CatalogDraftRow existing, DraftValues values, CatalogScope scope,
        CancellationToken cancellationToken)
    {
        if (existing.FirmId != scope.FirmId || existing.BranchId != scope.BranchId || !Same(existing, values))
            return CatalogDraftResult.Rejected("DRAFT_ID_CONFLICT", 409, "Taslak kimliği başka bir kayıt için kullanılıyor.");
        var product = await queries.GetAsync(scope, existing.Id, cancellationToken);
        return product is null
            ? CatalogDraftResult.Rejected("DRAFT_INCONSISTENT", 503, "Taslak okunamadı.")
            : CatalogDraftResult.Success(product, false);
    }

    private sealed record DraftValues(string Name, string Sku, string CategoryId,
        string CategoryName, string Description);

    private static DraftValues? Normalize(string? name, string? sku,
        string? categoryId, string? categoryName, string? description)
    {
        var values = new DraftValues(name?.Trim() ?? "", sku?.Trim().ToUpperInvariant() ?? "",
            categoryId?.Trim().ToLowerInvariant() ?? "", categoryName?.Trim() ?? "",
            description?.Trim() ?? "");
        return values.Name.Length is < 1 or > 256 || values.Sku.Length is < 1 or > 80 ||
            values.CategoryId.Length is < 1 or > 80 || values.CategoryName.Length is < 1 or > 160 ||
            values.Description.Length > 4000 ? null : values;
    }

    private static bool Same(CatalogDraftRow row, DraftValues values) =>
        row.Name == values.Name && row.Sku == values.Sku &&
        row.CategoryId == values.CategoryId && row.CategoryName == values.CategoryName &&
        row.Description == values.Description;

    private static bool IsUniqueViolation(DbUpdateException error) =>
        error.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };

    private Task<CatalogCategoryRow?> LockCategoryAsync(
        string firmId, string categoryId, CancellationToken cancellationToken) =>
        db.Categories.FromSqlInterpolated(
            $"SELECT * FROM catalog.categories WHERE firm_id = {firmId} AND id = {categoryId} FOR SHARE")
            .AsNoTracking().SingleOrDefaultAsync(cancellationToken);
}
