using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Inventory.Migrations
{
    /// <inheritdoc />
    public partial class AddPurchaseDeliveryCorrections : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_inventory_movement_kind",
                schema: "inventory",
                table: "movements");

            migrationBuilder.AddColumn<string>(
                name: "purchase_correction_id",
                schema: "inventory",
                table: "movements",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "purchase_corrections",
                schema: "inventory",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    purchase_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    purchase_line_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    quantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    unit = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    subtotal_minor = table.Column<long>(type: "bigint", nullable: false),
                    discount_minor = table.Column<long>(type: "bigint", nullable: false),
                    net_minor = table.Column<long>(type: "bigint", nullable: false),
                    tax_minor = table.Column<long>(type: "bigint", nullable: false),
                    total_minor = table.Column<long>(type: "bigint", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_purchase_corrections", x => x.id);
                    table.CheckConstraint("ck_purchase_correction_quantity", "quantity > 0");
                    table.CheckConstraint("ck_purchase_correction_totals", "subtotal_minor >= 0 AND discount_minor >= 0 AND tax_minor >= 0 AND total_minor > 0");
                    table.ForeignKey(
                        name: "FK_purchase_corrections_purchase_lines_purchase_line_id",
                        column: x => x.purchase_line_id,
                        principalSchema: "inventory",
                        principalTable: "purchase_lines",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_purchase_corrections_purchases_purchase_id",
                        column: x => x.purchase_id,
                        principalSchema: "inventory",
                        principalTable: "purchases",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_movements_purchase_correction_id",
                schema: "inventory",
                table: "movements",
                column: "purchase_correction_id",
                unique: true,
                filter: "purchase_correction_id IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "ck_inventory_movement_kind",
                schema: "inventory",
                table: "movements",
                sql: "kind IN ('opening', 'manual_in', 'manual_out', 'count_adjustment', 'receiving', 'purchase_correction')");

            migrationBuilder.CreateIndex(
                name: "IX_purchase_corrections_purchase_id_purchase_line_id_created_at",
                schema: "inventory",
                table: "purchase_corrections",
                columns: new[] { "purchase_id", "purchase_line_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_purchase_corrections_purchase_line_id",
                schema: "inventory",
                table: "purchase_corrections",
                column: "purchase_line_id");

            migrationBuilder.AddForeignKey(
                name: "FK_movements_purchase_corrections_purchase_correction_id",
                schema: "inventory",
                table: "movements",
                column: "purchase_correction_id",
                principalSchema: "inventory",
                principalTable: "purchase_corrections",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_movements_purchase_corrections_purchase_correction_id",
                schema: "inventory",
                table: "movements");

            migrationBuilder.DropTable(
                name: "purchase_corrections",
                schema: "inventory");

            migrationBuilder.DropIndex(
                name: "IX_movements_purchase_correction_id",
                schema: "inventory",
                table: "movements");

            migrationBuilder.DropCheckConstraint(
                name: "ck_inventory_movement_kind",
                schema: "inventory",
                table: "movements");

            migrationBuilder.DropColumn(
                name: "purchase_correction_id",
                schema: "inventory",
                table: "movements");

            migrationBuilder.AddCheckConstraint(
                name: "ck_inventory_movement_kind",
                schema: "inventory",
                table: "movements",
                sql: "kind IN ('opening', 'manual_in', 'manual_out', 'count_adjustment', 'receiving')");
        }
    }
}
