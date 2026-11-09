using Hipos.Api.Features;
using Hipos.Api.Realtime;
using Hipos.Api.Sales;
using Hipos.Api.Service;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

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
            bool? isReprint,
            [FromServices] PrintingService printing,
            CancellationToken ct) =>
        {
            var result = await printing.PrintKitchenOrderAsync(firmId, branchId, orderId, isReprint ?? false, ct);
            return result.Success
                ? Results.Ok(new { success = true, result.Target, result.TransportUsed, isReprint = isReprint ?? false })
                : Results.BadRequest(new { success = false, result.Error });
        });

        // 1.1 Masaya Göre Mutfak Fişi Yazdır / Tekrar Bas (Hem GET hem POST destekler)
        group.MapMethods("/service/tables/{tableId}/print-kitchen", ["GET", "POST"], async (
            string firmId,
            string branchId,
            string tableId,
            bool? isReprint,
            [FromServices] PrintingService printing,
            CancellationToken ct) =>
        {
            var result = await printing.PrintKitchenTableAsync(firmId, branchId, tableId, isReprint ?? false, ct);
            return result.Success
                ? Results.Ok(new { success = true, result.Target, result.TransportUsed, isReprint = isReprint ?? false })
                : Results.BadRequest(new { success = false, result.Error });
        });

        // 2. Kasa / Adisyon Fişi Yazdır (Check Bazlı)
        group.MapPost("/sales/checks/{checkId:guid}/print-bill", async (
            string firmId,
            string branchId,
            Guid checkId,
            [FromServices] PrintingService printing,
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
            [FromServices] SalesDbContext salesDb,
            [FromServices] PrintingService printing,
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
            [FromServices] SalesDbContext salesDb,
            [FromServices] PaidCheckTableSettlement settlement,
            [FromServices] PrintingService printing,
            [FromServices] FeatureRuntimeCapabilities runtime,
            [FromServices] IRestaurantEventHub eventHub,
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

            PaymentSimulator.CashShiftLink? cashShift = null;
            if (runtime.CashReady && (req?.PostToCash ?? true))
            {
                var shifts = await PaymentSimulator.LockOpenCashShiftAsync(
                    salesDb.Database.GetDbConnection(), firmId, branchId, req?.RegisterId,
                    transaction.GetDbTransaction(), ct);
                if (shifts.Count > 0)
                {
                    cashShift = shifts[0];
                }
            }

            var orders = await salesDb.Orders
                .Include(o => o.PaymentAttempts)
                .Where(row => row.CheckId == checkId && row.FirmId == firmId && row.BranchId == branchId)
                .ToListAsync(ct);

            var attemptsToPost = new List<PaymentAttemptRow>();
            foreach (var order in orders)
            {
                var paidMinor = order.PaymentAttempts.Where(row => row.Status == "succeeded").Sum(row => row.AmountMinor);
                var remainingMinor = Math.Max(0, order.TotalMinor - paidMinor);
                if (remainingMinor <= 0) continue;

                order.PaymentStatus = "paid";
                order.Version++;
                var attempt = new PaymentAttemptRow
                {
                    Id = Guid.NewGuid(),
                    CheckId = checkId,
                    FirmId = firmId,
                    BranchId = branchId,
                    OrderId = order.Id,
                    AmountMinor = remainingMinor,
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
                attemptsToPost.Add(attempt);
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

            if (cashShift is not null)
            {
                foreach (var attempt in attemptsToPost)
                {
                    await PaymentSimulator.AddCashMovementAsync(
                        salesDb.Database.GetDbConnection(), cashShift, attempt, actor, now,
                        transaction.GetDbTransaction(), ct);
                }
            }

            await settlement.ReleaseAfterPaymentAsync(tableId, firmId, branchId, actor, now, ct);
            await transaction.CommitAsync(ct);

            eventHub.Publish("check.closed", firmId, branchId, new { checkId, tableId });
            eventHub.Publish("payment.settled", firmId, branchId, new { checkId, tableId, method = paymentMethod });
            eventHub.Publish("table.updated", firmId, branchId, new { tableId, status = "vacant" });

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
            [FromServices] PrintingService printing,
            CancellationToken ct) =>
        {
            var targetDevice = target ?? "kitchen";
            var result = await printing.TestPrintAsync(targetDevice, ct);
            return Results.Ok(new { success = result.Success, target = targetDevice, result.TransportUsed, result.Error });
        });

        // 4.1 Ağ Yazıcısı Bağlantı Kontrolü (Hızlı TCP Soket Ping)
        group.MapGet("/printing/check-connection", async (
            string ip,
            int? port,
            CancellationToken ct) =>
        {
            var targetPort = port is > 0 ? port.Value : 9100;
            var (reachable, latencyMs, error) = await PrintingService.CheckConnectionAsync(ip, targetPort, ct);
            return Results.Ok(new
            {
                reachable,
                latencyMs,
                ip,
                port = targetPort,
                error
            });
        });

        // 5. Yazıcı Yapılandırması (Ağ IP'lerini dinamik ayarlama)
        group.MapGet("/printing/config", ([FromServices] PrintingService printing) =>
            Results.Ok(printing.GetConfig()));

        group.MapPost("/printing/config", (UpdatePrinterConfigRequest request, [FromServices] PrintingService printing) =>
        {
            printing.UpdateConfig(request);
            return Results.Ok(printing.GetConfig());
        });
    }
}
