using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Hipos.Api.Catalog;
using Hipos.Api.Features;
using Hipos.Api.Sales;

namespace Hipos.Api.Reports;

public sealed record SalesAnalyticsSummary(
    long GrossRevenueMinor,
    long NetRevenueMinor,
    long DiscountMinor,
    long CashRevenueMinor,
    long CardRevenueMinor,
    int CompletedChecksCount,
    long AverageCheckMinor,
    int OpenChecksCount,
    long OpenChecksBalanceMinor,
    int TotalItemsSold
);

public sealed record PaymentMethodBreakdown(
    string Method,
    string Label,
    int Count,
    long AmountMinor,
    double Percentage
);

public sealed record ChannelBreakdown(
    string Channel,
    string Label,
    int Count,
    long AmountMinor,
    double Percentage
);

public sealed record TopProductDto(
    Guid ProductId,
    string ProductName,
    string CategoryName,
    int Quantity,
    long TotalRevenueMinor,
    double Percentage
);

public sealed record HourlyTrendDto(
    string Hour,
    int Count,
    long RevenueMinor
);

public sealed record BranchSalesDto(
    string BranchId,
    string BranchName,
    int CheckCount,
    long RevenueMinor,
    double Percentage
);

public sealed record SalesAnalyticsScope(
    string FirmId,
    string? BranchId,
    string Range,
    DateTimeOffset From,
    DateTimeOffset To
);

public sealed record SalesAnalyticsResponse(
    string Source,
    SalesAnalyticsScope Scope,
    SalesAnalyticsSummary Summary,
    IReadOnlyList<PaymentMethodBreakdown> PaymentBreakdown,
    IReadOnlyList<ChannelBreakdown> ChannelBreakdown,
    IReadOnlyList<TopProductDto> TopProducts,
    IReadOnlyList<HourlyTrendDto> HourlyTrends,
    IReadOnlyList<BranchSalesDto> BranchComparison
);

public static class ReportsEndpoints
{
    private static readonly Dictionary<string, string> BranchNames = new()
    {
        ["33333333-3333-4333-8333-333333333333"] = "Kadıköy Şubesi",
        ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"] = "Moda Şubesi",
        ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2"] = "Beşiktaş Şubesi",
        ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3"] = "Ataşehir Şubesi",
    };

    public static void MapReportsEndpoints(this WebApplication app, bool salesReady)
    {
        var branchReportGroup = app.MapGroup("/api/v1/firms/{firmId}/branches/{branchId}/reports");
        var firmReportGroup = app.MapGroup("/api/v1/firms/{firmId}/reports");

        branchReportGroup.MapGet("/sales-analytics", async (
            string firmId,
            string branchId,
            [FromQuery] string? range,
            [FromQuery] string? from,
            [FromQuery] string? to,
            HttpContext context,
            SalesDbContext salesDb,
            CatalogDbContext catalogDb,
            CancellationToken ct) =>
        {
            return await BuildSalesAnalyticsAsync(firmId, branchId, range, from, to, context, salesDb, catalogDb, salesReady, ct);
        });

        firmReportGroup.MapGet("/sales-analytics", async (
            string firmId,
            [FromQuery] string? range,
            [FromQuery] string? from,
            [FromQuery] string? to,
            HttpContext context,
            SalesDbContext salesDb,
            CatalogDbContext catalogDb,
            CancellationToken ct) =>
        {
            return await BuildSalesAnalyticsAsync(firmId, null, range, from, to, context, salesDb, catalogDb, salesReady, ct);
        });
    }

