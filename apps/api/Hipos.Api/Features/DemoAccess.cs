using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
namespace Hipos.Api.Features;

public sealed record DemoActor(string Name, bool CanManage, bool CanOperate, IReadOnlySet<string> AllowedBranches)
{
    public bool CanRead(string firmId, string branchId) =>
        AllowedBranches.Contains($"{firmId}:{branchId}");
}

public static class DemoAccess
{
    // Yalnız geliştirme prototipi. Gerçek firma/şube üyeliği veritabanından doğrulanacaktır.
    public static bool CanReadCatalog(DemoActor actor, string firmId, string? branchId)
    {
        if (branchId is not null) return actor.CanRead(firmId, branchId);
        string[] allBranches = firmId switch
        {
            InMemoryFeatureStore.SingleFirm => [InMemoryFeatureStore.SingleBranch],
            InMemoryFeatureStore.MultiFirm =>
            [InMemoryFeatureStore.ModaBranch, InMemoryFeatureStore.BesiktasBranch, InMemoryFeatureStore.AtasehirBranch],
            _ => [],
        };
        return allBranches.Length > 0 && allBranches.All(branch => actor.CanRead(firmId, branch));
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
        // 1. Önce gelen istekte gerçek JWT Bearer Token var mı kontrol et (Header veya Query String)
        var authHeader = context.Request.Headers.Authorization.ToString();
        string? tokenString = null;
        if (!string.IsNullOrWhiteSpace(authHeader) && authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            tokenString = authHeader["Bearer ".Length..].Trim();
        }
        else if (context.Request.Query.TryGetValue("token", out var queryToken) && !string.IsNullOrWhiteSpace(queryToken))
        {
            tokenString = queryToken.ToString().Trim();
        }

        if (!string.IsNullOrWhiteSpace(tokenString))
        {
            try
            {
                var handler = new JwtSecurityTokenHandler();
                if (handler.CanReadToken(tokenString))
                {
                    var jwt = handler.ReadJwtToken(tokenString);
                    var role = jwt.Claims.FirstOrDefault(c => c.Type == "role" || c.Type == ClaimTypes.Role)?.Value ?? "waiter";
                    var firmId = jwt.Claims.FirstOrDefault(c => c.Type == "firmId")?.Value ?? InMemoryFeatureStore.SingleFirm;
                    var branchId = jwt.Claims.FirstOrDefault(c => c.Type == "branchId")?.Value ?? InMemoryFeatureStore.SingleBranch;
                    var name = jwt.Claims.FirstOrDefault(c => c.Type == JwtRegisteredClaimNames.Name || c.Type == ClaimTypes.Name)?.Value ?? role;

                    bool canManage = role == "owner";
                    bool canOperate = true;
                    var allowedBranches = new HashSet<string> { Scope(firmId, branchId) };

                    return new DemoActor(name, canManage, canOperate, allowedBranches);
                }
            }
            catch
            {
                // Token geçersizse null döner
                return null;
            }
        }

        // 2. Geriye dönük uyumluluk: Eğer token yoksa sahte X-Demo-Actor başlığına veya query param'a bak
        var actorKey = context.Request.Headers["X-Demo-Actor"].ToString();
        if (string.IsNullOrWhiteSpace(actorKey))
        {
            actorKey = context.Request.Query["actor"].ToString();
        }
        return Actors.TryGetValue(actorKey, out var actor) ? actor : null;
    }
    private static string Scope(string firmId, string branchId) => $"{firmId}:{branchId}";
}
