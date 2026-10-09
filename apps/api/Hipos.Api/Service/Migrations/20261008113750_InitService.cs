using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Hipos.Api.Service.Migrations
{
    /// <inheritdoc />
    public partial class InitService : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "service");

            migrationBuilder.CreateTable(
                name: "audit",
                schema: "service",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    entity_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    action = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    actor = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    occurred_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_audit", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "tables",
                schema: "service",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    number = table.Column<int>(type: "integer", nullable: false),
                    name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_tables", x => x.id);
                    table.CheckConstraint("ck_table_number", "number BETWEEN 1 AND 999");
                });

            migrationBuilder.CreateTable(
                name: "waiters",
                schema: "service",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_waiters", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "assignments",
                schema: "service",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    table_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    order_id = table.Column<Guid>(type: "uuid", nullable: false),
                    waiter_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    opened_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    closed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    version = table.Column<int>(type: "integer", nullable: false),
                    created_by = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    closed_by = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_assignments", x => x.id);
                    table.CheckConstraint("ck_assignment_version", "version > 0");
                    table.ForeignKey(
                        name: "FK_assignments_orders_order_id",
                        column: x => x.order_id,
                        principalSchema: "sales",
                        principalTable: "orders",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_assignments_tables_table_id",
                        column: x => x.table_id,
                        principalSchema: "service",
                        principalTable: "tables",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_assignments_waiters_waiter_id",
                        column: x => x.waiter_id,
                        principalSchema: "service",
                        principalTable: "waiters",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_assignments_firm_id_branch_id_closed_at",
                schema: "service",
                table: "assignments",
                columns: new[] { "firm_id", "branch_id", "closed_at" });

            migrationBuilder.CreateIndex(
                name: "IX_assignments_order_id",
                schema: "service",
                table: "assignments",
                column: "order_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_assignments_table_id",
                schema: "service",
                table: "assignments",
                column: "table_id",
                unique: true,
                filter: "closed_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_assignments_waiter_id",
                schema: "service",
                table: "assignments",
                column: "waiter_id");

            migrationBuilder.CreateIndex(
                name: "IX_audit_firm_id_branch_id_entity_id_occurred_at",
                schema: "service",
                table: "audit",
                columns: new[] { "firm_id", "branch_id", "entity_id", "occurred_at" });

            migrationBuilder.CreateIndex(
                name: "IX_tables_firm_id_branch_id_number",
                schema: "service",
                table: "tables",
                columns: new[] { "firm_id", "branch_id", "number" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "assignments",
                schema: "service");

            migrationBuilder.DropTable(
                name: "audit",
                schema: "service");

            migrationBuilder.DropTable(
                name: "tables",
                schema: "service");

            migrationBuilder.DropTable(
                name: "waiters",
                schema: "service");
        }
    }
}
