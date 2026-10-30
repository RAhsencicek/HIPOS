using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Cash.Migrations
{
    /// <inheritdoc />
    public partial class CashSalesFromPayments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_cash_movement_kind",
                schema: "cash",
                table: "movements");

            migrationBuilder.AddColumn<string>(
                name: "tender_method",
                schema: "cash",
                table: "movements",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "ck_cash_movement_kind",
                schema: "cash",
                table: "movements",
                sql: "kind IN ('opening_float', 'manual_in', 'manual_out', 'pos_sale')");

            migrationBuilder.AddCheckConstraint(
                name: "ck_cash_movement_pos_sale",
                schema: "cash",
                table: "movements",
                sql: "kind <> 'pos_sale' OR (source = 'pos' AND category = 'cash_sale' AND tender_method IN ('cash', 'card'))");

            migrationBuilder.AddCheckConstraint(
                name: "ck_cash_movement_tender_method",
                schema: "cash",
                table: "movements",
                sql: "tender_method IS NULL OR tender_method IN ('cash', 'card')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_cash_movement_kind",
                schema: "cash",
                table: "movements");

            migrationBuilder.DropCheckConstraint(
                name: "ck_cash_movement_pos_sale",
                schema: "cash",
                table: "movements");

            migrationBuilder.DropCheckConstraint(
                name: "ck_cash_movement_tender_method",
                schema: "cash",
                table: "movements");

            migrationBuilder.DropColumn(
                name: "tender_method",
                schema: "cash",
                table: "movements");

            migrationBuilder.AddCheckConstraint(
                name: "ck_cash_movement_kind",
                schema: "cash",
                table: "movements",
                sql: "kind IN ('opening_float', 'manual_in', 'manual_out')");
        }
    }
}
