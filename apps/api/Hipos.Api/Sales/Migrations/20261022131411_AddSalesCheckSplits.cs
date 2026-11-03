using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Sales.Migrations
{
    /// <inheritdoc />
    public partial class AddSalesCheckSplits : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "check_splits",
                schema: "sales",
                columns: table => new
                {
                    request_id = table.Column<Guid>(type: "uuid", nullable: false),
                    source_check_id = table.Column<Guid>(type: "uuid", nullable: false),
                    target_check_id = table.Column<Guid>(type: "uuid", nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    fingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_check_splits", x => x.request_id);
                    table.ForeignKey(
                        name: "FK_check_splits_checks_source_check_id",
                        column: x => x.source_check_id,
                        principalSchema: "sales",
                        principalTable: "checks",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_check_splits_checks_target_check_id",
                        column: x => x.target_check_id,
                        principalSchema: "sales",
                        principalTable: "checks",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_check_splits_firm_id_branch_id_source_check_id",
                schema: "sales",
                table: "check_splits",
                columns: new[] { "firm_id", "branch_id", "source_check_id" });

            migrationBuilder.CreateIndex(
                name: "IX_check_splits_source_check_id",
                schema: "sales",
                table: "check_splits",
                column: "source_check_id");

            migrationBuilder.CreateIndex(
                name: "IX_check_splits_target_check_id",
                schema: "sales",
                table: "check_splits",
                column: "target_check_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "check_splits",
                schema: "sales");
        }
    }
}
