using Microsoft.EntityFrameworkCore;
using BCrypt.Net;
using Hipos.Api.Service;

namespace Hipos.Api.Auth;

public static class AuthDbInitializer
{
    // Sistemdeki tek şubeli varsayılan firma ve şube kimlikleri (Projedeki InMemoryFeatureStore ile uyumlu)
    public const string DefaultFirmId = "11111111-1111-4111-8111-111111111111";
    public const string DefaultBranchId = "33333333-3333-4333-8333-333333333333";

    public static async Task SeedDemoUsersAsync(AuthDbContext db, CancellationToken cancellationToken = default)
    {
        // 1. Eğer sistemde zaten kullanıcı varsa tekrar ekleme yapma
        if (await db.Users.AnyAsync(cancellationToken))
            return;

        // -------------------------------------------------------------------------
        // 1. PATRON (Owner)
        // Yönetim paneline E-posta + Şifre ile girer.
        // Kasa/terminalde veya onay işlemlerinde 10-15 dk hareketsizlikte 9999 PIN tuşlar.
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
        // 2. KASİYER (Cashier)
        // Kasaya 1111 PIN ile girer. 
        // 10-15 dk işlem yapılmadığında kasa kilitlenir, tekrar 1111 PIN ile açılır.
        // -------------------------------------------------------------------------
        var cashierUser = new UserRow
        {
            Id = Guid.NewGuid(),
            Email = "kasiyer@hipos.local",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("Kasiyer123!"),
            FullName = "Ayşe Kasiyer",
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
        // Hareketsizlik kilidi yoktur; gün boyu kesintisiz masalara sipariş girer.
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
        // 4. AŞÇI (Chef)
        // Mutfak KDS ekranına 3333 PIN ile 1 kez girer. 
        // Hareketsizlik kilidi yoktur; ekran sürekli açık kalır.
        // -------------------------------------------------------------------------
        var chefUser = new UserRow
        {
            Id = Guid.NewGuid(),
            Email = "asci@hipos.local",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("Asci123!"),
            FullName = "Kemal Aşçı",
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

        // Tüm kullanıcıları, üyelikleri ve PIN kodlarını veritabanına kaydet
        await db.Users.AddRangeAsync([ownerUser, cashierUser, waiterUser, chefUser], cancellationToken);
        await db.Memberships.AddRangeAsync([ownerMembership, cashierMembership, waiterMembership, chefMembership], cancellationToken);
        await db.PinCodes.AddRangeAsync([ownerPin, cashierPin, waiterPin, chefPin], cancellationToken);

        await db.SaveChangesAsync(cancellationToken);
    }

    public static async Task SynchronizeStaffAndAuthAsync(AuthDbContext authDb, ServiceDbContext serviceDb, CancellationToken cancellationToken = default)
    {
        var firmId = DefaultFirmId;
        var branchId = DefaultBranchId;
        var now = DateTimeOffset.UtcNow;

        // 1. Core Auth demo kullanıcılarının service.employees içinde mevcut olmasını sağla
        var existingEmployees = await serviceDb.Employees.ToListAsync(cancellationToken);

        void EnsureEmployee(string empId, string fullName, string dept, string jobTitle, string phone)
        {
            var exists = existingEmployees.Any(e => e.Id == empId || e.Name.Trim().Equals(fullName.Trim(), StringComparison.OrdinalIgnoreCase));
            if (!exists)
            {
                var row = new ServiceWaiterRow
                {
                    Id = empId,
                    FirmId = firmId,
                    BranchId = branchId,
                    Name = fullName,
                    Department = dept,
                    JobTitle = jobTitle,
                    Phone = phone,
                    IsActive = true,
                    Version = 1,
                    CreatedAt = now,
                    UpdatedAt = now
                };
                serviceDb.Employees.Add(row);
                existingEmployees.Add(row);
            }
        }

        EnsureEmployee("emp-ahmet-patron", "Ahmet Patron (Owner)", "management", "İşletme Sahibi", "05550000001");
        EnsureEmployee("emp-ayse-kasiyer", "Ayşe Kasiyer", "cashier", "Kasiyer", "05550000002");
        EnsureEmployee("waiter-mehmet-garson", "Mehmet Garson", "service", "Garson", "05550000003");
        EnsureEmployee("staff-chef-kemal", "Kemal Aşçı", "kitchen", "Mutfak Şefi", "05550000004");

        await serviceDb.SaveChangesAsync(cancellationToken);

        // 2. Her personelin auth.users, auth.memberships ve auth.pin_codes karşılığının olmasını sağla
        var defaultPins = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["Ahmet Patron (Owner)"] = "9999",
            ["Ayşe Kasiyer"] = "1111",
            ["Mehmet Garson"] = "2222",
            ["Kemal Aşçı"] = "3333",
            ["Ayşe Demir"] = "2221",
            ["Mehmet Kaya"] = "2223",
            ["Zeynep Arslan"] = "2224",
            ["Emre Aydın"] = "9998",
            ["Mert Aksoy"] = "3334",
            ["Derya Kaplan"] = "3335",
            ["Ece Arı"] = "3336",
            ["Burak Şen"] = "3337",
            ["Ceren Uçar"] = "1112",
            ["Ali Koç"] = "2225",
        };

        var allUsers = await authDb.Users.ToListAsync(cancellationToken);
        var allMemberships = await authDb.Memberships.Include(m => m.PinCode).ToListAsync(cancellationToken);

        foreach (var emp in existingEmployees)
        {
            var user = allUsers.FirstOrDefault(u =>
                u.FullName.Trim().Equals(emp.Name.Trim(), StringComparison.OrdinalIgnoreCase) ||
                u.Email.Equals($"staff-{emp.Id}@hipos.local", StringComparison.OrdinalIgnoreCase) ||
                (Guid.TryParse(emp.Id, out var g) && u.Id == g));

            if (user is null)
            {
                var newUserId = Guid.TryParse(emp.Id, out var parsedGuid) ? parsedGuid : Guid.NewGuid();
                user = new UserRow
                {
                    Id = newUserId,
                    Email = $"staff-{emp.Id.ToLowerInvariant().Replace(" ", "-")}@hipos.local",
                    PasswordHash = BCrypt.Net.BCrypt.HashPassword("HiposStaff123!"),
                    FullName = emp.Name.Trim(),
                    Phone = emp.Phone,
                    IsActive = emp.IsActive,
                    CreatedAt = now,
                    UpdatedAt = now
                };
                authDb.Users.Add(user);
                allUsers.Add(user);
            }

            var membership = allMemberships.FirstOrDefault(m => m.UserId == user.Id && m.FirmId == firmId && m.BranchId == branchId);
            var role = emp.Department switch
            {
                "management" => "owner",
                "cashier" => "cashier",
                "kitchen" => "chef",
                "service" => "waiter",
                _ => "waiter"
            };

            if (membership is null)
            {
                membership = new MembershipRow
                {
                    Id = Guid.NewGuid(),
                    UserId = user.Id,
                    FirmId = firmId,
                    BranchId = branchId,
                    Role = role,
                    IsActive = emp.IsActive,
                    CreatedAt = now
                };
                authDb.Memberships.Add(membership);
                allMemberships.Add(membership);
            }

            if (membership.PinCode is null)
            {
                var pin = defaultPins.TryGetValue(emp.Name.Trim(), out var p) ? p : "1234";
                var pinCode = new PinCodeRow
                {
                    Id = Guid.NewGuid(),
                    MembershipId = membership.Id,
                    PinHash = BCrypt.Net.BCrypt.HashPassword(pin),
                    IsActive = true,
                    CreatedAt = now,
                    UpdatedAt = now
                };
                authDb.PinCodes.Add(pinCode);
                membership.PinCode = pinCode;
            }
        }

        await authDb.SaveChangesAsync(cancellationToken);
    }
}
