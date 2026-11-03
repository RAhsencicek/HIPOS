using Microsoft.EntityFrameworkCore;
using Hipos.Api.Cash;
using Hipos.Api.Inventory;
using Hipos.Api.Sales;
using Hipos.Api.Expenses;

namespace Hipos.Api.Overview;

public sealed record AcknowledgeAlertItemRequest(string AlertKey, string Category, string? Title);
public sealed record AcknowledgeAlertRequest(string? AlertKey, string? Category, string? Title, string? Note, List<AcknowledgeAlertItemRequest>? Items);
public sealed record ResetAlertRequest(string? AlertKey, bool? All);

public sealed record ActivityFeedItem(
    string Id,
    string Module,
    string Type,
    string Title,
    string Description,
    string Actor,
    string Severity,
    DateTimeOffset Timestamp,
    long? AmountMinor,
    string? BadgeText,
    string? ActionLink
);

public static class OverviewEndpoints
{
    public static void MapOverviewEndpoints(this WebApplication app, bool overviewReady)
    {
        var alertsGroup = app.MapGroup("/api/v1/firms/{firmId}/branches/{branchId}/overview/alerts");

        alertsGroup.MapGet("", async (
            string firmId,
            string branchId,
            OverviewDbContext db,
            CancellationToken ct) =>
        {
            if (!overviewReady) return Results.StatusCode(503);

            var items = await db.AlertAcknowledgments.AsNoTracking()
                .Where(r => r.FirmId == firmId && r.BranchId == branchId)
                .OrderByDescending(r => r.AcknowledgedAt)
                .Select(r => new
                {
                    alertKey = r.AlertKey,
                    category = r.Category,
                    title = r.Title,
                    actor = r.Actor,
                    note = r.Note,
                    acknowledgedAt = r.AcknowledgedAt
                })
                .ToListAsync(ct);

            return Results.Ok(new
            {
                source = "postgres",
                branchId,
                acknowledged = items
            });
        });

        alertsGroup.MapPost("/acknowledge", async (
            string firmId,
            string branchId,
            AcknowledgeAlertRequest req,
            HttpContext context,
            OverviewDbContext db,
            CancellationToken ct) =>
        {
            if (!overviewReady) return Results.StatusCode(503);

            var actor = context.Request.Headers["X-Demo-Actor"].FirstOrDefault() ?? "manager-single";
            var now = DateTimeOffset.UtcNow;

            var itemsToAck = new List<AlertAcknowledgmentRow>();

            if (req.Items != null && req.Items.Count > 0)
            {
                foreach (var item in req.Items)
                {
                    if (!string.IsNullOrWhiteSpace(item.AlertKey))
                    {
                        itemsToAck.Add(new AlertAcknowledgmentRow
                        {
                            FirmId = firmId,
                            BranchId = branchId,
                            AlertKey = item.AlertKey,
                            Category = item.Category ?? "general",
                            Title = item.Title ?? "",
                            Actor = actor,
                            AcknowledgedAt = now
                        });
                    }
                }
            }
            else if (!string.IsNullOrWhiteSpace(req.AlertKey))
            {
                itemsToAck.Add(new AlertAcknowledgmentRow
                {
                    FirmId = firmId,
                    BranchId = branchId,
                    AlertKey = req.AlertKey,
                    Category = req.Category ?? "general",
                    Title = req.Title ?? "",
                    Note = req.Note,
                    Actor = actor,
                    AcknowledgedAt = now
                });
            }

            if (itemsToAck.Count == 0)
            {
                return Results.BadRequest(new { error = "En az bir uyarı anahtarı (alertKey) belirtilmelidir." });
            }

            var keys = itemsToAck.Select(i => i.AlertKey).ToList();
            var existing = await db.AlertAcknowledgments
                .Where(r => r.FirmId == firmId && r.BranchId == branchId && keys.Contains(r.AlertKey))
                .ToListAsync(ct);

            foreach (var item in itemsToAck)
            {
                var match = existing.FirstOrDefault(e => e.AlertKey == item.AlertKey);
                if (match != null)
                {
                    match.Actor = actor;
                    match.AcknowledgedAt = now;
                    if (!string.IsNullOrEmpty(item.Title)) match.Title = item.Title;
                    if (!string.IsNullOrEmpty(item.Category)) match.Category = item.Category;
                    if (item.Note != null) match.Note = item.Note;
                }
                else
                {
                    db.AlertAcknowledgments.Add(item);
                }
            }

            await db.SaveChangesAsync(ct);
            return Results.Ok(new { success = true, acknowledgedCount = itemsToAck.Count });
        });

        alertsGroup.MapPost("/reset", async (
            string firmId,
            string branchId,
            ResetAlertRequest req,
            OverviewDbContext db,
            CancellationToken ct) =>
        {
            if (!overviewReady) return Results.StatusCode(503);

            if (req.All == true)
            {
                var all = await db.AlertAcknowledgments
                    .Where(r => r.FirmId == firmId && r.BranchId == branchId)
                    .ToListAsync(ct);
                db.AlertAcknowledgments.RemoveRange(all);
                await db.SaveChangesAsync(ct);
                return Results.Ok(new { success = true, removedCount = all.Count });
            }

            if (!string.IsNullOrWhiteSpace(req.AlertKey))
            {
                var target = await db.AlertAcknowledgments
                    .FirstOrDefaultAsync(r => r.FirmId == firmId && r.BranchId == branchId && r.AlertKey == req.AlertKey, ct);
                if (target != null)
                {
                    db.AlertAcknowledgments.Remove(target);
                    await db.SaveChangesAsync(ct);
                    return Results.Ok(new { success = true, removed = true });
                }
                return Results.Ok(new { success = true, removed = false });
            }

            return Results.BadRequest(new { error = "alertKey veya all: true belirtilmelidir." });
        });

        // ━━━━ AKTİVİTE VE SON İŞLEMLER AKIŞI (ACTIVITY FEED) ━━━━
        app.MapGet("/api/v1/firms/{firmId}/branches/{branchId}/overview/activities", async (
            string firmId,
            string branchId,
            string? category,
            string? search,
            int? limit,
            OverviewDbContext overviewDb,
            CashDbContext cashDb,
            InventoryDbContext inventoryDb,
            SalesDbContext salesDb,
            ExpenseDbContext expenseDb,
            CancellationToken ct) =>
        {
            var maxLimit = Math.Clamp(limit ?? 50, 1, 200);
            var list = new List<ActivityFeedItem>();

            // 1. Kasa Hareketleri
            if (string.IsNullOrEmpty(category) || category == "all" || category == "cash")
            {
                try
                {
                    var cashItems = await cashDb.Movements.AsNoTracking()
                        .Where(m => m.FirmId == firmId && m.BranchId == branchId)
                        .OrderByDescending(m => m.CreatedAt)
                        .Take(maxLimit)
                        .ToListAsync(ct);

                    foreach (var m in cashItems)
                    {
                        var isOut = m.Kind == "manual_out";
                        var isFloat = m.Kind == "opening_float";
                        var amountStr = isOut ? $"-₺{m.AmountMinor / 100:N0}" : isFloat ? $"₺{m.AmountMinor / 100:N0}" : $"+₺{m.AmountMinor / 100:N0}";
                        var title = isOut ? "Kasadan Nakit Çıkışı" : isFloat ? "Kasa Açılış Avansı" : "Kasaya Nakit Girişi";
                        list.Add(new ActivityFeedItem(
                            $"cash:{m.Id}",
                            "cash",
                            m.Kind,
                            title,
                            m.Description,
                            m.Actor,
                            isOut ? "warning" : "success",
                            m.CreatedAt,
                            m.AmountMinor,
                            amountStr,
                            "/admin/cash/movements"
                        ));
                    }
                }
                catch { /* ignore */ }
            }

            // 2. Stok & Mal Kabul Hareketleri
            if (string.IsNullOrEmpty(category) || category == "all" || category == "inventory")
            {
                try
                {
                    var invItems = await (from m in inventoryDb.Movements.AsNoTracking()
                                          join i in inventoryDb.Ingredients.AsNoTracking() on m.IngredientId equals i.Id
                                          where m.FirmId == firmId && m.BranchId == branchId
                                          orderby m.CreatedAt descending
                                          select new { m.Id, m.Kind, m.Delta, m.Unit, m.Description, m.Actor, m.CreatedAt, IngredientName = i.Name })
                                          .Take(maxLimit)
                                          .ToListAsync(ct);

                    foreach (var item in invItems)
                    {
                        string title;
                        string severity;
                        string badge;
                        string link = "/admin/inventory/movements";

                        switch (item.Kind)
                        {
                            case "receiving":
                                title = $"Mal Kabul: {item.IngredientName}";
                                severity = "success";
                                badge = $"+{item.Delta:G} {item.Unit}";
                                link = "/admin/inventory/receiving";
                                break;
                            case "waste_loss":
                                title = $"Zayi / Fire Kaydı: {item.IngredientName}";
                                severity = "warning";
                                badge = $"-{Math.Abs(item.Delta):G} {item.Unit}";
                                link = "/admin/inventory/waste";
                                break;
                            case "count_adjustment":
                                title = $"Sayım Düzeltmesi: {item.IngredientName}";
                                severity = "info";
                                badge = $"Fark: {item.Delta:+#;-#;0} {item.Unit}";
                                link = "/admin/inventory/counts";
                                break;
                            default:
                                title = $"Stok Hareketi: {item.IngredientName}";
                                severity = item.Delta > 0 ? "success" : "info";
                                badge = $"{item.Delta:+#;-#;0} {item.Unit}";
                                break;
                        }

                        list.Add(new ActivityFeedItem(
                            $"inv:{item.Id}",
                            "inventory",
                            item.Kind,
                            title,
                            string.IsNullOrWhiteSpace(item.Description) ? $"{item.IngredientName} stoğunda işlem yapıldı." : item.Description,
                            item.Actor,
                            severity,
                            item.CreatedAt,
                            null,
                            badge,
                            link
                        ));
                    }
                }
                catch { /* ignore */ }
            }

            // 3. Sipariş & Satış Kayıtları
            if (string.IsNullOrEmpty(category) || category == "all" || category == "sales")
            {
                try
                {
                    var orders = await salesDb.Orders.AsNoTracking()
                        .Where(o => o.FirmId == firmId && o.BranchId == branchId)
                        .OrderByDescending(o => o.CreatedAt)
                        .Take(maxLimit)
                        .Select(o => new { o.Id, o.Status, o.Source, o.TotalMinor, o.CreatedAt })
                        .ToListAsync(ct);

                    foreach (var ord in orders)
                    {
                        var shortId = ord.Id.ToString().Length >= 8 ? ord.Id.ToString()[..8] : ord.Id.ToString();
                        list.Add(new ActivityFeedItem(
                            $"order:{ord.Id}",
                            "sales",
                            "order_created",
                            $"Sipariş Kaydı (#{shortId})",
                            $"{ord.Source} üzerinden açılan sipariş",
                            "Kasa/POS",
                            "info",
                            ord.CreatedAt,
                            ord.TotalMinor,
                            $"₺{ord.TotalMinor / 100:N0}",
                            "/admin/sales/open"
                        ));
                    }
                }
                catch { /* ignore */ }
            }

            // 4. Gider Kayıtları
            if (string.IsNullOrEmpty(category) || category == "all" || category == "finance")
            {
                try
                {
                    var expenses = await expenseDb.Expenses.AsNoTracking()
                        .Where(e => e.FirmId == firmId && e.BranchId == branchId)
                        .OrderByDescending(e => e.CreatedAt)
                        .Take(maxLimit)
                        .Select(e => new { e.Id, e.Description, e.AmountMinor, e.Actor, e.CreatedAt })
                        .ToListAsync(ct);

                    foreach (var exp in expenses)
                    {
                        list.Add(new ActivityFeedItem(
                            $"expense:{exp.Id}",
                            "finance",
                            "expense_created",
                            $"Gider Kaydı: {exp.Description}",
                            exp.Description,
                            exp.Actor,
                            "warning",
                            exp.CreatedAt,
                            exp.AmountMinor,
                            $"-₺{exp.AmountMinor / 100:N0}",
                            "/admin/finance/expenses"
                        ));
                    }
                }
                catch { /* ignore */ }
            }

            // 5. Uyarı İnceleme ve Arşivleme
            if (string.IsNullOrEmpty(category) || category == "all" || category == "alerts")
            {
                try
                {
                    var acks = await overviewDb.AlertAcknowledgments.AsNoTracking()
                        .Where(a => a.FirmId == firmId && a.BranchId == branchId)
                        .OrderByDescending(a => a.AcknowledgedAt)
                        .Take(maxLimit)
                        .Select(a => new { a.Id, a.AlertKey, a.Title, a.Category, a.Actor, a.Note, a.AcknowledgedAt })
                        .ToListAsync(ct);

                    foreach (var ack in acks)
                    {
                        list.Add(new ActivityFeedItem(
                            $"ack:{ack.Id}",
                            "alerts",
                            "alert_acknowledged",
                            $"Uyarı İncelendi: {ack.Title}",
                            ack.Note ?? $"{ack.Category} kategorisindeki operasyon uyarısı incelendi ve arşivlendi.",
                            ack.Actor,
                            "success",
                            ack.AcknowledgedAt,
                            null,
                            "İncelendi",
                            "/admin/overview/alerts"
                        ));
                    }
                }
                catch { /* ignore */ }
            }

            // Arama filtresi (opsiyonel)
            var queryable = list.AsEnumerable();
            if (!string.IsNullOrWhiteSpace(search))
            {
                var s = search.Trim().ToLower();
                queryable = queryable.Where(x =>
                    x.Title.ToLower().Contains(s) ||
                    x.Description.ToLower().Contains(s) ||
                    x.Actor.ToLower().Contains(s) ||
                    x.Module.ToLower().Contains(s)
                );
            }

            var sorted = queryable
                .OrderByDescending(x => x.Timestamp)
                .Take(maxLimit)
                .ToList();

            return Results.Ok(new
            {
                source = "postgres",
                branchId,
                count = sorted.Count,
                totalFound = list.Count,
                items = sorted
            });
        });

        // ── Cash Profit Summary (Tüm Kasaların Toplam Kâr Oranı) ──
        var cashProfitGroup = app.MapGroup("/api/v1/firms/{firmId}");

        cashProfitGroup.MapGet("/branches/{branchId}/overview/cash-profit", async (
            string firmId,
            string branchId,
            CashDbContext cashDb,
            CancellationToken ct) =>
        {
            var registers = await cashDb.Registers.AsNoTracking()
                .Where(r => r.FirmId == firmId && r.BranchId == branchId && r.IsActive)
                .OrderBy(r => r.Code)
                .ToListAsync(ct);

            var movements = await cashDb.Movements.AsNoTracking()
                .Where(m => m.FirmId == firmId && m.BranchId == branchId)
                .ToListAsync(ct);

            var activeShifts = await cashDb.Shifts.AsNoTracking()
                .Where(s => s.FirmId == firmId && s.BranchId == branchId && s.Status == "open")
                .ToListAsync(ct);

            long totalInMinor = movements.Where(m => m.Kind == "manual_in").Sum(m => m.AmountMinor);
            long totalOutMinor = movements.Where(m => m.Kind == "manual_out").Sum(m => m.AmountMinor);
            long netProfitMinor = totalInMinor - totalOutMinor;

            double profitRate = totalInMinor > 0
                ? Math.Round(((double)netProfitMinor / totalInMinor) * 100.0, 1)
                : (totalOutMinor > 0 ? -100.0 : 0.0);

            var openShiftIds = activeShifts.Select(s => s.Id).ToHashSet();
            var openMovements = movements.Where(m => openShiftIds.Contains(m.ShiftId)).ToList();
            long openShiftInMinor = openMovements.Where(m => m.Kind == "manual_in").Sum(m => m.AmountMinor);
            long openShiftOutMinor = openMovements.Where(m => m.Kind == "manual_out").Sum(m => m.AmountMinor);
            long openShiftNetProfitMinor = openShiftInMinor - openShiftOutMinor;
            double openShiftProfitRate = openShiftInMinor > 0
                ? Math.Round(((double)openShiftNetProfitMinor / openShiftInMinor) * 100.0, 1)
                : (openShiftOutMinor > 0 ? -100.0 : 0.0);

            var registerDetails = registers.Select(r =>
            {
                var regMovements = movements.Where(m => m.RegisterId == r.Id).ToList();
                long regIn = regMovements.Where(m => m.Kind == "manual_in").Sum(m => m.AmountMinor);
                long regOut = regMovements.Where(m => m.Kind == "manual_out").Sum(m => m.AmountMinor);
                long regNet = regIn - regOut;
                double regProfitRate = regIn > 0
                    ? Math.Round(((double)regNet / regIn) * 100.0, 1)
                    : (regOut > 0 ? -100.0 : 0.0);

                bool hasOpen = activeShifts.Any(s => s.RegisterId == r.Id);

                return new
                {
                    id = r.Id.ToString(),
                    code = r.Code,
                    name = r.Name,
                    cashInMinor = regIn,
                    cashOutMinor = regOut,
                    netProfitMinor = regNet,
                    profitRate = regProfitRate,
                    hasOpenShift = hasOpen
                };
            }).ToList();

            return Results.Ok(new
            {
                source = "postgres",
                firmId,
                branchId,
                totalRegisters = registers.Count,
                activeShiftsCount = activeShifts.Count,
                totalCashInMinor = totalInMinor,
                totalCashOutMinor = totalOutMinor,
                netProfitMinor = netProfitMinor,
                profitRate = profitRate,
                openShiftInMinor = openShiftInMinor,
                openShiftOutMinor = openShiftOutMinor,
                openShiftNetProfitMinor = openShiftNetProfitMinor,
                openShiftProfitRate = openShiftProfitRate,
                registers = registerDetails
            });
        });

        cashProfitGroup.MapGet("/overview/cash-profit", async (
            string firmId,
            CashDbContext cashDb,
            CancellationToken ct) =>
        {
            var registers = await cashDb.Registers.AsNoTracking()
                .Where(r => r.FirmId == firmId && r.IsActive)
                .OrderBy(r => r.Code)
                .ToListAsync(ct);

            var movements = await cashDb.Movements.AsNoTracking()
                .Where(m => m.FirmId == firmId)
                .ToListAsync(ct);

            var activeShifts = await cashDb.Shifts.AsNoTracking()
                .Where(s => s.FirmId == firmId && s.Status == "open")
                .ToListAsync(ct);

            long totalInMinor = movements.Where(m => m.Kind == "manual_in").Sum(m => m.AmountMinor);
            long totalOutMinor = movements.Where(m => m.Kind == "manual_out").Sum(m => m.AmountMinor);
            long netProfitMinor = totalInMinor - totalOutMinor;

            double profitRate = totalInMinor > 0
                ? Math.Round(((double)netProfitMinor / totalInMinor) * 100.0, 1)
                : (totalOutMinor > 0 ? -100.0 : 0.0);

            var openShiftIds = activeShifts.Select(s => s.Id).ToHashSet();
            var openMovements = movements.Where(m => openShiftIds.Contains(m.ShiftId)).ToList();
            long openShiftInMinor = openMovements.Where(m => m.Kind == "manual_in").Sum(m => m.AmountMinor);
            long openShiftOutMinor = openMovements.Where(m => m.Kind == "manual_out").Sum(m => m.AmountMinor);
            long openShiftNetProfitMinor = openShiftInMinor - openShiftOutMinor;
            double openShiftProfitRate = openShiftInMinor > 0
                ? Math.Round(((double)openShiftNetProfitMinor / openShiftInMinor) * 100.0, 1)
                : (openShiftOutMinor > 0 ? -100.0 : 0.0);

            var registerDetails = registers.Select(r =>
            {
                var regMovements = movements.Where(m => m.RegisterId == r.Id).ToList();
                long regIn = regMovements.Where(m => m.Kind == "manual_in").Sum(m => m.AmountMinor);
                long regOut = regMovements.Where(m => m.Kind == "manual_out").Sum(m => m.AmountMinor);
                long regNet = regIn - regOut;
                double regProfitRate = regIn > 0
                    ? Math.Round(((double)regNet / regIn) * 100.0, 1)
                    : (regOut > 0 ? -100.0 : 0.0);

                bool hasOpen = activeShifts.Any(s => s.RegisterId == r.Id);

                return new
                {
                    id = r.Id.ToString(),
                    code = r.Code,
                    name = r.Name,
                    branchId = r.BranchId,
                    cashInMinor = regIn,
                    cashOutMinor = regOut,
                    netProfitMinor = regNet,
                    profitRate = regProfitRate,
                    hasOpenShift = hasOpen
                };
            }).ToList();

            return Results.Ok(new
            {
                source = "postgres",
                firmId,
                branchId = (string?)null,
                totalRegisters = registers.Count,
                activeShiftsCount = activeShifts.Count,
                totalCashInMinor = totalInMinor,
                totalCashOutMinor = totalOutMinor,
                netProfitMinor = netProfitMinor,
                profitRate = profitRate,
                openShiftInMinor = openShiftInMinor,
                openShiftOutMinor = openShiftOutMinor,
                openShiftNetProfitMinor = openShiftNetProfitMinor,
                openShiftProfitRate = openShiftProfitRate,
                registers = registerDetails
            });
        });
    }
}
