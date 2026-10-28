using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Sales.Migrations
{
    /// <inheritdoc />
    public partial class AddOrderLineNotes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "notes",
                schema: "sales",
                table: "order_lines",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "notes",
                schema: "sales",
                table: "order_lines");
        }
    }
}
