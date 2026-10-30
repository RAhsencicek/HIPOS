using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Hipos.Api.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace Hipos.Api.Catalog;

public sealed record SetCatalogProductActive(Guid RequestId, int ExpectedVersion, bool IsActive);
public sealed record CatalogProductActivationResult(
    Guid ProductId, bool IsActive, int Version, FeatureFailure? Failure, bool Replayed)
{
    public static CatalogProductActivationResult Rejected(string code, int status, string message) =>
        new(Guid.Empty, false, 0, new FeatureFailure(code, status, message), false);
}

public sealed class CatalogProductActivationCommands(CatalogDbContext db, FeatureNewWorkGate gate)
{
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
