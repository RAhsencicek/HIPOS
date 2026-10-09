using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Hipos.Api.Service;

public sealed class ServiceTableRow
{
    public string Id { get; set; } = "";
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public int Number { get; set; }
    public string Name { get; set; } = "";
    public bool IsActive { get; set; } = true;
    public int Version { get; set; } = 1;
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class ServiceWaiterRow
{
    public string Id { get; set; } = "";
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string Name { get; set; } = "";
    public string Department { get; set; } = "service";
    public string JobTitle { get; set; } = "Garson";
    public string? Phone { get; set; }
    public bool IsActive { get; set; } = true;
    public int Version { get; set; } = 1;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

// Satış modülünün tablosuna yalnız yabancı anahtar için başvurulur; satış satırının sahibi SalesDbContext'tir.
public sealed class ServiceSalesOrderRef
{
    public Guid Id { get; set; }
}

public sealed class ServiceAssignmentRow
{
    public Guid Id { get; set; }
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string TableId { get; set; } = "";
    public Guid OrderId { get; set; }
    public string? WaiterId { get; set; }
    public DateTimeOffset OpenedAt { get; set; }
    public DateTimeOffset? ClosedAt { get; set; }
    public int Version { get; set; } = 1;
    public string CreatedBy { get; set; } = "";
    public string? ClosedBy { get; set; }
}

public sealed class ServiceAuditRow
{
    public long Id { get; set; }
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string EntityId { get; set; } = "";
    public string Action { get; set; } = "";
    public string Actor { get; set; } = "";
    public DateTimeOffset OccurredAt { get; set; }
}

public sealed class ServiceDbContext(DbContextOptions<ServiceDbContext> options) : DbContext(options)
{
    public DbSet<ServiceTableRow> Tables => Set<ServiceTableRow>();
    public DbSet<ServiceWaiterRow> Employees => Set<ServiceWaiterRow>();
    public DbSet<ServiceWaiterRow> Waiters => Set<ServiceWaiterRow>(); // Geriye dönük servis API'si uyumluluğu.
    public DbSet<ServiceAssignmentRow> Assignments => Set<ServiceAssignmentRow>();
    public DbSet<ServiceAuditRow> Audit => Set<ServiceAuditRow>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("service");
        modelBuilder.Entity<ServiceTableRow>(entity =>
        {
            entity.ToTable("tables", table => table.HasCheckConstraint("ck_table_number", "number BETWEEN 1 AND 999"));
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").HasMaxLength(80);
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.Number).HasColumnName("number");
            entity.Property(row => row.Name).HasColumnName("name").HasMaxLength(80);
            entity.Property(row => row.IsActive).HasColumnName("is_active");
            entity.Property(row => row.Version).HasColumnName("version").IsConcurrencyToken();
            entity.Property(row => row.UpdatedAt).HasColumnName("updated_at");
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.Number }).IsUnique();
        });
        modelBuilder.Entity<ServiceWaiterRow>(entity =>
        {
            entity.ToTable("employees", table => table.HasCheckConstraint("ck_employee_department", "department IN ('management','kitchen','service','cashier','support')"));
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").HasMaxLength(80);
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.Name).HasColumnName("name").HasMaxLength(160);
            entity.Property(row => row.Department).HasColumnName("department").HasMaxLength(24);
            entity.Property(row => row.JobTitle).HasColumnName("job_title").HasMaxLength(80);
            entity.Property(row => row.Phone).HasColumnName("phone").HasMaxLength(40);
            entity.Property(row => row.IsActive).HasColumnName("is_active");
            entity.Property(row => row.Version).HasColumnName("version").IsConcurrencyToken();
            entity.Property(row => row.CreatedAt).HasColumnName("created_at");
            entity.Property(row => row.UpdatedAt).HasColumnName("updated_at");
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.Department, row.IsActive });
        });
        modelBuilder.Entity<ServiceSalesOrderRef>(entity =>
        {
            entity.ToTable("orders", "sales", table => table.ExcludeFromMigrations());
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
        });
        modelBuilder.Entity<ServiceAssignmentRow>(entity =>
        {
            entity.ToTable("assignments", table => table.HasCheckConstraint("ck_assignment_version", "version > 0"));
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.TableId).HasColumnName("table_id").HasMaxLength(80);
            entity.Property(row => row.OrderId).HasColumnName("order_id");
            entity.Property(row => row.WaiterId).HasColumnName("waiter_id").HasMaxLength(80);
            entity.Property(row => row.OpenedAt).HasColumnName("opened_at");
            entity.Property(row => row.ClosedAt).HasColumnName("closed_at");
            entity.Property(row => row.Version).HasColumnName("version").IsConcurrencyToken();
            entity.Property(row => row.CreatedBy).HasColumnName("created_by").HasMaxLength(80);
            entity.Property(row => row.ClosedBy).HasColumnName("closed_by").HasMaxLength(80);
            entity.HasOne<ServiceTableRow>().WithMany().HasForeignKey(row => row.TableId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ServiceWaiterRow>().WithMany().HasForeignKey(row => row.WaiterId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ServiceSalesOrderRef>().WithMany().HasForeignKey(row => row.OrderId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(row => row.OrderId).IsUnique();
            entity.HasIndex(row => row.TableId).IsUnique().HasFilter("closed_at IS NULL");
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.ClosedAt });
        });
        modelBuilder.Entity<ServiceAuditRow>(entity =>
        {
            entity.ToTable("audit");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").ValueGeneratedOnAdd();
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.EntityId).HasColumnName("entity_id").HasMaxLength(80);
            entity.Property(row => row.Action).HasColumnName("action").HasMaxLength(32);
            entity.Property(row => row.Actor).HasColumnName("actor").HasMaxLength(80);
            entity.Property(row => row.OccurredAt).HasColumnName("occurred_at");
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.EntityId, row.OccurredAt });
        });
    }
}

public sealed class ServiceDbContextFactory : IDesignTimeDbContextFactory<ServiceDbContext>
{
    public ServiceDbContext CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("HIPOS_FEATURES_CONNECTION")
            ?? throw new InvalidOperationException("Service migration için HIPOS_FEATURES_CONNECTION gerekli.");
        return new ServiceDbContext(new DbContextOptionsBuilder<ServiceDbContext>()
            .UseNpgsql(connection, npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "service"))
            .Options);
    }
}
