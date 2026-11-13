using Hipos.Api.Auth;
using Hipos.Api.Features;
using Hipos.Api.Realtime;
using Hipos.Api.Sales;
using Hipos.Api.Service;
using Hipos.Api.Sync;
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

        // 3. Masaya Göre Hesap Fişi Yazdır (Ara Bilgi Fişi veya Alman Hesabı Fişi)
        group.MapPost("/service/tables/{tableId}/print-bill", async (
            string firmId,
            string branchId,
            string tableId,
            HttpContext context,
            [FromServices] PrintingService printing,
            bool openCashDrawer = false,
            string paymentMethod = "NAKIT",
            CancellationToken ct = default) =>
        {
            var (_, denied) = Guard(context, firmId, branchId, requireOperate: true);
            if (denied is not null) return denied;

            TablePrintBillRequest? req = null;
            if (context.Request.HasJsonContentType() && (context.Request.ContentLength is null or > 0))
            {
                try
                {
                    req = await context.Request.ReadFromJsonAsync<TablePrintBillRequest>(ct);
                }
                catch
                {
                    req = null;
                }
            }

            var result = await printing.PrintCashierTableBillAsync(
                firmId,
                branchId,
                tableId,
                ct,
                openCashDrawer: req?.OpenCashDrawer ?? openCashDrawer,
                paymentMethod: string.IsNullOrWhiteSpace(req?.PaymentMethod) ? paymentMethod : req!.PaymentMethod!,
                paidItemsOverride: req?.PaidItems,
                isAlmanReceipt: req?.IsAlmanReceipt ?? false,
                checkIdsOverride: req?.CheckIds,
                paidAmountMinor: req?.PaidAmountMinor);

            if (!result.Success && string.Equals(result.Error, "Bu masada yazdırılacak adisyon bulunamadı.", StringComparison.Ordinal))
            {
                return Results.NotFound(new { success = false, message = result.Error });
            }

            return result.Success
                ? Results.Ok(new { success = true, tableId, result.Target, result.TransportUsed })
                : Results.BadRequest(new { success = false, result.Error });
        });

        // 3.1 Masanın Ödemesini Al, Kasa Fişi Bas ve Masayı Boşalt (Hesabı Kapat)
        group.MapPost("/service/tables/{tableId}/settle", async (
            string firmId,
            string branchId,
            string tableId,
            [FromServices] SalesDbContext salesDb,
            [FromServices] PaidCheckTableSettlement settlement,
            [FromServices] PrintingService printing,
            [FromServices] FeatureRuntimeCapabilities runtime,
            [FromServices] IRestaurantEventHub eventHub,
            [FromServices] SyncService sync,
            [FromServices] ILoggerFactory loggerFactory,
            HttpContext context,
            CancellationToken ct) =>
        {
            var (actorObj, denied) = Guard(context, firmId, branchId, requireOperate: true);
            if (denied is not null) return denied;

            SettleTableRequest? req = null;
            if (context.Request.HasJsonContentType() && (context.Request.ContentLength is null or > 0))
            {
                try
                {
                    req = await context.Request.ReadFromJsonAsync<SettleTableRequest>(ct);
                }
                catch
                {
                    req = null;
                }
            }

            var rawMethod = (req?.PaymentMethod ?? context.Request.Query["paymentMethod"].FirstOrDefault() ?? "NAKIT").Trim();
            var upperMethod = rawMethod.ToUpperInvariant();
            var (dbMethod, displayMethod, shouldOpenDrawer) = upperMethod switch
            {
                "KART" or "CARD" or "KREDI_KARTI" or "KREDİ KARTI" => ("card", "KREDI KARTI", false),
                "YEMEK" or "YEMEK_KARTI" or "MEAL" => ("meal", "YEMEK KARTI", false),
                "HAVALE" or "TRANSFER" or "EFT" => ("transfer", "HAVALE / EFT", false),
                "NAKIT" or "NAKİT" or "CASH" => ("cash", "NAKIT", true),
                _ => upperMethod.Contains("KART")
                    ? ("card", "KREDI KARTI", false)
                    : ("cash", "NAKIT", true)
            };

            var now = DateTimeOffset.UtcNow;
            var actor = actorObj!.Name.Length > 128 ? actorObj.Name[..128] : actorObj.Name;

            // 1. Önce veritabanı transaction'ını başlat ve masadaki TÜM açık adisyonları kapat
            await using var transaction = await salesDb.Database.BeginTransactionAsync(ct);

            string[] tableIds = [tableId];
            await using (var cmdTable = salesDb.Database.GetDbConnection().CreateCommand())
            {
                cmdTable.Transaction = transaction.GetDbTransaction();
                cmdTable.CommandText = """
                    SELECT tg.table_ids
                    FROM service.tables t
                    LEFT JOIN service.table_groups tg
                        ON tg.id = t.table_group_id AND tg.firm_id = t.firm_id AND tg.branch_id = t.branch_id AND tg.closed_at IS NULL
                    WHERE t.id = @table_id AND t.firm_id = @firm_id AND t.branch_id = @branch_id
                    """;
                var pTable = cmdTable.CreateParameter(); pTable.ParameterName = "table_id"; pTable.Value = tableId; cmdTable.Parameters.Add(pTable);
                var pFirm = cmdTable.CreateParameter(); pFirm.ParameterName = "firm_id"; pFirm.Value = firmId; cmdTable.Parameters.Add(pFirm);
                var pBranch = cmdTable.CreateParameter(); pBranch.ParameterName = "branch_id"; pBranch.Value = branchId; cmdTable.Parameters.Add(pBranch);
                await using var reader = await cmdTable.ExecuteReaderAsync(ct);
                if (await reader.ReadAsync(ct) && !reader.IsDBNull(0))
                {
                    tableIds = (string[])reader.GetValue(0);
                }
            }

            var checks = await salesDb.Checks.FromSqlInterpolated($"""
                SELECT * FROM sales.checks
                WHERE firm_id = {firmId} AND branch_id = {branchId} AND status = 'open'
                  AND table_id IS NOT NULL AND table_id = ANY({tableIds})
                ORDER BY created_at, id
                FOR UPDATE
                """).ToListAsync(ct);

            if (checks.Count == 0)
            {
                return Results.NotFound(new { success = false, message = "Bu masada açık bir adisyon bulunamadı." });
            }

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

            var openCheckIds = checks.Select(c => c.Id).ToArray();
            var orders = await salesDb.Orders.FromSqlInterpolated($"""
                SELECT * FROM sales.orders
                WHERE firm_id = {firmId} AND branch_id = {branchId} AND check_id = ANY({openCheckIds})
                ORDER BY check_id, created_at, id
                FOR UPDATE
                """).ToListAsync(ct);

            foreach (var order in orders)
            {
                await salesDb.Entry(order).Collection(o => o.PaymentAttempts).LoadAsync(ct);
            }

            var adjustments = await salesDb.CheckAdjustments.AsNoTracking()
                .Where(row => openCheckIds.Contains(row.CheckId) && row.FirmId == firmId && row.BranchId == branchId)
                .ToListAsync(ct);

            var payableByOrder = new Dictionary<Guid, long>();
            foreach (var check in checks)
            {
                var checkOrders = orders.Where(o => o.CheckId == check.Id).ToArray();
                var checkAdjs = adjustments.Where(a => a.CheckId == check.Id).ToArray();
                foreach (var kv in PaymentSimulator.CalculatePayableOrderTotals(checkOrders, checkAdjs))
                {
                    payableByOrder[kv.Key] = kv.Value;
                }
            }

            var attemptsToPost = new List<PaymentAttemptRow>();
            foreach (var order in orders)
            {
                var paidMinor = order.PaymentAttempts.Where(row => row.Status == "succeeded").Sum(row => row.AmountMinor);
                var payableMinor = payableByOrder.GetValueOrDefault(order.Id, order.TotalMinor);
                var remainingMinor = Math.Max(0, payableMinor - paidMinor);
                if (remainingMinor <= 0)
                {
                    if (order.PaymentStatus != "paid")
                    {
                        order.PaymentStatus = "paid";
                        order.Version++;
                    }
                    continue;
                }

                order.PaymentStatus = "paid";
                order.Version++;
                var attempt = new PaymentAttemptRow
                {
                    Id = Guid.NewGuid(),
                    CheckId = order.CheckId,
                    FirmId = firmId,
                    BranchId = branchId,
                    OrderId = order.Id,
                    AmountMinor = remainingMinor,
                    Currency = "TRY",
                    Method = dbMethod,
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
                salesDb.Audit.Add(new SalesOrderAuditRow
                {
                    OrderId = order.Id,
                    FirmId = firmId,
                    BranchId = branchId,
                    Actor = actor,
                    Action = "payment_started",
                    Version = order.Version,
                    OccurredAt = now
                });
                attemptsToPost.Add(attempt);
            }

            foreach (var check in checks)
            {
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
            }

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

            if (runtime.InventoryReady)
            {
                foreach (var closedCheckId in openCheckIds)
                {
                    await PaymentSimulator.DepleteInventoryForCheckAsync(
                        salesDb.Database.GetDbConnection(),
                        transaction.GetDbTransaction(),
                        closedCheckId, firmId, branchId, actor, now, ct);
                }
            }

            await settlement.ReleaseAfterPaymentAsync(tableId, firmId, branchId, actor, now, ct);
            await transaction.CommitAsync(ct);

            // 2. Commit sonrasında sync kuyruğu, SSE bildirimi ve fiş basımı
            foreach (var attempt in attemptsToPost)
            {
                await sync.TryEnqueueAsync(
                    firmId,
                    branchId,
                    aggregateType: "check",
                    aggregateId: attempt.CheckId.ToString(),
                    eventType: "payment.recorded",
                    payload: new
                    {
                        checkId = attempt.CheckId,
                        orderId = attempt.OrderId,
                        attemptId = attempt.Id,
                        amountMinor = attempt.AmountMinor,
                        method = attempt.Method,
                        status = attempt.Status,
                        checkStatus = "closed",
                        paymentStatus = "paid",
                        occurredAt = now,
                    },
                    idempotencyKey: $"payment.recorded:{attempt.Id}:v{attempt.Version}",
                    cancellationToken: ct);
            }

            foreach (var closedCheckId in openCheckIds)
            {
                eventHub.Publish("check.closed", firmId, branchId, new { checkId = closedCheckId, tableId });
                eventHub.Publish("inventory.stock_updated", firmId, branchId, new { checkId = closedCheckId, timestamp = now });
            }
            eventHub.Publish("payment.settled", firmId, branchId, new { checkId = checks[0].Id, checkIds = openCheckIds, tableId, method = displayMethod });
            eventHub.Publish("table.updated", firmId, branchId, new { tableId, status = "vacant" });

            PrintResult? printResult = null;
            try
            {
                printResult = await printing.PrintCashierTableBillAsync(
                    firmId,
                    branchId,
                    tableId,
                    ct,
                    openCashDrawer: shouldOpenDrawer,
                    paymentMethod: displayMethod,
                    checkIdsOverride: openCheckIds);
            }
            catch (Exception ex)
            {
                loggerFactory.CreateLogger("Hipos.Api.Printing.Settle").LogWarning(
                    ex, "Masa kapatma sonrası kasa fişi basılamadı ({FirmId}/{BranchId}/{TableId})", firmId, branchId, tableId);
            }

            return Results.Ok(new
            {
                success = true,
                checkId = checks[0].Id,
                checkIds = openCheckIds,
                tableId,
                paymentMethod = displayMethod,
                printed = printResult?.Success ?? false,
                transportUsed = printResult?.TransportUsed ?? "None",
                message = $"Hesap başarıyla kapatıldı ({displayMethod}), fiş basıldı ve masa boşaltıldı."
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

        // 4.2 Manuel Para Çekmecesi Açma Tetikleyicisi (RJ11 Kick Pulse: ESC p 0 25 250)
        group.MapPost("/printing/open-drawer", async (
            string firmId,
            string branchId,
            HttpContext context,
            [FromServices] PrintingService printing,
            CancellationToken ct) =>
        {
            var (actor, denied) = Guard(context, firmId, branchId, requireOperate: true);
            if (denied is not null) return denied;

            var result = await printing.OpenCashDrawerAsync(firmId, branchId, actor?.Name ?? "operator", ct);
            return result.Success
                ? Results.Ok(new { success = true, target = result.Target, transportUsed = result.TransportUsed })
                : Results.BadRequest(new { success = false, result.Target, result.TransportUsed, result.Error });
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
