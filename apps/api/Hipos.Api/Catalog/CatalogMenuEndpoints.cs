using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Hipos.Api.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace Hipos.Api.Catalog;

public sealed record MenuSectionInput(string SectionId, string Name, Guid[] ProductIds);
public sealed record SaveCatalogMenu(Guid RequestId, int ExpectedVersion, string Name, string Description, MenuSectionInput[] Sections);
public sealed record ActivateCatalogMenu(Guid RequestId, int ExpectedVersion, bool IsActive);
public sealed record CatalogMenuView(Guid Id, string Name, string Description, bool IsActive, int Version,
    DateTimeOffset UpdatedAt, MenuSectionInput[] Sections);

public static class CatalogMenuEndpoints
{
    public static void MapCatalogMenuEndpoints(this WebApplication app, bool ready)
    {
        var group = app.MapGroup("/api/v1/firms/{firmId}/branches/{branchId}/catalog/menus");
        group.MapGet("", async (string firmId, string branchId, HttpContext ctx, CatalogDbContext db) =>
        {
            if (Guard(ctx, firmId, branchId, ready, false) is { } denied) return denied;
            var products = await db.Products.AsNoTracking().Include(x => x.BranchPrices)
                .Where(x => x.FirmId == firmId && x.BranchIds.Contains(branchId)).OrderBy(x => x.Name).ToListAsync(ctx.RequestAborted);
            var categories = await db.Categories.AsNoTracking().Where(x => x.FirmId == firmId)
                .OrderBy(x => x.SortOrder).ThenBy(x => x.Name).Select(x => new { x.Id, x.Name, x.IsActive }).ToListAsync(ctx.RequestAborted);
            var menus = await db.Menus.AsNoTracking().Where(x => x.FirmId == firmId && x.BranchId == branchId)
                .OrderByDescending(x => x.IsActive).ThenBy(x => x.Name).ToListAsync(ctx.RequestAborted);
            var ids = menus.Select(x => x.Id).ToArray();
            var sections = await db.MenuSections.AsNoTracking().Where(x => ids.Contains(x.MenuId)).OrderBy(x => x.SortOrder).ToListAsync(ctx.RequestAborted);
            var items = await db.MenuItems.AsNoTracking().Where(x => ids.Contains(x.MenuId)).OrderBy(x => x.SortOrder).ToListAsync(ctx.RequestAborted);
            return Results.Ok(new { source = "postgres", items = menus.Select(x => View(x, sections, items)), categories,
                products = products.Select(x => new { x.Id, x.Name, x.CategoryId, x.Status, x.Image,
                    price = new CatalogMoney(x.BranchPrices.FirstOrDefault(p => p.BranchId == branchId)?.AmountMinor ?? x.BasePriceMinor, x.Currency) }) });
        });
        group.MapPost("", (string firmId, string branchId, SaveCatalogMenu command, HttpContext ctx,
            CatalogDbContext db, FeatureNewWorkGate gate) => Save(firmId, branchId, command.RequestId, command, true, ctx, db, gate, ready));
        group.MapPut("/{menuId:guid}", (string firmId, string branchId, Guid menuId, SaveCatalogMenu command, HttpContext ctx,
            CatalogDbContext db, FeatureNewWorkGate gate) => Save(firmId, branchId, menuId, command, false, ctx, db, gate, ready));
        group.MapPost("/{menuId:guid}/activation", (string firmId, string branchId, Guid menuId, ActivateCatalogMenu command,
            HttpContext ctx, CatalogDbContext db, FeatureNewWorkGate gate) => Activate(firmId, branchId, menuId, command, ctx, db, gate, ready));
    }

