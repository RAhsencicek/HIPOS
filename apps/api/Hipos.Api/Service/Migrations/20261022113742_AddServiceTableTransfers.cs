using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Service.Migrations
{
    /// <inheritdoc />
    public partial class AddServiceTableTransfers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "table_transfers",
                schema: "service",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    request_id = table.Column<Guid>(type: "uuid", nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    from_table_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    to_table_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    check_id = table.Column<Guid>(type: "uuid", nullable: false),
                    transfer_type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    actor = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_table_transfers", x => x.id);
                    table.ForeignKey(
                        name: "FK_table_transfers_checks_check_id",
                        column: x => x.check_id,
                        principalSchema: "sales",
                        principalTable: "checks",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_table_transfers_tables_from_table_id",
                        column: x => x.from_table_id,
                        principalSchema: "service",
                        principalTable: "tables",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_table_transfers_tables_to_table_id",
                        column: x => x.to_table_id,
                        principalSchema: "service",
                        principalTable: "tables",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_table_transfers_check_id",
                schema: "service",
                table: "table_transfers",
                column: "check_id");

            migrationBuilder.CreateIndex(
                name: "IX_table_transfers_firm_id_branch_id_created_at",
                schema: "service",
                table: "table_transfers",
                columns: new[] { "firm_id", "branch_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_table_transfers_firm_id_branch_id_request_id_from_table_id",
                schema: "service",
                table: "table_transfers",
                columns: new[] { "firm_id", "branch_id", "request_id", "from_table_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_table_transfers_from_table_id",
                schema: "service",
                table: "table_transfers",
                column: "from_table_id");

            migrationBuilder.CreateIndex(
                name: "IX_table_transfers_to_table_id",
                schema: "service",
                table: "table_transfers",
                column: "to_table_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "table_transfers",
                schema: "service");
        }
    }
}
