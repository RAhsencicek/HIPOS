using Hipos.Api.Features;

namespace Hipos.Api.Catalog;

public static class CatalogOptionGroupEndpoints
{
    public static void MapCatalogOptionGroupEndpoints(this WebApplication app, bool ready)
    {
        var groups = app.MapGroup("/api/v1/firms/{firmId}/catalog/option-groups");
        groups.MapGet("", async (string firmId, HttpContext context, CatalogQueries queries) =>
        {
            if (Guard(context, firmId, ready, false) is { } denied) return denied;
            var result = await queries.ListOptionGroupsAsync(firmId, context.RequestAborted);
            return Results.Ok(new { source = "postgres", items = result });
        });
        groups.MapPost("", async (string firmId, CreateCatalogOptionGroup command, HttpContext context,
            CatalogOptionGroupCommands commands) =>
        {
            if (Guard(context, firmId, ready, true) is { } denied) return denied;
            var actor = DemoAccess.Resolve(context)!;
            var result = await commands.CreateGroupAsync(firmId, command, actor.Name, context.RequestAborted);
            return ToResult(context, result, $"/api/v1/firms/{firmId}/catalog/option-groups/{command.RequestId}");
        });
        groups.MapPut("/{groupId:guid}", async (string firmId, Guid groupId, UpdateCatalogOptionGroup command,
            HttpContext context, CatalogOptionGroupCommands commands) =>
        {
            if (Guard(context, firmId, ready, true) is { } denied) return denied;
            var actor = DemoAccess.Resolve(context)!;
            var result = await commands.UpdateGroupAsync(firmId, groupId, command, actor.Name, context.RequestAborted);
            return ToResult(context, result);
        });
        groups.MapPost("/{groupId:guid}/items", async (string firmId, Guid groupId, CreateCatalogOptionItem command,
            HttpContext context, CatalogOptionGroupCommands commands) =>
        {
            if (Guard(context, firmId, ready, true) is { } denied) return denied;
            var actor = DemoAccess.Resolve(context)!;
            var result = await commands.CreateItemAsync(firmId, groupId, command, actor.Name, context.RequestAborted);
            return ToResult(context, result,
                $"/api/v1/firms/{firmId}/catalog/option-groups/{groupId}/items/{command.RequestId}");
        });
        groups.MapPut("/{groupId:guid}/items/{itemId:guid}", async (string firmId, Guid groupId, Guid itemId,
            UpdateCatalogOptionItem command, HttpContext context, CatalogOptionGroupCommands commands) =>
        {
            if (Guard(context, firmId, ready, true) is { } denied) return denied;
            var actor = DemoAccess.Resolve(context)!;
            var result = await commands.UpdateItemAsync(firmId, groupId, itemId, command, actor.Name, context.RequestAborted);
            return ToResult(context, result);
        });

        app.MapGet("/api/v1/firms/{firmId}/branches/{branchId}/catalog/products/{productId:guid}/option-groups",
            async (string firmId, string branchId, Guid productId, HttpContext context, CatalogQueries queries) =>
            {
                var actor = DemoAccess.Resolve(context);
                if (actor is null) return Fail("UNAUTHENTICATED", 401, "Kullanıcı belirtilmedi.");
                if (!actor.CanRead(firmId, branchId)) return Fail("UNAUTHORIZED_SCOPE", 403, "Bu şubede ürün erişim izni yok.");
                if (!ready) return Fail("CATALOG_STORAGE_UNAVAILABLE", 503, "Katalog migration'ını uygulayıp API'yi yeniden başlatın.");
                var product = await queries.GetAsync(new CatalogScope(firmId, branchId), productId, context.RequestAborted);
                if (product is null) return Fail("PRODUCT_NOT_FOUND", 404, "Ürün bu şubede bulunamadı.");
                var result = await queries.GetProductOptionGroupsAsync(firmId, productId, context.RequestAborted);
                return result is null ? Fail("PRODUCT_NOT_FOUND", 404, "Ürün bulunamadı.") : Results.Ok(result);
            });

        var productGroups = app.MapGroup("/api/v1/firms/{firmId}/catalog/products/{productId:guid}/option-groups");
        productGroups.MapGet("", async (string firmId, Guid productId, HttpContext context, CatalogQueries queries) =>
        {
            if (Guard(context, firmId, ready, false) is { } denied) return denied;
            var result = await queries.GetProductOptionGroupsAsync(firmId, productId, context.RequestAborted);
            return result is null ? Fail("PRODUCT_NOT_FOUND", 404, "Ürün bulunamadı.") : Results.Ok(result);
        });
        productGroups.MapPut("", async (string firmId, Guid productId, SaveProductOptionGroups command,
            HttpContext context, CatalogOptionGroupCommands commands) =>
        {
            if (Guard(context, firmId, ready, true) is { } denied) return denied;
            var actor = DemoAccess.Resolve(context)!;
            var result = await commands.SaveProductGroupsAsync(firmId, productId, command, actor.Name, context.RequestAborted);
            return ToResult(context, result);
        });
    }

    private static IResult? Guard(HttpContext context, string firmId, bool ready, bool write)
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Fail("UNAUTHENTICATED", 401, "Kullanıcı belirtilmedi.");
        if (!DemoAccess.CanReadCatalog(actor, firmId, null) || write && !actor.CanManage)
            return Fail("UNAUTHORIZED_SCOPE", 403, "Firma genelinde seçenek grubu yönetme veya görüntüleme izni yok.");
        return ready ? null : Fail("CATALOG_STORAGE_UNAVAILABLE", 503, "Katalog migration'ını uygulayıp API'yi yeniden başlatın.");
    }

    private static IResult ToResult(HttpContext context, CatalogOptionCommandResult result, string? location = null)
    {
        if (result.Failure is { } failure) return Fail(failure.Code, failure.Status, failure.Message);
        return result.Created && location is not null
            ? Results.Created(location, result.Value)
            : Results.Ok(result.Value);
    }

    private static IResult Fail(string code, int status, string detail) =>
        Results.Json(new
        {
            type = $"https://hipos.local/problems/{code.ToLowerInvariant().Replace('_', '-')}",
            title = status switch { 401 => "Oturum gerekli", 403 => "Yetkisiz kapsam", 404 => "Bulunamadı", 409 => "İşlem çakışması", _ => "İstek hatası" },
            status, detail, code,
        }, statusCode: status, contentType: "application/problem+json");
}
