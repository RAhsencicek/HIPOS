using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Service.Migrations
{
    /// <inheritdoc />
    public partial class ServiceAssignmentsChecksNullableBackfill : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "check_id",
                schema: "service",
                table: "assignments",
                type: "uuid",
                nullable: true);

            migrationBuilder.Sql("""
                UPDATE service.assignments a
                SET check_id = o.check_id
                FROM sales.orders o
                WHERE a.order_id = o.id AND a.check_id IS NULL;
                UPDATE sales.checks c
                SET table_id = a.table_id, waiter_id = a.waiter_id
                FROM service.assignments a
                WHERE a.check_id = c.id AND a.closed_at IS NULL;
                INSERT INTO sales.check_audit (check_id,firm_id,branch_id,actor,action,version,occurred_at)
                SELECT a.check_id, a.firm_id, a.branch_id, a.created_by, 'table_assignment_migrated', c.version, a.opened_at
                FROM service.assignments a JOIN sales.checks c ON c.id = a.check_id;
                """);

            migrationBuilder.CreateIndex(
                name: "IX_assignments_check_id",
                schema: "service",
                table: "assignments",
                column: "check_id");

            migrationBuilder.AddForeignKey(
                name: "FK_assignments_checks_check_id",
                schema: "service",
                table: "assignments",
                column: "check_id",
                principalSchema: "sales",
                principalTable: "checks",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_assignments_checks_check_id",
                schema: "service",
                table: "assignments");

            migrationBuilder.DropIndex(
                name: "IX_assignments_check_id",
                schema: "service",
                table: "assignments");

            migrationBuilder.DropColumn(
                name: "check_id",
                schema: "service",
                table: "assignments");
        }
    }
}
