using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Hipos.Api.Sales;

public sealed class SalesOrderRow
{
    public Guid Id { get; set; }
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string Source { get; set; } = "test_pos";
    public string Status { get; set; } = "open";
    public string PaymentStatus { get; set; } = "unpaid";
    public long TotalMinor { get; set; }
    public string Currency { get; set; } = "TRY";
    public string RequestFingerprint { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public int Version { get; set; } = 1;
    public List<SalesOrderLineRow> Lines { get; set; } = [];
    public List<PaymentAttemptRow> PaymentAttempts { get; set; } = [];
}

public sealed class PaymentAttemptRow
{
    public Guid Id { get; set; }
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public Guid OrderId { get; set; }
    public long AmountMinor { get; set; }
    public string Currency { get; set; } = "TRY";
    public string Method { get; set; } = "card";
    public string Status { get; set; } = "pending";
    public string RequestedOutcome { get; set; } = "pending";
    public int Version { get; set; } = 1;
    public string Actor { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public SalesOrderRow Order { get; set; } = null!;
}

public sealed class PaymentAttemptAuditRow
{
    public long Id { get; set; }
    public Guid AttemptId { get; set; }
    public Guid OrderId { get; set; }
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string Actor { get; set; } = "";
    public string Action { get; set; } = "";
    public string Status { get; set; } = "";
    public int Version { get; set; }
    public DateTimeOffset OccurredAt { get; set; }
}

public sealed class SalesOrderLineRow
{
    public long Id { get; set; }
    public Guid OrderId { get; set; }
    public Guid ProductId { get; set; }
    public string ProductName { get; set; } = "";
    public string Sku { get; set; } = "";
    public int Quantity { get; set; }
    public long UnitPriceMinor { get; set; }
    public long LineTotalMinor { get; set; }
    public string Currency { get; set; } = "TRY";
    public SalesOrderRow Order { get; set; } = null!;
}

public sealed class SalesOrderAuditRow
{
    public long Id { get; set; }
    public Guid OrderId { get; set; }
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string Actor { get; set; } = "";
    public string Action { get; set; } = "";
    public int Version { get; set; }
    public DateTimeOffset OccurredAt { get; set; }
}

public sealed class SalesDbContext(DbContextOptions<SalesDbContext> options) : DbContext(options)
{
    public DbSet<SalesOrderRow> Orders => Set<SalesOrderRow>();
    public DbSet<SalesOrderLineRow> Lines => Set<SalesOrderLineRow>();
    public DbSet<SalesOrderAuditRow> Audit => Set<SalesOrderAuditRow>();
    public DbSet<PaymentAttemptRow> PaymentAttempts => Set<PaymentAttemptRow>();
    public DbSet<PaymentAttemptAuditRow> PaymentAudit => Set<PaymentAttemptAuditRow>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("sales");
        modelBuilder.Entity<SalesOrderRow>(entity =>
        {
            entity.ToTable("orders", table =>
            {
                table.HasCheckConstraint("ck_order_version_positive", "version > 0");
                table.HasCheckConstraint("ck_order_total_positive", "total_minor > 0");
                table.HasCheckConstraint("ck_order_status", "status IN ('open')");
                table.HasCheckConstraint("ck_order_payment_status", "payment_status IN ('unpaid', 'partially_paid', 'paid', 'pending', 'unknown')");
            });
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.Source).HasColumnName("source").HasMaxLength(32);
            entity.Property(row => row.Status).HasColumnName("status").HasMaxLength(16);
            entity.Property(row => row.PaymentStatus).HasColumnName("payment_status").HasMaxLength(16);
            entity.Property(row => row.TotalMinor).HasColumnName("total_minor");
            entity.Property(row => row.Currency).HasColumnName("currency").HasMaxLength(3);
            entity.Property(row => row.RequestFingerprint).HasColumnName("request_fingerprint").HasMaxLength(64);
            entity.Property(row => row.CreatedAt).HasColumnName("created_at");
            entity.Property(row => row.Version).HasColumnName("version").IsConcurrencyToken();
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.CreatedAt });
        });
        modelBuilder.Entity<SalesOrderLineRow>(entity =>
        {
            entity.ToTable("order_lines", table =>
            {
                table.HasCheckConstraint("ck_line_quantity_positive", "quantity > 0");
                table.HasCheckConstraint("ck_line_price_positive", "unit_price_minor > 0 AND line_total_minor > 0");
            });
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").ValueGeneratedOnAdd();
            entity.Property(row => row.OrderId).HasColumnName("order_id");
            entity.Property(row => row.ProductId).HasColumnName("product_id");
            entity.Property(row => row.ProductName).HasColumnName("product_name").HasMaxLength(256);
            entity.Property(row => row.Sku).HasColumnName("sku").HasMaxLength(80);
            entity.Property(row => row.Quantity).HasColumnName("quantity");
            entity.Property(row => row.UnitPriceMinor).HasColumnName("unit_price_minor");
            entity.Property(row => row.LineTotalMinor).HasColumnName("line_total_minor");
            entity.Property(row => row.Currency).HasColumnName("currency").HasMaxLength(3);
            entity.HasOne(row => row.Order).WithMany(order => order.Lines)
                .HasForeignKey(row => row.OrderId).OnDelete(DeleteBehavior.Cascade);
        });
        modelBuilder.Entity<SalesOrderAuditRow>(entity =>
        {
            entity.ToTable("order_audit");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").ValueGeneratedOnAdd();
            entity.Property(row => row.OrderId).HasColumnName("order_id");
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.Actor).HasColumnName("actor").HasMaxLength(128);
            entity.Property(row => row.Action).HasColumnName("action").HasMaxLength(32);
            entity.Property(row => row.Version).HasColumnName("version");
            entity.Property(row => row.OccurredAt).HasColumnName("occurred_at");
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.OrderId, row.Id });
        });
        modelBuilder.Entity<PaymentAttemptRow>(entity =>
        {
            entity.ToTable("payment_attempts", table =>
            {
                table.HasCheckConstraint("ck_payment_amount_positive", "amount_minor > 0");
                table.HasCheckConstraint("ck_payment_version_positive", "version > 0");
                table.HasCheckConstraint("ck_payment_method", "method IN ('cash', 'card')");
                table.HasCheckConstraint("ck_payment_status", "status IN ('succeeded', 'failed', 'pending', 'unknown', 'cancelled')");
                table.HasCheckConstraint("ck_payment_requested_outcome", "requested_outcome IN ('succeeded', 'failed', 'pending', 'unknown')");
            });
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.OrderId).HasColumnName("order_id");
            entity.Property(row => row.AmountMinor).HasColumnName("amount_minor");
            entity.Property(row => row.Currency).HasColumnName("currency").HasMaxLength(3);
            entity.Property(row => row.Method).HasColumnName("method").HasMaxLength(16);
            entity.Property(row => row.Status).HasColumnName("status").HasMaxLength(16);
            entity.Property(row => row.RequestedOutcome).HasColumnName("requested_outcome").HasMaxLength(16);
            entity.Property(row => row.Version).HasColumnName("version").IsConcurrencyToken();
            entity.Property(row => row.Actor).HasColumnName("actor").HasMaxLength(128);
            entity.Property(row => row.CreatedAt).HasColumnName("created_at");
            entity.Property(row => row.UpdatedAt).HasColumnName("updated_at");
            entity.HasOne(row => row.Order).WithMany(order => order.PaymentAttempts)
                .HasForeignKey(row => row.OrderId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.OrderId, row.Status });
        });
        modelBuilder.Entity<PaymentAttemptAuditRow>(entity =>
        {
            entity.ToTable("payment_attempt_audit");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").ValueGeneratedOnAdd();
            entity.Property(row => row.AttemptId).HasColumnName("attempt_id");
            entity.Property(row => row.OrderId).HasColumnName("order_id");
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.Actor).HasColumnName("actor").HasMaxLength(128);
            entity.Property(row => row.Action).HasColumnName("action").HasMaxLength(32);
            entity.Property(row => row.Status).HasColumnName("status").HasMaxLength(16);
            entity.Property(row => row.Version).HasColumnName("version");
            entity.Property(row => row.OccurredAt).HasColumnName("occurred_at");
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.OrderId, row.Id });
        });
    }
}

public sealed class SalesDbContextFactory : IDesignTimeDbContextFactory<SalesDbContext>
{
    public SalesDbContext CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("HIPOS_FEATURES_CONNECTION")
            ?? "Host=127.0.0.1;Database=hipos_features;Username=postgres";
        return new SalesDbContext(new DbContextOptionsBuilder<SalesDbContext>()
            .UseNpgsql(connection, npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "sales"))
            .Options);
    }
}
