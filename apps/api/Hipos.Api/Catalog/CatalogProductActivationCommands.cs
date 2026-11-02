using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Hipos.Api.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace Hipos.Api.Catalog;

public sealed record SetCatalogProductActive(Guid RequestId, int ExpectedVersion, bool IsActive);
public sealed record SetCatalogProductChannels(Guid RequestId, int ExpectedVersion, string[] DesiredChannels);
public sealed record CatalogProductActivationResult(
    Guid ProductId, bool IsActive, int Version, FeatureFailure? Failure, bool Replayed)
{
    public static CatalogProductActivationResult Rejected(string code, int status, string message) =>
        new(Guid.Empty, false, 0, new FeatureFailure(code, status, message), false);
}

public sealed class CatalogProductActivationCommands(CatalogDbContext db, FeatureNewWorkGate gate)
{
    public async Task<(string[]? Channels, int Version, FeatureFailure? Failure)> SetChannelsAsync(
        string firmId, string branchId, Guid productId, SetCatalogProductChannels command, string actor, CancellationToken ct)
    {
        if (productId == Guid.Empty || command.RequestId == Guid.Empty || command.ExpectedVersion < 1 ||
            command.DesiredChannels is null || command.DesiredChannels.Any(x => x is not ("pos" or "qr" or "delivery")) ||
            command.DesiredChannels.Distinct().Count() != command.DesiredChannels.Length)
            return (null, 0, new FeatureFailure("INVALID_CHANNELS", 400, "Kanal seçimi veya istek bilgisi geçersiz."));
        var channels = command.DesiredChannels.OrderBy(x => x, StringComparer.Ordinal).ToArray();
        var fingerprint = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { firmId, branchId, productId, command.ExpectedVersion, channels }))));
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), tx.GetDbTransaction(), firmId, branchId, "catalog.drafts", ct);
        if (blocked is not null) return (null, 0, blocked);
        var initialStatus = await db.Products.AsNoTracking().Where(x => x.Id == productId && x.FirmId == firmId && x.BranchIds.Contains(branchId)).Select(x => x.Status).SingleOrDefaultAsync(ct);
        if (initialStatus is null) return (null, 0, new FeatureFailure("PRODUCT_NOT_FOUND", 404, "Ürün bu şubede bulunamadı."));
        if (initialStatus == "published") {
            blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), tx.GetDbTransaction(), firmId, branchId, "catalog.publishing", ct);
            if (blocked is not null) return (null, 0, blocked);
        }
        var prior = await db.ProductChannelAudit.AsNoTracking().SingleOrDefaultAsync(x => x.RequestId == command.RequestId, ct);
        if (prior is not null)
            return prior.Fingerprint == fingerprint ? (prior.DesiredChannels, prior.Version, null) : (null, 0, new FeatureFailure("REQUEST_ID_CONFLICT", 409, "İstek kimliği farklı içerikle kullanılmış."));
        var draft = await db.Drafts.FromSqlInterpolated($"SELECT * FROM catalog.drafts WHERE id = {productId} AND firm_id = {firmId} AND branch_id = {branchId} FOR UPDATE").SingleOrDefaultAsync(ct);
        var product = await db.Products.FromSqlInterpolated($"SELECT * FROM catalog.products WHERE id = {productId} AND firm_id = {firmId} AND branch_ids @> ARRAY[{branchId}]::text[] FOR UPDATE").SingleOrDefaultAsync(ct);
        if (product is null) return (null, 0, new FeatureFailure("PRODUCT_NOT_FOUND", 404, "Ürün bu şubede bulunamadı."));
        if (product.Status != initialStatus) return (null, 0, new FeatureFailure("VERSION_CONFLICT", 409, "Ürün durumu değişti; bilgileri yenileyin."));
        prior = await db.ProductChannelAudit.AsNoTracking().SingleOrDefaultAsync(x => x.RequestId == command.RequestId, ct);
        if (prior is not null) return prior.Fingerprint == fingerprint ? (prior.DesiredChannels, prior.Version, null) : (null, 0, new FeatureFailure("REQUEST_ID_CONFLICT", 409, "İstek kimliği farklı içerikle kullanılmış."));
        if (product.BranchIds.Length != 1) return (null, 0, new FeatureFailure("MULTI_BRANCH_PRODUCT", 409, "Birden fazla şubede kullanılan ürünün kanal tercihi değiştirilemez."));
        if (product.Version != command.ExpectedVersion) return (null, 0, new FeatureFailure("VERSION_CONFLICT", 409, "Ürün değişti; bilgileri yenileyin."));
        var now = DateTimeOffset.UtcNow;
        product.DesiredChannels = channels; product.Version++; product.UpdatedAt = now;
        if (draft is not null) { draft.Version = product.Version; draft.UpdatedAt = now; db.DraftAudit.Add(new CatalogDraftAuditRow { DraftId = draft.Id, FirmId = firmId, BranchId = branchId, Actor = actor, Action = "channels_changed", Version = draft.Version, OccurredAt = now }); }
        db.ProductChannelAudit.Add(new CatalogProductChannelAuditRow { RequestId = command.RequestId, ProductId = productId, FirmId = firmId, BranchId = branchId, Actor = actor, Fingerprint = fingerprint, DesiredChannels = channels, Version = product.Version, OccurredAt = now });
        try { await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); }
        catch (DbUpdateConcurrencyException) { return (null, 0, new FeatureFailure("VERSION_CONFLICT", 409, "Ürün değişti; bilgileri yenileyin.")); }
        catch (DbUpdateException error) when (error.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation }) { return (null, 0, new FeatureFailure("REQUEST_ID_CONFLICT", 409, "İstek kimliği zaten kullanılıyor.")); }
        return (channels, product.Version, null);
    }
    public async Task<CatalogProductActivationResult> SetActiveAsync(
        string firmId, string branchId, Guid productId, SetCatalogProductActive command,
        string actor, CancellationToken cancellationToken)
    {
        if (productId == Guid.Empty || command.RequestId == Guid.Empty || command.ExpectedVersion < 1)
            return CatalogProductActivationResult.Rejected("INVALID_PRODUCT", 400,
                "Ürün, istek kimliği ve expectedVersion geçerli olmalı.");

        var fingerprint = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
            JsonSerializer.Serialize(new { firmId, branchId, productId, command.ExpectedVersion, command.IsActive }))));
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(),
            transaction.GetDbTransaction(), firmId, branchId, "catalog.drafts", cancellationToken);
        if (blocked is not null)
            return new CatalogProductActivationResult(Guid.Empty, false, 0, blocked, false);

        var previous = await db.ProductActivationAudit.AsNoTracking()
            .SingleOrDefaultAsync(row => row.RequestId == command.RequestId, cancellationToken);
        if (previous is not null)
        {
            if (previous.Fingerprint != fingerprint || previous.FirmId != firmId || previous.BranchId != branchId)
                return CatalogProductActivationResult.Rejected("REQUEST_ID_CONFLICT", 409,
                    "Bu istek kimliği farklı içerikle kullanılmış.");
            await transaction.CommitAsync(cancellationToken);
            return new CatalogProductActivationResult(productId, previous.IsActive, previous.Version, null, true);
        }

        var draft = await db.Drafts.FromSqlInterpolated(
            $"SELECT * FROM catalog.drafts WHERE id = {productId} AND firm_id = {firmId} AND branch_id = {branchId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);
        var product = await db.Products.FromSqlInterpolated(
            $"SELECT * FROM catalog.products WHERE id = {productId} AND firm_id = {firmId} AND branch_ids @> ARRAY[{branchId}]::text[] FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);
        if (product is null)
            return CatalogProductActivationResult.Rejected("PRODUCT_NOT_FOUND", 404,
                "Ürün bu firma ve şube kapsamında bulunamadı.");
        if (product.Version != command.ExpectedVersion)
            return CatalogProductActivationResult.Rejected("VERSION_CONFLICT", 409,
                "Ürün başka bir işlemle değişti. Güncel kaydı yükleyin.");

        var now = DateTimeOffset.UtcNow;
        var changed = product.IsActive != command.IsActive;
        if (changed)
        {
            product.IsActive = command.IsActive;
            product.Version++;
            product.UpdatedAt = now;
            if (draft is not null)
            {
                draft.Version = product.Version;
                draft.UpdatedAt = now;
                db.DraftAudit.Add(new CatalogDraftAuditRow
                {
                    DraftId = draft.Id, FirmId = firmId, BranchId = branchId,
                    Actor = actor, Action = command.IsActive ? "activated" : "deactivated",
                    Version = draft.Version, OccurredAt = now,
                });
            }
        }
        db.ProductActivationAudit.Add(new CatalogProductActivationAuditRow
        {
            RequestId = command.RequestId,
            ProductId = productId,
            FirmId = firmId,
            BranchId = branchId,
            Actor = actor,
            Action = changed ? (command.IsActive ? "activated" : "deactivated") : "unchanged",
            Fingerprint = fingerprint,
            IsActive = product.IsActive,
            Version = product.Version,
            OccurredAt = now,
        });
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return CatalogProductActivationResult.Rejected("VERSION_CONFLICT", 409,
                "Ürün başka bir işlemle değişti.");
        }
        catch (DbUpdateException error) when (error.InnerException is PostgresException
            { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return CatalogProductActivationResult.Rejected("REQUEST_ID_CONFLICT", 409,
                "İstek kimliği veya ürün durumu başka bir işlemde kullanıldı.");
        }
        return new CatalogProductActivationResult(productId, product.IsActive, product.Version, null, false);
    }
}
