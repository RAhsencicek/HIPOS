using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Service.Migrations
{
    /// <inheritdoc />
    public partial class AddPhysicalTableGroups : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "table_group_id",
                schema: "service",
                table: "tables",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "table_groups",
                schema: "service",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    primary_table_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    table_ids = table.Column<string[]>(type: "text[]", nullable: false),
                    guest_count = table.Column<int>(type: "integer", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    closed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_by = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_table_groups", x => x.id);
                    table.CheckConstraint("ck_table_group_guests", "guest_count BETWEEN 1 AND 999");
                    table.CheckConstraint("ck_table_group_members", "cardinality(table_ids) BETWEEN 2 AND 21");
                    table.CheckConstraint("ck_table_group_version", "version > 0");
                    table.ForeignKey(
                        name: "FK_table_groups_tables_primary_table_id",
                        column: x => x.primary_table_id,
                        principalSchema: "service",
                        principalTable: "tables",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_tables_table_group_id",
                schema: "service",
                table: "tables",
                column: "table_group_id");

            migrationBuilder.CreateIndex(
                name: "IX_table_groups_firm_id_branch_id_closed_at",
                schema: "service",
                table: "table_groups",
                columns: new[] { "firm_id", "branch_id", "closed_at" });

            migrationBuilder.CreateIndex(
                name: "IX_table_groups_primary_table_id",
                schema: "service",
                table: "table_groups",
                column: "primary_table_id",
                unique: true,
                filter: "closed_at IS NULL");

            migrationBuilder.AddForeignKey(
                name: "FK_tables_table_groups_table_group_id",
                schema: "service",
                table: "tables",
                column: "table_group_id",
                principalSchema: "service",
                principalTable: "table_groups",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_tables_table_groups_table_group_id",
                schema: "service",
                table: "tables");

            migrationBuilder.DropTable(
                name: "table_groups",
                schema: "service");

            migrationBuilder.DropIndex(
                name: "IX_tables_table_group_id",
                schema: "service",
                table: "tables");

            migrationBuilder.DropColumn(
                name: "table_group_id",
                schema: "service",
                table: "tables");
        }
    }
}
