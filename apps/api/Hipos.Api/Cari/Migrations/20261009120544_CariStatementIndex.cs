using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Cari.Migrations
{
    /// <inheritdoc />
    public partial class CariStatementIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_movements_firm_id_branch_id_party_id_created_at",
                schema: "cari",
                table: "movements");

            migrationBuilder.CreateIndex(
                name: "IX_movements_firm_id_branch_id_party_id_effective_date_created~",
                schema: "cari",
                table: "movements",
                columns: new[] { "firm_id", "branch_id", "party_id", "effective_date", "created_at" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_movements_firm_id_branch_id_party_id_effective_date_created~",
                schema: "cari",
                table: "movements");

            migrationBuilder.CreateIndex(
                name: "IX_movements_firm_id_branch_id_party_id_created_at",
                schema: "cari",
                table: "movements",
                columns: new[] { "firm_id", "branch_id", "party_id", "created_at" });
        }
    }
}
