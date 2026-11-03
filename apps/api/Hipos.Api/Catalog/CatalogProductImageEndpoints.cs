using System.Security.Cryptography;
using Hipos.Api.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Hipos.Api.Catalog;

public static class CatalogProductImageEndpoints
{
    private const int MaximumImageBytes = 2 * 1024 * 1024;

    public static void MapCatalogProductImageEndpoints(this WebApplication app, bool ready)
    {
        var group = app.MapGroup("/api/v1/firms/{firmId}/branches/{branchId}/catalog/products/{productId:guid}/images");
        group.MapGet("/{imageId:guid}", async (string firmId, string branchId, Guid productId, Guid imageId,
            HttpContext context, CatalogDbContext db) =>
        {
            var actor = DemoAccess.Resolve(context);
            if (actor is null) return Problem("UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
            if (!actor.CanRead(firmId, branchId)) return Problem("UNAUTHORIZED_SCOPE", 403, "Bu şubenin görseline erişim izni yok.");
            if (!ready) return Problem("CATALOG_STORAGE_UNAVAILABLE", 503, "Katalog migration'ı uygulanmalı ve API yeniden başlatılmalı.");
            var exists = await db.Products.AsNoTracking().AnyAsync(row => row.Id == productId && row.FirmId == firmId && row.BranchIds.Contains(branchId), context.RequestAborted);
            if (!exists) return Problem("PRODUCT_NOT_FOUND", 404, "Ürün bu şubede bulunamadı.");
            var image = await db.ProductImages.AsNoTracking().SingleOrDefaultAsync(row => row.RequestId == imageId && row.ProductId == productId && row.FirmId == firmId && row.BranchId == branchId, context.RequestAborted);
            if (image is null) return Problem("IMAGE_NOT_FOUND", 404, "Ürün görseli bulunamadı.");
            context.Response.Headers.CacheControl = "private, max-age=3600";
            context.Response.Headers.XContentTypeOptions = "nosniff";
            return Results.File(image.Content, image.ContentType);
        });
        group.MapPut("", async (string firmId, string branchId, Guid productId, Guid requestId, int expectedVersion,
            HttpContext context, CatalogDbContext db, FeatureNewWorkGate gate) =>
        {
            var actor = DemoAccess.Resolve(context);
            if (actor is null) return Problem("UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
            if (!actor.CanManage || !actor.CanRead(firmId, branchId)) return Problem("UNAUTHORIZED_SCOPE", 403, "Bu şubede ürün düzenleme izni yok.");
            if (!ready) return Problem("CATALOG_STORAGE_UNAVAILABLE", 503, "Katalog migration'ı uygulanmalı ve API yeniden başlatılmalı.");
            if (requestId == Guid.Empty || expectedVersion < 1) return Problem("INVALID_IMAGE", 400, "İstek kimliği veya ürün sürümü geçersiz.");
            if (context.Request.ContentLength is > MaximumImageBytes) return Problem("IMAGE_TOO_LARGE", 413, "Görsel en fazla 2 MB olabilir.");
            using var buffer = new MemoryStream();
            var chunk = new byte[16384];
            int count;
            while ((count = await context.Request.Body.ReadAsync(chunk, context.RequestAborted)) > 0)
            {
                if (buffer.Length + count > MaximumImageBytes) return Problem("IMAGE_TOO_LARGE", 413, "Görsel en fazla 2 MB olabilir.");
                await buffer.WriteAsync(chunk.AsMemory(0, count), context.RequestAborted);
            }
            var bytes = buffer.ToArray();
            var type = ImageType(bytes);
            if (type is null) return Problem("INVALID_IMAGE", 400, "Yalnız JPEG, PNG veya WebP görselleri kabul edilir.");
            var fingerprint = Convert.ToHexString(SHA256.HashData(bytes));
            async Task<IResult?> ReplayAsync()
            {
                var prior = await db.ProductImages.AsNoTracking().SingleOrDefaultAsync(row => row.RequestId == requestId, context.RequestAborted);
                if (prior is null) return null;
                if (prior.FirmId != firmId || prior.BranchId != branchId || prior.ProductId != productId || prior.ExpectedVersion != expectedVersion || prior.Fingerprint != fingerprint)
                    return Problem("REQUEST_ID_CONFLICT", 409, "İstek kimliği farklı görsel veya ürün için kullanılmış.");
                return Results.Ok(new { image = $"upload:{prior.RequestId}", version = prior.Version, repeated = true });
            }
            if (await ReplayAsync() is { } existing) return existing;
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction(), firmId, branchId, "catalog.drafts", context.RequestAborted);
            if (blocked is not null) return Problem(blocked.Code, blocked.Status, blocked.Message);
            var initialStatus = await db.Products.AsNoTracking().Where(row => row.Id == productId && row.FirmId == firmId && row.BranchIds.Contains(branchId)).Select(row => row.Status).SingleOrDefaultAsync(context.RequestAborted);
            if (initialStatus is null) return Problem("PRODUCT_NOT_FOUND", 404, "Ürün bu şubede bulunamadı.");
            if (initialStatus == "published")
            {
                blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction(), firmId, branchId, "catalog.publishing", context.RequestAborted);
                if (blocked is not null) return Problem(blocked.Code, blocked.Status, blocked.Message);
            }
            var product = await db.Products.FromSqlInterpolated($"SELECT * FROM catalog.products WHERE id = {productId} AND firm_id = {firmId} AND branch_ids @> ARRAY[{branchId}]::text[] FOR UPDATE").SingleOrDefaultAsync(context.RequestAborted);
            if (product is null) return Problem("PRODUCT_NOT_FOUND", 404, "Ürün bu şubede bulunamadı.");
            if (await ReplayAsync() is { } concurrent) return concurrent;
            if (product.BranchIds.Length != 1) return Problem("MULTI_BRANCH_PRODUCT", 409, "Birden fazla şubede kullanılan ürün bu ekrandan düzenlenemez.");
            if (product.Version != expectedVersion) return Problem("VERSION_CONFLICT", 409, "Ürün değişti; bilgileri yenileyin.");
            if (product.Status != initialStatus) return Problem("VERSION_CONFLICT", 409, "Ürün durumu değişti; bilgileri yenileyin.");
            var now = DateTimeOffset.UtcNow;
            product.Image = $"upload:{requestId}"; product.Version++; product.UpdatedAt = now;
            var draft = await db.Drafts.SingleOrDefaultAsync(row => row.Id == productId && row.FirmId == firmId && row.BranchId == branchId, context.RequestAborted);
            if (draft is not null)
            {
                draft.Version = product.Version; draft.UpdatedAt = now;
                db.DraftAudit.Add(new CatalogDraftAuditRow { DraftId = draft.Id, FirmId = firmId, BranchId = branchId, Actor = actor.Name, Action = "image_uploaded", Version = draft.Version, OccurredAt = now });
            }
            db.ProductImages.Add(new CatalogProductImageRow { RequestId = requestId, ProductId = productId, FirmId = firmId, BranchId = branchId, ContentType = type, Content = bytes, Fingerprint = fingerprint, ExpectedVersion = expectedVersion, Version = product.Version, Actor = actor.Name, CreatedAt = now });
            try { await db.SaveChangesAsync(context.RequestAborted); await transaction.CommitAsync(context.RequestAborted); }
            catch (DbUpdateConcurrencyException) { return Problem("VERSION_CONFLICT", 409, "Ürün değişti; bilgileri yenileyin."); }
            catch (DbUpdateException) { return Problem("IMAGE_SAVE_CONFLICT", 409, "Görsel kaydı eşzamanlı değişti; bilgileri yenileyin."); }
            return Results.Ok(new { image = product.Image, version = product.Version, repeated = false });
        });
    }

    private static string? ImageType(byte[] data)
    {
        if (data.Length >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff) return "image/jpeg";
        if (data.Length >= 8 && data.AsSpan(0, 8).SequenceEqual(new byte[] { 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a })) return "image/png";
        if (data.Length >= 12 && data.AsSpan(0, 4).SequenceEqual("RIFF"u8) && data.AsSpan(8, 4).SequenceEqual("WEBP"u8)) return "image/webp";
        return null;
    }
    private static IResult Problem(string code, int status, string detail) => Results.Json(new { code, detail }, statusCode: status);
}
