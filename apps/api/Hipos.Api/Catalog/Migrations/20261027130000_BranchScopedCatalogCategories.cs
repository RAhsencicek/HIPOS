using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Catalog.Migrations
{
    /// <inheritdoc />
    public partial class BranchScopedCatalogCategories : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "branch_id",
                schema: "catalog",
                table: "categories",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.Sql("""
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1 FROM catalog.categories c
                        WHERE NOT EXISTS (
                            SELECT 1 FROM catalog.products p
                            WHERE p.firm_id = c.firm_id AND cardinality(p.branch_ids) > 0
                        )
                    ) THEN
                        RAISE EXCEPTION 'Şube kapsamlı kategori dönüşümü durduruldu: kategorisi bulunan firma için şube bilgili ürün bulunamadı.';
                    END IF;
                END $$;

                CREATE TEMP TABLE category_branch_backfill ON COMMIT DROP AS
                SELECT c.firm_id, b.branch_id, c.id, c.brand_id, c.name,
                       c.is_active, c.sort_order, c.version, c.updated_at
                FROM catalog.categories c
                JOIN (
                    SELECT DISTINCT p.firm_id, unnest(p.branch_ids) AS branch_id
                    FROM catalog.products p
                    WHERE cardinality(p.branch_ids) > 0
                ) b ON b.firm_id = c.firm_id;
                """);

            migrationBuilder.DropPrimaryKey(
                name: "PK_categories",
                schema: "catalog",
                table: "categories");

            migrationBuilder.DropIndex(
                name: "IX_categories_firm_id_sort_order",
                schema: "catalog",
                table: "categories");

            migrationBuilder.Sql("""
                DELETE FROM catalog.categories;
                INSERT INTO catalog.categories
                    (firm_id, branch_id, id, brand_id, name, is_active, sort_order, version, updated_at)
                SELECT firm_id, branch_id, id, brand_id, name, is_active, sort_order, version, updated_at
                FROM category_branch_backfill;
                """);

            migrationBuilder.AddColumn<string>(
                name: "branch_id",
                schema: "catalog",
                table: "category_audit",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddPrimaryKey(
                name: "PK_categories",
                schema: "catalog",
                table: "categories",
                columns: new[] { "firm_id", "branch_id", "id" });

            migrationBuilder.CreateIndex(
                name: "IX_categories_firm_id_branch_id_sort_order",
                schema: "catalog",
                table: "categories",
                columns: new[] { "firm_id", "branch_id", "sort_order" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1 FROM catalog.categories
                        GROUP BY firm_id, id
                        HAVING COUNT(DISTINCT (brand_id, name, is_active, sort_order, version, updated_at)) > 1
                    ) THEN
                        RAISE EXCEPTION 'Kategori kapsamı geri alınamadı: şubelerde farklı kategori değerleri var.';
                    END IF;
                END $$;
                """);

            migrationBuilder.DropPrimaryKey(
                name: "PK_categories",
                schema: "catalog",
                table: "categories");

            migrationBuilder.DropIndex(
                name: "IX_categories_firm_id_branch_id_sort_order",
                schema: "catalog",
                table: "categories");

            migrationBuilder.Sql("""
                DELETE FROM catalog.categories keep
                USING catalog.categories duplicate
                WHERE keep.firm_id = duplicate.firm_id AND keep.id = duplicate.id
                  AND keep.branch_id < duplicate.branch_id;
                """);

            migrationBuilder.DropColumn(
                name: "branch_id",
                schema: "catalog",
                table: "category_audit");

            migrationBuilder.DropColumn(
                name: "branch_id",
                schema: "catalog",
                table: "categories");

            migrationBuilder.AddPrimaryKey(
                name: "PK_categories",
                schema: "catalog",
                table: "categories",
                columns: new[] { "firm_id", "id" });

            migrationBuilder.CreateIndex(
                name: "IX_categories_firm_id_sort_order",
                schema: "catalog",
                table: "categories",
                columns: new[] { "firm_id", "sort_order" });
        }
    }
}
