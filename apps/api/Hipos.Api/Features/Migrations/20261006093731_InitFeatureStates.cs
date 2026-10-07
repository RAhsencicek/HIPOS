using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Hipos.Api.Features.Migrations
{
    /// <inheritdoc />
    public partial class InitFeatureStates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "modules");

            migrationBuilder.CreateTable(
                name: "branch_feature_states",
                schema: "modules",
                columns: table => new
                {
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    feature_key = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    desired_enabled = table.Column<bool>(type: "boolean", nullable: false),
                    effective_for_new_work = table.Column<bool>(type: "boolean", nullable: false),
                    lifecycle = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    in_flight_work_count = table.Column<int>(type: "integer", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_branch_feature_states", x => new { x.firm_id, x.branch_id, x.feature_key });
                    table.CheckConstraint("ck_feature_version_positive", "version > 0");
                    table.CheckConstraint("ck_in_flight_nonnegative", "in_flight_work_count >= 0");
                });

            migrationBuilder.CreateTable(
                name: "feature_audit",
                schema: "modules",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    feature_key = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    actor = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    desired_enabled = table.Column<bool>(type: "boolean", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    occurred_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_feature_audit", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_feature_audit_firm_id_branch_id_id",
                schema: "modules",
                table: "feature_audit",
                columns: new[] { "firm_id", "branch_id", "id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "branch_feature_states",
                schema: "modules");

            migrationBuilder.DropTable(
                name: "feature_audit",
                schema: "modules");
        }
    }
}
