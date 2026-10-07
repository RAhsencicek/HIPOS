using Hipos.Api.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace Hipos.Api.Catalog;

public sealed record SetDraftPrice(Guid PriceVersionId, long AmountMinor, int ExpectedVersion);
public sealed record PublishProductDraft(Guid PublicationId, int ExpectedVersion);
public sealed record CatalogPriceVersionInfo(
    string Id, string ProductId, int Number, long AmountMinor, string Currency, DateTimeOffset CreatedAt);
public sealed record CatalogPublicationInfo(
    string Id, string ProductId, int Number, string PriceVersionId, long AmountMinor,
    string Currency, string[] Channels, DateTimeOffset PublishedAt);
public sealed record CatalogPriceResult(
    CatalogProductDetail? Product, CatalogPriceVersionInfo? PriceVersion,
    FeatureFailure? Failure, bool Created)
{
    public static CatalogPriceResult Rejected(string code, int status, string detail) =>
        new(null, null, new FeatureFailure(code, status, detail), false);
}
public sealed record CatalogPublicationResult(
    CatalogProductDetail? Product, CatalogPublicationInfo? Publication,
    FeatureFailure? Failure, bool Created)
{
    public static CatalogPublicationResult Rejected(string code, int status, string detail) =>
        new(null, null, new FeatureFailure(code, status, detail), false);
}

