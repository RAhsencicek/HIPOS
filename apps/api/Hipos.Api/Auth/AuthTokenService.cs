using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace Hipos.Api.Auth;

public sealed class AuthTokenService(IConfiguration configuration)
{
    private readonly string _jwtSecret = configuration["HIPOS_JWT_SECRET"]
        ?? "hipos-super-secret-development-jwt-signing-key-minimum-32-chars-long";
    private readonly string _issuer = configuration["HIPOS_JWT_ISSUER"] ?? "HiposApi";
    private readonly string _audience = configuration["HIPOS_JWT_AUDIENCE"] ?? "HiposApps";

    public (string Token, DateTimeOffset ExpiresAt) GenerateToken(
        Guid userId,
        string email,
        string fullName,
        string role,
        string firmId,
        string branchId,
        TimeSpan? lifetime = null)
    {
        var expiresAt = DateTimeOffset.UtcNow.Add(lifetime ?? TimeSpan.FromHours(12));
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwtSecret));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, userId.ToString()),
            new(JwtRegisteredClaimNames.Email, email),
            new(JwtRegisteredClaimNames.Name, fullName),
            new(ClaimTypes.Role, role),
            new("role", role),
            new("firmId", firmId),
            new("branchId", branchId)
        };

        var tokenDescriptor = new SecurityTokenDescriptor
        {
            Subject = new ClaimsIdentity(claims),
            Expires = expiresAt.UtcDateTime,
            Issuer = _issuer,
            Audience = _audience,
            SigningCredentials = credentials
        };

        var handler = new JwtSecurityTokenHandler();
        var securityToken = handler.CreateToken(tokenDescriptor);
        return (handler.WriteToken(securityToken), expiresAt);
    }

    public TokenValidationParameters GetValidationParameters()
    {
        return new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwtSecret)),
            ValidateIssuer = true,
            ValidIssuer = _issuer,
            ValidateAudience = true,
            ValidAudience = _audience,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromSeconds(30)
        };
    }
}
