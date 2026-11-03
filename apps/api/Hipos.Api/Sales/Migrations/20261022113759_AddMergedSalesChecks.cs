using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Sales.Migrations
{
    /// <inheritdoc />
    public partial class AddMergedSalesChecks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_check_status",
                schema: "sales",
                table: "checks");

            migrationBuilder.AddColumn<Guid>(
                name: "merged_into_check_id",
                schema: "sales",
                table: "checks",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_checks_merged_into_check_id",
                schema: "sales",
                table: "checks",
                column: "merged_into_check_id");

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

            migrationBuilder.AddForeignKey(
                name: "FK_checks_checks_merged_into_check_id",
                schema: "sales",
                table: "checks",
                column: "merged_into_check_id",
                principalSchema: "sales",
                principalTable: "checks",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_checks_checks_merged_into_check_id",
                schema: "sales",
                table: "checks");

            migrationBuilder.DropIndex(
                name: "IX_checks_merged_into_check_id",
                schema: "sales",
                table: "checks");

            migrationBuilder.DropCheckConstraint(
                name: "ck_check_merged_target",
                schema: "sales",
                table: "checks");

            migrationBuilder.DropCheckConstraint(
                name: "ck_check_status",
                schema: "sales",
                table: "checks");

            migrationBuilder.DropColumn(
                name: "merged_into_check_id",
                schema: "sales",
                table: "checks");

            migrationBuilder.AddCheckConstraint(
                name: "ck_check_status",
                schema: "sales",
                table: "checks",
                sql: "status IN ('open')");
        }
    }
}
