using System.Data.Common;
using Hipos.Api.Features;
using Hipos.Api.Sales;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace Hipos.Api.Cash;

public sealed record OpenCashShift(string RequestId, string RegisterId, long OpeningCashMinor, string? Note = null);
public sealed record ProvisionDefaultCashRegister(string RequestId);
public sealed record CreateCashRegister(string RequestId, string Name, string Responsible, string? Code = null);
public sealed record UpdateCashRegisterResponsible(string RequestId, string Responsible);
public sealed record CreateCashResponsible(string RequestId, string Name, string? RoleTitle = null);
public sealed record DeleteCashResponsible(string RequestId);
public sealed record AddCashMovement(string RequestId, string Kind, long AmountMinor, string Category, string? Description = null);
public sealed record CorrectCashMovement(string RequestId, string CorrectionType, string CorrectionReason);
public sealed record CashDenominationCount(int DenominationMinor, int Quantity);
public sealed record CashDenominationView(int DenominationMinor, int Quantity, long TotalMinor);
public sealed record CloseCashShift(string RequestId, int ExpectedVersion, long CountedCashMinor, string? Note,
    IReadOnlyList<CashDenominationCount>? Denominations = null, long? RetainedFloatMinor = null);
public sealed record CashRegisterView(string Id, string Code, string Name, string ProviderMode, bool IsActive, string? Responsible = null);
public sealed record CashResponsibleView(string Id, string Name, string? RoleTitle, DateTimeOffset CreatedAt);
public sealed record CashMovementView(string Id, string RegisterId, string ShiftId, string Kind, string Category,
    long AmountMinor, string Currency, string Description, string Source, string Actor, DateTimeOffset CreatedAt,
    string? TenderMethod,
    string? OriginalMovementId, string? CorrectionType, string? CorrectionReason, string? ExternalReference = null);
public sealed record CashShiftView(string Id, string RegisterId, string Status, long OpeningCashMinor,
    long? ExpectedCashMinor, long? CountedCashMinor, long? DifferenceMinor, string OpenedBy,
    DateTimeOffset OpenedAt, string? ClosedBy, DateTimeOffset? ClosedAt, string? CloseNote, int Version, string? OpeningNote,
    IReadOnlyList<CashDenominationView>? Denominations = null,
    long? RetainedFloatMinor = null, long? DroppedRevenueMinor = null);

public sealed record ZReportTaxBreakdown(int TaxRatePercent, long TaxBaseMinor, long TaxAmountMinor, long GrossTotalMinor);
public sealed record ZReportTenderBreakdown(string Method, string Label, long AmountMinor, int TransactionCount);
public sealed record ZReportCashDrawerSummary(
    long OpeningFloatMinor,
    long CashSalesMinor,
    long CashInMinor,
    long CashOutMinor,
    long ExpectedCashMinor,
    long? CountedCashMinor,
    long? DifferenceMinor,
    long? RetainedFloatMinor,
    long? DroppedRevenueMinor);
public sealed record ZReportSalesSummary(
    long GrossSalesMinor,
    long DiscountAmountMinor,
    long CompAmountMinor,
    long VoidAmountMinor,
    long NetSalesMinor,
    int CheckCount);
