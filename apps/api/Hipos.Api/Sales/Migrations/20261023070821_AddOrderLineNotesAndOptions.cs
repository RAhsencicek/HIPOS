using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Sales.Migrations
{
    /// <inheritdoc />
    public partial class AddOrderLineNotesAndOptions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "note",
                schema: "sales",
                table: "order_lines",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "options_json",
                schema: "sales",
                table: "order_lines",
                type: "jsonb",
                nullable: false,
                defaultValue: "[]");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "note",
                schema: "sales",
                table: "order_lines");

            migrationBuilder.DropColumn(
                name: "options_json",
                schema: "sales",
                table: "order_lines");
        }
    }
}
