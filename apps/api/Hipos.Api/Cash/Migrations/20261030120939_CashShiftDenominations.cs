using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Cash.Migrations
{
    /// <inheritdoc />
    public partial class CashShiftDenominations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "shift_denominations",
                schema: "cash",
                columns: table => new
                {
                    shift_id = table.Column<Guid>(type: "uuid", nullable: false),
                    denomination_minor = table.Column<int>(type: "integer", nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    register_id = table.Column<Guid>(type: "uuid", nullable: false),
                    quantity = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_shift_denominations", x => new { x.shift_id, x.denomination_minor });
                    table.CheckConstraint("ck_cash_shift_denomination_quantity", "quantity BETWEEN 0 AND 1000000");
                    table.CheckConstraint("ck_cash_shift_denomination_value", "denomination_minor IN (20000, 10000, 5000, 2000, 1000, 500, 100, 50, 25, 10, 5, 1)");
                    table.ForeignKey(
                        name: "FK_shift_denominations_shifts_firm_id_branch_id_register_id_sh~",
                        columns: x => new { x.firm_id, x.branch_id, x.register_id, x.shift_id },
                        principalSchema: "cash",
                        principalTable: "shifts",
                        principalColumns: new[] { "firm_id", "branch_id", "register_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_shift_denominations_firm_id_branch_id_register_id_shift_id",
                schema: "cash",
                table: "shift_denominations",
                columns: new[] { "firm_id", "branch_id", "register_id", "shift_id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "shift_denominations",
                schema: "cash");
        }
    }
}
