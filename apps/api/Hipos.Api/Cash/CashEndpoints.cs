using System.Data.Common;
using Hipos.Api.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace Hipos.Api.Cash;

public sealed record OpenCashShift(string RequestId, string RegisterId, long OpeningCashMinor);
public sealed record AddCashMovement(string RequestId, string Kind, long AmountMinor, string Category, string Description);
public sealed record CloseCashShift(string RequestId, int ExpectedVersion, long CountedCashMinor, string? Note);
public sealed record CashRegisterView(string Id, string Code, string Name, string ProviderMode, bool IsActive);
public sealed record CashMovementView(string Id, string RegisterId, string ShiftId, string Kind, string Category,
    long AmountMinor, string Currency, string Description, string Source, string Actor, DateTimeOffset CreatedAt);
public sealed record CashShiftView(string Id, string RegisterId, string Status, long OpeningCashMinor,
    long? ExpectedCashMinor, long? CountedCashMinor, long? DifferenceMinor, string OpenedBy,
    DateTimeOffset OpenedAt, string? ClosedBy, DateTimeOffset? ClosedAt, string? CloseNote, int Version);

public static class CashEndpoints
{
    public static void MapCashEndpoints(this WebApplication app, bool ready)
    {
        var group = app.MapGroup("/api/v1/firms/{firmId}/branches/{branchId}/cash");

        group.MapGet("/registers", async (string firmId, string branchId, HttpContext context, CashDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false);
            if (denied is not null) return denied;
            var items = await db.Registers.AsNoTracking()
                .Where(row => row.FirmId == firmId && row.BranchId == branchId && row.IsActive)
                .OrderBy(row => row.Code).ToListAsync(context.RequestAborted);
            return Results.Ok(new { source = "postgres", items = items.Select(ToView).ToArray() });
        });

