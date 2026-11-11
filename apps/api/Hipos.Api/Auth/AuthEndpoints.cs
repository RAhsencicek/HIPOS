using System.Security.Cryptography;
using System.Text;
using BCrypt.Net;
using Hipos.Api.Features;
using Microsoft.EntityFrameworkCore;

namespace Hipos.Api.Auth;

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this IEndpointRouteBuilder app, bool authReady, bool isDevelopment = false)
    {
        var group = app.MapGroup("/api/v1/auth");

        // 1. PATRON / YÖNETİCİ E-POSTA + ŞİFRE GİRİŞİ
        group.MapPost("/login", async (LoginRequest request, AuthDbContext db, AuthTokenService tokenService, CancellationToken ct) =>
        {
            if (!authReady)
                return Results.Problem("Auth veritabanı henüz hazır değil.", statusCode: 503);

            if (string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrWhiteSpace(request.Password))
                return Results.BadRequest(new { error = "MISSING_CREDENTIALS", message = "E-posta ve şifre zorunludur." });

            var email = request.Email.Trim().ToLowerInvariant();
            var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email && u.IsActive, ct);

            if (user is null || !BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
                return Results.Unauthorized();

            var scope = await ResolveUserScopeAsync(db, user, null, null, ct);
            if (scope is null)
                return Results.Unauthorized();

            var (token, expiresAt) = tokenService.GenerateToken(
                user.Id,
                user.Email,
                user.FullName,
                scope.User.Role,
                scope.User.FirmId,
                scope.User.BranchId,
                TimeSpan.FromHours(12),
                scope.AllowedScopes,
                user.IsPlatformAdmin);

            return Results.Ok(new LoginResponse(token, scope.User, expiresAt, scope.Firm, scope.Branches));
        });

        // 1B. AKTİF OTURUM, FİRMA VE YETKİLİ ŞUBELER BİLGİSİ
        group.MapGet("/me", async (HttpContext context, AuthDbContext db, CancellationToken ct) =>
        {
            if (!authReady)
                return Results.Problem("Auth veritabanı henüz hazır değil.", statusCode: 503);

            var actor = DemoAccess.Resolve(context);
            if (actor is null || !actor.IsRealAuth || !Guid.TryParse(actor.UserId, out var userId))
                return Results.Unauthorized();

            var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId && u.IsActive, ct);
            if (user is null)
                return Results.Unauthorized();

            var scope = await ResolveUserScopeAsync(db, user, actor.FirmId, actor.BranchId, ct);
            if (scope is null)
                return Results.Unauthorized();

            return Results.Ok(new AuthMeResponse(scope.User, scope.Firm, scope.Branches));
        });

        // 1C. AKTİF ŞUBE / İŞLETME DEĞİŞTİRME (Yeni imzalı JWT üretir)
        group.MapPost("/switch-scope", async (SwitchScopeRequest request, HttpContext context, AuthDbContext db, AuthTokenService tokenService, CancellationToken ct) =>
        {
            if (!authReady)
                return Results.Problem("Auth veritabanı henüz hazır değil.", statusCode: 503);

            var actor = DemoAccess.Resolve(context);
            if (actor is null || !actor.IsRealAuth || !Guid.TryParse(actor.UserId, out var userId))
                return Results.Unauthorized();

            var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId && u.IsActive, ct);
            if (user is null)
                return Results.Unauthorized();

            var scope = await ResolveUserScopeAsync(db, user, request.FirmId, request.BranchId, ct);
            if (scope is null ||
                !string.Equals(scope.User.FirmId, request.FirmId, StringComparison.Ordinal) ||
                !string.Equals(scope.User.BranchId, request.BranchId, StringComparison.Ordinal))
            {
                return Results.Json(
                    new { error = "UNAUTHORIZED_SCOPE", message = "Seçilen işletme veya şube üzerinde yetkiniz yok." },
                    statusCode: 403);
            }

            var (token, expiresAt) = tokenService.GenerateToken(
                user.Id,
                user.Email,
                user.FullName,
                scope.User.Role,
                scope.User.FirmId,
                scope.User.BranchId,
                TimeSpan.FromHours(12),
                scope.AllowedScopes,
                user.IsPlatformAdmin);

            return Results.Ok(new LoginResponse(token, scope.User, expiresAt, scope.Firm, scope.Branches));
        });

        // 1D. KULLANICININ KENDİ ŞİFRESİNİ DEĞİŞTİRMESİ
        group.MapPost("/change-password", async (ChangePasswordRequest request, HttpContext context, AuthDbContext db, CancellationToken ct) =>
        {
            if (!authReady)
                return Results.Problem("Auth veritabanı henüz hazır değil.", statusCode: 503);

            var actor = DemoAccess.Resolve(context);
            if (actor is null || !actor.IsRealAuth || !Guid.TryParse(actor.UserId, out var userId))
                return Results.Unauthorized();

            if (string.IsNullOrWhiteSpace(request.NewPassword) || request.NewPassword.Length < 6)
            {
                return Results.BadRequest(new
                {
                    error = "INVALID_NEW_PASSWORD",
                    message = "Yeni şifre en az 6 karakter olmalıdır."
                });
            }

            var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId && u.IsActive, ct);
            if (user is null)
                return Results.Unauthorized();

            if (!BCrypt.Net.BCrypt.Verify(request.CurrentPassword ?? "", user.PasswordHash))
            {
                return Results.BadRequest(new
                {
                    error = "INVALID_CURRENT_PASSWORD",
                    message = "Mevcut şifre doğrulanamadı."
                });
            }

            user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword);
            user.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);

            return Results.Ok(new { updated = true });
        });

        // 1E. POS TERMİNAL BAĞLAMA İÇİN ŞUBE BİLGİSİ (Kilit ekranında şube adını göstermek için)
        group.MapGet("/branch-info", async (string firmId, string branchId, AuthDbContext db, CancellationToken ct) =>
        {
            if (!authReady)
                return Results.Problem("Auth veritabanı henüz hazır değil.", statusCode: 503);

            var branch = await db.Branches
                .AsNoTracking()
                .Include(b => b.Firm)
                .FirstOrDefaultAsync(b =>
                    b.Id == branchId &&
                    b.FirmId == firmId &&
                    b.IsActive &&
                    b.Firm != null &&
                    b.Firm.IsActive, ct);

            if (branch is null || branch.Firm is null)
                return Results.NotFound(new { error = "BRANCH_NOT_FOUND", message = "Belirtilen şube bulunamadı veya pasif." });

            return Results.Ok(new
            {
                firmId = branch.FirmId,
                firmName = branch.Firm.Name,
                brandName = branch.Firm.BrandName,
                branchId = branch.Id,
                branchName = branch.Name,
                branchCode = branch.Code,
                district = branch.District
            });
        });

        // 2. DOKUNMATİK PIN İLE GİRİŞ / KİLİT AÇMA (Kasiyer, Garson, Aşçı, Patron)
        group.MapPost("/pin-verify", async (PinVerifyRequest request, AuthDbContext db, AuthTokenService tokenService, CancellationToken ct) =>
        {
            if (!authReady)
                return Results.Problem("Auth veritabanı henüz hazır değil.", statusCode: 503);

            if (string.IsNullOrWhiteSpace(request.Pin) || request.Pin.Length < 4)
                return Results.BadRequest(new { error = "INVALID_PIN", message = "En az 4 haneli PIN girilmelidir." });

            var branchDeactivated = await db.Branches.AsNoTracking()
                .AnyAsync(b => b.Id == request.BranchId && b.FirmId == request.FirmId && !b.IsActive, ct);
            if (branchDeactivated)
                return Results.Unauthorized();

            var memberships = await db.Memberships
                .Include(m => m.User)
                .Include(m => m.PinCode)
                .Where(m => m.FirmId == request.FirmId && m.BranchId == request.BranchId && m.IsActive)
                .ToListAsync(ct);

            MembershipRow? matchedMembership = null;
            if (request.UserId.HasValue)
            {
                var candidate = memberships.FirstOrDefault(m => m.UserId == request.UserId.Value);
                if (candidate?.PinCode != null &&
                    candidate.PinCode.IsActive &&
                    BCrypt.Net.BCrypt.Verify(request.Pin, candidate.PinCode.PinHash))
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

            if (matchedMembership is null || matchedMembership.User is null || !matchedMembership.User.IsActive)
                return Results.Unauthorized();

            var user = matchedMembership.User;
            var role = matchedMembership.Role;

            var (token, expiresAt) = tokenService.GenerateToken(
                user.Id,
                user.Email,
                user.FullName,
                role,
                request.FirmId,
                request.BranchId,
                TimeSpan.FromHours(12),
                [$"{request.FirmId}:{request.BranchId}"],
                user.IsPlatformAdmin);

            var userDto = new AuthUserDto(
                user.Id, user.Email, user.FullName, role, request.FirmId, request.BranchId, user.Phone, user.IsPlatformAdmin);
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
                m.User != null &&
                m.User.IsActive &&
                BCrypt.Net.BCrypt.Verify(request.Pin, m.PinCode.PinHash));

            if (matchedOwner is null || matchedOwner.User is null)
                return Results.Unauthorized();

            return Results.Ok(new OwnerOverrideResponse(
                Authorized: true,
                OwnerName: matchedOwner.User.FullName,
                AuthorizedAt: DateTimeOffset.UtcNow
            ));
        });

        // 4. ŞUBEDEKİ AKTİF PERSONELLERİ LİSTELEME (POS kilit ekranında personel seçimi için)
        group.MapGet("/quick-staff", async (string firmId, string branchId, AuthDbContext db, CancellationToken ct) =>
        {
            if (!authReady)
                return Results.Problem("Auth veritabanı henüz hazır değil.", statusCode: 503);

            var branchDeactivated = await db.Branches.AsNoTracking()
                .AnyAsync(b => b.Id == branchId && b.FirmId == firmId && !b.IsActive, ct);
            if (branchDeactivated)
                return Results.Ok(Array.Empty<QuickStaffDto>());

            var staffList = await db.Memberships
                .Include(m => m.User)
                .Where(m => m.FirmId == firmId && m.BranchId == branchId && m.IsActive && m.User != null && m.User.IsActive)
                .Select(m => new QuickStaffDto(m.UserId, m.User!.FullName, m.Role))
                .ToListAsync(ct);

            return Results.Ok(staffList);
        });

        // 5. İŞLETMEYE YENİ ŞUBE EKLEME (Patron / Platform Yöneticisi)
        app.MapPost("/api/v1/firms/{firmId}/branches", async (
            string firmId,
            CreateBranchRequest request,
            HttpContext context,
            TenantProvisioningService provisioning,
            AuthDbContext db,
            AuthTokenService tokenService,
            CancellationToken ct) =>
        {
            if (!authReady)
                return Results.Problem("Auth veritabanı henüz hazır değil.", statusCode: 503);

            var actor = DemoAccess.Resolve(context);
            if (actor is null)
                return Results.Unauthorized();

            var canCreateBranch =
                actor.IsPlatformAdmin ||
                (DemoAccess.CanReadFirm(actor, firmId) &&
                 (string.Equals(actor.Role, "owner", StringComparison.OrdinalIgnoreCase) || (!actor.IsRealAuth && actor.CanManage)));

            if (!canCreateBranch)
            {
                return Results.Json(
                    new { error = "UNAUTHORIZED_BRANCH_CREATE", message = "Yeni şube açma yetkisi yalnızca işletme sahibine aittir." },
                    statusCode: 403);
            }

            var created = await provisioning.CreateBranchAsync(firmId, request, actor.Name, ct);
            if (created.ErrorCode is not null)
            {
                return Results.Json(new { error = created.ErrorCode, message = created.ErrorMessage }, statusCode: created.ErrorStatus);
            }

            string? refreshedToken = null;
            DateTimeOffset? refreshedExpiresAt = null;
            IReadOnlyList<AuthBranchDto>? updatedBranches = null;

            if (actor.IsRealAuth && Guid.TryParse(actor.UserId, out var userId))
            {
                var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId && u.IsActive, ct);
                if (user is not null)
                {
                    var scope = await ResolveUserScopeAsync(db, user, firmId, created.Branch.Id, ct);
                    if (scope is not null)
                    {
                        var issued = tokenService.GenerateToken(
                            user.Id,
                            user.Email,
                            user.FullName,
                            scope.User.Role,
                            scope.User.FirmId,
                            scope.User.BranchId,
                            TimeSpan.FromHours(12),
                            scope.AllowedScopes,
                            user.IsPlatformAdmin);
                        refreshedToken = issued.Token;
                        refreshedExpiresAt = issued.ExpiresAt;
                        updatedBranches = scope.Branches;
                    }
                }
            }

            return Results.Created(
                $"/api/v1/firms/{firmId}/branches/{created.Branch.Id}",
                new
                {
                    branch = created.Branch,
                    token = refreshedToken,
                    expiresAt = refreshedExpiresAt,
                    branches = updatedBranches,
                    terminalUrls = BuildTerminalUrls(firmId, created.Branch.Id)
                });
        });

        // 6. SIFIRDAN YENİ RESTORAN / İŞLETME KURULUMU (Platform Onboarding)
        app.MapPost("/api/v1/onboarding/tenants", async (
            OnboardTenantRequest request,
            HttpContext context,
            TenantProvisioningService provisioning,
            IConfiguration configuration,
            CancellationToken ct) =>
        {
            if (!authReady)
                return Results.Problem("Auth veritabanı henüz hazır değil.", statusCode: 503);

            var actor = DemoAccess.Resolve(context);
            var configuredKey = configuration["HIPOS_PLATFORM_ADMIN_KEY"];
            var suppliedKey = context.Request.Headers["X-Platform-Admin-Key"].FirstOrDefault();
            var hasValidPlatformKey =
                !string.IsNullOrWhiteSpace(configuredKey) &&
                !string.IsNullOrWhiteSpace(suppliedKey) &&
                CryptographicOperations.FixedTimeEquals(
                    Encoding.UTF8.GetBytes(configuredKey),
                    Encoding.UTF8.GetBytes(suppliedKey));

            var allowed = isDevelopment || hasValidPlatformKey || (actor?.IsPlatformAdmin ?? false);
            if (!allowed)
            {
                return Results.Json(
                    new
                    {
                        error = "ONBOARDING_FORBIDDEN",
                        message = "Yeni işletme kurulumu için geçerli X-Platform-Admin-Key veya platform yöneticisi oturumu gereklidir."
                    },
                    statusCode: 403);
            }

            var (result, code, status, message) = await provisioning.CreateTenantAsync(request, ct);
            if (result is null)
            {
                return Results.Json(new { error = code ?? "ONBOARDING_FAILED", message }, statusCode: status);
            }

            return Results.Created(
                $"/api/v1/firms/{result.Firm.Id}/branches/{result.Branch.Id}",
                new
                {
                    firm = result.Firm,
                    branch = result.Branch,
                    owner = result.Owner,
                    token = result.Token,
                    expiresAt = result.ExpiresAt,
                    terminalUrls = BuildTerminalUrls(result.Firm.Id, result.Branch.Id)
                });
        });
    }

    private static object BuildTerminalUrls(string firmId, string branchId) => new
    {
        waiter = $"/waiter?firmId={Uri.EscapeDataString(firmId)}&branchId={Uri.EscapeDataString(branchId)}",
        cashier = $"/cashier?firmId={Uri.EscapeDataString(firmId)}&branchId={Uri.EscapeDataString(branchId)}",
        kitchen = $"/kitchen?firmId={Uri.EscapeDataString(firmId)}&branchId={Uri.EscapeDataString(branchId)}",
        qrMenu = $"/menu/{Uri.EscapeDataString(firmId)}/{Uri.EscapeDataString(branchId)}"
    };

    private sealed record ResolvedUserScope(
        AuthUserDto User,
        AuthFirmDto? Firm,
        IReadOnlyList<AuthBranchDto> Branches,
        IReadOnlyCollection<string> AllowedScopes
    );

    private static async Task<ResolvedUserScope?> ResolveUserScopeAsync(
        AuthDbContext db,
        UserRow user,
        string? preferredFirmId,
        string? preferredBranchId,
        CancellationToken ct)
    {
        var memberships = await db.Memberships
            .AsNoTracking()
            .Where(m => m.UserId == user.Id && m.IsActive)
            .OrderBy(m => m.CreatedAt)
            .ToListAsync(ct);

        if (memberships.Count == 0 && !user.IsPlatformAdmin)
            return null;

        var ownerFirmIds = memberships
            .Where(m => string.Equals(m.Role, "owner", StringComparison.OrdinalIgnoreCase))
            .Select(m => m.FirmId)
            .ToHashSet(StringComparer.Ordinal);

        string? selectedFirmId = null;
        if (!string.IsNullOrWhiteSpace(preferredFirmId))
        {
            var hasFirmAccess = user.IsPlatformAdmin ||
                                memberships.Any(m => m.FirmId == preferredFirmId);
            if (!hasFirmAccess)
                return null;
            selectedFirmId = preferredFirmId;
        }
        else
        {
            selectedFirmId = memberships.FirstOrDefault()?.FirmId;
            if (selectedFirmId is null && user.IsPlatformAdmin)
            {
                selectedFirmId = await db.Firms.AsNoTracking()
                    .Where(f => f.IsActive)
                    .OrderBy(f => f.CreatedAt)
                    .Select(f => f.Id)
                    .FirstOrDefaultAsync(ct);
            }
        }

        if (string.IsNullOrWhiteSpace(selectedFirmId))
            return null;

        var firmRow = await db.Firms.AsNoTracking()
            .FirstOrDefaultAsync(f => f.Id == selectedFirmId && f.IsActive, ct);

        var allFirmBranches = await db.Branches.AsNoTracking()
            .Where(b => b.FirmId == selectedFirmId && b.IsActive)
            .OrderBy(b => b.CreatedAt)
            .ToListAsync(ct);

        var directFirmBranchIds = memberships
            .Where(m => m.FirmId == selectedFirmId)
            .Select(m => m.BranchId)
            .ToHashSet(StringComparer.Ordinal);

        var canSeeAllBranchesInFirm = user.IsPlatformAdmin || ownerFirmIds.Contains(selectedFirmId);
        var authorizedBranches = allFirmBranches
            .Where(b => canSeeAllBranchesInFirm || directFirmBranchIds.Contains(b.Id))
            .Select(b => new AuthBranchDto(b.Id, b.FirmId, b.Code, b.Name, b.District))
            .ToList();

        string activeBranchId;
        if (!string.IsNullOrWhiteSpace(preferredBranchId))
        {
            var matchedBranch = authorizedBranches.Any(b => b.Id == preferredBranchId) ||
                                (!canSeeAllBranchesInFirm && directFirmBranchIds.Contains(preferredBranchId));
            if (!matchedBranch)
                return null;
            activeBranchId = preferredBranchId;
        }
        else
        {
            activeBranchId = authorizedBranches.FirstOrDefault()?.Id
                             ?? memberships.FirstOrDefault(m => m.FirmId == selectedFirmId)?.BranchId
                             ?? AuthDbInitializer.DefaultBranchId;
        }

        var role = memberships.FirstOrDefault(m => m.FirmId == selectedFirmId && m.BranchId == activeBranchId)?.Role;
        if (string.IsNullOrWhiteSpace(role))
        {
            if (ownerFirmIds.Contains(selectedFirmId) || user.IsPlatformAdmin)
                role = "owner";
            else
                role = memberships.FirstOrDefault(m => m.FirmId == selectedFirmId)?.Role ?? "waiter";
        }

        var allowedScopes = new HashSet<string>(StringComparer.Ordinal)
        {
            $"{selectedFirmId}:{activeBranchId}"
        };
        foreach (var membership in memberships)
        {
            allowedScopes.Add($"{membership.FirmId}:{membership.BranchId}");
        }
        foreach (var branch in authorizedBranches)
        {
            allowedScopes.Add($"{branch.FirmId}:{branch.Id}");
        }

        if (ownerFirmIds.Count > 0)
        {
            var ownedFirmBranches = await db.Branches.AsNoTracking()
                .Where(b => ownerFirmIds.Contains(b.FirmId) && b.IsActive)
                .Select(b => new { b.FirmId, b.Id })
                .ToListAsync(ct);
            foreach (var branch in ownedFirmBranches)
            {
                allowedScopes.Add($"{branch.FirmId}:{branch.Id}");
            }
        }

        var firmDto = firmRow is null
            ? null
            : new AuthFirmDto(firmRow.Id, firmRow.Code, firmRow.Name, firmRow.BrandName);

        var userDto = new AuthUserDto(
            user.Id,
            user.Email,
            user.FullName,
            role,
            selectedFirmId,
            activeBranchId,
            user.Phone,
            user.IsPlatformAdmin);

        return new ResolvedUserScope(userDto, firmDto, authorizedBranches, allowedScopes);
    }
}
