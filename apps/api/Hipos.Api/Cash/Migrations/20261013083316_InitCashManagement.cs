using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Hipos.Api.Cash.Migrations
{
    /// <inheritdoc />
    public partial class InitCashManagement : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "cash");

            migrationBuilder.CreateTable(
                name: "audit",
                schema: "cash",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    register_id = table.Column<Guid>(type: "uuid", nullable: false),
                    shift_id = table.Column<Guid>(type: "uuid", nullable: false),
                    request_id = table.Column<Guid>(type: "uuid", nullable: false),
                    entity_type = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    entity_id = table.Column<Guid>(type: "uuid", nullable: false),
                    action = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    actor = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    detail = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    occurred_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_audit", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "registers",
                schema: "cash",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    code = table.Column<string>(type: "character varying(48)", maxLength: 48, nullable: false),
                    name = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    provider_mode = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_registers", x => x.id);
                    table.UniqueConstraint("AK_registers_firm_id_branch_id_id", x => new { x.firm_id, x.branch_id, x.id });
                    table.CheckConstraint("ck_cash_register_provider", "provider_mode IN ('manual')");
                    table.CheckConstraint("ck_cash_register_version_positive", "version > 0");
                });

            migrationBuilder.CreateTable(
                name: "shifts",
                schema: "cash",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    register_id = table.Column<Guid>(type: "uuid", nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    opening_cash_minor = table.Column<long>(type: "bigint", nullable: false),
                    opened_by = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    opened_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    expected_cash_minor = table.Column<long>(type: "bigint", nullable: true),
                    counted_cash_minor = table.Column<long>(type: "bigint", nullable: true),
                    difference_minor = table.Column<long>(type: "bigint", nullable: true),
                    close_note = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    close_request_id = table.Column<Guid>(type: "uuid", nullable: true),
                    closed_by = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    closed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    version = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_shifts", x => x.id);
                    table.UniqueConstraint("AK_shifts_firm_id_branch_id_register_id_id", x => new { x.firm_id, x.branch_id, x.register_id, x.id });
                    table.CheckConstraint("ck_cash_shift_count_nonnegative", "counted_cash_minor IS NULL OR counted_cash_minor >= 0");
                    table.CheckConstraint("ck_cash_shift_opening_nonnegative", "opening_cash_minor >= 0");
                    table.CheckConstraint("ck_cash_shift_status", "status IN ('open', 'closed')");
                    table.CheckConstraint("ck_cash_shift_version_positive", "version > 0");
                    table.ForeignKey(
                        name: "FK_shifts_registers_firm_id_branch_id_register_id",
                        columns: x => new { x.firm_id, x.branch_id, x.register_id },
                        principalSchema: "cash",
                        principalTable: "registers",
                        principalColumns: new[] { "firm_id", "branch_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "movements",
                schema: "cash",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    register_id = table.Column<Guid>(type: "uuid", nullable: false),
                    shift_id = table.Column<Guid>(type: "uuid", nullable: false),
                    kind = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    category = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    amount_minor = table.Column<long>(type: "bigint", nullable: false),
                    currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    source = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    actor = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_movements", x => x.id);
                    table.CheckConstraint("ck_cash_movement_amount_positive", "amount_minor > 0 OR (kind = 'opening_float' AND amount_minor = 0)");
                    table.CheckConstraint("ck_cash_movement_category", "category IN ('opening', 'cash_sale', 'expense', 'cash_drop', 'other')");
                    table.CheckConstraint("ck_cash_movement_currency", "currency = 'TRY'");
                    table.CheckConstraint("ck_cash_movement_kind", "kind IN ('opening_float', 'manual_in', 'manual_out')");
                    table.CheckConstraint("ck_cash_movement_source", "source IN ('manual')");
                    table.ForeignKey(
                        name: "FK_movements_shifts_firm_id_branch_id_register_id_shift_id",
                        columns: x => new { x.firm_id, x.branch_id, x.register_id, x.shift_id },
                        principalSchema: "cash",
                        principalTable: "shifts",
                        principalColumns: new[] { "firm_id", "branch_id", "register_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_audit_firm_id_branch_id_request_id",
                schema: "cash",
                table: "audit",
                columns: new[] { "firm_id", "branch_id", "request_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_audit_firm_id_branch_id_shift_id_id",
                schema: "cash",
                table: "audit",
                columns: new[] { "firm_id", "branch_id", "shift_id", "id" });

            migrationBuilder.CreateIndex(
                name: "IX_movements_firm_id_branch_id_register_id_shift_id",
                schema: "cash",
                table: "movements",
                columns: new[] { "firm_id", "branch_id", "register_id", "shift_id" });

            migrationBuilder.CreateIndex(
                name: "IX_movements_firm_id_branch_id_shift_id_created_at_id",
                schema: "cash",
                table: "movements",
                columns: new[] { "firm_id", "branch_id", "shift_id", "created_at", "id" });

            migrationBuilder.CreateIndex(
                name: "IX_registers_firm_id_branch_id_code",
                schema: "cash",
                table: "registers",
                columns: new[] { "firm_id", "branch_id", "code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_registers_firm_id_branch_id_id",
                schema: "cash",
                table: "registers",
                columns: new[] { "firm_id", "branch_id", "id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_shifts_close_request_id",
                schema: "cash",
                table: "shifts",
                column: "close_request_id",
                unique: true,
                filter: "close_request_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_shifts_firm_id_branch_id_register_id_id",
                schema: "cash",
                table: "shifts",
                columns: new[] { "firm_id", "branch_id", "register_id", "id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_shifts_firm_id_branch_id_register_id_status",
                schema: "cash",
                table: "shifts",
                columns: new[] { "firm_id", "branch_id", "register_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_shifts_register_id",
                schema: "cash",
                table: "shifts",
                column: "register_id",
                unique: true,
                filter: "status = 'open'");

            migrationBuilder.Sql("""
                CREATE FUNCTION cash.reject_movement_mutation() RETURNS trigger AS $$
                BEGIN
                    RAISE EXCEPTION 'cash movements are append-only' USING ERRCODE = '55000';
                END;
                $$ LANGUAGE plpgsql;

                CREATE TRIGGER cash_movements_append_only
                BEFORE UPDATE OR DELETE ON cash.movements
                FOR EACH ROW EXECUTE FUNCTION cash.reject_movement_mutation();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP TRIGGER IF EXISTS cash_movements_append_only ON cash.movements; DROP FUNCTION IF EXISTS cash.reject_movement_mutation();");
            migrationBuilder.DropTable(
                name: "audit",
                schema: "cash");

            migrationBuilder.DropTable(
                name: "movements",
                schema: "cash");

            migrationBuilder.DropTable(
                name: "shifts",
                schema: "cash");

            migrationBuilder.DropTable(
                name: "registers",
                schema: "cash");
        }
    }
}
