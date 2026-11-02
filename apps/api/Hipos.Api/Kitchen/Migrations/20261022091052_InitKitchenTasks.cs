using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Hipos.Api.Kitchen.Migrations
{
    /// <inheritdoc />
    public partial class InitKitchenTasks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "kitchen");

            migrationBuilder.CreateTable(
                name: "task_audit",
                schema: "kitchen",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    request_id = table.Column<Guid>(type: "uuid", nullable: false),
                    task_id = table.Column<Guid>(type: "uuid", nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    actor = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    action = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    occurred_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_task_audit", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "tasks",
                schema: "kitchen",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    order_id = table.Column<Guid>(type: "uuid", nullable: false),
                    order_line_id = table.Column<long>(type: "bigint", nullable: false),
                    product_name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    quantity = table.Column<int>(type: "integer", nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    submitted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    prepared_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ready_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    served_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_tasks", x => x.id);
                    table.CheckConstraint("ck_kitchen_task_quantity", "quantity > 0");
                    table.CheckConstraint("ck_kitchen_task_status", "status IN ('submitted', 'preparing', 'ready', 'served')");
                    table.CheckConstraint("ck_kitchen_task_version", "version > 0");
                    table.ForeignKey(
                        name: "FK_kitchen_tasks_sales_order_lines_order_line_id",
                        column: x => x.order_line_id,
                        principalSchema: "sales",
                        principalTable: "order_lines",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_kitchen_tasks_sales_orders_order_id",
                        column: x => x.order_id,
                        principalSchema: "sales",
                        principalTable: "orders",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_task_audit_firm_id_branch_id_task_id",
                schema: "kitchen",
                table: "task_audit",
                columns: new[] { "firm_id", "branch_id", "task_id" });

            migrationBuilder.CreateIndex(
                name: "IX_task_audit_request_id",
                schema: "kitchen",
                table: "task_audit",
                column: "request_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_tasks_firm_id_branch_id_status_submitted_at",
                schema: "kitchen",
                table: "tasks",
                columns: new[] { "firm_id", "branch_id", "status", "submitted_at" });

            migrationBuilder.CreateIndex(
                name: "IX_tasks_order_line_id",
                schema: "kitchen",
                table: "tasks",
                column: "order_line_id",
                unique: true);

            migrationBuilder.Sql("""
                WITH inserted AS (
                    INSERT INTO kitchen.tasks
                        (id, firm_id, branch_id, order_id, order_line_id, product_name, quantity,
                         status, version, submitted_at)
                    SELECT gen_random_uuid(), orders.firm_id, orders.branch_id, orders.id, lines.id,
                           lines.product_name, lines.quantity, 'submitted', 1, orders.created_at
                    FROM sales.orders AS orders
                    INNER JOIN sales.order_lines AS lines ON lines.order_id = orders.id
                    WHERE orders.source = 'waiter_web'
                    ON CONFLICT (order_line_id) DO NOTHING
                    RETURNING id, firm_id, branch_id, status, version, submitted_at
                )
                INSERT INTO kitchen.task_audit
                    (request_id, task_id, firm_id, branch_id, actor, action, status, version, occurred_at)
                SELECT id, id, firm_id, branch_id, 'migration', 'backfilled', status, version, submitted_at
                FROM inserted;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "task_audit",
                schema: "kitchen");

            migrationBuilder.DropTable(
                name: "tasks",
                schema: "kitchen");
        }
    }
}
