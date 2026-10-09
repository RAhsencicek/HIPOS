using Microsoft.EntityFrameworkCore;

namespace Hipos.Api.Catalog;

public sealed class CatalogMenuRow
{
    public Guid Id { get; set; }
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public bool IsActive { get; set; }
    public int Version { get; set; } = 1;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class CatalogMenuSectionRow
{
    public Guid MenuId { get; set; }
    public string SectionId { get; set; } = "";
    public string Name { get; set; } = "";
    public int SortOrder { get; set; }
}

public sealed class CatalogMenuItemRow
{
    public Guid MenuId { get; set; }
    public string SectionId { get; set; } = "";
    public Guid ProductId { get; set; }
    public int SortOrder { get; set; }
}

public sealed class CatalogMenuAuditRow
{
    public Guid RequestId { get; set; }
    public Guid MenuId { get; set; }
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string Actor { get; set; } = "";
    public string Action { get; set; } = "";
    public string Fingerprint { get; set; } = "";
    public string SnapshotJson { get; set; } = "";
    public int Version { get; set; }
    public DateTimeOffset OccurredAt { get; set; }
}

public static class CatalogMenuModel
{
    public static void Configure(ModelBuilder model)
    {
        var menu = model.Entity<CatalogMenuRow>();
        menu.ToTable("menus", t => t.HasCheckConstraint("ck_menu_version", "version > 0"));
        menu.HasKey(x => x.Id);
        menu.Property(x => x.FirmId).HasMaxLength(64);
        menu.Property(x => x.BranchId).HasMaxLength(64);
        menu.Property(x => x.Name).HasMaxLength(160);
        menu.Property(x => x.Description).HasMaxLength(1000);
        menu.Property(x => x.Version).IsConcurrencyToken();
        menu.HasIndex(x => new { x.FirmId, x.BranchId }).IsUnique().HasFilter("is_active");

        var section = model.Entity<CatalogMenuSectionRow>();
        section.ToTable("menu_sections");
        section.HasKey(x => new { x.MenuId, x.SectionId });
        section.Property(x => x.SectionId).HasMaxLength(120);
        section.Property(x => x.Name).HasMaxLength(120);
        section.HasOne<CatalogMenuRow>().WithMany().HasForeignKey(x => x.MenuId).OnDelete(DeleteBehavior.Cascade);

        var item = model.Entity<CatalogMenuItemRow>();
        item.ToTable("menu_items");
        item.HasKey(x => new { x.MenuId, x.ProductId });
        item.Property(x => x.SectionId).HasMaxLength(120);
        item.HasOne<CatalogMenuSectionRow>().WithMany().HasForeignKey(x => new { x.MenuId, x.SectionId }).OnDelete(DeleteBehavior.Cascade);
        item.HasOne<CatalogProductRow>().WithMany().HasForeignKey(x => x.ProductId).OnDelete(DeleteBehavior.Restrict);

        var audit = model.Entity<CatalogMenuAuditRow>();
        audit.ToTable("menu_audit");
        audit.HasKey(x => x.RequestId);
        audit.Property(x => x.FirmId).HasMaxLength(64);
        audit.Property(x => x.BranchId).HasMaxLength(64);
        audit.Property(x => x.Actor).HasMaxLength(128);
        audit.Property(x => x.Action).HasMaxLength(32);
        audit.Property(x => x.Fingerprint).HasMaxLength(64);
        audit.Property(x => x.SnapshotJson).HasColumnType("jsonb");
        audit.HasIndex(x => new { x.FirmId, x.BranchId, x.MenuId, x.OccurredAt });
        foreach (var type in new[] { typeof(CatalogMenuRow), typeof(CatalogMenuSectionRow), typeof(CatalogMenuItemRow), typeof(CatalogMenuAuditRow) })
        foreach (var property in model.Entity(type).Metadata.GetProperties())
            property.SetColumnName(System.Text.RegularExpressions.Regex.Replace(property.Name, "(?<!^)([A-Z])", "_$1").ToLowerInvariant());
    }
}
