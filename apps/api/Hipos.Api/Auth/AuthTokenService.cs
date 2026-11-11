using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace Hipos.Api.Auth;

public sealed class AuthTokenService
{
    private const string FallbackDevSecret = "hipos-super-secret-development-jwt-signing-key-minimum-32-chars-long";
    private const string ComposeDevSecret = "hipos-local-development-secret-change-before-production";

    private readonly string _jwtSecret;
    private readonly string _issuer;
    private readonly string _audience;
    private readonly JwtSecurityTokenHandler _handler = new() { MapInboundClaims = false };

    public AuthTokenService(IConfiguration configuration, IHostEnvironment environment)
    {
        var configuredSecret = configuration["HIPOS_JWT_SECRET"];
        if (!environment.IsDevelopment())
        {
            if (string.IsNullOrWhiteSpace(configuredSecret) ||
                configuredSecret.Length < 32 ||
                configuredSecret == FallbackDevSecret ||
                configuredSecret == ComposeDevSecret)
            {
                throw new InvalidOperationException(
                    "Üretim (Production) ortamında HIPOS_JWT_SECRET en az 32 karakterli benzersiz bir gizli anahtar olarak tanımlanmalıdır.");
            }
        }

        _jwtSecret = string.IsNullOrWhiteSpace(configuredSecret) ? FallbackDevSecret : configuredSecret;
        _issuer = configuration["HIPOS_JWT_ISSUER"] ?? "HiposApi";
        _audience = configuration["HIPOS_JWT_AUDIENCE"] ?? "HiposApps";
    }

    public (string Token, DateTimeOffset ExpiresAt) GenerateToken(
        Guid userId,
        string email,
        string fullName,
        string role,
        string firmId,
        string branchId,
        TimeSpan? lifetime = null,
        IReadOnlyCollection<string>? branchScopes = null,
        bool isPlatformAdmin = false)
    {
        var expiresAt = DateTimeOffset.UtcNow.Add(lifetime ?? TimeSpan.FromHours(12));
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwtSecret));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, userId.ToString()),
            new(JwtRegisteredClaimNames.Email, email),
            new(JwtRegisteredClaimNames.Name, fullName),
            new("role", role),
            new("firmId", firmId),
            new("branchId", branchId),
            new("isPlatformAdmin", isPlatformAdmin ? "true" : "false")
        };

        var scopeSet = new HashSet<string>(StringComparer.Ordinal) { $"{firmId}:{branchId}" };
        if (branchScopes is not null)
        {
            foreach (var scope in branchScopes)
            {
                if (!string.IsNullOrWhiteSpace(scope))
                    scopeSet.Add(scope);
            }
        }
        foreach (var scope in scopeSet)
        {
            claims.Add(new Claim("branchScope", scope));
        }

        var tokenDescriptor = new SecurityTokenDescriptor
        {
            Subject = new ClaimsIdentity(claims),
            Expires = expiresAt.UtcDateTime,
            Issuer = _issuer,
            Audience = _audience,
            SigningCredentials = credentials
        };

        var securityToken = _handler.CreateToken(tokenDescriptor);
        return (_handler.WriteToken(securityToken), expiresAt);
    }

    public TokenValidationParameters GetValidationParameters()
    {
        return new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwtSecret)),
            ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
            ValidateIssuer = true,
            ValidIssuer = _issuer,
            ValidateAudience = true,
            ValidAudience = _audience,
            ValidateLifetime = true,
            RequireExpirationTime = true,
            RequireSignedTokens = true,
            ClockSkew = TimeSpan.FromSeconds(30)
        };
    }

    public ClaimsPrincipal? ValidateToken(string token)
    {
        if (string.IsNullOrWhiteSpace(token))
            return null;

        try
        {
            return _handler.ValidateToken(token, GetValidationParameters(), out _);
        }
        catch
        {
            return null;
        }
    }
}
