using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Hipos.Api.Inventory;

public sealed class InventoryWarehouseRow
{
    public string Id { get; set; } = "";
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string Name { get; set; } = "";
    public bool IsActive { get; set; } = true;
    public int Version { get; set; } = 1;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class InventoryIngredientRow
{
    public string Id { get; set; } = "";
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string Name { get; set; } = "";
    public string NameKey { get; set; } = "";
    public string Unit { get; set; } = "";
    public decimal CriticalBelow { get; set; }
    public bool IsActive { get; set; } = true;
    public int Version { get; set; } = 1;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class InventoryProductRef { public Guid Id { get; set; } }

public sealed class InventoryRecipeRow
{
    public string Id { get; set; } = "";
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public Guid ProductId { get; set; }
    public int Version { get; set; }
    public string Portion { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public string CreatedBy { get; set; } = "";
    public List<InventoryRecipeLineRow> Lines { get; set; } = [];
}

public sealed class InventoryRecipeLineRow
{
    public string RecipeId { get; set; } = "";
    public string IngredientId { get; set; } = "";
    public decimal Quantity { get; set; }
    public string Unit { get; set; } = "";
}

public sealed class InventoryMovementRow
{
    public string Id { get; set; } = "";
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string WarehouseId { get; set; } = "";
    public string IngredientId { get; set; } = "";
    public decimal Delta { get; set; }
    public string Unit { get; set; } = "";
    public string Kind { get; set; } = "";
    public string Description { get; set; } = "";
    public string? CountId { get; set; }
    public string? PurchaseId { get; set; }
    public string? PurchaseCorrectionId { get; set; }
    public string? PurchaseReturnId { get; set; }
    public string? WasteLogId { get; set; }
    public string? RecipeWasteLogId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public string Actor { get; set; } = "";
}

public sealed class InventoryRecipeWasteLogRow
{
    public string Id { get; set; } = "";
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string WarehouseId { get; set; } = "";
    public Guid ProductId { get; set; }
    public string ProductName { get; set; } = "";
    public string RecipeId { get; set; } = "";
    public int RecipeVersion { get; set; }
    public decimal Portions { get; set; }
    public string ReasonType { get; set; } = "";
    public string Description { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public string ReportedBy { get; set; } = "";
    public List<InventoryRecipeWasteLineRow> Lines { get; set; } = [];
}

public sealed class InventoryRecipeWasteLineRow
{
    public string RecipeWasteLogId { get; set; } = "";
    public string IngredientId { get; set; } = "";
    public decimal Quantity { get; set; }
    public string Unit { get; set; } = "";
}

public sealed class InventoryWasteLogRow
{
    public string Id { get; set; } = "";
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string WarehouseId { get; set; } = "";
    public string IngredientId { get; set; } = "";
    public decimal Quantity { get; set; }
    public string Unit { get; set; } = "";
    public string ReasonType { get; set; } = "";
    public string Description { get; set; } = "";
    public decimal? SnapshotUnitCostMinor { get; set; }
    public long? TotalCostMinor { get; set; }
    public string? CostMethod { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public string ReportedBy { get; set; } = "";
}

public sealed class InventoryOpeningCostRow
{
    public string Id { get; set; } = "";
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string WarehouseId { get; set; } = "";
    public string IngredientId { get; set; } = "";
    public decimal QuantitySnapshot { get; set; }
    public string Unit { get; set; } = "";
    public decimal UnitCostMinor { get; set; }
    public long TotalCostMinor { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public string CreatedBy { get; set; } = "";
}

public sealed class InventoryPurchaseRow
{
    public string Id { get; set; } = "";
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string WarehouseId { get; set; } = "";
    public string SupplierCariId { get; set; } = "";
    public string? PurchaseOrderId { get; set; }
    public string DocumentNumber { get; set; } = "";
    public DateOnly DocumentDate { get; set; }
    public string Status { get; set; } = "draft";
    public string Currency { get; set; } = "TRY";
    public long SubtotalMinor { get; set; }
    public long DiscountMinor { get; set; }
    public long TaxMinor { get; set; }
    public long TotalMinor { get; set; }
    public int Version { get; set; } = 1;
    public DateTimeOffset CreatedAt { get; set; }
    public string CreatedBy { get; set; } = "";
    public DateTimeOffset? ApprovedAt { get; set; }
    public string? ApprovedBy { get; set; }
    public string? ApprovalRequestId { get; set; }
    public List<InventoryPurchaseLineRow> Lines { get; set; } = [];
    public List<InventoryPurchaseCorrectionRow> Corrections { get; set; } = [];
    public List<InventoryPurchaseReturnRow> Returns { get; set; } = [];
}

public sealed class InventoryPurchaseOrderRow
{
    public string Id { get; set; } = "";
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string WarehouseId { get; set; } = "";
    public string SupplierCariId { get; set; } = "";
    public string OrderNumber { get; set; } = "";
    public DateOnly OrderDate { get; set; }
    public string Status { get; set; } = "draft";
    public int Version { get; set; } = 1;
    public DateTimeOffset CreatedAt { get; set; }
    public string CreatedBy { get; set; } = "";
    public DateTimeOffset? ApprovedAt { get; set; }
    public string? ApprovedBy { get; set; }
    public string? ApprovalRequestId { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public string? CompletedByPurchaseId { get; set; }
    public List<InventoryPurchaseOrderLineRow> Lines { get; set; } = [];
}

public sealed class InventoryPurchaseOrderLineRow
{
    public string Id { get; set; } = "";
    public string PurchaseOrderId { get; set; } = "";
    public string IngredientId { get; set; } = "";
    public decimal Quantity { get; set; }
    public string Unit { get; set; } = "";
}

public sealed class InventoryPurchaseLineRow
{
    public string Id { get; set; } = "";
    public string PurchaseId { get; set; } = "";
    public string IngredientId { get; set; } = "";
    public decimal Quantity { get; set; }
    public string Unit { get; set; } = "";
    public long UnitPriceMinor { get; set; }
    public int DiscountRateBps { get; set; }
    public int TaxRateBps { get; set; }
    public long SubtotalMinor { get; set; }
    public long DiscountMinor { get; set; }
    public long NetMinor { get; set; }
    public long TaxMinor { get; set; }
    public long TotalMinor { get; set; }
}

public sealed class InventoryPurchaseCorrectionRow
{
    public string Id { get; set; } = "";
    public string PurchaseId { get; set; } = "";
    public string PurchaseLineId { get; set; } = "";
    public decimal Quantity { get; set; }
    public string Unit { get; set; } = "";
    public string Reason { get; set; } = "";
    public long SubtotalMinor { get; set; }
    public long DiscountMinor { get; set; }
    public long NetMinor { get; set; }
    public long TaxMinor { get; set; }
    public long TotalMinor { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public string CreatedBy { get; set; } = "";
}

public sealed class InventoryPurchaseReturnRow
{
    public string Id { get; set; } = "";
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string PurchaseId { get; set; } = "";
    public string PurchaseLineId { get; set; } = "";
    public string DocumentNumber { get; set; } = "";
    public DateOnly DocumentDate { get; set; }
    public decimal Quantity { get; set; }
    public string Unit { get; set; } = "";
    public string Reason { get; set; } = "";
    public long SubtotalMinor { get; set; }
    public long DiscountMinor { get; set; }
    public long NetMinor { get; set; }
    public long TaxMinor { get; set; }
    public long TotalMinor { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public string CreatedBy { get; set; } = "";
}

public sealed class InventoryCountRow
{
    public string Id { get; set; } = "";
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string WarehouseId { get; set; } = "";
    public string Status { get; set; } = "draft";
    public int Version { get; set; } = 1;
    public DateTimeOffset CreatedAt { get; set; }
    public string CreatedBy { get; set; } = "";
    public DateTimeOffset? ApprovedAt { get; set; }
    public string? ApprovedBy { get; set; }
    public string? ApprovalRequestId { get; set; }
    public DateTimeOffset? CancelledAt { get; set; }
    public string? CancelledBy { get; set; }
    public string? CancellationRequestId { get; set; }
    public List<InventoryCountLineRow> Lines { get; set; } = [];
}

public sealed class InventoryCountLineRow
{
    public string CountId { get; set; } = "";
    public string IngredientId { get; set; } = "";
    public decimal SystemQuantity { get; set; }
    public int MovementCountSnapshot { get; set; }
    public decimal? PhysicalQuantity { get; set; }
    public string Unit { get; set; } = "";
}

public sealed class InventoryAuditRow
{
    public long Id { get; set; }
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string? WarehouseId { get; set; }
    public string EntityId { get; set; } = "";
    public string Action { get; set; } = "";
    public string? RequestId { get; set; }
    public string Actor { get; set; } = "";
    public string Detail { get; set; } = "";
    public DateTimeOffset OccurredAt { get; set; }
}

public sealed class InventoryDbContext(DbContextOptions<InventoryDbContext> options) : DbContext(options)
{
    public DbSet<InventoryWarehouseRow> Warehouses => Set<InventoryWarehouseRow>();
    public DbSet<InventoryIngredientRow> Ingredients => Set<InventoryIngredientRow>();
    public DbSet<InventoryRecipeRow> Recipes => Set<InventoryRecipeRow>();
    public DbSet<InventoryRecipeLineRow> RecipeLines => Set<InventoryRecipeLineRow>();
    public DbSet<InventoryMovementRow> Movements => Set<InventoryMovementRow>();
    public DbSet<InventoryCountRow> Counts => Set<InventoryCountRow>();
    public DbSet<InventoryCountLineRow> CountLines => Set<InventoryCountLineRow>();
    public DbSet<InventoryPurchaseRow> Purchases => Set<InventoryPurchaseRow>();
    public DbSet<InventoryPurchaseOrderRow> PurchaseOrders => Set<InventoryPurchaseOrderRow>();
    public DbSet<InventoryPurchaseOrderLineRow> PurchaseOrderLines => Set<InventoryPurchaseOrderLineRow>();
    public DbSet<InventoryPurchaseLineRow> PurchaseLines => Set<InventoryPurchaseLineRow>();
    public DbSet<InventoryPurchaseCorrectionRow> PurchaseCorrections => Set<InventoryPurchaseCorrectionRow>();
    public DbSet<InventoryPurchaseReturnRow> PurchaseReturns => Set<InventoryPurchaseReturnRow>();
    public DbSet<InventoryWasteLogRow> WasteLogs => Set<InventoryWasteLogRow>();
    public DbSet<InventoryRecipeWasteLogRow> RecipeWasteLogs => Set<InventoryRecipeWasteLogRow>();
    public DbSet<InventoryRecipeWasteLineRow> RecipeWasteLines => Set<InventoryRecipeWasteLineRow>();
    public DbSet<InventoryOpeningCostRow> OpeningCosts => Set<InventoryOpeningCostRow>();
    public DbSet<InventoryAuditRow> Audit => Set<InventoryAuditRow>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("inventory");
        modelBuilder.Entity<InventoryWarehouseRow>(entity =>
        {
            entity.ToTable("warehouses", table =>
            {
                table.HasCheckConstraint("ck_inventory_warehouse_version", "version > 0");
                table.HasCheckConstraint("ck_inventory_warehouse_name", "length(btrim(name)) BETWEEN 2 AND 160");
            });
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").HasMaxLength(80);
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.Name).HasColumnName("name").HasMaxLength(160);
            entity.Property(row => row.IsActive).HasColumnName("is_active");
            entity.Property(row => row.Version).HasColumnName("version").IsConcurrencyToken();
            entity.Property(row => row.CreatedAt).HasColumnName("created_at");
            entity.Property(row => row.UpdatedAt).HasColumnName("updated_at");
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.Name }).IsUnique();
        });
        modelBuilder.Entity<InventoryIngredientRow>(entity =>
        {
            entity.ToTable("ingredients", table =>
            {
                table.HasCheckConstraint("ck_ingredient_version", "version > 0");
                table.HasCheckConstraint("ck_ingredient_threshold", "critical_below >= 0");
            });
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").HasMaxLength(80);
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.Name).HasColumnName("name").HasMaxLength(160);
            entity.Property(row => row.NameKey).HasColumnName("name_key").HasMaxLength(160);
            entity.Property(row => row.Unit).HasColumnName("unit").HasMaxLength(12);
            entity.Property(row => row.CriticalBelow).HasColumnName("critical_below").HasPrecision(18, 3);
            entity.Property(row => row.IsActive).HasColumnName("is_active");
            entity.Property(row => row.Version).HasColumnName("version").IsConcurrencyToken();
            entity.Property(row => row.CreatedAt).HasColumnName("created_at");
            entity.Property(row => row.UpdatedAt).HasColumnName("updated_at");
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.NameKey }).IsUnique();
        });
        modelBuilder.Entity<InventoryProductRef>(entity =>
        {
            entity.ToTable("products", "catalog", table => table.ExcludeFromMigrations());
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
        });
        modelBuilder.Entity<InventoryRecipeRow>(entity =>
        {
            entity.ToTable("recipes", table => table.HasCheckConstraint("ck_recipe_version", "version > 0"));
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").HasMaxLength(80);
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.ProductId).HasColumnName("product_id");
            entity.Property(row => row.Version).HasColumnName("version");
            entity.Property(row => row.Portion).HasColumnName("portion").HasMaxLength(120);
            entity.Property(row => row.CreatedAt).HasColumnName("created_at");
            entity.Property(row => row.CreatedBy).HasColumnName("created_by").HasMaxLength(80);
            entity.HasOne<InventoryProductRef>().WithMany().HasForeignKey(row => row.ProductId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.ProductId, row.Version }).IsUnique();
        });
        modelBuilder.Entity<InventoryRecipeLineRow>(entity =>
        {
            entity.ToTable("recipe_lines", table => table.HasCheckConstraint("ck_recipe_line_quantity", "quantity > 0"));
            entity.HasKey(row => new { row.RecipeId, row.IngredientId });
            entity.Property(row => row.RecipeId).HasColumnName("recipe_id").HasMaxLength(80);
            entity.Property(row => row.IngredientId).HasColumnName("ingredient_id").HasMaxLength(80);
            entity.Property(row => row.Quantity).HasColumnName("quantity").HasPrecision(18, 3);
            entity.Property(row => row.Unit).HasColumnName("unit").HasMaxLength(12);
            entity.HasOne<InventoryRecipeRow>().WithMany(row => row.Lines).HasForeignKey(row => row.RecipeId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<InventoryIngredientRow>().WithMany().HasForeignKey(row => row.IngredientId).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<InventoryMovementRow>(entity =>
        {
            entity.ToTable("movements", table =>
            {
                table.HasCheckConstraint("ck_inventory_movement_nonzero", "delta <> 0");
                table.HasCheckConstraint("ck_inventory_movement_kind", "kind IN ('opening', 'manual_in', 'manual_out', 'count_adjustment', 'receiving', 'purchase_correction', 'supplier_return', 'waste_loss')");
            });
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").HasMaxLength(80);
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.WarehouseId).HasColumnName("warehouse_id").HasMaxLength(80);
            entity.Property(row => row.IngredientId).HasColumnName("ingredient_id").HasMaxLength(80);
            entity.Property(row => row.Delta).HasColumnName("delta").HasPrecision(18, 3);
            entity.Property(row => row.Unit).HasColumnName("unit").HasMaxLength(12);
            entity.Property(row => row.Kind).HasColumnName("kind").HasMaxLength(24);
            entity.Property(row => row.Description).HasColumnName("description").HasMaxLength(500);
            entity.Property(row => row.CountId).HasColumnName("count_id").HasMaxLength(80);
            entity.Property(row => row.PurchaseId).HasColumnName("purchase_id").HasMaxLength(80);
            entity.Property(row => row.PurchaseCorrectionId).HasColumnName("purchase_correction_id").HasMaxLength(80);
            entity.Property(row => row.PurchaseReturnId).HasColumnName("purchase_return_id").HasMaxLength(80);
            entity.Property(row => row.WasteLogId).HasColumnName("waste_log_id").HasMaxLength(80);
            entity.Property(row => row.RecipeWasteLogId).HasColumnName("recipe_waste_log_id").HasMaxLength(80);
            entity.Property(row => row.CreatedAt).HasColumnName("created_at");
            entity.Property(row => row.Actor).HasColumnName("actor").HasMaxLength(80);
            entity.HasOne<InventoryIngredientRow>().WithMany().HasForeignKey(row => row.IngredientId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<InventoryWarehouseRow>().WithMany().HasForeignKey(row => row.WarehouseId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<InventoryCountRow>().WithMany().HasForeignKey(row => row.CountId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<InventoryPurchaseRow>().WithMany().HasForeignKey(row => row.PurchaseId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<InventoryPurchaseCorrectionRow>().WithMany().HasForeignKey(row => row.PurchaseCorrectionId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<InventoryPurchaseReturnRow>().WithMany().HasForeignKey(row => row.PurchaseReturnId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<InventoryWasteLogRow>().WithMany().HasForeignKey(row => row.WasteLogId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<InventoryRecipeWasteLogRow>().WithMany().HasForeignKey(row => row.RecipeWasteLogId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.WarehouseId, row.IngredientId, row.CreatedAt });
            entity.HasIndex(row => new { row.CountId, row.IngredientId }).IsUnique().HasFilter("count_id IS NOT NULL");
            entity.HasIndex(row => new { row.PurchaseId, row.IngredientId }).IsUnique().HasFilter("purchase_id IS NOT NULL");
            entity.HasIndex(row => row.PurchaseCorrectionId).IsUnique().HasFilter("purchase_correction_id IS NOT NULL");
            entity.HasIndex(row => row.PurchaseReturnId).IsUnique().HasFilter("purchase_return_id IS NOT NULL");
            entity.HasIndex(row => row.WasteLogId).IsUnique().HasFilter("waste_log_id IS NOT NULL");
            entity.HasIndex(row => new { row.RecipeWasteLogId, row.IngredientId }).IsUnique().HasFilter("recipe_waste_log_id IS NOT NULL");
        });
        modelBuilder.Entity<InventoryRecipeWasteLogRow>(entity =>
        {
            entity.ToTable("recipe_waste_logs", table =>
            {
                table.HasCheckConstraint("ck_recipe_waste_portions", "portions > 0");
                table.HasCheckConstraint("ck_recipe_waste_version", "recipe_version > 0");
                table.HasCheckConstraint("ck_recipe_waste_reason", "reason_type IN ('spoilage', 'expired', 'spill_breakage', 'burn', 'quality_control')");
            });
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").HasMaxLength(80);
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.WarehouseId).HasColumnName("warehouse_id").HasMaxLength(80);
            entity.Property(row => row.ProductId).HasColumnName("product_id");
            entity.Property(row => row.ProductName).HasColumnName("product_name").HasMaxLength(200);
            entity.Property(row => row.RecipeId).HasColumnName("recipe_id").HasMaxLength(80);
            entity.Property(row => row.RecipeVersion).HasColumnName("recipe_version");
            entity.Property(row => row.Portions).HasColumnName("portions").HasPrecision(18, 3);
            entity.Property(row => row.ReasonType).HasColumnName("reason_type").HasMaxLength(32);
            entity.Property(row => row.Description).HasColumnName("description").HasMaxLength(500);
            entity.Property(row => row.CreatedAt).HasColumnName("created_at");
            entity.Property(row => row.ReportedBy).HasColumnName("reported_by").HasMaxLength(80);
            entity.HasOne<InventoryWarehouseRow>().WithMany().HasForeignKey(row => row.WarehouseId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<InventoryRecipeRow>().WithMany().HasForeignKey(row => row.RecipeId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.WarehouseId, row.CreatedAt });
        });
        modelBuilder.Entity<InventoryRecipeWasteLineRow>(entity =>
        {
            entity.ToTable("recipe_waste_lines", table => table.HasCheckConstraint("ck_recipe_waste_line_quantity", "quantity > 0"));
            entity.HasKey(row => new { row.RecipeWasteLogId, row.IngredientId });
            entity.Property(row => row.RecipeWasteLogId).HasColumnName("recipe_waste_log_id").HasMaxLength(80);
            entity.Property(row => row.IngredientId).HasColumnName("ingredient_id").HasMaxLength(80);
            entity.Property(row => row.Quantity).HasColumnName("quantity").HasPrecision(18, 3);
            entity.Property(row => row.Unit).HasColumnName("unit").HasMaxLength(12);
            entity.HasOne<InventoryRecipeWasteLogRow>().WithMany(row => row.Lines).HasForeignKey(row => row.RecipeWasteLogId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<InventoryIngredientRow>().WithMany().HasForeignKey(row => row.IngredientId).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<InventoryWasteLogRow>(entity =>
        {
            entity.ToTable("waste_logs", table =>
            {
                table.HasCheckConstraint("ck_waste_log_quantity", "quantity > 0");
                table.HasCheckConstraint("ck_waste_log_reason", "reason_type IN ('spoilage', 'expired', 'spill_breakage', 'burn', 'quality_control')");
            });
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").HasMaxLength(80);
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.WarehouseId).HasColumnName("warehouse_id").HasMaxLength(80);
            entity.Property(row => row.IngredientId).HasColumnName("ingredient_id").HasMaxLength(80);
            entity.Property(row => row.Quantity).HasColumnName("quantity").HasPrecision(18, 3);
            entity.Property(row => row.Unit).HasColumnName("unit").HasMaxLength(12);
            entity.Property(row => row.ReasonType).HasColumnName("reason_type").HasMaxLength(32);
            entity.Property(row => row.Description).HasColumnName("description").HasMaxLength(500);
            entity.Property(row => row.SnapshotUnitCostMinor).HasColumnName("snapshot_unit_cost_minor").HasPrecision(18, 6);
            entity.Property(row => row.TotalCostMinor).HasColumnName("total_cost_minor");
            entity.Property(row => row.CostMethod).HasColumnName("cost_method").HasMaxLength(40);
            entity.Property(row => row.CreatedAt).HasColumnName("created_at");
            entity.Property(row => row.ReportedBy).HasColumnName("reported_by").HasMaxLength(80);
            entity.HasOne<InventoryWarehouseRow>().WithMany().HasForeignKey(row => row.WarehouseId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<InventoryIngredientRow>().WithMany().HasForeignKey(row => row.IngredientId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.WarehouseId, row.CreatedAt });
        });
        modelBuilder.Entity<InventoryOpeningCostRow>(entity =>
        {
            entity.ToTable("opening_costs", table =>
            {
                table.HasCheckConstraint("ck_opening_cost_quantity", "quantity_snapshot > 0");
                table.HasCheckConstraint("ck_opening_cost_unit_cost", "unit_cost_minor > 0 AND total_cost_minor > 0");
            });
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").HasMaxLength(80);
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.WarehouseId).HasColumnName("warehouse_id").HasMaxLength(80);
            entity.Property(row => row.IngredientId).HasColumnName("ingredient_id").HasMaxLength(80);
            entity.Property(row => row.QuantitySnapshot).HasColumnName("quantity_snapshot").HasPrecision(18, 3);
            entity.Property(row => row.Unit).HasColumnName("unit").HasMaxLength(12);
            entity.Property(row => row.UnitCostMinor).HasColumnName("unit_cost_minor").HasPrecision(18, 6);
            entity.Property(row => row.TotalCostMinor).HasColumnName("total_cost_minor");
            entity.Property(row => row.CreatedAt).HasColumnName("created_at");
            entity.Property(row => row.CreatedBy).HasColumnName("created_by").HasMaxLength(80);
            entity.HasOne<InventoryWarehouseRow>().WithMany().HasForeignKey(row => row.WarehouseId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<InventoryIngredientRow>().WithMany().HasForeignKey(row => row.IngredientId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.WarehouseId, row.IngredientId }).IsUnique();
        });
        modelBuilder.Entity<InventoryPurchaseRow>(entity =>
        {
            entity.ToTable("purchases", table =>
            {
                table.HasCheckConstraint("ck_purchase_status", "status IN ('draft', 'approved')");
                table.HasCheckConstraint("ck_purchase_currency", "currency = 'TRY'");
                table.HasCheckConstraint("ck_purchase_totals", "subtotal_minor >= 0 AND discount_minor >= 0 AND tax_minor >= 0 AND total_minor > 0");
                table.HasCheckConstraint("ck_purchase_version", "version > 0");
            });
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").HasMaxLength(80);
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.WarehouseId).HasColumnName("warehouse_id").HasMaxLength(80);
            entity.Property(row => row.SupplierCariId).HasColumnName("supplier_cari_id").HasMaxLength(80);
            entity.Property(row => row.PurchaseOrderId).HasColumnName("purchase_order_id").HasMaxLength(80);
            entity.Property(row => row.DocumentNumber).HasColumnName("document_number").HasMaxLength(100);
            entity.Property(row => row.DocumentDate).HasColumnName("document_date").HasColumnType("date");
            entity.Property(row => row.Status).HasColumnName("status").HasMaxLength(16);
            entity.Property(row => row.Currency).HasColumnName("currency").HasMaxLength(3);
            entity.Property(row => row.SubtotalMinor).HasColumnName("subtotal_minor");
            entity.Property(row => row.DiscountMinor).HasColumnName("discount_minor");
            entity.Property(row => row.TaxMinor).HasColumnName("tax_minor");
            entity.Property(row => row.TotalMinor).HasColumnName("total_minor");
            entity.Property(row => row.Version).HasColumnName("version").IsConcurrencyToken();
            entity.Property(row => row.CreatedAt).HasColumnName("created_at");
            entity.Property(row => row.CreatedBy).HasColumnName("created_by").HasMaxLength(80);
            entity.Property(row => row.ApprovedAt).HasColumnName("approved_at");
            entity.Property(row => row.ApprovedBy).HasColumnName("approved_by").HasMaxLength(80);
            entity.Property(row => row.ApprovalRequestId).HasColumnName("approval_request_id").HasMaxLength(80);
            entity.HasOne<InventoryWarehouseRow>().WithMany().HasForeignKey(row => row.WarehouseId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<InventoryPurchaseOrderRow>().WithMany().HasForeignKey(row => row.PurchaseOrderId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.DocumentNumber }).IsUnique();
            entity.HasIndex(row => row.ApprovalRequestId).IsUnique().HasFilter("approval_request_id IS NOT NULL");
            entity.HasIndex(row => row.PurchaseOrderId).IsUnique().HasFilter("purchase_order_id IS NOT NULL");
        });
        modelBuilder.Entity<InventoryPurchaseOrderRow>(entity =>
        {
            entity.ToTable("purchase_orders", table =>
            {
                table.HasCheckConstraint("ck_purchase_order_status", "status IN ('draft', 'approved', 'completed')");
                table.HasCheckConstraint("ck_purchase_order_version", "version > 0");
            });
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").HasMaxLength(80);
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.WarehouseId).HasColumnName("warehouse_id").HasMaxLength(80);
            entity.Property(row => row.SupplierCariId).HasColumnName("supplier_cari_id").HasMaxLength(80);
            entity.Property(row => row.OrderNumber).HasColumnName("order_number").HasMaxLength(100);
            entity.Property(row => row.OrderDate).HasColumnName("order_date").HasColumnType("date");
            entity.Property(row => row.Status).HasColumnName("status").HasMaxLength(16);
            entity.Property(row => row.Version).HasColumnName("version").IsConcurrencyToken();
            entity.Property(row => row.CreatedAt).HasColumnName("created_at");
            entity.Property(row => row.CreatedBy).HasColumnName("created_by").HasMaxLength(80);
            entity.Property(row => row.ApprovedAt).HasColumnName("approved_at");
            entity.Property(row => row.ApprovedBy).HasColumnName("approved_by").HasMaxLength(80);
            entity.Property(row => row.ApprovalRequestId).HasColumnName("approval_request_id").HasMaxLength(80);
            entity.Property(row => row.CompletedAt).HasColumnName("completed_at");
            entity.Property(row => row.CompletedByPurchaseId).HasColumnName("completed_by_purchase_id").HasMaxLength(80);
            entity.HasOne<InventoryWarehouseRow>().WithMany().HasForeignKey(row => row.WarehouseId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.OrderNumber }).IsUnique();
            entity.HasIndex(row => row.ApprovalRequestId).IsUnique().HasFilter("approval_request_id IS NOT NULL");
        });
        modelBuilder.Entity<InventoryPurchaseOrderLineRow>(entity =>
        {
            entity.ToTable("purchase_order_lines", table => table.HasCheckConstraint("ck_purchase_order_line_quantity", "quantity > 0"));
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").HasMaxLength(80);
            entity.Property(row => row.PurchaseOrderId).HasColumnName("purchase_order_id").HasMaxLength(80);
            entity.Property(row => row.IngredientId).HasColumnName("ingredient_id").HasMaxLength(80);
            entity.Property(row => row.Quantity).HasColumnName("quantity").HasPrecision(18, 3);
            entity.Property(row => row.Unit).HasColumnName("unit").HasMaxLength(12);
            entity.HasOne<InventoryPurchaseOrderRow>().WithMany(row => row.Lines).HasForeignKey(row => row.PurchaseOrderId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<InventoryIngredientRow>().WithMany().HasForeignKey(row => row.IngredientId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(row => new { row.PurchaseOrderId, row.IngredientId }).IsUnique();
        });
        modelBuilder.Entity<InventoryPurchaseLineRow>(entity =>
        {
            entity.ToTable("purchase_lines", table =>
            {
                table.HasCheckConstraint("ck_purchase_line_quantity", "quantity > 0");
                table.HasCheckConstraint("ck_purchase_line_price", "unit_price_minor > 0");
                table.HasCheckConstraint("ck_purchase_line_rates", "discount_rate_bps BETWEEN 0 AND 10000 AND tax_rate_bps BETWEEN 0 AND 10000");
            });
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").HasMaxLength(80);
            entity.Property(row => row.PurchaseId).HasColumnName("purchase_id").HasMaxLength(80);
            entity.Property(row => row.IngredientId).HasColumnName("ingredient_id").HasMaxLength(80);
            entity.Property(row => row.Quantity).HasColumnName("quantity").HasPrecision(18, 3);
            entity.Property(row => row.Unit).HasColumnName("unit").HasMaxLength(12);
            entity.Property(row => row.UnitPriceMinor).HasColumnName("unit_price_minor");
            entity.Property(row => row.DiscountRateBps).HasColumnName("discount_rate_bps");
            entity.Property(row => row.TaxRateBps).HasColumnName("tax_rate_bps");
            entity.Property(row => row.SubtotalMinor).HasColumnName("subtotal_minor");
            entity.Property(row => row.DiscountMinor).HasColumnName("discount_minor");
            entity.Property(row => row.NetMinor).HasColumnName("net_minor");
            entity.Property(row => row.TaxMinor).HasColumnName("tax_minor");
            entity.Property(row => row.TotalMinor).HasColumnName("total_minor");
            entity.HasOne<InventoryPurchaseRow>().WithMany(row => row.Lines).HasForeignKey(row => row.PurchaseId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<InventoryIngredientRow>().WithMany().HasForeignKey(row => row.IngredientId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(row => new { row.PurchaseId, row.IngredientId }).IsUnique();
        });
        modelBuilder.Entity<InventoryPurchaseCorrectionRow>(entity =>
        {
            entity.ToTable("purchase_corrections", table =>
            {
                table.HasCheckConstraint("ck_purchase_correction_quantity", "quantity > 0");
                table.HasCheckConstraint("ck_purchase_correction_totals", "subtotal_minor >= 0 AND discount_minor >= 0 AND tax_minor >= 0 AND total_minor > 0");
            });
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").HasMaxLength(80);
            entity.Property(row => row.PurchaseId).HasColumnName("purchase_id").HasMaxLength(80);
            entity.Property(row => row.PurchaseLineId).HasColumnName("purchase_line_id").HasMaxLength(80);
            entity.Property(row => row.Quantity).HasColumnName("quantity").HasPrecision(18, 3);
            entity.Property(row => row.Unit).HasColumnName("unit").HasMaxLength(12);
            entity.Property(row => row.Reason).HasColumnName("reason").HasMaxLength(500);
            entity.Property(row => row.SubtotalMinor).HasColumnName("subtotal_minor");
            entity.Property(row => row.DiscountMinor).HasColumnName("discount_minor");
            entity.Property(row => row.NetMinor).HasColumnName("net_minor");
            entity.Property(row => row.TaxMinor).HasColumnName("tax_minor");
            entity.Property(row => row.TotalMinor).HasColumnName("total_minor");
            entity.Property(row => row.CreatedAt).HasColumnName("created_at");
            entity.Property(row => row.CreatedBy).HasColumnName("created_by").HasMaxLength(80);
            entity.HasOne<InventoryPurchaseRow>().WithMany(row => row.Corrections).HasForeignKey(row => row.PurchaseId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<InventoryPurchaseLineRow>().WithMany().HasForeignKey(row => row.PurchaseLineId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(row => new { row.PurchaseId, row.PurchaseLineId, row.CreatedAt });
        });
        modelBuilder.Entity<InventoryPurchaseReturnRow>(entity =>
        {
            entity.ToTable("purchase_returns", table =>
            {
                table.HasCheckConstraint("ck_purchase_return_quantity", "quantity > 0");
                table.HasCheckConstraint("ck_purchase_return_totals", "subtotal_minor >= 0 AND discount_minor >= 0 AND tax_minor >= 0 AND total_minor > 0");
            });
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").HasMaxLength(80);
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.PurchaseId).HasColumnName("purchase_id").HasMaxLength(80);
            entity.Property(row => row.PurchaseLineId).HasColumnName("purchase_line_id").HasMaxLength(80);
            entity.Property(row => row.DocumentNumber).HasColumnName("document_number").HasMaxLength(100);
            entity.Property(row => row.DocumentDate).HasColumnName("document_date").HasColumnType("date");
            entity.Property(row => row.Quantity).HasColumnName("quantity").HasPrecision(18, 3);
            entity.Property(row => row.Unit).HasColumnName("unit").HasMaxLength(12);
            entity.Property(row => row.Reason).HasColumnName("reason").HasMaxLength(500);
            entity.Property(row => row.SubtotalMinor).HasColumnName("subtotal_minor");
            entity.Property(row => row.DiscountMinor).HasColumnName("discount_minor");
            entity.Property(row => row.NetMinor).HasColumnName("net_minor");
            entity.Property(row => row.TaxMinor).HasColumnName("tax_minor");
            entity.Property(row => row.TotalMinor).HasColumnName("total_minor");
            entity.Property(row => row.CreatedAt).HasColumnName("created_at");
            entity.Property(row => row.CreatedBy).HasColumnName("created_by").HasMaxLength(80);
            entity.HasOne<InventoryPurchaseRow>().WithMany(row => row.Returns).HasForeignKey(row => row.PurchaseId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<InventoryPurchaseLineRow>().WithMany().HasForeignKey(row => row.PurchaseLineId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.DocumentNumber }).IsUnique();
            entity.HasIndex(row => new { row.PurchaseId, row.PurchaseLineId, row.CreatedAt });
        });
        modelBuilder.Entity<InventoryCountRow>(entity =>
        {
            entity.ToTable("counts", table =>
            {
                table.HasCheckConstraint("ck_inventory_count_status", "status IN ('draft', 'approved', 'cancelled')");
                table.HasCheckConstraint("ck_inventory_count_version", "version > 0");
            });
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").HasMaxLength(80);
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.WarehouseId).HasColumnName("warehouse_id").HasMaxLength(80);
            entity.Property(row => row.Status).HasColumnName("status").HasMaxLength(16);
            entity.Property(row => row.Version).HasColumnName("version").IsConcurrencyToken();
            entity.Property(row => row.CreatedAt).HasColumnName("created_at");
            entity.Property(row => row.CreatedBy).HasColumnName("created_by").HasMaxLength(80);
            entity.Property(row => row.ApprovedAt).HasColumnName("approved_at");
            entity.Property(row => row.ApprovedBy).HasColumnName("approved_by").HasMaxLength(80);
            entity.Property(row => row.ApprovalRequestId).HasColumnName("approval_request_id").HasMaxLength(80);
            entity.Property(row => row.CancelledAt).HasColumnName("cancelled_at");
            entity.Property(row => row.CancelledBy).HasColumnName("cancelled_by").HasMaxLength(80);
            entity.Property(row => row.CancellationRequestId).HasColumnName("cancellation_request_id").HasMaxLength(80);
            entity.HasOne<InventoryWarehouseRow>().WithMany().HasForeignKey(row => row.WarehouseId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.WarehouseId, row.CreatedAt });
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.WarehouseId }).IsUnique().HasFilter("status = 'draft'");
        });
        modelBuilder.Entity<InventoryCountLineRow>(entity =>
        {
            entity.ToTable("count_lines", table =>
            {
                table.HasCheckConstraint("ck_count_system_quantity", "system_quantity >= 0");
                table.HasCheckConstraint("ck_count_physical_quantity", "physical_quantity IS NULL OR physical_quantity >= 0");
            });
            entity.HasKey(row => new { row.CountId, row.IngredientId });
            entity.Property(row => row.CountId).HasColumnName("count_id").HasMaxLength(80);
            entity.Property(row => row.IngredientId).HasColumnName("ingredient_id").HasMaxLength(80);
            entity.Property(row => row.SystemQuantity).HasColumnName("system_quantity").HasPrecision(18, 3);
            entity.Property(row => row.MovementCountSnapshot).HasColumnName("movement_count_snapshot");
            entity.Property(row => row.PhysicalQuantity).HasColumnName("physical_quantity").HasPrecision(18, 3);
            entity.Property(row => row.Unit).HasColumnName("unit").HasMaxLength(12);
            entity.HasOne<InventoryCountRow>().WithMany(row => row.Lines).HasForeignKey(row => row.CountId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<InventoryIngredientRow>().WithMany().HasForeignKey(row => row.IngredientId).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<InventoryAuditRow>(entity =>
        {
            entity.ToTable("audit");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").ValueGeneratedOnAdd();
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.WarehouseId).HasColumnName("warehouse_id").HasMaxLength(80);
            entity.Property(row => row.EntityId).HasColumnName("entity_id").HasMaxLength(80);
            entity.Property(row => row.Action).HasColumnName("action").HasMaxLength(32);
            entity.Property(row => row.RequestId).HasColumnName("request_id").HasMaxLength(80);
            entity.Property(row => row.Actor).HasColumnName("actor").HasMaxLength(80);
            entity.Property(row => row.Detail).HasColumnName("detail").HasMaxLength(500);
            entity.Property(row => row.OccurredAt).HasColumnName("occurred_at");
            entity.HasOne<InventoryWarehouseRow>().WithMany().HasForeignKey(row => row.WarehouseId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.EntityId, row.OccurredAt });
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.RequestId }).IsUnique().HasFilter("request_id IS NOT NULL");
        });
    }
}

public sealed class InventoryDbContextFactory : IDesignTimeDbContextFactory<InventoryDbContext>
{
    public InventoryDbContext CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("HIPOS_FEATURES_CONNECTION")
            ?? throw new InvalidOperationException("Inventory migration için HIPOS_FEATURES_CONNECTION gerekli.");
        return new InventoryDbContext(new DbContextOptionsBuilder<InventoryDbContext>()
            .UseNpgsql(connection, npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "inventory"))
            .Options);
    }
}
