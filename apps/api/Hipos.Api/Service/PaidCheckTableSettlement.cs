using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Hipos.Api.Sales;

namespace Hipos.Api.Service;

// Adisyon ödemesi tamamlandığında service şemasının masa/grup yaşam döngüsünü kapatır.
// Sales işlemiyle aynı PostgreSQL transaction'ını kullanır; yarım kapanış oluşmaz.
public sealed class PaidCheckTableSettlement(SalesDbContext sales, ServiceDbContext service)
{
    public async Task ReleaseAfterPaymentAsync(string tableId, string firmId, string branchId,
        string actor, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var transaction = sales.Database.CurrentTransaction?.GetDbTransaction()
            ?? throw new InvalidOperationException("Masa kapanışı ödeme transaction'ı içinde çalışmalıdır.");
        service.Database.SetDbConnection(sales.Database.GetDbConnection(), contextOwnsConnection: false);
        await service.Database.UseTransactionAsync(transaction, cancellationToken);

        var table = await service.Tables.AsNoTracking().SingleOrDefaultAsync(row => row.Id == tableId &&
            row.FirmId == firmId && row.BranchId == branchId, cancellationToken);
        if (table is null) return;

        ServiceTableGroupRow? group = null;
        if (table.TableGroupId is { } groupId)
        {
            group = await service.TableGroups.FromSqlInterpolated($"""
                SELECT * FROM service.table_groups
                WHERE id={groupId} AND firm_id={firmId} AND branch_id={branchId} AND closed_at IS NULL
                FOR UPDATE
                """).SingleOrDefaultAsync(cancellationToken);
        }

        var tableIds = group?.TableIds ?? [tableId];
        var lockedTables = await service.Tables.FromSqlInterpolated($"""
            SELECT * FROM service.tables
            WHERE id = ANY({tableIds}) AND firm_id={firmId} AND branch_id={branchId}
            ORDER BY id FOR UPDATE
            """).ToArrayAsync(cancellationToken);
        if (lockedTables.Length == 0 || lockedTables.Any(row => row.TableGroupId != group?.Id)) return;

        var stillOpen = await sales.Checks.AsNoTracking().AnyAsync(row => row.FirmId == firmId &&
            row.BranchId == branchId && row.Status == "open" && row.TableId != null &&
            tableIds.Contains(row.TableId), cancellationToken);
        if (stillOpen) return;

        var assignments = await service.Assignments.Where(row => row.FirmId == firmId &&
            row.BranchId == branchId && tableIds.Contains(row.TableId) && row.ClosedAt == null)
            .ToArrayAsync(cancellationToken);
        foreach (var assignment in assignments)
        {
            assignment.ClosedAt = now;
            assignment.ClosedBy = actor;
            assignment.Version++;
            service.Audit.Add(new ServiceAuditRow
            {
                FirmId = firmId, BranchId = branchId, EntityId = assignment.Id.ToString(),
                Action = "assignment_closed_after_payment", Actor = actor, OccurredAt = now,
            });
        }

        foreach (var member in lockedTables)
        {
            member.Status = "idle";
            member.ReservedFor = null;
            member.ReservationGuestName = null;
            member.TableGroupId = null;
            member.Version++;
            member.UpdatedAt = now;
            service.Audit.Add(new ServiceAuditRow
            {
                FirmId = firmId, BranchId = branchId, EntityId = member.Id,
                Action = "table_emptied_after_payment", Actor = actor, OccurredAt = now,
            });
        }

        if (group is not null)
        {
            group.ClosedAt = now;
            group.Version++;
            service.Audit.Add(new ServiceAuditRow
            {
                FirmId = firmId, BranchId = branchId, EntityId = group.Id.ToString(),
                Action = "table_group_closed_after_payment", Actor = actor, OccurredAt = now,
            });
        }

        await service.SaveChangesAsync(cancellationToken);
    }
}