public sealed record ZReportView(
    string ReportType,
    string ReportNumber,
    string ShiftId,
    string RegisterId,
    string RegisterCode,
    string RegisterName,
    string FirmId,
    string BranchId,
    DateTimeOffset OpenedAt,
    string OpenedBy,
    DateTimeOffset? ClosedAt,
    string? ClosedBy,
    string? CloseNote,
    ZReportSalesSummary Sales,
    ZReportCashDrawerSummary CashDrawer,
    IReadOnlyList<ZReportTenderBreakdown> Tenders,
    IReadOnlyList<ZReportTaxBreakdown> Taxes,
    IReadOnlyList<CashDenominationView> Denominations,
    DateTimeOffset GeneratedAt);

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

        group.MapPost("/registers", async (string firmId, string branchId, CreateCashRegister command,
            HttpContext context, CashDbContext db, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            var name = command.Name?.Trim() ?? "";
            var responsible = command.Responsible?.Trim() ?? "";
            var requestedCode = string.IsNullOrWhiteSpace(command.Code) ? null : command.Code.Trim().ToUpperInvariant();
            if (!Guid.TryParse(command.RequestId, out var requestId) || requestId == Guid.Empty ||
                name.Length is < 2 or > 128 || responsible.Length is < 2 or > 128 ||
                requestedCode is { Length: < 2 or > 48 } ||
                name.Contains(';') || responsible.Contains(';'))
                return Fail(context, "INVALID_REGISTER", 400, "Kasa adı ve kasa sorumlusu 2–128 karakter arasında olmalı.");

            var actor = DemoAccess.Resolve(context)!;
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await Gate(db, gate, transaction.GetDbTransaction(), firmId, branchId, context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);

            var lockKey = $"cash-register-create:{firmId}:{branchId}";
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT pg_advisory_xact_lock(hashtextextended({lockKey}, 0))", context.RequestAborted);

            var existingAudit = await db.Audit.AsNoTracking()
                .FirstOrDefaultAsync(row => row.FirmId == firmId && row.BranchId == branchId &&
                    row.RequestId == requestId && row.EntityType == "register" && row.Action == "register_created",
                    context.RequestAborted);
            if (existingAudit is not null)
            {
                var existingReg = await db.Registers.AsNoTracking()
                    .SingleOrDefaultAsync(row => row.Id == existingAudit.EntityId, context.RequestAborted);
                var existingResp = ParseDetailValue(existingAudit.Detail, "responsible");
                if (existingReg is not null && existingReg.Name == name && existingResp == responsible &&
                    (requestedCode is null || existingReg.Code == requestedCode))
                {
                    await transaction.CommitAsync(context.RequestAborted);
                    return Results.Ok(new { source = "postgres", register = ToView(existingReg, existingResp) });
                }
                return Fail(context, "IDEMPOTENCY_CONFLICT", 409, "İstek kimliği farklı kasa bilgileriyle kullanılmış.");
            }

            var branchRegisters = await db.Registers.AsNoTracking()
                .Where(row => row.FirmId == firmId && row.BranchId == branchId)
                .ToListAsync(context.RequestAborted);

            if (branchRegisters.Any(row => row.IsActive && string.Equals(row.Name, name, StringComparison.OrdinalIgnoreCase)))
                return Fail(context, "REGISTER_NAME_EXISTS", 409, "Bu şubede aynı isimde aktif bir kasa zaten tanımlı.");

            var existingCodes = new HashSet<string>(branchRegisters.Select(row => row.Code), StringComparer.OrdinalIgnoreCase);
            string code;
            if (requestedCode is not null)
            {
                if (existingCodes.Contains(requestedCode))
                    return Fail(context, "REGISTER_CODE_EXISTS", 409, "Bu kasa kodu şubede zaten kullanılıyor.");
                code = requestedCode;
            }
            else
            {
                var nextNumber = branchRegisters.Count + 1;
                do
                {
                    code = $"KASA-{nextNumber:D2}";
                    nextNumber++;
                } while (existingCodes.Contains(code));
            }

            var now = DateTimeOffset.UtcNow;
            var register = new CashRegisterRow
            {
                Id = Guid.NewGuid(),
                FirmId = firmId,
                BranchId = branchId,
                Code = code,
                Name = name,
                ProviderMode = "manual",
                IsActive = true,
                Version = 1,
            };
            db.Registers.Add(register);
            db.Audit.Add(new CashAuditRow
            {
                FirmId = firmId,
                BranchId = branchId,
                RegisterId = register.Id,
                ShiftId = null,
                RequestId = requestId,
                EntityType = "register",
                EntityId = register.Id,
                Action = "register_created",
                Actor = actor.Name,
                Detail = $"code={register.Code};name={register.Name};responsible={responsible};providerMode=manual",
                OccurredAt = now,
            });
            try
            {
                await db.SaveChangesAsync(context.RequestAborted);
                await transaction.CommitAsync(context.RequestAborted);
            }
            catch (DbUpdateException error) when (Unique(error))
            {
                return Fail(context, "REGISTER_CODE_EXISTS", 409, "Kasa kodu çakışması oluştu; tekrar deneyin.");
            }
            return Results.Created($"/api/v1/firms/{firmId}/branches/{branchId}/cash/registers/{register.Id}",
                new { source = "postgres", register = ToView(register, responsible) });
        });

        group.MapPut("/registers/{registerId:guid}/responsible", async (string firmId, string branchId, Guid registerId,
            UpdateCashRegisterResponsible command, HttpContext context, CashDbContext db, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true, allowDemoOperatorShifts, allowCashierOperator: true);
            if (denied is not null) return denied;
            var responsible = command.Responsible?.Trim() ?? "";
            if (!Guid.TryParse(command.RequestId, out var requestId) || requestId == Guid.Empty ||
                responsible.Length is < 2 or > 128 || responsible.Contains(';'))
                return Fail(context, "INVALID_RESPONSIBLE", 400, "Kasa sorumlusu 2–128 karakter arasında olmalıdır.");

            var actor = DemoAccess.Resolve(context)!;
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await Gate(db, gate, transaction.GetDbTransaction(), firmId, branchId, context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);

            var existingAudit = await db.Audit.AsNoTracking()
                .FirstOrDefaultAsync(row => row.FirmId == firmId && row.BranchId == branchId &&
                    row.RequestId == requestId && row.EntityType == "register" && row.Action == "register_responsible_updated",
                    context.RequestAborted);
            if (existingAudit is not null)
            {
                var existingReg = await db.Registers.AsNoTracking()
                    .SingleOrDefaultAsync(row => row.Id == existingAudit.EntityId && row.FirmId == firmId && row.BranchId == branchId, context.RequestAborted);
                var existingResp = ParseDetailValue(existingAudit.Detail, "responsible");
                if (existingReg is not null && existingReg.Id == registerId && existingResp == responsible)
                {
                    await transaction.CommitAsync(context.RequestAborted);
                    return Results.Ok(new { source = "postgres", register = ToView(existingReg, existingResp) });
                }
                return Fail(context, "IDEMPOTENCY_CONFLICT", 409, "İstek kimliği farklı bir sorumlu güncellemesinde kullanılmış.");
            }

            var register = await LockRegister(db, firmId, branchId, registerId, context.RequestAborted);
            if (register is null || !register.IsActive)
                return Fail(context, "REGISTER_NOT_FOUND", 404, "Etkin kasa bu şubede bulunamadı.");

            var now = DateTimeOffset.UtcNow;
            db.Audit.Add(new CashAuditRow
            {
                FirmId = firmId,
                BranchId = branchId,
                RegisterId = register.Id,
                ShiftId = null,
                RequestId = requestId,
                EntityType = "register",
                EntityId = register.Id,
                Action = "register_responsible_updated",
                Actor = actor.Name,
                Detail = $"code={register.Code};name={register.Name};responsible={responsible}",
                OccurredAt = now,
            });
            try
            {
                await db.SaveChangesAsync(context.RequestAborted);
                await transaction.CommitAsync(context.RequestAborted);
            }
            catch (DbUpdateException error) when (Unique(error))
            {
                return Fail(context, "IDEMPOTENCY_CONFLICT", 409, "İstek kimliği başka bir kasa işleminde kullanılmış.");
            }
            return Results.Ok(new { source = "postgres", register = ToView(register, responsible) });
        });

        group.MapGet("/responsibles", async (string firmId, string branchId, HttpContext context, CashDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false);
            if (denied is not null) return denied;
            var regResponsibles = await LoadRegisterResponsiblesAsync(db, firmId, branchId, context.RequestAborted);
            var items = await LoadCashResponsiblesAsync(db, firmId, branchId, regResponsibles, context.RequestAborted);
            return Results.Ok(new { source = "postgres", items });
        });

        group.MapPost("/responsibles", async (string firmId, string branchId, CreateCashResponsible command,
            HttpContext context, CashDbContext db, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true, allowDemoOperatorShifts, allowCashierOperator: true);
            if (denied is not null) return denied;
            var name = command.Name?.Trim() ?? "";
            var roleTitle = string.IsNullOrWhiteSpace(command.RoleTitle) ? null : command.RoleTitle.Trim();
            if (!Guid.TryParse(command.RequestId, out var requestId) || requestId == Guid.Empty ||
                name.Length is < 2 or > 128 || roleTitle is { Length: > 80 } ||
                name.Contains(';') || (roleTitle?.Contains(';') ?? false))
                return Fail(context, "INVALID_RESPONSIBLE", 400, "Sorumlu adı 2–128 karakter arasında olmalıdır.");

            var actor = DemoAccess.Resolve(context)!;
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await Gate(db, gate, transaction.GetDbTransaction(), firmId, branchId, context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);

            var lockKey = $"cash-responsible-manage:{firmId}:{branchId}";
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT pg_advisory_xact_lock(hashtextextended({lockKey}, 0))", context.RequestAborted);

            var existingAudit = await db.Audit.AsNoTracking()
                .FirstOrDefaultAsync(row => row.FirmId == firmId && row.BranchId == branchId &&
                    row.RequestId == requestId && row.EntityType == "responsible" && row.Action == "responsible_created",
                    context.RequestAborted);
            if (existingAudit is not null)
            {
                var existingName = ParseDetailValue(existingAudit.Detail, "name");
                var existingRole = ParseDetailValue(existingAudit.Detail, "role");
                if (existingName == name && existingRole == roleTitle)
                {
                    await transaction.CommitAsync(context.RequestAborted);
                    return Results.Ok(new
                    {
                        source = "postgres",
                        responsible = new CashResponsibleView(existingAudit.EntityId.ToString(), name, roleTitle, existingAudit.OccurredAt),
                    });
                }
                return Fail(context, "IDEMPOTENCY_CONFLICT", 409, "İstek kimliği farklı sorumlu bilgileriyle kullanılmış.");
            }

            var regResponsibles = await LoadRegisterResponsiblesAsync(db, firmId, branchId, context.RequestAborted);
            var currentList = await LoadCashResponsiblesAsync(db, firmId, branchId, regResponsibles, context.RequestAborted);
            if (currentList.Any(item => string.Equals(item.Name, name, StringComparison.OrdinalIgnoreCase)))
                return Fail(context, "RESPONSIBLE_NAME_EXISTS", 409, "Bu isimde bir kasa sorumlusu zaten listede kayıtlı.");

            var now = DateTimeOffset.UtcNow;
            var responsibleId = Guid.NewGuid();
            var detail = roleTitle is not null ? $"name={name};role={roleTitle}" : $"name={name}";
            db.Audit.Add(new CashAuditRow
            {
                FirmId = firmId,
                BranchId = branchId,
                RegisterId = Guid.Empty,
                ShiftId = null,
                RequestId = requestId,
                EntityType = "responsible",
                EntityId = responsibleId,
                Action = "responsible_created",
                Actor = actor.Name,
                Detail = detail,
                OccurredAt = now,
            });
            try
            {
                await db.SaveChangesAsync(context.RequestAborted);
                await transaction.CommitAsync(context.RequestAborted);
            }
            catch (DbUpdateException error) when (Unique(error))
            {
                return Fail(context, "IDEMPOTENCY_CONFLICT", 409, "İstek kimliği başka bir işlemde kullanılmış.");
            }
            return Results.Created($"/api/v1/firms/{firmId}/branches/{branchId}/cash/responsibles/{responsibleId}",
                new { source = "postgres", responsible = new CashResponsibleView(responsibleId.ToString(), name, roleTitle, now) });
        });

        group.MapPost("/responsibles/{responsibleId:guid}/delete", async (string firmId, string branchId, Guid responsibleId,
            DeleteCashResponsible command, HttpContext context, CashDbContext db, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            if (!Guid.TryParse(command.RequestId, out var requestId) || requestId == Guid.Empty)
                return Fail(context, "INVALID_REQUEST_ID", 400, "Geçerli bir requestId gereklidir.");

            var actor = DemoAccess.Resolve(context)!;
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await Gate(db, gate, transaction.GetDbTransaction(), firmId, branchId, context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);

            var lockKey = $"cash-responsible-manage:{firmId}:{branchId}";
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT pg_advisory_xact_lock(hashtextextended({lockKey}, 0))", context.RequestAborted);

            var regResponsibles = await LoadRegisterResponsiblesAsync(db, firmId, branchId, context.RequestAborted);
            var currentList = await LoadCashResponsiblesAsync(db, firmId, branchId, regResponsibles, context.RequestAborted);
            var target = currentList.FirstOrDefault(item => item.Id == responsibleId.ToString());
            if (target is null && regResponsibles.TryGetValue(responsibleId, out var regRespName))
            {
                target = new CashResponsibleView(responsibleId.ToString(), regRespName, null, DateTimeOffset.UtcNow);
            }
            if (target is null)
                return Fail(context, "RESPONSIBLE_NOT_FOUND", 404, "Kasa sorumlusu bulunamadı.");

            var now = DateTimeOffset.UtcNow;

            // Bu sorumlu herhangi bir kasaya atanmışsa, o kasalardaki atamayı temizle
            var affectedRegisters = await db.Registers.AsNoTracking()
                .Where(r => r.FirmId == firmId && r.BranchId == branchId && r.IsActive)
                .ToListAsync(context.RequestAborted);

            foreach (var reg in affectedRegisters)
            {
                if (regResponsibles.TryGetValue(reg.Id, out var assigned) &&
                    string.Equals(assigned, target.Name, StringComparison.OrdinalIgnoreCase))
                {
                    db.Audit.Add(new CashAuditRow
                    {
                        FirmId = firmId,
                        BranchId = branchId,
                        RegisterId = reg.Id,
                        ShiftId = null,
                        RequestId = Guid.NewGuid(),
                        EntityType = "register",
                        EntityId = reg.Id,
                        Action = "register_responsible_updated",
                        Actor = actor.Name,
                        Detail = $"code={reg.Code};name={reg.Name};responsible=",
                        OccurredAt = now,
                    });
                }
            }

            db.Audit.Add(new CashAuditRow
            {
                FirmId = firmId,
                BranchId = branchId,
                RegisterId = Guid.Empty,
                ShiftId = null,
                RequestId = requestId,
                EntityType = "responsible",
                EntityId = responsibleId,
                Action = "responsible_deleted",
                Actor = actor.Name,
                Detail = $"name={target.Name}",
                OccurredAt = now,
            });
            try
            {
                await db.SaveChangesAsync(context.RequestAborted);
                await transaction.CommitAsync(context.RequestAborted);
            }
            catch (DbUpdateException error) when (Unique(error))
            {
                return Fail(context, "IDEMPOTENCY_CONFLICT", 409, "İstek kimliği başka bir işlemde kullanılmış.");
            }
            return Results.Ok(new { source = "postgres", deletedId = responsibleId.ToString(), deletedName = target.Name });
        });

        group.MapGet("/registers", async (string firmId, string branchId, HttpContext context, CashDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false);
            if (denied is not null) return denied;
            var items = await db.Registers.AsNoTracking()
                .Where(row => row.FirmId == firmId && row.BranchId == branchId && row.IsActive)
                .OrderBy(row => row.Code).ToListAsync(context.RequestAborted);
            var responsibles = await LoadRegisterResponsiblesAsync(db, firmId, branchId, context.RequestAborted);
            return Results.Ok(new { source = "postgres", items = items.Select(row => ToView(row, responsibles.GetValueOrDefault(row.Id))).ToArray() });
        });

        group.MapGet("/overview", async (string firmId, string branchId, HttpContext context, CashDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false);
            if (denied is not null) return denied;
            var registers = await db.Registers.AsNoTracking()
                .Where(row => row.FirmId == firmId && row.BranchId == branchId && row.IsActive)
                .OrderBy(row => row.Code).ToListAsync(context.RequestAborted);
            var responsibles = await LoadRegisterResponsiblesAsync(db, firmId, branchId, context.RequestAborted);
            var responsiblePool = await LoadCashResponsiblesAsync(db, firmId, branchId, responsibles, context.RequestAborted);
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
                registers = registers.Select(row => ToView(row, responsibles.GetValueOrDefault(row.Id))).ToArray(),
                responsibles = responsiblePool,
                openShifts = open });
        });

        group.MapGet("/movements", async (string firmId, string branchId, Guid? registerId, Guid? shiftId, DateTimeOffset? from,
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
            if (registerId.HasValue) query = query.Where(row => row.RegisterId == registerId.Value);
            if (shiftId.HasValue) query = query.Where(row => row.ShiftId == shiftId.Value);
            if (from.HasValue) query = query.Where(row => row.CreatedAt >= from.Value);
            if (to.HasValue) query = query.Where(row => row.CreatedAt <= to.Value);
            var total = await query.CountAsync(context.RequestAborted);
            var items = await query.OrderByDescending(row => row.CreatedAt).ThenByDescending(row => row.Id)
                .Skip((requestedPage - 1) * requestedSize).Take(requestedSize)
                .ToListAsync(context.RequestAborted);
            return Results.Ok(new { source = "postgres", page = requestedPage, pageSize = requestedSize, total, items = items.Select(ToView).ToArray() });
        });

        group.MapGet("/shifts", async (string firmId, string branchId, Guid? registerId, string? status, DateTimeOffset? from,
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
            if (registerId.HasValue) query = query.Where(row => row.RegisterId == registerId.Value);
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
            var denied = Guard(context, firmId, branchId, ready, true, allowDemoOperatorShifts, allowCashierOperator: true);
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
            var description = string.IsNullOrWhiteSpace(command.Description)
                ? (command.Kind switch
                {
                    "manual_in" => command.Category switch
                    {
                        "cash_sale" => "Nakit Satış",
                        "other" => "Kasa Bozuk Para / Avans Takviyesi",
                        _ => "Nakit Girişi"
                    },
                    "manual_out" => command.Category switch
                    {
                        "expense" => "İşletme Gideri / Masraf",
                        "cash_drop" => "Kasadan Teslim (Safe Drop)",
                        _ => "Nakit Çıkışı"
                    },
                    _ => "Nakit Hareketi"
                })
                : command.Description.Trim();
            var validCategory = command.Kind switch
            {
                "manual_in" => command.Category is "cash_sale" or "other",
                "manual_out" => command.Category is "expense" or "cash_drop" or "other",
                _ => false,
            };
            if (!Guid.TryParse(command.RequestId, out var requestId) || requestId == Guid.Empty ||
                command.AmountMinor is <= 0 or > MaxAmountMinor || !validCategory || description.Length > 500)
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
            var denied = Guard(context, firmId, branchId, ready, true, allowDemoOperatorShifts, allowCashierOperator: true);
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
            var openChecks = await salesDb.Checks.AsNoTracking()
                .Where(row => row.FirmId == firmId && row.BranchId == branchId && row.Status == "open")
                .Select(row => row.TableId)
                .ToListAsync(context.RequestAborted);
            if (openChecks.Count > 0)
            {
                var tableLabels = openChecks
                    .Where(t => !string.IsNullOrWhiteSpace(t))
                    .Select(t => t!.StartsWith("table-", StringComparison.OrdinalIgnoreCase) && int.TryParse(t[6..], out var num)
                        ? $"Masa {num}"
                        : t!)
                    .Distinct()
                    .OrderBy(t => t)
                    .ToList();
                var quickCount = openChecks.Count(t => string.IsNullOrWhiteSpace(t));
                if (quickCount > 0)
                    tableLabels.Add(quickCount == 1 ? "Hızlı Satış (1 adisyon)" : $"Hızlı Satış ({quickCount} adisyon)");
                var locations = string.Join(", ", tableLabels);
                return Fail(context, "OPEN_CHECKS_PREVENT_SHIFT_CLOSE", 409,
                    $"Açık hesaplar olduğu için vardiya kapatılamıyor ({openChecks.Count} açık adisyon: {locations}). Önce Kasa ekranından bu hesapların ödemesini alıp adisyonları kapatın.");
            }
            var movements = await db.Movements.AsNoTracking()
                .Where(row => row.FirmId == firmId && row.BranchId == branchId && row.ShiftId == shiftId)
                .ToListAsync(context.RequestAborted);
            var expected = Expected(movements);
            var difference = command.CountedCashMinor - expected;
            if (difference != 0 && string.IsNullOrWhiteSpace(note))
                return Fail(context, "CASH_DIFFERENCE_NOTE_REQUIRED", 400, "Kasa farkı için açıklama zorunludur.");
            var now = DateTimeOffset.UtcNow;
            long retainedFloat = command.RetainedFloatMinor ?? Math.Min(command.CountedCashMinor, shift.OpeningCashMinor);
            if (retainedFloat < 0 || retainedFloat > command.CountedCashMinor)
                return Fail(context, "INVALID_RETAINED_FLOAT", 400, "Yarına devreden bozuk para tutarı sayılan nakitten fazla veya negatif olamaz.");
            long droppedRevenue = command.CountedCashMinor - retainedFloat;

            shift.Status = "closed";
            shift.ExpectedCashMinor = expected;
            shift.CountedCashMinor = command.CountedCashMinor;
            shift.DifferenceMinor = difference;
            shift.RetainedFloatMinor = retainedFloat;
            shift.DroppedRevenueMinor = droppedRevenue;
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
                Detail = $"expected={expected};counted={command.CountedCashMinor};difference={difference};retainedFloat={retainedFloat};droppedRevenue={droppedRevenue};denominations={denominationDetail};note={note}", OccurredAt = now });
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

        group.MapGet("/shifts/{shiftId:guid}/z-report", async (string firmId, string branchId, Guid shiftId,
            HttpContext context, CashDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false);
            if (denied is not null) return denied;

            var shift = await db.Shifts.AsNoTracking()
                .Include(s => s.Register)
                .Include(s => s.Denominations)
                .Include(s => s.Movements)
                .SingleOrDefaultAsync(s => s.FirmId == firmId && s.BranchId == branchId && s.Id == shiftId,
                    context.RequestAborted);

            if (shift is null) return Fail(context, "SHIFT_NOT_FOUND", 404, "Vardiya bulunamadı.");

            var report = BuildZReport(shift);
            return Results.Ok(new { source = "postgres", simulated = false, report });
        });
    }

    private const long MaxAmountMinor = 999_999_999_999;

    public static long Expected(IEnumerable<CashMovementRow> rows) => rows.Sum(row => row.Kind switch
    {
        "opening_float" or "manual_in" => row.AmountMinor,
        "pos_sale" when row.TenderMethod == "cash" => row.AmountMinor,
        "manual_out" => -row.AmountMinor,
        _ => 0,
    });

    private static CashRegisterView ToView(CashRegisterRow row, string? responsible = null) =>
        new(row.Id.ToString(), row.Code, row.Name, row.ProviderMode, row.IsActive, responsible);

    private static async Task<Dictionary<Guid, string>> LoadRegisterResponsiblesAsync(CashDbContext db,
        string firmId, string branchId, CancellationToken cancellationToken)
    {
        var audits = await db.Audit.AsNoTracking()
            .Where(row => row.FirmId == firmId && row.BranchId == branchId &&
                row.EntityType == "register" &&
                (row.Action == "register_created" || row.Action == "register_responsible_updated"))
            .OrderBy(row => row.OccurredAt).ThenBy(row => row.Id)
            .ToListAsync(cancellationToken);
        var map = new Dictionary<Guid, string>();
        foreach (var audit in audits)
        {
            var resp = ParseDetailValue(audit.Detail, "responsible");
            if (!string.IsNullOrWhiteSpace(resp))
                map[audit.RegisterId] = resp;
            else
                map.Remove(audit.RegisterId);
        }
        return map;
    }

    private static async Task<CashResponsibleView[]> LoadCashResponsiblesAsync(CashDbContext db,
        string firmId, string branchId, Dictionary<Guid, string> registerResponsibles, CancellationToken cancellationToken)
    {
        var audits = await db.Audit.AsNoTracking()
            .Where(row => row.FirmId == firmId && row.BranchId == branchId &&
                row.EntityType == "responsible" &&
                (row.Action == "responsible_created" || row.Action == "responsible_deleted"))
            .OrderBy(row => row.OccurredAt).ThenBy(row => row.Id)
            .ToListAsync(cancellationToken);

        var activeById = new Dictionary<Guid, CashResponsibleView>();
        var deletedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var audit in audits)
        {
            if (audit.Action == "responsible_created")
            {
                var name = ParseDetailValue(audit.Detail, "name");
                var role = ParseDetailValue(audit.Detail, "role");
                if (!string.IsNullOrWhiteSpace(name))
                    activeById[audit.EntityId] = new CashResponsibleView(audit.EntityId.ToString(), name, role, audit.OccurredAt);
            }
            else if (audit.Action == "responsible_deleted")
            {
                activeById.Remove(audit.EntityId);
                var deletedName = ParseDetailValue(audit.Detail, "name");
                if (!string.IsNullOrWhiteSpace(deletedName))
                    deletedNames.Add(deletedName);
            }
        }

        foreach (var (regId, respName) in registerResponsibles)
        {
            if (!string.IsNullOrWhiteSpace(respName) &&
                !deletedNames.Contains(respName) &&
                !activeById.Values.Any(v => string.Equals(v.Name, respName, StringComparison.OrdinalIgnoreCase)))
            {
                activeById[regId] = new CashResponsibleView(regId.ToString(), respName, "Atanmış Kasa Sorumlusu", DateTimeOffset.UtcNow);
            }
        }

        return activeById.Values.OrderBy(item => item.Name, StringComparer.CurrentCultureIgnoreCase).ToArray();
    }

    private static string? ParseDetailValue(string detail, string key)
    {
        var prefix = $"{key}=";
        foreach (var part in detail.Split(';', StringSplitOptions.RemoveEmptyEntries))
        {
            if (part.StartsWith(prefix, StringComparison.Ordinal))
                return part[prefix.Length..];
        }
        return null;
    }

    private static CashMovementView ToView(CashMovementRow row) =>
        new(row.Id.ToString(), row.RegisterId.ToString(), row.ShiftId.ToString(), row.Kind, row.Category,
            row.AmountMinor, row.Currency, row.Description, row.Source, row.Actor, row.CreatedAt, row.TenderMethod,
            row.OriginalMovementId?.ToString(), row.CorrectionType, row.CorrectionReason, row.ExternalReference);

    private static CashShiftView ToView(CashShiftRow row, IReadOnlyList<CashDenominationView>? denominations = null) =>
        new(row.Id.ToString(), row.RegisterId.ToString(), row.Status, row.OpeningCashMinor,
            row.ExpectedCashMinor, row.CountedCashMinor, row.DifferenceMinor, row.OpenedBy,
            row.OpenedAt, row.ClosedBy, row.ClosedAt, row.CloseNote, row.Version, row.OpeningNote, denominations,
            row.RetainedFloatMinor, row.DroppedRevenueMinor);

    private static ZReportView BuildZReport(CashShiftRow shift)
    {
        var activeMovements = shift.Movements.Where(m => m.CorrectionType != "reversal").ToList();
        var posSales = activeMovements.Where(m => m.Kind == "pos_sale").ToList();
        var manualSales = activeMovements.Where(m => m.Kind == "manual_in" && m.Category == "cash_sale").ToList();

        var cashSales = posSales.Where(m => m.TenderMethod == "cash").Sum(m => m.AmountMinor) +
                        manualSales.Sum(m => m.AmountMinor);
        var cardSales = posSales.Where(m => m.TenderMethod == "card").Sum(m => m.AmountMinor);
        var mealSales = posSales.Where(m => m.TenderMethod == "meal").Sum(m => m.AmountMinor);
        var transferSales = posSales.Where(m => m.TenderMethod == "transfer").Sum(m => m.AmountMinor);
        var cariSales = posSales.Where(m => m.TenderMethod == "cari").Sum(m => m.AmountMinor);
        var otherSales = posSales.Where(m => m.TenderMethod is not ("cash" or "card" or "meal" or "transfer" or "cari")).Sum(m => m.AmountMinor);
        var totalSales = cashSales + cardSales + mealSales + transferSales + cariSales + otherSales;

        var cashIn = activeMovements.Where(m => m.Kind == "manual_in" && m.Category != "cash_sale").Sum(m => m.AmountMinor);
        var cashOut = activeMovements.Where(m => m.Kind == "manual_out").Sum(m => m.AmountMinor);

        var expectedCash = shift.ExpectedCashMinor ?? Expected(shift.Movements);
        var countedCash = shift.CountedCashMinor;
        var difference = shift.DifferenceMinor ?? (countedCash.HasValue ? countedCash.Value - expectedCash : null);

        var openingFloat = activeMovements.FirstOrDefault(m => m.Kind == "opening_float")?.AmountMinor ?? shift.OpeningCashMinor;
        var retainedFloat = shift.RetainedFloatMinor ?? (shift.Status == "closed" ? Math.Min(countedCash ?? 0, openingFloat) : null);
        var droppedRevenue = shift.DroppedRevenueMinor ?? (shift.Status == "closed" && countedCash.HasValue ? Math.Max(0, countedCash.Value - (retainedFloat ?? 0)) : null);

        var uniqueChecks = posSales.Select(m => m.ExternalReference ?? m.Id.ToString())
            .Concat(manualSales.Select(m => m.Id.ToString())).Distinct().Count();

        var tenders = new List<ZReportTenderBreakdown>();
        var cashTxCount = posSales.Count(m => m.TenderMethod == "cash") + manualSales.Count;
        if (cashSales > 0 || shift.Status == "closed")
            tenders.Add(new ZReportTenderBreakdown("cash", "Nakit", cashSales, cashTxCount));
        if (cardSales > 0)
            tenders.Add(new ZReportTenderBreakdown("card", "Kredi / Banka Kartı", cardSales, posSales.Count(m => m.TenderMethod == "card")));
        if (mealSales > 0)
            tenders.Add(new ZReportTenderBreakdown("meal", "Yemek Kartı (Sodexo/Multinet)", mealSales, posSales.Count(m => m.TenderMethod == "meal")));
        if (transferSales > 0)
            tenders.Add(new ZReportTenderBreakdown("transfer", "Havale / EFT", transferSales, posSales.Count(m => m.TenderMethod == "transfer")));
        if (cariSales > 0)
            tenders.Add(new ZReportTenderBreakdown("cari", "Cari / Veresiye", cariSales, posSales.Count(m => m.TenderMethod == "cari")));
        if (otherSales > 0)
            tenders.Add(new ZReportTenderBreakdown("other", "Diğer Ödemeler", otherSales, posSales.Count(m => m.TenderMethod is not ("cash" or "card" or "meal" or "transfer" or "cari"))));

        var taxes = new List<ZReportTaxBreakdown>();
        if (totalSales > 0)
        {
            var taxBase = (long)Math.Round(totalSales / 1.10);
            var taxAmount = totalSales - taxBase;
            taxes.Add(new ZReportTaxBreakdown(10, taxBase, taxAmount, totalSales));
        }

        var reportType = shift.Status == "closed" ? "Z" : "X";
        var datePrefix = (shift.ClosedAt ?? shift.OpenedAt).ToString("yyyyMMdd");
        var reportNumber = $"{reportType}-{datePrefix}-{shift.Id.ToString()[..8].ToUpperInvariant()}";

        var salesSummary = new ZReportSalesSummary(
            GrossSalesMinor: totalSales,
            DiscountAmountMinor: 0,
            CompAmountMinor: 0,
            VoidAmountMinor: 0,
            NetSalesMinor: totalSales,
            CheckCount: uniqueChecks);

        var drawerSummary = new ZReportCashDrawerSummary(
            OpeningFloatMinor: openingFloat,
            CashSalesMinor: cashSales,
            CashInMinor: cashIn,
            CashOutMinor: cashOut,
            ExpectedCashMinor: expectedCash,
            CountedCashMinor: countedCash,
            DifferenceMinor: difference,
            RetainedFloatMinor: retainedFloat,
            DroppedRevenueMinor: droppedRevenue);

        var denominations = shift.Denominations
            .OrderByDescending(d => d.DenominationMinor)
            .Select(ToView)
            .ToList();

        return new ZReportView(
            ReportType: reportType,
            ReportNumber: reportNumber,
            ShiftId: shift.Id.ToString(),
            RegisterId: shift.RegisterId.ToString(),
            RegisterCode: shift.Register?.Code ?? "KASA",
            RegisterName: shift.Register?.Name ?? "Kasa",
            FirmId: shift.FirmId,
            BranchId: shift.BranchId,
            OpenedAt: shift.OpenedAt,
            OpenedBy: shift.OpenedBy,
            ClosedAt: shift.ClosedAt,
            ClosedBy: shift.ClosedBy,
            CloseNote: shift.CloseNote,
            Sales: salesSummary,
            CashDrawer: drawerSummary,
            Tenders: tenders,
            Taxes: taxes,
            Denominations: denominations,
            GeneratedAt: DateTimeOffset.UtcNow);
    }

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

    private static IResult? Guard(HttpContext context, string firmId, string branchId, bool ready, bool write,
        bool allowDemoOperator = false, bool allowCashierOperator = false)
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Fail(context, "UNAUTHENTICATED", 401, "Oturum gerekli.");
        var isCashierOperator = allowCashierOperator && actor.IsRealAuth &&
            string.Equals(actor.Role, "cashier", StringComparison.OrdinalIgnoreCase);
        var isAllowedDemoOperator = allowDemoOperator && !actor.IsRealAuth && actor.CanOperate;
        if (!actor.CanRead(firmId, branchId) || (write && !actor.CanManage && !isCashierOperator && !isAllowedDemoOperator))
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