    private static async Task<IResult> BuildSalesAnalyticsAsync(
        string firmId,
        string? branchId,
        string? range,
        string? from,
        string? to,
        HttpContext context,
        SalesDbContext salesDb,
        CatalogDbContext catalogDb,
        bool salesReady,
        CancellationToken ct)
    {
        if (!salesReady)
        {
            return Results.Json(new { code = "SALES_STORAGE_UNAVAILABLE", message = "Satış veritabanı hazır değil." }, statusCode: 503);
        }

        var actor = DemoAccess.Resolve(context);
        if (actor is not null)
        {
            if (branchId is not null && !actor.CanRead(firmId, branchId))
            {
                return Results.Json(new { code = "UNAUTHORIZED_SCOPE", message = "Bu şubenin raporlarına erişim yetkiniz yok." }, statusCode: 403);
            }
        }

        var turkeyTz = TimeSpan.FromHours(3);
        var nowLocal = DateTimeOffset.UtcNow.ToOffset(turkeyTz);
        DateTimeOffset startUtc;
        DateTimeOffset endUtc;

        var selectedRange = (range ?? "today").Trim().ToLowerInvariant();

        if (!string.IsNullOrEmpty(from) && DateTimeOffset.TryParse(from, out var customFrom))
        {
            startUtc = customFrom.ToUniversalTime();
            endUtc = (!string.IsNullOrEmpty(to) && DateTimeOffset.TryParse(to, out var customTo))
                ? customTo.ToUniversalTime()
                : DateTimeOffset.UtcNow.AddMinutes(5);
            selectedRange = "custom";
        }
        else
        {
            var todayStart = new DateTimeOffset(nowLocal.Year, nowLocal.Month, nowLocal.Day, 0, 0, 0, turkeyTz).ToUniversalTime();
            switch (selectedRange)
            {
                case "yesterday":
                    startUtc = todayStart.AddDays(-1);
                    endUtc = todayStart;
                    break;
                case "week":
                    startUtc = todayStart.AddDays(-7);
                    endUtc = DateTimeOffset.UtcNow.AddMinutes(5);
                    break;
                case "month":
                    startUtc = new DateTimeOffset(nowLocal.Year, nowLocal.Month, 1, 0, 0, 0, turkeyTz).ToUniversalTime();
                    endUtc = DateTimeOffset.UtcNow.AddMinutes(5);
                    break;
                case "year":
                    startUtc = new DateTimeOffset(nowLocal.Year, 1, 1, 0, 0, 0, turkeyTz).ToUniversalTime();
                    endUtc = DateTimeOffset.UtcNow.AddMinutes(5);
                    break;
                case "all":
                    startUtc = DateTimeOffset.MinValue.ToUniversalTime();
                    endUtc = DateTimeOffset.MaxValue.ToUniversalTime();
                    break;
                case "today":
                default:
                    startUtc = todayStart;
                    endUtc = todayStart.AddDays(1);
                    selectedRange = "today";
                    break;
            }
        }

        // 1. Ödeme Hareketleri (Succeeded Payments)
        var paymentQuery = salesDb.PaymentAttempts.AsNoTracking()
            .Where(p => p.FirmId == firmId &&
                        (branchId == null || p.BranchId == branchId) &&
                        p.Status == "succeeded" &&
                        p.CreatedAt >= startUtc && p.CreatedAt < endUtc);

        var payments = await paymentQuery.ToListAsync(ct);

        long grossRevenueMinor = payments.Sum(p => p.AmountMinor);
        long cashRevenueMinor = payments.Where(p => p.Method == "cash").Sum(p => p.AmountMinor);
        long cardRevenueMinor = payments.Where(p => p.Method == "card").Sum(p => p.AmountMinor);

        // 2. İndirim ve Düzeltmeler (Adjustments)
        var adjustmentQuery = salesDb.CheckAdjustments.AsNoTracking()
            .Where(a => a.FirmId == firmId &&
                        (branchId == null || a.BranchId == branchId) &&
                        a.CreatedAt >= startUtc && a.CreatedAt < endUtc);

        var adjustments = await adjustmentQuery.ToListAsync(ct);
        long discountMinor = adjustments.Where(a => a.Action is "discount" or "comp").Sum(a => a.AmountMinor);
        long netRevenueMinor = Math.Max(0, grossRevenueMinor - discountMinor);

        // 3. Kapanan Adisyonlar
        var closedChecks = await salesDb.Checks.AsNoTracking()
            .Where(c => c.FirmId == firmId &&
                        (branchId == null || c.BranchId == branchId) &&
                        c.Status == "closed" &&
                        c.ClosedAt >= startUtc && c.ClosedAt < endUtc)
            .ToListAsync(ct);

        int completedChecksCount = closedChecks.Count;
        long averageCheckMinor = completedChecksCount > 0 ? (grossRevenueMinor / completedChecksCount) : 0;

        // 4. Açık Adisyonlar ve Bekleyen Bakiye
        var openChecks = await salesDb.Checks.AsNoTracking()
            .Where(c => c.FirmId == firmId &&
                        (branchId == null || c.BranchId == branchId) &&
                        c.Status == "open")
            .ToListAsync(ct);

        var openCheckIds = openChecks.Select(c => c.Id).ToHashSet();
        var openOrders = await salesDb.Orders.AsNoTracking()
            .Where(o => o.FirmId == firmId &&
                        (branchId == null || o.BranchId == branchId) &&
                        openCheckIds.Contains(o.CheckId))
            .Include(o => o.PaymentAttempts)
            .ToListAsync(ct);

        long openChecksBalanceMinor = 0;
        foreach (var order in openOrders)
        {
            var settledOnOrder = order.PaymentAttempts
                .Where(p => p.Status == "succeeded")
                .Sum(p => p.AmountMinor);
            openChecksBalanceMinor += Math.Max(0, order.TotalMinor - settledOnOrder);
        }

        // 5. Siparişler ve Ürün Satışları
        var ordersInRange = await salesDb.Orders.AsNoTracking()
            .Where(o => o.FirmId == firmId &&
                        (branchId == null || o.BranchId == branchId) &&
                        o.CreatedAt >= startUtc && o.CreatedAt < endUtc)
            .Include(o => o.Lines)
            .ToListAsync(ct);

        var allLines = ordersInRange.SelectMany(o => o.Lines).ToList();
        int totalItemsSold = allLines.Sum(l => l.Quantity);

        // Katalog ürün ve kategori eşleştirmesi
        var catalogProducts = await catalogDb.Products.AsNoTracking()
            .Where(p => p.FirmId == firmId)
            .ToListAsync(ct);
        var productMap = catalogProducts.ToDictionary(p => p.Id, p => p);

        var topProducts = allLines
            .GroupBy(l => l.ProductId)
            .Select(g =>
            {
                var first = g.First();
                productMap.TryGetValue(g.Key, out var catProd);
                long productRevenue = g.Sum(l => l.LineTotalMinor);
                double pct = grossRevenueMinor > 0 ? Math.Round((double)productRevenue * 100.0 / grossRevenueMinor, 1) : 0;
                return new TopProductDto(
                    ProductId: g.Key,
                    ProductName: first.ProductName,
                    CategoryName: catProd?.CategoryName ?? "Genel",
                    Quantity: g.Sum(l => l.Quantity),
                    TotalRevenueMinor: productRevenue,
                    Percentage: pct
                );
            })
            .OrderByDescending(p => p.Quantity)
            .ThenByDescending(p => p.TotalRevenueMinor)
            .Take(10)
            .ToList();

        // 6. Ödeme Yöntemi Dağılımı
        var paymentBreakdown = new List<PaymentMethodBreakdown>
        {
            new("cash", "Nakit", payments.Count(p => p.Method == "cash"), cashRevenueMinor,
                grossRevenueMinor > 0 ? Math.Round((double)cashRevenueMinor * 100.0 / grossRevenueMinor, 1) : 0),
            new("card", "Kredi Kartı", payments.Count(p => p.Method == "card"), cardRevenueMinor,
                grossRevenueMinor > 0 ? Math.Round((double)cardRevenueMinor * 100.0 / grossRevenueMinor, 1) : 0),
        };

        // 7. Kanal Dağılımı (Masa vs Paket)
        int tableOrdersCount = ordersInRange.Count(o => o.Source == "waiter_web" || o.Source == "demo_service");
        int takeawayOrdersCount = ordersInRange.Count(o => o.Source == "test_pos" || o.Source == "takeaway");
        long tableOrdersRevenue = ordersInRange.Where(o => o.Source == "waiter_web" || o.Source == "demo_service").Sum(o => o.TotalMinor);
        long takeawayOrdersRevenue = ordersInRange.Where(o => o.Source == "test_pos" || o.Source == "takeaway").Sum(o => o.TotalMinor);
        long totalChannelRevenue = Math.Max(1, tableOrdersRevenue + takeawayOrdersRevenue);

        var channelBreakdown = new List<ChannelBreakdown>
        {
            new("table", "Masa Servis", tableOrdersCount, tableOrdersRevenue, Math.Round((double)tableOrdersRevenue * 100.0 / totalChannelRevenue, 1)),
            new("takeaway", "Paket / Hızlı Satış", takeawayOrdersCount, takeawayOrdersRevenue, Math.Round((double)takeawayOrdersRevenue * 100.0 / totalChannelRevenue, 1)),
        };

        // 8. Saatlik Satış Dağılımı (08:00 - 23:00 restoran çalışma saatleri veya 24 saat)
        var hourlyTrends = new List<HourlyTrendDto>();
        for (int h = 0; h < 24; h++)
        {
            var hourStr = $"{h:D2}:00";
            var inHour = payments.Where(p => p.CreatedAt.ToOffset(turkeyTz).Hour == h).ToList();
            hourlyTrends.Add(new HourlyTrendDto(
                Hour: hourStr,
                Count: inHour.Count,
                RevenueMinor: inHour.Sum(p => p.AmountMinor)
            ));
        }

        // 9. Şube Karşılaştırma
        var branchComparison = payments
            .GroupBy(p => p.BranchId)
            .Select(g =>
            {
                var bName = BranchNames.GetValueOrDefault(g.Key, g.Key);
                long bRevenue = g.Sum(p => p.AmountMinor);
                double pct = grossRevenueMinor > 0 ? Math.Round((double)bRevenue * 100.0 / grossRevenueMinor, 1) : 100.0;
                return new BranchSalesDto(
                    BranchId: g.Key,
                    BranchName: bName,
                    CheckCount: closedChecks.Count(c => c.BranchId == g.Key),
                    RevenueMinor: bRevenue,
                    Percentage: pct
                );
            })
            .OrderByDescending(b => b.RevenueMinor)
            .ToList();

        // Eğer henüz o şubede ödeme yoksa ama şube listelenmek isteniyorsa:
        if (branchId is not null && branchComparison.Count == 0)
        {
            branchComparison.Add(new BranchSalesDto(
                BranchId: branchId,
                BranchName: BranchNames.GetValueOrDefault(branchId, branchId),
                CheckCount: completedChecksCount,
                RevenueMinor: grossRevenueMinor,
                Percentage: 100.0
            ));
        }

        var summary = new SalesAnalyticsSummary(
            GrossRevenueMinor: grossRevenueMinor,
            NetRevenueMinor: netRevenueMinor,
            DiscountMinor: discountMinor,
            CashRevenueMinor: cashRevenueMinor,
            CardRevenueMinor: cardRevenueMinor,
            CompletedChecksCount: completedChecksCount,
            AverageCheckMinor: averageCheckMinor,
            OpenChecksCount: openChecks.Count,
            OpenChecksBalanceMinor: openChecksBalanceMinor,
            TotalItemsSold: totalItemsSold
        );

        var scope = new SalesAnalyticsScope(
            FirmId: firmId,
            BranchId: branchId,
            Range: selectedRange,
            From: startUtc,
            To: endUtc
        );

        return Results.Ok(new SalesAnalyticsResponse(
            Source: "postgres",
            Scope: scope,
            Summary: summary,
            PaymentBreakdown: paymentBreakdown,
            ChannelBreakdown: channelBreakdown,
            TopProducts: topProducts,
            HourlyTrends: hourlyTrends,
            BranchComparison: branchComparison
        ));
    }
}
