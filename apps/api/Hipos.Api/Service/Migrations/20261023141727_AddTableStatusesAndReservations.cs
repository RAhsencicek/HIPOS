using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Service.Migrations
{
    /// <inheritdoc />
    public partial class AddTableStatusesAndReservations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "reserved_for",
                schema: "service",
                table: "tables",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "status",
                schema: "service",
                table: "tables",
                type: "character varying(24)",
                maxLength: 24,
                nullable: false,
                defaultValue: "idle");

            migrationBuilder.Sql("""
                UPDATE service.tables AS table_row
                SET status = 'occupied'
                WHERE EXISTS (
                    SELECT 1 FROM service.assignments AS assignment
                    WHERE assignment.firm_id = table_row.firm_id
                      AND assignment.branch_id = table_row.branch_id
                      AND assignment.table_id = table_row.id
                      AND assignment.closed_at IS NULL
                );
                UPDATE service.tables AS table_row
                SET status = 'occupied'
                WHERE table_row.table_group_id IS NOT NULL
                  AND EXISTS (
                    SELECT 1 FROM service.table_groups AS table_group
                    WHERE table_group.id = table_row.table_group_id
                      AND table_group.closed_at IS NULL
                  );
                """);

            migrationBuilder.AddCheckConstraint(
                name: "ck_table_reserved_for",
                schema: "service",
                table: "tables",
                sql: "(status = 'reserved') = (reserved_for IS NOT NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "ck_table_status",
                schema: "service",
                table: "tables",
                sql: "status IN ('idle','occupied','bill_requested','reserved')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_table_reserved_for",
                schema: "service",
                table: "tables");

            migrationBuilder.DropCheckConstraint(
                name: "ck_table_status",
                schema: "service",
                table: "tables");

            migrationBuilder.DropColumn(
                name: "reserved_for",
                schema: "service",
                table: "tables");

            migrationBuilder.DropColumn(
                name: "status",
                schema: "service",
                table: "tables");
        }
    }
}
