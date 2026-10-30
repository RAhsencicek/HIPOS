using Hipos.Api.Sales;
using Hipos.Api.Service;
using Microsoft.EntityFrameworkCore;

namespace Hipos.Api.Printing;

public static class PrintingEndpoints
{
    public static void MapPrintingEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/v1/firms/{firmId}/branches/{branchId}");

        // 1. Mutfak Fişi Yazdır (Sipariş Bazlı)
        group.MapPost("/sales/orders/{orderId:guid}/print-kitchen", async (
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

        // 3. Masaya Göre Hesap Fişi Yazdır
        group.MapPost("/service/tables/{tableId}/print-bill", async (
            string firmId,
            string branchId,
            string tableId,
            ServiceDbContext serviceDb,
            PrintingService printing,
            bool openCashDrawer = false,
            string paymentMethod = "NAKIT",
            CancellationToken ct = default) =>
        {
            var assignment = await serviceDb.Assignments
                .AsNoTracking()
                .FirstOrDefaultAsync(row => row.FirmId == firmId && row.BranchId == branchId &&
                    row.TableId == tableId && row.ClosedAt == null, ct);

            if (assignment is null)
            {
                return Results.NotFound(new { success = false, message = "Bu masada açık bir adisyon bulunamadı." });
            }

            var result = await printing.PrintCashierBillAsync(firmId, branchId, assignment.CheckId, ct, openCashDrawer, paymentMethod);
            return result.Success
                ? Results.Ok(new { success = true, checkId = assignment.CheckId, result.Target, result.TransportUsed })
                : Results.BadRequest(new { success = false, result.Error });
        });

        // 4. Test Baskı Ucu (Masa başı veya kurulum testi)
        group.MapPost("/printing/test", async (
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
