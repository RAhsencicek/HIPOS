using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Catalog.Migrations
{
    /// <inheritdoc />
    public partial class AddMenuCustomSections : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_menu_items_menu_sections_menu_id_category_id",
                schema: "catalog",
                table: "menu_items");

            migrationBuilder.DropPrimaryKey(
                name: "PK_menu_sections",
                schema: "catalog",
                table: "menu_sections");

            migrationBuilder.DropIndex(
                name: "IX_menu_items_menu_id_category_id",
                schema: "catalog",
                table: "menu_items");

            migrationBuilder.RenameColumn(name: "category_id", schema: "catalog", table: "menu_sections", newName: "section_id");

            migrationBuilder.AddColumn<string>(
                name: "name",
                schema: "catalog",
                table: "menu_sections",
                type: "character varying(120)",
                maxLength: 120,
                nullable: false,
                defaultValue: "");

            migrationBuilder.Sql("UPDATE catalog.menu_sections s SET name = COALESCE((SELECT c.name FROM catalog.menus m LEFT JOIN catalog.categories c ON c.firm_id = m.firm_id AND c.id = s.section_id WHERE m.id = s.menu_id), s.section_id)");
            migrationBuilder.RenameColumn(name: "category_id", schema: "catalog", table: "menu_items", newName: "section_id");

            migrationBuilder.AddPrimaryKey(
                name: "PK_menu_sections",
                schema: "catalog",
                table: "menu_sections",
                columns: new[] { "menu_id", "section_id" });

            migrationBuilder.CreateIndex(
                name: "IX_menu_items_menu_id_section_id",
                schema: "catalog",
                table: "menu_items",
                columns: new[] { "menu_id", "section_id" });

            migrationBuilder.AddForeignKey(
                name: "FK_menu_items_menu_sections_menu_id_section_id",
                schema: "catalog",
                table: "menu_items",
                columns: new[] { "menu_id", "section_id" },
                principalSchema: "catalog",
                principalTable: "menu_sections",
                principalColumns: new[] { "menu_id", "section_id" },
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_menu_items_menu_sections_menu_id_section_id",
                schema: "catalog",
                table: "menu_items");

            migrationBuilder.DropPrimaryKey(
                name: "PK_menu_sections",
                schema: "catalog",
                table: "menu_sections");

            migrationBuilder.DropIndex(
                name: "IX_menu_items_menu_id_section_id",
                schema: "catalog",
                table: "menu_items");

            migrationBuilder.DropColumn(
                name: "name",
                schema: "catalog",
                table: "menu_sections");

            migrationBuilder.RenameColumn(name: "section_id", schema: "catalog", table: "menu_sections", newName: "category_id");
            migrationBuilder.RenameColumn(name: "section_id", schema: "catalog", table: "menu_items", newName: "category_id");

            migrationBuilder.AddPrimaryKey(
                name: "PK_menu_sections",
                schema: "catalog",
                table: "menu_sections",
                columns: new[] { "menu_id", "category_id" });

            migrationBuilder.CreateIndex(
                name: "IX_menu_items_menu_id_category_id",
                schema: "catalog",
                table: "menu_items",
                columns: new[] { "menu_id", "category_id" });

            migrationBuilder.AddForeignKey(
                name: "FK_menu_items_menu_sections_menu_id_category_id",
                schema: "catalog",
                table: "menu_items",
                columns: new[] { "menu_id", "category_id" },
                principalSchema: "catalog",
                principalTable: "menu_sections",
                principalColumns: new[] { "menu_id", "category_id" },
                onDelete: ReferentialAction.Cascade);
        }
    }
}
