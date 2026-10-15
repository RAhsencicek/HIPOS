using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Hipos.Api.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace Hipos.Api.Expenses;

public sealed record CreateExpense(string RequestId, string CategoryId, DateOnly ExpenseDate,
    long AmountMinor, string Description, string? Currency = null);
public sealed record ExpenseCategoryView(string Id, string Name, bool IsActive);
public sealed record ExpenseView(string Id, string CategoryId, string CategoryName, string ExpenseDate,
    long AmountMinor, string Currency, string Description, string Source, string Actor,
    DateTimeOffset CreatedAt);

public static class ExpenseEndpoints
{
    private const long MaxAmountMinor = 9_999_999_999_999;
    private const string FeatureKey = "finance.expenses";

    public static void MapExpenseEndpoints(this WebApplication app, bool ready)
    {
        var group = app.MapGroup("/api/v1/firms/{firmId}/branches/{branchId}");

        group.MapGet("/expense-categories", async (string firmId, string branchId,
            HttpContext context, ExpenseDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false);
            if (denied is not null) return denied;
            var items = await db.Categories.AsNoTracking()
                .Where(row => row.FirmId == firmId && row.IsActive)
                .OrderBy(row => row.Name)
                .Select(row => new ExpenseCategoryView(row.Id, row.Name, row.IsActive))
                .ToArrayAsync(context.RequestAborted);
            return Results.Ok(new { source = "postgres", items });
        });

