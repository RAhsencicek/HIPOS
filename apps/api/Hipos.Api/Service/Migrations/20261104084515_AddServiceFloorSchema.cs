using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Service.Migrations
{
    /// <inheritdoc />
    public partial class AddServiceFloorSchema : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_table_floor",
                schema: "service",
                table: "tables");

            migrationBuilder.AlterColumn<string>(
                name: "floor",
                schema: "service",
                table: "tables",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(16)",
                oldMaxLength: 16,
                oldNullable: true);

            migrationBuilder.CreateTable(
                name: "floors",
                schema: "service",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    sort_order = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_floors", x => x.id);
                });

            migrationBuilder.AddCheckConstraint(
                name: "ck_table_floor",
                schema: "service",
                table: "tables",
                sql: "floor IS NULL OR (length(btrim(floor)) BETWEEN 1 AND 80)");

            migrationBuilder.CreateIndex(
                name: "IX_floors_firm_id_branch_id_name",
                schema: "service",
                table: "floors",
                columns: new[] { "firm_id", "branch_id", "name" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "floors",
                schema: "service");

            migrationBuilder.DropCheckConstraint(
                name: "ck_table_floor",
                schema: "service",
                table: "tables");

            migrationBuilder.AlterColumn<string>(
                name: "floor",
                schema: "service",
                table: "tables",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(80)",
                oldMaxLength: 80,
                oldNullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "ck_table_floor",
                schema: "service",
                table: "tables",
                sql: "floor IS NULL OR floor IN ('lower','upper')");
        }
    }
}
