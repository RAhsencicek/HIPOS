using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Catalog.Migrations
{
    /// <inheritdoc />
    public partial class AddCatalogProductOptions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "option_groups",
                schema: "catalog",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    sort_order = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_option_groups", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "option_items",
                schema: "catalog",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    group_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    price_delta_minor = table.Column<long>(type: "bigint", nullable: false),
                    quantity_enabled = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    max_quantity = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    is_active = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    sort_order = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_option_items", x => x.id);
                    table.CheckConstraint("ck_option_item_max_quantity_positive", "max_quantity >= 1");
                    table.CheckConstraint("ck_option_item_quantity_disabled_max_one", "quantity_enabled OR max_quantity = 1");
                    table.ForeignKey(
                        name: "FK_option_items_option_groups_group_id",
                        column: x => x.group_id,
                        principalSchema: "catalog",
                        principalTable: "option_groups",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "product_option_groups",
                schema: "catalog",
                columns: table => new
                {
                    product_id = table.Column<Guid>(type: "uuid", nullable: false),
                    option_group_id = table.Column<Guid>(type: "uuid", nullable: false),
                    min_selections = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    max_selections = table.Column<int>(type: "integer", nullable: true),
                    sort_order = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_product_option_groups", x => new { x.product_id, x.option_group_id });
                    table.CheckConstraint("ck_product_option_group_max_selections_valid", "max_selections IS NULL OR max_selections >= min_selections");
                    table.CheckConstraint("ck_product_option_group_min_selections_nonnegative", "min_selections >= 0");
                    table.ForeignKey(
                        name: "FK_product_option_groups_option_groups_option_group_id",
                        column: x => x.option_group_id,
                        principalSchema: "catalog",
                        principalTable: "option_groups",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_product_option_groups_products_product_id",
                        column: x => x.product_id,
                        principalSchema: "catalog",
                        principalTable: "products",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_option_groups_firm_id_sort_order",
                schema: "catalog",
                table: "option_groups",
                columns: new[] { "firm_id", "sort_order" });

            migrationBuilder.CreateIndex(
                name: "IX_option_items_group_id_sort_order",
                schema: "catalog",
                table: "option_items",
                columns: new[] { "group_id", "sort_order" });

            migrationBuilder.CreateIndex(
                name: "IX_product_option_groups_option_group_id",
                schema: "catalog",
                table: "product_option_groups",
                column: "option_group_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "option_items",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "product_option_groups",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "option_groups",
                schema: "catalog");
        }
    }
}
