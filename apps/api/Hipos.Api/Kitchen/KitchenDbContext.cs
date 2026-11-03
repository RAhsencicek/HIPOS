using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Hipos.Api.Kitchen;

public sealed class KitchenTaskAudit
{
    public long Id { get; set; }
    public Guid RequestId { get; set; }
    public Guid TaskId { get; set; }
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string Actor { get; set; } = "";
    public string Action { get; set; } = "";
    public string Status { get; set; } = "";
    public int Version { get; set; }
    public DateTimeOffset OccurredAt { get; set; }
}

public sealed class KitchenStation
{
    public Guid Id { get; set; }
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public bool IsActive { get; set; } = true;
}

public sealed class KitchenStationCategory
{
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string CategoryId { get; set; } = "";
    public Guid StationId { get; set; }
}

public sealed class KitchenDbContext(DbContextOptions<KitchenDbContext> options) : DbContext(options)
{
    public DbSet<KitchenTask> Tasks => Set<KitchenTask>();
    public DbSet<KitchenTaskAudit> Audit => Set<KitchenTaskAudit>();
    public DbSet<KitchenStation> Stations => Set<KitchenStation>();
    public DbSet<KitchenStationCategory> StationCategories => Set<KitchenStationCategory>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("kitchen");
        modelBuilder.Entity<KitchenTask>(entity =>
        {
            entity.ToTable("tasks", table =>
            {
                table.HasCheckConstraint("ck_kitchen_task_quantity", "quantity > 0");
                table.HasCheckConstraint("ck_kitchen_task_version", "version > 0");
                table.HasCheckConstraint("ck_kitchen_task_status",
                    "status IN ('submitted', 'preparing', 'ready', 'served', 'cancelled')");
            });
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.OrderId).HasColumnName("order_id");
            entity.Property(row => row.OrderLineId).HasColumnName("order_line_id");
            entity.Property(row => row.StationId).HasColumnName("station_id");
            entity.Property(row => row.ProductName).HasColumnName("product_name").HasMaxLength(160);
            entity.Property(row => row.Quantity).HasColumnName("quantity");
            entity.Property(row => row.Notes).HasColumnName("notes").HasMaxLength(500);
            entity.Property(row => row.Status).HasColumnName("status").HasMaxLength(20);
            entity.Property(row => row.Version).HasColumnName("version").IsConcurrencyToken();
            entity.Property(row => row.SubmittedAt).HasColumnName("submitted_at");
            entity.Property(row => row.PreparedAt).HasColumnName("prepared_at");
            entity.Property(row => row.ReadyAt).HasColumnName("ready_at");
            entity.Property(row => row.ServedAt).HasColumnName("served_at");
            entity.Property(row => row.CancelledAt).HasColumnName("cancelled_at");
            entity.Property(row => row.CancellationReason).HasColumnName("cancellation_reason").HasMaxLength(240);
            entity.Property(row => row.CancelledBy).HasColumnName("cancelled_by").HasMaxLength(100);
            entity.HasIndex(row => row.OrderLineId).IsUnique();
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.Status, row.SubmittedAt });
            entity.HasOne<KitchenStation>().WithMany().HasForeignKey(row => row.StationId)
                .OnDelete(DeleteBehavior.SetNull);
        });
        modelBuilder.Entity<KitchenStation>(entity =>
        {
            entity.ToTable("stations");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.Code).HasColumnName("code").HasMaxLength(40);
            entity.Property(row => row.Name).HasColumnName("name").HasMaxLength(100);
            entity.Property(row => row.IsActive).HasColumnName("is_active");
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.Code }).IsUnique();
        });
        modelBuilder.Entity<KitchenStationCategory>(entity =>
        {
            entity.ToTable("station_categories");
            entity.HasKey(row => new { row.FirmId, row.BranchId, row.CategoryId });
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.CategoryId).HasColumnName("category_id").HasMaxLength(80);
            entity.Property(row => row.StationId).HasColumnName("station_id");
            entity.HasOne<KitchenStation>().WithMany().HasForeignKey(row => row.StationId)
                .OnDelete(DeleteBehavior.Cascade);
        });
        modelBuilder.Entity<KitchenTaskAudit>(entity =>
        {
            entity.ToTable("task_audit");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").ValueGeneratedOnAdd();
            entity.Property(row => row.RequestId).HasColumnName("request_id");
            entity.Property(row => row.TaskId).HasColumnName("task_id");
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.Actor).HasColumnName("actor").HasMaxLength(100);
            entity.Property(row => row.Action).HasColumnName("action").HasMaxLength(40);
            entity.Property(row => row.Status).HasColumnName("status").HasMaxLength(20);
            entity.Property(row => row.Version).HasColumnName("version");
            entity.Property(row => row.OccurredAt).HasColumnName("occurred_at");
            entity.HasIndex(row => row.RequestId).IsUnique();
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.TaskId });
        });
    }
}

public sealed class KitchenDbContextFactory : IDesignTimeDbContextFactory<KitchenDbContext>
{
    public KitchenDbContext CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("HIPOS_FEATURES_CONNECTION")
            ?? "Host=127.0.0.1;Port=5433;Database=hipos_features;Username=hipos;Password=hipos-dev-only";
        var options = new DbContextOptionsBuilder<KitchenDbContext>().UseNpgsql(connection,
            npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "kitchen")).Options;
        return new KitchenDbContext(options);
    }
}
