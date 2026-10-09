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
    public DateTimeOffset CreatedAt { get; set; }
    public string Actor { get; set; } = "";
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
                table.HasCheckConstraint("ck_inventory_movement_kind", "kind IN ('opening', 'manual_in', 'manual_out', 'count_adjustment')");
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
            entity.Property(row => row.CreatedAt).HasColumnName("created_at");
            entity.Property(row => row.Actor).HasColumnName("actor").HasMaxLength(80);
            entity.HasOne<InventoryIngredientRow>().WithMany().HasForeignKey(row => row.IngredientId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<InventoryWarehouseRow>().WithMany().HasForeignKey(row => row.WarehouseId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<InventoryCountRow>().WithMany().HasForeignKey(row => row.CountId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.WarehouseId, row.IngredientId, row.CreatedAt });
            entity.HasIndex(row => new { row.CountId, row.IngredientId }).IsUnique().HasFilter("count_id IS NOT NULL");
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
