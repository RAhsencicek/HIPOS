using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Sales.Migrations
{
    /// <inheritdoc />
    public partial class SalesCheckForeignKeys : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddUniqueConstraint(
                name: "AK_checks_id_firm_id_branch_id",
                schema: "sales",
                table: "checks",
                columns: new[] { "id", "firm_id", "branch_id" });

            migrationBuilder.CreateIndex(
                name: "IX_payment_attempts_check_id",
                schema: "sales",
                table: "payment_attempts",
                column: "check_id");

            migrationBuilder.CreateIndex(
                name: "IX_orders_check_id",
                schema: "sales",
                table: "orders",
                column: "check_id");

            migrationBuilder.AddForeignKey(
                name: "FK_orders_checks_check_id",
                schema: "sales",
                table: "orders",
                column: "check_id",
                principalSchema: "sales",
                principalTable: "checks",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_payment_attempts_checks_check_id",
                schema: "sales",
                table: "payment_attempts",
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
                name: "FK_orders_checks_check_id",
                schema: "sales",
                table: "orders");

            migrationBuilder.DropForeignKey(
                name: "FK_payment_attempts_checks_check_id",
                schema: "sales",
                table: "payment_attempts");

            migrationBuilder.DropIndex(
                name: "IX_payment_attempts_check_id",
                schema: "sales",
                table: "payment_attempts");

            migrationBuilder.DropIndex(
                name: "IX_orders_check_id",
                schema: "sales",
                table: "orders");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_checks_id_firm_id_branch_id",
                schema: "sales",
                table: "checks");
        }
    }
}
