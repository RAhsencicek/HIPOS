using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Catalog.Migrations
{
    /// <inheritdoc />
    public partial class AddCatalogCategories : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "categories",
                schema: "catalog",
                columns: table => new
                {
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    brand_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    sort_order = table.Column<int>(type: "integer", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_categories", x => new { x.firm_id, x.id });
                    table.CheckConstraint("ck_category_version_positive", "version > 0");
                });

            migrationBuilder.CreateIndex(
                name: "IX_categories_firm_id_sort_order",
                schema: "catalog",
                table: "categories",
                columns: new[] { "firm_id", "sort_order" });

            // Eski ürünlerde aynı firma/kategori kodu farklı adlarla kullanılıyorsa sessizce ad seçme.
            migrationBuilder.Sql("""
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1 FROM catalog.products
                        GROUP BY firm_id, category_id
                        HAVING COUNT(DISTINCT category_name) > 1
                    ) OR EXISTS (
                        SELECT 1 FROM catalog.products
                        WHERE btrim(category_id) = '' OR btrim(category_name) = ''
                    ) THEN
                        RAISE EXCEPTION 'Kategori taşıması durduruldu: firma/kategori kodu için çelişkili veya boş ad var.';
                    END IF;
                END $$;
                """);
            migrationBuilder.Sql("""
                INSERT INTO catalog.categories
                    (firm_id, id, brand_id, name, is_active, sort_order, version, updated_at)
                SELECT firm_id, category_id, NULL, MAX(category_name), TRUE, 0, 1, NOW()
                FROM catalog.products
                GROUP BY firm_id, category_id;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "categories",
                schema: "catalog");
        }
    }
}
