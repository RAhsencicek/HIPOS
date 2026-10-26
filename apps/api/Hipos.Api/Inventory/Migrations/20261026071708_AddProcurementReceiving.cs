using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Inventory.Migrations
{
    /// <inheritdoc />
    public partial class AddProcurementReceiving : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_inventory_movement_kind",
                schema: "inventory",
                table: "movements");

            migrationBuilder.AddColumn<string>(
                name: "purchase_id",
                schema: "inventory",
                table: "movements",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "purchases",
                schema: "inventory",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    warehouse_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    supplier_cari_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    document_number = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    document_date = table.Column<DateOnly>(type: "date", nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    subtotal_minor = table.Column<long>(type: "bigint", nullable: false),
                    discount_minor = table.Column<long>(type: "bigint", nullable: false),
                    tax_minor = table.Column<long>(type: "bigint", nullable: false),
                    total_minor = table.Column<long>(type: "bigint", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    approved_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    approved_by = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    approval_request_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_purchases", x => x.id);
                    table.CheckConstraint("ck_purchase_currency", "currency = 'TRY'");
                    table.CheckConstraint("ck_purchase_status", "status IN ('draft', 'approved')");
                    table.CheckConstraint("ck_purchase_totals", "subtotal_minor >= 0 AND discount_minor >= 0 AND tax_minor >= 0 AND total_minor > 0");
                    table.CheckConstraint("ck_purchase_version", "version > 0");
                    table.ForeignKey(
                        name: "FK_purchases_warehouses_warehouse_id",
                        column: x => x.warehouse_id,
                        principalSchema: "inventory",
                        principalTable: "warehouses",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "purchase_lines",
                schema: "inventory",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    purchase_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    ingredient_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    quantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    unit = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    unit_price_minor = table.Column<long>(type: "bigint", nullable: false),
                    discount_rate_bps = table.Column<int>(type: "integer", nullable: false),
                    tax_rate_bps = table.Column<int>(type: "integer", nullable: false),
                    subtotal_minor = table.Column<long>(type: "bigint", nullable: false),
                    discount_minor = table.Column<long>(type: "bigint", nullable: false),
                    net_minor = table.Column<long>(type: "bigint", nullable: false),
                    tax_minor = table.Column<long>(type: "bigint", nullable: false),
                    total_minor = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_purchase_lines", x => x.id);
                    table.CheckConstraint("ck_purchase_line_price", "unit_price_minor > 0");
                    table.CheckConstraint("ck_purchase_line_quantity", "quantity > 0");
                    table.CheckConstraint("ck_purchase_line_rates", "discount_rate_bps BETWEEN 0 AND 10000 AND tax_rate_bps BETWEEN 0 AND 10000");
                    table.ForeignKey(
                        name: "FK_purchase_lines_ingredients_ingredient_id",
                        column: x => x.ingredient_id,
                        principalSchema: "inventory",
                        principalTable: "ingredients",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_purchase_lines_purchases_purchase_id",
                        column: x => x.purchase_id,
                        principalSchema: "inventory",
                        principalTable: "purchases",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_movements_purchase_id_ingredient_id",
                schema: "inventory",
                table: "movements",
                columns: new[] { "purchase_id", "ingredient_id" },
                unique: true,
                filter: "purchase_id IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "ck_inventory_movement_kind",
                schema: "inventory",
                table: "movements",
                sql: "kind IN ('opening', 'manual_in', 'manual_out', 'count_adjustment', 'receiving')");

            migrationBuilder.CreateIndex(
                name: "IX_purchase_lines_ingredient_id",
                schema: "inventory",
                table: "purchase_lines",
                column: "ingredient_id");

            migrationBuilder.CreateIndex(
                name: "IX_purchase_lines_purchase_id_ingredient_id",
                schema: "inventory",
                table: "purchase_lines",
                columns: new[] { "purchase_id", "ingredient_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_purchases_approval_request_id",
                schema: "inventory",
                table: "purchases",
                column: "approval_request_id",
                unique: true,
                filter: "approval_request_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_purchases_firm_id_branch_id_document_number",
                schema: "inventory",
                table: "purchases",
                columns: new[] { "firm_id", "branch_id", "document_number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_purchases_warehouse_id",
                schema: "inventory",
                table: "purchases",
                column: "warehouse_id");

            migrationBuilder.AddForeignKey(
                name: "FK_movements_purchases_purchase_id",
                schema: "inventory",
                table: "movements",
                column: "purchase_id",
                principalSchema: "inventory",
                principalTable: "purchases",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_movements_purchases_purchase_id",
                schema: "inventory",
                table: "movements");

            migrationBuilder.DropTable(
                name: "purchase_lines",
                schema: "inventory");

            migrationBuilder.DropTable(
                name: "purchases",
                schema: "inventory");

            migrationBuilder.DropIndex(
                name: "IX_movements_purchase_id_ingredient_id",
                schema: "inventory",
                table: "movements");

            migrationBuilder.DropCheckConstraint(
                name: "ck_inventory_movement_kind",
                schema: "inventory",
                table: "movements");

            migrationBuilder.DropColumn(
                name: "purchase_id",
                schema: "inventory",
                table: "movements");

            migrationBuilder.AddCheckConstraint(
                name: "ck_inventory_movement_kind",
                schema: "inventory",
                table: "movements",
                sql: "kind IN ('opening', 'manual_in', 'manual_out', 'count_adjustment')");
        }
    }
}
