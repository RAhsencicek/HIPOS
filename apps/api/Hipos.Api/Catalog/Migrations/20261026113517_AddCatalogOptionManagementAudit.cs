using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Catalog.Migrations
{
    /// <inheritdoc />
    public partial class AddCatalogOptionManagementAudit : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "updated_at",
                schema: "catalog",
                table: "option_groups",
                type: "timestamp with time zone",
                nullable: false,
                defaultValueSql: "CURRENT_TIMESTAMP");

            migrationBuilder.AddColumn<int>(
                name: "version",
                schema: "catalog",
                table: "option_groups",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.CreateTable(
                name: "option_management_audit",
                schema: "catalog",
                columns: table => new
                {
                    request_id = table.Column<Guid>(type: "uuid", nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    target_type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    target_id = table.Column<Guid>(type: "uuid", nullable: false),
                    actor = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    action = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    fingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    snapshot_json = table.Column<string>(type: "jsonb", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    occurred_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_option_management_audit", x => x.request_id);
                    table.CheckConstraint("ck_option_audit_target_type", "target_type IN ('group', 'product_groups')");
                    table.CheckConstraint("ck_option_audit_version_positive", "version > 0");
                });

            migrationBuilder.AddCheckConstraint(
                name: "ck_option_group_version_positive",
                schema: "catalog",
                table: "option_groups",
                sql: "version > 0");

            migrationBuilder.CreateIndex(
                name: "IX_option_management_audit_firm_id_target_type_target_id_occur~",
                schema: "catalog",
                table: "option_management_audit",
                columns: new[] { "firm_id", "target_type", "target_id", "occurred_at" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "option_management_audit",
                schema: "catalog");

            migrationBuilder.DropCheckConstraint(
                name: "ck_option_group_version_positive",
                schema: "catalog",
                table: "option_groups");

            migrationBuilder.DropColumn(
                name: "updated_at",
                schema: "catalog",
                table: "option_groups");

            migrationBuilder.DropColumn(
                name: "version",
                schema: "catalog",
                table: "option_groups");
        }
    }
}
