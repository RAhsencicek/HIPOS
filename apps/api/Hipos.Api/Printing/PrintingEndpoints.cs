using Hipos.Api.Auth;
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
            HttpContext context,
            [FromServices] PrintingService printing,
            CancellationToken ct) =>
        {
            var (_, denied) = Guard(context, firmId, branchId, requireOperate: true);
            if (denied is not null) return denied;

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
            HttpContext context,
            [FromServices] PrintingService printing,
            CancellationToken ct) =>
        {
            var (_, denied) = Guard(context, firmId, branchId, requireOperate: true);
            if (denied is not null) return denied;

            var result = await printing.PrintKitchenTableAsync(firmId, branchId, tableId, isReprint ?? false, ct);
            return result.Success
                ? Results.Ok(new { success = true, result.Target, result.TransportUsed, isReprint = isReprint ?? false })
                : Results.BadRequest(new { success = false, result.Error });
        });

        // 1.2 Adisyona Göre Mutfak Fişi Yazdır / Tekrar Bas (Hızlı Satış & Masalar İçin)
        group.MapMethods("/sales/checks/{checkId:guid}/print-kitchen", ["GET", "POST"], async (
            string firmId,
            string branchId,
            Guid checkId,
            bool? isReprint,
            HttpContext context,
            [FromServices] PrintingService printing,
            CancellationToken ct) =>
        {
            var (_, denied) = Guard(context, firmId, branchId, requireOperate: true);
            if (denied is not null) return denied;

            var result = await printing.PrintKitchenCheckAsync(firmId, branchId, checkId, isReprint ?? false, ct);
            return result.Success
                ? Results.Ok(new { success = true, result.Target, result.TransportUsed, isReprint = isReprint ?? false })
                : Results.BadRequest(new { success = false, result.Error });
        });

        // 2. Kasa / Adisyon Fişi Yazdır (Check Bazlı)
        group.MapPost("/sales/checks/{checkId:guid}/print-bill", async (
            string firmId,
            string branchId,
            Guid checkId,
            HttpContext context,
            [FromServices] PrintingService printing,
            bool openCashDrawer = false,
            string paymentMethod = "NAKIT",
            CancellationToken ct = default) =>
        {
            var (_, denied) = Guard(context, firmId, branchId, requireOperate: true);
            if (denied is not null) return denied;

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
            HttpContext context,
            [FromServices] SalesDbContext salesDb,
            [FromServices] PrintingService printing,
            bool openCashDrawer = false,
            string paymentMethod = "NAKIT",
            CancellationToken ct = default) =>
        {
            var (_, denied) = Guard(context, firmId, branchId, requireOperate: true);
            if (denied is not null) return denied;

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
            var (actorObj, denied) = Guard(context, firmId, branchId, requireOperate: true);
            if (denied is not null) return denied;

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
            var actor = actorObj!.Name;

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
            HttpContext context,
            [FromServices] PrintingService printing,
            CancellationToken ct) =>
        {
            var (_, denied) = Guard(context, firmId, branchId, requireOperate: true);
            if (denied is not null) return denied;

            var targetDevice = target ?? "kitchen";
            var result = await printing.TestPrintAsync(targetDevice, firmId, branchId, ct);
            return Results.Ok(new { success = result.Success, target = targetDevice, result.TransportUsed, result.Error });
        });

        // 4.1 Ağ Yazıcısı Bağlantı Kontrolü (Hızlı TCP Soket Ping)
        group.MapGet("/printing/check-connection", async (
            string firmId,
            string branchId,
            string ip,
            int? port,
            HttpContext context,
            [FromServices] BridgePresenceRegistry bridgeRegistry,
            CancellationToken ct) =>
        {
            var (_, denied) = Guard(context, firmId, branchId, requireOperate: true);
            if (denied is not null) return denied;

            var targetPort = port is > 0 ? port.Value : 9100;
            var (reachable, latencyMs, error) = await PrintingService.CheckConnectionAsync(ip, targetPort, ct);
            var bridgeConnected = bridgeRegistry.HasActiveStream(firmId, branchId);
            return Results.Ok(new
            {
                reachable,
                latencyMs,
                ip,
                port = targetPort,
                error = !reachable && bridgeConnected
                    ? "Bulut sunucu yerel yazıcı IP'sine doğrudan erişemez; ancak şube Yazıcı Köprüsü çevrimiçi. 'Test Fişi Gönder' ile doğrulayabilirsiniz."
                    : error,
                bridgeConnected
            });
        });

        // 5. Şubeye Özel Yazıcı Yapılandırması (Ağ IP + USB + Bar İstasyonu + Teslimat Modu)
        group.MapGet("/printing/config", async (
            string firmId,
            string branchId,
            HttpContext context,
            [FromServices] PrintingService printing,
            CancellationToken ct) =>
        {
            var (_, denied) = Guard(context, firmId, branchId, allowBridge: true);
            if (denied is not null) return denied;

            return Results.Ok(await printing.GetConfigAsync(firmId, branchId, ct));
        });

        group.MapPost("/printing/config", async (
            string firmId,
            string branchId,
            UpdatePrinterConfigRequest request,
            HttpContext context,
            [FromServices] PrintingService printing,
            [FromServices] IRestaurantEventHub eventHub,
            CancellationToken ct) =>
        {
            var (actor, denied) = Guard(context, firmId, branchId, requireManage: true, allowCashierManage: true);
            if (denied is not null) return denied;

            var updated = await printing.UpdateConfigAsync(firmId, branchId, request, actor?.Name ?? "operator", ct);
            eventHub.Publish("printer.config.updated", firmId, branchId, updated);
            return Results.Ok(updated);
        });

        // 5.1 Şube Print Bridge Canlı Durumu ve Algılanan Yerel USB/OS Yazıcıları
        group.MapGet("/printing/bridge-status", (
            string firmId,
            string branchId,
            HttpContext context,
            [FromServices] BridgePresenceRegistry bridgeRegistry) =>
        {
            var (_, denied) = Guard(context, firmId, branchId, allowBridge: true);
            if (denied is not null) return denied;

            return Results.Ok(bridgeRegistry.GetStatus(firmId, branchId));
        });

        // 5.2 Print Bridge İstemcisinden Kalp Atışı & Yerel Yazıcı Envanteri Bildirimi
        group.MapPost("/printing/bridge-heartbeat", (
            string firmId,
            string branchId,
            BridgeHeartbeatRequest heartbeat,
            HttpContext context,
            [FromServices] BridgePresenceRegistry bridgeRegistry) =>
        {
            var (actor, denied) = Guard(context, firmId, branchId, allowBridge: true);
            if (denied is not null) return denied;

            if (!actor!.IsBridge && !actor.CanManage)
            {
                return Results.Json(
                    new { code = "FORBIDDEN", message = "Bu kalp atışı ucu yalnızca Yazıcı Köprüsü veya yönetici içindir." },
                    statusCode: 403);
            }

            var node = bridgeRegistry.RecordHeartbeat(firmId, branchId, heartbeat);
            return Results.Ok(new { ok = true, node });
        });

        // 6. Yerel Yazıcı Köprüsü (Print Bridge) İçin Uzun Ömürlü Şube Yetkili Token Üretme
        group.MapPost("/printing/bridge-token", (
            string firmId,
            string branchId,
            HttpContext context,
            [FromServices] AuthTokenService tokenService) =>
        {
            var (actor, denied) = Guard(context, firmId, branchId, requireManage: true);
            if (denied is not null) return denied;

            var bridgeUserId = Guid.TryParse(actor?.UserId, out var parsed) ? parsed : Guid.NewGuid();
            var (token, expiresAt) = tokenService.GenerateToken(
                bridgeUserId,
                $"bridge-{branchId}@hipos.local",
                $"Print Bridge ({branchId})",
                "bridge",
                firmId,
                branchId,
                TimeSpan.FromDays(365),
                [$"{firmId}:{branchId}"],
                false);

            return Results.Ok(new
            {
                token,
                expiresAt,
                firmId,
                branchId,
                role = "bridge"
            });
        });

        // 7. Şube Bilgisayarlarına Tek Tıkla İndirilebilen Bağımsız Print Bridge Betiği (sıfır bağımlılık)
        app.MapGet("/api/v1/printing/bridge-script", () =>
        {
            var assembly = typeof(PrintingEndpoints).Assembly;
            using var stream = assembly.GetManifestResourceStream("Hipos.PrintBridge.mjs");
            if (stream is null)
            {
                return Results.NotFound(new { message = "Print Bridge betiği pakette bulunamadı." });
            }

            using var reader = new StreamReader(stream);
            var content = reader.ReadToEnd();
            return Results.Text(content, "application/javascript; charset=utf-8");
        });
    }

    private static (DemoActor? Actor, IResult? Denied) Guard(
        HttpContext context,
        string firmId,
        string branchId,
        bool requireOperate = false,
        bool requireManage = false,
        bool allowCashierManage = false,
        bool allowBridge = false)
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null)
        {
            return (null, Results.Json(
                new { code = "UNAUTHENTICATED", message = "Oturum gerekli." },
                statusCode: 401));
        }

        var canAccessBranch = allowBridge
            ? actor.CanAccessPrintBridge(firmId, branchId)
            : actor.CanRead(firmId, branchId);

        if (!canAccessBranch)
        {
            return (null, Results.Json(
                new { code = "UNAUTHORIZED_SCOPE", message = "Bu şube için yazdırma yetkiniz yok." },
                statusCode: 403));
        }

        var hasCashier = allowCashierManage &&
            ((actor.IsRealAuth && string.Equals(actor.Role, "cashier", StringComparison.OrdinalIgnoreCase)) ||
             (!actor.IsRealAuth && actor.CanOperate));

        if (requireManage && !actor.CanManage && !hasCashier)
        {
            return (null, Results.Json(
                new { code = "FORBIDDEN", message = "Bu yazıcı yapılandırma işlemi için yetkiniz yok." },
                statusCode: 403));
        }

        if (requireOperate && !actor.CanManage && !actor.CanOperate)
        {
            return (null, Results.Json(
                new { code = "FORBIDDEN", message = "Bu yazdırma veya hesap kapatma işlemi için yetkiniz yok." },
                statusCode: 403));
        }

        return (actor, null);
    }
}
