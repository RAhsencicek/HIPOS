using System.Data.Common;
using Hipos.Api.Catalog;
using Hipos.Api.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace Hipos.Api.Inventory;

public sealed record CreateInventoryIngredient(string RequestId, string Name, string Unit, decimal CriticalBelow);
public sealed record UpdateInventoryIngredient(string RequestId, int ExpectedVersion, string Unit, decimal CriticalBelow);
public sealed record AddInventoryMovement(string RequestId, string IngredientId, decimal Delta, string Kind, string Description, string? WarehouseId = null);
public sealed record SaveInventoryRecipe(string RequestId, int ExpectedVersion, string Portion, InventoryRecipeLineInput[] Lines);
public sealed record InventoryRecipeLineInput(string IngredientId, decimal Quantity, string? Unit = null);
public sealed record CreateInventoryCount(string RequestId, string? WarehouseId = null);
public sealed record SetInventoryCountLine(decimal PhysicalQuantity, int ExpectedVersion);
public sealed record ApproveInventoryCount(string RequestId, int ExpectedVersion);
public sealed record CancelInventoryCount(string RequestId, int ExpectedVersion);

public sealed record InventoryWarehouseView(string Id, string Name, bool IsActive);
public sealed record InventoryIngredientView(string Id, string WarehouseId, string Name, string Unit, decimal CriticalBelow,
    decimal OnHand, decimal BelowThresholdBy, bool IsCritical, bool IsActive, int Version);
public sealed record InventoryMovementView(string Id, string WarehouseId, string IngredientId, string IngredientName, decimal Delta,
    string Unit, string Kind, string Description, DateTimeOffset CreatedAt, string Actor);
public sealed record InventoryRecipeLineView(string IngredientId, string IngredientName, decimal Quantity, string Unit);
public sealed record InventoryRecipeView(string Id, string ProductId, string ProductName, int Version,
    string Portion, DateTimeOffset CreatedAt, InventoryRecipeLineView[] Lines);
public sealed record InventoryProductionLineView(string IngredientId, string IngredientName, decimal OnHand,
    decimal RequiredPerPortion, decimal? PossiblePortions, string Unit);
public sealed record InventoryProductionEstimateView(string ProductId, string ProductName, int RecipeVersion,
    string Portion, string Status, decimal? TheoreticalPortions, string? LimitingIngredientId,
    string? LimitingIngredientName, InventoryProductionLineView[] Lines, string Explanation);
public sealed record InventoryCountLineView(string IngredientId, string IngredientName, string Unit,
    decimal SystemQuantity, decimal? PhysicalQuantity, decimal? Difference, string ReviewStatus);
public sealed record InventoryCountView(string Id, string WarehouseId, string Status, int Version, DateTimeOffset CreatedAt,
    string CreatedBy, DateTimeOffset? ApprovedAt, string? ApprovedBy, DateTimeOffset? CancelledAt,
    string? CancelledBy, InventoryCountLineView[] Lines);

public static class InventoryEndpoints
{
    public static void MapInventoryEndpoints(this WebApplication app, bool ready)
    {
        var group = app.MapGroup("/api/v1/firms/{firmId}/branches/{branchId}/inventory");

        group.MapGet("/warehouses", async (string firmId, string branchId, HttpContext context,
            InventoryDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false);
            if (denied is not null) return denied;
            var items = await db.Warehouses.AsNoTracking()
                .Where(row => row.FirmId == firmId && row.BranchId == branchId && row.IsActive)
                .OrderBy(row => row.Name).Select(row => new InventoryWarehouseView(row.Id, row.Name, row.IsActive))
                .ToListAsync(context.RequestAborted);
            return Results.Ok(new { source = "postgres", items });
        });

