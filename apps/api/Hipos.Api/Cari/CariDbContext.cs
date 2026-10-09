using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Hipos.Api.Cari;

public sealed class CariPartyRow
{
    public string Id { get; set; } = "";
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string Name { get; set; } = "";
    public string[] Types { get; set; } = [];
    public bool IsActive { get; set; } = true;
    public int Version { get; set; } = 1;
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class CariMovementRow
{
    public string Id { get; set; } = "";
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string PartyId { get; set; } = "";
    public string Kind { get; set; } = "";
    public long DeltaMinor { get; set; }
    public string Currency { get; set; } = "TRY";
    public string Description { get; set; } = "";
    public string Source { get; set; } = "manual";
    public string Actor { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class CariAuditRow
{
    public long Id { get; set; }
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string PartyId { get; set; } = "";
    public string Action { get; set; } = "";
    public string Actor { get; set; } = "";
    public string Detail { get; set; } = "";
    public DateTimeOffset OccurredAt { get; set; }
}

public sealed class CariDbContext(DbContextOptions<CariDbContext> options) : DbContext(options)
{
    public DbSet<CariPartyRow> Parties => Set<CariPartyRow>();
    public DbSet<CariMovementRow> Movements => Set<CariMovementRow>();
    public DbSet<CariAuditRow> Audit => Set<CariAuditRow>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("cari");
        modelBuilder.Entity<CariPartyRow>(entity =>
        {
            entity.ToTable("parties", table => table.HasCheckConstraint("ck_party_version", "version > 0"));
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").HasMaxLength(80);
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.Name).HasColumnName("name").HasMaxLength(160);
            entity.Property(row => row.Types).HasColumnName("types");
            entity.Property(row => row.IsActive).HasColumnName("is_active");
            entity.Property(row => row.Version).HasColumnName("version").IsConcurrencyToken();
            entity.Property(row => row.UpdatedAt).HasColumnName("updated_at");
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.Name });
        });
        modelBuilder.Entity<CariMovementRow>(entity =>
        {
            entity.ToTable("movements", table =>
            {
                table.HasCheckConstraint("ck_movement_nonzero", "delta_minor <> 0");
                table.HasCheckConstraint("ck_movement_kind", "kind IN ('customer', 'supplier')");
                table.HasCheckConstraint("ck_movement_currency", "currency = 'TRY'");
            });
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").HasMaxLength(80);
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.PartyId).HasColumnName("party_id").HasMaxLength(80);
            entity.Property(row => row.Kind).HasColumnName("kind").HasMaxLength(16);
            entity.Property(row => row.DeltaMinor).HasColumnName("delta_minor");
            entity.Property(row => row.Currency).HasColumnName("currency").HasMaxLength(3);
            entity.Property(row => row.Description).HasColumnName("description").HasMaxLength(500);
            entity.Property(row => row.Source).HasColumnName("source").HasMaxLength(24);
            entity.Property(row => row.Actor).HasColumnName("actor").HasMaxLength(80);
            entity.Property(row => row.CreatedAt).HasColumnName("created_at");
            entity.HasOne<CariPartyRow>().WithMany().HasForeignKey(row => row.PartyId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.PartyId, row.CreatedAt });
        });
        modelBuilder.Entity<CariAuditRow>(entity =>
        {
            entity.ToTable("audit");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").ValueGeneratedOnAdd();
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.PartyId).HasColumnName("party_id").HasMaxLength(80);
            entity.Property(row => row.Action).HasColumnName("action").HasMaxLength(32);
            entity.Property(row => row.Actor).HasColumnName("actor").HasMaxLength(80);
            entity.Property(row => row.Detail).HasColumnName("detail").HasMaxLength(500);
            entity.Property(row => row.OccurredAt).HasColumnName("occurred_at");
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.PartyId, row.OccurredAt });
        });
    }
}

public sealed class CariDbContextFactory : IDesignTimeDbContextFactory<CariDbContext>
{
    public CariDbContext CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("HIPOS_FEATURES_CONNECTION")
            ?? throw new InvalidOperationException("Cari migration için HIPOS_FEATURES_CONNECTION gerekli.");
        var options = new DbContextOptionsBuilder<CariDbContext>()
            .UseNpgsql(connection,
                npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "cari"))
            .Options;
        return new CariDbContext(options);
    }
}
