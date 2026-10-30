using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Hipos.Api.Cash;

public sealed class CashRegisterRow
{
    public Guid Id { get; set; }
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public string ProviderMode { get; set; } = "manual";
    public bool IsActive { get; set; } = true;
    public int Version { get; set; } = 1;
}

public sealed class CashShiftRow
{
    public Guid Id { get; set; }
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public Guid RegisterId { get; set; }
    public string Status { get; set; } = "open";
    public long OpeningCashMinor { get; set; }
    public string? OpeningNote { get; set; }
    public string OpenedBy { get; set; } = "";
    public DateTimeOffset OpenedAt { get; set; }
    public long? ExpectedCashMinor { get; set; }
    public long? CountedCashMinor { get; set; }
    public long? DifferenceMinor { get; set; }
    public string? CloseNote { get; set; }
    public Guid? CloseRequestId { get; set; }
    public string? ClosedBy { get; set; }
    public DateTimeOffset? ClosedAt { get; set; }
    public int Version { get; set; } = 1;
    public CashRegisterRow Register { get; set; } = null!;
    public List<CashMovementRow> Movements { get; set; } = [];
}

public sealed class CashMovementRow
{
    public Guid Id { get; set; }
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public Guid RegisterId { get; set; }
    public Guid ShiftId { get; set; }
    public string Kind { get; set; } = "";
    public string Category { get; set; } = "";
    public long AmountMinor { get; set; }
    public string Currency { get; set; } = "TRY";
    public string Description { get; set; } = "";
    public string Source { get; set; } = "manual";
    public string? Provider { get; set; }
    public string? ExternalReference { get; set; }
    public string? ProviderEventId { get; set; }
    public Guid? OriginalMovementId { get; set; }
    public string? CorrectionType { get; set; }
    public string? CorrectionReason { get; set; }
    public string Actor { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public CashShiftRow Shift { get; set; } = null!;
    public CashMovementRow? OriginalMovement { get; set; }
    public List<CashMovementRow> Corrections { get; set; } = [];
}

public sealed class CashAuditRow
{
    public long Id { get; set; }
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public Guid RegisterId { get; set; }
    public Guid? ShiftId { get; set; }
    public Guid RequestId { get; set; }
    public string EntityType { get; set; } = "";
    public Guid EntityId { get; set; }
    public string Action { get; set; } = "";
    public string Actor { get; set; } = "";
    public string Detail { get; set; } = "";
    public DateTimeOffset OccurredAt { get; set; }
}

public sealed class CashDbContext(DbContextOptions<CashDbContext> options) : DbContext(options)
{
    public DbSet<CashRegisterRow> Registers => Set<CashRegisterRow>();
    public DbSet<CashShiftRow> Shifts => Set<CashShiftRow>();
    public DbSet<CashMovementRow> Movements => Set<CashMovementRow>();
    public DbSet<CashAuditRow> Audit => Set<CashAuditRow>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("cash");
        modelBuilder.Entity<CashRegisterRow>(entity =>
        {
            entity.ToTable("registers", table =>
            {
                table.HasCheckConstraint("ck_cash_register_provider", "provider_mode IN ('manual', 'external_pos')");
                table.HasCheckConstraint("ck_cash_register_version_positive", "version > 0");
            });
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.Code).HasColumnName("code").HasMaxLength(48);
            entity.Property(row => row.Name).HasColumnName("name").HasMaxLength(128);
            entity.Property(row => row.ProviderMode).HasColumnName("provider_mode").HasMaxLength(16);
            entity.Property(row => row.IsActive).HasColumnName("is_active");
            entity.Property(row => row.Version).HasColumnName("version");
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.Code }).IsUnique();
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.Id }).IsUnique();
        });
        modelBuilder.Entity<CashShiftRow>(entity =>
        {
            entity.ToTable("shifts", table =>
            {
                table.HasCheckConstraint("ck_cash_shift_status", "status IN ('open', 'closed')");
                table.HasCheckConstraint("ck_cash_shift_opening_nonnegative", "opening_cash_minor >= 0");
                table.HasCheckConstraint("ck_cash_shift_count_nonnegative", "counted_cash_minor IS NULL OR counted_cash_minor >= 0");
                table.HasCheckConstraint("ck_cash_shift_version_positive", "version > 0");
            });
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.RegisterId).HasColumnName("register_id");
            entity.Property(row => row.Status).HasColumnName("status").HasMaxLength(16);
            entity.Property(row => row.OpeningCashMinor).HasColumnName("opening_cash_minor");
            entity.Property(row => row.OpeningNote).HasColumnName("opening_note").HasMaxLength(500);
            entity.Property(row => row.OpenedBy).HasColumnName("opened_by").HasMaxLength(128);
            entity.Property(row => row.OpenedAt).HasColumnName("opened_at");
            entity.Property(row => row.ExpectedCashMinor).HasColumnName("expected_cash_minor");
            entity.Property(row => row.CountedCashMinor).HasColumnName("counted_cash_minor");
            entity.Property(row => row.DifferenceMinor).HasColumnName("difference_minor");
            entity.Property(row => row.CloseNote).HasColumnName("close_note").HasMaxLength(500);
            entity.Property(row => row.CloseRequestId).HasColumnName("close_request_id");
            entity.Property(row => row.ClosedBy).HasColumnName("closed_by").HasMaxLength(128);
            entity.Property(row => row.ClosedAt).HasColumnName("closed_at");
            entity.Property(row => row.Version).HasColumnName("version").IsConcurrencyToken();
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.RegisterId, row.Id }).IsUnique();
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.RegisterId, row.Status });
            entity.HasIndex(row => row.RegisterId).IsUnique().HasFilter("status = 'open'");
            entity.HasIndex(row => row.CloseRequestId).IsUnique().HasFilter("close_request_id IS NOT NULL");
            entity.HasOne(row => row.Register).WithMany().HasForeignKey(row => new { row.FirmId, row.BranchId, row.RegisterId })
                .HasPrincipalKey(row => new { row.FirmId, row.BranchId, row.Id }).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<CashMovementRow>(entity =>
        {
            entity.ToTable("movements", table =>
            {
                table.HasCheckConstraint("ck_cash_movement_kind", "kind IN ('opening_float', 'manual_in', 'manual_out')");
                table.HasCheckConstraint("ck_cash_movement_category", "category IN ('opening', 'cash_sale', 'expense', 'cash_drop', 'other')");
                table.HasCheckConstraint("ck_cash_movement_amount_positive", "amount_minor > 0 OR (kind = 'opening_float' AND amount_minor = 0)");
                table.HasCheckConstraint("ck_cash_movement_currency", "currency = 'TRY'");
                table.HasCheckConstraint("ck_cash_movement_source", "source IN ('manual', 'pos')");
                table.HasCheckConstraint("ck_cash_movement_external_identity",
                    "(source = 'manual' AND provider IS NULL AND external_reference IS NULL AND provider_event_id IS NULL) OR (source = 'pos' AND provider IS NOT NULL AND provider_event_id IS NOT NULL)");
                table.HasCheckConstraint("ck_cash_movement_correction",
                    "(original_movement_id IS NULL AND correction_type IS NULL AND correction_reason IS NULL) OR (original_movement_id IS NOT NULL AND correction_type = 'reversal' AND correction_reason IS NOT NULL AND length(trim(correction_reason)) BETWEEN 3 AND 500 AND source = 'manual' AND kind IN ('manual_in', 'manual_out'))");
            });
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.RegisterId).HasColumnName("register_id");
            entity.Property(row => row.ShiftId).HasColumnName("shift_id");
            entity.Property(row => row.Kind).HasColumnName("kind").HasMaxLength(24);
            entity.Property(row => row.Category).HasColumnName("category").HasMaxLength(24);
            entity.Property(row => row.AmountMinor).HasColumnName("amount_minor");
            entity.Property(row => row.Currency).HasColumnName("currency").HasMaxLength(3);
            entity.Property(row => row.Description).HasColumnName("description").HasMaxLength(500);
            entity.Property(row => row.Source).HasColumnName("source").HasMaxLength(16);
            entity.Property(row => row.Provider).HasColumnName("provider").HasMaxLength(80);
            entity.Property(row => row.ExternalReference).HasColumnName("external_reference").HasMaxLength(160);
            entity.Property(row => row.ProviderEventId).HasColumnName("provider_event_id").HasMaxLength(160);
            entity.Property(row => row.OriginalMovementId).HasColumnName("original_movement_id");
            entity.Property(row => row.CorrectionType).HasColumnName("correction_type").HasMaxLength(24);
            entity.Property(row => row.CorrectionReason).HasColumnName("correction_reason").HasMaxLength(500);
            entity.Property(row => row.Actor).HasColumnName("actor").HasMaxLength(128);
            entity.Property(row => row.CreatedAt).HasColumnName("created_at");
            entity.HasOne(row => row.Shift).WithMany(shift => shift.Movements)
                .HasForeignKey(row => new { row.FirmId, row.BranchId, row.RegisterId, row.ShiftId })
                .HasPrincipalKey(shift => new { shift.FirmId, shift.BranchId, shift.RegisterId, shift.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.ShiftId, row.CreatedAt, row.Id });
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.Provider, row.ProviderEventId })
                .IsUnique().HasFilter("provider_event_id IS NOT NULL");
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.RegisterId, row.OriginalMovementId })
                .IsUnique().HasFilter("original_movement_id IS NOT NULL");
            entity.HasOne(row => row.OriginalMovement).WithMany(movement => movement.Corrections)
                .HasForeignKey(row => new { row.FirmId, row.BranchId, row.RegisterId, row.OriginalMovementId })
                .HasPrincipalKey(movement => new { movement.FirmId, movement.BranchId, movement.RegisterId, movement.Id })
                .OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<CashAuditRow>(entity =>
        {
            entity.ToTable("audit");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").ValueGeneratedOnAdd();
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.RegisterId).HasColumnName("register_id");
            entity.Property(row => row.ShiftId).HasColumnName("shift_id");
            entity.Property(row => row.RequestId).HasColumnName("request_id");
            entity.Property(row => row.EntityType).HasColumnName("entity_type").HasMaxLength(24);
            entity.Property(row => row.EntityId).HasColumnName("entity_id");
            entity.Property(row => row.Action).HasColumnName("action").HasMaxLength(40);
            entity.Property(row => row.Actor).HasColumnName("actor").HasMaxLength(128);
            entity.Property(row => row.Detail).HasColumnName("detail").HasMaxLength(1000);
            entity.Property(row => row.OccurredAt).HasColumnName("occurred_at");
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.RequestId }).IsUnique();
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.ShiftId, row.Id });
        });
    }
}

public sealed class CashDbContextFactory : IDesignTimeDbContextFactory<CashDbContext>
{
    public CashDbContext CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("HIPOS_FEATURES_CONNECTION")
            ?? "Host=127.0.0.1;Database=hipos_features;Username=postgres";
        return new CashDbContext(new DbContextOptionsBuilder<CashDbContext>()
            .UseNpgsql(connection, npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "cash"))
            .Options);
    }
}
