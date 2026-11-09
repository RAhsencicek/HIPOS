using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Cash.Migrations
{
    /// <inheritdoc />
    public partial class AddRetainedFloatAndDroppedRevenue : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE cash.shifts ADD COLUMN IF NOT EXISTS dropped_revenue_minor bigint;");
            migrationBuilder.Sql("ALTER TABLE cash.shifts ADD COLUMN IF NOT EXISTS retained_float_minor bigint;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "dropped_revenue_minor",
                schema: "cash",
                table: "shifts");

            migrationBuilder.DropColumn(
                name: "retained_float_minor",
                schema: "cash",
                table: "shifts");
        }
    }
}
