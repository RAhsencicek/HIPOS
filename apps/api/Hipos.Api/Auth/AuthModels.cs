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

public sealed record AuthFirmDto(
    string Id,
    string Code,
    string Name,
    string? BrandName
);

public sealed record AuthBranchDto(
    string Id,
    string FirmId,
    string Code,
    string Name,
    string District
);

public sealed record AuthUserDto(
    Guid Id,
    string Email,
    string FullName,
    string Role,
    string FirmId,
    string BranchId,
    string? Phone = null,
    bool IsPlatformAdmin = false
);

public sealed record LoginResponse(
    string Token,
    AuthUserDto User,
    DateTimeOffset ExpiresAt,
    AuthFirmDto? Firm = null,
    IReadOnlyList<AuthBranchDto>? Branches = null
);

public sealed record AuthMeResponse(
    AuthUserDto User,
    AuthFirmDto? Firm,
    IReadOnlyList<AuthBranchDto> Branches
);

public sealed record OnboardTenantRequest(
    string FirmName,
    string BranchName,
    string OwnerName,
    string OwnerEmail,
    string OwnerPassword,
    string OwnerPin,
    string? District = null,
    string? OwnerPhone = null,
    string? BrandName = null,
    int InitialTableCount = 10
);

public sealed record CreateBranchRequest(
    string BranchName,
    string? District = null,
    int InitialTableCount = 10
);

public sealed record ChangePasswordRequest(
    string CurrentPassword,
    string NewPassword
);

public sealed record SwitchScopeRequest(
    string FirmId,
    string BranchId
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
