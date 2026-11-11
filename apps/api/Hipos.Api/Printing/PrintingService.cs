using System.Diagnostics;
using System.Net.Sockets;
using System.Text.Json;
using Hipos.Api.Auth;
using Hipos.Api.Cash;
using Hipos.Api.Catalog;
using Hipos.Api.Features;
using Hipos.Api.Kitchen;
using Hipos.Api.Realtime;
using Hipos.Api.Sales;
using Hipos.Api.Service;
using Microsoft.EntityFrameworkCore;

namespace Hipos.Api.Printing;

public sealed class PrintingService(
    SalesDbContext salesDb,
    ServiceDbContext serviceDb,
    PrinterTransport transport,
    PrinterConfig fallbackConfig,
    ILogger<PrintingService> logger,
    BridgePresenceRegistry bridgeRegistry,
    IRestaurantEventHub? eventHub = null,
    PrintingDbContext? printingDb = null,
    KitchenDbContext? kitchenDb = null,
    CatalogDbContext? catalogDb = null,
    AuthDbContext? authDb = null,
    FeatureRuntimeCapabilities? runtime = null,
    CashDbContext? cashDb = null)
{
    private readonly PrinterConfig _config = fallbackConfig;
    private static readonly string SettingsFilePath = Path.Combine(AppContext.BaseDirectory, "printer_settings.json");
    private static readonly object FileLock = new();

    private void EnsureLegacyFileLoaded()
    {
        lock (FileLock)
        {
            if (File.Exists(SettingsFilePath))
            {
                try
                {
                    var json = File.ReadAllText(SettingsFilePath);
                    var loaded = JsonSerializer.Deserialize<PrinterConfig>(json);
                    if (loaded is not null)
                    {
                        if (loaded.KitchenPrinter is not null) _config.KitchenPrinter = loaded.KitchenPrinter;
                        if (loaded.CashierPrinter is not null) _config.CashierPrinter = loaded.CashierPrinter;
                        if (loaded.BarPrinter is not null) _config.BarPrinter = loaded.BarPrinter;
                        if (!string.IsNullOrWhiteSpace(loaded.DeliveryMode))
                            _config.DeliveryMode = NormalizeDeliveryMode(loaded.DeliveryMode);
                        _config.AutoPrintKitchenOnOrder = loaded.AutoPrintKitchenOnOrder;
                        _config.AutoSplitKitchenByStation = loaded.AutoSplitKitchenByStation;
                    }
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Yazıcı ayarları dosyası okunamadı: {Path}", SettingsFilePath);
                }
            }
        }
    }

    public PrinterConfig GetConfig()
    {
        EnsureLegacyFileLoaded();
        return _config;
    }

    public async Task<PrinterConfig> GetConfigAsync(string firmId, string branchId, CancellationToken ct = default)
    {
        EnsureLegacyFileLoaded();

        if (printingDb is null || !(runtime?.PrintingReady ?? false))
        {
            return _config;
        }

        var existing = await printingDb.PrinterProfiles
            .AsNoTracking()
            .FirstOrDefaultAsync(row => row.FirmId == firmId && row.BranchId == branchId, ct);

        if (existing is not null)
        {
            return existing.ToPrinterConfig();
        }

        var seed = string.Equals(firmId, "11111111-1111-4111-8111-111111111111", StringComparison.Ordinal)
            && string.Equals(branchId, "33333333-3333-4333-8333-333333333333", StringComparison.Ordinal)
            ? _config
            : null;

        var row = PrinterProfileRow.CreateDefault(firmId, branchId, seed, "system:lazy-init");
        printingDb.PrinterProfiles.Add(row);
        try
        {
            await printingDb.SaveChangesAsync(ct);
            return row.ToPrinterConfig();
        }
        catch (DbUpdateException)
        {
            printingDb.ChangeTracker.Clear();
            var reloaded = await printingDb.PrinterProfiles
                .AsNoTracking()
                .FirstOrDefaultAsync(r => r.FirmId == firmId && r.BranchId == branchId, ct);
            return reloaded?.ToPrinterConfig() ?? row.ToPrinterConfig();
        }
    }

    public async Task<PrinterConfig> UpdateConfigAsync(
        string firmId,
        string branchId,
        UpdatePrinterConfigRequest request,
        string actor = "operator",
        CancellationToken ct = default)
    {
        EnsureLegacyFileLoaded();

        if (printingDb is null || !(runtime?.PrintingReady ?? false))
        {
            ApplyRequestToInMemoryConfig(_config, request);
            SaveLegacyFile();
            return _config;
        }

        var row = await printingDb.PrinterProfiles
            .FirstOrDefaultAsync(r => r.FirmId == firmId && r.BranchId == branchId, ct);

        if (row is null)
        {
            var seed = string.Equals(firmId, "11111111-1111-4111-8111-111111111111", StringComparison.Ordinal)
                && string.Equals(branchId, "33333333-3333-4333-8333-333333333333", StringComparison.Ordinal)
                ? _config
                : null;
            row = PrinterProfileRow.CreateDefault(firmId, branchId, seed, actor);
            printingDb.PrinterProfiles.Add(row);
        }
        else
        {
            row.Version++;
        }

        ApplyRequestToRow(row, request, actor);
        await printingDb.SaveChangesAsync(ct);

        if (string.Equals(firmId, "11111111-1111-4111-8111-111111111111", StringComparison.Ordinal)
            && string.Equals(branchId, "33333333-3333-4333-8333-333333333333", StringComparison.Ordinal))
        {
            ApplyRequestToInMemoryConfig(_config, request);
            SaveLegacyFile();
        }

        return row.ToPrinterConfig();
    }

    public void UpdateConfig(UpdatePrinterConfigRequest request)
    {
        EnsureLegacyFileLoaded();
        ApplyRequestToInMemoryConfig(_config, request);
        SaveLegacyFile();
    }

    private void SaveLegacyFile()
    {
        lock (FileLock)
        {
            try
            {
                var json = JsonSerializer.Serialize(_config, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(SettingsFilePath, json);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Yazıcı ayarları kaydedilemedi: {Path}", SettingsFilePath);
            }
        }
    }

    public async Task<PrintResult> PrintKitchenOrderAsync(
        string firmId,
        string branchId,
        Guid orderId,
        bool isReprint = false,
        CancellationToken ct = default)
    {
        var cfg = await GetConfigAsync(firmId, branchId, ct);

        var order = await salesDb.Orders
            .AsNoTracking()
            .Include(row => row.Lines)
            .FirstOrDefaultAsync(row => row.Id == orderId && row.FirmId == firmId && row.BranchId == branchId, ct);

        if (order is null)
        {
            logger.LogWarning("Mutfak fişi için sipariş bulunamadı: {OrderId}", orderId);
            return new PrintResult(false, cfg.KitchenPrinter.Name, "None", "Sipariş bulunamadı.");
        }

        var (tableName, waiterName) = await ResolveOrderTableAndWaiterAsync(firmId, branchId, order.CheckId, ct);
        return await DispatchKitchenTicketsAsync(
            firmId: firmId,
            branchId: branchId,
            cfg: cfg,
            lines: order.Lines,
            tableName: tableName,
            waiterName: waiterName,
            orderNumber: order.Id.ToString()[..8].ToUpperInvariant(),
            orderTime: order.CreatedAt,
            isReprint: isReprint,
            extraMeta: new { orderId = order.Id },
            ct: ct);
    }

    public async Task<PrintResult> PrintKitchenTableAsync(
        string firmId,
        string branchId,
        string tableId,
        bool isReprint = false,
        CancellationToken ct = default)
    {
        var cfg = await GetConfigAsync(firmId, branchId, ct);

        var check = await salesDb.Checks
            .AsNoTracking()
            .FirstOrDefaultAsync(row => row.FirmId == firmId && row.BranchId == branchId &&
                row.TableId == tableId && row.Status == "open", ct);

        if (check is null)
        {
            var assignment = await serviceDb.Assignments
                .AsNoTracking()
                .FirstOrDefaultAsync(row => row.FirmId == firmId && row.BranchId == branchId &&
                    row.TableId == tableId && row.ClosedAt == null, ct);

            if (assignment?.CheckId is not null)
            {
                check = await salesDb.Checks
                    .AsNoTracking()
                    .FirstOrDefaultAsync(row => row.Id == assignment.CheckId, ct);
            }
        }

        if (check is null)
        {
            logger.LogWarning("Mutfak fişi için masada açık adisyon bulunamadı: Table={TableId}", tableId);
            return new PrintResult(false, cfg.KitchenPrinter.Name, "None", "Bu masada açık bir sipariş/adisyon bulunamadı.");
        }

        return await PrintKitchenCheckAsync(firmId, branchId, check.Id, isReprint, ct);
    }

    public async Task<PrintResult> PrintKitchenCheckAsync(
        string firmId,
        string branchId,
        Guid checkId,
        bool isReprint = false,
        CancellationToken ct = default)
    {
        var cfg = await GetConfigAsync(firmId, branchId, ct);

        var check = await salesDb.Checks
            .AsNoTracking()
            .FirstOrDefaultAsync(row => row.Id == checkId && row.FirmId == firmId && row.BranchId == branchId, ct);

        if (check is null)
        {
            logger.LogWarning("Mutfak fişi için adisyon bulunamadı: Check={CheckId}", checkId);
            return new PrintResult(false, cfg.KitchenPrinter.Name, "None", "Adisyon bulunamadı.");
        }

        var orders = await salesDb.Orders
            .AsNoTracking()
            .Include(row => row.Lines)
            .Where(row => row.CheckId == check.Id && row.FirmId == firmId && row.BranchId == branchId && row.Status != "cancelled")
            .OrderBy(row => row.CreatedAt)
            .ToListAsync(ct);

        var allLines = orders.SelectMany(o => o.Lines).ToList();
        if (allLines.Count == 0)
        {
            return new PrintResult(false, cfg.KitchenPrinter.Name, "None", "Yazdırılacak sipariş kalemi bulunamadı.");
        }

        var (tableName, waiterName) = await ResolveCheckTableAndWaiterAsync(firmId, branchId, check, ct);
        return await DispatchKitchenTicketsAsync(
            firmId: firmId,
            branchId: branchId,
            cfg: cfg,
            lines: allLines,
            tableName: tableName,
            waiterName: waiterName,
            orderNumber: check.Id.ToString()[..8].ToUpperInvariant(),
            orderTime: orders.Last().CreatedAt,
            isReprint: isReprint,
            extraMeta: new { checkId = check.Id },
            ct: ct);
    }

    public async Task<PrintResult> PrintCashierBillAsync(
        string firmId,
        string branchId,
        Guid checkId,
        CancellationToken ct = default,
        bool openCashDrawer = false,
        string paymentMethod = "NAKIT")
    {
        var cfg = await GetConfigAsync(firmId, branchId, ct);

        var check = await salesDb.Checks
            .AsNoTracking()
            .FirstOrDefaultAsync(row => row.Id == checkId && row.FirmId == firmId && row.BranchId == branchId, ct);

        if (check is null)
        {
            logger.LogWarning("Hesap fişi için adisyon bulunamadı: {CheckId}", checkId);
            return new PrintResult(false, cfg.CashierPrinter.Name, "None", "Adisyon bulunamadı.");
        }

        var orders = await salesDb.Orders
            .AsNoTracking()
            .Include(row => row.Lines)
            .Include(row => row.PaymentAttempts)
            .Where(row => row.CheckId == checkId && row.FirmId == firmId && row.BranchId == branchId && row.Status != "cancelled")
            .ToListAsync(ct);

        var lines = orders.SelectMany(o => o.Lines).ToList();
        var (tableName, waiterName) = await ResolveCheckTableAndWaiterAsync(firmId, branchId, check, ct, fallbackWaiter: "Kasiyer", quickTableLabel: "Paket / Gel-Al");

        var adjustments = await salesDb.CheckAdjustments
            .AsNoTracking()
            .Where(row => row.CheckId == checkId && row.FirmId == firmId && row.BranchId == branchId)
            .ToListAsync(ct);

        var voidQtyByLineId = adjustments
            .Where(a => a.Action == "void" && a.OrderLineId != null)
            .GroupBy(a => a.OrderLineId!.Value)
            .ToDictionary(g => g.Key, g => g.Sum(x => x.Quantity));

        var activeLines = new List<(string ProductName, int Quantity, long UnitPriceMinor, long LineTotalMinor)>();
        foreach (var l in lines)
        {
            var voided = voidQtyByLineId.GetValueOrDefault(l.Id, 0);
            var remainingQty = Math.Max(0, l.Quantity - voided);
            if (remainingQty <= 0) continue;
            var ratioTotal = remainingQty == l.Quantity ? l.LineTotalMinor : checked(remainingQty * l.UnitPriceMinor);
            activeLines.Add((l.ProductName, remainingQty, l.UnitPriceMinor, ratioTotal));
        }

        var consolidated = activeLines
            .GroupBy(l => l.ProductName)
            .Select(g => new CashierReceiptItem(
                ProductName: g.Key,
                Quantity: g.Sum(x => x.Quantity),
                UnitPriceMinor: g.First().UnitPriceMinor,
                LineTotalMinor: g.Sum(x => x.LineTotalMinor)))
            .ToList();

        long activeGrossTotal = consolidated.Sum(x => x.LineTotalMinor);
        long discountMinor = adjustments.Where(a => a.Action is "discount" or "comp").Sum(a => a.AmountMinor);
        long grossFromOrders = orders.Sum(o => o.TotalMinor);
        long totalAdjustmentMinor = adjustments.Sum(a => a.AmountMinor);
        long netTotal = Math.Max(0, grossFromOrders - totalAdjustmentMinor);
        long grossTotal = Math.Max(activeGrossTotal, netTotal + discountMinor);

        var successfulPayments = orders.SelectMany(o => o.PaymentAttempts).Where(p => p.Status == "succeeded").ToList();
        long paidMinor = successfulPayments.Sum(p => p.AmountMinor);
        long remainingMinor = Math.Max(0, netTotal - paidMinor);

        if (successfulPayments.Count > 1)
        {
            var parts = successfulPayments.Select(p =>
            {
                var label = !string.IsNullOrWhiteSpace(p.Provider)
                    ? p.Provider
                    : p.Method switch
                    {
                        "cash" => "Nakit",
                        "card" => "Kredi Kartı",
                        "meal" => "Yemek Kartı",
                        "transfer" => "Havale",
                        "cari" => "Cari",
                        _ => p.Method
                    };
                return $"{label}: {p.AmountMinor / 100.0:F2} TL";
            });
            paymentMethod = string.Join(" | ", parts);
        }
        else if (successfulPayments.Count == 1 && string.IsNullOrWhiteSpace(paymentMethod))
        {
            var p = successfulPayments[0];
            paymentMethod = !string.IsNullOrWhiteSpace(p.Provider)
                ? p.Provider
                : p.Method switch
                {
                    "cash" => "NAKİT",
                    "card" => "KREDİ KARTI",
                    "meal" => "YEMEK KARTI",
                    "transfer" => "HAVALE / EFT",
                    "cari" => "CARİ / VERESİYE",
                    _ => p.Method.ToUpperInvariant()
                };
        }

        var (firmTitle, branchTitle) = await ResolveFirmAndBranchTitlesAsync(firmId, branchId, ct);
        var receiptKindLabel = check.TableId is null ? $"{branchTitle} · GEL-AL HESAP FISI" : $"{branchTitle} · SALON HESAP FISI";

        var receiptBytes = EscPosBuilder.BuildCashierReceipt(
            firmTitle: firmTitle,
            branchTitle: receiptKindLabel,
            tableName: tableName,
            waiterName: waiterName,
            checkNumber: check.Id.ToString()[..8].ToUpperInvariant(),
            checkTime: DateTimeOffset.UtcNow,
            items: consolidated,
            grossTotalMinor: grossTotal,
            discountMinor: discountMinor,
            netTotalMinor: netTotal,
            paymentMethod: paymentMethod,
            openCashDrawer: openCashDrawer,
            paidMinor: paidMinor,
            remainingMinor: remainingMinor);

        return await DeliverPrintJobAsync(
            firmId: firmId,
            branchId: branchId,
            deliveryMode: cfg.DeliveryMode,
            targetConfig: cfg.CashierPrinter,
            targetKey: "cashier",
            jobType: "cashier_bill",
            escPosBytes: receiptBytes,
            payloadMetadata: new
            {
                checkId = check.Id,
                tableName,
                waiterName,
                openCashDrawer,
                paymentMethod
            },
            ct: ct);
    }

    public async Task<PrintResult> PrintZReportAsync(
        string firmId,
        string branchId,
        Guid shiftId,
        CancellationToken ct = default)
    {
        var cfg = await GetConfigAsync(firmId, branchId, ct);
        if (cashDb is null || !(runtime?.CashReady ?? false))
        {
            return new PrintResult(false, cfg.CashierPrinter.Name, "None", "Kasa veritabanı hazır değil.");
        }

        var shift = await cashDb.Shifts
            .AsNoTracking()
            .Include(s => s.Register)
            .Include(s => s.Denominations)
            .Include(s => s.Movements)
            .SingleOrDefaultAsync(s => s.FirmId == firmId && s.BranchId == branchId && s.Id == shiftId, ct);

        if (shift is null)
        {
            return new PrintResult(false, cfg.CashierPrinter.Name, "None", "Vardiya bulunamadı.");
        }

        var report = CashEndpoints.BuildZReport(shift);
        var (firmTitle, branchTitle) = await ResolveFirmAndBranchTitlesAsync(firmId, branchId, ct);
        var bytes = EscPosBuilder.BuildZReportReceipt(firmTitle, branchTitle, report);

        return await DeliverPrintJobAsync(
            firmId: firmId,
            branchId: branchId,
            deliveryMode: cfg.DeliveryMode,
            targetConfig: cfg.CashierPrinter,
            targetKey: "cashier",
            jobType: "z_report",
            escPosBytes: bytes,
            payloadMetadata: new
            {
                shiftId,
                reportType = report.ReportType,
                reportNumber = report.ReportNumber,
                registerName = report.RegisterName,
            },
            ct: ct);
    }

    public async Task<PrintResult> OpenCashDrawerAsync(
        string firmId,
        string branchId,
        string actor,
        CancellationToken ct = default)
    {
        var cfg = await GetConfigAsync(firmId, branchId, ct);
        var pulseBytes = EscPosBuilder.BuildCashDrawerKick();

        return await DeliverPrintJobAsync(
            firmId: firmId,
            branchId: branchId,
            deliveryMode: cfg.DeliveryMode,
            targetConfig: cfg.CashierPrinter,
            targetKey: "cashier",
            jobType: "open_drawer",
            escPosBytes: pulseBytes,
            payloadMetadata: new
            {
                actor,
                reason = "manual_drawer_kick",
            },
            ct: ct);
    }

    public async Task<PrintResult> PrintKitchenVoidItemsAsync(
        string firmId,
        string branchId,
        Guid checkId,
        string actor,
        string reason,
        IReadOnlyList<(Guid ProductId, string ProductName, int Quantity)> voidItems,
        CancellationToken ct = default)
    {
        var cfg = await GetConfigAsync(firmId, branchId, ct);
        if (voidItems.Count == 0)
        {
            return new PrintResult(false, cfg.KitchenPrinter.Name, "None", "İptal edilen ürün bulunamadı.");
        }

        var check = await salesDb.Checks
            .AsNoTracking()
            .FirstOrDefaultAsync(row => row.Id == checkId && row.FirmId == firmId && row.BranchId == branchId, ct);

        string tableName = "Masa";
        if (check is not null)
        {
            (tableName, _) = await ResolveCheckTableAndWaiterAsync(firmId, branchId, check, ct, fallbackWaiter: actor);
        }

        var (_, branchTitle) = await ResolveFirmAndBranchTitlesAsync(firmId, branchId, ct);
        bool splitBar = cfg.AutoSplitKitchenByStation
            && cfg.BarPrinter.Enabled
            && !string.Equals(cfg.BarPrinter.Type, "Disabled", StringComparison.OrdinalIgnoreCase);

        Dictionary<Guid, string>? productStations = null;
        if (splitBar)
        {
            productStations = await ResolveLineStationsAsync(firmId, branchId, voidItems.Select(i => i.ProductId), ct);
        }

        var kitchenList = new List<(string ProductName, int Quantity)>();
        var barList = new List<(string ProductName, int Quantity)>();

        foreach (var item in voidItems)
        {
            if (splitBar && productStations is not null &&
                productStations.TryGetValue(item.ProductId, out var stationCode) &&
                string.Equals(stationCode, "drink", StringComparison.OrdinalIgnoreCase))
            {
                barList.Add((item.ProductName, item.Quantity));
            }
            else
            {
                kitchenList.Add((item.ProductName, item.Quantity));
            }
        }

        var results = new List<PrintResult>();
        var now = DateTimeOffset.UtcNow;
        var checkRef = checkId.ToString()[..8].ToUpperInvariant();

        if (kitchenList.Count > 0)
        {
            var kitchenBytes = EscPosBuilder.BuildKitchenVoidTicket(
                tableName, actor, checkRef, now, kitchenList, reason, "HIPOS MUTFAK", branchTitle);
            results.Add(await DeliverPrintJobAsync(
                firmId, branchId, cfg.DeliveryMode, cfg.KitchenPrinter,
                "kitchen", "kitchen_void", kitchenBytes,
                new { station = "food", checkId, tableName, reason }, ct));
        }

        if (barList.Count > 0)
        {
            var barBytes = EscPosBuilder.BuildKitchenVoidTicket(
                tableName, actor, checkRef, now, barList, reason, "BAR / ICECEK", branchTitle);
            results.Add(await DeliverPrintJobAsync(
                firmId, branchId, cfg.DeliveryMode, cfg.BarPrinter,
                "bar", "bar_void", barBytes,
                new { station = "drink", checkId, tableName, reason }, ct));
        }

        return AggregatePrintResults(results, cfg.KitchenPrinter.Name);
    }

    private static PrintResult AggregatePrintResults(IReadOnlyList<PrintResult> results, string defaultTarget)
    {
        if (results.Count == 0)
        {
            return new PrintResult(false, defaultTarget, "None", "Yazdırılacak ürün bulunamadı.");
        }
        if (results.Count == 1)
        {
            return results[0];
        }
        var allOk = results.All(r => r.Success);
        var errors = results.Where(r => !r.Success && !string.IsNullOrWhiteSpace(r.Error)).Select(r => r.Error!).ToArray();
        return new PrintResult(
            Success: allOk,
            Target: string.Join(" + ", results.Select(r => r.Target)),
            TransportUsed: string.Join(" + ", results.Select(r => r.TransportUsed).Distinct()),
            Error: errors.Length > 0 ? string.Join(" | ", errors) : null);
    }

    public async Task<PrintResult> TestPrintAsync(
        string target,
        string firmId = "11111111-1111-4111-8111-111111111111",
        string branchId = "33333333-3333-4333-8333-333333333333",
        CancellationToken ct = default)
    {
        var cfg = await GetConfigAsync(firmId, branchId, ct);
        var (firmTitle, branchTitle) = await ResolveFirmAndBranchTitlesAsync(firmId, branchId, ct);

        if (target.Equals("kitchen", StringComparison.OrdinalIgnoreCase))
        {
            var sampleItems = new List<KitchenTicketItem>
            {
                new("Adana Kebap", 2, "Acılı olsun", ["Pişirme: İyi pişmiş"]),
                new("Kaşarlı Pide", 1, "Çıtır", null)
            };

            var data = EscPosBuilder.BuildKitchenTicket(
                tableName: "MASA 5",
                waiterName: "Meryem",
                orderNumber: "TEST-01",
                orderTime: DateTimeOffset.UtcNow,
                items: sampleItems,
                stationHeader: "HIPOS MUTFAK",
                branchTitle: branchTitle);

            return await DeliverPrintJobAsync(
                firmId, branchId, cfg.DeliveryMode, cfg.KitchenPrinter,
                "kitchen", "test_print", data,
                new { tableName = "MASA 5", station = "food" }, ct);
        }

        if (target.Equals("bar", StringComparison.OrdinalIgnoreCase) || target.Equals("drink", StringComparison.OrdinalIgnoreCase))
        {
            var barItems = new List<KitchenTicketItem>
            {
                new("Kola (Kutu)", 2, "Buzlu", ["Limon: Var"]),
                new("Türk Kahvesi", 1, "Orta şekerli", null)
            };

            var barPrinter = cfg.BarPrinter.Enabled && !string.Equals(cfg.BarPrinter.Type, "Disabled", StringComparison.OrdinalIgnoreCase)
                ? cfg.BarPrinter
                : cfg.KitchenPrinter;

            var data = EscPosBuilder.BuildKitchenTicket(
                tableName: "MASA 5",
                waiterName: "Meryem",
                orderNumber: "TEST-BAR",
                orderTime: DateTimeOffset.UtcNow,
                items: barItems,
                stationHeader: "BAR / ICECEK",
                branchTitle: branchTitle);

            return await DeliverPrintJobAsync(
                firmId, branchId, cfg.DeliveryMode, barPrinter,
                "bar", "test_print", data,
                new { tableName = "MASA 5", station = "drink" }, ct);
        }

        var cashierItems = new List<CashierReceiptItem>
        {
            new("Adana Kebap", 2, 32000, 64000),
            new("Kaşarlı Pide", 1, 24000, 24000),
            new("Kola (Kutu)", 2, 6000, 12000)
        };

        var cashierBytes = EscPosBuilder.BuildCashierReceipt(
            firmTitle: firmTitle,
            branchTitle: $"{branchTitle} · KASA FISI TESTI",
            tableName: "MASA 5",
            waiterName: "Ahmet",
            checkNumber: "TEST-01",
            checkTime: DateTimeOffset.UtcNow,
            items: cashierItems,
            grossTotalMinor: 100000,
            discountMinor: 10000,
            netTotalMinor: 90000,
            paymentMethod: "NAKIT",
            openCashDrawer: true);

        return await DeliverPrintJobAsync(
            firmId, branchId, cfg.DeliveryMode, cfg.CashierPrinter,
            "cashier", "test_print", cashierBytes,
            new { tableName = "MASA 5", openCashDrawer = true }, ct);
    }

    public static async Task<(bool Reachable, int LatencyMs, string? Error)> CheckConnectionAsync(
        string ip, int port, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(ip) || port <= 0)
        {
            return (false, -1, "Geçersiz IP adresi veya port.");
        }

        var sw = Stopwatch.StartNew();
        try
        {
            using var client = new TcpClient();
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(2));

            await client.ConnectAsync(ip, port, cts.Token);
            sw.Stop();
            return (true, (int)sw.ElapsedMilliseconds, null);
        }
        catch (OperationCanceledException)
        {
            return (false, -1, "Zaman aşımı (2 saniye içinde yanıt alınamadı). Yazıcı açık ve ağa bağlı mı?");
        }
        catch (SocketException ex)
        {
            return (false, -1, $"Bağlantı hatası: {ex.Message}");
        }
        catch (Exception ex)
        {
            return (false, -1, ex.Message);
        }
    }

    private async Task<PrintResult> DispatchKitchenTicketsAsync(
        string firmId,
        string branchId,
        PrinterConfig cfg,
        IReadOnlyList<SalesOrderLineRow> lines,
        string tableName,
        string waiterName,
        string orderNumber,
        DateTimeOffset orderTime,
        bool isReprint,
        object extraMeta,
        CancellationToken ct)
    {
        var (_, branchTitle) = await ResolveFirmAndBranchTitlesAsync(firmId, branchId, ct);

        bool splitBar = cfg.AutoSplitKitchenByStation
            && cfg.BarPrinter.Enabled
            && !string.Equals(cfg.BarPrinter.Type, "Disabled", StringComparison.OrdinalIgnoreCase);

        Dictionary<Guid, string>? productStations = null;
        if (splitBar)
        {
            productStations = await ResolveLineStationsAsync(firmId, branchId, lines.Select(l => l.ProductId), ct);
        }

        var kitchenItems = new List<KitchenTicketItem>();
        var barItems = new List<KitchenTicketItem>();

        foreach (var line in lines)
        {
            var ticketItem = new KitchenTicketItem(
                line.ProductName,
                line.Quantity,
                !string.IsNullOrWhiteSpace(line.Notes) ? line.Notes : line.Note,
                ParseOptions(line.OptionsJson));

            if (splitBar && productStations is not null &&
                productStations.TryGetValue(line.ProductId, out var stationCode) &&
                string.Equals(stationCode, "drink", StringComparison.OrdinalIgnoreCase))
            {
                barItems.Add(ticketItem);
            }
            else
            {
                kitchenItems.Add(ticketItem);
            }
        }

        var results = new List<PrintResult>();

        if (kitchenItems.Count > 0)
        {
            var kitchenBytes = EscPosBuilder.BuildKitchenTicket(
                tableName: tableName,
                waiterName: waiterName,
                orderNumber: orderNumber,
                orderTime: orderTime,
                items: kitchenItems,
                isReprint: isReprint,
                stationHeader: "HIPOS MUTFAK",
                branchTitle: branchTitle);

            results.Add(await DeliverPrintJobAsync(
                firmId, branchId, cfg.DeliveryMode, cfg.KitchenPrinter,
                "kitchen", "kitchen_ticket", kitchenBytes,
                new { station = "food", tableName, waiterName, isReprint, meta = extraMeta },
                ct));
        }

        if (barItems.Count > 0)
        {
            var barBytes = EscPosBuilder.BuildKitchenTicket(
                tableName: tableName,
                waiterName: waiterName,
                orderNumber: orderNumber,
                orderTime: orderTime,
                items: barItems,
                isReprint: isReprint,
                stationHeader: "BAR / ICECEK",
                branchTitle: branchTitle);

            results.Add(await DeliverPrintJobAsync(
                firmId, branchId, cfg.DeliveryMode, cfg.BarPrinter,
                "bar", "bar_ticket", barBytes,
                new { station = "drink", tableName, waiterName, isReprint, meta = extraMeta },
                ct));
        }

        return AggregatePrintResults(results, cfg.KitchenPrinter.Name);
    }

    private async Task<Dictionary<Guid, string>> ResolveLineStationsAsync(
        string firmId,
        string branchId,
        IEnumerable<Guid> productIds,
        CancellationToken ct)
    {
        var result = new Dictionary<Guid, string>();
        if (catalogDb is null || kitchenDb is null) return result;

        var distinctProductIds = productIds.Distinct().ToArray();
        if (distinctProductIds.Length == 0) return result;

        var productCategories = await catalogDb.Products
            .AsNoTracking()
            .Where(p => p.FirmId == firmId && distinctProductIds.Contains(p.Id))
            .Select(p => new { p.Id, p.CategoryId })
            .ToListAsync(ct);

        var categoryIds = productCategories
            .Select(pc => pc.CategoryId)
            .Where(cid => !string.IsNullOrWhiteSpace(cid))
            .Distinct()
            .ToArray();

        if (categoryIds.Length == 0) return result;

        var stationMappings = await (
            from sc in kitchenDb.StationCategories.AsNoTracking()
            join st in kitchenDb.Stations.AsNoTracking() on sc.StationId equals st.Id
            where sc.FirmId == firmId && sc.BranchId == branchId && categoryIds.Contains(sc.CategoryId) && st.IsActive
            select new { sc.CategoryId, st.Code }
        ).ToListAsync(ct);

        var stationByCategory = stationMappings
            .GroupBy(x => x.CategoryId, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.First().Code, StringComparer.Ordinal);

        foreach (var pc in productCategories)
        {
            if (stationByCategory.TryGetValue(pc.CategoryId, out var code))
            {
                result[pc.Id] = code;
            }
        }

        return result;
    }

    private async Task<PrintResult> DeliverPrintJobAsync(
        string firmId,
        string branchId,
        string deliveryMode,
        PrinterTargetConfig targetConfig,
        string targetKey,
        string jobType,
        byte[] escPosBytes,
        object payloadMetadata,
        CancellationToken ct)
    {
        var jobId = Guid.NewGuid().ToString("N")[..16];

        eventHub?.Publish("print.job", firmId, branchId, new
        {
            jobId,
            target = targetKey,
            type = jobType,
            targetName = targetConfig.Name,
            metadata = payloadMetadata,
            rawEscPosBase64 = Convert.ToBase64String(escPosBytes),
            createdAt = DateTimeOffset.UtcNow
        });

        var mode = NormalizeDeliveryMode(deliveryMode);
        var bridgeOnline = bridgeRegistry.HasActiveStream(firmId, branchId);

        if (mode == "CloudBridge")
        {
            if (bridgeOnline)
            {
                return new PrintResult(true, targetConfig.Name, "CloudBridge (SSE)");
            }

            return new PrintResult(
                false,
                targetConfig.Name,
                "CloudBridge (Offline)",
                "Yazıcı köprüsü (Print Bridge) çevrimdışı. Şube bilgisayarında köprüyü başlatın.");
        }

        if (mode == "Auto" && bridgeOnline)
        {
            return new PrintResult(true, targetConfig.Name, "CloudBridge (SSE)");
        }

        return await transport.SendAsync(targetConfig, escPosBytes, ct);
    }

    private async Task<(string TableName, string WaiterName)> ResolveOrderTableAndWaiterAsync(
        string firmId, string branchId, Guid checkId, CancellationToken ct)
    {
        var assignment = await serviceDb.Assignments
            .AsNoTracking()
            .FirstOrDefaultAsync(row => row.FirmId == firmId && row.BranchId == branchId &&
                row.CheckId == checkId && row.ClosedAt == null, ct);

        if (assignment is not null)
        {
            string tableName = "Masa";
            string waiterName = "Garson";

            var table = await serviceDb.Tables.AsNoTracking()
                .FirstOrDefaultAsync(row => row.Id == assignment.TableId, ct);
            if (table is not null) tableName = table.Name;

            if (assignment.WaiterId is not null)
            {
                var waiter = await serviceDb.Employees.AsNoTracking()
                    .FirstOrDefaultAsync(row => row.Id == assignment.WaiterId, ct);
                if (waiter is not null) waiterName = waiter.Name;
            }

            return (tableName, waiterName);
        }

        var check = await salesDb.Checks.AsNoTracking()
            .FirstOrDefaultAsync(row => row.Id == checkId, ct);

        if (check is null)
        {
            return ("Hızlı Satış (Gel-Al)", "Kasa / Kasiyer");
        }

        return await ResolveCheckTableAndWaiterAsync(firmId, branchId, check, ct);
    }

    private async Task<(string TableName, string WaiterName)> ResolveCheckTableAndWaiterAsync(
        string firmId,
        string branchId,
        SalesCheckRow check,
        CancellationToken ct,
        string fallbackWaiter = "Garson",
        string quickTableLabel = "Hızlı Satış (Gel-Al)")
    {
        string tableName = check.TableId is not null ? "Masa" : quickTableLabel;
        string waiterName = check.TableId is not null ? fallbackWaiter : "Kasa / Kasiyer";

        if (check.TableId is not null)
        {
            var table = await serviceDb.Tables.AsNoTracking()
                .FirstOrDefaultAsync(row => row.Id == check.TableId, ct);
            if (table is not null) tableName = table.Name;
        }

        if (check.WaiterId is not null)
        {
            var waiter = await serviceDb.Employees.AsNoTracking()
                .FirstOrDefaultAsync(row => row.Id == check.WaiterId, ct);
            if (waiter is not null) waiterName = waiter.Name;
        }
        else
        {
            var assignment = await serviceDb.Assignments.AsNoTracking()
                .FirstOrDefaultAsync(row => row.FirmId == firmId && row.BranchId == branchId &&
                    row.CheckId == check.Id && row.ClosedAt == null, ct);
            if (assignment?.WaiterId is not null)
            {
                var waiter = await serviceDb.Employees.AsNoTracking()
                    .FirstOrDefaultAsync(row => row.Id == assignment.WaiterId, ct);
                if (waiter is not null) waiterName = waiter.Name;
            }
        }

        return (tableName, waiterName);
    }

    private async Task<(string FirmTitle, string BranchTitle)> ResolveFirmAndBranchTitlesAsync(
        string firmId, string branchId, CancellationToken ct)
    {
        if (authDb is null) return ("HIPOS RESTORAN", "MERKEZ SUBE");

        var branch = await authDb.Branches
            .AsNoTracking()
            .Include(b => b.Firm)
            .FirstOrDefaultAsync(b => b.Id == branchId && b.FirmId == firmId, ct);

        if (branch is null)
        {
            var firm = await authDb.Firms.AsNoTracking().FirstOrDefaultAsync(f => f.Id == firmId, ct);
            return (!string.IsNullOrWhiteSpace(firm?.BrandName) ? firm!.BrandName! : firm?.Name ?? "HIPOS RESTORAN", "MERKEZ SUBE");
        }

        var firmTitle = !string.IsNullOrWhiteSpace(branch.Firm?.BrandName)
            ? branch.Firm.BrandName!
            : branch.Firm?.Name ?? "HIPOS RESTORAN";
        return (firmTitle, branch.Name);
    }

    private static List<string>? ParseOptions(string? optionsJson)
    {
        if (string.IsNullOrWhiteSpace(optionsJson) || optionsJson == "[]") return null;
        try
        {
            using var doc = JsonDocument.Parse(optionsJson);
            return doc.RootElement.EnumerateArray()
                .Select(el =>
                {
                    var group = el.TryGetProperty("groupName", out var g) ? g.GetString() : null;
                    var opt = el.TryGetProperty("optionName", out var o) ? o.GetString() : null;
                    return group is not null && opt is not null ? $"{group}: {opt}" : opt ?? "";
                })
                .Where(s => !string.IsNullOrEmpty(s))
                .ToList();
        }
        catch
        {
            return null;
        }
    }

    private static string NormalizeDeliveryMode(string? input) => input?.Trim().ToLowerInvariant() switch
    {
        "cloud_bridge" or "cloudbridge" or "bridge" => "CloudBridge",
        "direct_lan" or "directlan" or "direct" or "lan" => "DirectLan",
        _ => "Auto"
    };

    private static string NormalizePrinterType(string? input, string fallback) => input?.Trim().ToLowerInvariant() switch
    {
        "network" or "tcp" => "Network",
        "usb" or "cups" or "spooler" or "local" => "Usb",
        "console" or "virtual" => "Console",
        "disabled" or "off" or "none" => "Disabled",
        _ => fallback
    };

    private static void ApplyRequestToInMemoryConfig(PrinterConfig cfg, UpdatePrinterConfigRequest req)
    {
        if (!string.IsNullOrWhiteSpace(req.DeliveryMode ?? req.Mode))
            cfg.DeliveryMode = NormalizeDeliveryMode(req.DeliveryMode ?? req.Mode);
        if (req.AutoPrintKitchenOnOrder.HasValue)
            cfg.AutoPrintKitchenOnOrder = req.AutoPrintKitchenOnOrder.Value;
        if (req.AutoSplitKitchenByStation.HasValue)
            cfg.AutoSplitKitchenByStation = req.AutoSplitKitchenByStation.Value;

        ApplyTargetPatch(cfg.KitchenPrinter, req.KitchenIp, req.KitchenPort, req.KitchenType,
            req.KitchenSystemPrinterName, req.KitchenFallbackToUsb, req.KitchenEnabled);
        ApplyTargetPatch(cfg.CashierPrinter, req.CashierIp, req.CashierPort, req.CashierType,
            req.CashierSystemPrinterName, req.CashierFallbackToUsb, req.CashierEnabled);
        ApplyTargetPatch(cfg.BarPrinter, req.BarIp, req.BarPort, req.BarType,
            req.BarSystemPrinterName, req.BarFallbackToUsb, req.BarEnabled, isOptionalTarget: true);
        cfg.Version++;
        cfg.UpdatedAt = DateTimeOffset.UtcNow;
    }

    private static void ApplyTargetPatch(
        PrinterTargetConfig target,
        string? ip,
        int? port,
        string? type,
        string? systemPrinterName,
        bool? fallbackToUsb,
        bool? enabled,
        bool isOptionalTarget = false)
    {
        if (!string.IsNullOrWhiteSpace(ip)) target.IpAddress = ip.Trim();
        if (port is > 0) target.Port = port.Value;
        if (!string.IsNullOrWhiteSpace(type)) target.Type = NormalizePrinterType(type, target.Type);
        if (systemPrinterName is not null)
            target.SystemPrinterName = string.IsNullOrWhiteSpace(systemPrinterName) ? null : systemPrinterName.Trim();
        if (fallbackToUsb.HasValue) target.FallbackToUsb = fallbackToUsb.Value;

        if (enabled.HasValue)
        {
            target.Enabled = enabled.Value;
            if (enabled.Value && string.Equals(target.Type, "Disabled", StringComparison.OrdinalIgnoreCase))
            {
                target.Type = !string.IsNullOrWhiteSpace(target.SystemPrinterName) ? "Usb" : "Network";
            }
            else if (!enabled.Value && isOptionalTarget)
            {
                target.Type = "Disabled";
            }
        }
        else if (!string.IsNullOrWhiteSpace(type))
        {
            target.Enabled = !string.Equals(target.Type, "Disabled", StringComparison.OrdinalIgnoreCase);
        }
    }

    private static void ApplyRequestToRow(PrinterProfileRow row, UpdatePrinterConfigRequest req, string actor)
    {
        var cfg = row.ToPrinterConfig();
        ApplyRequestToInMemoryConfig(cfg, req);

        row.DeliveryMode = cfg.DeliveryMode;
        row.AutoPrintKitchenOnOrder = cfg.AutoPrintKitchenOnOrder;
        row.AutoSplitKitchenByStation = cfg.AutoSplitKitchenByStation;

        row.KitchenType = cfg.KitchenPrinter.Type;
        row.KitchenEnabled = cfg.KitchenPrinter.Enabled;
        row.KitchenIp = cfg.KitchenPrinter.IpAddress;
        row.KitchenPort = cfg.KitchenPrinter.Port;
        row.KitchenSystemPrinterName = cfg.KitchenPrinter.SystemPrinterName;
        row.KitchenFallbackToUsb = cfg.KitchenPrinter.FallbackToUsb;

        row.CashierType = cfg.CashierPrinter.Type;
        row.CashierEnabled = cfg.CashierPrinter.Enabled;
        row.CashierIp = cfg.CashierPrinter.IpAddress;
        row.CashierPort = cfg.CashierPrinter.Port;
        row.CashierSystemPrinterName = cfg.CashierPrinter.SystemPrinterName;
        row.CashierFallbackToUsb = cfg.CashierPrinter.FallbackToUsb;

        row.BarType = cfg.BarPrinter.Type;
        row.BarEnabled = cfg.BarPrinter.Enabled;
        row.BarIp = cfg.BarPrinter.IpAddress;
        row.BarPort = cfg.BarPrinter.Port;
        row.BarSystemPrinterName = cfg.BarPrinter.SystemPrinterName;
        row.BarFallbackToUsb = cfg.BarPrinter.FallbackToUsb;

        row.UpdatedBy = actor;
        row.UpdatedAt = DateTimeOffset.UtcNow;
    }
}
