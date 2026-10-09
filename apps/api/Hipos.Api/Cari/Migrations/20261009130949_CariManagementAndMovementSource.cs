using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Cari.Migrations
{
    /// <inheritdoc />
    public partial class CariManagementAndMovementSource : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("UPDATE cari.movements SET source = 'manual' WHERE source = 'demo_seed'");
            migrationBuilder.AddCheckConstraint(
                name: "ck_movement_source",
                schema: "cari",
                table: "movements",
                sql: "source IN ('manual', 'integration', 'sales', 'purchase', 'opening_balance', 'adjustment')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_movement_source",
                schema: "cari",
                table: "movements");
        }
    }
}
