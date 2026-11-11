using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Hipos.Api.Printing;

public sealed class PrinterProfileRow
{
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string DeliveryMode { get; set; } = "Auto";
    public bool AutoPrintKitchenOnOrder { get; set; } = true;
    public bool AutoSplitKitchenByStation { get; set; } = true;

    public string CashierName { get; set; } = "Kasa Yazıcısı";
    public string CashierType { get; set; } = "Usb";
    public bool CashierEnabled { get; set; } = true;
    public string CashierIp { get; set; } = "192.168.1.100";
    public int CashierPort { get; set; } = 9100;
    public string? CashierSystemPrinterName { get; set; }
    public bool CashierFallbackToUsb { get; set; } = true;

    public string KitchenName { get; set; } = "Mutfak Yazıcısı";
    public string KitchenType { get; set; } = "Network";
    public bool KitchenEnabled { get; set; } = true;
    public string KitchenIp { get; set; } = "192.168.1.116";
    public int KitchenPort { get; set; } = 9100;
    public string? KitchenSystemPrinterName { get; set; }
    public bool KitchenFallbackToUsb { get; set; }

    public string BarName { get; set; } = "Bar / İçecek Yazıcısı";
    public string BarType { get; set; } = "Disabled";
    public bool BarEnabled { get; set; }
    public string BarIp { get; set; } = "192.168.1.117";
    public int BarPort { get; set; } = 9100;
    public string? BarSystemPrinterName { get; set; }
    public bool BarFallbackToUsb { get; set; }

    public int Version { get; set; } = 1;
    public string UpdatedBy { get; set; } = "system";
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;

    public static PrinterProfileRow CreateDefault(
        string firmId,
        string branchId,
        PrinterConfig? seed = null,
        string actor = "system") => new()
    {
        FirmId = firmId,
        BranchId = branchId,
        DeliveryMode = seed?.DeliveryMode ?? "Auto",
        AutoPrintKitchenOnOrder = seed?.AutoPrintKitchenOnOrder ?? true,
        AutoSplitKitchenByStation = seed?.AutoSplitKitchenByStation ?? true,

        CashierName = seed?.CashierPrinter.Name ?? "Kasa Yazıcısı",
        CashierType = seed?.CashierPrinter.Type ?? "Usb",
        CashierEnabled = seed?.CashierPrinter.Enabled ?? true,
        CashierIp = seed?.CashierPrinter.IpAddress ?? "192.168.1.100",
        CashierPort = seed?.CashierPrinter.Port > 0 ? seed.CashierPrinter.Port : 9100,
        CashierSystemPrinterName = seed?.CashierPrinter.SystemPrinterName,
        CashierFallbackToUsb = seed?.CashierPrinter.FallbackToUsb ?? true,

        KitchenName = seed?.KitchenPrinter.Name ?? "Mutfak Yazıcısı",
        KitchenType = seed?.KitchenPrinter.Type ?? "Network",
        KitchenEnabled = seed?.KitchenPrinter.Enabled ?? true,
        KitchenIp = seed?.KitchenPrinter.IpAddress ?? "192.168.1.116",
        KitchenPort = seed?.KitchenPrinter.Port > 0 ? seed.KitchenPrinter.Port : 9100,
        KitchenSystemPrinterName = seed?.KitchenPrinter.SystemPrinterName,
        KitchenFallbackToUsb = seed?.KitchenPrinter.FallbackToUsb ?? false,

        BarName = seed?.BarPrinter.Name ?? "Bar / İçecek Yazıcısı",
        BarType = seed?.BarPrinter.Type ?? "Disabled",
        BarEnabled = seed?.BarPrinter.Enabled ?? false,
        BarIp = seed?.BarPrinter.IpAddress ?? "192.168.1.117",
        BarPort = seed?.BarPrinter.Port > 0 ? seed.BarPrinter.Port : 9100,
        BarSystemPrinterName = seed?.BarPrinter.SystemPrinterName,
        BarFallbackToUsb = seed?.BarPrinter.FallbackToUsb ?? false,

        Version = 1,
        UpdatedBy = actor,
        UpdatedAt = DateTimeOffset.UtcNow
    };

    public PrinterConfig ToPrinterConfig() => new()
    {
        DeliveryMode = DeliveryMode,
        AutoPrintKitchenOnOrder = AutoPrintKitchenOnOrder,
        AutoSplitKitchenByStation = AutoSplitKitchenByStation,
        Version = Version,
        UpdatedAt = UpdatedAt,
        CashierPrinter = new PrinterTargetConfig
        {
            Name = CashierName,
            Type = CashierType,
            Enabled = CashierEnabled,
            IpAddress = CashierIp,
            Port = CashierPort > 0 ? CashierPort : 9100,
            SystemPrinterName = CashierSystemPrinterName,
            FallbackToUsb = CashierFallbackToUsb
        },
        KitchenPrinter = new PrinterTargetConfig
        {
            Name = KitchenName,
            Type = KitchenType,
            Enabled = KitchenEnabled,
            IpAddress = KitchenIp,
            Port = KitchenPort > 0 ? KitchenPort : 9100,
            SystemPrinterName = KitchenSystemPrinterName,
            FallbackToUsb = KitchenFallbackToUsb
        },
        BarPrinter = new PrinterTargetConfig
        {
            Name = BarName,
            Type = BarType,
            Enabled = BarEnabled,
            IpAddress = BarIp,
            Port = BarPort > 0 ? BarPort : 9100,
            SystemPrinterName = BarSystemPrinterName,
            FallbackToUsb = BarFallbackToUsb
        }
    };
}

