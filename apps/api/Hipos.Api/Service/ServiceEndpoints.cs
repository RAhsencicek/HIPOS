using Hipos.Api.Features;
using Hipos.Api.Sales;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace Hipos.Api.Service;

public sealed record CreateServiceTable(int? Number, string? Name);
public sealed record CreateServiceWaiter(string Name);
public sealed record CreateServiceEmployee(Guid RequestId, string Name, string Department, string JobTitle, string? Phone);
public sealed record UpdateServiceEmployee(int ExpectedVersion, string Name, string Department, string JobTitle, string? Phone, bool IsActive);
public sealed record AssignServiceOrder(Guid RequestId, string TableId, Guid OrderId, string? WaiterId);
public sealed record CloseServiceAssignment(int ExpectedVersion);
public sealed record TransferServiceTable(Guid RequestId, string TargetTableId, int ExpectedVersion);
public sealed record MergeServiceTables(Guid RequestId, IReadOnlyList<string> SourceTableIds,
    IReadOnlyDictionary<string, int> ExpectedVersions);
public sealed record ServiceLineView(string ProductId, string ProductName, int Quantity, long UnitPriceMinor, long LineTotalMinor);
public sealed record ServiceAssignmentView(string Id, string OrderId, string? WaiterId, string? WaiterName,
    DateTimeOffset OpenedAt, DateTimeOffset OrderCreatedAt, string OrderStatus, string PaymentStatus,
    long TotalMinor, int Version, ServiceLineView[] Items);
public sealed record ServiceTableView(string Id, int Number, string Name, bool IsActive, ServiceAssignmentView? Assignment);
public sealed record ServiceWaiterView(string Id, string Name, bool IsActive);
public sealed record ServiceEmployeeView(string Id, string Name, string Department, string JobTitle, string? Phone,
    bool IsActive, int Version, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);

