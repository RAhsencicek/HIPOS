namespace Hipos.Api.Auth;

public sealed record LoginRequest(string Email, string Password);

public sealed record PinVerifyRequest(
    string FirmId,
    string BranchId,
    string Pin,
    Guid? UserId = null,
    string? ClientType = "pos"
);

public sealed record OwnerOverrideRequest(
    string FirmId,
    string BranchId,
    string Pin,
    string? Action = null,
    string? Reason = null
);

public sealed record AuthUserDto(
    Guid Id,
    string Email,
    string FullName,
    string Role,
    string FirmId,
    string BranchId,
    string? Phone = null
);

public sealed record LoginResponse(
    string Token,
    AuthUserDto User,
    DateTimeOffset ExpiresAt
);

public sealed record PinVerifyResponse(
    string Token,
    AuthUserDto User,
    DateTimeOffset ExpiresAt
);

public sealed record OwnerOverrideResponse(
    bool Authorized,
    string OwnerName,
    DateTimeOffset AuthorizedAt
);

public sealed record QuickStaffDto(
    Guid UserId,
    string FullName,
    string Role
);
