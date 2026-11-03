using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Catalog.Migrations;

public partial class AllowMultipleActiveMenus : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropIndex(
            name: "IX_menus_firm_id_branch_id",
            schema: "catalog",
            table: "menus");

        migrationBuilder.CreateIndex(
            name: "IX_menus_firm_id_branch_id",
            schema: "catalog",
            table: "menus",
            columns: new[] { "firm_id", "branch_id" });
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropIndex(
            name: "IX_menus_firm_id_branch_id",
            schema: "catalog",
            table: "menus");

        migrationBuilder.CreateIndex(
            name: "IX_menus_firm_id_branch_id",
            schema: "catalog",
            table: "menus",
            columns: new[] { "firm_id", "branch_id" },
            unique: true,
            filter: "is_active");
    }
}
