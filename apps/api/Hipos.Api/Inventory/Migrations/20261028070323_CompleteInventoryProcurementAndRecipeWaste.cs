using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Inventory.Migrations
{
    /// <inheritdoc />
    public partial class CompleteInventoryProcurementAndRecipeWaste : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "purchase_order_id",
                schema: "inventory",
                table: "purchases",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "recipe_waste_log_id",
                schema: "inventory",
                table: "movements",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "purchase_orders",
                schema: "inventory",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    warehouse_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    supplier_cari_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    order_number = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    order_date = table.Column<DateOnly>(type: "date", nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    approved_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    approved_by = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    approval_request_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    completed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    completed_by_purchase_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_purchase_orders", x => x.id);
                    table.CheckConstraint("ck_purchase_order_status", "status IN ('draft', 'approved', 'completed')");
                    table.CheckConstraint("ck_purchase_order_version", "version > 0");
                    table.ForeignKey(
                        name: "FK_purchase_orders_warehouses_warehouse_id",
                        column: x => x.warehouse_id,
                        principalSchema: "inventory",
                        principalTable: "warehouses",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "recipe_waste_logs",
                schema: "inventory",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    warehouse_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    product_id = table.Column<Guid>(type: "uuid", nullable: false),
                    product_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    recipe_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    recipe_version = table.Column<int>(type: "integer", nullable: false),
                    portions = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    reason_type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    reported_by = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_recipe_waste_logs", x => x.id);
                    table.CheckConstraint("ck_recipe_waste_portions", "portions > 0");
                    table.CheckConstraint("ck_recipe_waste_reason", "reason_type IN ('spoilage', 'expired', 'spill_breakage', 'burn', 'quality_control')");
                    table.CheckConstraint("ck_recipe_waste_version", "recipe_version > 0");
                    table.ForeignKey(
                        name: "FK_recipe_waste_logs_recipes_recipe_id",
                        column: x => x.recipe_id,
                        principalSchema: "inventory",
                        principalTable: "recipes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_recipe_waste_logs_warehouses_warehouse_id",
                        column: x => x.warehouse_id,
                        principalSchema: "inventory",
                        principalTable: "warehouses",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "purchase_order_lines",
                schema: "inventory",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    purchase_order_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    ingredient_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    quantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    unit = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_purchase_order_lines", x => x.id);
                    table.CheckConstraint("ck_purchase_order_line_quantity", "quantity > 0");
                    table.ForeignKey(
                        name: "FK_purchase_order_lines_ingredients_ingredient_id",
                        column: x => x.ingredient_id,
                        principalSchema: "inventory",
                        principalTable: "ingredients",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_purchase_order_lines_purchase_orders_purchase_order_id",
                        column: x => x.purchase_order_id,
                        principalSchema: "inventory",
                        principalTable: "purchase_orders",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "recipe_waste_lines",
                schema: "inventory",
                columns: table => new
                {
                    recipe_waste_log_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    ingredient_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    quantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    unit = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_recipe_waste_lines", x => new { x.recipe_waste_log_id, x.ingredient_id });
                    table.CheckConstraint("ck_recipe_waste_line_quantity", "quantity > 0");
                    table.ForeignKey(
                        name: "FK_recipe_waste_lines_ingredients_ingredient_id",
                        column: x => x.ingredient_id,
                        principalSchema: "inventory",
                        principalTable: "ingredients",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_recipe_waste_lines_recipe_waste_logs_recipe_waste_log_id",
                        column: x => x.recipe_waste_log_id,
                        principalSchema: "inventory",
                        principalTable: "recipe_waste_logs",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_purchases_purchase_order_id",
                schema: "inventory",
                table: "purchases",
                column: "purchase_order_id",
                unique: true,
                filter: "purchase_order_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_movements_recipe_waste_log_id_ingredient_id",
                schema: "inventory",
                table: "movements",
                columns: new[] { "recipe_waste_log_id", "ingredient_id" },
                unique: true,
                filter: "recipe_waste_log_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_purchase_order_lines_ingredient_id",
                schema: "inventory",
                table: "purchase_order_lines",
                column: "ingredient_id");

            migrationBuilder.CreateIndex(
                name: "IX_purchase_order_lines_purchase_order_id_ingredient_id",
                schema: "inventory",
                table: "purchase_order_lines",
                columns: new[] { "purchase_order_id", "ingredient_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_purchase_orders_approval_request_id",
                schema: "inventory",
                table: "purchase_orders",
                column: "approval_request_id",
                unique: true,
                filter: "approval_request_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_purchase_orders_firm_id_branch_id_order_number",
                schema: "inventory",
                table: "purchase_orders",
                columns: new[] { "firm_id", "branch_id", "order_number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_purchase_orders_warehouse_id",
                schema: "inventory",
                table: "purchase_orders",
                column: "warehouse_id");

            migrationBuilder.CreateIndex(
                name: "IX_recipe_waste_lines_ingredient_id",
                schema: "inventory",
                table: "recipe_waste_lines",
                column: "ingredient_id");

            migrationBuilder.CreateIndex(
                name: "IX_recipe_waste_logs_firm_id_branch_id_warehouse_id_created_at",
                schema: "inventory",
                table: "recipe_waste_logs",
                columns: new[] { "firm_id", "branch_id", "warehouse_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_recipe_waste_logs_recipe_id",
                schema: "inventory",
                table: "recipe_waste_logs",
                column: "recipe_id");

            migrationBuilder.CreateIndex(
                name: "IX_recipe_waste_logs_warehouse_id",
                schema: "inventory",
                table: "recipe_waste_logs",
                column: "warehouse_id");

            migrationBuilder.AddForeignKey(
                name: "FK_movements_recipe_waste_logs_recipe_waste_log_id",
                schema: "inventory",
                table: "movements",
                column: "recipe_waste_log_id",
                principalSchema: "inventory",
                principalTable: "recipe_waste_logs",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_purchases_purchase_orders_purchase_order_id",
                schema: "inventory",
                table: "purchases",
                column: "purchase_order_id",
                principalSchema: "inventory",
                principalTable: "purchase_orders",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_movements_recipe_waste_logs_recipe_waste_log_id",
                schema: "inventory",
                table: "movements");

            migrationBuilder.DropForeignKey(
                name: "FK_purchases_purchase_orders_purchase_order_id",
                schema: "inventory",
                table: "purchases");

            migrationBuilder.DropTable(
                name: "purchase_order_lines",
                schema: "inventory");

            migrationBuilder.DropTable(
                name: "recipe_waste_lines",
                schema: "inventory");

            migrationBuilder.DropTable(
                name: "purchase_orders",
                schema: "inventory");

            migrationBuilder.DropTable(
                name: "recipe_waste_logs",
                schema: "inventory");

            migrationBuilder.DropIndex(
                name: "IX_purchases_purchase_order_id",
                schema: "inventory",
                table: "purchases");

            migrationBuilder.DropIndex(
                name: "IX_movements_recipe_waste_log_id_ingredient_id",
                schema: "inventory",
                table: "movements");

            migrationBuilder.DropColumn(
                name: "purchase_order_id",
                schema: "inventory",
                table: "purchases");

            migrationBuilder.DropColumn(
                name: "recipe_waste_log_id",
                schema: "inventory",
                table: "movements");
        }
    }
}
