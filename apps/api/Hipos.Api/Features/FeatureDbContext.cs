using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Hipos.Api.Features;

public sealed class BranchFeatureRow
{
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string Key { get; set; } = "";
    public bool DesiredEnabled { get; set; }
    public bool EffectiveForNewWork { get; set; }
    public string Lifecycle { get; set; } = "disabled";
    public int InFlightWorkCount { get; set; }
    public int Version { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public BranchFeatureState ToState()
    {
        var definition = FeatureCatalog.All.First(item => item.Key == Key);
        return new BranchFeatureState(Key, FirmId, BranchId, DesiredEnabled,
            EffectiveForNewWork, Lifecycle, FeatureRules.Blockers(definition, Lifecycle),
            InFlightWorkCount, Version, UpdatedAt);
    }

    public void Apply(BranchFeatureState state)
    {
        DesiredEnabled = state.DesiredEnabled;
        EffectiveForNewWork = state.EffectiveForNewWork;
        Lifecycle = state.Lifecycle;
        InFlightWorkCount = state.InFlightWorkCount;
        Version = state.Version;
        UpdatedAt = state.UpdatedAt;
    }

    public static BranchFeatureRow FromState(BranchFeatureState state) => new()
    {
        FirmId = state.FirmId, BranchId = state.BranchId, Key = state.Key,
        DesiredEnabled = state.DesiredEnabled, EffectiveForNewWork = state.EffectiveForNewWork,
        Lifecycle = state.Lifecycle, InFlightWorkCount = state.InFlightWorkCount,
        Version = state.Version, UpdatedAt = state.UpdatedAt,
    };
}

public sealed class FeatureAuditRow
{
    public long Id { get; set; }
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string FeatureKey { get; set; } = "";
    public string Actor { get; set; } = "";
    public bool DesiredEnabled { get; set; }
    public int Version { get; set; }
    public DateTimeOffset OccurredAt { get; set; }

    public FeatureAuditEvent ToEvent() =>
        new(FirmId, BranchId, FeatureKey, Actor, DesiredEnabled, Version, OccurredAt);
}

public sealed class FeatureDbContext(DbContextOptions<FeatureDbContext> options) : DbContext(options)
{
    public DbSet<BranchFeatureRow> BranchFeatureStates => Set<BranchFeatureRow>();
    public DbSet<FeatureAuditRow> FeatureAudit => Set<FeatureAuditRow>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("modules");
        modelBuilder.Entity<BranchFeatureRow>(entity =>
        {
            entity.ToTable("branch_feature_states", table =>
            {
                table.HasCheckConstraint("ck_feature_version_positive", "version > 0");
                table.HasCheckConstraint("ck_in_flight_nonnegative", "in_flight_work_count >= 0");
            });
            entity.HasKey(row => new { row.FirmId, row.BranchId, row.Key });
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.Key).HasColumnName("feature_key").HasMaxLength(128);
            entity.Property(row => row.DesiredEnabled).HasColumnName("desired_enabled");
            entity.Property(row => row.EffectiveForNewWork).HasColumnName("effective_for_new_work");
            entity.Property(row => row.Lifecycle).HasColumnName("lifecycle").HasMaxLength(32);
            entity.Property(row => row.InFlightWorkCount).HasColumnName("in_flight_work_count");
            entity.Property(row => row.Version).HasColumnName("version").IsConcurrencyToken();
            entity.Property(row => row.UpdatedAt).HasColumnName("updated_at");
        });
        modelBuilder.Entity<FeatureAuditRow>(entity =>
        {
            entity.ToTable("feature_audit");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").ValueGeneratedOnAdd();
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.FeatureKey).HasColumnName("feature_key").HasMaxLength(128);
            entity.Property(row => row.Actor).HasColumnName("actor").HasMaxLength(128);
            entity.Property(row => row.DesiredEnabled).HasColumnName("desired_enabled");
            entity.Property(row => row.Version).HasColumnName("version");
            entity.Property(row => row.OccurredAt).HasColumnName("occurred_at");
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.Id });
        });
    }
}

public sealed class FeatureDbContextFactory : IDesignTimeDbContextFactory<FeatureDbContext>
{
    public FeatureDbContext CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("HIPOS_FEATURES_CONNECTION")
            ?? "Host=127.0.0.1;Database=hipos_features;Username=postgres";
        var options = new DbContextOptionsBuilder<FeatureDbContext>().UseNpgsql(connection).Options;
        return new FeatureDbContext(options);
    }
}
