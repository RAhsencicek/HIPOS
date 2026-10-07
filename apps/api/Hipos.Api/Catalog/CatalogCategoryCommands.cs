using Hipos.Api.Features;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Hipos.Api.Catalog;

public sealed record CreateCatalogCategory(string Id, string Name);
public sealed record RenameCatalogCategory(string Name, int ExpectedVersion);
public sealed record CatalogCategoryState(string Id, string Name, int Version, bool IsActive, int SortOrder);
public sealed record CatalogCategoryCommandResult(CatalogCategoryState? Category, FeatureFailure? Failure, bool Created)
{
    public static CatalogCategoryCommandResult Rejected(string code, int status, string message) =>
        new(null, new FeatureFailure(code, status, message), false);
}

public sealed class CatalogCategoryCommands(CatalogDbContext db)
{
    public async Task<CatalogCategoryCommandResult> CreateAsync(
        string firmId, CreateCatalogCategory command, string actor, CancellationToken cancellationToken)
    {
        var id = command.Id?.Trim().ToLowerInvariant() ?? "";
        var name = command.Name?.Trim() ?? "";
        if (id.Length is < 1 or > 80 || name.Length is < 1 or > 160)
            return CatalogCategoryCommandResult.Rejected("INVALID_CATEGORY", 400, "Kategori kimliği veya adı geçersiz.");
        var existing = await db.Categories.AsNoTracking().FirstOrDefaultAsync(
            row => row.FirmId == firmId && row.Id == id, cancellationToken);
        if (existing is not null)
            return existing.Name == name
                ? new CatalogCategoryCommandResult(ToState(existing), null, false)
                : CatalogCategoryCommandResult.Rejected("CATEGORY_EXISTS", 409, "Bu kategori kimliği farklı bir adla kullanılıyor.");

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var category = new CatalogCategoryRow
        {
            FirmId = firmId, Id = id, Name = name, IsActive = true,
            Version = 1, SortOrder = 0, UpdatedAt = now,
        };
        db.Categories.Add(category);
        db.CategoryAudit.Add(new CatalogCategoryAuditRow
        {
            FirmId = firmId, CategoryId = id, Actor = actor, Action = "created",
            NewName = name, Version = 1, OccurredAt = now,
        });
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException error) when (error.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return CatalogCategoryCommandResult.Rejected("CATEGORY_EXISTS", 409, "Kategori kimliği zaten kullanılıyor.");
        }
        return new CatalogCategoryCommandResult(ToState(category), null, true);
    }

    public async Task<CatalogCategoryCommandResult> RenameAsync(
        string firmId, string categoryId, RenameCatalogCategory command, string actor,
        CancellationToken cancellationToken)
    {
        var name = command.Name?.Trim() ?? "";
        if (name.Length is < 1 or > 160)
            return CatalogCategoryCommandResult.Rejected("INVALID_CATEGORY", 400, "Kategori adı geçersiz.");
        if (command.ExpectedVersion < 1)
            return CatalogCategoryCommandResult.Rejected("INVALID_VERSION", 400, "expectedVersion pozitif olmalı.");

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var category = await db.Categories.FromSqlInterpolated(
            $"SELECT * FROM catalog.categories WHERE firm_id = {firmId} AND id = {categoryId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);
        if (category is null)
            return CatalogCategoryCommandResult.Rejected("CATEGORY_NOT_FOUND", 404, "Kategori bulunamadı.");
        if (category.Version != command.ExpectedVersion)
            return CatalogCategoryCommandResult.Rejected("VERSION_CONFLICT", 409, "Kategori başka bir işlemle değişti.");
        if (category.Name == name)
            return new CatalogCategoryCommandResult(ToState(category), null, false);

        var oldName = category.Name;
        var now = DateTimeOffset.UtcNow;
        category.Name = name;
        category.Version++;
        category.UpdatedAt = now;
        var affectedDrafts = await db.Drafts.AsNoTracking()
            .Where(row => row.FirmId == firmId && row.CategoryId == categoryId)
            .Select(row => new { row.Id, row.BranchId, row.Version })
            .ToListAsync(cancellationToken);
        await db.Drafts.Where(row => row.FirmId == firmId && row.CategoryId == categoryId)
            .ExecuteUpdateAsync(update => update
                .SetProperty(row => row.CategoryName, name)
                .SetProperty(row => row.Version, row => row.Version + 1)
                .SetProperty(row => row.UpdatedAt, now), cancellationToken);
        await db.Products.Where(row => row.FirmId == firmId && row.CategoryId == categoryId)
            .ExecuteUpdateAsync(update => update
                .SetProperty(row => row.CategoryName, name)
                .SetProperty(row => row.Version, row => row.Version + 1)
                .SetProperty(row => row.UpdatedAt, now), cancellationToken);
        foreach (var draft in affectedDrafts)
            db.DraftAudit.Add(new CatalogDraftAuditRow
            {
                DraftId = draft.Id, FirmId = firmId, BranchId = draft.BranchId,
                Actor = actor, Action = "category_renamed", Version = draft.Version + 1, OccurredAt = now,
            });
        db.CategoryAudit.Add(new CatalogCategoryAuditRow
        {
            FirmId = firmId, CategoryId = categoryId, Actor = actor, Action = "renamed",
            OldName = oldName, NewName = name, Version = category.Version, OccurredAt = now,
        });
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new CatalogCategoryCommandResult(ToState(category), null, false);
    }

    private static CatalogCategoryState ToState(CatalogCategoryRow row) =>
        new(row.Id, row.Name, row.Version, row.IsActive, row.SortOrder);
}
