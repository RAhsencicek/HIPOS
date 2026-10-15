using Microsoft.EntityFrameworkCore;

namespace Hipos.Api.Cash;

public sealed record CashProvisionResult(CashRegisterRow? Register, bool Created, string? ErrorCode = null);

public sealed class CashProvisioningService(CashDbContext db)
{
    public async Task<CashProvisionResult> EnsureDefaultRegisterAsync(string firmId, string branchId,
        Guid requestId, string actor, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var lockKey = $"cash-default-register:{firmId}:{branchId}";
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock(hashtextextended({lockKey}, 0))", cancellationToken);

        var existing = await db.Registers.SingleOrDefaultAsync(row => row.FirmId == firmId &&
            row.BranchId == branchId && row.Code == "MAIN", cancellationToken);
        if (existing is not null)
        {
            var matchesDefault = existing.Name == "Ana Kasa" && existing.ProviderMode == "manual" && existing.IsActive;
            await transaction.CommitAsync(cancellationToken);
            return new CashProvisionResult(matchesDefault ? existing : null, false,
                matchesDefault ? null : "DEFAULT_REGISTER_CONFLICT");
        }

        var hasOtherActiveRegister = await db.Registers.AnyAsync(row => row.FirmId == firmId &&
            row.BranchId == branchId && row.IsActive, cancellationToken);
        if (hasOtherActiveRegister)
        {
            await transaction.CommitAsync(cancellationToken);
            return new CashProvisionResult(null, false, "EXISTING_REGISTER");
        }

        var now = DateTimeOffset.UtcNow;
        var register = new CashRegisterRow
        {
            Id = Guid.NewGuid(), FirmId = firmId, BranchId = branchId,
            Code = "MAIN", Name = "Ana Kasa", ProviderMode = "manual", IsActive = true, Version = 1,
        };
        db.Registers.Add(register);
        db.Audit.Add(new CashAuditRow
        {
            FirmId = firmId, BranchId = branchId, RegisterId = register.Id,
            ShiftId = null, RequestId = requestId, EntityType = "register", EntityId = register.Id,
            Action = "default_register_provisioned", Actor = actor,
            Detail = "code=MAIN;name=Ana Kasa;providerMode=manual", OccurredAt = now,
        });
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new CashProvisionResult(register, true);
    }
}
