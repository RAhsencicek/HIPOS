using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Inventory.Migrations
{
    /// <inheritdoc />
    public partial class AddInventoryWasteLogs : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_inventory_movement_kind",
                schema: "inventory",
                table: "movements");

            migrationBuilder.AddColumn<string>(
                name: "waste_log_id",
                schema: "inventory",
                table: "movements",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "waste_logs",
                schema: "inventory",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    warehouse_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    ingredient_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    quantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    unit = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    reason_type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    reported_by = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_waste_logs", x => x.id);
                    table.CheckConstraint("ck_waste_log_quantity", "quantity > 0");
                    table.CheckConstraint("ck_waste_log_reason", "reason_type IN ('spoilage', 'expired', 'spill_breakage', 'burn', 'quality_control')");
                    table.ForeignKey(
                        name: "FK_waste_logs_ingredients_ingredient_id",
                        column: x => x.ingredient_id,
                        principalSchema: "inventory",
                        principalTable: "ingredients",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_waste_logs_warehouses_warehouse_id",
                        column: x => x.warehouse_id,
                        principalSchema: "inventory",
                        principalTable: "warehouses",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_movements_waste_log_id",
                schema: "inventory",
                table: "movements",
                column: "waste_log_id",
                unique: true,
                filter: "waste_log_id IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "ck_inventory_movement_kind",
                schema: "inventory",
                table: "movements",
                sql: "kind IN ('opening', 'manual_in', 'manual_out', 'count_adjustment', 'receiving', 'purchase_correction', 'supplier_return', 'waste_loss')");

            migrationBuilder.CreateIndex(
                name: "IX_waste_logs_firm_id_branch_id_warehouse_id_created_at",
                schema: "inventory",
                table: "waste_logs",
                columns: new[] { "firm_id", "branch_id", "warehouse_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_waste_logs_ingredient_id",
                schema: "inventory",
                table: "waste_logs",
                column: "ingredient_id");

            migrationBuilder.CreateIndex(
                name: "IX_waste_logs_warehouse_id",
                schema: "inventory",
                table: "waste_logs",
                column: "warehouse_id");

            migrationBuilder.AddForeignKey(
                name: "FK_movements_waste_logs_waste_log_id",
                schema: "inventory",
                table: "movements",
                column: "waste_log_id",
                principalSchema: "inventory",
                principalTable: "waste_logs",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_movements_waste_logs_waste_log_id",
                schema: "inventory",
                table: "movements");

            migrationBuilder.DropTable(
                name: "waste_logs",
                schema: "inventory");

            migrationBuilder.DropIndex(
                name: "IX_movements_waste_log_id",
                schema: "inventory",
                table: "movements");

            migrationBuilder.DropCheckConstraint(
                name: "ck_inventory_movement_kind",
                schema: "inventory",
                table: "movements");

            migrationBuilder.DropColumn(
                name: "waste_log_id",
                schema: "inventory",
                table: "movements");

            migrationBuilder.AddCheckConstraint(
                name: "ck_inventory_movement_kind",
                schema: "inventory",
                table: "movements",
                sql: "kind IN ('opening', 'manual_in', 'manual_out', 'count_adjustment', 'receiving', 'purchase_correction', 'supplier_return')");
        }
    }
}
