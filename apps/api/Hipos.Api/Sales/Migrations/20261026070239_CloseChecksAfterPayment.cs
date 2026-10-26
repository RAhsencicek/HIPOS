using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Sales.Migrations
{
    /// <inheritdoc />
    public partial class CloseChecksAfterPayment : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_check_merged_target",
                schema: "sales",
                table: "checks");

            migrationBuilder.DropCheckConstraint(
                name: "ck_check_status",
                schema: "sales",
                table: "checks");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "closed_at",
                schema: "sales",
                table: "checks",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "ck_check_merged_target",
                schema: "sales",
                table: "checks",
                sql: "(status = 'merged' AND merged_into_check_id IS NOT NULL AND closed_at IS NULL) OR (status = 'closed' AND merged_into_check_id IS NULL AND closed_at IS NOT NULL) OR (status = 'open' AND merged_into_check_id IS NULL AND closed_at IS NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "ck_check_status",
                schema: "sales",
                table: "checks",
                sql: "status IN ('open', 'merged', 'closed')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_check_merged_target",
                schema: "sales",
                table: "checks");

            migrationBuilder.DropCheckConstraint(
                name: "ck_check_status",
                schema: "sales",
                table: "checks");

            migrationBuilder.DropColumn(
                name: "closed_at",
                schema: "sales",
                table: "checks");

            migrationBuilder.AddCheckConstraint(
                name: "ck_check_merged_target",
                schema: "sales",
                table: "checks",
                sql: "(status = 'merged' AND merged_into_check_id IS NOT NULL) OR (status = 'open' AND merged_into_check_id IS NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "ck_check_status",
                schema: "sales",
                table: "checks",
                sql: "status IN ('open', 'merged')");
        }
    }
}
