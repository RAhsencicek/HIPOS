using Microsoft.EntityFrameworkCore;
using BCrypt.Net;

namespace Hipos.Api.Auth;

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this IEndpointRouteBuilder app, bool authReady)
    {
        var group = app.MapGroup("/api/v1/auth");

        // 1. PATRON E-POSTA + ŞİFRE GİRİŞİ (Yönetim Paneli)
        group.MapPost("/login", async (LoginRequest request, AuthDbContext db, AuthTokenService tokenService, CancellationToken ct) =>
        {
            if (!authReady)
                return Results.Problem("Auth veritabanı henüz hazır değil.", statusCode: 503);

            if (string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrWhiteSpace(request.Password))
                return Results.BadRequest(new { error = "INVALID_CREDENTIALS", message = "E-posta ve şifre zorunludur." });

            var normalizedEmail = request.Email.Trim().ToLowerInvariant();
            var user = await db.Users.FirstOrDefaultAsync(u => u.Email == normalizedEmail && u.IsActive, ct);

            if (user is null || !BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
                return Results.Unauthorized();

            // Kullanıcının yetkili olduğu üyelik (Owner rolü)
            var membership = await db.Memberships
                .FirstOrDefaultAsync(m => m.UserId == user.Id && m.IsActive, ct);

            var role = membership?.Role ?? "owner";
            var firmId = membership?.FirmId ?? AuthDbInitializer.DefaultFirmId;
            var branchId = membership?.BranchId ?? AuthDbInitializer.DefaultBranchId;

            var (token, expiresAt) = tokenService.GenerateToken(
                user.Id, user.Email, user.FullName, role, firmId, branchId, TimeSpan.FromHours(12));

            var userDto = new AuthUserDto(user.Id, user.Email, user.FullName, role, firmId, branchId, user.Phone);
            return Results.Ok(new LoginResponse(token, userDto, expiresAt));
        });

        // 2. DOKUNMATİK 4 HANELİ PIN İLE GİRİŞ / KİLİT AÇMA (Kasiyer, Garson, Aşçı, Patron)
        group.MapPost("/pin-verify", async (PinVerifyRequest request, AuthDbContext db, AuthTokenService tokenService, CancellationToken ct) =>
        {
            if (!authReady)
                return Results.Problem("Auth veritabanı henüz hazır değil.", statusCode: 503);

            if (string.IsNullOrWhiteSpace(request.Pin) || request.Pin.Length < 4)
                return Results.BadRequest(new { error = "INVALID_PIN", message = "En az 4 haneli PIN girilmelidir." });

            // Şubedeki aktif personeller ve PIN'leri
            var memberships = await db.Memberships
                .Include(m => m.User)
                .Include(m => m.PinCode)
                .Where(m => m.FirmId == request.FirmId && m.BranchId == request.BranchId && m.IsActive)
                .ToListAsync(ct);

            // Eğer belirli bir kullanıcı seçilmişse yalnız onu kontrol et, seçilmemişse girilen PIN ile eşleşen personeli bul
            MembershipRow? matchedMembership = null;
            if (request.UserId.HasValue)
            {
                var candidate = memberships.FirstOrDefault(m => m.UserId == request.UserId.Value);
                if (candidate?.PinCode != null && BCrypt.Net.BCrypt.Verify(request.Pin, candidate.PinCode.PinHash))
                {
                    matchedMembership = candidate;
                }
            }
            else
            {
                matchedMembership = memberships.FirstOrDefault(m =>
                    m.PinCode != null &&
                    m.PinCode.IsActive &&
                    BCrypt.Net.BCrypt.Verify(request.Pin, m.PinCode.PinHash));
            }

            if (matchedMembership is null || matchedMembership.User is null)
                return Results.Unauthorized();

            var user = matchedMembership.User;
            var role = matchedMembership.Role;

            // 12 saatlik istasyon JWT token'ı
            // (Garson ve Aşçı için kesintisiz; Patron ve Kasiyer için frontend 10-15 dk hareketsizlikte tekrar PIN isteyecek)
            var (token, expiresAt) = tokenService.GenerateToken(
                user.Id, user.Email, user.FullName, role, request.FirmId, request.BranchId, TimeSpan.FromHours(12));

            var userDto = new AuthUserDto(user.Id, user.Email, user.FullName, role, request.FirmId, request.BranchId, user.Phone);
            return Results.Ok(new PinVerifyResponse(token, userDto, expiresAt));
        });

        // 3. PATRON PIN ONAYI (İkram / İndirim / İptal onaylarında tek seferlik kullanım)
        group.MapPost("/owner-override", async (OwnerOverrideRequest request, AuthDbContext db, CancellationToken ct) =>
        {
            if (!authReady)
                return Results.Problem("Auth veritabanı henüz hazır değil.", statusCode: 503);

            if (string.IsNullOrWhiteSpace(request.Pin))
                return Results.BadRequest(new { error = "PIN_REQUIRED", message = "Patron PIN kodu zorunludur." });

            var ownerMemberships = await db.Memberships
                .Include(m => m.User)
                .Include(m => m.PinCode)
                .Where(m => m.FirmId == request.FirmId && m.Role == "owner" && m.IsActive)
                .ToListAsync(ct);

            var matchedOwner = ownerMemberships.FirstOrDefault(m =>
                m.PinCode != null &&
                m.PinCode.IsActive &&
                BCrypt.Net.BCrypt.Verify(request.Pin, m.PinCode.PinHash));

            if (matchedOwner is null || matchedOwner.User is null)
                return Results.Unauthorized();

            return Results.Ok(new OwnerOverrideResponse(
                Authorized: true,
                OwnerName: matchedOwner.User.FullName,
                AuthorizedAt: DateTimeOffset.UtcNow
            ));
        });

        // 4. ŞUBEDEKİ AKTİF PERSONELLERİ LİSTELEME (POS kilit ekranında buton olarak personeli seçip PIN girmek için)
        group.MapGet("/quick-staff", async (string firmId, string branchId, AuthDbContext db, CancellationToken ct) =>
        {
            if (!authReady)
                return Results.Problem("Auth veritabanı henüz hazır değil.", statusCode: 503);

            var staffList = await db.Memberships
                .Include(m => m.User)
                .Where(m => m.FirmId == firmId && m.BranchId == branchId && m.IsActive && m.User != null && m.User.IsActive)
                .Select(m => new QuickStaffDto(m.UserId, m.User!.FullName, m.Role))
                .ToListAsync(ct);

            return Results.Ok(staffList);
        });
    }
}