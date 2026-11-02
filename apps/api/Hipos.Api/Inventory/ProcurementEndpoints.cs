using Hipos.Api.Cari;
using Hipos.Api.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace Hipos.Api.Inventory;

public sealed record PurchaseLineInput(string IngredientId, decimal Quantity, long UnitPriceMinor,
    int DiscountRateBps, int TaxRateBps);
public sealed record CreatePurchaseDraft(string RequestId, string WarehouseId, string SupplierCariId,
    string DocumentNumber, DateOnly DocumentDate, PurchaseLineInput[] Lines);
public sealed record ApprovePurchase(string RequestId, int ExpectedVersion);
public sealed record CorrectPurchaseDelivery(string RequestId, string PurchaseLineId, decimal Quantity, string Reason);
public sealed record ReturnPurchaseDelivery(string RequestId, string PurchaseLineId, string DocumentNumber,
    DateOnly DocumentDate, decimal Quantity, string Reason);

public static class ProcurementEndpoints
{
    public static IEndpointRouteBuilder MapProcurementEndpoints(this IEndpointRouteBuilder app, bool ready)
    {
        var group = app.MapGroup("/api/v1/firms/{firmId}/branches/{branchId}/inventory/purchases");

        group.MapGet("", async (string firmId, string branchId, HttpContext context,
            InventoryDbContext db, CariDbContext cari) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false);
            if (denied is not null) return denied;
            var rows = await db.Purchases.AsNoTracking().Include(row => row.Lines).Include(row => row.Corrections).Include(row => row.Returns)
                .Where(row => row.FirmId == firmId && row.BranchId == branchId)
                .OrderByDescending(row => row.CreatedAt).Take(200).ToListAsync(context.RequestAborted);
            var supplierIds = rows.Select(row => row.SupplierCariId).Distinct().ToArray();
            var suppliers = await cari.Parties.AsNoTracking().Where(row => row.FirmId == firmId &&
                row.BranchId == branchId && supplierIds.Contains(row.Id))
                .ToDictionaryAsync(row => row.Id, row => row.Name, context.RequestAborted);
            var ingredientIds = rows.SelectMany(row => row.Lines).Select(row => row.IngredientId).Distinct().ToArray();
            var ingredients = await db.Ingredients.AsNoTracking().Where(row => row.FirmId == firmId &&
                row.BranchId == branchId && ingredientIds.Contains(row.Id))
                .ToDictionaryAsync(row => row.Id, row => row.Name, context.RequestAborted);
            return Results.Ok(new { source = "postgres", items = rows.Select(row => View(row,
                suppliers.GetValueOrDefault(row.SupplierCariId) ?? "Silinmiş tedarikçi", ingredients)).ToArray() });
        });

        group.MapPost("", async (string firmId, string branchId, CreatePurchaseDraft command,
            HttpContext context, InventoryDbContext db, CariDbContext cari, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            var documentNumber = command.DocumentNumber?.Trim() ?? "";
            if (!Guid.TryParse(command.RequestId, out _) || documentNumber.Length is < 1 or > 100 ||
                command.DocumentDate.Year is < 2000 or > 2100 || command.Lines is not { Length: >= 1 and <= 100 })
                return Fail(context, "INVALID_PURCHASE_DRAFT", 400, "Belge kimliği, tarihi, numarası veya satırları geçersiz.");
            if (command.Lines.Select(line => line.IngredientId).Distinct().Count() != command.Lines.Length)
                return Fail(context, "DUPLICATE_PURCHASE_LINE", 400, "Aynı hammadde belgede birden fazla satırda kullanılamaz.");
            if (command.Lines.Any(line => !LineValid(line)))
                return Fail(context, "INVALID_PURCHASE_LINE", 400, "Miktar, fiyat, iskonto veya KDV oranı geçersiz.");

            var supplier = await cari.Parties.AsNoTracking().SingleOrDefaultAsync(row => row.Id == command.SupplierCariId &&
                row.FirmId == firmId && row.BranchId == branchId, context.RequestAborted);
            if (supplier is null || !supplier.IsActive || !supplier.Types.Contains("supplier"))
                return Fail(context, "SUPPLIER_NOT_FOUND", 404, "Etkin tedarikçi cari kartı bulunamadı.");

            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction(),
                firmId, branchId, "procurement.requests", context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            var existing = await db.Purchases.AsNoTracking().Include(row => row.Lines)
                .SingleOrDefaultAsync(row => row.Id == command.RequestId, context.RequestAborted);
            if (existing is not null)
                return existing.FirmId == firmId && existing.BranchId == branchId
                    ? Results.Ok(View(existing, supplier.Name, await IngredientNames(db, firmId, branchId, existing.Lines, context.RequestAborted)))
                    : Fail(context, "PURCHASE_ID_CONFLICT", 409, "Taslak kimliği farklı kapsamda kullanılmış.");
            var warehouse = await db.Warehouses.SingleOrDefaultAsync(row => row.Id == command.WarehouseId &&
                row.FirmId == firmId && row.BranchId == branchId && row.IsActive, context.RequestAborted);
            if (warehouse is null) return Fail(context, "WAREHOUSE_NOT_FOUND", 404, "Etkin depo bulunamadı.");
            var ids = command.Lines.Select(line => line.IngredientId).ToArray();
            var ingredients = await db.Ingredients.Where(row => row.FirmId == firmId && row.BranchId == branchId &&
                row.IsActive && ids.Contains(row.Id)).ToDictionaryAsync(row => row.Id, context.RequestAborted);
            if (ingredients.Count != ids.Length) return Fail(context, "INGREDIENT_NOT_FOUND", 404, "Belgedeki hammaddelerden biri bulunamadı veya pasif.");

            var now = DateTimeOffset.UtcNow;
            var purchase = new InventoryPurchaseRow { Id = command.RequestId, FirmId = firmId, BranchId = branchId,
                WarehouseId = warehouse.Id, SupplierCariId = supplier.Id, DocumentNumber = documentNumber,
                DocumentDate = command.DocumentDate, CreatedAt = now, CreatedBy = DemoAccess.Resolve(context)!.Name };
            foreach (var input in command.Lines)
            {
                var amounts = Amounts(input);
                purchase.Lines.Add(new InventoryPurchaseLineRow { Id = Guid.NewGuid().ToString(), PurchaseId = purchase.Id,
                    IngredientId = input.IngredientId, Quantity = input.Quantity, Unit = ingredients[input.IngredientId].Unit,
                    UnitPriceMinor = input.UnitPriceMinor, DiscountRateBps = input.DiscountRateBps, TaxRateBps = input.TaxRateBps,
                    SubtotalMinor = amounts.Subtotal, DiscountMinor = amounts.Discount, NetMinor = amounts.Net,
                    TaxMinor = amounts.Tax, TotalMinor = amounts.Total });
            }
            purchase.SubtotalMinor = purchase.Lines.Sum(line => line.SubtotalMinor);
            purchase.DiscountMinor = purchase.Lines.Sum(line => line.DiscountMinor);
            purchase.TaxMinor = purchase.Lines.Sum(line => line.TaxMinor);
            purchase.TotalMinor = purchase.Lines.Sum(line => line.TotalMinor);
            db.Purchases.Add(purchase);
            db.Audit.Add(new InventoryAuditRow { FirmId = firmId, BranchId = branchId, WarehouseId = warehouse.Id,
                EntityId = purchase.Id, Action = "purchase_draft_created", RequestId = purchase.Id,
                Actor = purchase.CreatedBy, Detail = $"{documentNumber} · {purchase.TotalMinor} kuruş", OccurredAt = now });
            try { await db.SaveChangesAsync(context.RequestAborted); await transaction.CommitAsync(context.RequestAborted); }
            catch (DbUpdateException error) when (error.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
            { return Fail(context, "PURCHASE_DOCUMENT_EXISTS", 409, "Bu belge numarası şubede daha önce kullanılmış."); }
            return Results.Created($"{context.Request.Path}/{purchase.Id}", View(purchase, supplier.Name,
                ingredients.ToDictionary(row => row.Key, row => row.Value.Name)));
        });

        group.MapPost("/{purchaseId}/approve", async (string firmId, string branchId, string purchaseId,
            ApprovePurchase command, HttpContext context, InventoryDbContext db, CariDbContext cari,
            FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            if (!Guid.TryParse(command.RequestId, out _) || command.ExpectedVersion < 1)
                return Fail(context, "INVALID_PURCHASE_APPROVAL", 400, "Onay kimliği veya belge sürümü geçersiz.");
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            foreach (var feature in new[] { "procurement.requests", "inventory.items", "cari.management" })
            {
                var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction(),
                    firmId, branchId, feature, context.RequestAborted);
                if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            }
            var purchase = await db.Purchases.FromSqlInterpolated($"SELECT * FROM inventory.purchases WHERE id = {purchaseId} AND firm_id = {firmId} AND branch_id = {branchId} FOR UPDATE")
                .SingleOrDefaultAsync(context.RequestAborted);
            if (purchase is null) return Fail(context, "PURCHASE_NOT_FOUND", 404, "Mal kabul taslağı bulunamadı.");
            await db.Entry(purchase).Collection(row => row.Lines).LoadAsync(context.RequestAborted);
            if (purchase.Status == "approved")
                return purchase.ApprovalRequestId == command.RequestId
                    ? Results.Ok(View(purchase, "", await IngredientNames(db, firmId, branchId, purchase.Lines, context.RequestAborted)))
                    : Fail(context, "PURCHASE_ALREADY_APPROVED", 409, "Mal kabul daha önce onaylandı.");
            if (purchase.Version != command.ExpectedVersion)
                return Fail(context, "VERSION_CONFLICT", 409, "Mal kabul taslağı başka bir işlemle değişti.");
            if (await db.Counts.AnyAsync(row => row.FirmId == firmId && row.BranchId == branchId &&
                row.WarehouseId == purchase.WarehouseId && row.Status == "draft", context.RequestAborted))
                return Fail(context, "COUNT_IN_PROGRESS", 409, "Bu depoda sayım açık. Mal kabul sayım tamamlandıktan sonra onaylanabilir.");

            cari.Database.SetDbConnection(db.Database.GetDbConnection(), false);
            await cari.Database.UseTransactionAsync(transaction.GetDbTransaction(), context.RequestAborted);
            var supplier = await cari.Parties.FromSqlInterpolated($"SELECT * FROM cari.parties WHERE id = {purchase.SupplierCariId} AND firm_id = {firmId} AND branch_id = {branchId} FOR UPDATE")
                .SingleOrDefaultAsync(context.RequestAborted);
            if (supplier is null || !supplier.IsActive || !supplier.Types.Contains("supplier"))
                return Fail(context, "SUPPLIER_NOT_AVAILABLE", 409, "Tedarikçi cari kartı onay için uygun değil.");
            var ingredientIds = purchase.Lines.Select(line => line.IngredientId).ToArray();
            var ingredients = await db.Ingredients.Where(row => row.FirmId == firmId && row.BranchId == branchId &&
                ingredientIds.Contains(row.Id)).ToDictionaryAsync(row => row.Id, context.RequestAborted);
            if (ingredients.Count != ingredientIds.Length || ingredients.Values.Any(row => !row.IsActive))
                return Fail(context, "INGREDIENT_NOT_AVAILABLE", 409, "Belgedeki hammaddelerden biri onay için uygun değil.");
            var now = DateTimeOffset.UtcNow;
            var actor = DemoAccess.Resolve(context)!.Name;
            foreach (var line in purchase.Lines)
            {
                db.Movements.Add(new InventoryMovementRow { Id = line.Id, FirmId = firmId, BranchId = branchId,
                    WarehouseId = purchase.WarehouseId, IngredientId = line.IngredientId, Delta = line.Quantity,
                    Unit = line.Unit, Kind = "receiving", PurchaseId = purchase.Id,
                    Description = $"Mal kabul {purchase.DocumentNumber}", CreatedAt = now, Actor = actor });
                ingredients[line.IngredientId].Version++;
                ingredients[line.IngredientId].UpdatedAt = now;
            }
            cari.Movements.Add(new CariMovementRow { Id = command.RequestId, FirmId = firmId, BranchId = branchId,
                PartyId = supplier.Id, Kind = "supplier", EntryType = "supplier_debt", DeltaMinor = purchase.TotalMinor,
                Currency = "TRY", Description = $"Mal kabul {purchase.DocumentNumber}", Reference = purchase.DocumentNumber,
                EffectiveDate = purchase.DocumentDate, Source = "purchase", Actor = actor, CreatedAt = now });
            cari.Audit.Add(new CariAuditRow { FirmId = firmId, BranchId = branchId, PartyId = supplier.Id,
                Action = "movement_added", Actor = actor, Detail = $"supplier_debt · {purchase.TotalMinor} · {purchase.DocumentNumber}", OccurredAt = now });
            purchase.Status = "approved"; purchase.Version++; purchase.ApprovedAt = now;
            purchase.ApprovedBy = actor; purchase.ApprovalRequestId = command.RequestId;
            db.Audit.Add(new InventoryAuditRow { FirmId = firmId, BranchId = branchId, WarehouseId = purchase.WarehouseId,
                EntityId = purchase.Id, Action = "purchase_approved", RequestId = command.RequestId, Actor = actor,
                Detail = $"{purchase.DocumentNumber} · {purchase.TotalMinor} kuruş", OccurredAt = now });
            await db.SaveChangesAsync(context.RequestAborted);
            await cari.SaveChangesAsync(context.RequestAborted);
            await transaction.CommitAsync(context.RequestAborted);
            return Results.Ok(View(purchase, supplier.Name, ingredients.ToDictionary(row => row.Key, row => row.Value.Name)));
        });

        group.MapPost("/{purchaseId}/corrections", async (string firmId, string branchId, string purchaseId,
            CorrectPurchaseDelivery command, HttpContext context, InventoryDbContext db, CariDbContext cari,
            FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            var reason = command.Reason?.Trim() ?? "";
            if (!Guid.TryParse(command.RequestId, out _) || command.Quantity <= 0 ||
                decimal.Round(command.Quantity, 3) != command.Quantity || reason.Length is < 3 or > 500)
                return Fail(context, "INVALID_PURCHASE_CORRECTION", 400, "Düzeltme miktarı veya açıklaması geçersiz.");

            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            foreach (var feature in new[] { "procurement.requests", "inventory.items", "cari.management" })
            {
                var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction(),
                    firmId, branchId, feature, context.RequestAborted);
                if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            }
            var existing = await db.PurchaseCorrections.AsNoTracking()
                .SingleOrDefaultAsync(row => row.Id == command.RequestId, context.RequestAborted);
            if (existing is not null)
                return existing.PurchaseId == purchaseId && existing.PurchaseLineId == command.PurchaseLineId &&
                    existing.Quantity == command.Quantity && existing.Reason == reason
                    ? Results.Ok(CorrectionView(existing))
                    : Fail(context, "PURCHASE_CORRECTION_ID_CONFLICT", 409, "Düzeltme kimliği başka bir işlemde kullanılmış.");

            var purchase = await db.Purchases.FromSqlInterpolated($"SELECT * FROM inventory.purchases WHERE id = {purchaseId} AND firm_id = {firmId} AND branch_id = {branchId} FOR UPDATE")
                .SingleOrDefaultAsync(context.RequestAborted);
            if (purchase is null) return Fail(context, "PURCHASE_NOT_FOUND", 404, "Mal kabul belgesi bulunamadı.");
            if (purchase.Status != "approved")
                return Fail(context, "PURCHASE_NOT_APPROVED", 409, "Yalnız onaylı mal kabul belgesi düzeltilebilir.");
            await db.Entry(purchase).Collection(row => row.Lines).LoadAsync(context.RequestAborted);
            await db.Entry(purchase).Collection(row => row.Corrections).LoadAsync(context.RequestAborted);
            await db.Entry(purchase).Collection(row => row.Returns).LoadAsync(context.RequestAborted);
            var line = purchase.Lines.SingleOrDefault(row => row.Id == command.PurchaseLineId);
            if (line is null) return Fail(context, "PURCHASE_LINE_NOT_FOUND", 404, "Düzeltilecek mal kabul satırı bulunamadı.");
            var prior = purchase.Corrections.Where(row => row.PurchaseLineId == line.Id).ToArray();
            var remainingQuantity = line.Quantity - prior.Sum(row => row.Quantity) -
                purchase.Returns.Where(row => row.PurchaseLineId == line.Id).Sum(row => row.Quantity);
            if (command.Quantity > remainingQuantity)
                return Fail(context, "PURCHASE_CORRECTION_EXCEEDS_RECEIPT", 409,
                    $"En fazla {remainingQuantity:0.###} {line.Unit} için düzeltme yapılabilir.");
            if (await db.Counts.AnyAsync(row => row.FirmId == firmId && row.BranchId == branchId &&
                row.WarehouseId == purchase.WarehouseId && row.Status == "draft", context.RequestAborted))
                return Fail(context, "COUNT_IN_PROGRESS", 409, "Bu depoda sayım açık. Düzeltme sayım tamamlandıktan sonra yapılabilir.");
            var onHand = await db.Movements.Where(row => row.FirmId == firmId && row.BranchId == branchId &&
                row.WarehouseId == purchase.WarehouseId && row.IngredientId == line.IngredientId)
                .SumAsync(row => row.Delta, context.RequestAborted);
            if (onHand < command.Quantity)
                return Fail(context, "INSUFFICIENT_STOCK", 409, $"Düzeltme için stok yetersiz. Mevcut: {onHand:0.###} {line.Unit}.");

            cari.Database.SetDbConnection(db.Database.GetDbConnection(), false);
            await cari.Database.UseTransactionAsync(transaction.GetDbTransaction(), context.RequestAborted);
            var supplier = await cari.Parties.FromSqlInterpolated($"SELECT * FROM cari.parties WHERE id = {purchase.SupplierCariId} AND firm_id = {firmId} AND branch_id = {branchId} FOR UPDATE")
                .SingleOrDefaultAsync(context.RequestAborted);
            if (supplier is null || !supplier.IsActive || !supplier.Types.Contains("supplier"))
                return Fail(context, "SUPPLIER_NOT_AVAILABLE", 409, "Tedarikçi cari kartı düzeltme için uygun değil.");

            var isFinal = command.Quantity == remainingQuantity;
            long Part(long original, Func<InventoryPurchaseCorrectionRow, long> selector) => isFinal
                ? original - prior.Sum(selector)
                : (long)decimal.Round(original * command.Quantity / line.Quantity, 0, MidpointRounding.AwayFromZero);
            var correction = new InventoryPurchaseCorrectionRow { Id = command.RequestId, PurchaseId = purchase.Id,
                PurchaseLineId = line.Id, Quantity = command.Quantity, Unit = line.Unit, Reason = reason,
                SubtotalMinor = Part(line.SubtotalMinor, row => row.SubtotalMinor),
                DiscountMinor = Part(line.DiscountMinor, row => row.DiscountMinor),
                NetMinor = Part(line.NetMinor, row => row.NetMinor), TaxMinor = Part(line.TaxMinor, row => row.TaxMinor),
                TotalMinor = Part(line.TotalMinor, row => row.TotalMinor), CreatedAt = DateTimeOffset.UtcNow,
                CreatedBy = DemoAccess.Resolve(context)!.Name };
            if (correction.TotalMinor <= 0)
                return Fail(context, "PURCHASE_CORRECTION_AMOUNT_TOO_SMALL", 400, "Düzeltme tutarı en az 1 kuruş olmalıdır.");
            db.PurchaseCorrections.Add(correction);
            db.Movements.Add(new InventoryMovementRow { Id = Guid.NewGuid().ToString(), FirmId = firmId, BranchId = branchId,
                WarehouseId = purchase.WarehouseId, IngredientId = line.IngredientId, Delta = -command.Quantity,
                Unit = line.Unit, Kind = "purchase_correction", PurchaseCorrectionId = correction.Id,
                Description = $"Eksik teslim düzeltmesi {purchase.DocumentNumber}: {reason}", CreatedAt = correction.CreatedAt,
                Actor = correction.CreatedBy });
            cari.Movements.Add(new CariMovementRow { Id = correction.Id, FirmId = firmId, BranchId = branchId,
                PartyId = supplier.Id, Kind = "supplier", EntryType = "adjustment_decrease", DeltaMinor = -correction.TotalMinor,
                Currency = "TRY", Description = $"Eksik teslim düzeltmesi {purchase.DocumentNumber}: {reason}",
                Reference = purchase.DocumentNumber, EffectiveDate = DateOnly.FromDateTime(correction.CreatedAt.Date),
                Source = "adjustment", Actor = correction.CreatedBy, CreatedAt = correction.CreatedAt });
            cari.Audit.Add(new CariAuditRow { FirmId = firmId, BranchId = branchId, PartyId = supplier.Id,
                Action = "movement_added", Actor = correction.CreatedBy,
                Detail = $"adjustment_decrease · {-correction.TotalMinor} · {purchase.DocumentNumber}", OccurredAt = correction.CreatedAt });
            db.Audit.Add(new InventoryAuditRow { FirmId = firmId, BranchId = branchId, WarehouseId = purchase.WarehouseId,
                EntityId = purchase.Id, Action = "purchase_corrected", RequestId = correction.Id,
                Actor = correction.CreatedBy, Detail = $"{line.IngredientId} · {-command.Quantity:0.###} {line.Unit} · {reason}", OccurredAt = correction.CreatedAt });
            var ingredient = await db.Ingredients.SingleAsync(row => row.Id == line.IngredientId && row.FirmId == firmId && row.BranchId == branchId, context.RequestAborted);
            ingredient.Version++; ingredient.UpdatedAt = correction.CreatedAt;
            await db.SaveChangesAsync(context.RequestAborted);
            await cari.SaveChangesAsync(context.RequestAborted);
            await transaction.CommitAsync(context.RequestAborted);
            return Results.Created($"{context.Request.Path}/{correction.Id}", CorrectionView(correction));
        });

        group.MapPost("/{purchaseId}/returns", async (string firmId, string branchId, string purchaseId,
            ReturnPurchaseDelivery command, HttpContext context, InventoryDbContext db, CariDbContext cari,
            FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            var documentNumber = command.DocumentNumber?.Trim() ?? "";
            var reason = command.Reason?.Trim() ?? "";
            if (!Guid.TryParse(command.RequestId, out _) || documentNumber.Length is < 1 or > 100 ||
                command.DocumentDate.Year is < 2000 or > 2100 || command.Quantity <= 0 ||
                decimal.Round(command.Quantity, 3) != command.Quantity || reason.Length is < 3 or > 500)
                return Fail(context, "INVALID_PURCHASE_RETURN", 400, "İade belgesi, miktarı, tarihi veya açıklaması geçersiz.");

            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            foreach (var feature in new[] { "procurement.requests", "inventory.items", "cari.management" })
            {
                var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction(),
                    firmId, branchId, feature, context.RequestAborted);
                if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            }
            var existing = await db.PurchaseReturns.AsNoTracking()
                .SingleOrDefaultAsync(row => row.Id == command.RequestId, context.RequestAborted);
            if (existing is not null)
                return existing.PurchaseId == purchaseId && existing.PurchaseLineId == command.PurchaseLineId &&
                    existing.DocumentNumber == documentNumber && existing.DocumentDate == command.DocumentDate &&
                    existing.Quantity == command.Quantity && existing.Reason == reason
                    ? Results.Ok(ReturnView(existing))
                    : Fail(context, "PURCHASE_RETURN_ID_CONFLICT", 409, "İade kimliği başka bir işlemde kullanılmış.");

            var purchase = await db.Purchases.FromSqlInterpolated($"SELECT * FROM inventory.purchases WHERE id = {purchaseId} AND firm_id = {firmId} AND branch_id = {branchId} FOR UPDATE")
                .SingleOrDefaultAsync(context.RequestAborted);
            if (purchase is null) return Fail(context, "PURCHASE_NOT_FOUND", 404, "Mal kabul belgesi bulunamadı.");
            if (purchase.Status != "approved")
                return Fail(context, "PURCHASE_NOT_APPROVED", 409, "Yalnız onaylı mal kabul belgesinden iade oluşturulabilir.");
            await db.Entry(purchase).Collection(row => row.Lines).LoadAsync(context.RequestAborted);
            await db.Entry(purchase).Collection(row => row.Corrections).LoadAsync(context.RequestAborted);
            await db.Entry(purchase).Collection(row => row.Returns).LoadAsync(context.RequestAborted);
            var line = purchase.Lines.SingleOrDefault(row => row.Id == command.PurchaseLineId);
            if (line is null) return Fail(context, "PURCHASE_LINE_NOT_FOUND", 404, "İade edilecek mal kabul satırı bulunamadı.");
            var priorReturns = purchase.Returns.Where(row => row.PurchaseLineId == line.Id).ToArray();
            var correctedQuantity = purchase.Corrections.Where(row => row.PurchaseLineId == line.Id).Sum(row => row.Quantity);
            var remainingQuantity = line.Quantity - correctedQuantity - priorReturns.Sum(row => row.Quantity);
            if (command.Quantity > remainingQuantity)
                return Fail(context, "PURCHASE_RETURN_EXCEEDS_RECEIPT", 409,
                    $"En fazla {remainingQuantity:0.###} {line.Unit} tedarikçiye iade edilebilir.");
            if (await db.Counts.AnyAsync(row => row.FirmId == firmId && row.BranchId == branchId &&
                row.WarehouseId == purchase.WarehouseId && row.Status == "draft", context.RequestAborted))
                return Fail(context, "COUNT_IN_PROGRESS", 409, "Bu depoda sayım açık. İade sayım tamamlandıktan sonra yapılabilir.");
            var onHand = await db.Movements.Where(row => row.FirmId == firmId && row.BranchId == branchId &&
                row.WarehouseId == purchase.WarehouseId && row.IngredientId == line.IngredientId)
                .SumAsync(row => row.Delta, context.RequestAborted);
            if (onHand < command.Quantity)
                return Fail(context, "INSUFFICIENT_STOCK", 409, $"İade için stok yetersiz. Mevcut: {onHand:0.###} {line.Unit}.");
            if (await db.PurchaseReturns.AnyAsync(row => row.FirmId == firmId && row.BranchId == branchId &&
                row.DocumentNumber == documentNumber, context.RequestAborted))
                return Fail(context, "PURCHASE_RETURN_DOCUMENT_EXISTS", 409, "Bu iade irsaliye numarası şubede daha önce kullanılmış.");

            cari.Database.SetDbConnection(db.Database.GetDbConnection(), false);
            await cari.Database.UseTransactionAsync(transaction.GetDbTransaction(), context.RequestAborted);
            var supplier = await cari.Parties.FromSqlInterpolated($"SELECT * FROM cari.parties WHERE id = {purchase.SupplierCariId} AND firm_id = {firmId} AND branch_id = {branchId} FOR UPDATE")
                .SingleOrDefaultAsync(context.RequestAborted);
            if (supplier is null || !supplier.IsActive || !supplier.Types.Contains("supplier"))
                return Fail(context, "SUPPLIER_NOT_AVAILABLE", 409, "Tedarikçi cari kartı iade için uygun değil.");

            var isFinal = command.Quantity == remainingQuantity;
            long Removed(Func<InventoryPurchaseCorrectionRow, long> correctionSelector,
                Func<InventoryPurchaseReturnRow, long> returnSelector) =>
                purchase.Corrections.Where(row => row.PurchaseLineId == line.Id).Sum(correctionSelector) + priorReturns.Sum(returnSelector);
            long Part(long original, Func<InventoryPurchaseCorrectionRow, long> correctionSelector,
                Func<InventoryPurchaseReturnRow, long> returnSelector) => isFinal
                ? original - Removed(correctionSelector, returnSelector)
                : (long)decimal.Round(original * command.Quantity / line.Quantity, 0, MidpointRounding.AwayFromZero);
            var returned = new InventoryPurchaseReturnRow { Id = command.RequestId, FirmId = firmId, BranchId = branchId,
                PurchaseId = purchase.Id, PurchaseLineId = line.Id, DocumentNumber = documentNumber,
                DocumentDate = command.DocumentDate, Quantity = command.Quantity, Unit = line.Unit, Reason = reason,
                SubtotalMinor = Part(line.SubtotalMinor, row => row.SubtotalMinor, row => row.SubtotalMinor),
                DiscountMinor = Part(line.DiscountMinor, row => row.DiscountMinor, row => row.DiscountMinor),
                NetMinor = Part(line.NetMinor, row => row.NetMinor, row => row.NetMinor),
                TaxMinor = Part(line.TaxMinor, row => row.TaxMinor, row => row.TaxMinor),
                TotalMinor = Part(line.TotalMinor, row => row.TotalMinor, row => row.TotalMinor),
                CreatedAt = DateTimeOffset.UtcNow, CreatedBy = DemoAccess.Resolve(context)!.Name };
            if (returned.TotalMinor <= 0)
                return Fail(context, "PURCHASE_RETURN_AMOUNT_TOO_SMALL", 400, "İade tutarı en az 1 kuruş olmalıdır.");
            db.PurchaseReturns.Add(returned);
            db.Movements.Add(new InventoryMovementRow { Id = Guid.NewGuid().ToString(), FirmId = firmId, BranchId = branchId,
                WarehouseId = purchase.WarehouseId, IngredientId = line.IngredientId, Delta = -command.Quantity,
                Unit = line.Unit, Kind = "supplier_return", PurchaseReturnId = returned.Id,
                Description = $"Tedarikçiye iade {documentNumber} · Mal kabul {purchase.DocumentNumber}: {reason}",
                CreatedAt = returned.CreatedAt, Actor = returned.CreatedBy });
            cari.Movements.Add(new CariMovementRow { Id = returned.Id, FirmId = firmId, BranchId = branchId,
                PartyId = supplier.Id, Kind = "supplier", EntryType = "adjustment_decrease", DeltaMinor = -returned.TotalMinor,
                Currency = "TRY", Description = $"Tedarikçiye iade {documentNumber} · Mal kabul {purchase.DocumentNumber}: {reason}",
                Reference = documentNumber, EffectiveDate = command.DocumentDate, Source = "adjustment",
                Actor = returned.CreatedBy, CreatedAt = returned.CreatedAt });
            cari.Audit.Add(new CariAuditRow { FirmId = firmId, BranchId = branchId, PartyId = supplier.Id,
                Action = "movement_added", Actor = returned.CreatedBy,
                Detail = $"adjustment_decrease · {-returned.TotalMinor} · {documentNumber}", OccurredAt = returned.CreatedAt });
            db.Audit.Add(new InventoryAuditRow { FirmId = firmId, BranchId = branchId, WarehouseId = purchase.WarehouseId,
                EntityId = purchase.Id, Action = "purchase_returned", RequestId = returned.Id, Actor = returned.CreatedBy,
                Detail = $"{documentNumber} · {line.IngredientId} · {-command.Quantity:0.###} {line.Unit} · {reason}", OccurredAt = returned.CreatedAt });
            var ingredient = await db.Ingredients.SingleAsync(row => row.Id == line.IngredientId && row.FirmId == firmId && row.BranchId == branchId, context.RequestAborted);
            ingredient.Version++; ingredient.UpdatedAt = returned.CreatedAt;
            try
            {
                await db.SaveChangesAsync(context.RequestAborted);
                await cari.SaveChangesAsync(context.RequestAborted);
                await transaction.CommitAsync(context.RequestAborted);
            }
            catch (DbUpdateException error) when (error.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
            { return Fail(context, "PURCHASE_RETURN_DOCUMENT_EXISTS", 409, "Bu iade irsaliye numarası şubede daha önce kullanılmış."); }
            return Results.Created($"{context.Request.Path}/{returned.Id}", ReturnView(returned));
        });
        return app;
    }

    private static bool LineValid(PurchaseLineInput line) => line.Quantity > 0 && line.Quantity <= 999999999999999m &&
        decimal.Round(line.Quantity, 3) == line.Quantity && line.UnitPriceMinor > 0 &&
        line.DiscountRateBps is >= 0 and <= 10000 && line.TaxRateBps is >= 0 and <= 10000;
    private static (long Subtotal, long Discount, long Net, long Tax, long Total) Amounts(PurchaseLineInput line)
    {
        var subtotal = checked((long)decimal.Round(line.Quantity * line.UnitPriceMinor, 0, MidpointRounding.AwayFromZero));
        var discount = checked((long)decimal.Round(subtotal * line.DiscountRateBps / 10000m, 0, MidpointRounding.AwayFromZero));
        var net = subtotal - discount;
        var tax = checked((long)decimal.Round(net * line.TaxRateBps / 10000m, 0, MidpointRounding.AwayFromZero));
        return (subtotal, discount, net, tax, checked(net + tax));
    }
    private static async Task<Dictionary<string, string>> IngredientNames(InventoryDbContext db, string firmId,
        string branchId, IEnumerable<InventoryPurchaseLineRow> lines, CancellationToken cancellationToken)
    {
        var ids = lines.Select(line => line.IngredientId).Distinct().ToArray();
        return await db.Ingredients.AsNoTracking().Where(row => row.FirmId == firmId && row.BranchId == branchId && ids.Contains(row.Id))
            .ToDictionaryAsync(row => row.Id, row => row.Name, cancellationToken);
    }
    private static object View(InventoryPurchaseRow row, string supplierName, IReadOnlyDictionary<string, string> ingredients) => new
    {
        row.Id, row.WarehouseId, row.SupplierCariId, supplierName, row.DocumentNumber, row.DocumentDate, row.Status,
        row.Currency, row.SubtotalMinor, row.DiscountMinor, row.TaxMinor, row.TotalMinor, row.Version,
        row.CreatedAt, row.CreatedBy, row.ApprovedAt, row.ApprovedBy,
        corrections = row.Corrections.OrderByDescending(item => item.CreatedAt).Select(CorrectionView).ToArray(),
        returns = row.Returns.OrderByDescending(item => item.CreatedAt).Select(ReturnView).ToArray(),
        lines = row.Lines.Select(line => new { line.Id, line.IngredientId,
            ingredientName = ingredients.GetValueOrDefault(line.IngredientId) ?? "Silinmiş hammadde", line.Quantity,
            line.Unit, line.UnitPriceMinor, line.DiscountRateBps, line.TaxRateBps, line.SubtotalMinor,
            line.DiscountMinor, line.NetMinor, line.TaxMinor, line.TotalMinor }).ToArray()
    };
    private static object CorrectionView(InventoryPurchaseCorrectionRow row) => new { row.Id, row.PurchaseLineId,
        row.Quantity, row.Unit, row.Reason, row.SubtotalMinor, row.DiscountMinor, row.NetMinor, row.TaxMinor,
        row.TotalMinor, row.CreatedAt, row.CreatedBy };
    private static object ReturnView(InventoryPurchaseReturnRow row) => new { row.Id, row.PurchaseLineId,
        row.DocumentNumber, row.DocumentDate, row.Quantity, row.Unit, row.Reason, row.SubtotalMinor,
        row.DiscountMinor, row.NetMinor, row.TaxMinor, row.TotalMinor, row.CreatedAt, row.CreatedBy };
    private static IResult? Guard(HttpContext context, string firmId, string branchId, bool ready, bool write)
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Fail(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanRead(firmId, branchId) || write && !actor.CanManage)
            return Fail(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubede mal kabul erişim izni yok.");
        return ready ? null : Fail(context, "INVENTORY_STORAGE_UNAVAILABLE", 503, "Stok migration'ı uygulanmalı ve API yeniden başlatılmalı.");
    }
    private static IResult Fail(HttpContext context, string code, int status, string detail) => Results.Json(new
    {
        type = $"https://hipos.local/problems/{code.ToLowerInvariant().Replace('_', '-')}",
        title = status switch { 401 => "Oturum gerekli", 403 => "Yetkisiz kapsam", 404 => "Bulunamadı", 409 => "İşlem çakışması", 503 => "Kurulum gerekiyor", _ => "İstek hatası" },
        status, detail, instance = context.Request.Path.Value, code, traceId = context.TraceIdentifier,
    }, statusCode: status, contentType: "application/problem+json");
}
