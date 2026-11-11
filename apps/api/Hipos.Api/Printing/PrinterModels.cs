using System.Text;

namespace Hipos.Api.Printing;

public sealed record KitchenTicketItem(
    string ProductName,
    int Quantity,
    string? Note,
    IReadOnlyList<string>? Options
);

public sealed record CashierReceiptItem(
    string ProductName,
    int Quantity,
    long UnitPriceMinor,
    long LineTotalMinor,
    string Currency = "TRY"
);

public sealed class PrinterConfig
{
    public string DeliveryMode { get; set; } = "Auto"; // "Auto", "CloudBridge", "DirectLan"
    public string Mode => DeliveryMode;

    public PrinterTargetConfig CashierPrinter { get; set; } = new()
    {
        Name = "Kasa Yazıcısı",
        Type = "Usb",
        Enabled = true,
        IpAddress = "192.168.1.100",
        Port = 9100,
        FallbackToUsb = true
    };

    public PrinterTargetConfig KitchenPrinter { get; set; } = new()
    {
        Name = "Mutfak Yazıcısı",
        Type = "Network",
        Enabled = true,
        IpAddress = "192.168.1.116",
        Port = 9100,
        FallbackToUsb = false // Mutfak fişi varsayılanda kasadaki USB'ye düşmez
    };

    public PrinterTargetConfig BarPrinter { get; set; } = new()
    {
        Name = "Bar / İçecek Yazıcısı",
        Type = "Disabled",
        Enabled = false,
        IpAddress = "192.168.1.117",
        Port = 9100,
        FallbackToUsb = false
    };

    public bool AutoPrintKitchenOnOrder { get; set; } = true;
    public bool AutoSplitKitchenByStation { get; set; } = true;
    public int Version { get; set; } = 1;
    public DateTimeOffset? UpdatedAt { get; set; }
}

public sealed class PrinterTargetConfig
{
    public string Name { get; set; } = "Yazıcı";
    public string Type { get; set; } = "Network"; // "Network", "Usb", "Console", "Disabled"
    public bool Enabled { get; set; } = true;
    public string IpAddress { get; set; } = "192.168.1.116";
    public int Port { get; set; } = 9100;
    public string? SystemPrinterName { get; set; }
    public bool FallbackToUsb { get; set; } = false;
}

public sealed record UpdatePrinterConfigRequest(
    string? KitchenIp,
    int? KitchenPort,
    string? KitchenType,
    string? CashierIp,
    int? CashierPort,
    string? CashierType,
    bool? KitchenFallbackToUsb,
    bool? CashierFallbackToUsb,
    string? KitchenSystemPrinterName = null,
    bool? KitchenEnabled = null,
    string? CashierSystemPrinterName = null,
    bool? CashierEnabled = null,
    string? BarIp = null,
    int? BarPort = null,
    string? BarType = null,
    string? BarSystemPrinterName = null,
    bool? BarFallbackToUsb = null,
    bool? BarEnabled = null,
    string? Mode = null,
    string? DeliveryMode = null,
    bool? AutoPrintKitchenOnOrder = null,
    bool? AutoSplitKitchenByStation = null);

public sealed record SettleTableRequest(string? PaymentMethod = "NAKIT", Guid? RegisterId = null, bool PostToCash = true);

public sealed record PrintResult(bool Success, string Target, string TransportUsed, string? Error = null);
