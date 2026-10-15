using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Hipos.Api.Expenses.Migrations
{
    /// <inheritdoc />
    public partial class InitExpenses : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "finance");

            migrationBuilder.CreateTable(
                name: "audit",
                schema: "finance",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    request_id = table.Column<Guid>(type: "uuid", nullable: false),
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
                name: "expense_categories",
                schema: "finance",
                columns: table => new
                {
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    id = table.Column<string>(type: "character varying(48)", maxLength: 48, nullable: false),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_expense_categories", x => new { x.firm_id, x.id });
                });

            migrationBuilder.CreateTable(
                name: "expenses",
                schema: "finance",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    request_id = table.Column<Guid>(type: "uuid", nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    category_id = table.Column<string>(type: "character varying(48)", maxLength: 48, nullable: false),
                    expense_date = table.Column<DateOnly>(type: "date", nullable: false),
                    amount_minor = table.Column<long>(type: "bigint", nullable: false),
                    currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    source = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    actor = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    request_fingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_expenses", x => x.id);
                    table.CheckConstraint("ck_expense_amount_positive", "amount_minor > 0");
                    table.CheckConstraint("ck_expense_currency_try", "currency = 'TRY'");
                    table.CheckConstraint("ck_expense_description_nonempty", "length(trim(description)) BETWEEN 1 AND 500");
                    table.CheckConstraint("ck_expense_fingerprint_sha256", "length(request_fingerprint) = 64");
                    table.CheckConstraint("ck_expense_source_manual", "source = 'manual'");
                    table.ForeignKey(
                        name: "FK_expenses_expense_categories_firm_id_category_id",
                        columns: x => new { x.firm_id, x.category_id },
                        principalSchema: "finance",
                        principalTable: "expense_categories",
                        principalColumns: new[] { "firm_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_audit_firm_id_branch_id_entity_id_occurred_at",
                schema: "finance",
                table: "audit",
                columns: new[] { "firm_id", "branch_id", "entity_id", "occurred_at" });

            migrationBuilder.CreateIndex(
                name: "IX_audit_firm_id_request_id",
                schema: "finance",
                table: "audit",
                columns: new[] { "firm_id", "request_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_expense_categories_firm_id_name",
                schema: "finance",
                table: "expense_categories",
                columns: new[] { "firm_id", "name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_expenses_firm_id_branch_id_category_id_expense_date",
                schema: "finance",
                table: "expenses",
                columns: new[] { "firm_id", "branch_id", "category_id", "expense_date" });

            migrationBuilder.CreateIndex(
                name: "IX_expenses_firm_id_branch_id_expense_date_id",
                schema: "finance",
                table: "expenses",
                columns: new[] { "firm_id", "branch_id", "expense_date", "id" });

            migrationBuilder.CreateIndex(
                name: "IX_expenses_firm_id_category_id",
                schema: "finance",
                table: "expenses",
                columns: new[] { "firm_id", "category_id" });

            migrationBuilder.CreateIndex(
                name: "IX_expenses_firm_id_request_id",
                schema: "finance",
                table: "expenses",
                columns: new[] { "firm_id", "request_id" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "audit",
                schema: "finance");

            migrationBuilder.DropTable(
                name: "expenses",
                schema: "finance");

            migrationBuilder.DropTable(
                name: "expense_categories",
                schema: "finance");
        }
    }
}
