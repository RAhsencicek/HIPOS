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
    public PrinterTargetConfig CashierPrinter { get; set; } = new()
    {
        Name = "Kasa Yazıcısı (Mac USB)",
        Type = "Usb",
        IpAddress = "127.0.0.1",
        Port = 9100,
        FallbackToUsb = true
    };

    public PrinterTargetConfig KitchenPrinter { get; set; } = new()
    {
        Name = "Mutfak Yazıcısı (Windows PC)",
        Type = "Network",
        IpAddress = "192.168.1.116",
        Port = 9100,
        FallbackToUsb = false // Mutfak fişi ASLA kasadaki Mac USB'sine düşmemeli
    };

    public bool AutoPrintKitchenOnOrder { get; set; } = true;
}

public sealed class PrinterTargetConfig
{
    public string Name { get; set; } = "Yazıcı";
    public string Type { get; set; } = "Network"; // "Network", "Usb", "Console", "Disabled"
    public string IpAddress { get; set; } = "192.168.1.116";
    public int Port { get; set; } = 9100;
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
    bool? CashierFallbackToUsb);

public sealed record SettleTableRequest(string? PaymentMethod = "NAKIT");

public sealed record PrintResult(bool Success, string Target, string TransportUsed, string? Error = null);
