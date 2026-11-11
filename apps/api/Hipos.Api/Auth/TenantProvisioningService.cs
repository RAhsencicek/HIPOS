using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Hipos.Api.Cash;
using Hipos.Api.Catalog;
using Hipos.Api.Expenses;
using Hipos.Api.Features;
using Hipos.Api.Inventory;
using Hipos.Api.Kitchen;
using Hipos.Api.Printing;
using Hipos.Api.Service;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Hipos.Api.Auth;

public sealed record ProvisionedTenantResult(
    AuthFirmDto Firm,
    AuthBranchDto Branch,
    AuthUserDto Owner,
    string Token,
    DateTimeOffset ExpiresAt
);

public sealed record ProvisionedBranchResult(
    AuthBranchDto Branch,
    string? ErrorCode = null,
    int ErrorStatus = 200,
    string? ErrorMessage = null
);

public sealed partial class TenantProvisioningService(
    AuthDbContext authDb,
    FeatureDbContext featureDb,
    ServiceDbContext serviceDb,
    CashDbContext cashDb,
    KitchenDbContext kitchenDb,
    InventoryDbContext inventoryDb,
    ExpenseDbContext expenseDb,
    CatalogDbContext catalogDb,
    PrintingDbContext printingDb,
    FeatureRuntimeCapabilities runtime,
    AuthTokenService tokenService)
{
    private static readonly HashSet<string> StarterEnabledFeatures =
    [
        "catalog.products", "catalog.pricing", "catalog.drafts", "catalog.price_drafts",
        "catalog.publishing", "catalog.menus",
        "sales.monitoring", "sales.checks", "sales.pos_orders", "sales.cashier",
        "payments.simulator",
        "branches.tables", "staff.records", "service.waiters",
        "kitchen.monitoring", "reports.sales", "cari.management",
        "cash.management", "finance.expenses",
        "inventory.items", "inventory.recipes", "inventory.counts",
    ];

    public async Task<(ProvisionedTenantResult? Result, string? Code, int Status, string? Message)> CreateTenantAsync(
        OnboardTenantRequest request,
        CancellationToken ct)
    {
        var firmName = request.FirmName?.Trim() ?? "";
        var branchName = request.BranchName?.Trim() ?? "";
        var ownerName = request.OwnerName?.Trim() ?? "";
        var email = request.OwnerEmail?.Trim().ToLowerInvariant() ?? "";
        var password = request.OwnerPassword ?? "";
        var pin = request.OwnerPin?.Trim() ?? "";
        var district = string.IsNullOrWhiteSpace(request.District) ? "Merkez" : request.District.Trim();
        var tableCount = Math.Clamp(request.InitialTableCount, 1, 100);

        if (firmName.Length is < 2 or > 160 || branchName.Length is < 2 or > 160 || ownerName.Length is < 2 or > 120)
            return (null, "INVALID_TENANT_INPUT", 400, "İşletme adı, şube adı ve sahip adı en az 2 karakter olmalıdır.");
        if (string.IsNullOrWhiteSpace(email) || !email.Contains('@') || password.Length < 6)
            return (null, "INVALID_CREDENTIALS", 400, "Geçerli bir sahip e-postası ve en az 6 karakterli şifre zorunludur.");
        if (!PinDigitsRegex().IsMatch(pin))
            return (null, "INVALID_PIN", 400, "Sahip PIN kodu 4 ile 6 haneli rakamlardan oluşmalıdır.");

        if (await authDb.Users.AsNoTracking().AnyAsync(u => u.Email == email, ct))
            return (null, "EMAIL_ALREADY_EXISTS", 409, "Bu e-posta adresiyle kayıtlı bir kullanıcı zaten mevcut.");

        var now = DateTimeOffset.UtcNow;
        var firmId = Guid.NewGuid().ToString();
        var branchId = Guid.NewGuid().ToString();
        var firmCode = await GenerateUniqueFirmCodeAsync(firmName, ct);
        var branchCode = await GenerateUniqueBranchCodeAsync(firmCode, ct);

        await using var transaction = await authDb.Database.BeginTransactionAsync(ct);
        var conn = authDb.Database.GetDbConnection();
        var dbTx = transaction.GetDbTransaction();

        await EnlistAsync(conn, dbTx, ct, featureDb, serviceDb, cashDb, kitchenDb, inventoryDb, expenseDb, catalogDb, printingDb);

        var firm = new FirmRow
        {
            Id = firmId,
            Code = firmCode,
            Name = firmName,
            BrandName = string.IsNullOrWhiteSpace(request.BrandName) ? null : request.BrandName.Trim(),
            IsActive = true,
            CreatedAt = now
        };
        authDb.Firms.Add(firm);

        var branch = new BranchRow
        {
            Id = branchId,
            FirmId = firmId,
            Code = branchCode,
            Name = branchName,
            District = district,
            IsActive = true,
            CreatedAt = now
        };
        authDb.Branches.Add(branch);

        var ownerUser = new UserRow
        {
            Id = Guid.NewGuid(),
            Email = email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(password),
            FullName = ownerName,
            Phone = string.IsNullOrWhiteSpace(request.OwnerPhone) ? null : request.OwnerPhone.Trim(),
            IsActive = true,
            IsPlatformAdmin = false,
            CreatedAt = now,
            UpdatedAt = now
        };
        authDb.Users.Add(ownerUser);

        var membership = new MembershipRow
        {
            Id = Guid.NewGuid(),
            UserId = ownerUser.Id,
            FirmId = firmId,
            BranchId = branchId,
            Role = "owner",
            IsActive = true,
            CreatedAt = now
        };
        authDb.Memberships.Add(membership);

        authDb.PinCodes.Add(new PinCodeRow
        {
            Id = Guid.NewGuid(),
            MembershipId = membership.Id,
            PinHash = BCrypt.Net.BCrypt.HashPassword(pin),
            PinPlain = pin,
            IsActive = true,
            CreatedAt = now,
            UpdatedAt = now
        });

        await authDb.SaveChangesAsync(ct);

        await ProvisionFirmExpenseCategoriesAsync(firmId, now, ct);
        await ProvisionBranchResourcesAsync(firmId, branchId, ownerName, ownerUser.Phone, tableCount, now, ct);

        await transaction.CommitAsync(ct);

        var (token, expiresAt) = tokenService.GenerateToken(
            ownerUser.Id, ownerUser.Email, ownerUser.FullName, "owner", firmId, branchId,
            TimeSpan.FromHours(12), [$"{firmId}:{branchId}"], false);

        return (new ProvisionedTenantResult(
            new AuthFirmDto(firm.Id, firm.Code, firm.Name, firm.BrandName),
            new AuthBranchDto(branch.Id, branch.FirmId, branch.Code, branch.Name, branch.District),
            new AuthUserDto(ownerUser.Id, ownerUser.Email, ownerUser.FullName, "owner", firmId, branchId, ownerUser.Phone, false),
            token,
            expiresAt
        ), null, 201, null);
    }

    public async Task<ProvisionedBranchResult> CreateBranchAsync(
        string firmId,
        CreateBranchRequest request,
        string actorName,
        CancellationToken ct)
    {
        var branchName = request.BranchName?.Trim() ?? "";
        var district = string.IsNullOrWhiteSpace(request.District) ? "Merkez" : request.District.Trim();
        var tableCount = Math.Clamp(request.InitialTableCount, 1, 100);

        if (branchName.Length is < 2 or > 160)
            return new ProvisionedBranchResult(null!, "INVALID_BRANCH", 400, "Şube adı en az 2 karakter olmalıdır.");

        var firm = await authDb.Firms.FirstOrDefaultAsync(f => f.Id == firmId && f.IsActive, ct);
        if (firm is null)
            return new ProvisionedBranchResult(null!, "FIRM_NOT_FOUND", 404, "Etkin işletme bulunamadı.");

        var now = DateTimeOffset.UtcNow;
        var branchId = Guid.NewGuid().ToString();
        var branchCode = await GenerateUniqueBranchCodeAsync(firm.Code, ct);

        await using var transaction = await authDb.Database.BeginTransactionAsync(ct);
        var conn = authDb.Database.GetDbConnection();
        var dbTx = transaction.GetDbTransaction();
        await EnlistAsync(conn, dbTx, ct, featureDb, serviceDb, cashDb, kitchenDb, inventoryDb, expenseDb, catalogDb, printingDb);

        var branch = new BranchRow
        {
            Id = branchId,
            FirmId = firmId,
            Code = branchCode,
            Name = branchName,
            District = district,
            IsActive = true,
            CreatedAt = now
        };
        authDb.Branches.Add(branch);

        // İşletmedeki tüm mevcut aktif sahiplere (owner) yeni şube erişim üyeliği ve aynı PIN'i ekle
        var ownerMemberships = await authDb.Memberships
            .Include(m => m.PinCode)
            .Where(m => m.FirmId == firmId && m.Role == "owner" && m.IsActive)
            .ToListAsync(ct);

        var seenOwners = new HashSet<Guid>();
        foreach (var existing in ownerMemberships)
        {
            if (!seenOwners.Add(existing.UserId)) continue;
            var newMembership = new MembershipRow
            {
                Id = Guid.NewGuid(),
                UserId = existing.UserId,
                FirmId = firmId,
                BranchId = branchId,
                Role = "owner",
                IsActive = true,
                CreatedAt = now
            };
            authDb.Memberships.Add(newMembership);
            if (existing.PinCode is not null)
            {
                authDb.PinCodes.Add(new PinCodeRow
                {
                    Id = Guid.NewGuid(),
                    MembershipId = newMembership.Id,
                    PinHash = existing.PinCode.PinHash,
                    PinPlain = existing.PinCode.PinPlain,
                    IsActive = true,
                    CreatedAt = now,
                    UpdatedAt = now
                });
            }
        }

        await authDb.SaveChangesAsync(ct);

        await ProvisionFirmExpenseCategoriesAsync(firmId, now, ct);
        await ProvisionBranchResourcesAsync(firmId, branchId, actorName, null, tableCount, now, ct);

        await transaction.CommitAsync(ct);

        return new ProvisionedBranchResult(
            new AuthBranchDto(branch.Id, branch.FirmId, branch.Code, branch.Name, branch.District));
    }

    private async Task ProvisionBranchResourcesAsync(
        string firmId,
        string branchId,
        string managerName,
        string? managerPhone,
        int tableCount,
        DateTimeOffset now,
        CancellationToken ct)
    {
        // 1. Modül yeteneklerini şube bazlı başlat
        foreach (var def in FeatureCatalog.All)
        {
            var isReady = IsFeatureRuntimeReady(def.Key);
            var enabled = StarterEnabledFeatures.Contains(def.Key) && isReady;
            featureDb.BranchFeatureStates.Add(new BranchFeatureRow
            {
                FirmId = firmId,
                BranchId = branchId,
                Key = def.Key,
                DesiredEnabled = enabled,
                EffectiveForNewWork = enabled,
                Lifecycle = enabled ? "ready" : "disabled",
                InFlightWorkCount = 0,
                Version = 1,
                UpdatedAt = now
            });
            featureDb.FeatureAudit.Add(new FeatureAuditRow
            {
                FirmId = firmId,
                BranchId = branchId,
                FeatureKey = def.Key,
                Actor = "system:tenant-onboarding",
                DesiredEnabled = enabled,
                Version = 1,
                OccurredAt = now
            });
        }
        await featureDb.SaveChangesAsync(ct);

        // 2. Masa & Salon katı & Yönetici personel kaydı
        if (runtime.ServiceTablesReady)
        {
            serviceDb.Floors.Add(new ServiceFloorRow
            {
                Id = Guid.NewGuid().ToString(),
                FirmId = firmId,
                BranchId = branchId,
                Name = "Salon",
                SortOrder = 0,
                CreatedAt = now
            });

            for (int number = 1; number <= tableCount; number++)
            {
                serviceDb.Tables.Add(new ServiceTableRow
                {
                    Id = Guid.NewGuid().ToString(),
                    FirmId = firmId,
                    BranchId = branchId,
                    Number = number,
                    Name = $"Masa {number:00}",
                    Floor = "Salon",
                    IsActive = true,
                    Status = "idle",
                    Version = 1,
                    UpdatedAt = now
                });
            }

            serviceDb.Employees.Add(new ServiceWaiterRow
            {
                Id = Guid.NewGuid().ToString(),
                FirmId = firmId,
                BranchId = branchId,
                Name = managerName,
                Department = "management",
                JobTitle = "İşletme Sahibi",
                Phone = managerPhone,
                IsActive = true,
                Version = 1,
                CreatedAt = now,
                UpdatedAt = now
            });
            await serviceDb.SaveChangesAsync(ct);
        }

        // 3. Varsayılan Ana Kasa (MAIN)
        if (runtime.CashReady)
        {
            var regId = Guid.NewGuid();
            cashDb.Registers.Add(new CashRegisterRow
            {
                Id = regId,
                FirmId = firmId,
                BranchId = branchId,
                Code = "MAIN",
                Name = "Ana Kasa",
                ProviderMode = "manual",
                IsActive = true,
                Version = 1
            });
            cashDb.Audit.Add(new CashAuditRow
            {
                FirmId = firmId,
                BranchId = branchId,
                RegisterId = regId,
                ShiftId = null,
                RequestId = regId,
                EntityType = "register",
                EntityId = regId,
                Action = "default_register_provisioned",
                Actor = "system:tenant-onboarding",
                Detail = "code=MAIN;name=Ana Kasa;providerMode=manual",
                OccurredAt = now
            });
            await cashDb.SaveChangesAsync(ct);
        }

        // 4. Başlangıç Kategorileri & Mutfak / İçecek İstasyonları
        if (runtime.CatalogDraftsReady)
        {
            var foodCatId = "cat-food";
            var drinkCatId = "cat-drink";
            catalogDb.Categories.AddRange(
                new CatalogCategoryRow
                {
                    FirmId = firmId, BranchId = branchId, Id = foodCatId,
                    Name = "Yiyecekler", IsActive = true, SortOrder = 0, Version = 1, UpdatedAt = now
                },
                new CatalogCategoryRow
                {
                    FirmId = firmId, BranchId = branchId, Id = drinkCatId,
                    Name = "İçecekler", IsActive = true, SortOrder = 1, Version = 1, UpdatedAt = now
                });
            await catalogDb.SaveChangesAsync(ct);

            if (runtime.KitchenReady)
            {
                var foodStationId = Guid.NewGuid();
                var drinkStationId = Guid.NewGuid();
                kitchenDb.Stations.AddRange(
                    new KitchenStation { Id = foodStationId, FirmId = firmId, BranchId = branchId, Code = "food", Name = "Mutfak", IsActive = true },
                    new KitchenStation { Id = drinkStationId, FirmId = firmId, BranchId = branchId, Code = "drink", Name = "Bar / İçecek", IsActive = true }
                );
                kitchenDb.StationCategories.AddRange(
                    new KitchenStationCategory { FirmId = firmId, BranchId = branchId, CategoryId = foodCatId, StationId = foodStationId },
                    new KitchenStationCategory { FirmId = firmId, BranchId = branchId, CategoryId = drinkCatId, StationId = drinkStationId }
                );
                await kitchenDb.SaveChangesAsync(ct);
            }
        }
        else if (runtime.KitchenReady)
        {
            kitchenDb.Stations.AddRange(
                new KitchenStation { Id = Guid.NewGuid(), FirmId = firmId, BranchId = branchId, Code = "food", Name = "Mutfak", IsActive = true },
                new KitchenStation { Id = Guid.NewGuid(), FirmId = firmId, BranchId = branchId, Code = "drink", Name = "Bar / İçecek", IsActive = true }
            );
            await kitchenDb.SaveChangesAsync(ct);
        }

        // 5. Varsayılan Ana Depo
        if (runtime.InventoryReady)
        {
            var warehouseId = Guid.NewGuid().ToString();
            inventoryDb.Warehouses.Add(new InventoryWarehouseRow
            {
                Id = warehouseId,
                FirmId = firmId,
                BranchId = branchId,
                Name = "Ana Depo",
                IsActive = true,
                Version = 1,
                CreatedAt = now,
                UpdatedAt = now
            });
            await inventoryDb.SaveChangesAsync(ct);
        }

        // 6. Şube Varsayılan Yazıcı Profili
        if (runtime.PrintingReady)
        {
            printingDb.PrinterProfiles.Add(PrinterProfileRow.CreateDefault(
                firmId, branchId, actor: "system:tenant-onboarding"));
            await printingDb.SaveChangesAsync(ct);
        }
    }

    private async Task ProvisionFirmExpenseCategoriesAsync(string firmId, DateTimeOffset now, CancellationToken ct)
    {
        if (!runtime.ExpensesReady) return;
        if (await expenseDb.Categories.AnyAsync(c => c.FirmId == firmId, ct)) return;

        var defaults = new (string Id, string Name)[]
        {
            ("rent", "Kira"),
            ("utilities", "Faturalar"),
            ("supplies", "Sarf malzemeleri"),
            ("maintenance", "Bakım ve onarım"),
            ("marketing", "Pazarlama"),
            ("other", "Diğer")
        };

        foreach (var (id, name) in defaults)
        {
            expenseDb.Categories.Add(new ExpenseCategoryRow
            {
                FirmId = firmId,
                Id = id,
                Name = name,
                IsActive = true,
                CreatedAt = now
            });
        }
        await expenseDb.SaveChangesAsync(ct);
    }

    private bool IsFeatureRuntimeReady(string key) => key switch
    {
        "catalog.products" or "catalog.pricing" or "catalog.drafts" or "catalog.price_drafts" or "catalog.publishing" or "catalog.menus" => runtime.CatalogDraftsReady,
        "sales.pos_orders" or "sales.checks" or "sales.monitoring" or "sales.cashier" or "reports.sales" => runtime.SalesOrdersReady,
        "payments.simulator" => runtime.PaymentSimulatorReady,
        "branches.tables" or "service.waiters" or "staff.records" => runtime.ServiceTablesReady,
        "inventory.items" or "inventory.recipes" or "inventory.counts" or "procurement.requests" => runtime.InventoryReady,
        "cari.management" or "cari.customers" or "cari.suppliers" => runtime.CariReady,
        "cash.management" => runtime.CashReady,
        "finance.expenses" => runtime.ExpensesReady,
        "kitchen.monitoring" => runtime.KitchenReady,
        _ => true,
    };

    private static async Task EnlistAsync(
        System.Data.Common.DbConnection conn,
        System.Data.Common.DbTransaction dbTx,
        CancellationToken ct,
        params DbContext[] contexts)
    {
        foreach (var ctx in contexts)
        {
            ctx.Database.SetDbConnection(conn, contextOwnsConnection: false);
            await ctx.Database.UseTransactionAsync(dbTx, ct);
        }
    }

    private async Task<string> GenerateUniqueFirmCodeAsync(string firmName, CancellationToken ct)
    {
        var baseSlug = NormalizeSlug(firmName, 5);
        for (int i = 0; i < 10; i++)
        {
            var suffix = RandomNumberGenerator.GetInt32(100, 999);
            var candidate = $"{baseSlug}-{suffix}";
            if (!await authDb.Firms.AnyAsync(f => f.Code == candidate, ct))
                return candidate;
        }
        return $"FRM-{Guid.NewGuid().ToString("N")[..6].ToUpperInvariant()}";
    }

    private async Task<string> GenerateUniqueBranchCodeAsync(string firmCode, CancellationToken ct)
    {
        var count = await authDb.Branches.CountAsync(ct) + 1;
        for (int attempt = 0; attempt < 20; attempt++)
        {
            var candidate = $"{firmCode}-{count + attempt:00}";
            if (candidate.Length > 32) candidate = candidate[..32];
            if (!await authDb.Branches.AnyAsync(b => b.Code == candidate, ct))
                return candidate;
        }
        return $"BR-{Guid.NewGuid().ToString("N")[..6].ToUpperInvariant()}";
    }

    private static string NormalizeSlug(string text, int maxLen)
    {
        var upper = text.ToUpperInvariant()
            .Replace('Ç', 'C').Replace('Ğ', 'G').Replace('İ', 'I')
            .Replace('Ö', 'O').Replace('Ş', 'S').Replace('Ü', 'U');
        var letters = SlugRegex().Replace(upper, "");
        if (letters.Length == 0) return "RST";
        return letters.Length > maxLen ? letters[..maxLen] : letters;
    }

    [GeneratedRegex(@"^\d{4,6}$")]
    private static partial Regex PinDigitsRegex();

    [GeneratedRegex(@"[^A-Z0-9]")]
    private static partial Regex SlugRegex();
}
