using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Inventory.Migrations
{
    /// <inheritdoc />
    public partial class AddWasteCostSnapshots : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "cost_method",
                schema: "inventory",
                table: "waste_logs",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "snapshot_unit_cost_minor",
                schema: "inventory",
                table: "waste_logs",
                type: "numeric(18,6)",
                precision: 18,
                scale: 6,
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "total_cost_minor",
                schema: "inventory",
                table: "waste_logs",
                type: "bigint",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "cost_method",
                schema: "inventory",
                table: "waste_logs");

            migrationBuilder.DropColumn(
                name: "snapshot_unit_cost_minor",
                schema: "inventory",
                table: "waste_logs");

            migrationBuilder.DropColumn(
                name: "total_cost_minor",
                schema: "inventory",
                table: "waste_logs");
        }
    }
}