public sealed class CatalogPublicationCommands(
    CatalogDbContext db, CatalogQueries queries, FeatureNewWorkGate gate)
{
    public async Task<CatalogPriceResult> SetPriceAsync(
        string firmId, string branchId, Guid draftId, SetDraftPrice command,
        string actor, CancellationToken cancellationToken)
    {
        if (command.PriceVersionId == Guid.Empty || command.AmountMinor is < 1 or > 1_000_000_000)
            return CatalogPriceResult.Rejected("INVALID_PRICE", 400, "Fiyat sürümü kimliği veya tutarı geçersiz.");
        if (command.ExpectedVersion < 1)
            return CatalogPriceResult.Rejected("INVALID_VERSION", 400, "expectedVersion pozitif olmalı.");

        var existing = await db.PriceVersions.AsNoTracking().FirstOrDefaultAsync(
            row => row.Id == command.PriceVersionId, cancellationToken);
        if (existing is not null)
            return await ExistingPriceAsync(existing, firmId, branchId, draftId, command.AmountMinor, cancellationToken);

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(),
            transaction.GetDbTransaction(), firmId, branchId, "catalog.price_drafts", cancellationToken);
        if (blocked is not null) return new CatalogPriceResult(null, null, blocked, false);
        var draft = await db.Drafts.FromSqlInterpolated(
            $"SELECT * FROM catalog.drafts WHERE id = {draftId} AND firm_id = {firmId} AND branch_id = {branchId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);
        if (draft is null)
            return CatalogPriceResult.Rejected("DRAFT_NOT_FOUND", 404, "Taslak bu şubede bulunamadı.");
        if (draft.Version != command.ExpectedVersion)
            return CatalogPriceResult.Rejected("VERSION_CONFLICT", 409, "Taslak başka bir işlemle değişti.");
        var product = await db.Products.SingleOrDefaultAsync(row =>
            row.Id == draftId && row.FirmId == firmId && row.Status == "draft", cancellationToken);
        if (product is null)
            return CatalogPriceResult.Rejected("DRAFT_INCONSISTENT", 503, "Taslak ürün okuma kaydı eksik.");
        var latest = await db.PriceVersions.AsNoTracking()
            .Where(row => row.FirmId == firmId && row.ProductId == draftId)
            .OrderByDescending(row => row.Number).FirstOrDefaultAsync(cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var version = new CatalogPriceVersionRow
        {
            Id = command.PriceVersionId, FirmId = firmId, BranchId = branchId,
            ProductId = draftId, Number = (latest?.Number ?? 0) + 1,
            AmountMinor = command.AmountMinor, Currency = "TRY", Actor = actor, CreatedAt = now,
        };
        db.PriceVersions.Add(version);
        product.BasePriceMinor = command.AmountMinor;
        product.Version++;
        product.UpdatedAt = now;
        draft.Version++;
        draft.UpdatedAt = now;
        db.DraftAudit.Add(new CatalogDraftAuditRow
        {
            DraftId = draftId, FirmId = firmId, BranchId = branchId,
            Actor = actor, Action = "price_set", Version = draft.Version, OccurredAt = now,
        });
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return CatalogPriceResult.Rejected("VERSION_CONFLICT", 409, "Taslak başka bir işlemle değişti.");
        }
        catch (DbUpdateException error) when (error.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return CatalogPriceResult.Rejected("PRICE_VERSION_CONFLICT", 409, "Fiyat sürümü kimliği zaten kullanılıyor.");
        }
        var detail = await queries.GetAsync(new CatalogScope(firmId, branchId), draftId, cancellationToken);
        return new CatalogPriceResult(detail, ToPriceInfo(version), null, true);
    }

    public async Task<CatalogPublicationResult> PublishAsync(
        string firmId, string branchId, Guid draftId, PublishProductDraft command,
        string actor, CancellationToken cancellationToken)
    {
        if (command.PublicationId == Guid.Empty)
            return CatalogPublicationResult.Rejected("INVALID_PUBLICATION", 400, "publicationId geçerli bir UUID olmalı.");
        if (command.ExpectedVersion < 1)
            return CatalogPublicationResult.Rejected("INVALID_VERSION", 400, "expectedVersion pozitif olmalı.");

        var existing = await db.Publications.AsNoTracking().FirstOrDefaultAsync(
            row => row.Id == command.PublicationId, cancellationToken);
        if (existing is not null)
            return await ExistingPublicationAsync(existing, firmId, branchId, draftId, cancellationToken);

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(),
            transaction.GetDbTransaction(), firmId, branchId, "catalog.publishing", cancellationToken);
        if (blocked is not null) return new CatalogPublicationResult(null, null, blocked, false);
        var draft = await db.Drafts.FromSqlInterpolated(
            $"SELECT * FROM catalog.drafts WHERE id = {draftId} AND firm_id = {firmId} AND branch_id = {branchId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);
        if (draft is null)
            return CatalogPublicationResult.Rejected("DRAFT_NOT_FOUND", 404, "Yayınlanacak taslak bu şubede bulunamadı.");
        if (draft.Version != command.ExpectedVersion)
            return CatalogPublicationResult.Rejected("VERSION_CONFLICT", 409, "Taslak başka bir işlemle değişti.");
        var product = await db.Products.SingleOrDefaultAsync(row =>
            row.Id == draftId && row.FirmId == firmId && row.Status == "draft", cancellationToken);
        if (product is null)
            return CatalogPublicationResult.Rejected("DRAFT_INCONSISTENT", 503, "Taslak ürün okuma kaydı eksik.");
        var price = await db.PriceVersions.AsNoTracking()
            .Where(row => row.FirmId == firmId && row.ProductId == draftId && row.BranchId == branchId)
            .OrderByDescending(row => row.Number).FirstOrDefaultAsync(cancellationToken);
        if (price is null || price.AmountMinor != product.BasePriceMinor || price.AmountMinor <= 0)
            return CatalogPublicationResult.Rejected("PRICE_REQUIRED", 409, "Yayınlamak için geçerli fiyat sürümü gerekli.");
        var now = DateTimeOffset.UtcNow;
        var publication = new CatalogPublicationRow
        {
            Id = command.PublicationId, FirmId = firmId, BranchId = branchId,
            ProductId = draftId, Number = 1, PriceVersionId = price.Id,
            ProductName = product.Name, Sku = product.Sku,
            CategoryId = product.CategoryId, CategoryName = product.CategoryName,
            AmountMinor = price.AmountMinor, Currency = price.Currency,
            Channels = ["pos"], Actor = actor, PublishedAt = now,
        };
        db.Publications.Add(publication);
        product.Status = "published";
        product.Channels = ["pos"];
        product.Version++;
        product.UpdatedAt = now;
        db.Drafts.Remove(draft);
        db.DraftAudit.Add(new CatalogDraftAuditRow
        {
            DraftId = draftId, FirmId = firmId, BranchId = branchId,
            Actor = actor, Action = "published", Version = product.Version, OccurredAt = now,
        });
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return CatalogPublicationResult.Rejected("VERSION_CONFLICT", 409, "Taslak başka bir işlemle değişti.");
        }
        catch (DbUpdateException error) when (error.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return CatalogPublicationResult.Rejected("PUBLICATION_CONFLICT", 409, "Yayın kimliği zaten kullanılıyor.");
        }
        var detail = await queries.GetAsync(new CatalogScope(firmId, branchId), draftId, cancellationToken);
        return new CatalogPublicationResult(detail, ToPublicationInfo(publication), null, true);
    }

    public async Task<IReadOnlyList<CatalogPriceVersionInfo>> PriceHistoryAsync(
        string firmId, string branchId, Guid productId, CancellationToken cancellationToken) =>
        (await db.PriceVersions.AsNoTracking()
            .Where(row => row.FirmId == firmId && row.BranchId == branchId && row.ProductId == productId)
            .OrderBy(row => row.Number).ToListAsync(cancellationToken))
            .Select(ToPriceInfo).ToArray();

    public async Task<IReadOnlyList<CatalogPublicationInfo>> PublicationHistoryAsync(
        string firmId, string branchId, Guid productId, CancellationToken cancellationToken) =>
        (await db.Publications.AsNoTracking()
            .Where(row => row.FirmId == firmId && row.BranchId == branchId && row.ProductId == productId)
            .OrderBy(row => row.Number).ToListAsync(cancellationToken))
            .Select(ToPublicationInfo).ToArray();

    private async Task<CatalogPriceResult> ExistingPriceAsync(
        CatalogPriceVersionRow row, string firmId, string branchId, Guid draftId,
        long amountMinor, CancellationToken cancellationToken)
    {
        if (row.FirmId != firmId || row.BranchId != branchId || row.ProductId != draftId || row.AmountMinor != amountMinor)
            return CatalogPriceResult.Rejected("PRICE_VERSION_CONFLICT", 409, "Fiyat sürümü kimliği başka bir kayıt için kullanılıyor.");
        var detail = await queries.GetAsync(new CatalogScope(firmId, branchId), draftId, cancellationToken);
        return new CatalogPriceResult(detail, ToPriceInfo(row), null, false);
    }

    private async Task<CatalogPublicationResult> ExistingPublicationAsync(
        CatalogPublicationRow row, string firmId, string branchId, Guid draftId,
        CancellationToken cancellationToken)
    {
        if (row.FirmId != firmId || row.BranchId != branchId || row.ProductId != draftId)
            return CatalogPublicationResult.Rejected("PUBLICATION_CONFLICT", 409, "Yayın kimliği başka bir kayıt için kullanılıyor.");
        var detail = await queries.GetAsync(new CatalogScope(firmId, branchId), draftId, cancellationToken);
        return new CatalogPublicationResult(detail, ToPublicationInfo(row), null, false);
    }

    private static CatalogPriceVersionInfo ToPriceInfo(CatalogPriceVersionRow row) =>
        new(row.Id.ToString(), row.ProductId.ToString(), row.Number, row.AmountMinor, row.Currency, row.CreatedAt);
    private static CatalogPublicationInfo ToPublicationInfo(CatalogPublicationRow row) =>
        new(row.Id.ToString(), row.ProductId.ToString(), row.Number, row.PriceVersionId.ToString(),
            row.AmountMinor, row.Currency, row.Channels, row.PublishedAt);
}
