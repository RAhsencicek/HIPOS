using Hipos.Api.Features;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using System.Globalization;

namespace Hipos.Api.Cari;

public sealed record CreateCariParty(string Name, string[] Types);
public sealed record UpdateCariParty(string Name, string[] Types, bool IsActive, int ExpectedVersion);
public sealed record AddCariMovement(string RequestId, string Kind, long DeltaMinor, string Description, int ExpectedVersion);
public sealed record CariMovementView(string Id, string Kind, long DeltaMinor, string Currency, string Description, string Source, DateTimeOffset CreatedAt);
public sealed record CariPartyView(string Id, string Name, string[] Types, bool IsActive, int Version,
    long CustomerBalanceMinor, long SupplierBalanceMinor, int MovementCount, CariMovementView[] Movements);
public sealed record CariStatementView(string PartyId, string From, string To, string TimeZone,
    long OpeningCustomerBalanceMinor, long OpeningSupplierBalanceMinor,
    long PeriodCustomerDeltaMinor, long PeriodSupplierDeltaMinor,
    long ClosingCustomerBalanceMinor, long ClosingSupplierBalanceMinor, CariMovementView[] Movements);

public static class CariEndpoints
{
    public static void MapCariEndpoints(this WebApplication app, bool ready)
    {
        var group = app.MapGroup("/api/v1/firms/{firmId}/branches/{branchId}/caris");

        group.MapGet("", async (string firmId, string branchId, string? type, HttpContext context, CariDbContext db) =>
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
                .OrderBy(row => row.CreatedAt).ThenBy(row => row.Id).ToListAsync(context.RequestAborted);
            return Results.Ok(new { items = parties.Select(row => View(row, movements.Where(item => item.PartyId == row.Id))).ToArray() });
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
            var zone = TimeZoneInfo.FindSystemTimeZoneById("Europe/Istanbul");
            var start = new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(fromDate.ToDateTime(TimeOnly.MinValue), zone));
            var end = new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(toDate.AddDays(1).ToDateTime(TimeOnly.MinValue), zone));
            var rows = await db.Movements.AsNoTracking()
                .Where(row => row.PartyId == partyId && row.FirmId == firmId && row.BranchId == branchId && row.CreatedAt < end)
                .OrderBy(row => row.CreatedAt).ThenBy(row => row.Id).ToListAsync(context.RequestAborted);
            var openingCustomer = rows.Where(row => row.CreatedAt < start && row.Kind == "customer").Sum(row => row.DeltaMinor);
            var openingSupplier = rows.Where(row => row.CreatedAt < start && row.Kind == "supplier").Sum(row => row.DeltaMinor);
            var period = rows.Where(row => row.CreatedAt >= start).ToArray();
            var customerDelta = period.Where(row => row.Kind == "customer").Sum(row => row.DeltaMinor);
            var supplierDelta = period.Where(row => row.Kind == "supplier").Sum(row => row.DeltaMinor);
            return Results.Ok(new CariStatementView(partyId, fromDate.ToString("yyyy-MM-dd"), toDate.ToString("yyyy-MM-dd"),
                "Europe/Istanbul", openingCustomer, openingSupplier, customerDelta, supplierDelta,
                checked(openingCustomer + customerDelta), checked(openingSupplier + supplierDelta),
                period.Select(View).ToArray()));
        });

        group.MapPost("", async (string firmId, string branchId, CreateCariParty command, HttpContext context, CariDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            var name = command.Name?.Trim() ?? "";
            var types = NormalizeTypes(command.Types);
            if (name.Length is < 2 or > 160 || types is null)
                return Fail(context, "INVALID_CARI", 400, "Ad 2–160 karakter ve tür müşteri/tedarikçi olmalı.");
            var now = DateTimeOffset.UtcNow;
            var party = new CariPartyRow { Id = Guid.NewGuid().ToString(), FirmId = firmId, BranchId = branchId,
                Name = name, Types = types, UpdatedAt = now };
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            db.Parties.Add(party);
            AddAudit(db, party, "created", DemoAccess.Resolve(context)!.Name, name, now);
            await db.SaveChangesAsync(context.RequestAborted);
            await transaction.CommitAsync(context.RequestAborted);
            return Results.Created($"/api/v1/firms/{firmId}/branches/{branchId}/caris/{party.Id}", View(party, []));
        });

        group.MapPut("/{partyId}", async (string firmId, string branchId, string partyId, UpdateCariParty command, HttpContext context, CariDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            var name = command.Name?.Trim() ?? "";
            var types = NormalizeTypes(command.Types);
            if (name.Length is < 2 or > 160 || types is null || command.ExpectedVersion < 1)
                return Fail(context, "INVALID_CARI", 400, "Cari adı, türü veya sürümü geçersiz.");
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var party = await db.Parties.FromSqlInterpolated($"SELECT * FROM cari.parties WHERE id = {partyId} AND firm_id = {firmId} AND branch_id = {branchId} FOR UPDATE")
                .SingleOrDefaultAsync(context.RequestAborted);
            if (party is null) return Fail(context, "CARI_NOT_FOUND", 404, "Cari kartı bulunamadı.");
            if (party.Version != command.ExpectedVersion) return Fail(context, "VERSION_CONFLICT", 409, "Cari kartı başka bir işlemle değişti.");
            var usedKinds = await db.Movements.Where(row => row.PartyId == partyId).Select(row => row.Kind).Distinct().ToListAsync(context.RequestAborted);
            if (usedKinds.Any(kind => !types.Contains(kind)))
                return Fail(context, "CARI_TYPE_IN_USE", 409, "Hareketi olan müşteri/tedarikçi türü kaldırılamaz.");
            party.Name = name;
            party.Types = types;
            party.IsActive = command.IsActive;
            party.Version++;
            party.UpdatedAt = DateTimeOffset.UtcNow;
            AddAudit(db, party, "updated", DemoAccess.Resolve(context)!.Name, name, party.UpdatedAt);
            await db.SaveChangesAsync(context.RequestAborted);
            await transaction.CommitAsync(context.RequestAborted);
            var movements = await db.Movements.AsNoTracking().Where(row => row.PartyId == partyId).ToListAsync(context.RequestAborted);
            return Results.Ok(View(party, movements));
        });

        group.MapPost("/{partyId}/movements", async (string firmId, string branchId, string partyId, AddCariMovement command, HttpContext context, CariDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            var description = command.Description?.Trim() ?? "";
            if (!Guid.TryParse(command.RequestId, out _) || command.Kind is not ("customer" or "supplier") ||
                command.DeltaMinor == 0 || command.DeltaMinor == long.MinValue || description.Length is < 3 or > 500 || command.ExpectedVersion < 1)
                return Fail(context, "INVALID_CARI_MOVEMENT", 400, "Hareket kimliği, türü, tutarı, açıklaması veya kart sürümü geçersiz.");
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var party = await db.Parties.FromSqlInterpolated($"SELECT * FROM cari.parties WHERE id = {partyId} AND firm_id = {firmId} AND branch_id = {branchId} FOR UPDATE")
                .SingleOrDefaultAsync(context.RequestAborted);
            if (party is null) return Fail(context, "CARI_NOT_FOUND", 404, "Cari kartı bulunamadı.");
            var existing = await db.Movements.AsNoTracking().SingleOrDefaultAsync(row => row.Id == command.RequestId, context.RequestAborted);
            if (existing is not null)
                return existing.PartyId == partyId && existing.FirmId == firmId && existing.BranchId == branchId &&
                    existing.Kind == command.Kind && existing.DeltaMinor == command.DeltaMinor && existing.Description == description
                    ? Results.Ok(View(existing))
                    : Fail(context, "MOVEMENT_ID_CONFLICT", 409, "Hareket kimliği farklı içerikle kullanılmış.");
            if (party.Version != command.ExpectedVersion) return Fail(context, "VERSION_CONFLICT", 409, "Cari kartı başka bir işlemle değişti.");
            if (!party.IsActive || !party.Types.Contains(command.Kind))
                return Fail(context, "CARI_TYPE_UNAVAILABLE", 409, "Bu türde aktif cari kartı yok.");
            var now = DateTimeOffset.UtcNow;
            var movement = new CariMovementRow { Id = command.RequestId, FirmId = firmId, BranchId = branchId,
                PartyId = partyId, Kind = command.Kind, DeltaMinor = command.DeltaMinor,
                Description = description, Actor = DemoAccess.Resolve(context)!.Name, CreatedAt = now };
            db.Movements.Add(movement);
            party.Version++;
            party.UpdatedAt = now;
            AddAudit(db, party, "movement_added", movement.Actor, $"{movement.Kind}: {movement.DeltaMinor} TRY kuruş · {description}", now);
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

    private static CariPartyView View(CariPartyRow party, IEnumerable<CariMovementRow> rows)
    {
        var movements = rows.ToArray();
        return new CariPartyView(party.Id, party.Name, party.Types, party.IsActive, party.Version,
            movements.Where(row => row.Kind == "customer").Sum(row => row.DeltaMinor),
            movements.Where(row => row.Kind == "supplier").Sum(row => row.DeltaMinor), movements.Length,
            movements.Select(View).ToArray());
    }

    private static CariMovementView View(CariMovementRow row) =>
        new(row.Id, row.Kind, row.DeltaMinor, row.Currency, row.Description, row.Source, row.CreatedAt);

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
