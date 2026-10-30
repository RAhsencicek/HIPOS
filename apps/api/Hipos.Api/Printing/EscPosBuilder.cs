using System.Globalization;
using System.Text;

namespace Hipos.Api.Printing;

public static class EscPosBuilder
{
    private static readonly Encoding TurkishEncoding;

    static EscPosBuilder()
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        try
        {
            TurkishEncoding = Encoding.GetEncoding(857); // PC857 (Turkish DOS)
        }
        catch
        {
            try
            {
                TurkishEncoding = Encoding.GetEncoding(1254); // Windows-1254 fallback
            }
            catch
            {
                TurkishEncoding = Encoding.UTF8;
            }
        }
    }

    public static byte[] BuildKitchenTicket(
        string tableName,
        string waiterName,
        string orderNumber,
        DateTimeOffset orderTime,
        IReadOnlyList<KitchenTicketItem> items)
    {
        var ms = new MemoryStream();
        using var bw = new BinaryWriter(ms);

        // 1. Initialize
        bw.Write(new byte[] { 0x1B, 0x40 }); // ESC @

        // 2. Select Code Page 61 (PC857 Turkish)
        bw.Write(new byte[] { 0x1B, 0x74, 0x3D }); // ESC t 61

        // 3. Header
        SetAlignment(bw, 1); // Center
        SetDoubleSize(bw, true);
        WriteText(bw, "HIPOS MUTFAK\n");
        SetDoubleSize(bw, false);
        SetBold(bw, true);
        WriteText(bw, "SIPARIS BILETI\n");
        SetBold(bw, false);
        WriteText(bw, "================================================\n");

        // 4. Order Info
        SetAlignment(bw, 0); // Left
        WriteText(bw, $"Masa   : {tableName.ToUpperInvariant()}\n");
        WriteText(bw, $"Garson : {waiterName}\n");
        WriteText(bw, $"Saat   : {orderTime.ToLocalTime():HH:mm:ss}\n");
        WriteText(bw, $"Siparis: #{orderNumber}\n");
        WriteText(bw, "------------------------------------------------\n");

        // 5. Column Headers
        SetBold(bw, true);
        WriteText(bw, "ADET  URUN                                      \n");
        WriteText(bw, "------------------------------------------------\n");
        SetBold(bw, false);

        int totalQuantity = 0;
        foreach (var item in items)
        {
            totalQuantity += item.Quantity;
            SetDoubleSize(bw, true);
            WriteText(bw, $"{item.Quantity,2}x  {item.ProductName}\n");
            SetDoubleSize(bw, false);

            if (item.Options is { Count: > 0 })
            {
                foreach (var opt in item.Options)
                {
                    WriteText(bw, $"      * {opt}\n");
                }
            }

            if (!string.IsNullOrWhiteSpace(item.Note))
            {
                SetBold(bw, true);
                WriteText(bw, $"      [NOT: {item.Note}]\n");
                SetBold(bw, false);
            }
        }

        WriteText(bw, "================================================\n");
        SetAlignment(bw, 1); // Center
        SetBold(bw, true);
        WriteText(bw, $"TOPLAM: {totalQuantity} URUN\n");
        SetBold(bw, false);
        WriteText(bw, "================================================\n");

        // Feed lines
        WriteText(bw, "\n\n\n\n\n");

        // Cut paper (GS V B 0)
        bw.Write(new byte[] { 0x1D, 0x56, 0x42, 0x00 });

        // Beep 2 times (ESC B 2 2)
        bw.Write(new byte[] { 0x1B, 0x42, 0x02, 0x02 });

        return ms.ToArray();
    }

    public static byte[] BuildCashierReceipt(
        string firmTitle,
        string branchTitle,
        string tableName,
        string waiterName,
        string checkNumber,
        DateTimeOffset checkTime,
        IReadOnlyList<CashierReceiptItem> items,
        long grossTotalMinor,
        long discountMinor,
        long netTotalMinor,
        string paymentMethod = "NAKIT",
        bool openCashDrawer = false)
    {
        var ms = new MemoryStream();
        using var bw = new BinaryWriter(ms);

        // 1. Initialize
        bw.Write(new byte[] { 0x1B, 0x40 });

        // 2. Select Code Page 61 (PC857 Turkish)
        bw.Write(new byte[] { 0x1B, 0x74, 0x3D });

        // 3. Header
        SetAlignment(bw, 1); // Center
        SetDoubleSize(bw, true);
        WriteText(bw, $"{firmTitle}\n");
        SetDoubleSize(bw, false);
        WriteText(bw, $"{branchTitle}\n");
        WriteText(bw, "================================================\n");

        // 4. Details
        SetAlignment(bw, 0); // Left
        WriteText(bw, $"Tarih: {checkTime.ToLocalTime():dd.MM.yyyy}       Saat: {checkTime.ToLocalTime():HH:mm:ss}\n");
        WriteText(bw, $"Masa : {tableName,-18} Garson: {waiterName}\n");
        WriteText(bw, $"Adisyon No: #{checkNumber}\n");
        WriteText(bw, "------------------------------------------------\n");

        // 5. Line items
        // 48 columns total: ItemName(26) + " " + Qty(4) + " " + Total(16)
        SetBold(bw, true);
        WriteText(bw, "URUN                       ADET            TUTAR\n");
        WriteText(bw, "------------------------------------------------\n");
        SetBold(bw, false);

        foreach (var item in items)
        {
            var name = item.ProductName;
            if (name.Length > 25) name = name[..25];
            var moneyStr = FormatMoney(item.LineTotalMinor);
            WriteText(bw, $"{name,-26} {item.Quantity,3}x {moneyStr,16}\n");
        }

        WriteText(bw, "------------------------------------------------\n");

        // 6. Totals
        SetAlignment(bw, 2); // Right
        if (discountMinor > 0)
        {
            WriteText(bw, $"Ara Toplam : {FormatMoney(grossTotalMinor)}\n");
            WriteText(bw, $"Indirim    : -{FormatMoney(discountMinor)}\n");
            WriteText(bw, "--------------------------------\n");
        }

        // KDV calculation (approx 10%)
        long kdvIncluded = (long)Math.Round(netTotalMinor * (10.0 / 110.0));
        WriteText(bw, $"KDV (%10 Dahil): {FormatMoney(kdvIncluded)}\n");

        SetDoubleSize(bw, true);
        SetBold(bw, true);
        WriteText(bw, $"TOPLAM: {FormatMoney(netTotalMinor)}\n");
        SetDoubleSize(bw, false);
        SetBold(bw, false);

        WriteText(bw, "================================================\n");
        SetAlignment(bw, 1); // Center
        WriteText(bw, $"ODEME TURU: {paymentMethod.ToUpperInvariant()}\n");
        WriteText(bw, "------------------------------------------------\n");
        WriteText(bw, "AFIYET OLSUN\n");
        WriteText(bw, "MALI DEGERI YOKTUR - BILGI FISIDIR\n");
        WriteText(bw, "================================================\n");

        // Feed lines
        WriteText(bw, "\n\n\n\n\n");

        // Cut paper
        bw.Write(new byte[] { 0x1D, 0x56, 0x42, 0x00 });

        // Kick drawer if requested
        if (openCashDrawer)
        {
            bw.Write(new byte[] { 0x1B, 0x70, 0x00, 0x19, 0xFA });
        }

        return ms.ToArray();
    }

    private static void SetAlignment(BinaryWriter bw, byte align) // 0=left, 1=center, 2=right
    {
        bw.Write(new byte[] { 0x1B, 0x61, align });
    }

    private static void SetDoubleSize(BinaryWriter bw, bool enabled)
    {
        bw.Write(new byte[] { 0x1D, 0x21, (byte)(enabled ? 0x11 : 0x00) });
    }

    private static void SetBold(BinaryWriter bw, bool enabled)
    {
        bw.Write(new byte[] { 0x1B, 0x45, (byte)(enabled ? 0x01 : 0x00) });
    }

    private static void WriteText(BinaryWriter bw, string text)
    {
        var bytes = TurkishEncoding.GetBytes(text);
        bw.Write(bytes);
    }

    private static string FormatMoney(long minor)
    {
        var tl = minor / 100.0m;
        return string.Format(new CultureInfo("tr-TR"), "{0:N2} TL", tl);
    }
}
