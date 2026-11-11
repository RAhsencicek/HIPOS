namespace Hipos.Api.Auth;

public sealed class BranchRow
{
    public string Id { get; set; } = "";
    public string FirmId { get; set; } = "";
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public string District { get; set; } = "";
    public string? BridgeTokenHash { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public FirmRow? Firm { get; set; }
}