        group.MapGet("/expenses", async (string firmId, string branchId,
            DateOnly? from, DateOnly? to, string? categoryId, int? page, int? pageSize,
            HttpContext context, ExpenseDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false);
            if (denied is not null) return denied;
            var requestedPage = page ?? 1;
            var requestedPageSize = pageSize ?? 25;
            if (requestedPage is < 1 or > 100000 || requestedPageSize is < 1 or > 100 ||
                (from.HasValue && to.HasValue && from > to))
                return Failure(context, "INVALID_QUERY", 400, "Tarih aralığı veya sayfalama değerleri geçersiz.");

            var query = db.Expenses.AsNoTracking().Where(row => row.FirmId == firmId && row.BranchId == branchId);
            if (from.HasValue) query = query.Where(row => row.ExpenseDate >= from.Value);
            if (to.HasValue) query = query.Where(row => row.ExpenseDate <= to.Value);
            if (!string.IsNullOrWhiteSpace(categoryId)) query = query.Where(row => row.CategoryId == categoryId);
            var total = await query.CountAsync(context.RequestAborted);
            var items = await query.Include(row => row.Category)
                .OrderByDescending(row => row.ExpenseDate).ThenByDescending(row => row.CreatedAt).ThenByDescending(row => row.Id)
                .Skip((requestedPage - 1) * requestedPageSize).Take(requestedPageSize)
                .Select(row => ToView(row)).ToArrayAsync(context.RequestAborted);
            return Results.Ok(new
            {
                source = "postgres", items,
                pageInfo = new { page = requestedPage, pageSize = requestedPageSize, totalItems = total,
                    totalPages = (int)Math.Ceiling(total / (double)requestedPageSize) },
                scope = new { firmId, branchId },
            });
        });

        group.MapGet("/expenses/{expenseId:guid}", async (string firmId, string branchId,
            Guid expenseId, HttpContext context, ExpenseDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false);
            if (denied is not null) return denied;
            var expense = await db.Expenses.AsNoTracking().Include(row => row.Category)
                .SingleOrDefaultAsync(row => row.Id == expenseId && row.FirmId == firmId && row.BranchId == branchId,
                    context.RequestAborted);
            return expense is null
                ? Failure(context, "EXPENSE_NOT_FOUND", 404, "Gider kaydı bu şubede bulunamadı.")
                : Results.Ok(new { source = "postgres", expense = ToView(expense) });
        });

        group.MapPost("/expenses", async (string firmId, string branchId,
            CreateExpense command, HttpContext context, ExpenseDbContext db, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            if (!Guid.TryParse(command.RequestId, out var requestId) || requestId == Guid.Empty ||
                string.IsNullOrWhiteSpace(command.CategoryId) || command.CategoryId.Length > 48 ||
                command.ExpenseDate == default || command.Currency is not (null or "TRY") ||
                command.AmountMinor is < 1 or > MaxAmountMinor ||
                string.IsNullOrWhiteSpace(command.Description) || command.Description.Trim().Length > 500)
                return Failure(context, command.Currency is not (null or "TRY") ? "CURRENCY_NOT_SUPPORTED" : "INVALID_EXPENSE",
                    400, "RequestId, kategori, tarih, pozitif TRY tutarı ve 1–500 karakter açıklama gereklidir.");

            var categoryId = command.CategoryId.Trim();
            var description = command.Description.Trim();
            var fingerprint = Fingerprint(categoryId, command.ExpenseDate, command.AmountMinor, description);
            var actor = DemoAccess.Resolve(context)!;
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);

            var existing = await db.Expenses.AsNoTracking().Include(row => row.Category)
                .SingleOrDefaultAsync(row => row.FirmId == firmId && row.RequestId == requestId, context.RequestAborted);
            if (existing is not null)
                return ExistingResponse(context, firmId, branchId, fingerprint, existing);

            var gateFailure = await gate.CheckAndLockAsync(db.Database.GetDbConnection(),
                transaction.GetDbTransaction(), firmId, branchId, FeatureKey, context.RequestAborted);
            if (gateFailure is not null)
                return Failure(context, gateFailure.Code, gateFailure.Status, gateFailure.Message);

            // Gate satırının kilidi aynı şubedeki eşzamanlı istekleri sıraya sokar.
            existing = await db.Expenses.AsNoTracking().Include(row => row.Category)
                .SingleOrDefaultAsync(row => row.FirmId == firmId && row.RequestId == requestId, context.RequestAborted);
            if (existing is not null)
                return ExistingResponse(context, firmId, branchId, fingerprint, existing);

            var categoryExists = await db.Categories.AsNoTracking().AnyAsync(row =>
                row.FirmId == firmId && row.Id == categoryId && row.IsActive, context.RequestAborted);
            if (!categoryExists)
                return Failure(context, "EXPENSE_CATEGORY_NOT_FOUND", 400, "Aktif gider kategorisi bu firmada bulunamadı.");

            var now = DateTimeOffset.UtcNow;
            var expense = new ExpenseRow
            {
                Id = requestId, RequestId = requestId, FirmId = firmId, BranchId = branchId,
                CategoryId = categoryId, ExpenseDate = command.ExpenseDate, AmountMinor = command.AmountMinor,
                Currency = "TRY", Description = description, Source = "manual", Actor = actor.Name,
                RequestFingerprint = fingerprint, CreatedAt = now,
            };
            db.Expenses.Add(expense);
            db.Audit.Add(new ExpenseAuditRow
            {
                FirmId = firmId, BranchId = branchId, RequestId = requestId, EntityId = requestId,
                Action = "expense_created", Actor = actor.Name,
                Detail = $"categoryId={categoryId};expenseDate={command.ExpenseDate:yyyy-MM-dd};amountMinor={command.AmountMinor};currency=TRY;source=manual",
                OccurredAt = now,
            });
            try
            {
                await db.SaveChangesAsync(context.RequestAborted);
                await transaction.CommitAsync(context.RequestAborted);
            }
            catch (DbUpdateException error) when (IsUniqueViolation(error))
            {
                await transaction.RollbackAsync(context.RequestAborted);
                db.ChangeTracker.Clear();
                var raced = await db.Expenses.AsNoTracking().Include(row => row.Category)
                    .SingleOrDefaultAsync(row => row.FirmId == firmId && row.RequestId == requestId, context.RequestAborted);
                if (raced is not null) return ExistingResponse(context, firmId, branchId, fingerprint, raced);
                return Failure(context, "IDEMPOTENCY_CONFLICT", 409, "RequestId başka bir gider kaydında kullanılıyor.");
            }

            await db.Entry(expense).Reference(row => row.Category).LoadAsync(context.RequestAborted);
            return Results.Created($"/api/v1/firms/{firmId}/branches/{branchId}/expenses/{expense.Id}",
                new { source = "postgres", expense = ToView(expense) });
        });
    }

    private static IResult? Guard(HttpContext context, string firmId, string branchId, bool ready, bool write)
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanRead(firmId, branchId)) return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu firma/şube giderlerine erişim izni yok.");
        if (write && !actor.CanManage) return Failure(context, "FORBIDDEN", 403, "Gider kaydı oluşturma yetkisi yok.");
        if (!ready) return Failure(context, "EXPENSE_STORAGE_UNAVAILABLE", 503, "Gider migration'ı uygulanmalı ve API yeniden başlatılmalı.");
        return null;
    }

    private static IResult ExistingResponse(HttpContext context, string firmId, string branchId,
        string fingerprint, ExpenseRow existing)
    {
        if (existing.FirmId != firmId || existing.BranchId != branchId || existing.RequestFingerprint != fingerprint)
            return Failure(context, "IDEMPOTENCY_CONFLICT", 409, "RequestId farklı kapsamda veya farklı içerikle kullanılmış.");
        return Results.Ok(new { source = "postgres", expense = ToView(existing) });
    }

    private static ExpenseView ToView(ExpenseRow row) => new(row.Id.ToString(), row.CategoryId,
        row.Category.Name, row.ExpenseDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        row.AmountMinor, row.Currency, row.Description, row.Source, row.Actor, row.CreatedAt);

    private static string Fingerprint(string categoryId, DateOnly date, long amountMinor, string description)
    {
        var canonical = $"{categoryId}\n{date:yyyy-MM-dd}\n{amountMinor}\nTRY\n{description}";
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical))).ToLowerInvariant();
    }

    private static bool IsUniqueViolation(DbUpdateException error) =>
        error.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };

    private static IResult Failure(HttpContext context, string code, int status, string message) =>
        Results.Json(new { error = new { code, message, traceId = context.TraceIdentifier } }, statusCode: status);
}
