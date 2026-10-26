using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Sales.Migrations
{
    /// <inheritdoc />
    public partial class AddCheckAdjustments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "check_adjustments",
                schema: "sales",
                columns: table => new
                {
                    request_id = table.Column<Guid>(type: "uuid", nullable: false),
                    check_id = table.Column<Guid>(type: "uuid", nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    order_id = table.Column<Guid>(type: "uuid", nullable: true),
                    order_line_id = table.Column<long>(type: "bigint", nullable: true),
                    action = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    value_type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    value = table.Column<int>(type: "integer", nullable: true),
                    quantity = table.Column<int>(type: "integer", nullable: false),
                    amount_minor = table.Column<long>(type: "bigint", nullable: false),
                    reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    actor = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    approval_mode = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    fingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_check_adjustments", x => x.request_id);
                    table.CheckConstraint("ck_check_adjustment_action", "action IN ('discount','comp','void')");
                    table.CheckConstraint("ck_check_adjustment_amount", "amount_minor > 0");
                    table.CheckConstraint("ck_check_adjustment_quantity", "quantity >= 0");
                    table.CheckConstraint("ck_check_adjustment_scope", "(action = 'discount' AND order_id IS NULL AND order_line_id IS NULL AND value_type IS NOT NULL AND value IS NOT NULL AND quantity = 0) OR (action IN ('comp','void') AND order_id IS NOT NULL AND order_line_id IS NOT NULL AND quantity > 0 AND value_type IS NULL AND value IS NULL)");
                    table.ForeignKey(
                        name: "FK_check_adjustments_checks_check_id",
                        column: x => x.check_id,
                        principalSchema: "sales",
                        principalTable: "checks",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_check_adjustments_order_lines_order_line_id",
                        column: x => x.order_line_id,
                        principalSchema: "sales",
                        principalTable: "order_lines",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_check_adjustments_orders_order_id",
                        column: x => x.order_id,
                        principalSchema: "sales",
                        principalTable: "orders",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_check_adjustments_check_id",
                schema: "sales",
                table: "check_adjustments",
                column: "check_id");

            migrationBuilder.CreateIndex(
                name: "IX_check_adjustments_firm_id_branch_id_check_id_created_at",
                schema: "sales",
                table: "check_adjustments",
                columns: new[] { "firm_id", "branch_id", "check_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_check_adjustments_firm_id_branch_id_order_line_id",
                schema: "sales",
                table: "check_adjustments",
                columns: new[] { "firm_id", "branch_id", "order_line_id" });

            migrationBuilder.CreateIndex(
                name: "IX_check_adjustments_order_id",
                schema: "sales",
                table: "check_adjustments",
                column: "order_id");

            migrationBuilder.CreateIndex(
                name: "IX_check_adjustments_order_line_id",
                schema: "sales",
                table: "check_adjustments",
                column: "order_line_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "check_adjustments",
                schema: "sales");
        }
    }
}