    private static async Task<IResult> Save(string firm, string branch, Guid id, SaveCatalogMenu input, bool create,
        HttpContext ctx, CatalogDbContext db, FeatureNewWorkGate gate, bool ready)
    {
        if (Guard(ctx, firm, branch, ready, true) is { } denied) return denied;
        var name = input.Name?.Trim() ?? "";
        var description = input.Description?.Trim() ?? "";
        if (input.RequestId == Guid.Empty || name.Length is < 2 or > 160 || description.Length > 1000 ||
            input.Sections is null || input.Sections.Length > 100 || input.Sections.Any(x => x is null ||
                string.IsNullOrWhiteSpace(x.SectionId) || x.SectionId.Length > 120 || string.IsNullOrWhiteSpace(x.Name) ||
                x.Name.Trim().Length > 120 || x.ProductIds is null) ||
            (create ? input.ExpectedVersion != 0 : input.ExpectedVersion < 1))
            return Fail("INVALID_MENU", 400, "Menü adı, içerik veya sürüm geçersiz.");
        if (input.Sections.Select(x => x.SectionId).Distinct().Count() != input.Sections.Length ||
            input.Sections.Select(x => x.Name.Trim()).Distinct(StringComparer.Create(System.Globalization.CultureInfo.GetCultureInfo("tr-TR"), true)).Count() != input.Sections.Length ||
            input.Sections.Sum(x => x.ProductIds.Length) > 2000 ||
            input.Sections.SelectMany(x => x.ProductIds).Distinct().Count() != input.Sections.Sum(x => x.ProductIds.Length))
            return Fail("DUPLICATE_MENU_ITEM", 400, "Kategori veya ürün menüde tekrarlanamaz; en fazla 2000 ürün seçilebilir.");
        var fingerprint = Hash(new { firm, branch, id, action = create ? "create" : "update", input });
        await using var tx = await db.Database.BeginTransactionAsync(ctx.RequestAborted);
        var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), tx.GetDbTransaction(), firm, branch, "catalog.menus", ctx.RequestAborted);
        if (blocked is not null) return Fail(blocked.Code, blocked.Status, blocked.Message);
        if (await Replay(db, input.RequestId, fingerprint, ctx) is { } replay) return replay;
        var row = await db.Menus.SingleOrDefaultAsync(x => x.Id == id && x.FirmId == firm && x.BranchId == branch, ctx.RequestAborted);
        if (create && await db.Menus.AnyAsync(x => x.Id == id, ctx.RequestAborted)) return Fail("MENU_EXISTS", 409, "Menü kimliği zaten kullanılıyor.");
        if (!create && row is null) return Fail("MENU_NOT_FOUND", 404, "Bu şubede menü bulunamadı.");
        if (!create && row!.Version != input.ExpectedVersion) return Fail("VERSION_CONFLICT", 409, "Menü başka bir işlemle değişti. Güncel kaydı yükleyin.");
        if (await Validate(db, firm, branch, input.Sections, row?.IsActive == true, ctx) is { } invalid) return invalid;
        if (create)
        {
            row = new CatalogMenuRow { Id = id, FirmId = firm, BranchId = branch, CreatedAt = DateTimeOffset.UtcNow };
            db.Menus.Add(row);
        }
        else row!.Version++;
        row!.Name = name; row.Description = description; row.UpdatedAt = DateTimeOffset.UtcNow;
        if (!create) await db.MenuSections.Where(x => x.MenuId == id).ExecuteDeleteAsync(ctx.RequestAborted);
        for (var s = 0; s < input.Sections.Length; s++)
        {
            var section = input.Sections[s];
            db.MenuSections.Add(new CatalogMenuSectionRow { MenuId = id, SectionId = section.SectionId, Name = section.Name.Trim(), SortOrder = s });
            for (var p = 0; p < section.ProductIds.Length; p++)
                db.MenuItems.Add(new CatalogMenuItemRow { MenuId = id, SectionId = section.SectionId, ProductId = section.ProductIds[p], SortOrder = p });
        }
        AddAudit(db, row, input.RequestId, fingerprint, create ? "created" : "updated", input.Sections, ctx);
        return await Commit(db, tx, row, ctx);
    }

    private static async Task<IResult> Activate(string firm, string branch, Guid id, ActivateCatalogMenu input,
        HttpContext ctx, CatalogDbContext db, FeatureNewWorkGate gate, bool ready)
    {
        if (Guard(ctx, firm, branch, ready, true) is { } denied) return denied;
        if (input.RequestId == Guid.Empty || input.ExpectedVersion < 1) return Fail("INVALID_MENU", 400, "İstek kimliği ve sürüm gerekli.");
        var fingerprint = Hash(new { firm, branch, id, action = "activation", input });
        await using var tx = await db.Database.BeginTransactionAsync(ctx.RequestAborted);
        var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), tx.GetDbTransaction(), firm, branch, "catalog.menus", ctx.RequestAborted);
        if (blocked is not null) return Fail(blocked.Code, blocked.Status, blocked.Message);
        if (await Replay(db, input.RequestId, fingerprint, ctx) is { } replay) return replay;
        var row = await db.Menus.SingleOrDefaultAsync(x => x.Id == id && x.FirmId == firm && x.BranchId == branch, ctx.RequestAborted);
        if (row is null) return Fail("MENU_NOT_FOUND", 404, "Bu şubede menü bulunamadı.");
        if (row.Version != input.ExpectedVersion) return Fail("VERSION_CONFLICT", 409, "Menü başka bir işlemle değişti. Güncel kaydı yükleyin.");
        var sections = await Sections(db, id, ctx);
        if (input.IsActive && await Validate(db, firm, branch, sections, true, ctx) is { } invalid) return invalid;
        if (input.IsActive)
        {
            var previous = await db.Menus.Where(x => x.FirmId == firm && x.BranchId == branch && x.IsActive && x.Id != id).ToListAsync(ctx.RequestAborted);
            foreach (var other in previous)
            {
                other.IsActive = false; other.Version++; other.UpdatedAt = DateTimeOffset.UtcNow;
                AddAudit(db, other, Guid.NewGuid(), fingerprint, "replaced_active", await Sections(db, other.Id, ctx), ctx);
            }
            // Önce eski aktif satırı boşalt: kısmi tekillik kısıtı her SQL komutunda geçerlidir.
            await db.SaveChangesAsync(ctx.RequestAborted);
        }
        row.IsActive = input.IsActive; row.Version++; row.UpdatedAt = DateTimeOffset.UtcNow;
        AddAudit(db, row, input.RequestId, fingerprint, input.IsActive ? "activated" : "deactivated", sections, ctx);
        return await Commit(db, tx, row, ctx);
    }

    private static async Task<IResult?> Validate(CatalogDbContext db, string firm, string branch, MenuSectionInput[] sections, bool active, HttpContext ctx)
    {
        var ids = sections.SelectMany(x => x.ProductIds).ToArray();
        var products = await db.Products.AsNoTracking().Include(x => x.BranchPrices)
            .Where(x => x.FirmId == firm && x.BranchIds.Contains(branch) && ids.Contains(x.Id)).ToListAsync(ctx.RequestAborted);
        if (products.Count != ids.Length)
            return Fail("INVALID_MENU_PRODUCT", 400, "Seçilen ürünlerden biri bu firmaya veya şubeye ait değil.");
        if (active && (ids.Length == 0 || sections.Any(s => s.ProductIds.Length == 0) || products.Any(p => p.Status != "published" ||
            p.Currency != "TRY" || (p.BranchPrices.FirstOrDefault(x => x.BranchId == branch)?.AmountMinor ?? p.BasePriceMinor) <= 0)))
            return Fail("MENU_NOT_READY", 409, "Aktif menüde boş kategori olamaz; en az bir yayınlanmış ve geçerli fiyatlı ürün seçin.");
        return null;
    }

    private static async Task<MenuSectionInput[]> Sections(CatalogDbContext db, Guid id, HttpContext ctx)
    {
        var sections = await db.MenuSections.AsNoTracking().Where(x => x.MenuId == id).OrderBy(x => x.SortOrder).ToListAsync(ctx.RequestAborted);
        var items = await db.MenuItems.AsNoTracking().Where(x => x.MenuId == id).OrderBy(x => x.SortOrder).ToListAsync(ctx.RequestAborted);
        return sections.Select(s => new MenuSectionInput(s.SectionId, s.Name, items.Where(i => i.SectionId == s.SectionId).Select(i => i.ProductId).ToArray())).ToArray();
    }
    private static CatalogMenuView View(CatalogMenuRow row, List<CatalogMenuSectionRow> sections, List<CatalogMenuItemRow> items) =>
        new(row.Id, row.Name, row.Description, row.IsActive, row.Version, row.UpdatedAt,
            sections.Where(s => s.MenuId == row.Id).Select(s => new MenuSectionInput(s.SectionId, s.Name,
                items.Where(i => i.MenuId == row.Id && i.SectionId == s.SectionId).Select(i => i.ProductId).ToArray())).ToArray());
    private static async Task<IResult?> Replay(CatalogDbContext db, Guid request, string fingerprint, HttpContext ctx)
    {
        var audit = await db.MenuAudit.AsNoTracking().SingleOrDefaultAsync(x => x.RequestId == request, ctx.RequestAborted);
        return audit is null ? null : audit.Fingerprint == fingerprint
            ? Results.Ok(new { id = audit.MenuId, version = audit.Version, replayed = true })
            : Fail("REQUEST_ID_CONFLICT", 409, "Bu istek kimliği farklı içerikle kullanılmış.");
    }
    private static void AddAudit(CatalogDbContext db, CatalogMenuRow row, Guid requestId, string fingerprint, string action, MenuSectionInput[] sections, HttpContext ctx) =>
        db.MenuAudit.Add(new CatalogMenuAuditRow { RequestId = requestId, MenuId = row.Id, FirmId = row.FirmId, BranchId = row.BranchId,
            Actor = DemoAccess.Resolve(ctx)!.Name, Action = action, Fingerprint = fingerprint, Version = row.Version,
            SnapshotJson = JsonSerializer.Serialize(new { row.Name, row.Description, row.IsActive, Sections = sections }), OccurredAt = DateTimeOffset.UtcNow });
    private static async Task<IResult> Commit(CatalogDbContext db, Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction tx, CatalogMenuRow row, HttpContext ctx)
    {
        try { await db.SaveChangesAsync(ctx.RequestAborted); await tx.CommitAsync(ctx.RequestAborted); }
        catch (DbUpdateConcurrencyException) { return Fail("VERSION_CONFLICT", 409, "Menü başka bir işlemle değişti."); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        { return Fail("REQUEST_ID_CONFLICT", 409, "İstek kimliği veya aktif menü çakıştı. Kayıtları yenileyin."); }
        return Results.Ok(new { id = row.Id, version = row.Version, replayed = false });
    }
    private static string Hash(object value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value))));
    private static IResult? Guard(HttpContext ctx, string firm, string branch, bool ready, bool write)
    {
        var actor = DemoAccess.Resolve(ctx);
        if (actor is null) return Fail("UNAUTHENTICATED", 401, "Kullanıcı belirtilmedi.");
        if (!actor.CanRead(firm, branch) || (write && !actor.CanManage)) return Fail("UNAUTHORIZED_SCOPE", 403, "Bu şubede menü işlem izni yok.");
        return ready ? null : Fail("CATALOG_STORAGE_UNAVAILABLE", 503, "Katalog migration'ını uygulayıp API'yi yeniden başlatın.");
    }
    private static IResult Fail(string code, int status, string detail) => Results.Problem(statusCode: status, detail: detail, extensions: new Dictionary<string, object?> { ["code"] = code });
}
