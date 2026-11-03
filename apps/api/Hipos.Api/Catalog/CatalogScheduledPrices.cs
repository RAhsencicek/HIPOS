using Hipos.Api.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Hipos.Api.Catalog;

public sealed record ScheduleCatalogPrice(Guid RequestId, Guid ProductId, long AmountMinor, DateTimeOffset EffectiveAt, int ExpectedVersion);

public static class CatalogScheduledPriceEndpoints
{
    public static void MapCatalogScheduledPriceEndpoints(this WebApplication app, bool ready)
    {
        var group = app.MapGroup("/api/v1/firms/{firmId}/branches/{branchId}/catalog/scheduled-prices");
        group.MapGet("", async (string firmId, string branchId, HttpContext ctx, CatalogDbContext db) =>
        {
            if (Guard(ctx, firmId, branchId, ready, false) is { } denied) return denied;
            return Results.Ok(await db.ScheduledPrices.AsNoTracking().Where(x => x.FirmId == firmId && x.BranchId == branchId).OrderByDescending(x => x.EffectiveAt)
                .Select(x => new { x.Id, x.FirmId, x.BranchId, x.ProductId, x.AmountMinor, x.EffectiveAt, x.CreatedAt, x.Status, x.Detail, x.FinishedAt,
                    ProductName = db.Products.Where(p => p.Id == x.ProductId && p.FirmId == firmId && p.BranchIds.Contains(branchId)).Select(p => p.Name).FirstOrDefault() ?? "Ürün bulunamadı" }).ToListAsync(ctx.RequestAborted));
        });
        group.MapPost("", async (string firmId, string branchId, ScheduleCatalogPrice command, HttpContext ctx, CatalogDbContext db, FeatureNewWorkGate gate) =>
        {
            if (Guard(ctx, firmId, branchId, ready, true) is { } denied) return denied;
            if (command.RequestId == Guid.Empty || command.ProductId == Guid.Empty || command.ExpectedVersion < 1 || command.AmountMinor is < 1 or > 1_000_000_000)
                return Fail("INVALID_SCHEDULE", 400, "Ürün, fiyat ve istek bilgileri geçerli olmalı.");
            var ct = ctx.RequestAborted;
            var previous = await db.ScheduledPrices.AsNoTracking().SingleOrDefaultAsync(x => x.Id == command.RequestId, ct);
            if (previous is not null) return Same(previous, command, firmId, branchId) ? Results.Ok(previous) : Fail("REQUEST_ID_CONFLICT", 409, "İstek kimliği farklı bir plan için kullanılmış.");
            if (await db.PriceVersions.AsNoTracking().AnyAsync(x => x.Id == command.RequestId, ct)) return Fail("REQUEST_ID_CONFLICT", 409, "İstek kimliği mevcut bir fiyat sürümünde kullanılmış.");
            if (command.EffectiveAt <= DateTimeOffset.UtcNow) return Fail("INVALID_SCHEDULE", 400, "Başlangıç zamanı gelecekte olmalı.");
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), tx.GetDbTransaction(), firmId, branchId, "catalog.price_drafts", ct);
            if (blocked is not null) return Fail(blocked.Code, blocked.Status, blocked.Message);
            var initialStatus = await db.Products.AsNoTracking().Where(x => x.Id == command.ProductId && x.FirmId == firmId && x.BranchIds.Contains(branchId)).Select(x => x.Status).SingleOrDefaultAsync(ct);
            if (initialStatus is null) return Fail("PRODUCT_NOT_FOUND", 404, "Ürün bu şubede bulunamadı.");
            if (initialStatus == "published") {
                blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), tx.GetDbTransaction(), firmId, branchId, "catalog.publishing", ct);
                if (blocked is not null) return Fail(blocked.Code, blocked.Status, blocked.Message);
            }
            var product = await db.Products.FromSqlInterpolated($"SELECT * FROM catalog.products WHERE id = {command.ProductId} AND firm_id = {firmId} AND branch_ids @> ARRAY[{branchId}]::text[] FOR UPDATE").SingleOrDefaultAsync(ct);
            if (product is null) return Fail("PRODUCT_NOT_FOUND", 404, "Ürün bu şubede bulunamadı.");
            previous = await db.ScheduledPrices.AsNoTracking().SingleOrDefaultAsync(x => x.Id == command.RequestId, ct);
            if (previous is not null) return Same(previous, command, firmId, branchId) ? Results.Ok(previous) : Fail("REQUEST_ID_CONFLICT", 409, "İstek kimliği farklı bir plan için kullanılmış.");
            if (product.Version != command.ExpectedVersion || product.Status != initialStatus) return Fail("VERSION_CONFLICT", 409, "Ürün değişti; bilgileri yenileyin.");
            if (product.Status == "published" && !product.Channels.Contains("pos")) return Fail("PRODUCT_NOT_PUBLISHED", 409, "Ürünün POS yayın kaydı bulunamadı.");
            if (await db.ScheduledPrices.AnyAsync(x => x.FirmId == firmId && x.BranchId == branchId && x.ProductId == product.Id && x.EffectiveAt == command.EffectiveAt.ToUniversalTime() && (x.Status == "pending" || x.Status == "processing"), ct))
                return Fail("SCHEDULE_EXISTS", 409, "Bu ürün için aynı zamanda bir fiyat planı zaten var.");
            var row = new CatalogScheduledPriceRow { Id = command.RequestId, FirmId = firmId, BranchId = branchId, ProductId = product.Id, AmountMinor = command.AmountMinor,
                EffectiveAt = command.EffectiveAt.ToUniversalTime(), CreatedAt = DateTimeOffset.UtcNow, Actor = DemoAccess.Resolve(ctx)!.Name, ExpectedVersion = command.ExpectedVersion };
            db.ScheduledPrices.Add(row);
            try { await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); }
            catch (DbUpdateException) { return Fail("SCHEDULE_CONFLICT", 409, "Plan başka bir işlemle değişti; listeyi yenileyin."); }
            return Results.Ok(row);
        });
        group.MapPost("/{id:guid}/cancel", async (string firmId, string branchId, Guid id, HttpContext ctx, CatalogDbContext db) =>
        {
            if (Guard(ctx, firmId, branchId, ready, true) is { } denied) return denied;
            var now = DateTimeOffset.UtcNow;
            var cancelledBy = DemoAccess.Resolve(ctx)!.Name;
            var updated = await db.ScheduledPrices.Where(x => x.Id == id && x.FirmId == firmId && x.BranchId == branchId && x.Status == "pending" && x.EffectiveAt > now)
                .ExecuteUpdateAsync(x => x.SetProperty(row => row.Status, "cancelled").SetProperty(row => row.Detail, $"İptal eden: {cancelledBy}").SetProperty(row => row.FinishedAt, now), ctx.RequestAborted);
            return updated == 1 ? Results.Ok(new { status = "cancelled" }) : Fail("SCHEDULE_NOT_CANCELLABLE", 409, "Plan bulunamadı veya artık iptal edilemiyor.");
        });
    }
    private static bool Same(CatalogScheduledPriceRow row, ScheduleCatalogPrice c, string firm, string branch) => row.FirmId == firm && row.BranchId == branch && row.ProductId == c.ProductId && row.AmountMinor == c.AmountMinor && row.ExpectedVersion == c.ExpectedVersion && row.EffectiveAt == c.EffectiveAt.ToUniversalTime();
    private static IResult? Guard(HttpContext ctx, string firm, string branch, bool ready, bool write)
    {
        var actor = DemoAccess.Resolve(ctx);
        if (actor is null) return Fail("UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanRead(firm, branch) || write && !actor.CanManage) return Fail("UNAUTHORIZED_SCOPE", 403, "Bu şubede işlem izni yok.");
        return ready ? null : Fail("CATALOG_STORAGE_UNAVAILABLE", 503, "Katalog migration'ı uygulanmalı ve API yeniden başlatılmalı.");
    }
    private static IResult Fail(string code, int status, string detail) => Results.Problem(statusCode: status, title: "İşlem başarısız", detail: detail, extensions: new Dictionary<string, object?> { ["code"] = code });
}

