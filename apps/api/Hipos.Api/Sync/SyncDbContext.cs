using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Hipos.Api.Sync;

public sealed class SyncOutboxRow
{
    public Guid EventId { get; set; }
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string AggregateType { get; set; } = "";
    public string AggregateId { get; set; } = "";
    public string PartitionKey { get; set; } = "";
    public string EventType { get; set; } = "";
    public string PayloadJson { get; set; } = "{}";
    public string PayloadHash { get; set; } = "";
    public int SchemaVersion { get; set; } = 1;
    public string IdempotencyKey { get; set; } = "";
    public string OriginNodeId { get; set; } = "";
    public string Status { get; set; } = "pending";
    public int Attempts { get; set; }
    public DateTimeOffset NextRetryAt { get; set; }
    public string? LastError { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? AckedAt { get; set; }
}

public sealed class SyncInboundEventRow
{
    public Guid EventId { get; set; }
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string AggregateType { get; set; } = "";
    public string AggregateId { get; set; } = "";
    public string EventType { get; set; } = "";
    public string PayloadJson { get; set; } = "{}";
    public string PayloadHash { get; set; } = "";
    public string OriginNodeId { get; set; } = "";
    public int SchemaVersion { get; set; } = 1;
    public string Status { get; set; } = "applied";
    public DateTimeOffset ReceivedAt { get; set; }
    public DateTimeOffset SourceCreatedAt { get; set; }
}

public sealed class BranchSyncStatusRow
{
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string NodeMode { get; set; } = "cloud";
    public string? CloudUpstreamUrl { get; set; }
    public bool CloudReachable { get; set; } = true;
    public DateTimeOffset? LastCloudCheckAt { get; set; }
    public DateTimeOffset? LastAckAt { get; set; }
    public string? LastError { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class SyncDbContext(DbContextOptions<SyncDbContext> options) : DbContext(options)
{
    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
    {
        base.OnConfiguring(optionsBuilder);
        optionsBuilder.ConfigureWarnings(w =>
            w.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.RelationalEventId.PendingModelChangesWarning));
    }

    public DbSet<SyncOutboxRow> Outbox => Set<SyncOutboxRow>();
    public DbSet<SyncInboundEventRow> InboundEvents => Set<SyncInboundEventRow>();
    public DbSet<BranchSyncStatusRow> BranchStatuses => Set<BranchSyncStatusRow>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("sync");

        modelBuilder.Entity<SyncOutboxRow>(entity =>
        {
            entity.ToTable("outbox", table =>
                table.HasCheckConstraint("ck_sync_outbox_status",
                    "status IN ('pending', 'sending', 'acked', 'failed_retryable', 'blocked')"));
            entity.HasKey(row => row.EventId);
            entity.Property(row => row.EventId).HasColumnName("event_id");
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64).IsRequired();
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64).IsRequired();
            entity.Property(row => row.AggregateType).HasColumnName("aggregate_type").HasMaxLength(40).IsRequired();
            entity.Property(row => row.AggregateId).HasColumnName("aggregate_id").HasMaxLength(80).IsRequired();
            entity.Property(row => row.PartitionKey).HasColumnName("partition_key").HasMaxLength(100).IsRequired();
            entity.Property(row => row.EventType).HasColumnName("event_type").HasMaxLength(64).IsRequired();
            entity.Property(row => row.PayloadJson).HasColumnName("payload_json").HasColumnType("jsonb").IsRequired();
            entity.Property(row => row.PayloadHash).HasColumnName("payload_hash").HasMaxLength(64).IsRequired();
            entity.Property(row => row.SchemaVersion).HasColumnName("schema_version").HasDefaultValue(1);
            entity.Property(row => row.IdempotencyKey).HasColumnName("idempotency_key").HasMaxLength(100).IsRequired();
            entity.Property(row => row.OriginNodeId).HasColumnName("origin_node_id").HasMaxLength(80).IsRequired();
            entity.Property(row => row.Status).HasColumnName("status").HasMaxLength(20).IsRequired();
            entity.Property(row => row.Attempts).HasColumnName("attempts");
            entity.Property(row => row.NextRetryAt).HasColumnName("next_retry_at");
            entity.Property(row => row.LastError).HasColumnName("last_error").HasMaxLength(500);
            entity.Property(row => row.CreatedAt).HasColumnName("created_at");
            entity.Property(row => row.AckedAt).HasColumnName("acked_at");

            entity.HasIndex(row => new { row.Status, row.NextRetryAt, row.CreatedAt });
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.Status });
            entity.HasIndex(row => new { row.PartitionKey, row.CreatedAt });
        });

        modelBuilder.Entity<SyncInboundEventRow>(entity =>
        {
            entity.ToTable("inbound_events", table =>
                table.HasCheckConstraint("ck_sync_inbound_status", "status IN ('applied', 'blocked')"));
            entity.HasKey(row => row.EventId);
            entity.Property(row => row.EventId).HasColumnName("event_id");
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64).IsRequired();
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64).IsRequired();
            entity.Property(row => row.AggregateType).HasColumnName("aggregate_type").HasMaxLength(40).IsRequired();
            entity.Property(row => row.AggregateId).HasColumnName("aggregate_id").HasMaxLength(80).IsRequired();
            entity.Property(row => row.EventType).HasColumnName("event_type").HasMaxLength(64).IsRequired();
            entity.Property(row => row.PayloadJson).HasColumnName("payload_json").HasColumnType("jsonb").IsRequired();
            entity.Property(row => row.PayloadHash).HasColumnName("payload_hash").HasMaxLength(64).IsRequired();
            entity.Property(row => row.OriginNodeId).HasColumnName("origin_node_id").HasMaxLength(80).IsRequired();
            entity.Property(row => row.SchemaVersion).HasColumnName("schema_version").HasDefaultValue(1);
            entity.Property(row => row.Status).HasColumnName("status").HasMaxLength(20).IsRequired();
            entity.Property(row => row.ReceivedAt).HasColumnName("received_at");
            entity.Property(row => row.SourceCreatedAt).HasColumnName("source_created_at");

            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.ReceivedAt });
        });

        modelBuilder.Entity<BranchSyncStatusRow>(entity =>
        {
            entity.ToTable("branch_sync_status");
            entity.HasKey(row => new { row.FirmId, row.BranchId });
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.NodeMode).HasColumnName("node_mode").HasMaxLength(16).IsRequired();
            entity.Property(row => row.CloudUpstreamUrl).HasColumnName("cloud_upstream_url").HasMaxLength(255);
            entity.Property(row => row.CloudReachable).HasColumnName("cloud_reachable");
            entity.Property(row => row.LastCloudCheckAt).HasColumnName("last_cloud_check_at");
            entity.Property(row => row.LastAckAt).HasColumnName("last_ack_at");
            entity.Property(row => row.LastError).HasColumnName("last_error").HasMaxLength(500);
            entity.Property(row => row.UpdatedAt).HasColumnName("updated_at");
        });
    }
}

public sealed class SyncDbContextFactory : IDesignTimeDbContextFactory<SyncDbContext>
{
    public SyncDbContext CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("HIPOS_FEATURES_CONNECTION")
            ?? "Host=127.0.0.1;Database=hipos_features;Username=postgres";
        return new SyncDbContext(new DbContextOptionsBuilder<SyncDbContext>()
            .UseNpgsql(connection, npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "sync"))
            .Options);
    }
}