        group.MapGet("/ingredients", async (string firmId, string branchId, string? warehouseId, HttpContext context,
            InventoryDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false);
            if (denied is not null) return denied;
            var warehouse = await ResolveWarehouse(db, firmId, branchId, warehouseId, context.RequestAborted);
            if (warehouse is null) return Fail(context, "WAREHOUSE_NOT_FOUND", 404, "Bu şubede etkin depo bulunamadı.");
            var ingredients = await db.Ingredients.AsNoTracking()
                .Where(row => row.FirmId == firmId && row.BranchId == branchId)
                .OrderBy(row => row.Name).ToListAsync(context.RequestAborted);
            var ids = ingredients.Select(row => row.Id).ToArray();
            var movements = await db.Movements.AsNoTracking()
                .Where(row => row.FirmId == firmId && row.BranchId == branchId && row.WarehouseId == warehouse.Id && ids.Contains(row.IngredientId))
                .ToListAsync(context.RequestAborted);
            var balances = movements.GroupBy(row => row.IngredientId).ToDictionary(grouping => grouping.Key, grouping => grouping.Sum(row => row.Delta));
            return Results.Ok(new { source = "postgres", warehouseId = warehouse.Id,
                items = ingredients.Select(row => IngredientView(row, warehouse.Id, balances.GetValueOrDefault(row.Id))).ToArray() });
        });

        group.MapGet("/critical-stock", async (string firmId, string branchId, string? warehouseId, HttpContext context,
            InventoryDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false);
            if (denied is not null) return denied;
            var warehouse = await ResolveWarehouse(db, firmId, branchId, warehouseId, context.RequestAborted);
            if (warehouse is null) return Fail(context, "WAREHOUSE_NOT_FOUND", 404, "Bu şubede etkin depo bulunamadı.");
            var ingredients = await db.Ingredients.AsNoTracking().Where(row => row.FirmId == firmId && row.BranchId == branchId && row.IsActive)
                .OrderBy(row => row.Name).ToListAsync(context.RequestAborted);
            var ids = ingredients.Select(row => row.Id).ToArray();
            var movements = await db.Movements.AsNoTracking().Where(row => row.FirmId == firmId && row.BranchId == branchId &&
                row.WarehouseId == warehouse.Id && ids.Contains(row.IngredientId)).ToListAsync(context.RequestAborted);
            var balances = movements.GroupBy(row => row.IngredientId).ToDictionary(grouping => grouping.Key, grouping => grouping.Sum(row => row.Delta));
            var critical = ingredients.Select(row => IngredientView(row, warehouse.Id, balances.GetValueOrDefault(row.Id)))
                .Where(row => row.IsCritical).ToArray();
            return Results.Ok(new { source = "postgres", warehouseId = warehouse.Id, criticalCount = critical.Length, items = critical });
        });

        group.MapPost("/ingredients", async (string firmId, string branchId, CreateInventoryIngredient command,
            HttpContext context, InventoryDbContext db, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            var name = command.Name?.Trim() ?? "";
            var unit = command.Unit?.Trim().ToLowerInvariant() ?? "";
            if (!Guid.TryParse(command.RequestId, out _) || name.Length is < 2 or > 160 ||
                unit is not ("g" or "kg" or "ml" or "l" or "adet") || !QuantityValid(command.CriticalBelow, allowZero: true))
                return Fail(context, "INVALID_INGREDIENT", 400, "Hammadde kimliği, adı, birimi veya kritik eşiği geçersiz.");
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await Gate(db, gate, transaction.GetDbTransaction(), firmId, branchId, "inventory.items", context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            var warehouse = await ResolveWarehouse(db, firmId, branchId, null, context.RequestAborted);
            if (warehouse is null) return Fail(context, "WAREHOUSE_NOT_FOUND", 409, "Önce şube için etkin bir depo tanımlanmalı.");
            if (await HasOpenCount(db, firmId, branchId, warehouse.Id, context.RequestAborted))
                return Fail(context, "COUNT_IN_PROGRESS", 409, "Depoda sayım açık. Sayım tamamlanana kadar yeni hammadde eklenemez.");
            var duplicate = await db.Ingredients.AsNoTracking().SingleOrDefaultAsync(row => row.Id == command.RequestId, context.RequestAborted);
            if (duplicate is not null)
                return duplicate.FirmId == firmId && duplicate.BranchId == branchId && duplicate.Name == name && duplicate.Unit == unit && duplicate.CriticalBelow == command.CriticalBelow
                    ? Results.Ok(IngredientView(duplicate, warehouse.Id, 0))
                    : Fail(context, "INGREDIENT_ID_CONFLICT", 409, "İstek kimliği farklı içerikle kullanılmış.");
            var now = DateTimeOffset.UtcNow;
            var row = new InventoryIngredientRow { Id = command.RequestId, FirmId = firmId, BranchId = branchId,
                Name = name, NameKey = name.ToUpperInvariant(), Unit = unit, CriticalBelow = command.CriticalBelow,
                CreatedAt = now, UpdatedAt = now };
            db.Ingredients.Add(row);
            Audit(db, firmId, branchId, row.Id, "ingredient_created", DemoAccess.Resolve(context)!.Name, name, now, warehouse.Id, command.RequestId);
            try { await db.SaveChangesAsync(context.RequestAborted); await transaction.CommitAsync(context.RequestAborted); }
            catch (DbUpdateException error) when (Unique(error)) { return Fail(context, "INGREDIENT_EXISTS", 409, "Bu isimde hammadde bu şubede zaten var."); }
            return Results.Created($"/api/v1/firms/{firmId}/branches/{branchId}/inventory/ingredients/{row.Id}", IngredientView(row, warehouse.Id, 0));
        });

        group.MapPut("/ingredients/{ingredientId}", async (string firmId, string branchId, string ingredientId,
            UpdateInventoryIngredient command, HttpContext context, InventoryDbContext db, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            var unit = command.Unit?.Trim().ToLowerInvariant() ?? "";
            if (!Guid.TryParse(command.RequestId, out _) || command.ExpectedVersion < 1 ||
                unit is not ("g" or "kg" or "ml" or "l" or "adet") || !QuantityValid(command.CriticalBelow, true))
                return Fail(context, "INVALID_INGREDIENT_SETTINGS", 400, "İstek kimliği, birim veya kritik eşik geçersiz.");
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await Gate(db, gate, transaction.GetDbTransaction(), firmId, branchId, "inventory.items", context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            var replay = await db.Audit.AsNoTracking().SingleOrDefaultAsync(row => row.FirmId == firmId && row.BranchId == branchId &&
                row.RequestId == command.RequestId, context.RequestAborted);
            if (replay is not null)
            {
                if (replay.EntityId != ingredientId || replay.Action != "ingredient_settings_updated" ||
                    replay.Detail != $"unit={unit};criticalBelow={command.CriticalBelow}")
                    return Fail(context, "REQUEST_ID_CONFLICT", 409, "İstek kimliği farklı içerikle daha önce kullanılmış.");
                var current = await db.Ingredients.AsNoTracking().SingleAsync(row => row.Id == ingredientId && row.FirmId == firmId && row.BranchId == branchId, context.RequestAborted);
                var replayWarehouse = await ResolveWarehouse(db, firmId, branchId, null, context.RequestAborted);
                return Results.Ok(IngredientView(current, replayWarehouse?.Id ?? "", await OnHand(db, firmId, branchId, replayWarehouse?.Id ?? "", ingredientId, context.RequestAborted)));
            }
            var ingredient = await LockIngredient(db, firmId, branchId, ingredientId, context.RequestAborted);
            if (ingredient is null) return Fail(context, "INGREDIENT_NOT_FOUND", 404, "Hammadde bulunamadı.");
            if (ingredient.Version != command.ExpectedVersion) return Fail(context, "VERSION_CONFLICT", 409, "Hammadde başka bir işlemle değişti.");
            if (ingredient.Unit != unit)
            {
                var used = await db.Movements.AnyAsync(row => row.FirmId == firmId && row.BranchId == branchId && row.IngredientId == ingredientId, context.RequestAborted) ||
                    await db.RecipeLines.AnyAsync(row => row.IngredientId == ingredientId, context.RequestAborted) ||
                    await db.CountLines.AnyAsync(row => row.IngredientId == ingredientId, context.RequestAborted);
                if (used) return Fail(context, "UNIT_IN_USE", 409, "Stok, reçete veya sayım geçmişi olan hammaddenin birimi değiştirilemez.");
            }
            var warehouse = await ResolveWarehouse(db, firmId, branchId, null, context.RequestAborted);
            if (warehouse is null) return Fail(context, "WAREHOUSE_NOT_FOUND", 409, "Bu şubede etkin depo bulunamadı.");
            ingredient.Unit = unit;
            ingredient.CriticalBelow = command.CriticalBelow;
            ingredient.Version++;
            ingredient.UpdatedAt = DateTimeOffset.UtcNow;
            Audit(db, firmId, branchId, ingredient.Id, "ingredient_settings_updated", DemoAccess.Resolve(context)!.Name,
                $"unit={unit};criticalBelow={command.CriticalBelow}", ingredient.UpdatedAt, warehouse.Id, command.RequestId);
            await db.SaveChangesAsync(context.RequestAborted);
            await transaction.CommitAsync(context.RequestAborted);
            var onHand = await OnHand(db, firmId, branchId, warehouse.Id, ingredientId, context.RequestAborted);
            return Results.Ok(IngredientView(ingredient, warehouse.Id, onHand));
        });

        group.MapGet("/movements", async (string firmId, string branchId, string? warehouseId, HttpContext context, InventoryDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false);
            if (denied is not null) return denied;
            var warehouse = await ResolveWarehouse(db, firmId, branchId, warehouseId, context.RequestAborted);
            if (warehouse is null) return Fail(context, "WAREHOUSE_NOT_FOUND", 404, "Bu şubede etkin depo bulunamadı.");
            var rows = await db.Movements.AsNoTracking().Where(row => row.FirmId == firmId && row.BranchId == branchId && row.WarehouseId == warehouse.Id)
                .OrderByDescending(row => row.CreatedAt).ThenByDescending(row => row.Id).Take(500).ToListAsync(context.RequestAborted);
            var names = await db.Ingredients.AsNoTracking().Where(row => row.FirmId == firmId && row.BranchId == branchId)
                .ToDictionaryAsync(row => row.Id, row => new { row.Name, row.Unit }, context.RequestAborted);
            return Results.Ok(new { source = "postgres", warehouseId = warehouse.Id, items = rows.Select(row => new InventoryMovementView(row.Id, row.WarehouseId, row.IngredientId,
                names.GetValueOrDefault(row.IngredientId)?.Name ?? "Silinmiş hammadde",
                row.Delta, row.Unit, row.Kind, row.Description, row.CreatedAt, row.Actor)).ToArray() });
        });

        group.MapPost("/movements", async (string firmId, string branchId, AddInventoryMovement command,
            HttpContext context, InventoryDbContext db, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            var description = command.Description?.Trim() ?? "";
            if (!Guid.TryParse(command.RequestId, out _) || command.Kind is not ("manual_in" or "manual_out") ||
                !QuantityValid(command.Delta, allowZero: false) || command.Kind == "manual_in" && command.Delta <= 0 ||
                command.Kind == "manual_out" && command.Delta >= 0 || description.Length is < 3 or > 500)
                return Fail(context, "INVALID_STOCK_MOVEMENT", 400, "Stok hareketi türü, miktarı veya açıklaması geçersiz.");
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await Gate(db, gate, transaction.GetDbTransaction(), firmId, branchId, "inventory.items", context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            var warehouse = await ResolveWarehouse(db, firmId, branchId, command.WarehouseId, context.RequestAborted);
            if (warehouse is null) return Fail(context, "WAREHOUSE_NOT_FOUND", 404, "Depo bu şubede etkin değil.");
            var existing = await db.Movements.AsNoTracking().SingleOrDefaultAsync(row => row.Id == command.RequestId, context.RequestAborted);
            if (existing is not null)
                return existing.FirmId == firmId && existing.BranchId == branchId && existing.WarehouseId == warehouse.Id && existing.IngredientId == command.IngredientId &&
                    existing.Delta == command.Delta && existing.Kind == command.Kind && existing.Description == description
                    ? Results.Ok(MovementView(existing, await db.Ingredients.AsNoTracking().SingleAsync(row => row.Id == existing.IngredientId, context.RequestAborted)))
                    : Fail(context, "MOVEMENT_ID_CONFLICT", 409, "İstek kimliği farklı içerikle kullanılmış.");
            var ingredient = await LockIngredient(db, firmId, branchId, command.IngredientId, context.RequestAborted);
            if (ingredient is null) return Fail(context, "INGREDIENT_NOT_FOUND", 404, "Bu şubede hammadde bulunamadı.");
            if (!ingredient.IsActive) return Fail(context, "INGREDIENT_INACTIVE", 409, "Pasif hammaddeye yeni hareket eklenemez.");
            if (await HasOpenCount(db, firmId, branchId, warehouse.Id, context.RequestAborted))
                return Fail(context, "COUNT_IN_PROGRESS", 409, "Bu depoda sayım açık. Önce sayımı tamamlayın veya iptal edin.");
            var current = await OnHand(db, firmId, branchId, warehouse.Id, ingredient.Id, context.RequestAborted);
            if (current + command.Delta < 0) return Fail(context, "NEGATIVE_STOCK", 409, "Hareket stok miktarını sıfırın altına indiremez.");
            var now = DateTimeOffset.UtcNow;
            var row = new InventoryMovementRow { Id = command.RequestId, FirmId = firmId, BranchId = branchId,
                WarehouseId = warehouse.Id, IngredientId = ingredient.Id, Delta = command.Delta, Unit = ingredient.Unit,
                Kind = command.Kind, Description = description,
                CreatedAt = now, Actor = DemoAccess.Resolve(context)!.Name };
            db.Movements.Add(row);
            ingredient.Version++;
            ingredient.UpdatedAt = now;
            Audit(db, firmId, branchId, row.Id, "movement_added", row.Actor, $"{ingredient.Name}: {row.Delta} {ingredient.Unit} · {description}", now, warehouse.Id, row.Id);
            await db.SaveChangesAsync(context.RequestAborted);
            await transaction.CommitAsync(context.RequestAborted);
            return Results.Created($"/api/v1/firms/{firmId}/branches/{branchId}/inventory/movements/{row.Id}", MovementView(row, ingredient));
        });

        group.MapGet("/recipes", async (string firmId, string branchId, HttpContext context,
            InventoryDbContext db, CatalogDbContext catalog) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false);
            if (denied is not null) return denied;
            var latest = await LatestRecipes(db, firmId, branchId, context.RequestAborted);
            var products = await catalog.Products.AsNoTracking().Where(row => row.FirmId == firmId && latest.Select(recipe => recipe.ProductId).Contains(row.Id))
                .ToDictionaryAsync(row => row.Id, context.RequestAborted);
            var ingredients = await db.Ingredients.AsNoTracking().Where(row => row.FirmId == firmId && row.BranchId == branchId)
                .ToDictionaryAsync(row => row.Id, context.RequestAborted);
            return Results.Ok(new { source = "postgres", items = latest.Where(recipe => products.ContainsKey(recipe.ProductId))
                .Select(recipe => RecipeView(recipe, products[recipe.ProductId].Name, ingredients)).ToArray() });
        });

        group.MapGet("/recipes/{productId}", async (string firmId, string branchId, string productId,
            HttpContext context, InventoryDbContext db, CatalogDbContext catalog) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false);
            if (denied is not null) return denied;
            if (!Guid.TryParse(productId, out var id)) return Fail(context, "PRODUCT_NOT_FOUND", 404, "Ürün bulunamadı.");
            var product = await catalog.Products.AsNoTracking().SingleOrDefaultAsync(row => row.Id == id && row.FirmId == firmId && row.BranchIds.Contains(branchId), context.RequestAborted);
            if (product is null) return Fail(context, "PRODUCT_NOT_FOUND", 404, "Ürün bu şubede bulunamadı.");
            var recipe = await db.Recipes.AsNoTracking().Include(row => row.Lines)
                .Where(row => row.FirmId == firmId && row.BranchId == branchId && row.ProductId == id)
                .OrderByDescending(row => row.Version).FirstOrDefaultAsync(context.RequestAborted);
            if (recipe is null) return Fail(context, "RECIPE_NOT_FOUND", 404, "Bu ürün için kayıtlı reçete yok.");
            var ingredients = await db.Ingredients.AsNoTracking().Where(row => row.FirmId == firmId && row.BranchId == branchId)
                .ToDictionaryAsync(row => row.Id, context.RequestAborted);
            return Results.Ok(RecipeView(recipe, product.Name, ingredients));
        });

        group.MapGet("/production-estimates", async (string firmId, string branchId, string? warehouseId,
            HttpContext context, InventoryDbContext db, CatalogDbContext catalog) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false);
            if (denied is not null) return denied;
            var warehouse = await ResolveWarehouse(db, firmId, branchId, warehouseId, context.RequestAborted);
            if (warehouse is null) return Fail(context, "WAREHOUSE_NOT_FOUND", 404, "Bu şubede etkin depo bulunamadı.");
            var recipes = await LatestRecipes(db, firmId, branchId, context.RequestAborted);
            var products = await catalog.Products.AsNoTracking().Where(row => row.FirmId == firmId &&
                recipes.Select(recipe => recipe.ProductId).Contains(row.Id)).ToDictionaryAsync(row => row.Id, context.RequestAborted);
            var ingredients = await IngredientMap(db, firmId, branchId, context.RequestAborted);
            var ingredientIds = recipes.SelectMany(recipe => recipe.Lines).Select(line => line.IngredientId).Distinct().ToArray();
            var movements = await db.Movements.AsNoTracking().Where(row => row.FirmId == firmId && row.BranchId == branchId &&
                row.WarehouseId == warehouse.Id && ingredientIds.Contains(row.IngredientId)).ToListAsync(context.RequestAborted);
            var balances = movements.GroupBy(row => row.IngredientId).ToDictionary(rows => rows.Key, rows => rows.Sum(row => row.Delta));
            var estimates = recipes.Where(recipe => products.ContainsKey(recipe.ProductId)).Select(recipe =>
            {
                var hasUnitMismatch = recipe.Lines.Any(line => !ingredients.TryGetValue(line.IngredientId, out var ingredient) ||
                    !string.Equals(line.Unit, ingredient.Unit, StringComparison.OrdinalIgnoreCase));
                var lines = recipe.Lines.Select(line =>
                {
                    ingredients.TryGetValue(line.IngredientId, out var ingredient);
                    var onHand = balances.GetValueOrDefault(line.IngredientId);
                    var compatible = ingredient is not null && string.Equals(line.Unit, ingredient.Unit, StringComparison.OrdinalIgnoreCase);
                    decimal? possible = compatible && line.Quantity > 0 ? decimal.Floor(onHand / line.Quantity) : null;
                    return new InventoryProductionLineView(line.IngredientId, ingredient?.Name ?? "Eksik hammadde",
                        onHand, line.Quantity, possible, line.Unit);
                }).ToArray();
                var limiter = hasUnitMismatch ? null : lines.OrderBy(line => line.PossiblePortions).ThenBy(line => line.IngredientId).FirstOrDefault();
                return new InventoryProductionEstimateView(recipe.ProductId.ToString(), products[recipe.ProductId].Name,
                    recipe.Version, recipe.Portion, hasUnitMismatch ? "unit_mismatch" : "ready",
                    hasUnitMismatch ? null : limiter?.PossiblePortions,
                    limiter?.IngredientId, limiter?.IngredientName, lines,
                    hasUnitMismatch
                        ? "Reçete birimi ile hammadde stok birimi uyuşmuyor; teorik üretim hesaplanmadı."
                        : "Teorik kapasitedir; fire, bozulma, diğer ürün tüketimi ve birim dönüşümü hesaba katılmaz.");
            }).ToArray();
            return Results.Ok(new { source = "postgres", warehouseId = warehouse.Id, items = estimates });
        });

        group.MapPut("/recipes/{productId}", async (string firmId, string branchId, string productId,
            SaveInventoryRecipe command, HttpContext context, InventoryDbContext db, CatalogDbContext catalog,
            FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            var portion = command.Portion?.Trim() ?? "";
            if (!Guid.TryParse(command.RequestId, out _) || !Guid.TryParse(productId, out var productGuid) ||
                command.ExpectedVersion < 0 || portion.Length is < 2 or > 120 || command.Lines is not { Length: >= 1 and <= 100 } ||
                command.Lines.Any(line => string.IsNullOrWhiteSpace(line.IngredientId) || !QuantityValid(line.Quantity, false)) ||
                command.Lines.Select(line => line.IngredientId).Distinct().Count() != command.Lines.Length)
                return Fail(context, "INVALID_RECIPE", 400, "Reçete, porsiyon veya kalemler geçersiz.");
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await Gate(db, gate, transaction.GetDbTransaction(), firmId, branchId, "inventory.recipes", context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            var product = await catalog.Products.AsNoTracking().SingleOrDefaultAsync(row => row.Id == productGuid && row.FirmId == firmId && row.BranchIds.Contains(branchId), context.RequestAborted);
            if (product is null) return Fail(context, "PRODUCT_NOT_FOUND", 404, "Ürün bu şubede bulunamadı.");
            var existingRequest = await db.Recipes.AsNoTracking().Include(row => row.Lines)
                .SingleOrDefaultAsync(row => row.Id == command.RequestId, context.RequestAborted);
            if (existingRequest is not null)
                return existingRequest.FirmId == firmId && existingRequest.BranchId == branchId && existingRequest.ProductId == productGuid &&
                    existingRequest.Portion == portion && SameLines(existingRequest.Lines, command.Lines)
                    ? Results.Ok(RecipeView(existingRequest, product.Name, await IngredientMap(db, firmId, branchId, context.RequestAborted)))
                    : Fail(context, "RECIPE_ID_CONFLICT", 409, "İstek kimliği farklı reçete içeriğiyle kullanılmış.");
            var ingredientIds = command.Lines.Select(line => line.IngredientId).ToArray();
            var ingredientRows = await db.Ingredients.Where(row => row.FirmId == firmId && row.BranchId == branchId && ingredientIds.Contains(row.Id))
                .OrderBy(row => row.Id).ToListAsync(context.RequestAborted);
            if (ingredientRows.Count != ingredientIds.Length || ingredientRows.Any(row => !row.IsActive))
                return Fail(context, "INGREDIENT_NOT_AVAILABLE", 409, "Reçetedeki tüm hammaddeler bu şubede aktif olmalı.");
            var ingredientMap = ingredientRows.ToDictionary(row => row.Id);
            if (command.Lines.Any(line => line.Unit is not null && !string.Equals(line.Unit, ingredientMap[line.IngredientId].Unit, StringComparison.OrdinalIgnoreCase)))
                return Fail(context, "UNIT_MISMATCH", 409, "Reçete satır birimi hammadde kartının stok birimiyle aynı olmalı.");
            var previous = await db.Recipes.Where(row => row.FirmId == firmId && row.BranchId == branchId && row.ProductId == productGuid)
                .OrderByDescending(row => row.Version).FirstOrDefaultAsync(context.RequestAborted);
            var currentVersion = previous?.Version ?? 0;
            if (currentVersion != command.ExpectedVersion) return Fail(context, "VERSION_CONFLICT", 409, "Reçete başka bir işlemle değişti.");
            var now = DateTimeOffset.UtcNow;
            var recipe = new InventoryRecipeRow { Id = command.RequestId, FirmId = firmId, BranchId = branchId,
                ProductId = productGuid, Version = currentVersion + 1, Portion = portion, CreatedAt = now,
                CreatedBy = DemoAccess.Resolve(context)!.Name,
                Lines = command.Lines.Select(line => new InventoryRecipeLineRow { RecipeId = command.RequestId,
                    IngredientId = line.IngredientId, Quantity = line.Quantity, Unit = ingredientMap[line.IngredientId].Unit }).ToList() };
            db.Recipes.Add(recipe);
            Audit(db, firmId, branchId, recipe.Id, "recipe_version_created", recipe.CreatedBy, $"{product.Name} · v{recipe.Version}", now);
            try { await db.SaveChangesAsync(context.RequestAborted); await transaction.CommitAsync(context.RequestAborted); }
            catch (DbUpdateException error) when (Unique(error)) { return Fail(context, "RECIPE_VERSION_CONFLICT", 409, "Reçete sürümü aynı anda değişti; yenileyip tekrar deneyin."); }
            return Results.Created($"/api/v1/firms/{firmId}/branches/{branchId}/inventory/recipes/{productGuid}",
                RecipeView(recipe, product.Name, ingredientRows.ToDictionary(row => row.Id)));
        });

        group.MapGet("/counts", async (string firmId, string branchId, string? warehouseId, HttpContext context, InventoryDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false);
            if (denied is not null) return denied;
            var warehouse = await ResolveWarehouse(db, firmId, branchId, warehouseId, context.RequestAborted);
            if (warehouse is null) return Fail(context, "WAREHOUSE_NOT_FOUND", 404, "Bu şubede etkin depo bulunamadı.");
            var rows = await db.Counts.AsNoTracking().Include(row => row.Lines)
                .Where(row => row.FirmId == firmId && row.BranchId == branchId && row.WarehouseId == warehouse.Id)
                .OrderByDescending(row => row.CreatedAt).Take(100).ToListAsync(context.RequestAborted);
            var ids = rows.SelectMany(row => row.Lines).Select(line => line.IngredientId).Distinct().ToArray();
            var ingredients = await db.Ingredients.AsNoTracking().Where(row => ids.Contains(row.Id)).ToDictionaryAsync(row => row.Id, context.RequestAborted);
            return Results.Ok(new { source = "postgres", warehouseId = warehouse.Id, items = rows.Select(row => CountView(row, ingredients)).ToArray() });
        });

        group.MapPost("/counts", async (string firmId, string branchId, CreateInventoryCount command,
            HttpContext context, InventoryDbContext db, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            if (!Guid.TryParse(command.RequestId, out _)) return Fail(context, "INVALID_COUNT", 400, "Sayım istek kimliği geçersiz.");
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await Gate(db, gate, transaction.GetDbTransaction(), firmId, branchId, "inventory.items", context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            blocked = await Gate(db, gate, transaction.GetDbTransaction(), firmId, branchId, "inventory.counts", context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            var warehouse = await ResolveWarehouse(db, firmId, branchId, command.WarehouseId, context.RequestAborted);
            if (warehouse is null) return Fail(context, "WAREHOUSE_NOT_FOUND", 404, "Depo bu şubede etkin değil.");
            var existing = await db.Counts.AsNoTracking().Include(row => row.Lines).SingleOrDefaultAsync(row => row.Id == command.RequestId, context.RequestAborted);
            if (existing is not null)
                return existing.FirmId == firmId && existing.BranchId == branchId && existing.WarehouseId == warehouse.Id
                    ? Results.Ok(CountView(existing, await IngredientMap(db, firmId, branchId, context.RequestAborted)))
                    : Fail(context, "COUNT_ID_CONFLICT", 409, "Sayım kimliği farklı kapsamda kullanılmış.");
            if (await HasOpenCount(db, firmId, branchId, warehouse.Id, context.RequestAborted))
                return Fail(context, "COUNT_IN_PROGRESS", 409, "Bu depoda zaten açık sayım var; önce tamamlayın veya iptal edin.");
            var ingredients = await db.Ingredients.FromSqlInterpolated($"SELECT * FROM inventory.ingredients WHERE firm_id = {firmId} AND branch_id = {branchId} AND is_active ORDER BY id FOR UPDATE")
                .ToListAsync(context.RequestAborted);
            if (ingredients.Count == 0) return Fail(context, "NO_ACTIVE_INGREDIENTS", 409, "Önce aktif hammadde kartı oluşturun.");
            var ids = ingredients.Select(row => row.Id).ToArray();
            var movements = await db.Movements.AsNoTracking().Where(row => row.FirmId == firmId && row.BranchId == branchId &&
                row.WarehouseId == warehouse.Id && ids.Contains(row.IngredientId))
                .ToListAsync(context.RequestAborted);
            var balances = movements.GroupBy(row => row.IngredientId).ToDictionary(grouping => grouping.Key, grouping => grouping.Sum(row => row.Delta));
            var movementCounts = movements.GroupBy(row => row.IngredientId).ToDictionary(grouping => grouping.Key, grouping => grouping.Count());
            var now = DateTimeOffset.UtcNow;
            var count = new InventoryCountRow { Id = command.RequestId, FirmId = firmId, BranchId = branchId, WarehouseId = warehouse.Id,
                CreatedAt = now, CreatedBy = DemoAccess.Resolve(context)!.Name,
                Lines = ingredients.Select(row => new InventoryCountLineRow { CountId = command.RequestId,
                    IngredientId = row.Id, SystemQuantity = balances.GetValueOrDefault(row.Id),
                    MovementCountSnapshot = movementCounts.GetValueOrDefault(row.Id), Unit = row.Unit }).ToList() };
            db.Counts.Add(count);
            Audit(db, firmId, branchId, count.Id, "count_started", count.CreatedBy, $"{count.Lines.Count} hammadde", now, warehouse.Id, command.RequestId);
            try { await db.SaveChangesAsync(context.RequestAborted); }
            catch (DbUpdateException error) when (Unique(error)) { return Fail(context, "COUNT_IN_PROGRESS", 409, "Bu depoda zaten açık sayım var."); }
            await transaction.CommitAsync(context.RequestAborted);
            return Results.Created($"/api/v1/firms/{firmId}/branches/{branchId}/inventory/counts/{count.Id}", CountView(count, ingredients.ToDictionary(row => row.Id)));
        });

        group.MapPut("/counts/{countId}/lines/{ingredientId}", async (string firmId, string branchId, string countId,
            string ingredientId, SetInventoryCountLine command, HttpContext context, InventoryDbContext db, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            if (!QuantityValid(command.PhysicalQuantity, true) || command.ExpectedVersion < 1)
                return Fail(context, "INVALID_COUNT_LINE", 400, "Fiziksel miktar sıfır veya daha büyük, en çok üç ondalık olmalı.");
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await Gate(db, gate, transaction.GetDbTransaction(), firmId, branchId, "inventory.counts", context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            var count = await db.Counts.FromSqlInterpolated($"SELECT * FROM inventory.counts WHERE id = {countId} AND firm_id = {firmId} AND branch_id = {branchId} FOR UPDATE")
                .SingleOrDefaultAsync(context.RequestAborted);
            if (count is null) return Fail(context, "COUNT_NOT_FOUND", 404, "Sayım bulunamadı.");
            if (count.Status != "draft") return Fail(context, "COUNT_NOT_EDITABLE", 409, "Onaylanmış sayım değiştirilemez.");
            if (count.Version != command.ExpectedVersion) return Fail(context, "VERSION_CONFLICT", 409, "Sayım başka bir işlemle değişti.");
            var line = await db.CountLines.SingleOrDefaultAsync(row => row.CountId == countId && row.IngredientId == ingredientId, context.RequestAborted);
            if (line is null) return Fail(context, "COUNT_LINE_NOT_FOUND", 404, "Hammadde bu sayımda bulunamadı.");
            line.PhysicalQuantity = command.PhysicalQuantity;
            count.Version++;
            Audit(db, firmId, branchId, count.Id, "count_line_set", DemoAccess.Resolve(context)!.Name,
                $"{ingredientId}: {command.PhysicalQuantity} {line.Unit}", DateTimeOffset.UtcNow, count.WarehouseId);
            await db.SaveChangesAsync(context.RequestAborted);
            await transaction.CommitAsync(context.RequestAborted);
            return Results.Ok(await GetCountView(db, count, firmId, branchId, context.RequestAborted));
        });

        group.MapPost("/counts/{countId}/approve", async (string firmId, string branchId, string countId,
            ApproveInventoryCount command, HttpContext context, InventoryDbContext db, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            if (!Guid.TryParse(command.RequestId, out _) || command.ExpectedVersion < 1)
                return Fail(context, "INVALID_COUNT_APPROVAL", 400, "Onay kimliği veya sayım sürümü geçersiz.");
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var count = await db.Counts.FromSqlInterpolated($"SELECT * FROM inventory.counts WHERE id = {countId} AND firm_id = {firmId} AND branch_id = {branchId} FOR UPDATE")
                .SingleOrDefaultAsync(context.RequestAborted);
            if (count is null) return Fail(context, "COUNT_NOT_FOUND", 404, "Sayım bulunamadı.");
            if (count.Status == "approved")
                return count.ApprovalRequestId == command.RequestId
                    ? Results.Ok(await GetCountView(db, count, firmId, branchId, context.RequestAborted))
                    : Fail(context, "COUNT_ALREADY_APPROVED", 409, "Bu sayım daha önce onaylandı.");
            if (count.Status == "cancelled") return Fail(context, "COUNT_NOT_EDITABLE", 409, "İptal edilmiş sayım onaylanamaz.");
            var blocked = await Gate(db, gate, transaction.GetDbTransaction(), firmId, branchId, "inventory.items", context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            blocked = await Gate(db, gate, transaction.GetDbTransaction(), firmId, branchId, "inventory.counts", context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            if (count.Version != command.ExpectedVersion) return Fail(context, "VERSION_CONFLICT", 409, "Sayım başka bir işlemle değişti.");
            var lines = await db.CountLines.Where(row => row.CountId == countId).OrderBy(row => row.IngredientId).ToListAsync(context.RequestAborted);
            if (lines.Count == 0 || lines.Any(line => line.PhysicalQuantity is null))
                return Fail(context, "COUNT_INCOMPLETE", 409, "Onaydan önce tüm sayım miktarları girilmelidir.");
            var ingredientIds = lines.Select(line => line.IngredientId).ToArray();
            var ingredients = await db.Ingredients.FromSqlInterpolated($"SELECT * FROM inventory.ingredients WHERE firm_id = {firmId} AND branch_id = {branchId} AND id = ANY({ingredientIds}) ORDER BY id FOR UPDATE")
                .ToDictionaryAsync(row => row.Id, context.RequestAborted);
            if (ingredients.Count != lines.Count) return Fail(context, "INGREDIENT_NOT_AVAILABLE", 409, "Sayımda bulunan hammadde artık bu şubede yok.");
            var movements = await db.Movements.AsNoTracking().Where(row => row.FirmId == firmId && row.BranchId == branchId &&
                row.WarehouseId == count.WarehouseId && ingredientIds.Contains(row.IngredientId))
                .ToListAsync(context.RequestAborted);
            var balances = movements.GroupBy(row => row.IngredientId).ToDictionary(grouping => grouping.Key, grouping => grouping.Sum(row => row.Delta));
            var movementCounts = movements.GroupBy(row => row.IngredientId).ToDictionary(grouping => grouping.Key, grouping => grouping.Count());
            var changed = lines.FirstOrDefault(line => balances.GetValueOrDefault(line.IngredientId) != line.SystemQuantity ||
                movementCounts.GetValueOrDefault(line.IngredientId) != line.MovementCountSnapshot);
            if (changed is not null)
                return Fail(context, "COUNT_STOCK_CHANGED", 409, $"{ingredients[changed.IngredientId].Name} sayımdan sonra hareket gördü. Yeni sayım başlatın.");
            var now = DateTimeOffset.UtcNow;
            foreach (var line in lines)
            {
                var difference = line.PhysicalQuantity!.Value - line.SystemQuantity;
                if (difference == 0) continue;
                var ingredient = ingredients[line.IngredientId];
                var movementId = $"{count.Id}-{ingredient.Id}-adj";
                db.Movements.Add(new InventoryMovementRow { Id = movementId, FirmId = firmId, BranchId = branchId,
                    WarehouseId = count.WarehouseId, IngredientId = ingredient.Id, Delta = difference, Unit = line.Unit,
                    Kind = "count_adjustment", CountId = count.Id,
                    Description = $"Sayım {count.Id} onay düzeltmesi", Actor = DemoAccess.Resolve(context)!.Name, CreatedAt = now });
                Audit(db, firmId, branchId, movementId, "movement_added", DemoAccess.Resolve(context)!.Name,
                    $"{ingredient.Name}: {difference} {line.Unit} · Sayım düzeltmesi", now, count.WarehouseId, movementId);
                ingredient.Version++;
                ingredient.UpdatedAt = now;
            }
            count.Status = "approved";
            count.Version++;
            count.ApprovedAt = now;
            count.ApprovedBy = DemoAccess.Resolve(context)!.Name;
            count.ApprovalRequestId = command.RequestId;
            Audit(db, firmId, branchId, count.Id, "count_approved", count.ApprovedBy,
                $"{lines.Count} satır; {lines.Count(line => line.PhysicalQuantity != line.SystemQuantity)} düzeltme", now, count.WarehouseId, command.RequestId);
            try { await db.SaveChangesAsync(context.RequestAborted); await transaction.CommitAsync(context.RequestAborted); }
            catch (DbUpdateException error) when (Unique(error)) { return Fail(context, "COUNT_APPROVAL_CONFLICT", 409, "Sayım düzeltmesi daha önce oluşturulmuş."); }
            return Results.Ok(await GetCountView(db, count, firmId, branchId, context.RequestAborted));
        });

        group.MapPost("/counts/{countId}/cancel", async (string firmId, string branchId, string countId,
            CancelInventoryCount command, HttpContext context, InventoryDbContext db, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            if (!Guid.TryParse(command.RequestId, out _) || command.ExpectedVersion < 1)
                return Fail(context, "INVALID_COUNT_CANCEL", 400, "İptal isteği veya sayım sürümü geçersiz.");
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await Gate(db, gate, transaction.GetDbTransaction(), firmId, branchId, "inventory.counts", context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            var count = await db.Counts.FromSqlInterpolated($"SELECT * FROM inventory.counts WHERE id = {countId} AND firm_id = {firmId} AND branch_id = {branchId} FOR UPDATE")
                .SingleOrDefaultAsync(context.RequestAborted);
            if (count is null) return Fail(context, "COUNT_NOT_FOUND", 404, "Sayım bulunamadı.");
            if (count.Status == "cancelled")
                return count.CancellationRequestId == command.RequestId
                    ? Results.Ok(await GetCountView(db, count, firmId, branchId, context.RequestAborted))
                    : Fail(context, "COUNT_ALREADY_CANCELLED", 409, "Bu sayım farklı bir istekle iptal edildi.");
            if (count.Status != "draft") return Fail(context, "COUNT_NOT_EDITABLE", 409, "Onaylanmış sayım iptal edilemez.");
            if (count.Version != command.ExpectedVersion) return Fail(context, "VERSION_CONFLICT", 409, "Sayım başka bir işlemle değişti.");
            count.Status = "cancelled";
            count.Version++;
            count.CancellationRequestId = command.RequestId;
            count.CancelledAt = DateTimeOffset.UtcNow;
            count.CancelledBy = DemoAccess.Resolve(context)!.Name;
            Audit(db, firmId, branchId, count.Id, "count_cancelled", DemoAccess.Resolve(context)!.Name,
                "Taslak sayım iptal edildi; snapshot korundu.", count.CancelledAt.Value, count.WarehouseId, command.RequestId);
            await db.SaveChangesAsync(context.RequestAborted);
            await transaction.CommitAsync(context.RequestAborted);
            return Results.Ok(await GetCountView(db, count, firmId, branchId, context.RequestAborted));
        });
    }

    private static async Task<Dictionary<string, InventoryIngredientRow>> IngredientMap(InventoryDbContext db,
        string firmId, string branchId, CancellationToken cancellationToken) =>
        await db.Ingredients.AsNoTracking().Where(row => row.FirmId == firmId && row.BranchId == branchId)
            .ToDictionaryAsync(row => row.Id, cancellationToken);

    private static async Task<List<InventoryRecipeRow>> LatestRecipes(InventoryDbContext db, string firmId,
        string branchId, CancellationToken cancellationToken)
    {
        var all = await db.Recipes.AsNoTracking().Include(row => row.Lines)
            .Where(row => row.FirmId == firmId && row.BranchId == branchId).ToListAsync(cancellationToken);
        return all.GroupBy(row => row.ProductId).Select(grouping => grouping.MaxBy(row => row.Version)!)
            .OrderBy(row => row.ProductId).ToList();
    }

    private static InventoryRecipeView RecipeView(InventoryRecipeRow recipe, string productName,
        IReadOnlyDictionary<string, InventoryIngredientRow> ingredients) => new(recipe.Id, recipe.ProductId.ToString(),
        productName, recipe.Version, recipe.Portion, recipe.CreatedAt, recipe.Lines.OrderBy(line => line.IngredientId)
            .Select(line => ingredients.TryGetValue(line.IngredientId, out var ingredient)
                ? new InventoryRecipeLineView(line.IngredientId, ingredient.Name, line.Quantity, line.Unit)
                : new InventoryRecipeLineView(line.IngredientId, "Eksik hammadde", line.Quantity, "")).ToArray());

    private static bool SameLines(IEnumerable<InventoryRecipeLineRow> rows, IEnumerable<InventoryRecipeLineInput> inputs)
    {
        var existing = rows.ToDictionary(row => row.IngredientId);
        return existing.Count == inputs.Count() && inputs.All(line => existing.TryGetValue(line.IngredientId, out var saved) &&
            saved.Quantity == line.Quantity && (line.Unit is null || string.Equals(saved.Unit, line.Unit, StringComparison.OrdinalIgnoreCase)));
    }

    private static InventoryIngredientView IngredientView(InventoryIngredientRow row, string warehouseId, decimal quantity) =>
        new(row.Id, warehouseId, row.Name, row.Unit, row.CriticalBelow, quantity,
            Math.Max(0m, row.CriticalBelow - quantity), quantity < row.CriticalBelow, row.IsActive, row.Version);

    private static InventoryMovementView MovementView(InventoryMovementRow row, InventoryIngredientRow ingredient) =>
        new(row.Id, row.WarehouseId, row.IngredientId, ingredient.Name, row.Delta, row.Unit, row.Kind, row.Description, row.CreatedAt, row.Actor);

    private static InventoryCountView CountView(InventoryCountRow count, IReadOnlyDictionary<string, InventoryIngredientRow> ingredients) =>
        new(count.Id, count.WarehouseId, count.Status, count.Version, count.CreatedAt, count.CreatedBy, count.ApprovedAt, count.ApprovedBy,
            count.CancelledAt, count.CancelledBy,
            count.Lines.OrderBy(line => line.IngredientId).Select(line => ingredients.TryGetValue(line.IngredientId, out var ingredient)
                ? CountLineView(line, ingredient.Name)
                : CountLineView(line, "Eksik hammadde")).ToArray());

    private static InventoryCountLineView CountLineView(InventoryCountLineRow line, string ingredientName)
    {
        decimal? difference = line.PhysicalQuantity is null ? null : line.PhysicalQuantity.Value - line.SystemQuantity;
        var reviewStatus = difference is null ? "awaiting_count" : difference != 0 ? "review_required" : "matched";
        return new InventoryCountLineView(line.IngredientId, ingredientName, line.Unit, line.SystemQuantity,
            line.PhysicalQuantity, difference, reviewStatus);
    }

    private static async Task<InventoryCountView> GetCountView(InventoryDbContext db, InventoryCountRow count,
        string firmId, string branchId, CancellationToken cancellationToken)
    {
        count.Lines = await db.CountLines.AsNoTracking().Where(line => line.CountId == count.Id).ToListAsync(cancellationToken);
        return CountView(count, await IngredientMap(db, firmId, branchId, cancellationToken));
    }

    private static async Task<InventoryIngredientRow?> LockIngredient(InventoryDbContext db, string firmId,
        string branchId, string ingredientId, CancellationToken cancellationToken) =>
        await db.Ingredients.FromSqlInterpolated($"SELECT * FROM inventory.ingredients WHERE id = {ingredientId} AND firm_id = {firmId} AND branch_id = {branchId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);

    private static async Task<decimal> OnHand(InventoryDbContext db, string firmId, string branchId, string warehouseId,
        string ingredientId, CancellationToken cancellationToken) =>
        await db.Movements.Where(row => row.FirmId == firmId && row.BranchId == branchId && row.WarehouseId == warehouseId && row.IngredientId == ingredientId)
            .Select(row => (decimal?)row.Delta).SumAsync(cancellationToken) ?? 0m;

    private static async Task<InventoryWarehouseRow?> ResolveWarehouse(InventoryDbContext db, string firmId,
        string branchId, string? warehouseId, CancellationToken cancellationToken)
    {
        var warehouses = db.Warehouses.AsNoTracking().Where(row => row.FirmId == firmId && row.BranchId == branchId && row.IsActive);
        if (!string.IsNullOrWhiteSpace(warehouseId))
            return await warehouses.SingleOrDefaultAsync(row => row.Id == warehouseId, cancellationToken);
        var active = await warehouses.OrderBy(row => row.Name).ThenBy(row => row.Id).Take(2).ToListAsync(cancellationToken);
        return active.Count == 1 ? active[0] : null;
    }

    private static Task<bool> HasOpenCount(InventoryDbContext db, string firmId, string branchId,
        string warehouseId, CancellationToken cancellationToken) => db.Counts.AsNoTracking().AnyAsync(row =>
            row.FirmId == firmId && row.BranchId == branchId && row.WarehouseId == warehouseId && row.Status == "draft", cancellationToken);

    private static async Task<FeatureFailure?> Gate(InventoryDbContext db, FeatureNewWorkGate gate,
        DbTransaction transaction, string firmId, string branchId, string feature, CancellationToken cancellationToken) =>
        await gate.CheckAndLockAsync(db.Database.GetDbConnection(), transaction, firmId, branchId, feature, cancellationToken);

    private static bool QuantityValid(decimal quantity, bool allowZero) =>
        (allowZero ? quantity >= 0 : quantity != 0) && quantity <= 999999999999999m && decimal.Round(quantity, 3) == quantity;

    private static void Audit(InventoryDbContext db, string firmId, string branchId, string entityId,
        string action, string actor, string detail, DateTimeOffset now, string? warehouseId = null, string? requestId = null) =>
        db.Audit.Add(new InventoryAuditRow { FirmId = firmId, BranchId = branchId, EntityId = entityId,
            WarehouseId = warehouseId, RequestId = requestId, Action = action, Actor = actor, Detail = detail, OccurredAt = now });

    private static bool Unique(DbUpdateException error) =>
        error.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };

    private static IResult? Guard(HttpContext context, string firmId, string branchId, bool ready, bool write)
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Fail(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanRead(firmId, branchId) || write && !actor.CanManage)
            return Fail(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubede stok erişim izni yok.");
        if (!ready) return Fail(context, "INVENTORY_STORAGE_UNAVAILABLE", 503, "Stok migration'ı uygulanmalı ve API yeniden başlatılmalı.");
        return null;
    }

    private static IResult Fail(HttpContext context, string code, int status, string detail) => Results.Json(new
    {
        type = $"https://hipos.local/problems/{code.ToLowerInvariant().Replace('_', '-')}",
        title = status switch { 401 => "Oturum gerekli", 403 => "Yetkisiz kapsam", 404 => "Bulunamadı", 409 => "İşlem çakışması", 503 => "Kurulum gerekiyor", _ => "İstek hatası" },
        status, detail, instance = context.Request.Path.Value, code, traceId = context.TraceIdentifier,
    }, statusCode: status, contentType: "application/problem+json");
}
