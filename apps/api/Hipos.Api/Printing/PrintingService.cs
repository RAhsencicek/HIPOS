using System.Diagnostics;
using System.Net.Sockets;
using System.Text.Json;
using Hipos.Api.Sales;
using Hipos.Api.Service;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Hipos.Api.Printing;

public sealed class PrintingService(
    SalesDbContext salesDb,
    ServiceDbContext serviceDb,
    PrinterTransport transport,
    PrinterConfig config,
    ILogger<PrintingService> logger)
{
    private readonly PrinterConfig _config = config;
    private static readonly string SettingsFilePath = Path.Combine(AppContext.BaseDirectory, "printer_settings.json");
    private static readonly object FileLock = new();

    private void EnsureLoaded()
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
                        _config.AutoPrintKitchenOnOrder = loaded.AutoPrintKitchenOnOrder;
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
        EnsureLoaded();
        return _config;
    }

    public void UpdateConfig(UpdatePrinterConfigRequest request)
    {
        EnsureLoaded();
        if (!string.IsNullOrWhiteSpace(request.KitchenIp))
            _config.KitchenPrinter.IpAddress = request.KitchenIp.Trim();
        if (request.KitchenPort is > 0)
            _config.KitchenPrinter.Port = request.KitchenPort.Value;
        if (!string.IsNullOrWhiteSpace(request.KitchenType))
            _config.KitchenPrinter.Type = request.KitchenType.Trim();
        if (request.KitchenFallbackToUsb.HasValue)
            _config.KitchenPrinter.FallbackToUsb = request.KitchenFallbackToUsb.Value;

        if (!string.IsNullOrWhiteSpace(request.CashierIp))
            _config.CashierPrinter.IpAddress = request.CashierIp.Trim();
        if (request.CashierPort is > 0)
            _config.CashierPrinter.Port = request.CashierPort.Value;
        if (!string.IsNullOrWhiteSpace(request.CashierType))
            _config.CashierPrinter.Type = request.CashierType.Trim();
        if (request.CashierFallbackToUsb.HasValue)
            _config.CashierPrinter.FallbackToUsb = request.CashierFallbackToUsb.Value;

        lock (FileLock)
        {
            try
            {
                var json = JsonSerializer.Serialize(_config, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(SettingsFilePath, json);
                logger.LogInformation("Yazıcı ayarları başarıyla kaydedildi: {Path}", SettingsFilePath);
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
        EnsureLoaded();

        var order = await salesDb.Orders
            .AsNoTracking()
            .Include(row => row.Lines)
            .FirstOrDefaultAsync(row => row.Id == orderId && row.FirmId == firmId && row.BranchId == branchId, ct);

        if (order is null)
        {
            logger.LogWarning("Mutfak fişi için sipariş bulunamadı: {OrderId}", orderId);
            return new PrintResult(false, _config.KitchenPrinter.Name, "None", "Sipariş bulunamadı.");
        }

        // Resolve Table and Waiter
        string tableName = "Masa";
        string waiterName = "Garson";

        var assignment = await serviceDb.Assignments
            .AsNoTracking()
            .FirstOrDefaultAsync(row => row.FirmId == firmId && row.BranchId == branchId &&
                row.CheckId == order.CheckId && row.ClosedAt == null, ct);

        if (assignment is not null)
        {
            var table = await serviceDb.Tables.AsNoTracking()
                .FirstOrDefaultAsync(row => row.Id == assignment.TableId, ct);
            if (table is not null) tableName = table.Name;

            if (assignment.WaiterId is not null)
            {
                var waiter = await serviceDb.Employees.AsNoTracking()
                    .FirstOrDefaultAsync(row => row.Id == assignment.WaiterId, ct);
                if (waiter is not null) waiterName = waiter.Name;
            }
        }
        else
        {
            var check = await salesDb.Checks.AsNoTracking()
                .FirstOrDefaultAsync(row => row.Id == order.CheckId, ct);
            if (check?.TableId is not null)
            {
                var table = await serviceDb.Tables.AsNoTracking()
                    .FirstOrDefaultAsync(row => row.Id == check.TableId, ct);
                if (table is not null) tableName = table.Name;
            }
        }

        var items = new List<KitchenTicketItem>();
        foreach (var line in order.Lines)
        {
            List<string>? optionsList = null;
            if (!string.IsNullOrWhiteSpace(line.OptionsJson) && line.OptionsJson != "[]")
            {
                try
                {
                    using var doc = JsonDocument.Parse(line.OptionsJson);
                    optionsList = doc.RootElement.EnumerateArray()
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
                    // Ignore malformed option json
                }
            }

            items.Add(new KitchenTicketItem(line.ProductName, line.Quantity, line.Note, optionsList));
        }

        var ticketBytes = EscPosBuilder.BuildKitchenTicket(
            tableName: tableName,
            waiterName: waiterName,
            orderNumber: order.Id.ToString()[..8].ToUpperInvariant(),
            orderTime: order.CreatedAt,
            items: items,
            isReprint: isReprint);

        return await transport.SendAsync(_config.KitchenPrinter, ticketBytes, ct);
    }

    public async Task<PrintResult> PrintKitchenTableAsync(
        string firmId,
        string branchId,
        string tableId,
        bool isReprint = false,
        CancellationToken ct = default)
    {
        EnsureLoaded();

        // 1. Masaya ait açık adisyonu bul
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
            return new PrintResult(false, _config.KitchenPrinter.Name, "None", "Bu masada açık bir sipariş/adisyon bulunamadı.");
        }

        // 2. Bu adisyona ait iptal edilmemiş tüm siparişleri bul
        var orders = await salesDb.Orders
            .AsNoTracking()
            .Include(row => row.Lines)
            .Where(row => row.CheckId == check.Id && row.FirmId == firmId && row.BranchId == branchId && row.Status != "cancelled")
            .OrderBy(row => row.CreatedAt)
            .ToListAsync(ct);

        if (orders.Count == 0 || orders.All(o => o.Lines.Count == 0))
        {
            return new PrintResult(false, _config.KitchenPrinter.Name, "None", "Masaya ait yazdırılacak sipariş kalemi bulunamadı.");
        }

        // 3. Masa ve Garson adını çöz
        string tableName = "Masa";
        string waiterName = "Garson";

        var table = await serviceDb.Tables.AsNoTracking()
            .FirstOrDefaultAsync(row => row.Id == tableId, ct);
        if (table is not null) tableName = table.Name;

        if (check.WaiterId is not null)
        {
            var waiter = await serviceDb.Employees.AsNoTracking()
                .FirstOrDefaultAsync(row => row.Id == check.WaiterId, ct);
            if (waiter is not null) waiterName = waiter.Name;
        }

        var items = new List<KitchenTicketItem>();
        foreach (var line in orders.SelectMany(o => o.Lines))
        {
            List<string>? optionsList = null;
            if (!string.IsNullOrWhiteSpace(line.OptionsJson) && line.OptionsJson != "[]")
            {
                try
                {
                    using var doc = JsonDocument.Parse(line.OptionsJson);
                    optionsList = doc.RootElement.EnumerateArray()
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
                    // Ignore malformed option json
                }
            }

            items.Add(new KitchenTicketItem(line.ProductName, line.Quantity, line.Note, optionsList));
        }

        var ticketBytes = EscPosBuilder.BuildKitchenTicket(
            tableName: tableName,
            waiterName: waiterName,
            orderNumber: check.Id.ToString()[..8].ToUpperInvariant(),
            orderTime: orders.Last().CreatedAt,
            items: items,
            isReprint: isReprint);

        return await transport.SendAsync(_config.KitchenPrinter, ticketBytes, ct);
    }

    public async Task<PrintResult> PrintCashierBillAsync(
        string firmId,
        string branchId,
        Guid checkId,
        CancellationToken ct = default,
        bool openCashDrawer = false,
        string paymentMethod = "NAKIT")
    {
        EnsureLoaded();

        var check = await salesDb.Checks
            .AsNoTracking()
            .FirstOrDefaultAsync(row => row.Id == checkId && row.FirmId == firmId && row.BranchId == branchId, ct);

        if (check is null)
        {
            logger.LogWarning("Hesap fişi için adisyon bulunamadı: {CheckId}", checkId);
            return new PrintResult(false, _config.CashierPrinter.Name, "None", "Adisyon bulunamadı.");
        }

        var orders = await salesDb.Orders
            .AsNoTracking()
            .Include(row => row.Lines)
            .Include(row => row.PaymentAttempts)
            .Where(row => row.CheckId == checkId && row.FirmId == firmId && row.BranchId == branchId && row.Status != "cancelled")
            .ToListAsync(ct);

        var lines = orders.SelectMany(o => o.Lines).ToList();

        // Resolve Table and Waiter
        string tableName = check.TableId is null ? "Paket / Gel-Al" : "Masa";
        string waiterName = "Kasiyer";

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

        // Consolidate identical items
        var consolidated = lines
            .GroupBy(l => l.ProductName)
            .Select(g => new CashierReceiptItem(
                ProductName: g.Key,
                Quantity: g.Sum(x => x.Quantity),
                UnitPriceMinor: g.First().UnitPriceMinor,
                LineTotalMinor: g.Sum(x => x.LineTotalMinor)))
            .ToList();

        long grossTotal = consolidated.Sum(x => x.LineTotalMinor);

        // Adjustments / Discounts
        var adjustments = await salesDb.CheckAdjustments
            .AsNoTracking()
            .Where(row => row.CheckId == checkId && row.FirmId == firmId && row.BranchId == branchId)
            .ToListAsync(ct);

        long discountMinor = adjustments.Where(a => a.Action is "discount" or "comp").Sum(a => a.AmountMinor);
        long netTotal = Math.Max(0, grossTotal - discountMinor);

        long paidMinor = orders.SelectMany(o => o.PaymentAttempts).Where(p => p.Status == "succeeded").Sum(p => p.AmountMinor);
        long remainingMinor = Math.Max(0, netTotal - paidMinor);

        var receiptBytes = EscPosBuilder.BuildCashierReceipt(
            firmTitle: "HIPOS RESTORAN",
            branchTitle: check.TableId is null ? "GEL-AL HESAP FISI" : "SALON HESAP FISI",
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

        return await transport.SendAsync(_config.CashierPrinter, receiptBytes, ct);
    }

    public async Task<PrintResult> TestPrintAsync(string target, CancellationToken ct = default)
    {
        EnsureLoaded();

        if (target.Equals("kitchen", StringComparison.OrdinalIgnoreCase))
        {
            var sampleItems = new List<KitchenTicketItem>
            {
                new("Adana Kebap", 2, "Acılı olsun", new[] { "Pişirme: İyi pişmiş" }),
                new("Kaşarlı Pide", 1, "Çıtır", null),
                new("Kola (Kutu)", 2, null, new[] { "Limon: Var" })
            };

            var data = EscPosBuilder.BuildKitchenTicket(
                tableName: "MASA 5",
                waiterName: "Meryem",
                orderNumber: "TEST-01",
                orderTime: DateTimeOffset.UtcNow,
                items: sampleItems);

            return await transport.SendAsync(_config.KitchenPrinter, data, ct);
        }
        else
        {
            var sampleItems = new List<CashierReceiptItem>
            {
                new("Adana Kebap", 2, 32000, 64000),
                new("Kaşarlı Pide", 1, 24000, 24000),
                new("Kola (Kutu)", 2, 6000, 12000)
            };

            var data = EscPosBuilder.BuildCashierReceipt(
                firmTitle: "HIPOS RESTORAN",
                branchTitle: "KASA FISI TESTI",
                tableName: "MASA 5",
                waiterName: "Ahmet",
                checkNumber: "TEST-01",
                checkTime: DateTimeOffset.UtcNow,
                items: sampleItems,
                grossTotalMinor: 100000,
                discountMinor: 10000,
                netTotalMinor: 90000,
                paymentMethod: "NAKIT",
                openCashDrawer: true);

            return await transport.SendAsync(_config.CashierPrinter, data, ct);
        }
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
}
