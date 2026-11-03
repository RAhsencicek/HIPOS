using Microsoft.EntityFrameworkCore;

namespace Hipos.Api.Catalog;

public static class PublicQrMenuEndpoints
{
    private sealed record PublicMenuConfig(string Token, string FirmId, string BranchId, string RestaurantName, string BranchName, string? LogoUrl);

    public static void MapPublicQrMenuEndpoints(this WebApplication app, bool ready)
    {
        PublicMenuConfig? GetConfig(string token)
        {
            var settings = app.Configuration.GetSection("HIPOS_PUBLIC_MENU");
            var configuredToken = settings["TOKEN"];
            var firm = settings["FIRM_ID"];
            var branch = settings["BRANCH_ID"];
            var restaurant = settings["RESTAURANT_NAME"];
            var branchName = settings["BRANCH_NAME"];
            if (token.Length is < 1 or > 128 || token.Any(c => !char.IsAsciiLetterOrDigit(c) && c != '-' && c != '_') ||
                string.IsNullOrWhiteSpace(configuredToken) || !string.Equals(token, configuredToken, StringComparison.Ordinal) ||
                string.IsNullOrWhiteSpace(firm) || string.IsNullOrWhiteSpace(branch) || string.IsNullOrWhiteSpace(restaurant) || string.IsNullOrWhiteSpace(branchName)) return null;
            var logo = settings["LOGO_URL"];
            var localLogo = logo is not null && logo.StartsWith('/') && !logo.StartsWith("//", StringComparison.Ordinal) && !logo.Contains('\\');
            if (!localLogo && (!Uri.TryCreate(logo, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)) logo = null;
            return new PublicMenuConfig(configuredToken, firm, branch, restaurant, branchName, logo);
        }

        var group = app.MapGroup("/api/v1/public/menus/{token}");
        group.MapGet("", async (string token, HttpContext ctx, CatalogDbContext db) =>
        {
            var config = GetConfig(token);
            if (config is null) return Results.NotFound();
            if (!ready) return Results.Problem(statusCode: 503, detail: "Menü şu anda kullanılamıyor.");
            var ct = ctx.RequestAborted;
            var menus = await db.Menus.AsNoTracking().Where(m => m.FirmId == config.FirmId && m.BranchId == config.BranchId && m.IsActive)
                .OrderBy(m => m.Name).ThenBy(m => m.Id).ToListAsync(ct);
            var menuIds = menus.Select(m => m.Id).ToArray();
            var sections = await db.MenuSections.AsNoTracking().Where(s => menuIds.Contains(s.MenuId)).OrderBy(s => s.SortOrder).ToListAsync(ct);
            var items = await db.MenuItems.AsNoTracking().Where(i => menuIds.Contains(i.MenuId)).OrderBy(i => i.SortOrder).ToListAsync(ct);
            var products = await db.Products.AsNoTracking().Include(p => p.BranchPrices)
                .Where(p => p.FirmId == config.FirmId && p.BranchIds.Contains(config.BranchId) && p.IsActive && p.Status == "published" && p.DesiredChannels.Contains("qr"))
                .ToListAsync(ct);
            var visible = products.Where(p => p.Currency == "TRY" && (p.BranchPrices.FirstOrDefault(x => x.BranchId == config.BranchId)?.AmountMinor ?? p.BasePriceMinor) > 0).ToDictionary(p => p.Id);
            var categories = await db.Categories.AsNoTracking()
                .Where(category => category.FirmId == config.FirmId && category.BranchId == config.BranchId && category.IsActive)
                .OrderBy(category => category.SortOrder).ThenBy(category => category.Name)
                .Select(category => new { category.Id, category.Name }).ToListAsync(ct);
            object ProductView(CatalogProductRow product)
            {
                var imageId = product.Image.StartsWith("upload:", StringComparison.Ordinal) && Guid.TryParse(product.Image[7..], out var image) ? image : (Guid?)null;
                return new { product.Id, product.Name, product.Description, product.Allergens,
                    price = new { amountMinor = product.BranchPrices.FirstOrDefault(x => x.BranchId == config.BranchId)?.AmountMinor ?? product.BasePriceMinor, product.Currency },
                    imageUrl = imageId is null ? null : $"/api/v1/public/menus/{Uri.EscapeDataString(config.Token)}/products/{product.Id}/images/{imageId}" };
            }
            var result = menus.Select(menu => new { menu.Id, menu.Name, menu.Description,
                sections = sections.Where(s => s.MenuId == menu.Id).Select(section => new { section.SectionId, section.Name,
                    products = items.Where(i => i.MenuId == menu.Id && i.SectionId == section.SectionId && visible.ContainsKey(i.ProductId))
                        .Select(i => ProductView(visible[i.ProductId])).ToArray() }).Where(s => s.products.Length > 0).ToArray() }).ToArray();
            var publicCategories = categories.Select(category => new { category.Id, category.Name,
                products = products.Where(product => product.CategoryId == category.Id && visible.ContainsKey(product.Id))
                    .Select(product => ProductView(product)).ToArray() }).ToArray();
            ctx.Response.Headers.CacheControl = "no-store";
            return Results.Ok(new { restaurantName = config.RestaurantName, config.BranchName, config.LogoUrl, menus = result, categories = publicCategories });
        });

        group.MapGet("/products/{productId:guid}/images/{imageId:guid}", async (string token, Guid productId, Guid imageId, HttpContext ctx, CatalogDbContext db) =>
        {
            var config = GetConfig(token);
            if (config is null) return Results.NotFound();
            if (!ready) return Results.Problem(statusCode: 503, detail: "Görsel şu anda kullanılamıyor.");
            var ct = ctx.RequestAborted;
            var imageKey = $"upload:{imageId}";
            var visible = await db.Products.AsNoTracking().Where(p => p.Id == productId && p.FirmId == config.FirmId && p.BranchIds.Contains(config.BranchId) && p.IsActive && p.Status == "published" && p.DesiredChannels.Contains("qr") && p.Image == imageKey && p.Currency == "TRY" &&
                    (db.BranchPrices.Where(b => b.ProductId == p.Id && b.BranchId == config.BranchId).Select(b => (long?)b.AmountMinor).FirstOrDefault() ?? p.BasePriceMinor) > 0)
                .AnyAsync(p =>
                    db.MenuItems.Any(i => i.ProductId == p.Id && db.Menus.Any(m => m.Id == i.MenuId && m.FirmId == config.FirmId && m.BranchId == config.BranchId && m.IsActive)) ||
                    (p.CategoryId != "" && db.Categories.Any(category => category.Id == p.CategoryId && category.FirmId == config.FirmId && category.BranchId == config.BranchId && category.IsActive)), ct);
            if (!visible) return Results.NotFound();
            var image = await db.ProductImages.AsNoTracking().SingleOrDefaultAsync(x => x.RequestId == imageId && x.ProductId == productId && x.FirmId == config.FirmId && x.BranchId == config.BranchId, ct);
            if (image is null) return Results.NotFound();
            ctx.Response.Headers.CacheControl = "no-store";
            ctx.Response.Headers.XContentTypeOptions = "nosniff";
            return Results.File(image.Content, image.ContentType);
        });
    }
}
