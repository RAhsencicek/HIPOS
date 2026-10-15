using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Cash.Migrations
{
    /// <inheritdoc />
    public partial class CashReversalsAndProvisioning : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "correction_reason",
                schema: "cash",
                table: "movements",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "correction_type",
                schema: "cash",
                table: "movements",
                type: "character varying(24)",
                maxLength: 24,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "original_movement_id",
                schema: "cash",
                table: "movements",
                type: "uuid",
                nullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "shift_id",
                schema: "cash",
                table: "audit",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddUniqueConstraint(
                name: "AK_movements_firm_id_branch_id_register_id_id",
                schema: "cash",
                table: "movements",
                columns: new[] { "firm_id", "branch_id", "register_id", "id" });

            migrationBuilder.CreateIndex(
                name: "IX_movements_firm_id_branch_id_register_id_original_movement_id",
                schema: "cash",
                table: "movements",
                columns: new[] { "firm_id", "branch_id", "register_id", "original_movement_id" },
                unique: true,
                filter: "original_movement_id IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "ck_cash_movement_correction",
                schema: "cash",
                table: "movements",
                sql: "(original_movement_id IS NULL AND correction_type IS NULL AND correction_reason IS NULL) OR (original_movement_id IS NOT NULL AND correction_type = 'reversal' AND correction_reason IS NOT NULL AND length(trim(correction_reason)) BETWEEN 3 AND 500 AND source = 'manual' AND kind IN ('manual_in', 'manual_out'))");

            migrationBuilder.AddForeignKey(
                name: "FK_movements_movements_firm_id_branch_id_register_id_original_~",
                schema: "cash",
                table: "movements",
                columns: new[] { "firm_id", "branch_id", "register_id", "original_movement_id" },
                principalSchema: "cash",
                principalTable: "movements",
                principalColumns: new[] { "firm_id", "branch_id", "register_id", "id" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_movements_movements_firm_id_branch_id_register_id_original_~",
                schema: "cash",
                table: "movements");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_movements_firm_id_branch_id_register_id_id",
                schema: "cash",
                table: "movements");

            migrationBuilder.DropIndex(
                name: "IX_movements_firm_id_branch_id_register_id_original_movement_id",
                schema: "cash",
                table: "movements");

            migrationBuilder.DropCheckConstraint(
                name: "ck_cash_movement_correction",
                schema: "cash",
                table: "movements");

            migrationBuilder.DropColumn(
                name: "correction_reason",
                schema: "cash",
                table: "movements");

            migrationBuilder.DropColumn(
                name: "correction_type",
                schema: "cash",
                table: "movements");

            migrationBuilder.DropColumn(
                name: "original_movement_id",
                schema: "cash",
                table: "movements");

            migrationBuilder.AlterColumn<Guid>(
                name: "shift_id",
                schema: "cash",
                table: "audit",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);
        }
    }
}
