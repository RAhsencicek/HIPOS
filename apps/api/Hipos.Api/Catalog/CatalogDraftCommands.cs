using Hipos.Api.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Hipos.Api.Catalog;

public sealed record CreateProductDraft(
    Guid DraftId, string Name, string Sku, string CategoryId,
    string CategoryName, string Description);
public sealed record CreatePricedProduct(
    Guid DraftId, Guid PriceVersionId, string Name, string Sku, string CategoryId,
    string CategoryName, string Description, long AmountMinor, string[]? Allergens = null);
public sealed record UpdateProductDraft(
    string Name, string Sku, string CategoryId,
    string CategoryName, string Description, int ExpectedVersion, string[]? Allergens = null);
public sealed record UpdatePublishedProduct(Guid RequestId, string Name, string Sku, string CategoryId,
    string CategoryName, string Description, int ExpectedVersion, string[]? Allergens = null);
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
    public async Task<CatalogDraftResult> UpdatePublishedAsync(
        string firmId, string branchId, Guid productId, UpdatePublishedProduct command, string actor, CancellationToken cancellationToken)
    {
        var values = Normalize(command.Name, command.Sku, command.CategoryId, command.CategoryName, command.Description);
        var allergens = NormalizeAllergens(command.Allergens);
        if (command.RequestId == Guid.Empty || command.ExpectedVersion < 1 || values is null || command.Allergens is not null && allergens is null)
            return CatalogDraftResult.Rejected("INVALID_DRAFT", 400, "Ürün bilgileri veya sürümü geçersiz.");
        var jsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var fingerprint = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
            JsonSerializer.Serialize(new { firmId, branchId, productId, command.RequestId, command.ExpectedVersion, values, allergens }, jsonOptions))));

        async Task<CatalogDraftResult?> ReplayAsync()
        {
            var audit = await db.ProductEditAudit.AsNoTracking().SingleOrDefaultAsync(row => row.RequestId == command.RequestId, cancellationToken);
            if (audit is null) return null;
            if (audit.Fingerprint != fingerprint) return CatalogDraftResult.Rejected("REQUEST_ID_CONFLICT", 409, "İstek kimliği farklı bir işlemde kullanılıyor.");
            var snapshot = JsonSerializer.Deserialize<CatalogProductDetail>(audit.SnapshotJson, jsonOptions);
            return snapshot is null ? CatalogDraftResult.Rejected("PRODUCT_INCONSISTENT", 503, "Ürün kaydı okunamadı.") : CatalogDraftResult.Success(snapshot, false);
        }

        if (await ReplayAsync() is { } replay) return replay;
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction(),
            firmId, branchId, "catalog.drafts", cancellationToken);
        if (blocked is not null) return new CatalogDraftResult(null, blocked, false);
        blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction(),
            firmId, branchId, "catalog.publishing", cancellationToken);
        if (blocked is not null) return new CatalogDraftResult(null, blocked, false);
        var category = await LockCategoryAsync(firmId, branchId, values.CategoryId, cancellationToken);
        if (category is null) return CatalogDraftResult.Rejected("CATEGORY_NOT_FOUND", 409, "Kategori bu şubede bulunamadı.");
        if (category.Name != values.CategoryName) return CatalogDraftResult.Rejected("CATEGORY_NAME_MISMATCH", 409, "Kategori adı değişti; listeyi yenileyin.");
        var product = await db.Products.FromSqlInterpolated(
            $"SELECT * FROM catalog.products WHERE id = {productId} AND firm_id = {firmId} AND branch_ids @> ARRAY[{branchId}]::text[] FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);
        if (product is null) return CatalogDraftResult.Rejected("PRODUCT_NOT_FOUND", 404, "Ürün bu şubede bulunamadı.");
        if (await ReplayAsync() is { } lockedReplay) return lockedReplay;
        if (product.Status != "published") return CatalogDraftResult.Rejected("PRODUCT_NOT_PUBLISHED", 409, "Ürün henüz yayımlanmadı.");
        if (product.BranchIds.Length != 1) return CatalogDraftResult.Rejected("MULTI_BRANCH_PRODUCT", 409, "Birden fazla şubedeki ürün bu ekrandan düzenlenemez.");
        if (product.Version != command.ExpectedVersion) return CatalogDraftResult.Rejected("VERSION_CONFLICT", 409, "Ürün başka bir işlemle değişti.");
        var now = DateTimeOffset.UtcNow;
        var changed = product.Name != values.Name || product.Sku != values.Sku || product.CategoryId != values.CategoryId ||
            product.CategoryName != values.CategoryName || product.Description != values.Description ||
            allergens is not null && !product.Allergens.SequenceEqual(allergens);
        if (changed)
        {
            product.Name = values.Name; product.Sku = values.Sku; product.CategoryId = values.CategoryId;
            product.CategoryName = values.CategoryName; product.Description = values.Description;
            if (allergens is not null) product.Allergens = allergens;
            product.Version++; product.UpdatedAt = now;
            if (product.Channels.Contains("pos"))
            {
                var latestPrice = await db.PriceVersions.AsNoTracking().Where(row => row.FirmId == firmId && row.ProductId == productId && row.BranchId == branchId)
                    .OrderByDescending(row => row.Number).FirstOrDefaultAsync(cancellationToken);
                var currentPrice = await db.BranchPrices.AsNoTracking().Where(row => row.ProductId == productId && row.BranchId == branchId)
                    .Select(row => (long?)row.AmountMinor).SingleOrDefaultAsync(cancellationToken) ?? product.BasePriceMinor;
                if (currentPrice <= 0) return CatalogDraftResult.Rejected("PRICE_REQUIRED", 409, "Yayımlanmış ürünün geçerli fiyatı bulunamadı.");
                if (latestPrice is null || latestPrice.AmountMinor != currentPrice)
                {
                    var lastNumber = await db.PriceVersions.AsNoTracking().Where(row => row.FirmId == firmId && row.ProductId == productId)
                        .MaxAsync(row => (int?)row.Number, cancellationToken) ?? 0;
                    latestPrice = new CatalogPriceVersionRow { Id = Guid.NewGuid(), FirmId = firmId, BranchId = branchId, ProductId = productId,
                        Number = lastNumber + 1, AmountMinor = currentPrice, Currency = product.Currency, Actor = actor, CreatedAt = now };
                    db.PriceVersions.Add(latestPrice);
                }
                var lastPublication = await db.Publications.AsNoTracking().Where(row => row.FirmId == firmId && row.ProductId == productId)
                    .MaxAsync(row => (int?)row.Number, cancellationToken) ?? 0;
                db.Publications.Add(new CatalogPublicationRow { Id = command.RequestId, FirmId = firmId, BranchId = branchId, ProductId = productId,
                    Number = lastPublication + 1, PriceVersionId = latestPrice.Id, ProductName = product.Name, Sku = product.Sku,
                    CategoryId = product.CategoryId, CategoryName = product.CategoryName, AmountMinor = currentPrice,
                    Currency = product.Currency, Channels = ["pos"], PublishedAt = now, Actor = actor });
            }
        }
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            var snapshot = await queries.GetAsync(new CatalogScope(firmId, branchId), productId, cancellationToken);
            if (snapshot is null) return CatalogDraftResult.Rejected("PRODUCT_INCONSISTENT", 503, "Ürün okunamadı.");
            db.ProductEditAudit.Add(new CatalogProductEditAuditRow { RequestId = command.RequestId, ProductId = productId,
                FirmId = firmId, BranchId = branchId, Actor = actor, Fingerprint = fingerprint,
                SnapshotJson = JsonSerializer.Serialize(snapshot, jsonOptions), Version = product.Version, OccurredAt = now });
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return CatalogDraftResult.Success(snapshot, false);
        }
        catch (DbUpdateConcurrencyException) { return CatalogDraftResult.Rejected("VERSION_CONFLICT", 409, "Ürün başka bir işlemle değişti."); }
        catch (DbUpdateException error) when (IsUniqueViolation(error))
        {
            return CatalogDraftResult.Rejected("DUPLICATE_SKU", 409, "Stok kodu veya istek kimliği zaten kullanılıyor.");
        }
    }

    public async Task<CatalogDraftResult> CreatePricedAsync(
        string firmId, string branchId, CreatePricedProduct command, string actor, CancellationToken cancellationToken)
    {
        var values = Normalize(command.Name, command.Sku, command.CategoryId, command.CategoryName, command.Description);
        var allergens = NormalizeAllergens(command.Allergens);
        if (command.DraftId == Guid.Empty || command.PriceVersionId == Guid.Empty || values is null ||
            command.AmountMinor is < 1 or > 1_000_000_000 || command.Allergens is not null && allergens is null)
            return CatalogDraftResult.Rejected("INVALID_DRAFT", 400, "Ürün alanları veya fiyat geçersiz.");

        async Task<CatalogDraftResult?> ExistingAsync()
        {
            var existing = await db.Drafts.AsNoTracking().FirstOrDefaultAsync(row => row.Id == command.DraftId, cancellationToken);
            var price = await db.PriceVersions.AsNoTracking().FirstOrDefaultAsync(row => row.Id == command.PriceVersionId, cancellationToken);
            if (existing is null && price is null) return null;
            var projection = await db.Products.AsNoTracking().FirstOrDefaultAsync(row => row.Id == command.DraftId, cancellationToken);
            if (existing is null || price is null || existing.Version != 1 || existing.FirmId != firmId || existing.BranchId != branchId ||
                !Same(existing, values) || price.FirmId != firmId || price.BranchId != branchId || price.ProductId != command.DraftId ||
                price.Number != 1 || price.AmountMinor != command.AmountMinor || projection is null ||
                !projection.Allergens.SequenceEqual(allergens ?? []))
                return CatalogDraftResult.Rejected("DRAFT_ID_CONFLICT", 409, "Ürün veya fiyat kimliği başka bir kayıt için kullanılıyor.");
            var current = await queries.GetAsync(new CatalogScope(firmId, branchId), command.DraftId, cancellationToken);
            return current is null ? CatalogDraftResult.Rejected("DRAFT_INCONSISTENT", 503, "Ürün okunamadı.") : CatalogDraftResult.Success(current, false);
        }

        if (await ExistingAsync() is { } replay) return replay;
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction(),
            firmId, branchId, "catalog.drafts", cancellationToken);
        if (blocked is not null) return new CatalogDraftResult(null, blocked, false);
        blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction(),
            firmId, branchId, "catalog.price_drafts", cancellationToken);
        if (blocked is not null) return new CatalogDraftResult(null, blocked, false);
        if (await ExistingAsync() is { } lockedReplay) return lockedReplay;
        var category = await LockCategoryAsync(firmId, branchId, values.CategoryId, cancellationToken);
        if (category is null) return CatalogDraftResult.Rejected("CATEGORY_NOT_FOUND", 409, "Kategori bu şubede bulunamadı.");
        if (category.Name != values.CategoryName) return CatalogDraftResult.Rejected("CATEGORY_NAME_MISMATCH", 409, "Kategori adı değişti; listeyi yenileyin.");
        var now = DateTimeOffset.UtcNow;
        db.Drafts.Add(new CatalogDraftRow { Id = command.DraftId, FirmId = firmId, BranchId = branchId,
            Name = values.Name, Sku = values.Sku, CategoryId = values.CategoryId, CategoryName = values.CategoryName,
            Description = values.Description, Version = 1, UpdatedAt = now });
        db.Products.Add(new CatalogProductRow { Id = command.DraftId, FirmId = firmId, BranchIds = [branchId],
            Name = values.Name, Sku = values.Sku, CategoryId = values.CategoryId, CategoryName = values.CategoryName,
            Description = values.Description, Status = "draft", Channels = [], Image = "", RecipeLinked = false,
            BasePriceMinor = command.AmountMinor, Currency = "TRY", Allergens = allergens ?? [], OptionGroups = [], Version = 1, UpdatedAt = now });
        db.PriceVersions.Add(new CatalogPriceVersionRow { Id = command.PriceVersionId, FirmId = firmId, BranchId = branchId,
            ProductId = command.DraftId, Number = 1, AmountMinor = command.AmountMinor, Currency = "TRY", Actor = actor, CreatedAt = now });
        db.DraftAudit.Add(new CatalogDraftAuditRow { DraftId = command.DraftId, FirmId = firmId, BranchId = branchId,
            Actor = actor, Action = "created", Version = 1, OccurredAt = now });
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException error) when (IsUniqueViolation(error))
        {
            return CatalogDraftResult.Rejected("DUPLICATE_DRAFT_OR_SKU", 409, "Ürün, fiyat kimliği veya stok kodu zaten kullanılıyor.");
        }
        var product = await queries.GetAsync(new CatalogScope(firmId, branchId), command.DraftId, cancellationToken);
        return product is null ? CatalogDraftResult.Rejected("DRAFT_INCONSISTENT", 503, "Ürün okunamadı.") : CatalogDraftResult.Success(product, true);
    }

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
        var category = await LockCategoryAsync(firmId, branchId, values.CategoryId, cancellationToken);
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
        var allergens = NormalizeAllergens(command.Allergens);
        if (values is null || command.Allergens is not null && allergens is null)
            return CatalogDraftResult.Rejected("INVALID_DRAFT", 400, "Taslak alanları eksik veya çok uzun.");
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(),
            transaction.GetDbTransaction(), firmId, branchId, "catalog.drafts", cancellationToken);
        if (blocked is not null) return new CatalogDraftResult(null, blocked, false);

        var category = await LockCategoryAsync(firmId, branchId, values.CategoryId, cancellationToken);
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
        var projection = await db.Products.SingleOrDefaultAsync(
            row => row.Id == draftId && row.FirmId == firmId && row.Status == "draft", cancellationToken);
        if (projection is null)
            return CatalogDraftResult.Rejected("DRAFT_INCONSISTENT", 503, "Taslak okuma kaydı eksik.");
        if (Same(draft, values) && (allergens is null || projection.Allergens.SequenceEqual(allergens)))
        {
            var unchanged = await queries.GetAsync(new CatalogScope(firmId, branchId), draftId, cancellationToken);
            return unchanged is null
                ? CatalogDraftResult.Rejected("DRAFT_INCONSISTENT", 503, "Taslak okunamadı.")
                : CatalogDraftResult.Success(unchanged, false);
        }

        var now = DateTimeOffset.UtcNow;
        draft.Name = projection.Name = values.Name;
        draft.Sku = projection.Sku = values.Sku;
        draft.CategoryId = projection.CategoryId = values.CategoryId;
        draft.CategoryName = projection.CategoryName = values.CategoryName;
        draft.Description = projection.Description = values.Description;
        if (allergens is not null) projection.Allergens = allergens;
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

    private static string[]? NormalizeAllergens(string[]? input)
    {
        if (input is null) return null;
        if (input.Length > 30 || input.Any(value => string.IsNullOrWhiteSpace(value) || value.Trim().Length > 100)) return null;
        return input.Select(value => value.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    }

    private static bool IsUniqueViolation(DbUpdateException error) =>
        error.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };

    private Task<CatalogCategoryRow?> LockCategoryAsync(
        string firmId, string branchId, string categoryId, CancellationToken cancellationToken) =>
        db.Categories.FromSqlInterpolated(
            $"SELECT * FROM catalog.categories WHERE firm_id = {firmId} AND branch_id = {branchId} AND id = {categoryId} FOR SHARE")
            .AsNoTracking().SingleOrDefaultAsync(cancellationToken);
}
