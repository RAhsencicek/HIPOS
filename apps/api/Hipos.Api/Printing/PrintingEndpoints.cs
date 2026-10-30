using Hipos.Api.Features;
using Hipos.Api.Sales;
using Hipos.Api.Service;
using Microsoft.EntityFrameworkCore;

namespace Hipos.Api.Printing;

public static class PrintingEndpoints
{
    public static void MapPrintingEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/v1/firms/{firmId}/branches/{branchId}");

        // 1. Mutfak Fişi Yazdır (Sipariş Bazlı - Hem GET hem POST destekler)
        group.MapMethods("/sales/orders/{orderId:guid}/print-kitchen", ["GET", "POST"], async (
            string firmId,
            string branchId,
            Guid orderId,
            PrintingService printing,
            CancellationToken ct) =>
        {
            var result = await printing.PrintKitchenOrderAsync(firmId, branchId, orderId, ct);
            return result.Success
                ? Results.Ok(new { success = true, result.Target, result.TransportUsed })
                : Results.BadRequest(new { success = false, result.Error });
        });

        // 2. Kasa / Adisyon Fişi Yazdır (Check Bazlı)
        group.MapPost("/sales/checks/{checkId:guid}/print-bill", async (
            string firmId,
            string branchId,
            Guid checkId,
            PrintingService printing,
            bool openCashDrawer = false,
            string paymentMethod = "NAKIT",
            CancellationToken ct = default) =>
        {
            var result = await printing.PrintCashierBillAsync(firmId, branchId, checkId, ct, openCashDrawer, paymentMethod);
            return result.Success
                ? Results.Ok(new { success = true, result.Target, result.TransportUsed })
                : Results.BadRequest(new { success = false, result.Error });
        });

        // 3. Masaya Göre Hesap Fişi Yazdır (Ara Bilgi Fişi - Masayı Açık Bırakır)
        group.MapPost("/service/tables/{tableId}/print-bill", async (
            string firmId,
            string branchId,
            string tableId,
            SalesDbContext salesDb,
            PrintingService printing,
            bool openCashDrawer = false,
            string paymentMethod = "NAKIT",
            CancellationToken ct = default) =>
        {
            var check = await salesDb.Checks
                .AsNoTracking()
                .FirstOrDefaultAsync(row => row.FirmId == firmId && row.BranchId == branchId &&
                    row.TableId == tableId && row.Status == "open", ct);

            if (check is null)
            {
                return Results.NotFound(new { success = false, message = "Bu masada açık bir adisyon bulunamadı." });
            }

            var result = await printing.PrintCashierBillAsync(firmId, branchId, check.Id, ct, openCashDrawer, paymentMethod);
            return result.Success
                ? Results.Ok(new { success = true, checkId = check.Id, result.Target, result.TransportUsed })
                : Results.BadRequest(new { success = false, result.Error });
        });

