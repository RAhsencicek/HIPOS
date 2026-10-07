using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Hipos.Api.Catalog;

public sealed class CatalogProductRow
{
    public Guid Id { get; set; }
    public string FirmId { get; set; } = "";
    public string? BrandId { get; set; }
    public string Name { get; set; } = "";
    public string Sku { get; set; } = "";
    public string CategoryId { get; set; } = "";
    public string CategoryName { get; set; } = "";
    public string Status { get; set; } = "draft";
    public string[] Channels { get; set; } = [];
    public string Image { get; set; } = "";
    public bool RecipeLinked { get; set; }
    public long BasePriceMinor { get; set; }
    public string Currency { get; set; } = "TRY";
    public string Description { get; set; } = "";
    public string[] Allergens { get; set; } = [];
    public string[] OptionGroups { get; set; } = [];
    public string[] BranchIds { get; set; } = [];
    public DateTimeOffset UpdatedAt { get; set; }
    public int Version { get; set; }
    public List<CatalogBranchPriceRow> BranchPrices { get; set; } = [];
}

public sealed class CatalogBranchPriceRow
{
    public Guid ProductId { get; set; }
    public string BranchId { get; set; } = "";
    public long AmountMinor { get; set; }
    public CatalogProductRow Product { get; set; } = null!;
}

