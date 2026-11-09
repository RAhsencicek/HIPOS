using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Hipos.Api.Auth;

public sealed class AuthDbContext(DbContextOptions<AuthDbContext> options) : DbContext(options)
{
    public DbSet<UserRow> Users => Set<UserRow>();
    public DbSet<MembershipRow> Memberships => Set<MembershipRow>();
    public DbSet<PinCodeRow> PinCodes => Set<PinCodeRow>();
    public DbSet<SessionRow> Sessions => Set<SessionRow>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("auth");

        modelBuilder.Entity<UserRow>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.Email).HasColumnName("email").HasMaxLength(160).IsRequired();
            entity.Property(row => row.PasswordHash).HasColumnName("password_hash").HasMaxLength(255).IsRequired();
            entity.Property(row => row.FullName).HasColumnName("full_name").HasMaxLength(120).IsRequired();
            entity.Property(row => row.Phone).HasColumnName("phone").HasMaxLength(32);
            entity.Property(row => row.IsActive).HasColumnName("is_active").IsRequired();
            entity.Property(row => row.CreatedAt).HasColumnName("created_at").IsRequired();
            entity.Property(row => row.UpdatedAt).HasColumnName("updated_at").IsRequired();

            entity.HasIndex(row => row.Email).IsUnique();
        });

        modelBuilder.Entity<MembershipRow>(entity =>
        {
            entity.ToTable("memberships", table =>
                table.HasCheckConstraint("ck_membership_role", "role IN ('owner', 'cashier', 'waiter', 'chef')"));
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.UserId).HasColumnName("user_id").IsRequired();
            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64).IsRequired();
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64).IsRequired();
            entity.Property(row => row.Role).HasColumnName("role").HasMaxLength(32).IsRequired();
            entity.Property(row => row.IsActive).HasColumnName("is_active").IsRequired();
            entity.Property(row => row.CreatedAt).HasColumnName("created_at").IsRequired();

            entity.HasOne(row => row.User)
                .WithMany()
                .HasForeignKey(row => row.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(row => new { row.UserId, row.FirmId, row.BranchId }).IsUnique();
            entity.HasIndex(row => new { row.FirmId, row.BranchId, row.Role });
        });

        modelBuilder.Entity<PinCodeRow>(entity =>
        {
            entity.ToTable("pin_codes");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.MembershipId).HasColumnName("membership_id").IsRequired();
            entity.Property(row => row.PinHash).HasColumnName("pin_hash").HasMaxLength(255).IsRequired();
            entity.Property(row => row.PinPlain).HasColumnName("pin_plain").HasMaxLength(10);
            entity.Property(row => row.IsActive).HasColumnName("is_active").IsRequired();
            entity.Property(row => row.CreatedAt).HasColumnName("created_at").IsRequired();
            entity.Property(row => row.UpdatedAt).HasColumnName("updated_at").IsRequired();

            entity.HasOne(row => row.Membership)
                .WithOne(m => m.PinCode)
                .HasForeignKey<PinCodeRow>(row => row.MembershipId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(row => row.MembershipId).IsUnique();
        });

        modelBuilder.Entity<SessionRow>(entity =>
        {
            entity.ToTable("sessions");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.UserId).HasColumnName("user_id").IsRequired();
            entity.Property(row => row.MembershipId).HasColumnName("membership_id");
            entity.Property(row => row.TokenHash).HasColumnName("token_hash").HasMaxLength(255).IsRequired();
            entity.Property(row => row.ClientType).HasColumnName("client_type").HasMaxLength(32).IsRequired();
            entity.Property(row => row.ExpiresAt).HasColumnName("expires_at").IsRequired();
            entity.Property(row => row.CreatedAt).HasColumnName("created_at").IsRequired();

            entity.HasOne(row => row.User)
                .WithMany()
                .HasForeignKey(row => row.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(row => row.Membership)
                .WithMany()
                .HasForeignKey(row => row.MembershipId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasIndex(row => row.TokenHash).IsUnique();
            entity.HasIndex(row => row.ExpiresAt);
        });
    }
}

public sealed class AuthDbContextFactory : IDesignTimeDbContextFactory<AuthDbContext>
{
    public AuthDbContext CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("HIPOS_FEATURES_CONNECTION")
            ?? "Host=127.0.0.1;Database=hipos_features;Username=postgres";
        return new AuthDbContext(new DbContextOptionsBuilder<AuthDbContext>()
            .UseNpgsql(connection, npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "auth"))
            .Options);
    }
}
