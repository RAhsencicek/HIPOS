using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Hipos.Api.Overview;

public sealed class AlertAcknowledgmentRow
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string AlertKey { get; set; } = "";
    public string Category { get; set; } = "";
    public string Title { get; set; } = "";
    public string Actor { get; set; } = "";
    public string? Note { get; set; }
    public DateTimeOffset AcknowledgedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class OverviewDbContext(DbContextOptions<OverviewDbContext> options) : DbContext(options)
{
    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
    {
        base.OnConfiguring(optionsBuilder);
        optionsBuilder.ConfigureWarnings(w => w.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.RelationalEventId.PendingModelChangesWarning));
    }

    public DbSet<AlertAcknowledgmentRow> AlertAcknowledgments => Set<AlertAcknowledgmentRow>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("overview");

        modelBuilder.Entity<AlertAcknowledgmentRow>(entity =>
        {
            entity.ToTable("alert_acknowledgments");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.AlertKey).HasColumnName("alert_key").HasMaxLength(128);
            entity.Property(row => row.Category).HasColumnName("category").HasMaxLength(32);
            entity.Property(row => row.Title).HasColumnName("title").HasMaxLength(256);
            entity.Property(row => row.Actor).HasColumnName("actor").HasMaxLength(128);
            entity.Property(row => row.Note).HasColumnName("note").HasMaxLength(500);
            entity.Property(row => row.AcknowledgedAt).HasColumnName("acknowledged_at");

            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.AlertKey }).IsUnique();
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.AcknowledgedAt });
        });
    }
}

public sealed class OverviewDbContextFactory : IDesignTimeDbContextFactory<OverviewDbContext>
{
    public OverviewDbContext CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("HIPOS_FEATURES_CONNECTION")
            ?? "Host=127.0.0.1;Port=5433;Database=hipos_features;Username=hipos;Password=hipos-dev-only";
        var options = new DbContextOptionsBuilder<OverviewDbContext>()
            .UseNpgsql(connection, npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "overview"))
            .Options;
        return new OverviewDbContext(options);
    }
}
