using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Kitchen.Migrations
{
    /// <inheritdoc />
    public partial class AddKitchenTaskNotes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "notes",
                schema: "kitchen",
                table: "tasks",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "notes",
                schema: "kitchen",
                table: "tasks");
        }
    }
}
