using Microsoft.EntityFrameworkCore;
using BCrypt.Net;

namespace Hipos.Api.Auth;

public static class AuthDbInitializer
{
    // Sistemdeki tek þubeli varsayýlan firma ve þube kimlikleri (Projedeki InMemoryFeatureStore ile uyumlu)
    public const string DefaultFirmId = "11111111-1111-4111-8111-111111111111";
    public const string DefaultBranchId = "33333333-3333-4333-8333-333333333333";

    public static async Task SeedDemoUsersAsync(AuthDbContext db, CancellationToken cancellationToken = default)
    {
        // 1. Eðer sistemde zaten kullanýcý varsa tekrar ekleme yapma
        if (await db.Users.AnyAsync(cancellationToken))
            return;

        // -------------------------------------------------------------------------
        // 1. PATRON (Owner)
        // Yönetim paneline E-posta + Þifre ile girer.
        // Kasa/terminalde veya onay iþlemlerinde 10-15 dk hareketsizlikte 9999 PIN tuþlar.
        // -------------------------------------------------------------------------
        var ownerUser = new UserRow
        {
            Id = Guid.NewGuid(),
            Email = "patron@hipos.local",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("Patron123!"),
            FullName = "Ahmet Patron (Owner)",
            Phone = "05550000001",
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        var ownerMembership = new MembershipRow
        {
            Id = Guid.NewGuid(),
            UserId = ownerUser.Id,
            FirmId = DefaultFirmId,
            BranchId = DefaultBranchId,
            Role = "owner",
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow
        };

        var ownerPin = new PinCodeRow
        {
            Id = Guid.NewGuid(),
            MembershipId = ownerMembership.Id,
            PinHash = BCrypt.Net.BCrypt.HashPassword("9999"),
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        // -------------------------------------------------------------------------
        // 2. KASÝYER (Cashier)
        // Kasaya 1111 PIN ile girer. 
        // 10-15 dk iþlem yapýlmadýðýnda kasa kilitlenir, tekrar 1111 PIN ile açýlýr.
        // -------------------------------------------------------------------------
        var cashierUser = new UserRow
        {
            Id = Guid.NewGuid(),
            Email = "kasiyer@hipos.local",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("Kasiyer123!"),
            FullName = "Ayþe Kasiyer",
            Phone = "05550000002",
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        var cashierMembership = new MembershipRow
        {
            Id = Guid.NewGuid(),
            UserId = cashierUser.Id,
            FirmId = DefaultFirmId,
            BranchId = DefaultBranchId,
            Role = "cashier",
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow
        };

        var cashierPin = new PinCodeRow
        {
            Id = Guid.NewGuid(),
            MembershipId = cashierMembership.Id,
            PinHash = BCrypt.Net.BCrypt.HashPassword("1111"),
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        // -------------------------------------------------------------------------
        // 3. GARSON (Waiter)
        // Tablete 2222 PIN ile 1 kez girer. 
        // Hareketsizlik kilidi yoktur; gün boyu kesintisiz masalara sipariþ girer.
        // -------------------------------------------------------------------------
        var waiterUser = new UserRow
        {
            Id = Guid.NewGuid(),
            Email = "garson@hipos.local",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("Garson123!"),
            FullName = "Mehmet Garson",
            Phone = "05550000003",
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        var waiterMembership = new MembershipRow
        {
            Id = Guid.NewGuid(),
            UserId = waiterUser.Id,
            FirmId = DefaultFirmId,
            BranchId = DefaultBranchId,
            Role = "waiter",
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow
        };

        var waiterPin = new PinCodeRow
        {
            Id = Guid.NewGuid(),
            MembershipId = waiterMembership.Id,
            PinHash = BCrypt.Net.BCrypt.HashPassword("2222"),
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        // -------------------------------------------------------------------------
        // 4. AÞÇI (Chef)
        // Mutfak KDS ekranýna 3333 PIN ile 1 kez girer. 
        // Hareketsizlik kilidi yoktur; ekran sürekli açýk kalýr.
        // -------------------------------------------------------------------------
        var chefUser = new UserRow
        {
            Id = Guid.NewGuid(),
            Email = "asci@hipos.local",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("Asci123!"),
            FullName = "Kemal Aþçý",
            Phone = "05550000004",
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        var chefMembership = new MembershipRow
        {
            Id = Guid.NewGuid(),
            UserId = chefUser.Id,
            FirmId = DefaultFirmId,
            BranchId = DefaultBranchId,
            Role = "chef",
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow
        };

        var chefPin = new PinCodeRow
        {
            Id = Guid.NewGuid(),
            MembershipId = chefMembership.Id,
            PinHash = BCrypt.Net.BCrypt.HashPassword("3333"),
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        // Tüm kullanýcýlarý, üyelikleri ve PIN kodlarýný veritabanýna kaydet
        await db.Users.AddRangeAsync([ownerUser, cashierUser, waiterUser, chefUser], cancellationToken);
        await db.Memberships.AddRangeAsync([ownerMembership, cashierMembership, waiterMembership, chefMembership], cancellationToken);
        await db.PinCodes.AddRangeAsync([ownerPin, cashierPin, waiterPin, chefPin], cancellationToken);

        await db.SaveChangesAsync(cancellationToken);
    }
}