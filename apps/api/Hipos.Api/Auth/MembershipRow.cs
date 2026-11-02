namespace Hipos.Api.Auth;

public sealed class MembershipRow
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string FirmId { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string Role { get; set; } = "waiter"; // "owner", "cashier", "waiter", "chef"
    public bool IsActive { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public UserRow? User { get; set; }
    public PinCodeRow? PinCode { get; set; }
}
