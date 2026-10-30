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
        Name = "Kasa Yazıcısı",
        Type = "Network",
        IpAddress = "192.168.1.200",
        Port = 9100,
        FallbackToUsb = true
    };

    public PrinterTargetConfig KitchenPrinter { get; set; } = new()
    {
        Name = "Mutfak Yazıcısı",
        Type = "Network",
        IpAddress = "192.168.1.201",
        Port = 9100,
        FallbackToUsb = true
    };

    public bool AutoPrintKitchenOnOrder { get; set; } = true;
}

public sealed class PrinterTargetConfig
{
    public string Name { get; set; } = "Yazıcı";
    public string Type { get; set; } = "Network"; // "Network", "Usb", "Console"
    public string IpAddress { get; set; } = "192.168.1.200";
    public int Port { get; set; } = 9100;
    public bool FallbackToUsb { get; set; } = true;
}

public sealed record UpdatePrinterConfigRequest(string? KitchenIp, int? KitchenPort, string? CashierIp, int? CashierPort);

public sealed record SettleTableRequest(string? PaymentMethod = "NAKIT");

public sealed record PrintResult(bool Success, string Target, string TransportUsed, string? Error = null);
