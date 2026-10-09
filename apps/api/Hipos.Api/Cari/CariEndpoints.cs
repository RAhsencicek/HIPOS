using Hipos.Api.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using System.Globalization;

namespace Hipos.Api.Cari;

public sealed record CreateCariParty(string Name, string[] Types, string? Phone = null, string? Email = null, string? Note = null);
public sealed record UpdateCariParty(string Name, string[] Types, bool IsActive, int ExpectedVersion,
    string? Phone = null, string? Email = null, string? Note = null);
public sealed record AddCariMovement(string RequestId, string Kind, string? EntryType, long? AmountMinor,
    string Description, int ExpectedVersion, DateOnly? EffectiveDate = null, string? Reference = null, long? DeltaMinor = null);
public sealed record CariMovementView(string Id, string Kind, string EntryType, long DeltaMinor, string Currency,
    string Description, string? Reference, DateOnly EffectiveDate, string Source, bool IsDemo, DateTimeOffset CreatedAt);
public sealed record CariPartyView(string Id, string Name, string[] Types, string? Phone, string? Email, string? Note, bool IsActive, int Version,
    long CustomerBalanceMinor, long SupplierBalanceMinor, int MovementCount, CariMovementView[] Movements);
public sealed record CariStatementView(string PartyId, string From, string To, string TimeZone,
    long OpeningCustomerBalanceMinor, long OpeningSupplierBalanceMinor,
    long PeriodCustomerDeltaMinor, long PeriodSupplierDeltaMinor,
    long ClosingCustomerBalanceMinor, long ClosingSupplierBalanceMinor, CariMovementView[] Movements);
public sealed record CariSummaryView(string Source, int ActiveCustomers, int ActiveSuppliers,
    long CustomerReceivableMinor, long CustomerCreditMinor, long SupplierPayableMinor, long SupplierAdvanceMinor,
    CariRecentMovementView[] RecentMovements,
    CariWriteCapabilities Capabilities);
public sealed record CariWriteCapabilities(bool ManagementWritesEnabled);
public sealed record CariRecentMovementView(string Id, string PartyId, string PartyName, string Kind,
    string EntryType, long DeltaMinor, string Description, DateOnly EffectiveDate, string Source, bool IsDemo, DateTimeOffset CreatedAt);