public static class ServiceEndpoints
{
    public static void MapServiceEndpoints(this WebApplication app, bool ready)
    {
        var group = app.MapGroup("/api/v1/firms/{firmId}/branches/{branchId}/service");

        group.MapGet("/tables", async (string firmId, string branchId, HttpContext context,
            ServiceDbContext db, SalesDbContext sales, FeatureDbContext features) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false);
            if (denied is not null) return denied;
            var states = await features.BranchFeatureStates.AsNoTracking()
                .Where(row => row.FirmId == firmId && row.BranchId == branchId &&
                    (row.Key == "branches.tables" || row.Key == "service.waiters"))
                .ToListAsync(context.RequestAborted);
            var tablesEnabled = states.Any(row => row.Key == "branches.tables" && row.DesiredEnabled && row.EffectiveForNewWork && row.Lifecycle == "ready");
            var waitersEnabled = states.Any(row => row.Key == "service.waiters" && row.DesiredEnabled && row.EffectiveForNewWork && row.Lifecycle == "ready");
            var tables = await db.Tables.AsNoTracking().Where(row => row.FirmId == firmId && row.BranchId == branchId)
                .OrderBy(row => row.Number).ToListAsync(context.RequestAborted);
            var assignments = await db.Assignments.AsNoTracking().Where(row => row.FirmId == firmId && row.BranchId == branchId && row.ClosedAt == null)
                .ToListAsync(context.RequestAborted);
            var waiterIds = assignments.Where(row => row.WaiterId is not null).Select(row => row.WaiterId!).Distinct().ToArray();
            var waiters = await db.Waiters.AsNoTracking().Where(row => row.FirmId == firmId && row.BranchId == branchId && waiterIds.Contains(row.Id))
                .ToDictionaryAsync(row => row.Id, context.RequestAborted);
            var checkIds = assignments.Select(row => row.CheckId).Distinct().ToArray();
            var orders = await sales.Orders.AsNoTracking().Include(row => row.Lines)
                .Where(row => row.FirmId == firmId && row.BranchId == branchId && checkIds.Contains(row.CheckId))
                .ToListAsync(context.RequestAborted);
            var ordersByCheck = orders.GroupBy(row => row.CheckId)
                .ToDictionary(group => group.Key, group => group.ToArray());
            var byTable = assignments.ToDictionary(row => row.TableId);
            var items = tables.Select(table => new ServiceTableView(table.Id, table.Number, table.Name, table.IsActive,
                byTable.TryGetValue(table.Id, out var assignment) && ordersByCheck.TryGetValue(assignment.CheckId, out var checkOrders)
                    ? ToView(assignment, checkOrders, assignment.WaiterId is not null && waiters.TryGetValue(assignment.WaiterId, out var waiter) ? waiter.Name : null)
                    : null)).ToArray();
            return Results.Ok(new { source = "postgres", tablesEnabled, waitersEnabled, items });
        });

        group.MapPost("/tables/{sourceTableId}/transfer", async (string firmId, string branchId,
            string sourceTableId, TransferServiceTable command, HttpContext context,
            ServiceDbContext db, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true, allowOperator: true);
            if (denied is not null) return denied;
            if (command.RequestId == Guid.Empty || command.ExpectedVersion < 1 ||
                string.IsNullOrWhiteSpace(sourceTableId) || sourceTableId.Length > 80 ||
                string.IsNullOrWhiteSpace(command.TargetTableId) || command.TargetTableId.Length > 80 ||
                sourceTableId == command.TargetTableId)
                return Fail(context, "INVALID_TABLE_TRANSFER", 400, "İstek kimliği, masalar veya sürüm geçersiz.");

            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction(),
                firmId, branchId, "branches.tables", context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction(),
                firmId, branchId, "sales.checks", context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);

            var prior = await db.TableTransfers.AsNoTracking().Where(row => row.FirmId == firmId &&
                row.BranchId == branchId && row.RequestId == command.RequestId).ToListAsync(context.RequestAborted);
            if (prior.Count != 0)
            {
                if (prior.Count != 1 || prior[0].TransferType != "move" ||
                    prior[0].FromTableId != sourceTableId || prior[0].ToTableId != command.TargetTableId)
                    return Fail(context, "TABLE_TRANSFER_REQUEST_CONFLICT", 409, "İstek kimliği farklı masa işlemi için kullanılmış.");
                await transaction.CommitAsync(context.RequestAborted);
                return Results.Ok(new { requestId = command.RequestId, checkId = prior[0].CheckId,
                    sourceTableId, targetTableId = command.TargetTableId, repeated = true });
            }

            var lockedTables = await LockTablesAsync(db, firmId, branchId,
                [sourceTableId, command.TargetTableId], context.RequestAborted);
            if (lockedTables is null || !lockedTables[sourceTableId].IsActive || !lockedTables[command.TargetTableId].IsActive)
                return Fail(context, "TABLE_NOT_FOUND", 404, "Kaynak veya hedef masa bu şubede aktif değil.");
            if (await db.Assignments.AnyAsync(row => row.FirmId == firmId && row.BranchId == branchId &&
                row.TableId == command.TargetTableId && row.ClosedAt == null, context.RequestAborted))
                return Fail(context, "TABLE_ALREADY_OCCUPIED", 409, "Hedef masada açık adisyon var.");

            var assignment = await db.Assignments.FromSqlInterpolated($"""
                SELECT * FROM service.assignments WHERE firm_id = {firmId} AND branch_id = {branchId}
                    AND table_id = {sourceTableId} AND closed_at IS NULL FOR UPDATE
                """).SingleOrDefaultAsync(context.RequestAborted);
            if (assignment is null)
                return Fail(context, "OPEN_ASSIGNMENT_NOT_FOUND", 409, "Kaynak masada taşınabilecek açık adisyon yok.");
            if (assignment.Version != command.ExpectedVersion)
                return Fail(context, "VERSION_CONFLICT", 409, "Masa-adisyon bağı güncel değil; masaları yenileyin.");

            var now = DateTimeOffset.UtcNow;
            var actor = DemoAccess.Resolve(context)!.Name;
            var changed = await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE sales.checks SET table_id = {command.TargetTableId}, version = version + 1
                WHERE id = {assignment.CheckId} AND firm_id = {firmId} AND branch_id = {branchId}
                    AND status = 'open' AND table_id = {sourceTableId}
                """, context.RequestAborted);
            if (changed != 1)
                return Fail(context, "CHECK_NOT_OPEN", 409, "Adisyon açık değil veya kaynak masaya bağlı değil.");

            assignment.TableId = command.TargetTableId;
            assignment.Version++;
            db.TableTransfers.Add(new ServiceTableTransferRow
            {
                Id = Guid.NewGuid(), RequestId = command.RequestId, FirmId = firmId, BranchId = branchId,
                FromTableId = sourceTableId, ToTableId = command.TargetTableId, CheckId = assignment.CheckId,
                TransferType = "move", Actor = actor, CreatedAt = now,
            });
            AddAudit(db, firmId, branchId, assignment.Id.ToString(), "table_transferred", actor, now);
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO sales.check_audit (check_id,firm_id,branch_id,actor,action,version,occurred_at)
                SELECT id,firm_id,branch_id,{actor},'table_transferred',version,{now}
                FROM sales.checks WHERE id = {assignment.CheckId} AND firm_id = {firmId} AND branch_id = {branchId}
                """, context.RequestAborted);
            try
            {
                await db.SaveChangesAsync(context.RequestAborted);
                await transaction.CommitAsync(context.RequestAborted);
            }
            catch (DbUpdateException error) when (Unique(error))
            {
                return Fail(context, "TABLE_TRANSFER_CONFLICT", 409, "Masa taşıma başka bir işlemle çakıştı; masaları yenileyin.");
            }
            return Results.Ok(new { requestId = command.RequestId, checkId = assignment.CheckId,
                sourceTableId, targetTableId = command.TargetTableId, version = assignment.Version });
        });

        group.MapPost("/tables/{targetTableId}/merge", async (string firmId, string branchId,
            string targetTableId, MergeServiceTables command, HttpContext context,
            ServiceDbContext db, SalesDbContext salesDb, SalesOrders sales, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true, allowOperator: true);
            if (denied is not null) return denied;
            var sourceIds = command.SourceTableIds?.ToArray() ?? [];
            if (command.RequestId == Guid.Empty || string.IsNullOrWhiteSpace(targetTableId) || targetTableId.Length > 80 ||
                sourceIds.Length is < 1 or > 20 || sourceIds.Any(id => string.IsNullOrWhiteSpace(id) || id.Length > 80) ||
                sourceIds.Contains(targetTableId, StringComparer.Ordinal) || sourceIds.Distinct(StringComparer.Ordinal).Count() != sourceIds.Length ||
                command.ExpectedVersions is null)
                return Fail(context, "INVALID_TABLE_MERGE", 400, "İstek kimliği, hedef masa, kaynak masalar veya sürümler geçersiz.");
            var expectedIds = sourceIds.Append(targetTableId).ToHashSet(StringComparer.Ordinal);
            if (command.ExpectedVersions.Count != expectedIds.Count || command.ExpectedVersions.Any(pair =>
                !expectedIds.Contains(pair.Key) || pair.Value < 1))
                return Fail(context, "INVALID_TABLE_MERGE", 400, "Her kaynak ve hedef masa için güncel atama sürümü gereklidir.");

            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction(),
                firmId, branchId, "branches.tables", context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction(),
                firmId, branchId, "sales.checks", context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);

            var prior = await db.TableTransfers.AsNoTracking().Where(row => row.FirmId == firmId &&
                row.BranchId == branchId && row.RequestId == command.RequestId).ToListAsync(context.RequestAborted);
            if (prior.Count != 0)
            {
                var sameSources = prior.Count == sourceIds.Length && prior.All(row => row.TransferType == "merge" &&
                    row.ToTableId == targetTableId) && prior.Select(row => row.FromTableId).ToHashSet(StringComparer.Ordinal)
                    .SetEquals(sourceIds);
                if (!sameSources)
                    return Fail(context, "TABLE_MERGE_REQUEST_CONFLICT", 409, "İstek kimliği farklı masa birleştirmesi için kullanılmış.");
                var targetCheckId = await salesDb.Checks.AsNoTracking()
                    .Where(row => row.FirmId == firmId && row.BranchId == branchId &&
                        row.Id == prior[0].CheckId && row.Status == "merged")
                    .Select(row => row.MergedIntoCheckId)
                    .SingleOrDefaultAsync(context.RequestAborted);
                if (targetCheckId is null)
                    return Fail(context, "TABLE_MERGE_HISTORY_INCOMPLETE", 409, "Birleştirme geçmişinde hedef adisyon bulunamadı.");
                await transaction.CommitAsync(context.RequestAborted);
                return Results.Ok(new { requestId = command.RequestId, targetTableId,
                    checkId = targetCheckId, mergedTableIds = sourceIds, repeated = true });
            }

            var lockedTables = await LockTablesAsync(db, firmId, branchId,
                sourceIds.Append(targetTableId).ToArray(), context.RequestAborted);
            if (lockedTables is null || lockedTables.Values.Any(table => !table.IsActive))
                return Fail(context, "TABLE_NOT_FOUND", 404, "Birleştirilecek masalardan biri bu şubede aktif değil.");

            var assignments = new Dictionary<string, ServiceAssignmentRow>(StringComparer.Ordinal);
            foreach (var tableId in expectedIds.OrderBy(id => id, StringComparer.Ordinal))
            {
                var assignment = await db.Assignments.FromSqlInterpolated($"""
                    SELECT * FROM service.assignments WHERE firm_id = {firmId} AND branch_id = {branchId}
                        AND table_id = {tableId} AND closed_at IS NULL FOR UPDATE
                    """).SingleOrDefaultAsync(context.RequestAborted);
                if (assignment is null)
                    return Fail(context, "OPEN_ASSIGNMENT_NOT_FOUND", 409, "Hedef ve kaynak masaların her birinde açık adisyon olmalı.");
                if (assignment.Version != command.ExpectedVersions[tableId])
                    return Fail(context, "VERSION_CONFLICT", 409, "Masa-adisyon bağlarından biri güncel değil; masaları yenileyin.");
                assignments.Add(tableId, assignment);
            }

            var targetAssignment = assignments[targetTableId];
            var sourceCheckIds = sourceIds.Select(id => assignments[id].CheckId).ToArray();
            if (sourceCheckIds.Contains(targetAssignment.CheckId) || sourceCheckIds.Distinct().Count() != sourceCheckIds.Length)
                return Fail(context, "CHECK_ASSIGNMENT_CONFLICT", 409, "Masaların açık adisyon bağları birleştirmeye uygun değil.");
            var now = DateTimeOffset.UtcNow;
            var actor = DemoAccess.Resolve(context)!.Name;
            var mergeFailure = await sales.MergeChecksAsync(db.Database.GetDbConnection(),
                transaction.GetDbTransaction(), firmId, branchId, targetAssignment.CheckId, targetTableId,
                sourceIds.Select(id => (assignments[id].CheckId, id)).ToArray(), actor, now, context.RequestAborted);
            if (mergeFailure is not null)
                return Fail(context, mergeFailure.Code, mergeFailure.Status, mergeFailure.Message);

            foreach (var sourceId in sourceIds)
            {
                var assignment = assignments[sourceId];
                assignment.ClosedAt = now;
                assignment.ClosedBy = actor;
                assignment.Version++;
                db.TableTransfers.Add(new ServiceTableTransferRow
                {
                    Id = Guid.NewGuid(), RequestId = command.RequestId, FirmId = firmId, BranchId = branchId,
                    FromTableId = sourceId, ToTableId = targetTableId, CheckId = assignment.CheckId,
                    TransferType = "merge", Actor = actor, CreatedAt = now,
                });
                AddAudit(db, firmId, branchId, assignment.Id.ToString(), "assignment_merged", actor, now);
            }
            try
            {
                await db.SaveChangesAsync(context.RequestAborted);
                await transaction.CommitAsync(context.RequestAborted);
            }
            catch (DbUpdateException error) when (Unique(error))
            {
                return Fail(context, "TABLE_MERGE_CONFLICT", 409, "Masa birleştirme başka bir işlemle çakıştı; masaları yenileyin.");
            }
            return Results.Ok(new { requestId = command.RequestId, targetTableId,
                checkId = targetAssignment.CheckId, mergedTableIds = sourceIds });
        });

        group.MapGet("/waiters", async (string firmId, string branchId, HttpContext context, ServiceDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false);
            if (denied is not null) return denied;
            var rows = await db.Employees.AsNoTracking().Where(row => row.FirmId == firmId && row.BranchId == branchId && row.Department == "service")
                .OrderBy(row => row.Name).ToListAsync(context.RequestAborted);
            return Results.Ok(new { items = rows.Select(row => new ServiceWaiterView(row.Id, row.Name, row.IsActive)).ToArray() });
        });

        group.MapPost("/tables/{tableId}/orders", async (string firmId, string branchId, string tableId,
            CreateWaiterOrder command, HttpContext context, ServiceDbContext db, SalesDbContext salesDb,
            SalesOrders salesOrders) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true, allowOperator: true);
            if (denied is not null) return denied;
            if (command.OrderId == Guid.Empty || string.IsNullOrWhiteSpace(command.WaiterId) ||
                command.WaiterId.Length > 80 || string.IsNullOrWhiteSpace(tableId))
                return Fail(context, "INVALID_WAITER_ORDER", 400, "Sipariş, masa veya garson bilgisi geçersiz.");

            var table = await db.Tables.AsNoTracking().SingleOrDefaultAsync(row => row.Id == tableId &&
                row.FirmId == firmId && row.BranchId == branchId && row.IsActive, context.RequestAborted);
            if (table is null) return Fail(context, "TABLE_NOT_FOUND", 404, "Bu şubede aktif masa bulunamadı.");
            var waiter = await db.Employees.AsNoTracking().SingleOrDefaultAsync(row => row.Id == command.WaiterId &&
                row.FirmId == firmId && row.BranchId == branchId && row.Department == "service" && row.IsActive,
                context.RequestAborted);
            if (waiter is null) return Fail(context, "WAITER_NOT_FOUND", 404, "Bu şubede aktif garson bulunamadı.");

            var assignment = await db.Assignments.AsNoTracking().SingleOrDefaultAsync(row => row.FirmId == firmId &&
                row.BranchId == branchId && row.TableId == tableId && row.ClosedAt == null, context.RequestAborted);
            SalesCheckRow check;
            Guid checkId;
            if (assignment is not null)
            {
                if (assignment.WaiterId != command.WaiterId)
                    return Fail(context, "TABLE_ASSIGNED_TO_OTHER_WAITER", 409, "Bu masa başka bir garsona atanmış.");
                checkId = assignment.CheckId;
                var existingCheck = await salesDb.Checks.AsNoTracking().SingleOrDefaultAsync(row => row.Id == checkId &&
                    row.FirmId == firmId && row.BranchId == branchId && row.Status == "open", context.RequestAborted);
                if (existingCheck is null)
                    return Fail(context, "CHECK_NOT_FOUND", 409, "Masanın açık adisyonu bulunamadı; yönetim ekranından yenileyin.");
                check = existingCheck;
            }
            else
            {
                checkId = command.OrderId;
                check = new SalesCheckRow { Id = checkId, FirmId = firmId, BranchId = branchId,
                    TableId = tableId, WaiterId = waiter.Id, Status = "open", Currency = "TRY",
                    CreatedAt = DateTimeOffset.UtcNow, Version = 1 };
            }

            var result = await salesOrders.CreateAsync(firmId, branchId,
                new CreatePosOrder(command.OrderId, command.Items), waiter.Name, context.RequestAborted,
                requestedCheckId: checkId, checkToCreate: assignment is null ? check : null,
                source: "waiter_web");
            if (result.Failure is { } failure) return Fail(context, failure.Code, failure.Status, failure.Message);
            return result.Created
                ? Results.Created($"/api/v1/firms/{firmId}/branches/{branchId}/service/tables/{tableId}/orders/{command.OrderId}",
                    new { order = result.Order, table = table.Name, waiter = waiter.Name })
                : Results.Ok(new { order = result.Order, table = table.Name, waiter = waiter.Name });
        });

        group.MapGet("/employees", async (string firmId, string branchId, HttpContext context, ServiceDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, ready, false);
            if (denied is not null) return denied;
            var rows = await db.Employees.AsNoTracking().Where(row => row.FirmId == firmId && row.BranchId == branchId)
                .OrderBy(row => row.Department).ThenBy(row => row.JobTitle).ThenBy(row => row.Name)
                .ToListAsync(context.RequestAborted);
            return Results.Ok(new { source = "postgres", items = rows.Select(ToView).ToArray() });
        });

        group.MapPost("/employees", async (string firmId, string branchId, CreateServiceEmployee command,
            HttpContext context, ServiceDbContext db, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            var validation = ValidateEmployee(command.Name, command.Department, command.JobTitle, command.Phone);
            if (command.RequestId == Guid.Empty || validation is not null)
                return Fail(context, "INVALID_EMPLOYEE", 400, validation ?? "Tekrar deneme için geçerli requestId gereklidir.");
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction(),
                firmId, branchId, "staff.records", context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            var id = command.RequestId.ToString();
            var existing = await db.Employees.AsNoTracking().SingleOrDefaultAsync(row => row.Id == id, context.RequestAborted);
            if (existing is not null)
            {
                var same = existing.FirmId == firmId && existing.BranchId == branchId && existing.Name == command.Name.Trim() &&
                    existing.Department == command.Department && existing.JobTitle == command.JobTitle.Trim() && existing.Phone == NormalizePhone(command.Phone);
                if (!same) return Fail(context, "EMPLOYEE_REQUEST_CONFLICT", 409, "requestId farklı personel verisiyle kullanılmış.");
                await transaction.CommitAsync(context.RequestAborted);
                return Results.Ok(ToView(existing));
            }
            var now = DateTimeOffset.UtcNow;
            var employee = new ServiceWaiterRow { Id = id, FirmId = firmId, BranchId = branchId, Name = command.Name.Trim(),
                Department = command.Department, JobTitle = command.JobTitle.Trim(), Phone = NormalizePhone(command.Phone),
                IsActive = true, Version = 1, CreatedAt = now, UpdatedAt = now };
            db.Employees.Add(employee);
            AddAudit(db, firmId, branchId, id, "employee_created", DemoAccess.Resolve(context)!.Name, now);
            try { await db.SaveChangesAsync(context.RequestAborted); await transaction.CommitAsync(context.RequestAborted); }
            catch (DbUpdateException error) when (Unique(error))
            { return Fail(context, "EMPLOYEE_REQUEST_CONFLICT", 409, "Bu requestId daha önce kullanılmış."); }
            return Results.Created($"/api/v1/firms/{firmId}/branches/{branchId}/service/employees/{id}", ToView(employee));
        });

        group.MapPut("/employees/{employeeId}", async (string firmId, string branchId, string employeeId,
            UpdateServiceEmployee command, HttpContext context, ServiceDbContext db, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            var validation = ValidateEmployee(command.Name, command.Department, command.JobTitle, command.Phone);
            if (command.ExpectedVersion < 1 || validation is not null)
                return Fail(context, "INVALID_EMPLOYEE", 400, validation ?? "expectedVersion pozitif olmalı.");
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction(),
                firmId, branchId, "staff.records", context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            var employee = await db.Employees.FromSqlInterpolated($"SELECT * FROM service.employees WHERE id = {employeeId} AND firm_id = {firmId} AND branch_id = {branchId} FOR UPDATE")
                .SingleOrDefaultAsync(context.RequestAborted);
            if (employee is null) return Fail(context, "EMPLOYEE_NOT_FOUND", 404, "Bu şubede personel kaydı bulunamadı.");
            if (employee.Version != command.ExpectedVersion) return Fail(context, "VERSION_CONFLICT", 409, "Personel kartı başka işlemle değişti; yenileyin.");
            if (employee.IsActive && (!command.IsActive || command.Department != "service") &&
                await db.Assignments.AnyAsync(row => row.FirmId == firmId && row.BranchId == branchId && row.WaiterId == employee.Id && row.ClosedAt == null, context.RequestAborted))
                return Fail(context, "EMPLOYEE_HAS_OPEN_ASSIGNMENT", 409, "Açık masa-adisyon ataması olan servis personeli pasife alınamaz veya başka bölüme taşınamaz.");
            var previousActive = employee.IsActive;
            employee.Name = command.Name.Trim(); employee.Department = command.Department;
            employee.JobTitle = command.JobTitle.Trim(); employee.Phone = NormalizePhone(command.Phone);
            employee.IsActive = command.IsActive; employee.Version++; employee.UpdatedAt = DateTimeOffset.UtcNow;
            var action = previousActive == employee.IsActive ? "employee_updated" : employee.IsActive ? "employee_reactivated" : "employee_deactivated";
            AddAudit(db, firmId, branchId, employee.Id, action, DemoAccess.Resolve(context)!.Name, employee.UpdatedAt);
            await db.SaveChangesAsync(context.RequestAborted);
            await transaction.CommitAsync(context.RequestAborted);
            return Results.Ok(ToView(employee));
        });

        group.MapPost("/tables", async (string firmId, string branchId, CreateServiceTable command,
            HttpContext context, ServiceDbContext db, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            var name = command.Name?.Trim();
            if (command.Number is < 1 or > 999 || name?.Length > 80)
                return Fail(context, "INVALID_TABLE", 400, "Masa numarası 1–999, adı en çok 80 karakter olmalı.");
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction(),
                firmId, branchId, "branches.tables", context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            var number = command.Number ?? (await db.Tables.AsNoTracking().Where(row => row.FirmId == firmId &&
                row.BranchId == branchId && row.IsActive).OrderByDescending(row => row.Number)
                .Select(row => (int?)row.Number).FirstOrDefaultAsync(context.RequestAborted) ?? 0) + 1;
            if (number is < 1 or > 999)
                return Fail(context, "TABLE_LIMIT_REACHED", 409, "Bu şubede en fazla 999 masa numarası kullanılabilir.");
            var now = DateTimeOffset.UtcNow;
            var existing = await db.Tables.SingleOrDefaultAsync(row => row.FirmId == firmId && row.BranchId == branchId &&
                row.Number == number, context.RequestAborted);
            if (existing is { IsActive: true }) return Fail(context, "TABLE_EXISTS", 409, "Bu numarada masa zaten var.");
            if (existing is not null)
            {
                existing.IsActive = true;
                existing.Version++;
                existing.UpdatedAt = now;
                AddAudit(db, firmId, branchId, existing.Id, "table_reactivated", DemoAccess.Resolve(context)!.Name, now);
                await db.SaveChangesAsync(context.RequestAborted);
                await transaction.CommitAsync(context.RequestAborted);
                return Results.Ok(new ServiceTableView(existing.Id, existing.Number, existing.Name, true, null));
            }
            var row = new ServiceTableRow { Id = Guid.NewGuid().ToString(), FirmId = firmId, BranchId = branchId,
                Number = number, Name = name?.Length > 0 ? name : $"Masa {number:00}", UpdatedAt = now };
            db.Tables.Add(row);
            AddAudit(db, firmId, branchId, row.Id, "table_created", DemoAccess.Resolve(context)!.Name, now);
            try { await db.SaveChangesAsync(context.RequestAborted); await transaction.CommitAsync(context.RequestAborted); }
            catch (DbUpdateException error) when (Unique(error))
            { return Fail(context, "TABLE_EXISTS", 409, "Bu numarada masa zaten var."); }
            return Results.Created($"/api/v1/firms/{firmId}/branches/{branchId}/service/tables/{row.Id}",
                new ServiceTableView(row.Id, row.Number, row.Name, row.IsActive, null));
        });

        group.MapDelete("/tables/{tableId}", async (string firmId, string branchId, string tableId,
            HttpContext context, ServiceDbContext db, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction(),
                firmId, branchId, "branches.tables", context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            var table = await db.Tables.FromSqlInterpolated($"SELECT * FROM service.tables WHERE id = {tableId} AND firm_id = {firmId} AND branch_id = {branchId} FOR UPDATE")
                .SingleOrDefaultAsync(context.RequestAborted);
            if (table is null || !table.IsActive) return Fail(context, "TABLE_NOT_FOUND", 404, "Bu şubede aktif masa bulunamadı.");
            var lastNumber = await db.Tables.Where(row => row.FirmId == firmId && row.BranchId == branchId && row.IsActive)
                .MaxAsync(row => (int?)row.Number, context.RequestAborted);
            if (table.Number != lastNumber) return Fail(context, "ONLY_LAST_TABLE_CAN_BE_REMOVED", 409, "Yalnızca en son numaralı masa kaldırılabilir.");
            if (await db.Assignments.AnyAsync(row => row.TableId == table.Id && row.ClosedAt == null, context.RequestAborted))
                return Fail(context, "TABLE_HAS_OPEN_CHECK", 409, "Bu masada açık adisyon var; masa kaldırılamaz.");
            var now = DateTimeOffset.UtcNow;
            table.IsActive = false;
            table.Version++;
            table.UpdatedAt = now;
            AddAudit(db, firmId, branchId, table.Id, "table_deactivated", DemoAccess.Resolve(context)!.Name, now);
            await db.SaveChangesAsync(context.RequestAborted);
            await transaction.CommitAsync(context.RequestAborted);
            return Results.Ok(new { id = table.Id, number = table.Number, isActive = false });
        });

        group.MapPost("/waiters", async (string firmId, string branchId, CreateServiceWaiter command,
            HttpContext context, ServiceDbContext db, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true);
            if (denied is not null) return denied;
            var name = command.Name?.Trim() ?? "";
            if (name.Length is < 2 or > 160) return Fail(context, "INVALID_WAITER", 400, "Garson adı 2–160 karakter olmalı.");
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction(),
                firmId, branchId, "service.waiters", context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            var now = DateTimeOffset.UtcNow;
            var row = new ServiceWaiterRow { Id = Guid.NewGuid().ToString(), FirmId = firmId, BranchId = branchId, Name = name,
                Department = "service", JobTitle = "Garson", CreatedAt = now, UpdatedAt = now };
            db.Employees.Add(row);
            AddAudit(db, firmId, branchId, row.Id, "waiter_created", DemoAccess.Resolve(context)!.Name, now);
            await db.SaveChangesAsync(context.RequestAborted);
            await transaction.CommitAsync(context.RequestAborted);
            return Results.Created($"/api/v1/firms/{firmId}/branches/{branchId}/service/waiters/{row.Id}", new ServiceWaiterView(row.Id, row.Name, true));
        });

        group.MapPost("/assignments", async (string firmId, string branchId, AssignServiceOrder command,
            HttpContext context, ServiceDbContext db, SalesDbContext sales, FeatureNewWorkGate gate) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true, allowOperator: true);
            if (denied is not null) return denied;
            if (command.RequestId == Guid.Empty || command.OrderId == Guid.Empty || string.IsNullOrWhiteSpace(command.TableId) ||
                command.WaiterId is { Length: > 80 })
                return Fail(context, "INVALID_ASSIGNMENT", 400, "Masa, adisyon veya istek kimliği geçersiz.");
            var existing = await db.Assignments.AsNoTracking().SingleOrDefaultAsync(row => row.Id == command.RequestId, context.RequestAborted);
            if (existing is not null)
                return existing.FirmId == firmId && existing.BranchId == branchId && existing.TableId == command.TableId &&
                    existing.OrderId == command.OrderId && existing.WaiterId == command.WaiterId
                    ? Results.Ok(new { id = existing.Id, version = existing.Version, closedAt = existing.ClosedAt })
                    : Fail(context, "ASSIGNMENT_ID_CONFLICT", 409, "İstek kimliği farklı içerikle kullanılmış.");
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction(),
                firmId, branchId, "branches.tables", context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            if (command.WaiterId is not null)
            {
                blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction(),
                    firmId, branchId, "service.waiters", context.RequestAborted);
                if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
                blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction(),
                    firmId, branchId, "staff.records", context.RequestAborted);
                if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            }
            blocked = await gate.CheckAndLockAsync(db.Database.GetDbConnection(), transaction.GetDbTransaction(),
                firmId, branchId, "sales.checks", context.RequestAborted);
            if (blocked is not null) return Fail(context, blocked.Code, blocked.Status, blocked.Message);
            var table = await db.Tables.FromSqlInterpolated($"SELECT * FROM service.tables WHERE id = {command.TableId} AND firm_id = {firmId} AND branch_id = {branchId} FOR UPDATE")
                .SingleOrDefaultAsync(context.RequestAborted);
            if (table is null || !table.IsActive) return Fail(context, "TABLE_NOT_FOUND", 404, "Bu şubede aktif masa bulunamadı.");
            if (await db.Assignments.AnyAsync(row => row.TableId == table.Id && row.ClosedAt == null, context.RequestAborted))
                return Fail(context, "TABLE_OCCUPIED", 409, "Masada zaten açık adisyon var.");
            if (command.WaiterId is not null && !await db.Employees.AnyAsync(row => row.Id == command.WaiterId &&
                row.FirmId == firmId && row.BranchId == branchId && row.Department == "service" && row.IsActive, context.RequestAborted))
                return Fail(context, "WAITER_NOT_FOUND", 404, "Bu şubede aktif garson bulunamadı.");
            var order = await sales.Orders.AsNoTracking().SingleOrDefaultAsync(row => row.Id == command.OrderId &&
                row.FirmId == firmId && row.BranchId == branchId, context.RequestAborted);
            if (order is null || order.Status != "open") return Fail(context, "ORDER_NOT_FOUND", 404, "Bu şubede açık adisyon bulunamadı.");
            var now = DateTimeOffset.UtcNow;
            var row = new ServiceAssignmentRow { Id = command.RequestId, FirmId = firmId, BranchId = branchId,
                CheckId = order.CheckId, TableId = table.Id, OrderId = order.Id, WaiterId = command.WaiterId,
                OpenedAt = now, CreatedBy = DemoAccess.Resolve(context)!.Name };
            db.Assignments.Add(row);
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE sales.checks SET table_id = {table.Id}, waiter_id = {command.WaiterId}, version = version + 1
                WHERE id = {order.CheckId} AND firm_id = {firmId} AND branch_id = {branchId}
                """, context.RequestAborted);
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO sales.check_audit (check_id,firm_id,branch_id,actor,action,version,occurred_at)
                SELECT id,firm_id,branch_id,{row.CreatedBy},'table_assigned',version,{now}
                FROM sales.checks WHERE id = {order.CheckId} AND firm_id = {firmId} AND branch_id = {branchId}
                """, context.RequestAborted);
            AddAudit(db, firmId, branchId, row.Id.ToString(), "assignment_opened", row.CreatedBy, now);
            try { await db.SaveChangesAsync(context.RequestAborted); await transaction.CommitAsync(context.RequestAborted); }
            catch (DbUpdateException error) when (Unique(error))
            { return Fail(context, "ASSIGNMENT_CONFLICT", 409, "Masa veya adisyon başka işlemde bağlandı."); }
            return Results.Created($"/api/v1/firms/{firmId}/branches/{branchId}/service/assignments/{row.Id}",
                new { id = row.Id, version = row.Version, closedAt = row.ClosedAt });
        });

        group.MapPost("/assignments/{assignmentId:guid}/close", async (string firmId, string branchId, Guid assignmentId,
            CloseServiceAssignment command, HttpContext context, ServiceDbContext db) =>
        {
            var denied = Guard(context, firmId, branchId, ready, true, allowOperator: true);
            if (denied is not null) return denied;
            if (command.ExpectedVersion < 1) return Fail(context, "INVALID_VERSION", 400, "expectedVersion pozitif olmalı.");
            await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);
            var row = await db.Assignments.FromSqlInterpolated($"SELECT * FROM service.assignments WHERE id = {assignmentId} AND firm_id = {firmId} AND branch_id = {branchId} FOR UPDATE")
                .SingleOrDefaultAsync(context.RequestAborted);
            if (row is null) return Fail(context, "ASSIGNMENT_NOT_FOUND", 404, "Masa-adisyon bağı bulunamadı.");
            if (row.ClosedAt is not null) return Results.Ok(new { id = row.Id, version = row.Version, closedAt = row.ClosedAt });
            if (row.Version != command.ExpectedVersion) return Fail(context, "VERSION_CONFLICT", 409, "Masa bağı başka işlemle değişti.");
            row.ClosedAt = DateTimeOffset.UtcNow;
            row.ClosedBy = DemoAccess.Resolve(context)!.Name;
            row.Version++;
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE sales.checks SET table_id = NULL, waiter_id = NULL, version = version + 1
                WHERE id = {row.CheckId} AND firm_id = {firmId} AND branch_id = {branchId} AND table_id = {row.TableId}
                """, context.RequestAborted);
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO sales.check_audit (check_id,firm_id,branch_id,actor,action,version,occurred_at)
                SELECT id,firm_id,branch_id,{row.ClosedBy},'table_unassigned',version,{row.ClosedAt}
                FROM sales.checks WHERE id = {row.CheckId} AND firm_id = {firmId} AND branch_id = {branchId}
                """, context.RequestAborted);
            AddAudit(db, firmId, branchId, row.Id.ToString(), "assignment_closed", row.ClosedBy, row.ClosedAt.Value);
            await db.SaveChangesAsync(context.RequestAborted);
            await transaction.CommitAsync(context.RequestAborted);
            // Masayı boşaltmak satış adisyonunu veya ödeme durumunu değiştirmez.
            return Results.Ok(new { id = row.Id, version = row.Version, closedAt = row.ClosedAt });
        });
    }

    private static ServiceAssignmentView ToView(ServiceAssignmentRow assignment, IReadOnlyList<SalesOrderRow> orders, string? waiterName)
    {
        var primaryOrder = orders.FirstOrDefault(order => order.Id == assignment.OrderId) ?? orders[0];
        return new ServiceAssignmentView(assignment.Id.ToString(), assignment.OrderId.ToString(), assignment.WaiterId, waiterName,
            assignment.OpenedAt, primaryOrder.CreatedAt, primaryOrder.Status, primaryOrder.PaymentStatus,
            orders.Sum(order => order.TotalMinor), assignment.Version,
            orders.SelectMany(order => order.Lines).OrderBy(line => line.Id)
                .Select(line => new ServiceLineView(line.ProductId.ToString(), line.ProductName, line.Quantity,
                    line.UnitPriceMinor, line.LineTotalMinor)).ToArray());
    }

    private static async Task<Dictionary<string, ServiceTableRow>?> LockTablesAsync(ServiceDbContext db,
        string firmId, string branchId, IReadOnlyCollection<string> tableIds, CancellationToken cancellationToken)
    {
        var result = new Dictionary<string, ServiceTableRow>(StringComparer.Ordinal);
        foreach (var tableId in tableIds.Distinct(StringComparer.Ordinal).OrderBy(id => id, StringComparer.Ordinal))
        {
            var table = await db.Tables.FromSqlInterpolated($"""
                SELECT * FROM service.tables WHERE id = {tableId} AND firm_id = {firmId}
                    AND branch_id = {branchId} FOR UPDATE
                """).SingleOrDefaultAsync(cancellationToken);
            if (table is null) return null;
            result.Add(tableId, table);
        }
        return result;
    }

    private static ServiceEmployeeView ToView(ServiceWaiterRow employee) => new(employee.Id, employee.Name, employee.Department,
        employee.JobTitle, employee.Phone, employee.IsActive, employee.Version, employee.CreatedAt, employee.UpdatedAt);

    private static string? ValidateEmployee(string name, string department, string jobTitle, string? phone)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Trim().Length is < 2 or > 160) return "Personel adı 2–160 karakter olmalı.";
        if (department is not ("management" or "kitchen" or "service" or "cashier" or "support")) return "Personel bölümü geçersiz.";
        if (string.IsNullOrWhiteSpace(jobTitle) || jobTitle.Trim().Length is < 2 or > 80) return "Görev adı 2–80 karakter olmalı.";
        if (phone?.Trim().Length > 40) return "Telefon en çok 40 karakter olabilir.";
        return null;
    }

    private static string? NormalizePhone(string? phone) => string.IsNullOrWhiteSpace(phone) ? null : phone.Trim();

    private static IResult? Guard(HttpContext context, string firmId, string branchId, bool ready, bool write, bool allowOperator = false)
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Fail(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanRead(firmId, branchId) || write && !(actor.CanManage || allowOperator && actor.CanOperate))
            return Fail(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubede masa servisi izni yok.");
        if (!ready) return Fail(context, "SERVICE_STORAGE_UNAVAILABLE", 503, "Service ve sales migration'ları uygulanmalı; API yeniden başlatılmalı.");
        return null;
    }

    private static void AddAudit(ServiceDbContext db, string firmId, string branchId, string entityId,
        string action, string actor, DateTimeOffset now) => db.Audit.Add(new ServiceAuditRow
        { FirmId = firmId, BranchId = branchId, EntityId = entityId, Action = action, Actor = actor, OccurredAt = now });

    private static bool Unique(DbUpdateException error) => error.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };

    private static IResult Fail(HttpContext context, string code, int status, string detail) => Results.Json(new
    {
        type = $"https://hipos.local/problems/{code.ToLowerInvariant().Replace('_', '-')}",
        title = status switch { 401 => "Oturum gerekli", 403 => "Yetkisiz kapsam", 404 => "Bulunamadı", 409 => "İşlem çakışması", 503 => "Kurulum gerekiyor", _ => "İstek hatası" },
        status, detail, instance = context.Request.Path.Value, code, traceId = context.TraceIdentifier,
    }, statusCode: status, contentType: "application/problem+json");
}
