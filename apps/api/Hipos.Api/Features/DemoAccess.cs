using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Hipos.Api.Auth;

namespace Hipos.Api.Features;

public sealed record DemoActor(
    string Name,
    bool CanManage,
    bool CanOperate,
    IReadOnlySet<string> AllowedBranches,
    string Role = "demo",
    bool IsRealAuth = false,
    string? UserId = null,
    string? FirmId = null,
    bool IsPlatformAdmin = false,
    string? BranchId = null)
{
    public bool IsBridge => string.Equals(Role, "bridge", StringComparison.OrdinalIgnoreCase);

    public bool CanRead(string firmId, string branchId) =>
        !IsBridge && AllowedBranches.Contains($"{firmId}:{branchId}");

    public bool CanAccessPrintBridge(string firmId, string branchId) =>
        AllowedBranches.Contains($"{firmId}:{branchId}");
}

public static class DemoAccess
{
    private static AuthTokenService? _tokenService;
    private static bool _allowDemoActor;

    public static void Configure(AuthTokenService tokenService, bool allowDemoActor)
    {
        _tokenService = tokenService;
        _allowDemoActor = allowDemoActor;
    }

    public static bool CanReadFirm(DemoActor actor, string firmId)
    {
        if (actor.IsBridge)
            return false;

        if (actor.IsRealAuth)
        {
            return actor.FirmId == firmId ||
                   actor.AllowedBranches.Any(scope => scope.StartsWith($"{firmId}:", StringComparison.Ordinal));
        }

        string[] allBranches = firmId switch
        {
            InMemoryFeatureStore.SingleFirm => [InMemoryFeatureStore.SingleBranch],
            InMemoryFeatureStore.MultiFirm =>
            [InMemoryFeatureStore.ModaBranch, InMemoryFeatureStore.BesiktasBranch, InMemoryFeatureStore.AtasehirBranch],
            _ => [],
        };
        return allBranches.Length > 0 && allBranches.All(branch => actor.CanRead(firmId, branch));
    }

    // Yalnız geliştirme prototipi. Gerçek firma/şube üyeliği JWT kapsamından doğrulanır.
    public static bool CanReadCatalog(DemoActor actor, string firmId, string? branchId)
    {
        if (branchId is not null) return actor.CanRead(firmId, branchId);
        if (actor.IsRealAuth)
        {
            return actor.CanManage && CanReadFirm(actor, firmId);
        }
        return CanReadFirm(actor, firmId);
    }

