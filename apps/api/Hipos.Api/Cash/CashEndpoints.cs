using System.Data.Common;
using Hipos.Api.Features;
using Hipos.Api.Sales;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace Hipos.Api.Cash;

public sealed record OpenCashShift(string RequestId, string RegisterId, long OpeningCashMinor, string? Note = null);
public sealed record ProvisionDefaultCashRegister(string RequestId);
public sealed record AddCashMovement(string RequestId, string Kind, long AmountMinor, string Category, string Description);
public sealed record CorrectCashMovement(string RequestId, string CorrectionType, string CorrectionReason);
public sealed record CashDenominationCount(int DenominationMinor, int Quantity);
public sealed record CashDenominationView(int DenominationMinor, int Quantity, long TotalMinor);
public sealed record CloseCashShift(string RequestId, int ExpectedVersion, long CountedCashMinor, string? Note,
    IReadOnlyList<CashDenominationCount>? Denominations = null);
public sealed record CashRegisterView(string Id, string Code, string Name, string ProviderMode, bool IsActive);
public sealed record CashMovementView(string Id, string RegisterId, string ShiftId, string Kind, string Category,
    long AmountMinor, string Currency, string Description, string Source, string Actor, DateTimeOffset CreatedAt,
    string? TenderMethod,
    string? OriginalMovementId, string? CorrectionType, string? CorrectionReason);
public sealed record CashShiftView(string Id, string RegisterId, string Status, long OpeningCashMinor,
    long? ExpectedCashMinor, long? CountedCashMinor, long? DifferenceMinor, string OpenedBy,
    DateTimeOffset OpenedAt, string? ClosedBy, DateTimeOffset? ClosedAt, string? CloseNote, int Version, string? OpeningNote,
    IReadOnlyList<CashDenominationView>? Denominations = null);

