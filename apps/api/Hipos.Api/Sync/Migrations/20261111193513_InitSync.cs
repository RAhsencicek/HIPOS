using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Sync.Migrations
{
    /// <inheritdoc />
    public partial class InitSync : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "sync");

            migrationBuilder.CreateTable(
                name: "branch_sync_status",
                schema: "sync",
                columns: table => new
                {
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    node_mode = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    cloud_upstream_url = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    cloud_reachable = table.Column<bool>(type: "boolean", nullable: false),
                    last_cloud_check_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    last_ack_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    last_error = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_branch_sync_status", x => new { x.firm_id, x.branch_id });
                });

            migrationBuilder.CreateTable(
                name: "inbound_events",
                schema: "sync",
                columns: table => new
                {
                    event_id = table.Column<Guid>(type: "uuid", nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    aggregate_type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    aggregate_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    event_type = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    payload_json = table.Column<string>(type: "jsonb", nullable: false),
                    payload_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    origin_node_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    schema_version = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    received_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    source_created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_inbound_events", x => x.event_id);
                    table.CheckConstraint("ck_sync_inbound_status", "status IN ('applied', 'blocked')");
                });

            migrationBuilder.CreateTable(
                name: "outbox",
                schema: "sync",
                columns: table => new
                {
                    event_id = table.Column<Guid>(type: "uuid", nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    aggregate_type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    aggregate_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    partition_key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    event_type = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    payload_json = table.Column<string>(type: "jsonb", nullable: false),
                    payload_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    schema_version = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    idempotency_key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    origin_node_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    attempts = table.Column<int>(type: "integer", nullable: false),
                    next_retry_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    last_error = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    acked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_outbox", x => x.event_id);
                    table.CheckConstraint("ck_sync_outbox_status", "status IN ('pending', 'sending', 'acked', 'failed_retryable', 'blocked')");
                });

            migrationBuilder.CreateIndex(
                name: "IX_inbound_events_firm_id_branch_id_received_at",
                schema: "sync",
                table: "inbound_events",
                columns: new[] { "firm_id", "branch_id", "received_at" });

            migrationBuilder.CreateIndex(
                name: "IX_outbox_firm_id_branch_id_status",
                schema: "sync",
                table: "outbox",
                columns: new[] { "firm_id", "branch_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_outbox_partition_key_created_at",
                schema: "sync",
                table: "outbox",
                columns: new[] { "partition_key", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_outbox_status_next_retry_at_created_at",
                schema: "sync",
                table: "outbox",
                columns: new[] { "status", "next_retry_at", "created_at" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "branch_sync_status",
                schema: "sync");

            migrationBuilder.DropTable(
                name: "inbound_events",
                schema: "sync");

            migrationBuilder.DropTable(
                name: "outbox",
                schema: "sync");
        }
    }
}