public sealed class PrintingDbContext(DbContextOptions<PrintingDbContext> options) : DbContext(options)
{
    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
    {
        base.OnConfiguring(optionsBuilder);
        optionsBuilder.ConfigureWarnings(w => w.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.RelationalEventId.PendingModelChangesWarning));
    }

    public DbSet<PrinterProfileRow> PrinterProfiles => Set<PrinterProfileRow>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("printing");

        modelBuilder.Entity<PrinterProfileRow>(entity =>
        {
            entity.ToTable("printer_profiles", table =>
            {
                table.HasCheckConstraint("ck_printer_profile_version_positive", "version > 0");
            });

            entity.HasKey(row => new { row.FirmId, row.BranchId });

            entity.Property(row => row.FirmId).HasColumnName("firm_id").HasMaxLength(64);
            entity.Property(row => row.BranchId).HasColumnName("branch_id").HasMaxLength(64);
            entity.Property(row => row.DeliveryMode).HasColumnName("delivery_mode").HasMaxLength(32).HasDefaultValue("Auto");
            entity.Property(row => row.AutoPrintKitchenOnOrder).HasColumnName("auto_print_kitchen_on_order").HasDefaultValue(true);
            entity.Property(row => row.AutoSplitKitchenByStation).HasColumnName("auto_split_kitchen_by_station").HasDefaultValue(true);

            entity.Property(row => row.CashierName).HasColumnName("cashier_name").HasMaxLength(80);
            entity.Property(row => row.CashierType).HasColumnName("cashier_type").HasMaxLength(24);
            entity.Property(row => row.CashierEnabled).HasColumnName("cashier_enabled").HasDefaultValue(true);
            entity.Property(row => row.CashierIp).HasColumnName("cashier_ip").HasMaxLength(120);
            entity.Property(row => row.CashierPort).HasColumnName("cashier_port").HasDefaultValue(9100);
            entity.Property(row => row.CashierSystemPrinterName).HasColumnName("cashier_system_printer_name").HasMaxLength(160);
            entity.Property(row => row.CashierFallbackToUsb).HasColumnName("cashier_fallback_to_usb").HasDefaultValue(true);

            entity.Property(row => row.KitchenName).HasColumnName("kitchen_name").HasMaxLength(80);
            entity.Property(row => row.KitchenType).HasColumnName("kitchen_type").HasMaxLength(24);
            entity.Property(row => row.KitchenEnabled).HasColumnName("kitchen_enabled").HasDefaultValue(true);
            entity.Property(row => row.KitchenIp).HasColumnName("kitchen_ip").HasMaxLength(120);
            entity.Property(row => row.KitchenPort).HasColumnName("kitchen_port").HasDefaultValue(9100);
            entity.Property(row => row.KitchenSystemPrinterName).HasColumnName("kitchen_system_printer_name").HasMaxLength(160);
            entity.Property(row => row.KitchenFallbackToUsb).HasColumnName("kitchen_fallback_to_usb").HasDefaultValue(false);

            entity.Property(row => row.BarName).HasColumnName("bar_name").HasMaxLength(80);
            entity.Property(row => row.BarType).HasColumnName("bar_type").HasMaxLength(24);
            entity.Property(row => row.BarEnabled).HasColumnName("bar_enabled").HasDefaultValue(false);
            entity.Property(row => row.BarIp).HasColumnName("bar_ip").HasMaxLength(120);
            entity.Property(row => row.BarPort).HasColumnName("bar_port").HasDefaultValue(9100);
            entity.Property(row => row.BarSystemPrinterName).HasColumnName("bar_system_printer_name").HasMaxLength(160);
            entity.Property(row => row.BarFallbackToUsb).HasColumnName("bar_fallback_to_usb").HasDefaultValue(false);

            entity.Property(row => row.Version).HasColumnName("version").IsConcurrencyToken();
            entity.Property(row => row.UpdatedBy).HasColumnName("updated_by").HasMaxLength(120);
            entity.Property(row => row.UpdatedAt).HasColumnName("updated_at");
        });
    }
}

public sealed class PrintingDbContextFactory : IDesignTimeDbContextFactory<PrintingDbContext>
{
    public PrintingDbContext CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("HIPOS_FEATURES_CONNECTION")
            ?? "Host=127.0.0.1;Port=5433;Database=hipos_features;Username=hipos;Password=hipos-dev-only";
        var options = new DbContextOptionsBuilder<PrintingDbContext>()
            .UseNpgsql(connection, npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "printing"))
            .Options;
        return new PrintingDbContext(options);
    }
}
