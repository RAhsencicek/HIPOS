using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Inventory.Migrations
{
    /// <inheritdoc />
    public partial class CountMovementSnapshot : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "movement_count_snapshot",
                schema: "inventory",
                table: "count_lines",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.Sql("""
                UPDATE inventory.count_lines AS line
                SET movement_count_snapshot = (
                    SELECT count(*)::integer
                    FROM inventory.movements AS movement
                    JOIN inventory.counts AS count_row ON count_row.id = line.count_id
                    WHERE movement.firm_id = count_row.firm_id
                      AND movement.branch_id = count_row.branch_id
                      AND movement.warehouse_id = count_row.warehouse_id
                      AND movement.ingredient_id = line.ingredient_id
                );
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "movement_count_snapshot",
                schema: "inventory",
                table: "count_lines");
        }
    }
}