    private static readonly IReadOnlyDictionary<string, DemoActor> Actors =
        new Dictionary<string, DemoActor>
        {
            ["manager-single"] = new("manager-single", true, false,
                new HashSet<string> { Scope(InMemoryFeatureStore.SingleFirm, InMemoryFeatureStore.SingleBranch) }),
            ["manager-multi"] = new("manager-multi", true, false,
                new HashSet<string>
                {
                    Scope(InMemoryFeatureStore.MultiFirm, InMemoryFeatureStore.ModaBranch),
                    Scope(InMemoryFeatureStore.MultiFirm, InMemoryFeatureStore.BesiktasBranch),
                    Scope(InMemoryFeatureStore.MultiFirm, InMemoryFeatureStore.AtasehirBranch),
                }),
            ["manager-moda"] = new("manager-moda", true, false,
                new HashSet<string> { Scope(InMemoryFeatureStore.MultiFirm, InMemoryFeatureStore.ModaBranch) }),
            ["viewer-multi"] = new("viewer-multi", false, false,
                new HashSet<string>
                {
                    Scope(InMemoryFeatureStore.MultiFirm, InMemoryFeatureStore.ModaBranch),
                    Scope(InMemoryFeatureStore.MultiFirm, InMemoryFeatureStore.BesiktasBranch),
                    Scope(InMemoryFeatureStore.MultiFirm, InMemoryFeatureStore.AtasehirBranch),
                }),
            ["pos-single"] = new("pos-single", false, true,
                new HashSet<string> { Scope(InMemoryFeatureStore.SingleFirm, InMemoryFeatureStore.SingleBranch) }),
            ["pos-moda"] = new("pos-moda", false, true,
                new HashSet<string> { Scope(InMemoryFeatureStore.MultiFirm, InMemoryFeatureStore.ModaBranch) }),
            ["pos-besiktas"] = new("pos-besiktas", false, true,
                new HashSet<string> { Scope(InMemoryFeatureStore.MultiFirm, InMemoryFeatureStore.BesiktasBranch) }),
        };
    public static DemoActor? Resolve(HttpContext context)
    {
        // 1. Önce gelen istekte imzalı JWT Bearer Token var mı kontrol et (Header veya GET ?token=)
        var authHeader = context.Request.Headers.Authorization.ToString();
        string? tokenString = null;
        if (!string.IsNullOrWhiteSpace(authHeader) && authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            tokenString = authHeader["Bearer ".Length..].Trim();
        }
        else if (HttpMethods.IsGet(context.Request.Method) &&
                 context.Request.Query.TryGetValue("token", out var queryToken) &&
                 !string.IsNullOrWhiteSpace(queryToken))
        {
            tokenString = queryToken.ToString().Trim();
        }

        if (!string.IsNullOrWhiteSpace(tokenString))
        {
            var tokenService = _tokenService ?? context.RequestServices.GetService<AuthTokenService>();
            var principal = tokenService?.ValidateToken(tokenString);
            if (principal is null)
            {
                // İmzası sahte, bozuk veya süresi dolmuş token ASLA X-Demo-Actor'e düşmemelidir.
                return null;
            }

            var role = principal.Claims.FirstOrDefault(c => c.Type == "role" || c.Type == ClaimTypes.Role)?.Value ?? "waiter";
            var firmId = principal.Claims.FirstOrDefault(c => c.Type == "firmId")?.Value;
            var branchId = principal.Claims.FirstOrDefault(c => c.Type == "branchId")?.Value;
            var name = principal.Claims.FirstOrDefault(c =>
                c.Type == JwtRegisteredClaimNames.Name || c.Type == "name" || c.Type == ClaimTypes.Name)?.Value ?? role;
            var userId = principal.Claims.FirstOrDefault(c =>
                c.Type == JwtRegisteredClaimNames.Sub || c.Type == "sub" || c.Type == ClaimTypes.NameIdentifier)?.Value;
            var isPlatformAdmin = string.Equals(
                principal.Claims.FirstOrDefault(c => c.Type == "isPlatformAdmin")?.Value,
                "true",
                StringComparison.OrdinalIgnoreCase);

            var allowedBranches = new HashSet<string>(StringComparer.Ordinal);
            if (!string.IsNullOrWhiteSpace(firmId) && !string.IsNullOrWhiteSpace(branchId))
            {
                allowedBranches.Add(Scope(firmId, branchId));
            }
            foreach (var claim in principal.Claims.Where(c => c.Type == "branchScope"))
            {
                if (!string.IsNullOrWhiteSpace(claim.Value))
                    allowedBranches.Add(claim.Value);
            }

            if (allowedBranches.Count == 0 && !isPlatformAdmin)
                return null;

            bool canManage = role is "owner" or "manager";
            bool canOperate = role is "owner" or "manager" or "cashier" or "waiter" or "chef" or "kitchen";

            return new DemoActor(name, canManage, canOperate, allowedBranches, role, true, userId, firmId, isPlatformAdmin, branchId);
        }

        // 2. X-Demo-Actor / ?actor= YALNIZ geliştirme/test ortamında (ve açık izinliyken) çalışır
        if (!_allowDemoActor)
            return null;

        var actorKey = context.Request.Headers["X-Demo-Actor"].ToString();
        if (string.IsNullOrWhiteSpace(actorKey) && HttpMethods.IsGet(context.Request.Method))
        {
            actorKey = context.Request.Query["actor"].ToString();
        }
        return Actors.TryGetValue(actorKey, out var actor) ? actor : null;
    }
    private static string Scope(string firmId, string branchId) => $"{firmId}:{branchId}";
}