        // 3.1 Masanın Ödemesini Al, Kasa Fişi Bas ve Masayı Boşalt (Hesabı Kapat)
        group.MapPost("/service/tables/{tableId}/settle", async (
            string firmId,
            string branchId,
            string tableId,
            SettleTableRequest? req,
            SalesDbContext salesDb,
            PaidCheckTableSettlement settlement,
            PrintingService printing,
            HttpContext context,
            CancellationToken ct) =>
        {
            var paymentMethod = (req?.PaymentMethod ?? context.Request.Query["paymentMethod"].FirstOrDefault() ?? "NAKIT").ToUpperInvariant();

            var check = await salesDb.Checks
                .FirstOrDefaultAsync(row => row.FirmId == firmId && row.BranchId == branchId &&
                    row.TableId == tableId && row.Status == "open", ct);

            if (check is null)
            {
                return Results.NotFound(new { success = false, message = "Bu masada açık bir adisyon bulunamadı." });
            }

            var checkId = check.Id;
            var now = DateTimeOffset.UtcNow;
            var actor = DemoAccess.Resolve(context)?.Name ?? "pos-single";

            // 1. Kasa fişi bas ve nakit ise para çekmecesini aç
            PrintResult? printResult = null;
            try
            {
                printResult = await printing.PrintCashierBillAsync(firmId, branchId, checkId, ct,
                    openCashDrawer: paymentMethod == "NAKIT",
                    paymentMethod: paymentMethod);
            }
            catch
            {
                // Fiş basılamasa bile hesap kapatma işlemi devam etmeli
            }

            // 2. Satış ve servis şemalarında transaction ile adisyonu ve siparişleri kapat, masayı boşa düşür
            await using var transaction = await salesDb.Database.BeginTransactionAsync(ct);

            var orders = await salesDb.Orders
                .Include(o => o.PaymentAttempts)
                .Where(row => row.CheckId == checkId && row.FirmId == firmId && row.BranchId == branchId)
                .ToListAsync(ct);

            foreach (var order in orders)
            {
                order.PaymentStatus = "paid";
                order.Version++;
                var attempt = new PaymentAttemptRow
                {
                    Id = Guid.NewGuid(),
                    CheckId = checkId,
                    FirmId = firmId,
                    BranchId = branchId,
                    OrderId = order.Id,
                    AmountMinor = order.TotalMinor,
                    Currency = "TRY",
                    Method = paymentMethod == "NAKIT" ? "cash" : "card",
                    Status = "succeeded",
                    RequestedOutcome = "succeeded",
                    Version = 1,
                    Actor = actor,
                    CreatedAt = now,
                    UpdatedAt = now
                };
                salesDb.PaymentAttempts.Add(attempt);
                salesDb.PaymentAudit.Add(new PaymentAttemptAuditRow
                {
                    AttemptId = attempt.Id,
                    OrderId = order.Id,
                    FirmId = firmId,
                    BranchId = branchId,
                    Actor = actor,
                    Action = "succeeded",
                    Status = "succeeded",
                    Version = 1,
                    OccurredAt = now
                });
            }

            check.Status = "closed";
            check.ClosedAt = now;
            check.Version++;
            salesDb.CheckAudit.Add(new SalesCheckAuditRow
            {
                CheckId = check.Id,
                FirmId = firmId,
                BranchId = branchId,
                Actor = actor,
                Action = "payment_completed_check_closed",
                Version = check.Version,
                OccurredAt = now,
            });
            await salesDb.SaveChangesAsync(ct);

            await settlement.ReleaseAfterPaymentAsync(tableId, firmId, branchId, actor, now, ct);
            await transaction.CommitAsync(ct);

            return Results.Ok(new
            {
                success = true,
                checkId,
                tableId,
                paymentMethod,
                printed = printResult?.Success ?? false,
                transportUsed = printResult?.TransportUsed ?? "None",
                message = $"Hesap başarıyla kapatıldı ({paymentMethod}), fiş basıldı ve masa boşaltıldı."
            });
        });

        // 4. Test Baskı Ucu (Masa başı veya kurulum testi - Hem GET hem POST destekler)
        group.MapMethods("/printing/test", ["GET", "POST"], async (
            string firmId,
            string branchId,
            string? target,
            PrintingService printing,
            CancellationToken ct) =>
        {
            var targetDevice = target ?? "kitchen";
            var result = await printing.TestPrintAsync(targetDevice, ct);
            return Results.Ok(new { success = result.Success, target = targetDevice, result.TransportUsed, result.Error });
        });

        // 5. Yazıcı Yapılandırması (Ağ IP'lerini dinamik ayarlama)
        group.MapGet("/printing/config", (PrintingService printing) =>
            Results.Ok(printing.GetConfig()));

        group.MapPost("/printing/config", (UpdatePrinterConfigRequest request, PrintingService printing) =>
        {
            printing.UpdateConfig(request);
            return Results.Ok(printing.GetConfig());
        });
    }
}
