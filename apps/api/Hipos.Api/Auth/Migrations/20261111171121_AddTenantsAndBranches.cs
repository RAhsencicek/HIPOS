using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Auth.Migrations
{
    /// <inheritdoc />
    public partial class AddTenantsAndBranches : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_platform_admin boolean NOT NULL DEFAULT false;");

            migrationBuilder.Sql(
                "ALTER TABLE auth.pin_codes ADD COLUMN IF NOT EXISTS pin_plain character varying(10);");

            migrationBuilder.CreateTable(
                name: "firms",
                schema: "auth",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    code = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    brand_name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: true),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_firms", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "branches",
                schema: "auth",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    code = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    district = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    bridge_token_hash = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_branches", x => x.id);
                    table.ForeignKey(
                        name: "FK_branches_firms_firm_id",
                        column: x => x.firm_id,
                        principalSchema: "auth",
                        principalTable: "firms",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_branches_code",
                schema: "auth",
                table: "branches",
                column: "code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_branches_firm_id_is_active",
                schema: "auth",
                table: "branches",
                columns: new[] { "firm_id", "is_active" });

            migrationBuilder.CreateIndex(
                name: "IX_firms_code",
                schema: "auth",
                table: "firms",
                column: "code",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "branches",
                schema: "auth");

            migrationBuilder.DropTable(
                name: "firms",
                schema: "auth");

            migrationBuilder.DropColumn(
                name: "is_platform_admin",
                schema: "auth",
                table: "users");

            migrationBuilder.DropColumn(
                name: "pin_plain",
                schema: "auth",
                table: "pin_codes");
        }
    }
}
