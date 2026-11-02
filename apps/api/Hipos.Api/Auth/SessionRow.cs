namespace Hipos.Api.Auth;

public sealed class SessionRow
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid? MembershipId { get; set; }
    public string TokenHash { get; set; } = "";
    public string ClientType { get; set; } = "pos"; // "admin", "pos", "waiter", "kitchen"
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public UserRow? User { get; set; }
    public MembershipRow? Membership { get; set; }
}
