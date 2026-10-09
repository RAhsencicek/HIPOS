using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Hipos.Api.Inventory.Migrations
{
    /// <inheritdoc />
    public partial class InitInventory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "inventory");

            migrationBuilder.CreateTable(
                name: "audit",
                schema: "inventory",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    entity_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    action = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    actor = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    detail = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    occurred_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_audit", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "counts",
                schema: "inventory",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    approved_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    approved_by = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    approval_request_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_counts", x => x.id);
                    table.CheckConstraint("ck_inventory_count_status", "status IN ('draft', 'approved')");
                    table.CheckConstraint("ck_inventory_count_version", "version > 0");
                });

            migrationBuilder.CreateTable(
                name: "ingredients",
                schema: "inventory",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    name_key = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    unit = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    critical_below = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ingredients", x => x.id);
                    table.CheckConstraint("ck_ingredient_threshold", "critical_below >= 0");
                    table.CheckConstraint("ck_ingredient_version", "version > 0");
                });

            migrationBuilder.CreateTable(
                name: "recipes",
                schema: "inventory",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    product_id = table.Column<Guid>(type: "uuid", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    portion = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_recipes", x => x.id);
                    table.CheckConstraint("ck_recipe_version", "version > 0");
                    table.ForeignKey(
                        name: "FK_recipes_products_product_id",
                        column: x => x.product_id,
                        principalSchema: "catalog",
                        principalTable: "products",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "count_lines",
                schema: "inventory",
                columns: table => new
                {
                    count_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    ingredient_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    system_quantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    physical_quantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_count_lines", x => new { x.count_id, x.ingredient_id });
                    table.CheckConstraint("ck_count_physical_quantity", "physical_quantity IS NULL OR physical_quantity >= 0");
                    table.CheckConstraint("ck_count_system_quantity", "system_quantity >= 0");
                    table.ForeignKey(
                        name: "FK_count_lines_counts_count_id",
                        column: x => x.count_id,
                        principalSchema: "inventory",
                        principalTable: "counts",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_count_lines_ingredients_ingredient_id",
                        column: x => x.ingredient_id,
                        principalSchema: "inventory",
                        principalTable: "ingredients",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "movements",
                schema: "inventory",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ingredient_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    delta = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    kind = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    count_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    actor = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_movements", x => x.id);
                    table.CheckConstraint("ck_inventory_movement_kind", "kind IN ('opening', 'manual_in', 'manual_out', 'count_adjustment')");
                    table.CheckConstraint("ck_inventory_movement_nonzero", "delta <> 0");
                    table.ForeignKey(
                        name: "FK_movements_counts_count_id",
                        column: x => x.count_id,
                        principalSchema: "inventory",
                        principalTable: "counts",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_movements_ingredients_ingredient_id",
                        column: x => x.ingredient_id,
                        principalSchema: "inventory",
                        principalTable: "ingredients",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "recipe_lines",
                schema: "inventory",
                columns: table => new
                {
                    recipe_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    ingredient_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    quantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_recipe_lines", x => new { x.recipe_id, x.ingredient_id });
                    table.CheckConstraint("ck_recipe_line_quantity", "quantity > 0");
                    table.ForeignKey(
                        name: "FK_recipe_lines_ingredients_ingredient_id",
                        column: x => x.ingredient_id,
                        principalSchema: "inventory",
                        principalTable: "ingredients",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_recipe_lines_recipes_recipe_id",
                        column: x => x.recipe_id,
                        principalSchema: "inventory",
                        principalTable: "recipes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_audit_firm_id_branch_id_entity_id_occurred_at",
                schema: "inventory",
                table: "audit",
                columns: new[] { "firm_id", "branch_id", "entity_id", "occurred_at" });

            migrationBuilder.CreateIndex(
                name: "IX_count_lines_ingredient_id",
                schema: "inventory",
                table: "count_lines",
                column: "ingredient_id");

            migrationBuilder.CreateIndex(
                name: "IX_counts_firm_id_branch_id_created_at",
                schema: "inventory",
                table: "counts",
                columns: new[] { "firm_id", "branch_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_ingredients_firm_id_branch_id_name_key",
                schema: "inventory",
                table: "ingredients",
                columns: new[] { "firm_id", "branch_id", "name_key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_movements_count_id_ingredient_id",
                schema: "inventory",
                table: "movements",
                columns: new[] { "count_id", "ingredient_id" },
                unique: true,
                filter: "count_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_movements_firm_id_branch_id_ingredient_id_created_at",
                schema: "inventory",
                table: "movements",
                columns: new[] { "firm_id", "branch_id", "ingredient_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_movements_ingredient_id",
                schema: "inventory",
                table: "movements",
                column: "ingredient_id");

            migrationBuilder.CreateIndex(
                name: "IX_recipe_lines_ingredient_id",
                schema: "inventory",
                table: "recipe_lines",
                column: "ingredient_id");

            migrationBuilder.CreateIndex(
                name: "IX_recipes_firm_id_branch_id_product_id_version",
                schema: "inventory",
                table: "recipes",
                columns: new[] { "firm_id", "branch_id", "product_id", "version" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_recipes_product_id",
                schema: "inventory",
                table: "recipes",
                column: "product_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "audit",
                schema: "inventory");

            migrationBuilder.DropTable(
                name: "count_lines",
                schema: "inventory");

            migrationBuilder.DropTable(
                name: "movements",
                schema: "inventory");

            migrationBuilder.DropTable(
                name: "recipe_lines",
                schema: "inventory");

            migrationBuilder.DropTable(
                name: "counts",
                schema: "inventory");

            migrationBuilder.DropTable(
                name: "ingredients",
                schema: "inventory");

            migrationBuilder.DropTable(
                name: "recipes",
                schema: "inventory");
        }
    }
}
