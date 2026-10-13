using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Cash.Migrations
{
    /// <inheritdoc />
    public partial class AddCashProviderEventIdentity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_cash_register_provider",
                schema: "cash",
                table: "registers");

            migrationBuilder.DropCheckConstraint(
                name: "ck_cash_movement_source",
                schema: "cash",
                table: "movements");

            migrationBuilder.AddColumn<string>(
                name: "external_reference",
                schema: "cash",
                table: "movements",
                type: "character varying(160)",
                maxLength: 160,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "provider",
                schema: "cash",
                table: "movements",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "provider_event_id",
                schema: "cash",
                table: "movements",
                type: "character varying(160)",
                maxLength: 160,
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "ck_cash_register_provider",
                schema: "cash",
                table: "registers",
                sql: "provider_mode IN ('manual', 'external_pos')");

            migrationBuilder.CreateIndex(
                name: "IX_movements_firm_id_branch_id_provider_provider_event_id",
                schema: "cash",
                table: "movements",
                columns: new[] { "firm_id", "branch_id", "provider", "provider_event_id" },
                unique: true,
                filter: "provider_event_id IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "ck_cash_movement_external_identity",
                schema: "cash",
                table: "movements",
                sql: "(source = 'manual' AND provider IS NULL AND external_reference IS NULL AND provider_event_id IS NULL) OR (source = 'pos' AND provider IS NOT NULL AND provider_event_id IS NOT NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "ck_cash_movement_source",
                schema: "cash",
                table: "movements",
                sql: "source IN ('manual', 'pos')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_cash_register_provider",
                schema: "cash",
                table: "registers");

            migrationBuilder.DropIndex(
                name: "IX_movements_firm_id_branch_id_provider_provider_event_id",
                schema: "cash",
                table: "movements");

            migrationBuilder.DropCheckConstraint(
                name: "ck_cash_movement_external_identity",
                schema: "cash",
                table: "movements");

            migrationBuilder.DropCheckConstraint(
                name: "ck_cash_movement_source",
                schema: "cash",
                table: "movements");

            migrationBuilder.DropColumn(
                name: "external_reference",
                schema: "cash",
                table: "movements");

            migrationBuilder.DropColumn(
                name: "provider",
                schema: "cash",
                table: "movements");

            migrationBuilder.DropColumn(
                name: "provider_event_id",
                schema: "cash",
                table: "movements");

            migrationBuilder.AddCheckConstraint(
                name: "ck_cash_register_provider",
                schema: "cash",
                table: "registers",
                sql: "provider_mode IN ('manual')");

            migrationBuilder.AddCheckConstraint(
                name: "ck_cash_movement_source",
                schema: "cash",
                table: "movements",
                sql: "source IN ('manual')");
        }
    }
}