// Firma genelindeki kategori sözlüğü. Ürün satırlarındaki category_name geçiş sürecinde okuma anlık görüntüsüdür.
public sealed class CatalogCategoryRow
{
    public string FirmId { get; set; } = "";
    public string Id { get; set; } = "";
    public string? BrandId { get; set; }
    public string Name { get; set; } = "";
    public bool IsActive { get; set; } = true;
    public int SortOrder { get; set; }
    public int Version { get; set; } = 1;
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class CatalogCategoryAuditRow
{
    public long Id { get; set; }
    public string FirmId { get; set; } = "";
    public string CategoryId { get; set; } = "";
    public string Actor { get; set; } = "";
    public string Action { get; set; } = "";
    public string? OldName { get; set; }
    public string NewName { get; set; } = "";
    public int Version { get; set; }
    public DateTimeOffset OccurredAt { get; set; }
}

public sealed class CatalogPriceVersionRow
{
    public Guid Id { get; set; }
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public Guid ProductId { get; set; }
    public int Number { get; set; }
    public long AmountMinor { get; set; }
    public string Currency { get; set; } = "TRY";
    public string Actor { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class CatalogPublicationRow
{
    public Guid Id { get; set; }
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public Guid ProductId { get; set; }
    public int Number { get; set; }
    public Guid PriceVersionId { get; set; }
    public string ProductName { get; set; } = "";
    public string Sku { get; set; } = "";
    public string CategoryId { get; set; } = "";
    public string CategoryName { get; set; } = "";
    public long AmountMinor { get; set; }
    public string Currency { get; set; } = "TRY";
    public string[] Channels { get; set; } = [];
    public DateTimeOffset PublishedAt { get; set; }
    public string Actor { get; set; } = "";
}

public sealed class CatalogDraftRow
{
    public Guid Id { get; set; }
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string Name { get; set; } = "";
    public string Sku { get; set; } = "";
    public string CategoryId { get; set; } = "";
    public string CategoryName { get; set; } = "";
    public string Description { get; set; } = "";
    public int Version { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class CatalogDraftAuditRow
{
    public long Id { get; set; }
    public Guid DraftId { get; set; }
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string Actor { get; set; } = "";
    public string Action { get; set; } = "";
    public int Version { get; set; }
    public DateTimeOffset OccurredAt { get; set; }
}

public sealed class CatalogDbContext(DbContextOptions<CatalogDbContext> options) : DbContext(options)
{
    public DbSet<CatalogProductRow> Products => Set<CatalogProductRow>();
    public DbSet<CatalogBranchPriceRow> BranchPrices => Set<CatalogBranchPriceRow>();
    public DbSet<CatalogCategoryRow> Categories => Set<CatalogCategoryRow>();
    public DbSet<CatalogCategoryAuditRow> CategoryAudit => Set<CatalogCategoryAuditRow>();
    public DbSet<CatalogPriceVersionRow> PriceVersions => Set<CatalogPriceVersionRow>();
    public DbSet<CatalogPublicationRow> Publications => Set<CatalogPublicationRow>();
    public DbSet<CatalogDraftRow> Drafts => Set<CatalogDraftRow>();
    public DbSet<CatalogDraftAuditRow> DraftAudit => Set<CatalogDraftAuditRow>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("catalog");
        modelBuilder.Entity<CatalogProductRow>(entity =>
        {
            entity.ToTable("products", table =>
            {
                table.HasCheckConstraint("ck_product_version_positive", "version > 0");
                table.HasCheckConstraint("ck_base_price_nonnegative", "base_price_minor >= 0");
                table.HasCheckConstraint("ck_product_status", "status IN ('draft', 'published')");
            });
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BrandId).HasColumnName("brand_id").HasMaxLength(64);
            entity.Property(row => row.Name).HasColumnName("name").HasMaxLength(256);
            entity.Property(row => row.Sku).HasColumnName("sku").HasMaxLength(80);
            entity.Property(row => row.CategoryId).HasColumnName("category_id").HasMaxLength(80);
            entity.Property(row => row.CategoryName).HasColumnName("category_name").HasMaxLength(160);
            entity.Property(row => row.Status).HasColumnName("status").HasMaxLength(16);
            entity.Property(row => row.Channels).HasColumnName("channels");
            entity.Property(row => row.Image).HasColumnName("image").HasMaxLength(512);
            entity.Property(row => row.RecipeLinked).HasColumnName("recipe_linked");
            entity.Property(row => row.BasePriceMinor).HasColumnName("base_price_minor");
            entity.Property(row => row.Currency).HasColumnName("currency").HasMaxLength(3);
            entity.Property(row => row.Description).HasColumnName("description").HasMaxLength(4000);
            entity.Property(row => row.Allergens).HasColumnName("allergens");
            entity.Property(row => row.OptionGroups).HasColumnName("option_groups");
            entity.Property(row => row.BranchIds).HasColumnName("branch_ids");
            entity.Property(row => row.UpdatedAt).HasColumnName("updated_at");
            entity.Property(row => row.Version).HasColumnName("version").IsConcurrencyToken();
            entity.HasIndex(row => new { row.FirmId, row.Sku }).IsUnique();
            entity.HasIndex(row => new { row.FirmId, row.CategoryId });
        });
        modelBuilder.Entity<CatalogBranchPriceRow>(entity =>
        {
            entity.ToTable("branch_prices", table => table.HasCheckConstraint("ck_branch_price_nonnegative", "amount_minor >= 0"));
            entity.HasKey(row => new { row.ProductId, row.BranchId });
            entity.Property(row => row.ProductId).HasColumnName("product_id");
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.AmountMinor).HasColumnName("amount_minor");
            entity.HasOne(row => row.Product).WithMany(product => product.BranchPrices)
                .HasForeignKey(row => row.ProductId).OnDelete(DeleteBehavior.Cascade);
        });
        modelBuilder.Entity<CatalogCategoryRow>(entity =>
        {
            entity.ToTable("categories", table => table.HasCheckConstraint("ck_category_version_positive", "version > 0"));
            entity.HasKey(row => new { row.FirmId, row.Id });
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.Id).HasColumnName("id").HasMaxLength(80);
            entity.Property(row => row.BrandId).HasColumnName("brand_id").HasMaxLength(64);
            entity.Property(row => row.Name).HasColumnName("name").HasMaxLength(160);
            entity.Property(row => row.IsActive).HasColumnName("is_active");
            entity.Property(row => row.SortOrder).HasColumnName("sort_order");
            entity.Property(row => row.Version).HasColumnName("version").IsConcurrencyToken();
            entity.Property(row => row.UpdatedAt).HasColumnName("updated_at");
            entity.HasIndex(row => new { row.FirmId, row.SortOrder });
        });
        modelBuilder.Entity<CatalogCategoryAuditRow>(entity =>
        {
            entity.ToTable("category_audit");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").ValueGeneratedOnAdd();
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.CategoryId).HasColumnName("category_id").HasMaxLength(80);
            entity.Property(row => row.Actor).HasColumnName("actor").HasMaxLength(128);
            entity.Property(row => row.Action).HasColumnName("action").HasMaxLength(32);
            entity.Property(row => row.OldName).HasColumnName("old_name").HasMaxLength(160);
            entity.Property(row => row.NewName).HasColumnName("new_name").HasMaxLength(160);
            entity.Property(row => row.Version).HasColumnName("version");
            entity.Property(row => row.OccurredAt).HasColumnName("occurred_at");
            entity.HasIndex(row => new { row.FirmId, row.CategoryId, row.Id });
        });
        modelBuilder.Entity<CatalogPriceVersionRow>(entity =>
        {
            entity.ToTable("price_versions", table =>
            {
                table.HasCheckConstraint("ck_price_version_number", "number > 0");
                table.HasCheckConstraint("ck_price_version_amount", "amount_minor > 0");
            });
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.ProductId).HasColumnName("product_id");
            entity.Property(row => row.Number).HasColumnName("number");
            entity.Property(row => row.AmountMinor).HasColumnName("amount_minor");
            entity.Property(row => row.Currency).HasColumnName("currency").HasMaxLength(3);
            entity.Property(row => row.Actor).HasColumnName("actor").HasMaxLength(128);
            entity.Property(row => row.CreatedAt).HasColumnName("created_at");
            entity.HasIndex(row => new { row.FirmId, row.ProductId, row.Number }).IsUnique();
        });
        modelBuilder.Entity<CatalogPublicationRow>(entity =>
        {
            entity.ToTable("publications", table =>
            {
                table.HasCheckConstraint("ck_publication_number", "number > 0");
                table.HasCheckConstraint("ck_publication_amount", "amount_minor > 0");
            });
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.ProductId).HasColumnName("product_id");
            entity.Property(row => row.Number).HasColumnName("number");
            entity.Property(row => row.PriceVersionId).HasColumnName("price_version_id");
            entity.Property(row => row.ProductName).HasColumnName("product_name").HasMaxLength(256);
            entity.Property(row => row.Sku).HasColumnName("sku").HasMaxLength(80);
            entity.Property(row => row.CategoryId).HasColumnName("category_id").HasMaxLength(80);
            entity.Property(row => row.CategoryName).HasColumnName("category_name").HasMaxLength(160);
            entity.Property(row => row.AmountMinor).HasColumnName("amount_minor");
            entity.Property(row => row.Currency).HasColumnName("currency").HasMaxLength(3);
            entity.Property(row => row.Channels).HasColumnName("channels");
            entity.Property(row => row.PublishedAt).HasColumnName("published_at");
            entity.Property(row => row.Actor).HasColumnName("actor").HasMaxLength(128);
            entity.HasIndex(row => new { row.FirmId, row.ProductId, row.Number }).IsUnique();
        });
        modelBuilder.Entity<CatalogDraftRow>(entity =>
        {
            entity.ToTable("drafts", table => table.HasCheckConstraint("ck_draft_version_positive", "version > 0"));
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.Name).HasColumnName("name").HasMaxLength(256);
            entity.Property(row => row.Sku).HasColumnName("sku").HasMaxLength(80);
            entity.Property(row => row.CategoryId).HasColumnName("category_id").HasMaxLength(80);
            entity.Property(row => row.CategoryName).HasColumnName("category_name").HasMaxLength(160);
            entity.Property(row => row.Description).HasColumnName("description").HasMaxLength(4000);
            entity.Property(row => row.Version).HasColumnName("version").IsConcurrencyToken();
            entity.Property(row => row.UpdatedAt).HasColumnName("updated_at");
            entity.HasIndex(row => new { row.FirmId, row.Sku }).IsUnique();
        });
        modelBuilder.Entity<CatalogDraftAuditRow>(entity =>
        {
            entity.ToTable("draft_audit");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").ValueGeneratedOnAdd();
            entity.Property(row => row.DraftId).HasColumnName("draft_id");
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.Actor).HasColumnName("actor").HasMaxLength(128);
            entity.Property(row => row.Action).HasColumnName("action").HasMaxLength(32);
            entity.Property(row => row.Version).HasColumnName("version");
            entity.Property(row => row.OccurredAt).HasColumnName("occurred_at");
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.Id });
        });
    }
}

public sealed class CatalogDbContextFactory : IDesignTimeDbContextFactory<CatalogDbContext>
{
    public CatalogDbContext CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("HIPOS_FEATURES_CONNECTION")
            ?? "Host=127.0.0.1;Database=hipos_features;Username=postgres";
        return new CatalogDbContext(new DbContextOptionsBuilder<CatalogDbContext>()
            .UseNpgsql(connection, npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "catalog"))
            .Options);
    }
}
