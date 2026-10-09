using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Hipos.Api.Cari.Migrations
{
    /// <inheritdoc />
    public partial class InitCari : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "cari");

            migrationBuilder.CreateTable(
                name: "audit",
                schema: "cari",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    party_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    action = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    actor = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    detail = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    occurred_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_audit", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "parties",
                schema: "cari",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    types = table.Column<string[]>(type: "text[]", nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_parties", x => x.id);
                    table.CheckConstraint("ck_party_version", "version > 0");
                });

            migrationBuilder.CreateTable(
                name: "movements",
                schema: "cari",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    party_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    delta_minor = table.Column<long>(type: "bigint", nullable: false),
                    currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    source = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    actor = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_movements", x => x.id);
                    table.CheckConstraint("ck_movement_currency", "currency = 'TRY'");
                    table.CheckConstraint("ck_movement_kind", "kind IN ('customer', 'supplier')");
                    table.CheckConstraint("ck_movement_nonzero", "delta_minor <> 0");
                    table.ForeignKey(
                        name: "FK_movements_parties_party_id",
                        column: x => x.party_id,
                        principalSchema: "cari",
                        principalTable: "parties",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_audit_firm_id_branch_id_party_id_occurred_at",
                schema: "cari",
                table: "audit",
                columns: new[] { "firm_id", "branch_id", "party_id", "occurred_at" });

            migrationBuilder.CreateIndex(
                name: "IX_movements_firm_id_branch_id_party_id_created_at",
                schema: "cari",
                table: "movements",
                columns: new[] { "firm_id", "branch_id", "party_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_movements_party_id",
                schema: "cari",
                table: "movements",
                column: "party_id");

            migrationBuilder.CreateIndex(
                name: "IX_parties_firm_id_branch_id_name",
                schema: "cari",
                table: "parties",
                columns: new[] { "firm_id", "branch_id", "name" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "audit",
                schema: "cari");

            migrationBuilder.DropTable(
                name: "movements",
                schema: "cari");

            migrationBuilder.DropTable(
                name: "parties",
                schema: "cari");
        }
    }
}
