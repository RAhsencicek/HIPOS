using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Overview.Migrations
{
    /// <inheritdoc />
    public partial class InitialOverviewAlerts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "overview");

            migrationBuilder.CreateTable(
                name: "alert_acknowledgments",
                schema: "overview",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    alert_key = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    category = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    title = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    actor = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    note = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    acknowledged_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_alert_acknowledgments", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_alert_acknowledgments_firm_id_branch_id_acknowledged_at",
                schema: "overview",
                table: "alert_acknowledgments",
                columns: new[] { "firm_id", "branch_id", "acknowledged_at" });

            migrationBuilder.CreateIndex(
                name: "IX_alert_acknowledgments_firm_id_branch_id_alert_key",
                schema: "overview",
                table: "alert_acknowledgments",
                columns: new[] { "firm_id", "branch_id", "alert_key" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "alert_acknowledgments",
                schema: "overview");
        }
    }
}
