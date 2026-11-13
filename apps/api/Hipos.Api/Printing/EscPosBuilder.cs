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
        IReadOnlyList<KitchenTicketItem> items,
        bool isReprint = false,
        string stationHeader = "HIPOS MUTFAK",
        string? branchTitle = null)
    {
        var ms = new MemoryStream();
        using var bw = new BinaryWriter(ms);

        // 1. Initialize
        bw.Write(new byte[] { 0x1B, 0x40 }); // ESC @

        // 2. Select Code Page 61 (PC857 Turkish)
        bw.Write(new byte[] { 0x1B, 0x74, 0x3D }); // ESC t 61

        // 3. Header
        SetAlignment(bw, 1); // Center
        if (isReprint)
        {
            SetDoubleSize(bw, true);
            SetBold(bw, true);
            WriteText(bw, "*** TEKRAR BASIM ***\n");
            SetDoubleSize(bw, false);
            WriteText(bw, "================================================\n");
        }
        SetDoubleSize(bw, true);
        WriteText(bw, $"{stationHeader}\n");
        SetDoubleSize(bw, false);
        if (!string.IsNullOrWhiteSpace(branchTitle))
        {
            WriteText(bw, $"{branchTitle}\n");
        }
        SetBold(bw, true);
        WriteText(bw, isReprint ? "SIPARIS BILETI (KOPYA)\n" : "SIPARIS BILETI\n");
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
        bool openCashDrawer = false,
        long paidMinor = 0,
        long remainingMinor = 0,
        bool isPartialOrAlman = false)
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
        WriteText(bw, isPartialOrAlman ? $"TAHSIL EDILEN: {FormatMoney(netTotalMinor)}\n" : $"TOPLAM: {FormatMoney(netTotalMinor)}\n");
        SetDoubleSize(bw, false);
        SetBold(bw, false);

        if (isPartialOrAlman)
        {
            WriteText(bw, "================================================\n");
            SetAlignment(bw, 1); // Center
            WriteText(bw, $"ODEME TURU: {paymentMethod.ToUpperInvariant()}\n");
            WriteText(bw, "** TAHSILAT BILGI FISIDIR **\n");
        }
        else if (paidMinor > 0 && remainingMinor > 0)
        {
            WriteText(bw, "------------------------------------------------\n");
            WriteText(bw, $"TAHSIL EDILEN : {FormatMoney(paidMinor)}\n");
            SetBold(bw, true);
            WriteText(bw, $"KALAN BAKIYE  : {FormatMoney(remainingMinor)}\n");
            SetBold(bw, false);
            WriteText(bw, "================================================\n");
            SetAlignment(bw, 1); // Center
            WriteText(bw, $"ODEME: {paymentMethod.ToUpperInvariant()} (ARA TAHSILAT)\n");
            WriteText(bw, "** KISMI ODEME ARA BILGI FISIDIR **\n");
        }
        else if (paidMinor == 0 && remainingMinor > 0)
        {
            WriteText(bw, "------------------------------------------------\n");
            SetBold(bw, true);
            WriteText(bw, $"ODENECEK TUTAR: {FormatMoney(remainingMinor)}\n");
            SetBold(bw, false);
            WriteText(bw, "================================================\n");
            SetAlignment(bw, 1); // Center
            WriteText(bw, "ODEME DURUMU: BEKLIYOR (HESAP ACIK)\n");
            WriteText(bw, "** ARA HESAP BILGI FISIDIR **\n");
        }
        else
        {
            if (paidMinor > 0)
            {
                WriteText(bw, $"ODENEN TUTAR : {FormatMoney(paidMinor)}\n");
                WriteText(bw, "KALAN BAKIYE : 0,00 TL\n");
            }
            WriteText(bw, "================================================\n");
            SetAlignment(bw, 1); // Center
            WriteText(bw, $"ODEME TURU: {paymentMethod.ToUpperInvariant()}\n");
            WriteText(bw, "** HESAP TAMAMEN KAPATILMISTIR **\n");
        }
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

    public static byte[] BuildCashDrawerKick()
    {
        return new byte[] { 0x1B, 0x40, 0x1B, 0x70, 0x00, 0x19, 0xFA };
    }

    public static byte[] BuildKitchenVoidTicket(
        string tableName,
        string actorName,
        string orderNumber,
        DateTimeOffset cancelledAt,
        IReadOnlyList<(string ProductName, int Quantity)> items,
        string reason,
        string stationHeader = "HIPOS MUTFAK",
        string? branchTitle = null)
    {
        var ms = new MemoryStream();
        using var bw = new BinaryWriter(ms);

        bw.Write(new byte[] { 0x1B, 0x40 }); // ESC @
        bw.Write(new byte[] { 0x1B, 0x74, 0x3D }); // PC857

        SetAlignment(bw, 1);
        SetDoubleSize(bw, true);
        SetBold(bw, true);
        WriteText(bw, "*** IPTAL BILETI ***\n");
        SetDoubleSize(bw, false);
        WriteText(bw, $"{stationHeader}\n");
        SetBold(bw, false);
        if (!string.IsNullOrWhiteSpace(branchTitle))
        {
            WriteText(bw, $"{branchTitle}\n");
        }
        WriteText(bw, "================================================\n");

        SetAlignment(bw, 0);
        WriteText(bw, $"Masa   : {tableName.ToUpperInvariant()}\n");
        WriteText(bw, $"Islem  : {actorName}\n");
        WriteText(bw, $"Saat   : {cancelledAt.ToLocalTime():HH:mm:ss}\n");
        WriteText(bw, $"Siparis: #{orderNumber}\n");
        WriteText(bw, "------------------------------------------------\n");

        foreach (var (productName, quantity) in items)
        {
            SetDoubleSize(bw, true);
            SetBold(bw, true);
            WriteText(bw, $"IPTAL -{quantity}x {productName}\n");
            SetDoubleSize(bw, false);
            SetBold(bw, false);
        }

        WriteText(bw, "------------------------------------------------\n");
        SetBold(bw, true);
        WriteText(bw, $"GEREKCE: {(string.IsNullOrWhiteSpace(reason) ? "Belirtilmedi" : reason)}\n");
        SetBold(bw, false);
        WriteText(bw, "================================================\n");

        WriteText(bw, "\n\n\n\n\n");
        bw.Write(new byte[] { 0x1D, 0x56, 0x42, 0x00 }); // Cut
        bw.Write(new byte[] { 0x1B, 0x42, 0x03, 0x02 }); // Urgent 3x beep

        return ms.ToArray();
    }

    public static byte[] BuildZReportReceipt(
        string firmTitle,
        string branchTitle,
        Cash.ZReportView report)
    {
        var ms = new MemoryStream();
        using var bw = new BinaryWriter(ms);

        bw.Write(new byte[] { 0x1B, 0x40 }); // ESC @
        bw.Write(new byte[] { 0x1B, 0x74, 0x3D }); // PC857

        SetAlignment(bw, 1);
        SetDoubleSize(bw, true);
        WriteText(bw, $"{firmTitle}\n");
        SetDoubleSize(bw, false);
        WriteText(bw, $"{branchTitle}\n");
        SetBold(bw, true);
        WriteText(bw, report.ReportType == "Z" ? "GUN SONU Z-RAPORU\n" : "GUN ICI X-RAPORU\n");
        SetBold(bw, false);
        WriteText(bw, "================================================\n");

        SetAlignment(bw, 0);
        WriteText(bw, $"Rapor No : {report.ReportNumber}\n");
        WriteText(bw, $"Kasa     : {report.RegisterName} ({report.RegisterCode})\n");
        WriteText(bw, $"Acilis   : {report.OpenedAt.ToLocalTime():dd.MM.yyyy HH:mm} ({report.OpenedBy})\n");
        if (report.ClosedAt is { } closedAt)
        {
            WriteText(bw, $"Kapanis  : {closedAt.ToLocalTime():dd.MM.yyyy HH:mm} ({report.ClosedBy ?? "-"})\n");
        }
        else
        {
            WriteText(bw, $"Rapor Ani: {report.GeneratedAt.ToLocalTime():dd.MM.yyyy HH:mm} (ACIK VARDIYA)\n");
        }
        WriteText(bw, "================================================\n");

        static string LineRow(string label, string value)
        {
            var safeLabel = label.Length > 28 ? label[..28] : label;
            return $"{safeLabel,-28}{value,20}\n";
        }

        SetBold(bw, true);
        WriteText(bw, "SATIS VE CIRO OZETI\n");
        SetBold(bw, false);
        WriteText(bw, LineRow("Tamamlanan Adisyon", $"{report.Sales.CheckCount} adet"));
        WriteText(bw, LineRow("Brut Satis", FormatMoney(report.Sales.GrossSalesMinor)));
        SetBold(bw, true);
        WriteText(bw, LineRow("NET CIRO", FormatMoney(report.Sales.NetSalesMinor)));
        SetBold(bw, false);
        WriteText(bw, "------------------------------------------------\n");

        SetBold(bw, true);
        WriteText(bw, "ODEME KANALLARI DAGILIMI\n");
        SetBold(bw, false);
        if (report.Tenders.Count == 0)
        {
            WriteText(bw, "Odeme hareketi bulunmuyor.\n");
        }
        else
        {
            foreach (var tender in report.Tenders)
            {
                WriteText(bw, LineRow($"{tender.Label} ({tender.TransactionCount}x)", FormatMoney(tender.AmountMinor)));
            }
        }
        if (report.Taxes.Count > 0)
        {
            WriteText(bw, "------------------------------------------------\n");
            foreach (var tax in report.Taxes)
            {
                WriteText(bw, LineRow($"KDV %{tax.TaxRatePercent} (Matrah {FormatMoney(tax.TaxBaseMinor)})", FormatMoney(tax.TaxAmountMinor)));
            }
        }
        WriteText(bw, "================================================\n");

        SetBold(bw, true);
        WriteText(bw, "KASA CEKMECESI MUTABAKATI\n");
        SetBold(bw, false);
        WriteText(bw, LineRow("Acilis Avansi", FormatMoney(report.CashDrawer.OpeningFloatMinor)));
        WriteText(bw, LineRow("Nakit Satislar (+)", FormatMoney(report.CashDrawer.CashSalesMinor)));
        if (report.CashDrawer.CashInMinor > 0)
            WriteText(bw, LineRow("Manuel Nakit Giris (+)", FormatMoney(report.CashDrawer.CashInMinor)));
        if (report.CashDrawer.CashOutMinor > 0)
            WriteText(bw, LineRow("Masraf / Tediye Cikis (-)", FormatMoney(report.CashDrawer.CashOutMinor)));
        SetBold(bw, true);
        WriteText(bw, LineRow("BEKLENEN NAKIT", FormatMoney(report.CashDrawer.ExpectedCashMinor)));
        SetBold(bw, false);
        if (report.CashDrawer.CountedCashMinor is { } counted)
        {
            WriteText(bw, LineRow("SAYILAN FIZIKI NAKIT", FormatMoney(counted)));
        }
        if (report.CashDrawer.DifferenceMinor is { } diff)
        {
            var diffLabel = diff == 0 ? "KASA FARKI (DENK)" : diff > 0 ? "KASA FAZLASI" : "KASA ACIGI";
            SetBold(bw, true);
            WriteText(bw, LineRow(diffLabel, FormatMoney(diff)));
            SetBold(bw, false);
        }
        if (report.CashDrawer.RetainedFloatMinor is { } retained)
        {
            WriteText(bw, LineRow("Yarina Devreden Avans", FormatMoney(retained)));
        }
        if (report.CashDrawer.DroppedRevenueMinor is { } dropped)
        {
            SetBold(bw, true);
            WriteText(bw, LineRow("Teslim Hasılati (Safe Drop)", FormatMoney(dropped)));
            SetBold(bw, false);
        }

        if (report.Denominations.Count > 0)
        {
            WriteText(bw, "------------------------------------------------\n");
            SetBold(bw, true);
            WriteText(bw, "KUPUR SAYIMI\n");
            SetBold(bw, false);
            foreach (var d in report.Denominations)
            {
                WriteText(bw, LineRow($"{FormatMoney(d.DenominationMinor)} x {d.Quantity}", FormatMoney(d.TotalMinor)));
            }
        }

        if (!string.IsNullOrWhiteSpace(report.CloseNote))
        {
            WriteText(bw, "------------------------------------------------\n");
            WriteText(bw, $"Not: {report.CloseNote}\n");
        }

        WriteText(bw, "================================================\n");
        SetAlignment(bw, 1);
        WriteText(bw, "MALI DEGERI YOKTUR - VARDIYA TUTANAGI\n");
        WriteText(bw, "================================================\n");
        WriteText(bw, "\n\n\n\n\n");
        bw.Write(new byte[] { 0x1D, 0x56, 0x42, 0x00 }); // Cut

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
