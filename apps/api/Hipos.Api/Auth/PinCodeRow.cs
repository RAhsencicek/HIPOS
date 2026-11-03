namespace Hipos.Api.Auth;

public sealed class PinCodeRow
{
    public Guid Id { get; set; }
    public Guid MembershipId { get; set; }
    public string PinHash { get; set; } = "";
    public bool IsActive { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;

    public MembershipRow? Membership { get; set; }
}
