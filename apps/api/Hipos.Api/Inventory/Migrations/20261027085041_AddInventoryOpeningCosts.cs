using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Inventory.Migrations
{
    /// <inheritdoc />
    public partial class AddInventoryOpeningCosts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "opening_costs",
                schema: "inventory",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    warehouse_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    ingredient_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    quantity_snapshot = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    unit = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    unit_cost_minor = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    total_cost_minor = table.Column<long>(type: "bigint", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_opening_costs", x => x.id);
                    table.CheckConstraint("ck_opening_cost_quantity", "quantity_snapshot > 0");
                    table.CheckConstraint("ck_opening_cost_unit_cost", "unit_cost_minor > 0 AND total_cost_minor > 0");
                    table.ForeignKey(
                        name: "FK_opening_costs_ingredients_ingredient_id",
                        column: x => x.ingredient_id,
                        principalSchema: "inventory",
                        principalTable: "ingredients",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_opening_costs_warehouses_warehouse_id",
                        column: x => x.warehouse_id,
                        principalSchema: "inventory",
                        principalTable: "warehouses",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_opening_costs_firm_id_branch_id_warehouse_id_ingredient_id",
                schema: "inventory",
                table: "opening_costs",
                columns: new[] { "firm_id", "branch_id", "warehouse_id", "ingredient_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_opening_costs_ingredient_id",
                schema: "inventory",
                table: "opening_costs",
                column: "ingredient_id");

            migrationBuilder.CreateIndex(
                name: "IX_opening_costs_warehouse_id",
                schema: "inventory",
                table: "opening_costs",
                column: "warehouse_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "opening_costs",
                schema: "inventory");
        }
    }
}
