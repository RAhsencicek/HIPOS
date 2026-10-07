using System.Security.Cryptography;
using System.Text;
using Hipos.Api.Catalog;
using Hipos.Api.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace Hipos.Api.Sales;

public sealed record CreatePosOrder(Guid OrderId, IReadOnlyList<PosOrderItem> Items);
public sealed record PosOrderItem(Guid ProductId, int Quantity);
public sealed record SalesOrderLine(
    string ProductId, string ProductName, string Sku, int Quantity,
    long UnitPriceMinor, long LineTotalMinor, string Currency);
public sealed record SalesOrderDetail(
    string Id, string FirmId, string BranchId, string Source, string Status,
    string PaymentStatus, long TotalMinor, long PaidMinor, long RemainingMinor, string Currency,
    DateTimeOffset CreatedAt, int Version, IReadOnlyList<SalesOrderLine> Items);
public sealed record SalesOrderResult(SalesOrderDetail? Order, FeatureFailure? Failure, bool Created)
{
    public static SalesOrderResult Rejected(string code, int status, string message) =>
        new(null, new FeatureFailure(code, status, message), false);
}

public sealed class SalesOrders(SalesDbContext db, CatalogQueries catalog, FeatureNewWorkGate gate)
{
    public async Task<SalesOrderResult> CreateAsync(
        string firmId, string branchId, CreatePosOrder command, string actor,
        CancellationToken cancellationToken)
    {
        if (command.OrderId == Guid.Empty || command.Items is null ||
            command.Items.Count is < 1 or > 20 ||
            command.Items.Any(item => item.ProductId == Guid.Empty || item.Quantity is < 1 or > 99) ||
            command.Items.Select(item => item.ProductId).Distinct().Count() != command.Items.Count)
            return SalesOrderResult.Rejected("INVALID_ORDER", 400, "Sipariş kimliği veya kalemleri geçersiz.");

        var sorted = command.Items.OrderBy(item => item.ProductId).ToArray();
        var fingerprint = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
            string.Join("|", sorted.Select(item => $"{item.ProductId:N}:{item.Quantity}")))));
        var existing = await db.Orders.AsNoTracking().Include(row => row.Lines).Include(row => row.PaymentAttempts)
            .FirstOrDefaultAsync(row => row.Id == command.OrderId, cancellationToken);
        if (existing is not null) return Existing(existing, firmId, branchId, fingerprint);

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(),
            transaction.GetDbTransaction(), firmId, branchId, "sales.pos_orders", cancellationToken);
        if (blocked is not null) return new SalesOrderResult(null, blocked, false);

        // Kaynak katalogdan alınır; istemci fiyat veya ürün adı gönderemez.
        var lines = new List<SalesOrderLineRow>();
        long total = 0;
        foreach (var item in sorted)
        {
            var product = await catalog.GetAsync(new CatalogScope(firmId, branchId),
                item.ProductId, cancellationToken);
            if (product is null || product.Status != "published" ||
                !product.Channels.Contains("pos") || product.Price.AmountMinor <= 0 ||
                product.Price.Currency != "TRY")
                return SalesOrderResult.Rejected("PRODUCT_NOT_SELLABLE", 409,
                    "Ürün bu şubede POS satışına açık değil veya geçerli fiyatı yok.");
            long lineTotal;
            try
            {
                lineTotal = checked(product.Price.AmountMinor * item.Quantity);
                total = checked(total + lineTotal);
            }
            catch (OverflowException)
            {
                return SalesOrderResult.Rejected("INVALID_ORDER", 400, "Sipariş tutarı geçersiz.");
            }
            lines.Add(new SalesOrderLineRow
            {
                OrderId = command.OrderId, ProductId = item.ProductId,
                ProductName = product.Name, Sku = product.Sku, Quantity = item.Quantity,
                UnitPriceMinor = product.Price.AmountMinor,
                LineTotalMinor = lineTotal, Currency = "TRY",
            });
        }

        var now = DateTimeOffset.UtcNow;
        var order = new SalesOrderRow
        {
            Id = command.OrderId, FirmId = firmId, BranchId = branchId,
            Source = "test_pos", Status = "open", PaymentStatus = "unpaid",
            TotalMinor = total, Currency = "TRY", RequestFingerprint = fingerprint,
            CreatedAt = now, Version = 1, Lines = lines,
        };
        db.Orders.Add(order);
        db.Audit.Add(new SalesOrderAuditRow
        {
            OrderId = order.Id, FirmId = firmId, BranchId = branchId,
            Actor = actor, Action = "created", Version = 1, OccurredAt = now,
        });
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException error) when (error.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return SalesOrderResult.Rejected("ORDER_ID_CONFLICT", 409,
                "Sipariş kimliği başka bir işlemde kullanıldı; güncel kaydı yükleyin.");
        }
        return new SalesOrderResult(ToDetail(order), null, true);
    }

    public async Task<IReadOnlyList<SalesOrderDetail>> ListAsync(
        string firmId, string? branchId, CancellationToken cancellationToken)
    {
        var query = db.Orders.AsNoTracking().Where(row => row.FirmId == firmId);
        if (branchId is not null) query = query.Where(row => row.BranchId == branchId);
        var rows = await query.Include(row => row.Lines).Include(row => row.PaymentAttempts)
            .OrderByDescending(row => row.CreatedAt).ThenByDescending(row => row.Id)
            .Take(100).ToListAsync(cancellationToken);
        return rows.Select(ToDetail).ToArray();
    }

    public async Task<SalesOrderDetail?> GetAsync(
        string firmId, string branchId, Guid orderId, CancellationToken cancellationToken)
    {
        var row = await db.Orders.AsNoTracking().Include(order => order.Lines)
            .Include(order => order.PaymentAttempts)
            .SingleOrDefaultAsync(order => order.Id == orderId && order.FirmId == firmId &&
                order.BranchId == branchId, cancellationToken);
        return row is null ? null : ToDetail(row);
    }

    private static SalesOrderResult Existing(
        SalesOrderRow row, string firmId, string branchId, string fingerprint) =>
        row.FirmId == firmId && row.BranchId == branchId && row.RequestFingerprint == fingerprint
            ? new SalesOrderResult(ToDetail(row), null, false)
            : SalesOrderResult.Rejected("ORDER_ID_CONFLICT", 409,
                "Sipariş kimliği başka bir kayıt için kullanılıyor.");

    public static SalesOrderDetail ToDetail(SalesOrderRow row) =>
        new(row.Id.ToString(), row.FirmId, row.BranchId, row.Source, row.Status,
            row.PaymentStatus, row.TotalMinor,
            row.PaymentAttempts.Where(attempt => attempt.Status == "succeeded").Sum(attempt => attempt.AmountMinor),
            row.TotalMinor - row.PaymentAttempts.Where(attempt => attempt.Status == "succeeded").Sum(attempt => attempt.AmountMinor),
            row.Currency, row.CreatedAt, row.Version,
            row.Lines.OrderBy(line => line.ProductId).Select(line =>
                new SalesOrderLine(line.ProductId.ToString(), line.ProductName, line.Sku,
                    line.Quantity, line.UnitPriceMinor, line.LineTotalMinor, line.Currency)).ToArray());
}
