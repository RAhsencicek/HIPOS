using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Sales.Migrations
{
    /// <inheritdoc />
    public partial class AddOrderOptionPriceSnapshots : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_order_total_positive",
                schema: "sales",
                table: "orders");

            migrationBuilder.DropCheckConstraint(
                name: "ck_line_price_positive",
                schema: "sales",
                table: "order_lines");

            migrationBuilder.AddColumn<long>(
                name: "base_unit_price_minor",
                schema: "sales",
                table: "order_lines",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.Sql("UPDATE sales.order_lines SET base_unit_price_minor = unit_price_minor");

            migrationBuilder.AddCheckConstraint(
                name: "ck_order_total_positive",
                schema: "sales",
                table: "orders",
                sql: "total_minor >= 0");

            migrationBuilder.AddCheckConstraint(
                name: "ck_line_price_positive",
                schema: "sales",
                table: "order_lines",
                sql: "base_unit_price_minor > 0 AND unit_price_minor >= 0 AND line_total_minor >= 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_order_total_positive",
                schema: "sales",
                table: "orders");

            migrationBuilder.DropCheckConstraint(
                name: "ck_line_price_positive",
                schema: "sales",
                table: "order_lines");

            migrationBuilder.DropColumn(
                name: "base_unit_price_minor",
                schema: "sales",
                table: "order_lines");

            migrationBuilder.AddCheckConstraint(
                name: "ck_order_total_positive",
                schema: "sales",
                table: "orders",
                sql: "total_minor > 0");

            migrationBuilder.AddCheckConstraint(
                name: "ck_line_price_positive",
                schema: "sales",
                table: "order_lines",
                sql: "unit_price_minor > 0 AND line_total_minor > 0");
        }
    }
}
