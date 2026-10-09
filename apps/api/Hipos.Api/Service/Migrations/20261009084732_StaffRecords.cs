using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Service.Migrations
{
    /// <inheritdoc />
    public partial class StaffRecords : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_assignments_waiters_waiter_id",
                schema: "service",
                table: "assignments");

            migrationBuilder.DropPrimaryKey(
                name: "PK_waiters",
                schema: "service",
                table: "waiters");

            migrationBuilder.RenameTable(
                name: "waiters",
                schema: "service",
                newName: "employees",
                newSchema: "service");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "created_at",
                schema: "service",
                table: "employees",
                type: "timestamp with time zone",
                nullable: false,
                defaultValueSql: "CURRENT_TIMESTAMP");

            migrationBuilder.AddColumn<string>(
                name: "department",
                schema: "service",
                table: "employees",
                type: "character varying(24)",
                maxLength: 24,
                nullable: false,
                defaultValue: "service");

            migrationBuilder.AddColumn<string>(
                name: "job_title",
                schema: "service",
                table: "employees",
                type: "character varying(80)",
                maxLength: 80,
                nullable: false,
                defaultValue: "Garson");

            migrationBuilder.AddColumn<string>(
                name: "phone",
                schema: "service",
                table: "employees",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "version",
                schema: "service",
                table: "employees",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddPrimaryKey(
                name: "PK_employees",
                schema: "service",
                table: "employees",
                column: "id");

            migrationBuilder.CreateIndex(
                name: "IX_employees_firm_id_branch_id_department_is_active",
                schema: "service",
                table: "employees",
                columns: new[] { "firm_id", "branch_id", "department", "is_active" });

            migrationBuilder.AddCheckConstraint(
                name: "ck_employee_department",
                schema: "service",
                table: "employees",
                sql: "department IN ('management','kitchen','service','cashier','support')");

            migrationBuilder.AddForeignKey(
                name: "FK_assignments_employees_waiter_id",
                schema: "service",
                table: "assignments",
                column: "waiter_id",
                principalSchema: "service",
                principalTable: "employees",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_assignments_employees_waiter_id",
                schema: "service",
                table: "assignments");

            migrationBuilder.DropPrimaryKey(
                name: "PK_employees",
                schema: "service",
                table: "employees");

            migrationBuilder.DropIndex(
                name: "IX_employees_firm_id_branch_id_department_is_active",
                schema: "service",
                table: "employees");

            migrationBuilder.DropCheckConstraint(
                name: "ck_employee_department",
                schema: "service",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "created_at",
                schema: "service",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "department",
                schema: "service",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "job_title",
                schema: "service",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "phone",
                schema: "service",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "version",
                schema: "service",
                table: "employees");

            migrationBuilder.RenameTable(
                name: "employees",
                schema: "service",
                newName: "waiters",
                newSchema: "service");

            migrationBuilder.AddPrimaryKey(
                name: "PK_waiters",
                schema: "service",
                table: "waiters",
                column: "id");

            migrationBuilder.AddForeignKey(
                name: "FK_assignments_waiters_waiter_id",
                schema: "service",
                table: "assignments",
                column: "waiter_id",
                principalSchema: "service",
                principalTable: "waiters",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }
    }
}