public sealed class CatalogScheduledPriceWorker(IServiceScopeFactory scopeFactory, ILogger<CatalogScheduledPriceWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await ProcessAsync(stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception error) { logger.LogWarning(error, "Planlanan fiyatlar işlenemedi."); }
            await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
        }
    }
    private async Task ProcessAsync(CancellationToken ct)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
        if ((await db.Database.GetPendingMigrationsAsync(ct)).Any()) return;
        await db.Database.OpenConnectionAsync(ct);
        try
        {
            await using var command = db.Database.GetDbConnection().CreateCommand();
            command.CommandText = "SELECT pg_try_advisory_lock(748310119)";
            if (!((bool?)await command.ExecuteScalarAsync(ct) ?? false)) return;
            try
            {
                await db.ScheduledPrices.Where(x => x.Status == "processing").ExecuteUpdateAsync(x => x.SetProperty(y => y.Status, "pending"), ct);
                var ids = await db.ScheduledPrices.AsNoTracking().Where(x => x.Status == "pending" && x.EffectiveAt <= DateTimeOffset.UtcNow)
                    .OrderBy(x => x.EffectiveAt).ThenBy(x => x.Id).Select(x => x.Id).Take(50).ToListAsync(ct);
                foreach (var id in ids)
                {
                    var claimed = await db.ScheduledPrices.Where(x => x.Id == id && x.Status == "pending" && x.EffectiveAt <= DateTimeOffset.UtcNow)
                        .ExecuteUpdateAsync(x => x.SetProperty(y => y.Status, "processing"), ct);
                    if (claimed == 0) continue;
                    using var jobScope = scopeFactory.CreateScope();
                    await ApplyAsync(jobScope.ServiceProvider, id, ct);
                }
            }
            finally { command.CommandText = "SELECT pg_advisory_unlock(748310119)"; await command.ExecuteScalarAsync(CancellationToken.None); }
        }
        finally { await db.Database.CloseConnectionAsync(); }
    }
    private static async Task ApplyAsync(IServiceProvider services, Guid id, CancellationToken ct)
    {
        var db = services.GetRequiredService<CatalogDbContext>();
        var row = await db.ScheduledPrices.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id && x.Status == "processing", ct);
        if (row is null) return;
        var earlierPending = await db.ScheduledPrices.AsNoTracking().AnyAsync(x => x.FirmId == row.FirmId && x.BranchId == row.BranchId && x.ProductId == row.ProductId && x.Id != row.Id && (x.Status == "pending" || x.Status == "processing") && x.EffectiveAt < row.EffectiveAt, ct);
        if (earlierPending) { await db.ScheduledPrices.Where(x => x.Id == id && x.Status == "processing").ExecuteUpdateAsync(x => x.SetProperty(y => y.Status, "pending"), ct); return; }
        async Task Finish(string status, string? detail) { await db.ScheduledPrices.Where(x => x.Id == id && x.Status == "processing")
            .ExecuteUpdateAsync(x => x.SetProperty(y => y.Status, status).SetProperty(y => y.Detail, detail).SetProperty(y => y.FinishedAt, DateTimeOffset.UtcNow), ct); }
        var existing = await db.PriceVersions.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct);
        if (existing is not null) {
            if (existing.FirmId == row.FirmId && existing.BranchId == row.BranchId && existing.ProductId == row.ProductId && existing.AmountMinor == row.AmountMinor) await Finish("applied", null);
            else await Finish("failed", "Fiyat sürümü kimliği başka bir işlemde kullanıldı.");
            return;
        }
        var product = await db.Products.AsNoTracking().SingleOrDefaultAsync(x => x.Id == row.ProductId && x.FirmId == row.FirmId && x.BranchIds.Contains(row.BranchId), ct);
        if (product is null) { await Finish("failed", "Ürün bulunamadı."); return; }
        var commands = services.GetRequiredService<CatalogPublicationCommands>();
        var input = new SetDraftPrice(row.Id, row.AmountMinor, product.Version);
        var result = product.Status == "draft" ? await commands.SetPriceAsync(row.FirmId, row.BranchId, row.ProductId, input, row.Actor, ct)
            : await commands.RepricePublishedAsync(row.FirmId, row.BranchId, row.ProductId, input, row.Actor, ct);
        if (result.Failure is { Code: "VERSION_CONFLICT" }) return;
        if (result.Failure is { } failure) await Finish("failed", failure.Message);
        else await Finish("applied", null);
    }
}
