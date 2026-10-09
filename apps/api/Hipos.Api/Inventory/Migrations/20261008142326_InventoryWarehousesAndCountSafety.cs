using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Inventory.Migrations
{
    /// <inheritdoc />
    public partial class InventoryWarehousesAndCountSafety : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_movements_firm_id_branch_id_ingredient_id_created_at",
                schema: "inventory",
                table: "movements");

            migrationBuilder.DropIndex(
                name: "IX_counts_firm_id_branch_id_created_at",
                schema: "inventory",
                table: "counts");

            migrationBuilder.DropCheckConstraint(
                name: "ck_inventory_count_status",
                schema: "inventory",
                table: "counts");

            migrationBuilder.AddColumn<string>(
                name: "unit",
                schema: "inventory",
                table: "recipe_lines",
                type: "character varying(12)",
                maxLength: 12,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "unit",
                schema: "inventory",
                table: "movements",
                type: "character varying(12)",
                maxLength: 12,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "warehouse_id",
                schema: "inventory",
                table: "movements",
                type: "character varying(80)",
                maxLength: 80,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "cancellation_request_id",
                schema: "inventory",
                table: "counts",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "cancelled_at",
                schema: "inventory",
                table: "counts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "cancelled_by",
                schema: "inventory",
                table: "counts",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "warehouse_id",
                schema: "inventory",
                table: "counts",
                type: "character varying(80)",
                maxLength: 80,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "unit",
                schema: "inventory",
                table: "count_lines",
                type: "character varying(12)",
                maxLength: 12,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "request_id",
                schema: "inventory",
                table: "audit",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "warehouse_id",
                schema: "inventory",
                table: "audit",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "warehouses",
                schema: "inventory",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_warehouses", x => x.id);
                    table.CheckConstraint("ck_inventory_warehouse_name", "length(btrim(name)) BETWEEN 2 AND 160");
                    table.CheckConstraint("ck_inventory_warehouse_version", "version > 0");
                });

            migrationBuilder.Sql("""
                WITH scopes AS (
                    SELECT firm_id, branch_id FROM inventory.ingredients
                    UNION SELECT firm_id, branch_id FROM inventory.movements
                    UNION SELECT firm_id, branch_id FROM inventory.counts
                )
                INSERT INTO inventory.warehouses (id, firm_id, branch_id, name, is_active, version, created_at, updated_at)
                SELECT CASE WHEN firm_id = '11111111-1111-4111-8111-111111111111'
                                  AND branch_id = '33333333-3333-4333-8333-333333333333'
                            THEN 'warehouse-kadikoy-main'
                            ELSE 'warehouse-' || replace(branch_id, '-', '') END,
                       firm_id, branch_id,
                       CASE WHEN firm_id = '11111111-1111-4111-8111-111111111111'
                                  AND branch_id = '33333333-3333-4333-8333-333333333333'
                            THEN 'Kadıköy Ana Depo' ELSE 'Ana Depo' END,
                       true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                FROM scopes
                ON CONFLICT (id) DO NOTHING;

                UPDATE inventory.movements AS movement
                SET warehouse_id = warehouse.id, unit = ingredient.unit
                FROM inventory.warehouses AS warehouse, inventory.ingredients AS ingredient
                WHERE warehouse.firm_id = movement.firm_id AND warehouse.branch_id = movement.branch_id
                  AND ingredient.id = movement.ingredient_id;

                UPDATE inventory.counts AS count
                SET warehouse_id = warehouse.id
                FROM inventory.warehouses AS warehouse
                WHERE warehouse.firm_id = count.firm_id AND warehouse.branch_id = count.branch_id;

                UPDATE inventory.count_lines AS line
                SET unit = ingredient.unit
                FROM inventory.ingredients AS ingredient
                WHERE ingredient.id = line.ingredient_id;

                UPDATE inventory.recipe_lines AS line
                SET unit = ingredient.unit
                FROM inventory.ingredients AS ingredient
                WHERE ingredient.id = line.ingredient_id;

                UPDATE inventory.audit AS audit
                SET warehouse_id = movement.warehouse_id
                FROM inventory.movements AS movement
                WHERE audit.entity_id = movement.id;

                UPDATE inventory.audit AS audit
                SET warehouse_id = count.warehouse_id
                FROM inventory.counts AS count
                WHERE audit.entity_id = count.id;
                """);

            migrationBuilder.CreateIndex(
                name: "IX_movements_firm_id_branch_id_warehouse_id_ingredient_id_crea~",
                schema: "inventory",
                table: "movements",
                columns: new[] { "firm_id", "branch_id", "warehouse_id", "ingredient_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_movements_warehouse_id",
                schema: "inventory",
                table: "movements",
                column: "warehouse_id");

            migrationBuilder.CreateIndex(
                name: "IX_counts_firm_id_branch_id_warehouse_id",
                schema: "inventory",
                table: "counts",
                columns: new[] { "firm_id", "branch_id", "warehouse_id" },
                unique: true,
                filter: "status = 'draft'");

            migrationBuilder.CreateIndex(
                name: "IX_counts_firm_id_branch_id_warehouse_id_created_at",
                schema: "inventory",
                table: "counts",
                columns: new[] { "firm_id", "branch_id", "warehouse_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_counts_warehouse_id",
                schema: "inventory",
                table: "counts",
                column: "warehouse_id");

            migrationBuilder.AddCheckConstraint(
                name: "ck_inventory_count_status",
                schema: "inventory",
                table: "counts",
                sql: "status IN ('draft', 'approved', 'cancelled')");

            migrationBuilder.CreateIndex(
                name: "IX_audit_firm_id_branch_id_request_id",
                schema: "inventory",
                table: "audit",
                columns: new[] { "firm_id", "branch_id", "request_id" },
                unique: true,
                filter: "request_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_audit_warehouse_id",
                schema: "inventory",
                table: "audit",
                column: "warehouse_id");

            migrationBuilder.CreateIndex(
                name: "IX_warehouses_firm_id_branch_id_name",
                schema: "inventory",
                table: "warehouses",
                columns: new[] { "firm_id", "branch_id", "name" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_audit_warehouses_warehouse_id",
                schema: "inventory",
                table: "audit",
                column: "warehouse_id",
                principalSchema: "inventory",
                principalTable: "warehouses",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_counts_warehouses_warehouse_id",
                schema: "inventory",
                table: "counts",
                column: "warehouse_id",
                principalSchema: "inventory",
                principalTable: "warehouses",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_movements_warehouses_warehouse_id",
                schema: "inventory",
                table: "movements",
                column: "warehouse_id",
                principalSchema: "inventory",
                principalTable: "warehouses",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_audit_warehouses_warehouse_id",
                schema: "inventory",
                table: "audit");

            migrationBuilder.DropForeignKey(
                name: "FK_counts_warehouses_warehouse_id",
                schema: "inventory",
                table: "counts");

            migrationBuilder.DropForeignKey(
                name: "FK_movements_warehouses_warehouse_id",
                schema: "inventory",
                table: "movements");

            migrationBuilder.DropTable(
                name: "warehouses",
                schema: "inventory");

            migrationBuilder.DropIndex(
                name: "IX_movements_firm_id_branch_id_warehouse_id_ingredient_id_crea~",
                schema: "inventory",
                table: "movements");

            migrationBuilder.DropIndex(
                name: "IX_movements_warehouse_id",
                schema: "inventory",
                table: "movements");

            migrationBuilder.DropIndex(
                name: "IX_counts_firm_id_branch_id_warehouse_id",
                schema: "inventory",
                table: "counts");

            migrationBuilder.DropIndex(
                name: "IX_counts_firm_id_branch_id_warehouse_id_created_at",
                schema: "inventory",
                table: "counts");

            migrationBuilder.DropIndex(
                name: "IX_counts_warehouse_id",
                schema: "inventory",
                table: "counts");

            migrationBuilder.DropCheckConstraint(
                name: "ck_inventory_count_status",
                schema: "inventory",
                table: "counts");

            migrationBuilder.DropIndex(
                name: "IX_audit_firm_id_branch_id_request_id",
                schema: "inventory",
                table: "audit");

            migrationBuilder.DropIndex(
                name: "IX_audit_warehouse_id",
                schema: "inventory",
                table: "audit");

            migrationBuilder.DropColumn(
                name: "unit",
                schema: "inventory",
                table: "recipe_lines");

            migrationBuilder.DropColumn(
                name: "unit",
                schema: "inventory",
                table: "movements");

            migrationBuilder.DropColumn(
                name: "warehouse_id",
                schema: "inventory",
                table: "movements");

            migrationBuilder.DropColumn(
                name: "cancellation_request_id",
                schema: "inventory",
                table: "counts");

            migrationBuilder.DropColumn(
                name: "cancelled_at",
                schema: "inventory",
                table: "counts");

            migrationBuilder.DropColumn(
                name: "cancelled_by",
                schema: "inventory",
                table: "counts");

            migrationBuilder.DropColumn(
                name: "warehouse_id",
                schema: "inventory",
                table: "counts");

            migrationBuilder.DropColumn(
                name: "unit",
                schema: "inventory",
                table: "count_lines");

            migrationBuilder.DropColumn(
                name: "request_id",
                schema: "inventory",
                table: "audit");

            migrationBuilder.DropColumn(
                name: "warehouse_id",
                schema: "inventory",
                table: "audit");

            migrationBuilder.CreateIndex(
                name: "IX_movements_firm_id_branch_id_ingredient_id_created_at",
                schema: "inventory",
                table: "movements",
                columns: new[] { "firm_id", "branch_id", "ingredient_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_counts_firm_id_branch_id_created_at",
                schema: "inventory",
                table: "counts",
                columns: new[] { "firm_id", "branch_id", "created_at" });

            migrationBuilder.AddCheckConstraint(
                name: "ck_inventory_count_status",
                schema: "inventory",
                table: "counts",
                sql: "status IN ('draft', 'approved')");
        }
    }
}
