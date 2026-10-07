using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Catalog.Migrations
{
    /// <inheritdoc />
    public partial class InitCatalog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "catalog");

            migrationBuilder.CreateTable(
                name: "products",
                schema: "catalog",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    brand_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    name = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    sku = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    category_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    category_name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    channels = table.Column<string[]>(type: "text[]", nullable: false),
                    image = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    recipe_linked = table.Column<bool>(type: "boolean", nullable: false),
                    base_price_minor = table.Column<long>(type: "bigint", nullable: false),
                    currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    description = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    allergens = table.Column<string[]>(type: "text[]", nullable: false),
                    option_groups = table.Column<string[]>(type: "text[]", nullable: false),
                    branch_ids = table.Column<string[]>(type: "text[]", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_products", x => x.id);
                    table.CheckConstraint("ck_base_price_nonnegative", "base_price_minor >= 0");
                    table.CheckConstraint("ck_product_status", "status IN ('draft', 'published')");
                    table.CheckConstraint("ck_product_version_positive", "version > 0");
                });

            migrationBuilder.CreateTable(
                name: "branch_prices",
                schema: "catalog",
                columns: table => new
                {
                    product_id = table.Column<Guid>(type: "uuid", nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    amount_minor = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_branch_prices", x => new { x.product_id, x.branch_id });
                    table.CheckConstraint("ck_branch_price_nonnegative", "amount_minor >= 0");
                    table.ForeignKey(
                        name: "FK_branch_prices_products_product_id",
                        column: x => x.product_id,
                        principalSchema: "catalog",
                        principalTable: "products",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_products_firm_id_category_id",
                schema: "catalog",
                table: "products",
                columns: new[] { "firm_id", "category_id" });

            migrationBuilder.CreateIndex(
                name: "IX_products_firm_id_sku",
                schema: "catalog",
                table: "products",
                columns: new[] { "firm_id", "sku" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "branch_prices",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "products",
                schema: "catalog");
        }
    }
}
