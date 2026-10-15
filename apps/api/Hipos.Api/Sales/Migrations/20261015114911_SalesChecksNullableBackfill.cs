using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Hipos.Api.Sales.Migrations
{
    /// <inheritdoc />
    public partial class SalesChecksNullableBackfill : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "check_id",
                schema: "sales",
                table: "payment_attempts",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "check_id",
                schema: "sales",
                table: "orders",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "check_audit",
                schema: "sales",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    check_id = table.Column<Guid>(type: "uuid", nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    actor = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    action = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    occurred_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_check_audit", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "checks",
                schema: "sales",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    customer_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    table_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    waiter_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_checks", x => x.id);
                    table.CheckConstraint("ck_check_currency", "currency = 'TRY'");
                    table.CheckConstraint("ck_check_status", "status IN ('open')");
                    table.CheckConstraint("ck_check_version_positive", "version > 0");
                });

            // Expansion phase: create one check for each historical order before any writer requires the link.
            migrationBuilder.Sql("""
                INSERT INTO sales.checks (id, firm_id, branch_id, status, customer_id, table_id, waiter_id, currency, created_at, version)
                SELECT id, firm_id, branch_id, 'open', NULL, NULL, NULL, currency, created_at, 1
                FROM sales.orders
                ON CONFLICT (id) DO NOTHING;
                UPDATE sales.orders SET check_id = id WHERE check_id IS NULL;
                UPDATE sales.payment_attempts p SET check_id = o.check_id
                FROM sales.orders o WHERE p.order_id = o.id AND p.check_id IS NULL;
                """);

            migrationBuilder.CreateIndex(
                name: "IX_check_audit_firm_id_branch_id_check_id_id",
                schema: "sales",
                table: "check_audit",
                columns: new[] { "firm_id", "branch_id", "check_id", "id" });

            migrationBuilder.CreateIndex(
                name: "IX_checks_firm_id_branch_id_created_at",
                schema: "sales",
                table: "checks",
                columns: new[] { "firm_id", "branch_id", "created_at" });

            migrationBuilder.Sql("""
                INSERT INTO sales.check_audit (check_id,firm_id,branch_id,actor,action,version,occurred_at)
                SELECT o.id, a.firm_id, a.branch_id, a.actor, a.action, a.version, a.occurred_at
                FROM sales.order_audit a JOIN sales.orders o ON o.id = a.order_id;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "check_audit",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "checks",
                schema: "sales");

            migrationBuilder.DropColumn(
                name: "check_id",
                schema: "sales",
                table: "payment_attempts");

            migrationBuilder.DropColumn(
                name: "check_id",
                schema: "sales",
                table: "orders");
        }
    }
}
