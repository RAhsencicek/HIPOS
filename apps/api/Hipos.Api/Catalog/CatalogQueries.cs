using Microsoft.EntityFrameworkCore;

namespace Hipos.Api.Catalog;

public sealed record CatalogScope(string FirmId, string? BranchId);
public sealed record CatalogMoney(long AmountMinor, string Currency);
public sealed record CatalogCategory(string Id, string Name);
public sealed record CatalogCategorySummary(string Id, string Name, int ProductCount, int Version, bool IsActive, int SortOrder);
public sealed record CatalogCategoryList(CatalogScope Scope, IReadOnlyList<CatalogCategorySummary> Items);
public sealed record CatalogPageInfo(int Page, int PageSize, int TotalItems, int TotalPages);
public sealed record CatalogProduct(
    string Id, string FirmId, string? BrandId, string[] BranchIds,
    string Name, string Sku, CatalogCategory Category, string Status,
    string[] Channels, string Image, bool RecipeLinked, CatalogMoney Price,
    string PriceSource, DateTimeOffset UpdatedAt, int Version);
public sealed record CatalogProductDetail(
    string Id, string FirmId, string? BrandId, string[] BranchIds,
    string Name, string Sku, CatalogCategory Category, string Status,
    string[] Channels, string Image, bool RecipeLinked, CatalogMoney Price,
    string PriceSource, DateTimeOffset UpdatedAt, int Version,
    string Description, string[] Allergens, string[] OptionGroups);
public sealed record CatalogProductList(
    IReadOnlyList<CatalogProduct> Items, CatalogPageInfo PageInfo,
    CatalogScope Scope, IReadOnlyList<CatalogCategory> Categories);

public sealed class CatalogQueries(CatalogDbContext db)
{
    public async Task<CatalogCategoryList> ListCategoriesAsync(
        CatalogScope scope, CancellationToken cancellationToken)
    {
        var matching = db.Products.AsNoTracking().Where(product => product.FirmId == scope.FirmId);
        if (scope.BranchId is { } branchId)
            matching = matching.Where(product => product.BranchIds.Contains(branchId));
        var counts = await matching.GroupBy(product => product.CategoryId)
            .Select(group => new { Id = group.Key, Count = group.Count() })
            .ToDictionaryAsync(row => row.Id, row => row.Count, cancellationToken);
        var categories = await db.Categories.AsNoTracking()
            .Where(row => row.FirmId == scope.FirmId)
            .OrderBy(row => row.SortOrder).ThenBy(row => row.Name).ThenBy(row => row.Id)
            .ToListAsync(cancellationToken);
        return new CatalogCategoryList(scope, categories.Select(row =>
            new CatalogCategorySummary(row.Id, row.Name,
                counts.GetValueOrDefault(row.Id), row.Version, row.IsActive, row.SortOrder)).ToArray());
    }

    public async Task<CatalogProductList> ListAsync(
        CatalogScope scope, string? query, string? categoryId, int page, int pageSize,
        CancellationToken cancellationToken)
    {
        var matching = db.Products.AsNoTracking().Where(product => product.FirmId == scope.FirmId);
        if (scope.BranchId is { } branchId)
            matching = matching.Where(product => product.BranchIds.Contains(branchId));
        var categories = (await ListCategoriesAsync(scope, cancellationToken)).Items
            .Select(category => new CatalogCategory(category.Id, category.Name)).ToArray();
        if (!string.IsNullOrWhiteSpace(categoryId))
            matching = matching.Where(product => product.CategoryId == categoryId);
        if (!string.IsNullOrWhiteSpace(query))
        {
            var term = $"%{EscapeLike(query.Trim())}%";
            matching = matching.Where(product =>
                EF.Functions.ILike(product.Name, term, "\\") ||
                EF.Functions.ILike(product.Sku, term, "\\"));
        }

        var total = await matching.CountAsync(cancellationToken);
        var rows = await matching.Include(product => product.BranchPrices)
            .OrderBy(product => product.Name).ThenBy(product => product.Id)
            .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(cancellationToken);
        return new CatalogProductList(
            rows.Select(row => ToProduct(row, scope.BranchId)).ToArray(),
            new CatalogPageInfo(page, pageSize, total, (int)Math.Ceiling((double)total / pageSize)),
            scope, categories);
    }

    public async Task<CatalogProductDetail?> GetAsync(CatalogScope scope, Guid productId, CancellationToken cancellationToken)
    {
        var row = await db.Products.AsNoTracking().Include(product => product.BranchPrices)
            .FirstOrDefaultAsync(product => product.Id == productId && product.FirmId == scope.FirmId &&
                (scope.BranchId == null || product.BranchIds.Contains(scope.BranchId)), cancellationToken);
        if (row is null) return null;
        var product = ToProduct(row, scope.BranchId);
        return new CatalogProductDetail(
            product.Id, product.FirmId, product.BrandId, product.BranchIds,
            product.Name, product.Sku, product.Category, product.Status,
            product.Channels, product.Image, product.RecipeLinked, product.Price,
            product.PriceSource, product.UpdatedAt, product.Version,
            row.Description, row.Allergens, row.OptionGroups);
    }

    private static CatalogProduct ToProduct(CatalogProductRow row, string? branchId)
    {
        var overridePrice = branchId is null ? null : row.BranchPrices.FirstOrDefault(price => price.BranchId == branchId);
        return new CatalogProduct(
            row.Id.ToString(), row.FirmId, row.BrandId, row.BranchIds,
            row.Name, row.Sku, new CatalogCategory(row.CategoryId, row.CategoryName),
            row.Status, row.Channels, row.Image, row.RecipeLinked,
            new CatalogMoney(overridePrice?.AmountMinor ?? row.BasePriceMinor, row.Currency),
            overridePrice is null ? "central" : "branch_override", row.UpdatedAt, row.Version);
    }

    private static string EscapeLike(string term) =>
        term.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
}