public static class CariEndpoints
{
    public static void MapCariEndpoints(this WebApplication app, bool ready)
    {
        var group = app.MapGroup("/api/v1/firms/{firmId}/branches/{branchId}/caris");

        group.MapGet("", async (string firmId, string branchId, string? type, HttpContext context,
            CariDbContext db, FeatureDbContext features) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false);
            if (denied is not null) return denied;
            if (type is not null && type is not ("customer" or "supplier"))
                return Fail(context, "INVALID_CARI_TYPE", 400, "Cari türü customer veya supplier olmalı.");
            var parties = await db.Parties.AsNoTracking().Where(row => row.FirmId == firmId && row.BranchId == branchId)
                .OrderBy(row => row.Name).ToListAsync(context.RequestAborted);
            if (type is not null) parties = parties.Where(row => row.Types.Contains(type)).ToList();
            var ids = parties.Select(row => row.Id).ToArray();
            var movements = await db.Movements.AsNoTracking().Where(row => row.FirmId == firmId && row.BranchId == branchId && ids.Contains(row.PartyId))
                .OrderBy(row => row.EffectiveDate).ThenBy(row => row.CreatedAt).ThenBy(row => row.Id).ToListAsync(context.RequestAborted);
            var capabilities = await GetCapabilities(features, firmId, branchId, context.RequestAborted);
            return Results.Ok(new { items = parties.Select(row => View(row, movements.Where(item => item.PartyId == row.Id))).ToArray(), capabilities });
        });

        group.MapGet("/summary", async (string firmId, string branchId, HttpContext context,
            CariDbContext db, FeatureDbContext features) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false);
            if (denied is not null) return denied;
            var parties = await db.Parties.AsNoTracking().Where(row => row.FirmId == firmId && row.BranchId == branchId)
                .ToListAsync(context.RequestAborted);
            var movements = await db.Movements.AsNoTracking().Where(row => row.FirmId == firmId && row.BranchId == branchId)
                .OrderByDescending(row => row.EffectiveDate).ThenByDescending(row => row.CreatedAt).Take(8)
                .ToListAsync(context.RequestAborted);
            var names = parties.ToDictionary(row => row.Id, row => row.Name);
            var balances = await db.Movements.AsNoTracking().Where(row => row.FirmId == firmId && row.BranchId == branchId)
                .GroupBy(row => new { row.PartyId, row.Kind }).Select(grouping => new {
                    grouping.Key.PartyId, grouping.Key.Kind, Balance = grouping.Sum(row => row.DeltaMinor) })
                .ToListAsync(context.RequestAborted);
            var customerBalances = balances.Where(row => row.Kind == "customer").Select(row => row.Balance).ToArray();
            var supplierBalances = balances.Where(row => row.Kind == "supplier").Select(row => row.Balance).ToArray();
            return Results.Ok(new CariSummaryView("postgres",
                parties.Count(row => row.IsActive && row.Types.Contains("customer")),
                parties.Count(row => row.IsActive && row.Types.Contains("supplier")),
                customerBalances.Where(balance => balance > 0).Sum(),
                customerBalances.Where(balance => balance < 0).Sum(balance => -balance),
                supplierBalances.Where(balance => balance > 0).Sum(),
                supplierBalances.Where(balance => balance < 0).Sum(balance => -balance),
                movements.Where(row => names.ContainsKey(row.PartyId)).Select(row => new CariRecentMovementView(
                    row.Id, row.PartyId, names[row.PartyId], row.Kind, row.EntryType, row.DeltaMinor,
                    row.Description, row.EffectiveDate, row.Source, row.Actor == "demo-seed", row.CreatedAt)).ToArray(),
                await GetCapabilities(features, firmId, branchId, context.RequestAborted)));
        });

        group.MapGet("/{partyId}", async (string firmId, string branchId, string partyId, HttpContext context, CariDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false);
            if (denied is not null) return denied;
            var party = await db.Parties.AsNoTracking().SingleOrDefaultAsync(row => row.Id == partyId && row.FirmId == firmId && row.BranchId == branchId, context.RequestAborted);
            if (party is null) return Fail(context, "CARI_NOT_FOUND", 404, "Cari kartı bulunamadı.");
            var movements = await db.Movements.AsNoTracking().Where(row => row.PartyId == partyId && row.FirmId == firmId && row.BranchId == branchId)
                .OrderBy(row => row.CreatedAt).ThenBy(row => row.Id).ToListAsync(context.RequestAborted);
            return Results.Ok(View(party, movements));
        });

        group.MapGet("/{partyId}/statement", async (string firmId, string branchId, string partyId,
            string? from, string? to, HttpContext context, CariDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false);
            if (denied is not null) return denied;
            if (!DateOnly.TryParseExact(from, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var fromDate) ||
                !DateOnly.TryParseExact(to, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var toDate) ||
                fromDate.Year is < 2000 or > 2100 || toDate.Year is < 2000 or > 2100 ||
                fromDate > toDate || toDate.DayNumber - fromDate.DayNumber > 365)
                return Fail(context, "INVALID_STATEMENT_RANGE", 400, "Ekstre için 2000–2100 arasında en çok 366 günlük geçerli bir tarih aralığı seçin.");
            var partyExists = await db.Parties.AsNoTracking().AnyAsync(row => row.Id == partyId && row.FirmId == firmId && row.BranchId == branchId, context.RequestAborted);
            if (!partyExists) return Fail(context, "CARI_NOT_FOUND", 404, "Cari kartı bulunamadı.");
            var rows = await db.Movements.AsNoTracking()
                .Where(row => row.PartyId == partyId && row.FirmId == firmId && row.BranchId == branchId && row.EffectiveDate < toDate.AddDays(1))
                .OrderBy(row => row.EffectiveDate).ThenBy(row => row.CreatedAt).ThenBy(row => row.Id).ToListAsync(context.RequestAborted);
            var openingCustomer = rows.Where(row => row.EffectiveDate < fromDate && row.Kind == "customer").Sum(row => row.DeltaMinor);
            var openingSupplier = rows.Where(row => row.EffectiveDate < fromDate && row.Kind == "supplier").Sum(row => row.DeltaMinor);
            var period = rows.Where(row => row.EffectiveDate >= fromDate).ToArray();
            var customerDelta = period.Where(row => row.Kind == "customer").Sum(row => row.DeltaMinor);
            var supplierDelta = period.Where(row => row.Kind == "supplier").Sum(row => row.DeltaMinor);
            return Results.Ok(new CariStatementView(partyId, fromDate.ToString("yyyy-MM-dd"), toDate.ToString("yyyy-MM-dd"),
                "Europe/Istanbul", openingCustomer, openingSupplier, customerDelta, supplierDelta,
                checked(openingCustomer + customerDelta), checked(openingSupplier + supplierDelta),
                period.Select(View).ToArray()));
        });

        group.MapPost("", async (string firmId, string branchId, CreateCariParty command, HttpContext context,
            CariDbContext db, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            var name = command.Name?.Trim() ?? "";
            var types = NormalizeTypes(command.Types);
            var phone = NormalizePhone(command.Phone);
            var email = NormalizeEmail(command.Email);
            var note = NormalizeNote(command.Note);
            var validation = ValidateParty(name, types, phone, email, note);
            if (validation is not null) return Fail(context, "INVALID_CARI", 400, validation);
            var now = DateTimeOffset.UtcNow;
            var party = new CariPartyRow { Id = Guid.NewGuid().ToString(), FirmId = firmId, BranchId = branchId,
                Name = name, Types = types!, Phone = phone, Email = email, Note = note, UpdatedAt = now };
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await LockManagementCapability(db, transaction.GetDbTransaction(), gate, firmId, branchId,
                context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            db.Parties.Add(party);
            AddAudit(db, party, "created", DemoAccess.Resolve(context)!.Name, name, now);
            await db.SaveChangesAsync(context.RequestAborted);
            await transaction.CommitAsync(context.RequestAborted);
            return Results.Created($"/api/v1/firms/{firmId}/branches/{branchId}/caris/{party.Id}", View(party, []));
        });

        group.MapPut("/{partyId}", async (string firmId, string branchId, string partyId, UpdateCariParty command,
            HttpContext context, CariDbContext db, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            var name = command.Name?.Trim() ?? "";
            var types = NormalizeTypes(command.Types);
            var phone = NormalizePhone(command.Phone);
            var email = NormalizeEmail(command.Email);
            var note = NormalizeNote(command.Note);
            var validation = ValidateParty(name, types, phone, email, note);
            if (validation is not null || command.ExpectedVersion < 1)
                return Fail(context, "INVALID_CARI", 400, validation ?? "Cari sürümü geçersiz.");
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await LockManagementCapability(db, transaction.GetDbTransaction(), gate, firmId, branchId,
                context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            var party = await db.Parties.FromSqlInterpolated($"SELECT * FROM cari.parties WHERE id = {partyId} AND firm_id = {firmId} AND branch_id = {branchId} FOR UPDATE")
                .SingleOrDefaultAsync(context.RequestAborted);
            if (party is null) return Fail(context, "CARI_NOT_FOUND", 404, "Cari kartı bulunamadı.");
            if (party.Version != command.ExpectedVersion) return Fail(context, "VERSION_CONFLICT", 409, "Cari kartı başka bir işlemle değişti.");
            var usedKinds = await db.Movements.Where(row => row.PartyId == partyId).Select(row => row.Kind).Distinct().ToListAsync(context.RequestAborted);
            if (usedKinds.Any(kind => !types.Contains(kind)))
                return Fail(context, "CARI_TYPE_IN_USE", 409, "Hareketi olan müşteri/tedarikçi türü kaldırılamaz.");
            party.Name = name;
            party.Types = types!;
            party.Phone = phone;
            party.Email = email;
            party.Note = note;
            party.IsActive = command.IsActive;
            party.Version++;
            party.UpdatedAt = DateTimeOffset.UtcNow;
            AddAudit(db, party, "updated", DemoAccess.Resolve(context)!.Name, name, party.UpdatedAt);
            await db.SaveChangesAsync(context.RequestAborted);
            await transaction.CommitAsync(context.RequestAborted);
            var movements = await db.Movements.AsNoTracking().Where(row => row.PartyId == partyId)
                .OrderBy(row => row.EffectiveDate).ThenBy(row => row.CreatedAt).ToListAsync(context.RequestAborted);
            return Results.Ok(View(party, movements));
        });

        group.MapPost("/{partyId}/movements", async (string firmId, string branchId, string partyId,
            AddCariMovement command, HttpContext context, CariDbContext db, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            var description = command.Description?.Trim() ?? "";
            var reference = NormalizeReference(command.Reference);
            var (entryType, deltaMinor, effectiveDate, validation) = NormalizeMovement(command);
            if (!Guid.TryParse(command.RequestId, out _) || command.Kind is not ("customer" or "supplier") ||
                deltaMinor is null || description.Length is < 3 or > 500 || command.ExpectedVersion < 1 ||
                effectiveDate is null || reference == "\0" || validation is not null)
                return Fail(context, "INVALID_CARI_MOVEMENT", 400, validation ?? "Hareket kimliği, hesap türü, işlem türü, pozitif tutar, açıklama, tarih veya kart sürümü geçersiz.");
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await LockManagementCapability(db, transaction.GetDbTransaction(), gate, firmId, branchId,
                context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            var party = await db.Parties.FromSqlInterpolated($"SELECT * FROM cari.parties WHERE id = {partyId} AND firm_id = {firmId} AND branch_id = {branchId} FOR UPDATE")
                .SingleOrDefaultAsync(context.RequestAborted);
            if (party is null) return Fail(context, "CARI_NOT_FOUND", 404, "Cari kartı bulunamadı.");
            var existing = await db.Movements.AsNoTracking().SingleOrDefaultAsync(row => row.Id == command.RequestId, context.RequestAborted);
            if (existing is not null)
                return existing.PartyId == partyId && existing.FirmId == firmId && existing.BranchId == branchId &&
                    existing.Kind == command.Kind && existing.EntryType == entryType && existing.DeltaMinor == deltaMinor &&
                    existing.Description == description && existing.Reference == reference && existing.EffectiveDate == effectiveDate
                    ? Results.Ok(View(existing))
                    : Fail(context, "MOVEMENT_ID_CONFLICT", 409, "Hareket kimliği farklı içerikle kullanılmış.");
            if (party.Version != command.ExpectedVersion) return Fail(context, "VERSION_CONFLICT", 409, "Cari kartı başka bir işlemle değişti.");
            if (!party.IsActive || !party.Types.Contains(command.Kind))
                return Fail(context, "CARI_TYPE_UNAVAILABLE", 409, "Bu türde aktif cari kartı yok.");
            var now = DateTimeOffset.UtcNow;
            var movement = new CariMovementRow { Id = command.RequestId, FirmId = firmId, BranchId = branchId,
                PartyId = partyId, Kind = command.Kind, EntryType = entryType!, DeltaMinor = deltaMinor!.Value,
                Description = description, Reference = reference, EffectiveDate = effectiveDate!.Value,
                Source = "manual", Actor = DemoAccess.Resolve(context)!.Name, CreatedAt = now };
            db.Movements.Add(movement);
            party.Version++;
            party.UpdatedAt = now;
            AddAudit(db, party, "movement_added", movement.Actor,
                $"{movement.EntryType}: {movement.DeltaMinor} TRY kuruş · {description}", now);
            try
            {
                await db.SaveChangesAsync(context.RequestAborted);
                await transaction.CommitAsync(context.RequestAborted);
            }
            catch (DbUpdateException error) when (error.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
            {
                return Fail(context, "MOVEMENT_ID_CONFLICT", 409, "Hareket kimliği zaten kullanılmış.");
            }
            return Results.Created($"/api/v1/firms/{firmId}/branches/{branchId}/caris/{partyId}/movements/{movement.Id}", View(movement));
        });
    }

    private static IResult? Guard(HttpContext context, string firmId, string branchId, bool ready, bool write)
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Fail(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanRead(firmId, branchId) || write && !actor.CanManage)
            return Fail(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubede cari erişim izni yok.");
        if (!ready) return Fail(context, "CARI_STORAGE_UNAVAILABLE", 503, "Cari PostgreSQL migration'ı uygulanmalı ve API yeniden başlatılmalı.");
        return null;
    }

    private static string[]? NormalizeTypes(string[]? types)
    {
        if (types is null || types.Length is < 1 or > 2 || types.Any(type => type is not ("customer" or "supplier"))) return null;
        var distinct = types.Distinct().Order().ToArray();
        return distinct.Length == types.Length ? distinct : null;
    }

    private static string? ValidateParty(string name, string[]? types, string? phone, string? email, string? note)
    {
        if (name.Length is < 2 or > 160 || types is null) return "Ad/unvan 2–160 karakter olmalı ve en az bir tür seçilmelidir.";
        if (phone is { Length: > 32 } || phone is not null && !System.Text.RegularExpressions.Regex.IsMatch(phone, @"^\+?[0-9 ()-]{7,32}$"))
            return "Telefon en çok 32 karakter olmalı ve telefon biçiminde yazılmalıdır.";
        if (email is { Length: > 160 } || email is not null && !System.Net.Mail.MailAddress.TryCreate(email, out _))
            return "E-posta adresi geçersiz veya 160 karakterden uzun.";
        if (note is { Length: > 500 }) return "Not en çok 500 karakter olabilir.";
        return null;
    }

    private static string? NormalizePhone(string? phone)
    {
        var value = phone?.Trim();
        return string.IsNullOrEmpty(value) ? null : value;
    }

    private static string? NormalizeEmail(string? email)
    {
        var value = email?.Trim();
        return string.IsNullOrEmpty(value) ? null : value;
    }

    private static string? NormalizeNote(string? note)
    {
        var value = note?.Trim();
        return string.IsNullOrEmpty(value) ? null : value;
    }

    private static string? NormalizeReference(string? reference)
    {
        var value = reference?.Trim();
        if (string.IsNullOrEmpty(value)) return null;
        return value.Length <= 80 ? value : "\0";
    }

    private static (string? EntryType, long? DeltaMinor, DateOnly? EffectiveDate, string? Validation) NormalizeMovement(AddCariMovement command)
    {
        var effectiveDate = command.EffectiveDate ?? DateOnly.FromDateTime(
            TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, TimeZoneInfo.FindSystemTimeZoneById("Europe/Istanbul")).DateTime);
        if (effectiveDate.Year is < 2000 or > 2100) return (null, null, null, "İşlem tarihi 2000–2100 arasında olmalı.");

        if (command.EntryType is null)
        {
            if (command.DeltaMinor is null or 0 or long.MinValue)
                return (null, null, null, "Eski istemci hareketinde sıfır olmayan deltaMinor gereklidir.");
            return ("legacy_manual", command.DeltaMinor, effectiveDate, null);
        }

        var amount = command.AmountMinor;
        if (amount is null or <= 0) return (null, null, null, "Tutar kuruş cinsinden pozitif tamsayı olmalı.");
        var type = command.EntryType;
        var sign = type switch
        {
            "customer_charge" when command.Kind == "customer" => 1,
            "customer_collection" when command.Kind == "customer" => -1,
            "supplier_debt" when command.Kind == "supplier" => 1,
            "supplier_payment" when command.Kind == "supplier" => -1,
            "adjustment_increase" => 1,
            "adjustment_decrease" => -1,
            _ => 0,
        };
        if (sign == 0) return (null, null, null, "İşlem türü cari türüyle uyumsuz.");
        if (command.DeltaMinor is not null) return (null, null, null, "Yeni işlem sözleşmesinde deltaMinor gönderilmemeli.");
        if (sign < 0 && amount == long.MaxValue) return (null, null, null, "Tutar izin verilen sınırı aşıyor.");
        return (type, sign > 0 ? amount : -amount.Value, effectiveDate, null);
    }

    private static Task<FeatureFailure?> LockManagementCapability(CariDbContext db,
        System.Data.Common.DbTransaction transaction, FeatureNewWorkGate gate, string firmId, string branchId,
        CancellationToken cancellationToken) => gate.CheckAndLockAsync(db.Database.GetDbConnection(), transaction,
            firmId, branchId, "cari.management", cancellationToken);

    private static async Task<CariWriteCapabilities> GetCapabilities(FeatureDbContext features, string firmId,
        string branchId, CancellationToken cancellationToken)
    {
        var rows = await features.BranchFeatureStates.AsNoTracking().Where(row => row.FirmId == firmId &&
            row.BranchId == branchId && row.Key == "cari.management")
            .ToDictionaryAsync(row => row.Key, cancellationToken);
        return new CariWriteCapabilities(Enabled("cari.management"));

        bool Enabled(string key) => rows.TryGetValue(key, out var row) && row.DesiredEnabled &&
            row.EffectiveForNewWork && row.Lifecycle == "ready";
    }

    private static CariPartyView View(CariPartyRow party, IEnumerable<CariMovementRow> rows)
    {
        var movements = rows.ToArray();
        return new CariPartyView(party.Id, party.Name, party.Types, party.Phone, party.Email, party.Note, party.IsActive, party.Version,
            movements.Where(row => row.Kind == "customer").Sum(row => row.DeltaMinor),
            movements.Where(row => row.Kind == "supplier").Sum(row => row.DeltaMinor), movements.Length,
            movements.Select(View).ToArray());
    }

    private static CariMovementView View(CariMovementRow row) =>
        new(row.Id, row.Kind, row.EntryType, row.DeltaMinor, row.Currency, row.Description,
            row.Reference, row.EffectiveDate, row.Source, row.Actor == "demo-seed", row.CreatedAt);

    private static void AddAudit(CariDbContext db, CariPartyRow party, string action, string actor, string detail, DateTimeOffset now) =>
        db.Audit.Add(new CariAuditRow { FirmId = party.FirmId, BranchId = party.BranchId, PartyId = party.Id,
            Action = action, Actor = actor, Detail = detail, OccurredAt = now });

    private static IResult Fail(HttpContext context, string code, int status, string detail) => Results.Json(new
    {
        type = $"https://hipos.local/problems/{code.ToLowerInvariant().Replace('_', '-')}",
        title = status switch { 401 => "Oturum gerekli", 403 => "Yetkisiz kapsam", 404 => "Bulunamadı", 409 => "İşlem çakışması", 503 => "Kurulum gerekiyor", _ => "İstek hatası" },
        status, detail, instance = context.Request.Path.Value, code, traceId = context.TraceIdentifier,
    }, statusCode: status, contentType: "application/problem+json");
}
