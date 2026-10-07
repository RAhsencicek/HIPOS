using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Hipos.Api.Sales.Migrations
{
    /// <inheritdoc />
    public partial class AddSimulatedPayments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_order_payment_status",
                schema: "sales",
                table: "orders");

            migrationBuilder.CreateTable(
                name: "payment_attempt_audit",
                schema: "sales",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    attempt_id = table.Column<Guid>(type: "uuid", nullable: false),
                    order_id = table.Column<Guid>(type: "uuid", nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    actor = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    action = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    occurred_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_payment_attempt_audit", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "payment_attempts",
                schema: "sales",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    order_id = table.Column<Guid>(type: "uuid", nullable: false),
                    amount_minor = table.Column<long>(type: "bigint", nullable: false),
                    currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    method = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    requested_outcome = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    actor = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_payment_attempts", x => x.id);
                    table.CheckConstraint("ck_payment_amount_positive", "amount_minor > 0");
                    table.CheckConstraint("ck_payment_method", "method IN ('cash', 'card')");
                    table.CheckConstraint("ck_payment_requested_outcome", "requested_outcome IN ('succeeded', 'failed', 'pending', 'unknown')");
                    table.CheckConstraint("ck_payment_status", "status IN ('succeeded', 'failed', 'pending', 'unknown', 'cancelled')");
                    table.CheckConstraint("ck_payment_version_positive", "version > 0");
                    table.ForeignKey(
                        name: "FK_payment_attempts_orders_order_id",
                        column: x => x.order_id,
                        principalSchema: "sales",
                        principalTable: "orders",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.AddCheckConstraint(
                name: "ck_order_payment_status",
                schema: "sales",
                table: "orders",
                sql: "payment_status IN ('unpaid', 'partially_paid', 'paid', 'pending', 'unknown')");

            migrationBuilder.CreateIndex(
                name: "IX_payment_attempt_audit_firm_id_branch_id_order_id_id",
                schema: "sales",
                table: "payment_attempt_audit",
                columns: new[] { "firm_id", "branch_id", "order_id", "id" });

            migrationBuilder.CreateIndex(
                name: "IX_payment_attempts_firm_id_branch_id_order_id_status",
                schema: "sales",
                table: "payment_attempts",
                columns: new[] { "firm_id", "branch_id", "order_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_payment_attempts_order_id",
                schema: "sales",
                table: "payment_attempts",
                column: "order_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "payment_attempt_audit",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "payment_attempts",
                schema: "sales");

            migrationBuilder.DropCheckConstraint(
                name: "ck_order_payment_status",
                schema: "sales",
                table: "orders");

            migrationBuilder.AddCheckConstraint(
                name: "ck_order_payment_status",
                schema: "sales",
                table: "orders",
                sql: "payment_status IN ('unpaid')");
        }
    }
}
