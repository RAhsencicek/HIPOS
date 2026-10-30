using Hipos.Api.Cari;
using Hipos.Api.Catalog;
using Hipos.Api.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace Hipos.Api.Inventory;

public sealed record CreateRecipeWaste(string RequestId, Guid ProductId, decimal Portions,
    string ReasonType, string Description, string? WarehouseId = null);
public sealed record PurchaseOrderLineInput(string IngredientId, decimal Quantity);
public sealed record CreatePurchaseOrder(string RequestId, string WarehouseId, string SupplierCariId,
    string OrderNumber, DateOnly OrderDate, PurchaseOrderLineInput[] Lines);
public sealed record ApprovePurchaseOrder(string RequestId, int ExpectedVersion);

public static class InventoryCompletionEndpoints
{
    private static readonly HashSet<string> WasteReasons =
        ["spoilage", "expired", "spill_breakage", "burn", "quality_control"];

    public static IEndpointRouteBuilder MapInventoryCompletionEndpoints(this IEndpointRouteBuilder app, bool ready)
    {
        MapRecipeWaste(app, ready);
        MapPurchaseOrders(app, ready);
        return app;
    }

    private static void MapRecipeWaste(IEndpointRouteBuilder app, bool ready)
    {
        var group = app.MapGroup("/api/v1/firms/{firmId}/branches/{branchId}/inventory");
        group.MapGet("/recipe-waste-products", async (string firmId, string branchId, HttpContext context,
            InventoryDbContext db, CatalogDbContext catalog) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false, "stok");
            if (denied is not null) return denied;
            var recipes = await db.Recipes.AsNoTracking().Include(row => row.Lines)
                .Where(row => row.FirmId == firmId && row.BranchId == branchId)
                .ToListAsync(context.RequestAborted);
            var latest = recipes.GroupBy(row => row.ProductId).Select(rows => rows.OrderByDescending(row => row.Version).First()).ToArray();
            var ids = latest.Select(row => row.ProductId).ToArray();
            var products = await catalog.Products.AsNoTracking().Where(row => row.FirmId == firmId && ids.Contains(row.Id) &&
                row.IsActive && row.BranchIds.Contains(branchId)).ToDictionaryAsync(row => row.Id, row => row.Name, context.RequestAborted);
            var ingredientIds = latest.SelectMany(row => row.Lines).Select(row => row.IngredientId).Distinct().ToArray();
            var ingredients = await db.Ingredients.AsNoTracking().Where(row => row.FirmId == firmId && row.BranchId == branchId &&
                ingredientIds.Contains(row.Id)).ToDictionaryAsync(row => row.Id, row => row.Name, context.RequestAborted);
            var items = latest.Where(row => products.ContainsKey(row.ProductId)).Select(row => new
            {
                productId = row.ProductId, productName = products[row.ProductId], recipeId = row.Id,
                recipeVersion = row.Version, row.Portion,
                lines = row.Lines.Select(line => new { line.IngredientId,
                    ingredientName = ingredients.GetValueOrDefault(line.IngredientId) ?? "Silinmiş hammadde",
                    line.Quantity, line.Unit }).ToArray()
            }).OrderBy(row => row.productName).ToArray();
            return Results.Ok(new { source = "postgres", items });
        });

        group.MapGet("/recipe-waste", async (string firmId, string branchId, string? warehouseId,
            HttpContext context, InventoryDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false, "stok");
            if (denied is not null) return denied;
            var warehouse = await ResolveWarehouse(db, firmId, branchId, warehouseId, context.RequestAborted);
            if (warehouse is null) return Fail(context, "WAREHOUSE_NOT_FOUND", 404, "Etkin depo bulunamadı.");
            var rows = await db.RecipeWasteLogs.AsNoTracking().Include(row => row.Lines)
                .Where(row => row.FirmId == firmId && row.BranchId == branchId && row.WarehouseId == warehouse.Id)
                .OrderByDescending(row => row.CreatedAt).Take(200).ToListAsync(context.RequestAborted);
            var names = await IngredientNames(db, firmId, branchId, rows.SelectMany(row => row.Lines).Select(row => row.IngredientId), context.RequestAborted);
            return Results.Ok(new { source = "postgres", items = rows.Select(row => RecipeWasteView(row, names)).ToArray() });
        });

        group.MapPost("/recipe-waste", async (string firmId, string branchId, CreateRecipeWaste command,
            HttpContext context, InventoryDbContext db, CatalogDbContext catalog, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true, "stok");
            if (denied is not null) return denied;
            var description = command.Description?.Trim() ?? "";
            var reason = command.ReasonType?.Trim().ToLowerInvariant() ?? "";
            if (!Guid.TryParse(command.RequestId, out _) || command.ProductId == Guid.Empty || command.Portions <= 0 ||
                decimal.Round(command.Portions, 3) != command.Portions || !WasteReasons.Contains(reason) ||
                description.Length is < 3 or > 500)
                return Fail(context, "INVALID_RECIPE_WASTE", 400, "Ürün, porsiyon, neden veya açıklama geçersiz.");
            var product = await catalog.Products.AsNoTracking().SingleOrDefaultAsync(row => row.Id == command.ProductId &&
                row.FirmId == firmId && row.IsActive && row.BranchIds.Contains(branchId), context.RequestAborted);
            if (product is null) return Fail(context, "PRODUCT_NOT_FOUND", 404, "Etkin ürün bulunamadı.");

            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            foreach (var feature in new[] { "inventory.items", "inventory.recipes" })
            {
                var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction(),
                    firmId, branchId, feature, context.RequestAborted);
                if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            }
            var existing = await db.RecipeWasteLogs.AsNoTracking().Include(row => row.Lines)
                .SingleOrDefaultAsync(row => row.Id == command.RequestId, context.RequestAborted);
            if (existing is not null)
                return existing.FirmId == firmId && existing.BranchId == branchId && existing.ProductId == command.ProductId &&
                    existing.Portions == command.Portions && existing.ReasonType == reason && existing.Description == description
                    ? Results.Ok(RecipeWasteView(existing, await IngredientNames(db, firmId, branchId,
                        existing.Lines.Select(row => row.IngredientId), context.RequestAborted)))
                    : Fail(context, "RECIPE_WASTE_ID_CONFLICT", 409, "İstek kimliği farklı ürün zayisi için kullanılmış.");
            var warehouse = await ResolveWarehouse(db, firmId, branchId, command.WarehouseId, context.RequestAborted);
            if (warehouse is null) return Fail(context, "WAREHOUSE_NOT_FOUND", 404, "Etkin depo bulunamadı.");
            if (await db.Counts.AnyAsync(row => row.FirmId == firmId && row.BranchId == branchId &&
                row.WarehouseId == warehouse.Id && row.Status == "draft", context.RequestAborted))
                return Fail(context, "COUNT_IN_PROGRESS", 409, "Bu depoda sayım açık. Ürün zayisi için önce sayımı tamamlayın veya iptal edin.");
            var recipe = await db.Recipes.Include(row => row.Lines).Where(row => row.FirmId == firmId && row.BranchId == branchId &&
                row.ProductId == command.ProductId).OrderByDescending(row => row.Version).FirstOrDefaultAsync(context.RequestAborted);
            if (recipe is null || recipe.Lines.Count == 0)
                return Fail(context, "RECIPE_NOT_FOUND", 409, "Ürünün aktif reçetesi bulunamadı.");
            var ingredientIds = recipe.Lines.Select(row => row.IngredientId).ToArray();
            var ingredients = await db.Ingredients.Where(row => row.FirmId == firmId && row.BranchId == branchId &&
                row.IsActive && ingredientIds.Contains(row.Id)).ToDictionaryAsync(row => row.Id, context.RequestAborted);
            if (ingredients.Count != ingredientIds.Length) return Fail(context, "INGREDIENT_NOT_AVAILABLE", 409, "Reçetedeki hammaddelerden biri kullanılamıyor.");
            var balances = await db.Movements.Where(row => row.FirmId == firmId && row.BranchId == branchId &&
                row.WarehouseId == warehouse.Id && ingredientIds.Contains(row.IngredientId))
                .GroupBy(row => row.IngredientId).Select(rows => new { Id = rows.Key, OnHand = rows.Sum(row => row.Delta) })
                .ToDictionaryAsync(row => row.Id, row => row.OnHand, context.RequestAborted);
            foreach (var line in recipe.Lines)
            {
                if (line.Unit != ingredients[line.IngredientId].Unit)
                    return Fail(context, "UNIT_MISMATCH", 409, $"{ingredients[line.IngredientId].Name} reçete birimi stok birimiyle eşleşmiyor.");
                var required = line.Quantity * command.Portions;
                if (balances.GetValueOrDefault(line.IngredientId) < required)
                    return Fail(context, "INSUFFICIENT_STOCK", 409,
                        $"{ingredients[line.IngredientId].Name} için stok yetersiz. Gerekli: {required:0.###} {line.Unit}.");
            }
            var now = DateTimeOffset.UtcNow;
            var actor = DemoAccess.Resolve(context)!.Name;
            var waste = new InventoryRecipeWasteLogRow { Id = command.RequestId, FirmId = firmId, BranchId = branchId,
                WarehouseId = warehouse.Id, ProductId = product.Id, ProductName = product.Name, RecipeId = recipe.Id,
                RecipeVersion = recipe.Version, Portions = command.Portions, ReasonType = reason, Description = description,
                CreatedAt = now, ReportedBy = actor };
            foreach (var line in recipe.Lines)
            {
                var required = line.Quantity * command.Portions;
                waste.Lines.Add(new InventoryRecipeWasteLineRow { RecipeWasteLogId = waste.Id,
                    IngredientId = line.IngredientId, Quantity = required, Unit = line.Unit });
                db.Movements.Add(new InventoryMovementRow { Id = Guid.NewGuid().ToString(), FirmId = firmId, BranchId = branchId,
                    WarehouseId = warehouse.Id, IngredientId = line.IngredientId, Delta = -required, Unit = line.Unit,
                    Kind = "waste_loss", RecipeWasteLogId = waste.Id,
                    Description = $"Ürün zayisi {product.Name} x {command.Portions:0.###}: {description}", CreatedAt = now, Actor = actor });
                ingredients[line.IngredientId].Version++;
                ingredients[line.IngredientId].UpdatedAt = now;
            }
            db.RecipeWasteLogs.Add(waste);
            db.Audit.Add(new InventoryAuditRow { FirmId = firmId, BranchId = branchId, WarehouseId = warehouse.Id,
                EntityId = waste.Id, Action = "recipe_waste_created", RequestId = waste.Id, Actor = actor,
                Detail = $"{product.Name} · {command.Portions:0.###} porsiyon · reçete v{recipe.Version}", OccurredAt = now });
            await db.SaveChangesAsync(context.RequestAborted);
            await transaction.CommitAsync(context.RequestAborted);
            return Results.Created($"{context.Request.Path}/{waste.Id}", RecipeWasteView(waste,
                ingredients.ToDictionary(row => row.Key, row => row.Value.Name)));
        });
    }

    private static void MapPurchaseOrders(IEndpointRouteBuilder app, bool ready)
    {
        var group = app.MapGroup("/api/v1/firms/{firmId}/branches/{branchId}/inventory/purchase-orders");
        group.MapGet("", async (string firmId, string branchId, HttpContext context, InventoryDbContext db, CariDbContext cari) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false, "satın alma siparişi");
            if (denied is not null) return denied;
            var rows = await db.PurchaseOrders.AsNoTracking().Include(row => row.Lines)
                .Where(row => row.FirmId == firmId && row.BranchId == branchId).OrderByDescending(row => row.CreatedAt)
                .Take(200).ToListAsync(context.RequestAborted);
            var suppliers = await cari.Parties.AsNoTracking().Where(row => row.FirmId == firmId && row.BranchId == branchId &&
                rows.Select(order => order.SupplierCariId).Contains(row.Id)).ToDictionaryAsync(row => row.Id, row => row.Name, context.RequestAborted);
            var names = await IngredientNames(db, firmId, branchId, rows.SelectMany(row => row.Lines).Select(row => row.IngredientId), context.RequestAborted);
            return Results.Ok(new { source = "postgres", items = rows.Select(row => OrderView(row,
                suppliers.GetValueOrDefault(row.SupplierCariId) ?? "Silinmiş tedarikçi", names)).ToArray() });
        });
        group.MapPost("", async (string firmId, string branchId, CreatePurchaseOrder command, HttpContext context,
            InventoryDbContext db, CariDbContext cari, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true, "satın alma siparişi");
            if (denied is not null) return denied;
            var number = command.OrderNumber?.Trim() ?? "";
            if (!Guid.TryParse(command.RequestId, out _) || number.Length is < 1 or > 100 || command.OrderDate.Year is < 2000 or > 2100 ||
                command.Lines is not { Length: >= 1 and <= 100 } || command.Lines.Any(line => line.Quantity <= 0 || decimal.Round(line.Quantity, 3) != line.Quantity) ||
                command.Lines.Select(line => line.IngredientId).Distinct().Count() != command.Lines.Length)
                return Fail(context, "INVALID_PURCHASE_ORDER", 400, "Sipariş numarası, tarihi veya satırları geçersiz.");
            var supplier = await cari.Parties.AsNoTracking().SingleOrDefaultAsync(row => row.Id == command.SupplierCariId &&
                row.FirmId == firmId && row.BranchId == branchId && row.IsActive && row.Types.Contains("supplier"), context.RequestAborted);
            if (supplier is null) return Fail(context, "SUPPLIER_NOT_FOUND", 404, "Etkin tedarikçi bulunamadı.");
            await using var tx = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), tx.GetDbTransaction(), firmId, branchId,
                "procurement.requests", context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            var existing = await db.PurchaseOrders.AsNoTracking().Include(row => row.Lines).SingleOrDefaultAsync(row => row.Id == command.RequestId, context.RequestAborted);
            if (existing is not null) return existing.FirmId == firmId && existing.BranchId == branchId
                ? Results.Ok(OrderView(existing, supplier.Name, await IngredientNames(db, firmId, branchId, existing.Lines.Select(row => row.IngredientId), context.RequestAborted)))
                : Fail(context, "PURCHASE_ORDER_ID_CONFLICT", 409, "Sipariş kimliği farklı kapsamda kullanılmış.");
            var warehouse = await ResolveWarehouse(db, firmId, branchId, command.WarehouseId, context.RequestAborted);
            if (warehouse is null) return Fail(context, "WAREHOUSE_NOT_FOUND", 404, "Etkin depo bulunamadı.");
            var ids = command.Lines.Select(row => row.IngredientId).ToArray();
            var ingredients = await db.Ingredients.Where(row => row.FirmId == firmId && row.BranchId == branchId && row.IsActive && ids.Contains(row.Id))
                .ToDictionaryAsync(row => row.Id, context.RequestAborted);
            if (ingredients.Count != ids.Length) return Fail(context, "INGREDIENT_NOT_FOUND", 404, "Sipariş hammaddelerinden biri bulunamadı.");
            var now = DateTimeOffset.UtcNow;
            var order = new InventoryPurchaseOrderRow { Id = command.RequestId, FirmId = firmId, BranchId = branchId,
                WarehouseId = warehouse.Id, SupplierCariId = supplier.Id, OrderNumber = number, OrderDate = command.OrderDate,
                CreatedAt = now, CreatedBy = DemoAccess.Resolve(context)!.Name };
            foreach (var line in command.Lines) order.Lines.Add(new InventoryPurchaseOrderLineRow { Id = Guid.NewGuid().ToString(),
                PurchaseOrderId = order.Id, IngredientId = line.IngredientId, Quantity = line.Quantity, Unit = ingredients[line.IngredientId].Unit });
            db.PurchaseOrders.Add(order);
            db.Audit.Add(new InventoryAuditRow { FirmId = firmId, BranchId = branchId, WarehouseId = warehouse.Id,
                EntityId = order.Id, Action = "purchase_order_created", RequestId = order.Id, Actor = order.CreatedBy,
                Detail = $"{number} · {order.Lines.Count} satır", OccurredAt = now });
            try { await db.SaveChangesAsync(context.RequestAborted); await tx.CommitAsync(context.RequestAborted); }
            catch (DbUpdateException error) when (error.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
            { return Fail(context, "PURCHASE_ORDER_NUMBER_EXISTS", 409, "Bu sipariş numarası daha önce kullanılmış."); }
            return Results.Created($"{context.Request.Path}/{order.Id}", OrderView(order, supplier.Name,
                ingredients.ToDictionary(row => row.Key, row => row.Value.Name)));
        });
        group.MapPost("/{orderId}/approve", async (string firmId, string branchId, string orderId, ApprovePurchaseOrder command,
            HttpContext context, InventoryDbContext db, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true, "satın alma siparişi");
            if (denied is not null) return denied;
            if (!Guid.TryParse(command.RequestId, out _) || command.ExpectedVersion < 1)
                return Fail(context, "INVALID_PURCHASE_ORDER_APPROVAL", 400, "Onay kimliği veya sürüm geçersiz.");
            await using var tx = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), tx.GetDbTransaction(), firmId, branchId,
                "procurement.requests", context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            var order = await db.PurchaseOrders.FromSqlInterpolated($"SELECT * FROM inventory.purchase_orders WHERE id = {orderId} AND firm_id = {firmId} AND branch_id = {branchId} FOR UPDATE")
                .SingleOrDefaultAsync(context.RequestAborted);
            if (order is null) return Fail(context, "PURCHASE_ORDER_NOT_FOUND", 404, "Satın alma siparişi bulunamadı.");
            await db.Entry(order).Collection(row => row.Lines).LoadAsync(context.RequestAborted);
            if (order.Status != "draft") return order.ApprovalRequestId == command.RequestId
                ? Results.Ok(OrderView(order, "", await IngredientNames(db, firmId, branchId, order.Lines.Select(row => row.IngredientId), context.RequestAborted)))
                : Fail(context, "PURCHASE_ORDER_ALREADY_APPROVED", 409, "Sipariş daha önce onaylandı.");
            if (order.Version != command.ExpectedVersion) return Fail(context, "VERSION_CONFLICT", 409, "Sipariş sürümü değişti.");
            var now = DateTimeOffset.UtcNow;
            order.Status = "approved"; order.Version++; order.ApprovedAt = now;
            order.ApprovedBy = DemoAccess.Resolve(context)!.Name; order.ApprovalRequestId = command.RequestId;
            db.Audit.Add(new InventoryAuditRow { FirmId = firmId, BranchId = branchId, WarehouseId = order.WarehouseId,
                EntityId = order.Id, Action = "purchase_order_approved", RequestId = command.RequestId,
                Actor = order.ApprovedBy, Detail = order.OrderNumber, OccurredAt = now });
            await db.SaveChangesAsync(context.RequestAborted); await tx.CommitAsync(context.RequestAborted);
            return Results.Ok(OrderView(order, "", await IngredientNames(db, firmId, branchId, order.Lines.Select(row => row.IngredientId), context.RequestAborted)));
        });
    }

    private static object RecipeWasteView(InventoryRecipeWasteLogRow row, IReadOnlyDictionary<string, string> names) => new
    {
        row.Id, row.WarehouseId, row.ProductId, row.ProductName, row.RecipeId, row.RecipeVersion, row.Portions,
        row.ReasonType, row.Description, row.CreatedAt, row.ReportedBy,
        lines = row.Lines.Select(line => new { line.IngredientId,
            ingredientName = names.GetValueOrDefault(line.IngredientId) ?? "Silinmiş hammadde", line.Quantity, line.Unit }).ToArray()
    };
    private static object OrderView(InventoryPurchaseOrderRow row, string supplierName, IReadOnlyDictionary<string, string> names) => new
    {
        row.Id, row.WarehouseId, row.SupplierCariId, supplierName, row.OrderNumber, row.OrderDate, row.Status, row.Version,
        row.CreatedAt, row.CreatedBy, row.ApprovedAt, row.ApprovedBy, row.CompletedAt, row.CompletedByPurchaseId,
        lines = row.Lines.Select(line => new { line.Id, line.IngredientId,
            ingredientName = names.GetValueOrDefault(line.IngredientId) ?? "Silinmiş hammadde", line.Quantity, line.Unit }).ToArray()
    };
    private static async Task<InventoryWarehouseRow?> ResolveWarehouse(InventoryDbContext db, string firmId, string branchId,
        string? warehouseId, CancellationToken token) => await db.Warehouses.SingleOrDefaultAsync(row => row.FirmId == firmId &&
            row.BranchId == branchId && row.IsActive && (warehouseId == null || row.Id == warehouseId), token);
    private static async Task<Dictionary<string, string>> IngredientNames(InventoryDbContext db, string firmId, string branchId,
        IEnumerable<string> ids, CancellationToken token)
    {
        var values = ids.Distinct().ToArray();
        return await db.Ingredients.AsNoTracking().Where(row => row.FirmId == firmId && row.BranchId == branchId && values.Contains(row.Id))
            .ToDictionaryAsync(row => row.Id, row => row.Name, token);
    }
    private static IResult? Guard(HttpContext context, string firmId, string branchId, bool ready, bool write, string area)
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Fail(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanRead(firmId, branchId) || write && !actor.CanManage)
            return Fail(context, "UNAUTHORIZED_SCOPE", 403, $"Bu şubede {area} erişim izni yok.");
        return ready ? null : Fail(context, "INVENTORY_STORAGE_UNAVAILABLE", 503, "Stok migration'ı uygulanmalı ve API yeniden başlatılmalı.");
    }
    private static IResult Fail(HttpContext context, string code, int status, string detail) => Results.Json(new
    {
        type = $"https://hipos.local/problems/{code.ToLowerInvariant().Replace('_', '-')}",
        title = status switch { 401 => "Oturum gerekli", 403 => "Yetkisiz kapsam", 404 => "Bulunamadı", 409 => "İşlem çakışması", 503 => "Kurulum gerekiyor", _ => "İstek hatası" },
        status, detail, instance = context.Request.Path.Value, code, traceId = context.TraceIdentifier,
    }, statusCode: status, contentType: "application/problem+json");
}