        group.MapGet("/overview", async (string firmId, string branchId, HttpContext context, CashDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false);
            if (denied is not null) return denied;
            var registers = await db.Registers.AsNoTracking()
                .Where(row => row.FirmId == firmId && row.BranchId == branchId && row.IsActive)
                .OrderBy(row => row.Code).ToListAsync(context.RequestAborted);
            var activeShifts = await db.Shifts.AsNoTracking()
                .Where(row => row.FirmId == firmId && row.BranchId == branchId && row.Status == "open")
                .OrderBy(row => row.OpenedAt).ToListAsync(context.RequestAborted);
            var open = new List<object>();
            foreach (var shift in activeShifts)
            {
                var movements = await db.Movements.AsNoTracking()
                    .Where(row => row.FirmId == firmId && row.BranchId == branchId && row.ShiftId == shift.Id)
                    .ToListAsync(context.RequestAborted);
                var expected = Expected(movements);
                open.Add(new
                {
                    shift = ToView(shift) with { ExpectedCashMinor = expected },
                    cashInMinor = movements.Where(row => row.Kind == "manual_in").Sum(row => row.AmountMinor),
                    cashOutMinor = movements.Where(row => row.Kind == "manual_out").Sum(row => row.AmountMinor),
                    movementCount = movements.Count,
                    recentMovements = movements.OrderByDescending(row => row.CreatedAt).ThenByDescending(row => row.Id)
                        .Take(5).Select(ToView).ToArray(),
                });
            }
            return Results.Ok(new { source = "postgres", simulated = false,
                registers = registers.Select(ToView).ToArray(), openShifts = open });
        });

        group.MapGet("/movements", async (string firmId, string branchId, Guid? shiftId, DateTimeOffset? from,
            DateTimeOffset? to, int? page, int? pageSize, HttpContext context, CashDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false);
            if (denied is not null) return denied;
            var requestedPage = page ?? 1;
            var requestedSize = pageSize ?? 50;
            if (requestedPage is < 1 or > 100000 || requestedSize is < 1 or > 100)
                return Fail(context, "INVALID_PAGINATION", 400, "page 1–100000, pageSize 1–100 arasında olmalı.");
            if (from.HasValue && to.HasValue && from > to)
                return Fail(context, "INVALID_DATE_RANGE", 400, "Başlangıç tarihi bitiş tarihinden sonra olamaz.");
            var query = db.Movements.AsNoTracking().Where(row => row.FirmId == firmId && row.BranchId == branchId);
            if (shiftId.HasValue) query = query.Where(row => row.ShiftId == shiftId.Value);
            if (from.HasValue) query = query.Where(row => row.CreatedAt >= from.Value);
            if (to.HasValue) query = query.Where(row => row.CreatedAt <= to.Value);
            var total = await query.CountAsync(context.RequestAborted);
            var items = await query.OrderByDescending(row => row.CreatedAt).ThenByDescending(row => row.Id)
                .Skip((requestedPage - 1) * requestedSize).Take(requestedSize)
                .ToListAsync(context.RequestAborted);
            return Results.Ok(new { source = "postgres", page = requestedPage, pageSize = requestedSize, total, items = items.Select(ToView).ToArray() });
        });

        group.MapGet("/shifts", async (string firmId, string branchId, string? status, DateTimeOffset? from,
            DateTimeOffset? to, int? page, int? pageSize, HttpContext context, CashDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false);
            if (denied is not null) return denied;
            var requestedPage = page ?? 1;
            var requestedSize = pageSize ?? 50;
            if (requestedPage is < 1 or > 100000 || requestedSize is < 1 or > 100 ||
                status is not (null or "open" or "closed") || from.HasValue && to.HasValue && from > to)
                return Fail(context, "INVALID_SHIFT_QUERY", 400, "Vardiya filtresi veya sayfalama geçersiz.");
            var query = db.Shifts.AsNoTracking().Where(row => row.FirmId == firmId && row.BranchId == branchId);
            if (status is not null) query = query.Where(row => row.Status == status);
            if (from.HasValue) query = query.Where(row => row.OpenedAt >= from.Value);
            if (to.HasValue) query = query.Where(row => row.OpenedAt <= to.Value);
            var total = await query.CountAsync(context.RequestAborted);
            var items = await query.OrderByDescending(row => row.OpenedAt).ThenByDescending(row => row.Id)
                .Skip((requestedPage - 1) * requestedSize).Take(requestedSize)
                .ToListAsync(context.RequestAborted);
            return Results.Ok(new { source = "postgres", page = requestedPage, pageSize = requestedSize, total, items = items.Select(ToView).ToArray() });
        });

        group.MapPost("/shifts", async (string firmId, string branchId, OpenCashShift command, HttpContext context,
            CashDbContext db, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            if (!Guid.TryParse(command.RequestId, out var requestId) || requestId == Guid.Empty ||
                !Guid.TryParse(command.RegisterId, out var registerId) || registerId == Guid.Empty ||
                command.OpeningCashMinor < 0 || command.OpeningCashMinor > MaxAmountMinor)
                return Fail(context, "INVALID_CASH_AMOUNT", 400, "İstek/kasa kimliği veya açılış tutarı geçersiz.");

            var actor = DemoAccess.Resolve(context)!;
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await Gate(db, gate, transaction.GetDbTransaction(), firmId, branchId, context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            var existing = await db.Shifts.AsNoTracking().SingleOrDefaultAsync(row => row.Id == requestId, context.RequestAborted);
            if (existing is not null)
                return existing.FirmId == firmId && existing.BranchId == branchId && existing.RegisterId == registerId &&
                    existing.OpeningCashMinor == command.OpeningCashMinor
                    ? Results.Ok(new { source = "postgres", simulated = false, shift = ToView(existing) })
                    : Fail(context, "IDEMPOTENCY_CONFLICT", 409, "İstek kimliği farklı içerikle kullanılmış.");
            var register = await LockRegister(db, firmId, branchId, registerId, context.RequestAborted);
            if (register is null || !register.IsActive)
                return Fail(context, "REGISTER_NOT_FOUND", 404, "Etkin kasa bu şubede bulunamadı.");
            var existingOpen = await db.Shifts.AsNoTracking().AnyAsync(row => row.FirmId == firmId &&
                row.BranchId == branchId && row.RegisterId == registerId && row.Status == "open", context.RequestAborted);
            if (existingOpen) return Fail(context, "SHIFT_ALREADY_OPEN", 409, "Bu kasada zaten açık vardiya var.");
            var now = DateTimeOffset.UtcNow;
            var shift = new CashShiftRow { Id = requestId, FirmId = firmId, BranchId = branchId,
                RegisterId = registerId, Status = "open", OpeningCashMinor = command.OpeningCashMinor,
                OpenedBy = actor.Name, OpenedAt = now, Version = 1 };
            var opening = new CashMovementRow { Id = requestId, FirmId = firmId, BranchId = branchId,
                RegisterId = registerId, ShiftId = requestId, Kind = "opening_float", Category = "opening",
                AmountMinor = command.OpeningCashMinor, Currency = "TRY",
                Description = "Vardiya açılış nakdi", Source = "manual", Actor = actor.Name, CreatedAt = now };
            db.Shifts.Add(shift);
            db.Movements.Add(opening);
            db.Audit.Add(new CashAuditRow { FirmId = firmId, BranchId = branchId, RegisterId = registerId,
                ShiftId = requestId, RequestId = requestId, EntityType = "shift", EntityId = requestId,
                Action = "shift_opened", Actor = actor.Name, Detail = $"openingCashMinor={command.OpeningCashMinor}", OccurredAt = now });
            try
            {
                await db.SaveChangesAsync(context.RequestAborted);
                await transaction.CommitAsync(context.RequestAborted);
            }
            catch (DbUpdateException error) when (Unique(error))
            {
                return Fail(context, "SHIFT_ALREADY_OPEN", 409, "Bu kasada aynı anda yalnız bir vardiya açılabilir.");
            }
            return Results.Created($"/api/v1/firms/{firmId}/branches/{branchId}/cash/shifts/{shift.Id}",
                new { source = "postgres", simulated = false, shift = ToView(shift) });
        });

        group.MapPost("/shifts/{shiftId:guid}/movements", async (string firmId, string branchId, Guid shiftId,
            AddCashMovement command, HttpContext context, CashDbContext db, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            var description = command.Description?.Trim() ?? "";
            var validCategory = command.Kind switch
            {
                "manual_in" => command.Category is "cash_sale" or "other",
                "manual_out" => command.Category is "expense" or "cash_drop" or "other",
                _ => false,
            };
            if (!Guid.TryParse(command.RequestId, out var requestId) || requestId == Guid.Empty ||
                command.AmountMinor is <= 0 or > MaxAmountMinor || !validCategory || description.Length is < 3 or > 500)
                return Fail(context, "INVALID_CASH_MOVEMENT", 400, "Nakit hareketinin türü, tutarı, kategorisi veya açıklaması geçersiz.");
            var actor = DemoAccess.Resolve(context)!;
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await Gate(db, gate, transaction.GetDbTransaction(), firmId, branchId, context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            var existing = await db.Movements.AsNoTracking().SingleOrDefaultAsync(row => row.Id == requestId, context.RequestAborted);
            if (existing is not null)
                return existing.FirmId == firmId && existing.BranchId == branchId && existing.ShiftId == shiftId &&
                    existing.Kind == command.Kind && existing.Category == command.Category && existing.AmountMinor == command.AmountMinor &&
                    existing.Description == description
                    ? Results.Ok(new { source = "postgres", simulated = false, movement = ToView(existing) })
                    : Fail(context, "IDEMPOTENCY_CONFLICT", 409, "İstek kimliği farklı içerikle kullanılmış.");
            var shift = await LockShift(db, firmId, branchId, shiftId, context.RequestAborted);
            if (shift is null) return Fail(context, "SHIFT_NOT_FOUND", 404, "Vardiya bu şubede bulunamadı.");
            if (shift.Status != "open") return Fail(context, "SHIFT_CLOSED", 409, "Kapalı vardiyaya nakit hareketi eklenemez.");
            if (command.Kind == "manual_out")
            {
                var priorMovements = await db.Movements.AsNoTracking()
                    .Where(row => row.FirmId == firmId && row.BranchId == branchId && row.ShiftId == shiftId)
                    .ToListAsync(context.RequestAborted);
                if (command.AmountMinor > Expected(priorMovements))
                    return Fail(context, "INSUFFICIENT_CASH", 409, "Nakit çıkışı kasada beklenen tutarı aşamaz.");
            }
            var now = DateTimeOffset.UtcNow;
            var row = new CashMovementRow { Id = requestId, FirmId = firmId, BranchId = branchId,
                RegisterId = shift.RegisterId, ShiftId = shift.Id, Kind = command.Kind, Category = command.Category,
                AmountMinor = command.AmountMinor, Currency = "TRY", Description = description,
                Source = "manual", Actor = actor.Name, CreatedAt = now };
            db.Movements.Add(row);
            shift.Version++;
            db.Audit.Add(new CashAuditRow { FirmId = firmId, BranchId = branchId, RegisterId = shift.RegisterId,
                ShiftId = shift.Id, RequestId = requestId, EntityType = "movement", EntityId = row.Id,
                Action = "movement_added", Actor = actor.Name,
                Detail = $"{row.Kind};category={row.Category};amountMinor={row.AmountMinor};{description}", OccurredAt = now });
            try
            {
                await db.SaveChangesAsync(context.RequestAborted);
                await transaction.CommitAsync(context.RequestAborted);
            }
            catch (DbUpdateException error) when (Unique(error))
            {
                return Fail(context, "IDEMPOTENCY_CONFLICT", 409, "İstek kimliği başka bir kasa işleminde kullanılmış.");
            }
            return Results.Created($"/api/v1/firms/{firmId}/branches/{branchId}/cash/movements/{row.Id}",
                new { source = "postgres", simulated = false, movement = ToView(row) });
        });

        group.MapPost("/shifts/{shiftId:guid}/close", async (string firmId, string branchId, Guid shiftId,
            CloseCashShift command, HttpContext context, CashDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            var note = command.Note?.Trim();
            if (!Guid.TryParse(command.RequestId, out var requestId) || requestId == Guid.Empty ||
                command.ExpectedVersion < 1 || command.CountedCashMinor is < 0 or > MaxAmountMinor)
                return Fail(context, "INVALID_CASH_AMOUNT", 400, "Kapanış isteği, sürüm veya sayım tutarı geçersiz.");
            var actor = DemoAccess.Resolve(context)!;
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var shift = await LockShift(db, firmId, branchId, shiftId, context.RequestAborted);
            if (shift is null) return Fail(context, "SHIFT_NOT_FOUND", 404, "Vardiya bu şubede bulunamadı.");
            if (shift.Status == "closed")
            {
                return shift.CloseRequestId == requestId && shift.CountedCashMinor == command.CountedCashMinor && shift.CloseNote == note
                    ? Results.Ok(new { source = "postgres", simulated = false, shift = ToView(shift) })
                    : Fail(context, "SHIFT_CLOSED", 409, "Vardiya zaten kapatılmış.");
            }
            if (shift.Version != command.ExpectedVersion)
                return Fail(context, "VERSION_CONFLICT", 409, "Vardiya başka bir işlemle değişti; güncel bilgiyi yenileyin.");
            var movements = await db.Movements.AsNoTracking()
                .Where(row => row.FirmId == firmId && row.BranchId == branchId && row.ShiftId == shiftId)
                .ToListAsync(context.RequestAborted);
            var expected = Expected(movements);
            var difference = command.CountedCashMinor - expected;
            if (difference != 0 && string.IsNullOrWhiteSpace(note))
                return Fail(context, "CASH_DIFFERENCE_NOTE_REQUIRED", 400, "Kasa farkı için açıklama zorunludur.");
            var now = DateTimeOffset.UtcNow;
            shift.Status = "closed";
            shift.ExpectedCashMinor = expected;
            shift.CountedCashMinor = command.CountedCashMinor;
            shift.DifferenceMinor = difference;
            shift.CloseNote = note;
            shift.CloseRequestId = requestId;
            shift.ClosedBy = actor.Name;
            shift.ClosedAt = now;
            shift.Version++;
            db.Audit.Add(new CashAuditRow { FirmId = firmId, BranchId = branchId, RegisterId = shift.RegisterId,
                ShiftId = shift.Id, RequestId = requestId, EntityType = "shift", EntityId = shift.Id,
                Action = "shift_closed", Actor = actor.Name,
                Detail = $"expected={expected};counted={command.CountedCashMinor};difference={difference};note={note}", OccurredAt = now });
            try
            {
                await db.SaveChangesAsync(context.RequestAborted);
                await transaction.CommitAsync(context.RequestAborted);
            }
            catch (DbUpdateConcurrencyException)
            {
                return Fail(context, "VERSION_CONFLICT", 409, "Vardiya başka bir işlemle değişti.");
            }
            catch (DbUpdateException error) when (Unique(error))
            {
                return Fail(context, "IDEMPOTENCY_CONFLICT", 409, "Kapanış istek kimliği başka işlemde kullanılmış.");
            }
            return Results.Ok(new { source = "postgres", simulated = false, shift = ToView(shift) });
        });
    }

    private const long MaxAmountMinor = 999_999_999_999;

    private static long Expected(IEnumerable<CashMovementRow> rows) => rows.Sum(row => row.Kind switch
    {
        "opening_float" or "manual_in" => row.AmountMinor,
        "manual_out" => -row.AmountMinor,
        _ => 0,
    });

    private static CashRegisterView ToView(CashRegisterRow row) =>
        new(row.Id.ToString(), row.Code, row.Name, row.ProviderMode, row.IsActive);

    private static CashMovementView ToView(CashMovementRow row) =>
        new(row.Id.ToString(), row.RegisterId.ToString(), row.ShiftId.ToString(), row.Kind, row.Category,
            row.AmountMinor, row.Currency, row.Description, row.Source, row.Actor, row.CreatedAt);

    private static CashShiftView ToView(CashShiftRow row) =>
        new(row.Id.ToString(), row.RegisterId.ToString(), row.Status, row.OpeningCashMinor,
            row.ExpectedCashMinor, row.CountedCashMinor, row.DifferenceMinor, row.OpenedBy,
            row.OpenedAt, row.ClosedBy, row.ClosedAt, row.CloseNote, row.Version);

    private static async Task<CashRegisterRow?> LockRegister(CashDbContext db, string firmId, string branchId,
        Guid registerId, CancellationToken cancellationToken) =>
        await db.Registers.FromSqlInterpolated($"SELECT * FROM cash.registers WHERE firm_id = {firmId} AND branch_id = {branchId} AND id = {registerId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);

    private static async Task<CashShiftRow?> LockShift(CashDbContext db, string firmId, string branchId,
        Guid shiftId, CancellationToken cancellationToken) =>
        await db.Shifts.FromSqlInterpolated($"SELECT * FROM cash.shifts WHERE firm_id = {firmId} AND branch_id = {branchId} AND id = {shiftId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);

    private static async Task<FeatureFailure?> Gate(CashDbContext db, FeatureNewWorkGate gate,
        DbTransaction transaction, string firmId, string branchId, CancellationToken cancellationToken) =>
        await gate.CheckAndLockAsync(db.Database.GetDbConnection(), transaction, firmId, branchId,
            "cash.management", cancellationToken);

    private static bool Unique(DbUpdateException error) =>
        error.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };

    private static IResult? Guard(HttpContext context, string firmId, string branchId, bool ready, bool write)
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Fail(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanRead(firmId, branchId) || write && !actor.CanManage)
            return Fail(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubede kasa erişim izni yok.");
        if (!ready) return Fail(context, "CASH_STORAGE_UNAVAILABLE", 503, "Kasa migration'ı uygulanmalı ve API yeniden başlatılmalı.");
        return null;
    }

    private static IResult Fail(HttpContext context, string code, int status, string detail) => Results.Json(new
    {
        type = $"https://hipos.local/problems/{code.ToLowerInvariant().Replace('_', '-')}",
        title = status switch { 401 => "Oturum gerekli", 403 => "Yetkisiz kapsam", 404 => "Bulunamadı", 409 => "İşlem çakışması", 503 => "Kurulum gerekiyor", _ => "İstek hatası" },
        status, detail, instance = context.Request.Path.Value, code, traceId = context.TraceIdentifier,
    }, statusCode: status, contentType: "application/problem+json");
}