public static class CashEndpoints
{
    public static void MapCashEndpoints(this WebApplication app, bool ready, bool allowDemoOperatorShifts)
    {
        var group = app.MapGroup("/api/v1/firms/{firmId}/branches/{branchId}/cash");

        group.MapPut("/registers/default", async (string firmId, string branchId, ProvisionDefaultCashRegister command,
            HttpContext context, CashProvisioningService provisioning) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            if (!Guid.TryParse(command.RequestId, out var requestId) || requestId == Guid.Empty)
                return Fail(context, "INVALID_REQUEST_ID", 400, "Geçerli bir requestId gereklidir.");
            var actor = DemoAccess.Resolve(context)!;
            var result = await provisioning.EnsureDefaultRegisterAsync(firmId, branchId, requestId,
                actor.Name, context.RequestAborted);
            if (result.ErrorCode == "DEFAULT_REGISTER_CONFLICT")
                return Fail(context, result.ErrorCode, 409, "MAIN kodlu kasa varsayılan özelliklerle uyuşmuyor.");
            if (result.ErrorCode == "EXISTING_REGISTER")
                return Fail(context, result.ErrorCode, 409, "Bu şubede zaten aktif bir kasa var; ikinci kasa oluşturulmadı.");
            return result.Created
                ? Results.Created($"/api/v1/firms/{firmId}/branches/{branchId}/cash/registers/{result.Register!.Id}",
                    new { source = "postgres", register = ToView(result.Register) })
                : Results.Ok(new { source = "postgres", register = ToView(result.Register!) });
        });

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
                    cashInMinor = movements.Where(row => row.Kind == "manual_in" || row.Kind == "pos_sale" && row.TenderMethod == "cash").Sum(row => row.AmountMinor),
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
            var ids = items.Select(row => row.Id).ToArray();
            var denominations = await db.ShiftDenominations.AsNoTracking().Where(row => row.FirmId == firmId &&
                row.BranchId == branchId && ids.Contains(row.ShiftId)).OrderByDescending(row => row.DenominationMinor)
                .ToListAsync(context.RequestAborted);
            var denominationsByShift = denominations.GroupBy(row => row.ShiftId)
                .ToDictionary(group => group.Key, group => (IReadOnlyList<CashDenominationView>)group.Select(ToView).ToArray());
            return Results.Ok(new { source = "postgres", page = requestedPage, pageSize = requestedSize, total,
                items = items.Select(row => ToView(row, denominationsByShift.GetValueOrDefault(row.Id))).ToArray() });
        });

        group.MapPost("/shifts", async (string firmId, string branchId, OpenCashShift command, HttpContext context,
            CashDbContext db, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true, allowDemoOperatorShifts);
            if (denied is not null) return denied;
            if (!Guid.TryParse(command.RequestId, out var requestId) || requestId == Guid.Empty ||
                !Guid.TryParse(command.RegisterId, out var registerId) || registerId == Guid.Empty ||
                command.OpeningCashMinor < 0 || command.OpeningCashMinor > MaxAmountMinor || command.Note?.Trim().Length > 500)
                return Fail(context, "INVALID_CASH_AMOUNT", 400, "İstek/kasa kimliği veya açılış tutarı geçersiz.");

            var actor = DemoAccess.Resolve(context)!;
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await Gate(db, gate, transaction.GetDbTransaction(), firmId, branchId, context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            var existing = await db.Shifts.AsNoTracking().SingleOrDefaultAsync(row => row.Id == requestId, context.RequestAborted);
            if (existing is not null)
                return existing.FirmId == firmId && existing.BranchId == branchId && existing.RegisterId == registerId &&
                    existing.OpeningCashMinor == command.OpeningCashMinor && existing.OpeningNote == (string.IsNullOrWhiteSpace(command.Note) ? null : command.Note.Trim())
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
                RegisterId = registerId, Status = "open", OpeningCashMinor = command.OpeningCashMinor, OpeningNote = string.IsNullOrWhiteSpace(command.Note) ? null : command.Note.Trim(),
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

        group.MapPost("/movements/{originalMovementId:guid}/corrections", async (string firmId, string branchId,
            Guid originalMovementId, CorrectCashMovement command, HttpContext context, CashDbContext db,
            FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            var reason = command.CorrectionReason?.Trim() ?? "";
            if (!Guid.TryParse(command.RequestId, out var requestId) || requestId == Guid.Empty ||
                command.CorrectionType != "reversal" || reason.Length is < 3 or > 500)
                return Fail(context, "INVALID_CORRECTION", 400, "Yalnız reversal desteklenir; gerekçe 3–500 karakter olmalıdır.");

            var actor = DemoAccess.Resolve(context)!;
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await Gate(db, gate, transaction.GetDbTransaction(), firmId, branchId, context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);

            var existingByRequest = await db.Movements.AsNoTracking()
                .SingleOrDefaultAsync(row => row.Id == requestId, context.RequestAborted);
            if (existingByRequest is not null)
                return existingByRequest.FirmId == firmId && existingByRequest.BranchId == branchId &&
                    existingByRequest.OriginalMovementId == originalMovementId &&
                    existingByRequest.CorrectionType == command.CorrectionType && existingByRequest.CorrectionReason == reason
                    ? Results.Ok(new { source = "postgres", simulated = false, movement = ToView(existingByRequest) })
                    : Fail(context, "IDEMPOTENCY_CONFLICT", 409, "İstek kimliği farklı bir işlemde kullanılmış.");

            var original = await LockMovement(db, firmId, branchId, originalMovementId, context.RequestAborted);
            if (original is null) return Fail(context, "MOVEMENT_NOT_CORRECTABLE", 404, "Düzeltilebilir hareket bu şubede bulunamadı.");
            if (original.Source != "manual" || original.Kind is not ("manual_in" or "manual_out") ||
                original.OriginalMovementId is not null)
                return Fail(context, "MOVEMENT_NOT_CORRECTABLE", 409, "Yalnızca daha önce düzeltilmemiş manuel giriş/çıkış düzeltilebilir.");

            var register = await LockRegister(db, firmId, branchId, original.RegisterId, context.RequestAborted);
            if (register is null || !register.IsActive)
                return Fail(context, "REGISTER_NOT_FOUND", 404, "Kasa bu şubede bulunamadı.");
            var alreadyCorrected = await db.Movements.AsNoTracking().AnyAsync(row => row.FirmId == firmId &&
                row.BranchId == branchId && row.RegisterId == original.RegisterId &&
                row.OriginalMovementId == original.Id, context.RequestAborted);
            if (alreadyCorrected) return Fail(context, "MOVEMENT_ALREADY_CORRECTED", 409, "Bu hareket daha önce ters kayıtla düzeltildi.");

            var shift = await db.Shifts.FromSqlInterpolated($"SELECT * FROM cash.shifts WHERE firm_id = {firmId} AND branch_id = {branchId} AND register_id = {original.RegisterId} AND status = 'open' FOR UPDATE")
                .SingleOrDefaultAsync(context.RequestAborted);
            if (shift is null) return Fail(context, "OPEN_SHIFT_REQUIRED", 409, "Düzeltme için aynı kasada açık vardiya gereklidir.");

            var reversedKind = original.Kind == "manual_in" ? "manual_out" : "manual_in";
            if (reversedKind == "manual_out")
            {
                var currentMovements = await db.Movements.AsNoTracking().Where(row => row.FirmId == firmId &&
                    row.BranchId == branchId && row.ShiftId == shift.Id).ToListAsync(context.RequestAborted);
                if (original.AmountMinor > Expected(currentMovements))
                    return Fail(context, "INSUFFICIENT_CASH", 409, "Bu ters kayıt açık vardiyadaki nakdi aşacağı için uygulanamıyor.");
            }

            var now = DateTimeOffset.UtcNow;
            var correction = new CashMovementRow
            {
                Id = requestId, FirmId = firmId, BranchId = branchId, RegisterId = register.Id,
                ShiftId = shift.Id, Kind = reversedKind, Category = "other", AmountMinor = original.AmountMinor,
                Currency = original.Currency, Description = "Ters kayıt", Source = "manual",
                OriginalMovementId = original.Id, CorrectionType = "reversal", CorrectionReason = reason,
                Actor = actor.Name, CreatedAt = now,
            };
            db.Movements.Add(correction);
            shift.Version++;
            db.Audit.Add(new CashAuditRow
            {
                FirmId = firmId, BranchId = branchId, RegisterId = register.Id, ShiftId = shift.Id,
                RequestId = requestId, EntityType = "movement", EntityId = correction.Id,
                Action = "movement_reversed", Actor = actor.Name,
                Detail = $"originalMovementId={original.Id};correctionType=reversal;amountMinor={original.AmountMinor};reason={reason}",
                OccurredAt = now,
            });
            try
            {
                await db.SaveChangesAsync(context.RequestAborted);
                await transaction.CommitAsync(context.RequestAborted);
            }
            catch (DbUpdateException error) when (Unique(error))
            {
                await transaction.RollbackAsync(context.RequestAborted);
                var racedCorrection = await db.Movements.AsNoTracking().AnyAsync(row => row.FirmId == firmId &&
                    row.BranchId == branchId && row.RegisterId == original.RegisterId &&
                    row.OriginalMovementId == original.Id, context.RequestAborted);
                return racedCorrection
                    ? Fail(context, "MOVEMENT_ALREADY_CORRECTED", 409, "Bu hareket başka bir istekle zaten düzeltildi.")
                    : Fail(context, "IDEMPOTENCY_CONFLICT", 409, "İstek kimliği başka bir kasa işleminde kullanılmış.");
            }
            return Results.Created($"/api/v1/firms/{firmId}/branches/{branchId}/cash/movements/{correction.Id}",
                new { source = "postgres", simulated = false, movement = ToView(correction) });
        });

        group.MapPost("/shifts/{shiftId:guid}/close", async (string firmId, string branchId, Guid shiftId,
            CloseCashShift command, HttpContext context, CashDbContext db, SalesDbContext salesDb) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true, allowDemoOperatorShifts);
            if (denied is not null) return denied;
            var note = command.Note?.Trim();
            if (!Guid.TryParse(command.RequestId, out var requestId) || requestId == Guid.Empty ||
                command.ExpectedVersion < 1 || command.CountedCashMinor is < 0 or > MaxAmountMinor)
                return Fail(context, "INVALID_CASH_AMOUNT", 400, "Kapanış isteği, sürüm veya sayım tutarı geçersiz.");
            var denominationInput = command.Denominations ?? [];
            var allowedDenominations = new HashSet<int> { 20000, 10000, 5000, 2000, 1000, 500, 100, 50, 25, 10, 5, 1 };
            if (denominationInput.Count > allowedDenominations.Count ||
                denominationInput.Any(item => !allowedDenominations.Contains(item.DenominationMinor) || item.Quantity is < 0 or > 1_000_000) ||
                denominationInput.Select(item => item.DenominationMinor).Distinct().Count() != denominationInput.Count)
                return Fail(context, "INVALID_CASH_DENOMINATIONS", 400, "Kupür türleri veya adetleri geçersiz.");
            var countedDenominations = denominationInput.Where(item => item.Quantity > 0)
                .OrderByDescending(item => item.DenominationMinor).ToArray();
            long denominationTotal;
            try { denominationTotal = countedDenominations.Sum(item => checked((long)item.DenominationMinor * item.Quantity)); }
            catch (OverflowException) { return Fail(context, "INVALID_CASH_DENOMINATIONS", 400, "Kupür toplamı izin verilen sınırı aşıyor."); }
            if (command.Denominations is not null && denominationTotal != command.CountedCashMinor)
                return Fail(context, "CASH_DENOMINATION_TOTAL_MISMATCH", 400, "Kupür dökümü toplamı kasada sayılan tutarla aynı olmalı.");
            var actor = DemoAccess.Resolve(context)!;
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            salesDb.Database.SetDbConnection(db.Database.GetDbConnection(), contextOwnsConnection: false);
            await salesDb.Database.UseTransactionAsync(transaction.GetDbTransaction(), context.RequestAborted);
            await LockSalesCheckWritesAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction(),
                firmId, branchId, context.RequestAborted);
            var shift = await LockShift(db, firmId, branchId, shiftId, context.RequestAborted);
            if (shift is null) return Fail(context, "SHIFT_NOT_FOUND", 404, "Vardiya bu şubede bulunamadı.");
            if (shift.Status == "closed")
            {
                if (shift.CloseRequestId != requestId || shift.CountedCashMinor != command.CountedCashMinor || shift.CloseNote != note)
                    return Fail(context, "SHIFT_CLOSED", 409, "Vardiya zaten kapatılmış.");
                var storedDenominations = await db.ShiftDenominations.AsNoTracking().Where(row => row.ShiftId == shift.Id &&
                    row.FirmId == firmId && row.BranchId == branchId).OrderByDescending(row => row.DenominationMinor)
                    .ToListAsync(context.RequestAborted);
                if (!SameDenominations(storedDenominations, countedDenominations))
                    return Fail(context, "IDEMPOTENCY_CONFLICT", 409, "Kapanış isteği farklı kupür dökümüyle tekrar kullanılmış.");
                return Results.Ok(new { source = "postgres", simulated = false,
                    shift = ToView(shift, storedDenominations.Select(ToView).ToArray()) });
            }
            if (shift.Version != command.ExpectedVersion)
                return Fail(context, "VERSION_CONFLICT", 409, "Vardiya başka bir işlemle değişti; güncel bilgiyi yenileyin.");
            var openCheckCount = await salesDb.Checks.AsNoTracking().CountAsync(row =>
                row.FirmId == firmId && row.BranchId == branchId && row.Status == "open", context.RequestAborted);
            if (openCheckCount > 0)
                return Fail(context, "OPEN_CHECKS_PREVENT_SHIFT_CLOSE", 409,
                    $"Vardiya kapatılamadı. Bu şubede kapatılmamış {openCheckCount} adisyon var. Önce açık adisyonları kapatın.");
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
            foreach (var item in countedDenominations)
                db.ShiftDenominations.Add(new CashShiftDenominationRow
                {
                    FirmId = firmId, BranchId = branchId, RegisterId = shift.RegisterId, ShiftId = shift.Id,
                    DenominationMinor = item.DenominationMinor, Quantity = item.Quantity,
                });
            var denominationDetail = string.Join(",", countedDenominations.Select(item => $"{item.DenominationMinor}:{item.Quantity}"));
            db.Audit.Add(new CashAuditRow { FirmId = firmId, BranchId = branchId, RegisterId = shift.RegisterId,
                ShiftId = shift.Id, RequestId = requestId, EntityType = "shift", EntityId = shift.Id,
                Action = "shift_closed", Actor = actor.Name,
                Detail = $"expected={expected};counted={command.CountedCashMinor};difference={difference};denominations={denominationDetail};note={note}", OccurredAt = now });
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
            return Results.Ok(new { source = "postgres", simulated = false,
                shift = ToView(shift, countedDenominations.Select(item => new CashDenominationView(item.DenominationMinor,
                    item.Quantity, (long)item.DenominationMinor * item.Quantity)).ToArray()) });
        });
    }

    private const long MaxAmountMinor = 999_999_999_999;

    private static long Expected(IEnumerable<CashMovementRow> rows) => rows.Sum(row => row.Kind switch
    {
        "opening_float" or "manual_in" => row.AmountMinor,
        "pos_sale" when row.TenderMethod == "cash" => row.AmountMinor,
        "manual_out" => -row.AmountMinor,
        _ => 0,
    });

    private static CashRegisterView ToView(CashRegisterRow row) =>
        new(row.Id.ToString(), row.Code, row.Name, row.ProviderMode, row.IsActive);

    private static CashMovementView ToView(CashMovementRow row) =>
        new(row.Id.ToString(), row.RegisterId.ToString(), row.ShiftId.ToString(), row.Kind, row.Category,
            row.AmountMinor, row.Currency, row.Description, row.Source, row.Actor, row.CreatedAt, row.TenderMethod,
            row.OriginalMovementId?.ToString(), row.CorrectionType, row.CorrectionReason);

    private static CashShiftView ToView(CashShiftRow row, IReadOnlyList<CashDenominationView>? denominations = null) =>
        new(row.Id.ToString(), row.RegisterId.ToString(), row.Status, row.OpeningCashMinor,
            row.ExpectedCashMinor, row.CountedCashMinor, row.DifferenceMinor, row.OpenedBy,
            row.OpenedAt, row.ClosedBy, row.ClosedAt, row.CloseNote, row.Version, row.OpeningNote, denominations);

    private static CashDenominationView ToView(CashShiftDenominationRow row) =>
        new(row.DenominationMinor, row.Quantity, (long)row.DenominationMinor * row.Quantity);

    private static bool SameDenominations(IEnumerable<CashShiftDenominationRow> stored,
        IReadOnlyList<CashDenominationCount> requested)
    {
        var existing = stored.OrderByDescending(row => row.DenominationMinor).ToArray();
        return existing.Length == requested.Count && existing.Zip(requested)
            .All(pair => pair.First.DenominationMinor == pair.Second.DenominationMinor &&
                pair.First.Quantity == pair.Second.Quantity);
    }

    private static async Task<CashRegisterRow?> LockRegister(CashDbContext db, string firmId, string branchId,
        Guid registerId, CancellationToken cancellationToken) =>
        await db.Registers.FromSqlInterpolated($"SELECT * FROM cash.registers WHERE firm_id = {firmId} AND branch_id = {branchId} AND id = {registerId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);

    private static async Task<CashShiftRow?> LockShift(CashDbContext db, string firmId, string branchId,
        Guid shiftId, CancellationToken cancellationToken) =>
        await db.Shifts.FromSqlInterpolated($"SELECT * FROM cash.shifts WHERE firm_id = {firmId} AND branch_id = {branchId} AND id = {shiftId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);

    private static async Task<CashMovementRow?> LockMovement(CashDbContext db, string firmId, string branchId,
        Guid movementId, CancellationToken cancellationToken) =>
        await db.Movements.FromSqlInterpolated($"SELECT * FROM cash.movements WHERE firm_id = {firmId} AND branch_id = {branchId} AND id = {movementId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);

    private static async Task<FeatureFailure?> Gate(CashDbContext db, FeatureNewWorkGate gate,
        DbTransaction transaction, string firmId, string branchId, CancellationToken cancellationToken) =>
        await gate.CheckAndLockAsync(db.Database.GetDbConnection(), transaction, firmId, branchId,
            "cash.management", cancellationToken);

    private static async Task LockSalesCheckWritesAsync(DbConnection connection, DbTransaction transaction,
        string firmId, string branchId, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            SELECT feature_key FROM modules.branch_feature_states
            WHERE firm_id=@firm AND branch_id=@branch AND feature_key='sales.checks'
            FOR UPDATE
            """;
        var firm = command.CreateParameter(); firm.ParameterName = "firm"; firm.Value = firmId;
        var branch = command.CreateParameter(); branch.ParameterName = "branch"; branch.Value = branchId;
        command.Parameters.Add(firm); command.Parameters.Add(branch);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        _ = await reader.ReadAsync(cancellationToken);
    }

    private static bool Unique(DbUpdateException error) =>
        error.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };

    private static IResult? Guard(HttpContext context, string firmId, string branchId, bool ready, bool write, bool allowDemoOperator = false)
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Fail(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanRead(firmId, branchId) || write && !actor.CanManage && !(allowDemoOperator && actor.CanOperate))
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
