using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Cari.Migrations
{
    /// <inheritdoc />
    public partial class SemanticCariLedger : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "email",
                schema: "cari",
                table: "parties",
                type: "character varying(160)",
                maxLength: 160,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "note",
                schema: "cari",
                table: "parties",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "phone",
                schema: "cari",
                table: "parties",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "effective_date",
                schema: "cari",
                table: "movements",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "entry_type",
                schema: "cari",
                table: "movements",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "legacy_manual");

            migrationBuilder.AddColumn<string>(
                name: "reference",
                schema: "cari",
                table: "movements",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.Sql("UPDATE cari.movements SET effective_date = (created_at AT TIME ZONE 'Europe/Istanbul')::date;");
            migrationBuilder.AlterColumn<DateOnly>(
                name: "effective_date",
                schema: "cari",
                table: "movements",
                type: "date",
                nullable: false,
                oldClrType: typeof(DateOnly),
                oldType: "date",
                oldNullable: true);
            migrationBuilder.AlterColumn<string>(
                name: "entry_type",
                schema: "cari",
                table: "movements",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(32)",
                oldMaxLength: 32,
                oldDefaultValue: "legacy_manual");

            migrationBuilder.AddCheckConstraint(
                name: "ck_movement_entry_type",
                schema: "cari",
                table: "movements",
                sql: "entry_type IN ('customer_charge', 'customer_collection', 'supplier_debt', 'supplier_payment', 'adjustment_increase', 'adjustment_decrease', 'legacy_manual')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_movement_entry_type",
                schema: "cari",
                table: "movements");

            migrationBuilder.DropColumn(
                name: "email",
                schema: "cari",
                table: "parties");

            migrationBuilder.DropColumn(
                name: "note",
                schema: "cari",
                table: "parties");

            migrationBuilder.DropColumn(
                name: "phone",
                schema: "cari",
                table: "parties");

            migrationBuilder.DropColumn(
                name: "effective_date",
                schema: "cari",
                table: "movements");

            migrationBuilder.DropColumn(
                name: "entry_type",
                schema: "cari",
                table: "movements");

            migrationBuilder.DropColumn(
                name: "reference",
                schema: "cari",
                table: "movements");
        }
    }
}
