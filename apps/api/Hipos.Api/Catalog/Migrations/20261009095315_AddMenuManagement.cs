using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Catalog.Migrations
{
    /// <inheritdoc />
    public partial class AddMenuManagement : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "menu_audit",
                schema: "catalog",
                columns: table => new
                {
                    request_id = table.Column<Guid>(type: "uuid", nullable: false),
                    menu_id = table.Column<Guid>(type: "uuid", nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    actor = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    action = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    fingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    snapshot_json = table.Column<string>(type: "jsonb", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    occurred_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_menu_audit", x => x.request_id);
                });

            migrationBuilder.CreateTable(
                name: "menus",
                schema: "catalog",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_menus", x => x.id);
                    table.CheckConstraint("ck_menu_version", "version > 0");
                });

            migrationBuilder.CreateTable(
                name: "menu_sections",
                schema: "catalog",
                columns: table => new
                {
                    menu_id = table.Column<Guid>(type: "uuid", nullable: false),
                    category_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    sort_order = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_menu_sections", x => new { x.menu_id, x.category_id });
                    table.ForeignKey(
                        name: "FK_menu_sections_menus_menu_id",
                        column: x => x.menu_id,
                        principalSchema: "catalog",
                        principalTable: "menus",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "menu_items",
                schema: "catalog",
                columns: table => new
                {
                    menu_id = table.Column<Guid>(type: "uuid", nullable: false),
                    product_id = table.Column<Guid>(type: "uuid", nullable: false),
                    category_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    sort_order = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_menu_items", x => new { x.menu_id, x.product_id });
                    table.ForeignKey(
                        name: "FK_menu_items_menu_sections_menu_id_category_id",
                        columns: x => new { x.menu_id, x.category_id },
                        principalSchema: "catalog",
                        principalTable: "menu_sections",
                        principalColumns: new[] { "menu_id", "category_id" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_menu_items_products_product_id",
                        column: x => x.product_id,
                        principalSchema: "catalog",
                        principalTable: "products",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_menu_audit_firm_id_branch_id_menu_id_occurred_at",
                schema: "catalog",
                table: "menu_audit",
                columns: new[] { "firm_id", "branch_id", "menu_id", "occurred_at" });

            migrationBuilder.CreateIndex(
                name: "IX_menu_items_menu_id_category_id",
                schema: "catalog",
                table: "menu_items",
                columns: new[] { "menu_id", "category_id" });

            migrationBuilder.CreateIndex(
                name: "IX_menu_items_product_id",
                schema: "catalog",
                table: "menu_items",
                column: "product_id");

            migrationBuilder.CreateIndex(
                name: "IX_menus_firm_id_branch_id",
                schema: "catalog",
                table: "menus",
                columns: new[] { "firm_id", "branch_id" },
                unique: true,
                filter: "is_active");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "menu_audit",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "menu_items",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "menu_sections",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "menus",
                schema: "catalog");
        }
    }
}
