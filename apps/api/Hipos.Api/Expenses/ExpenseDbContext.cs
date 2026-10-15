using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Hipos.Api.Expenses;

public sealed class ExpenseCategoryRow
{
    public string FirmId { get; set; } = "";
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public bool IsActive { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class ExpenseRow
{
    public Guid Id { get; set; }
    public Guid RequestId { get; set; }
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string CategoryId { get; set; } = "";
    public DateOnly ExpenseDate { get; set; }
    public long AmountMinor { get; set; }
    public string Currency { get; set; } = "TRY";
    public string Description { get; set; } = "";
    public string Source { get; set; } = "manual";
    public string Actor { get; set; } = "";
    public string RequestFingerprint { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public ExpenseCategoryRow Category { get; set; } = null!;
}

public sealed class ExpenseAuditRow
{
    public long Id { get; set; }
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public Guid RequestId { get; set; }
    public Guid EntityId { get; set; }
    public string Action { get; set; } = "";
    public string Actor { get; set; } = "";
    public string Detail { get; set; } = "";
    public DateTimeOffset OccurredAt { get; set; }
}

public sealed class ExpenseDbContext(DbContextOptions<ExpenseDbContext> options) : DbContext(options)
{
    public DbSet<ExpenseCategoryRow> Categories => Set<ExpenseCategoryRow>();
    public DbSet<ExpenseRow> Expenses => Set<ExpenseRow>();
    public DbSet<ExpenseAuditRow> Audit => Set<ExpenseAuditRow>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("finance");
        modelBuilder.Entity<ExpenseCategoryRow>(entity =>
        {
            entity.ToTable("expense_categories");
            entity.HasKey(row => new { row.FirmId, row.Id });
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.Id).HasColumnName("id").HasMaxLength(48);
            entity.Property(row => row.Name).HasColumnName("name").HasMaxLength(100);
            entity.Property(row => row.IsActive).HasColumnName("is_active");
            entity.Property(row => row.CreatedAt).HasColumnName("created_at");
            entity.HasIndex(row => new { row.FirmId, row.Name }).IsUnique();
        });
        modelBuilder.Entity<ExpenseRow>(entity =>
        {
            entity.ToTable("expenses", table =>
            {
                table.HasCheckConstraint("ck_expense_amount_positive", "amount_minor > 0");
                table.HasCheckConstraint("ck_expense_currency_try", "currency = 'TRY'");
                table.HasCheckConstraint("ck_expense_source_manual", "source = 'manual'");
                table.HasCheckConstraint("ck_expense_description_nonempty", "length(trim(description)) BETWEEN 1 AND 500");
                table.HasCheckConstraint("ck_expense_fingerprint_sha256", "length(request_fingerprint) = 64");
            });
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.RequestId).HasColumnName("request_id");
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.CategoryId).HasColumnName("category_id").HasMaxLength(48);
            entity.Property(row => row.ExpenseDate).HasColumnName("expense_date").HasColumnType("date");
            entity.Property(row => row.AmountMinor).HasColumnName("amount_minor");
            entity.Property(row => row.Currency).HasColumnName("currency").HasMaxLength(3);
            entity.Property(row => row.Description).HasColumnName("description").HasMaxLength(500);
            entity.Property(row => row.Source).HasColumnName("source").HasMaxLength(16);
            entity.Property(row => row.Actor).HasColumnName("actor").HasMaxLength(128);
            entity.Property(row => row.RequestFingerprint).HasColumnName("request_fingerprint").HasMaxLength(64);
            entity.Property(row => row.CreatedAt).HasColumnName("created_at");
            entity.HasIndex(row => new { row.FirmId, row.RequestId }).IsUnique();
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.ExpenseDate, row.Id });
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.CategoryId, row.ExpenseDate });
            entity.HasOne(row => row.Category).WithMany()
                .HasForeignKey(row => new { row.FirmId, row.CategoryId })
                .HasPrincipalKey(row => new { row.FirmId, row.Id }).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<ExpenseAuditRow>(entity =>
        {
            entity.ToTable("audit");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").ValueGeneratedOnAdd();
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.RequestId).HasColumnName("request_id");
            entity.Property(row => row.EntityId).HasColumnName("entity_id");
            entity.Property(row => row.Action).HasColumnName("action").HasMaxLength(40);
            entity.Property(row => row.Actor).HasColumnName("actor").HasMaxLength(128);
            entity.Property(row => row.Detail).HasColumnName("detail").HasMaxLength(1000);
            entity.Property(row => row.OccurredAt).HasColumnName("occurred_at");
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.EntityId, row.OccurredAt });
            entity.HasIndex(row => new { row.FirmId, row.RequestId }).IsUnique();
        });
    }
}

public sealed class ExpenseDbContextFactory : IDesignTimeDbContextFactory<ExpenseDbContext>
{
    public ExpenseDbContext CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("HIPOS_FEATURES_CONNECTION")
            ?? throw new InvalidOperationException("Gider migration için HIPOS_FEATURES_CONNECTION gerekli.");
        var options = new DbContextOptionsBuilder<ExpenseDbContext>()
            .UseNpgsql(connection, npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "finance"))
            .Options;
        return new ExpenseDbContext(options);
    }
}
