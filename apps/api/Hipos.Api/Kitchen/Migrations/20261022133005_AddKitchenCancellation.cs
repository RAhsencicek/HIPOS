using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Kitchen.Migrations
{
    /// <inheritdoc />
    public partial class AddKitchenCancellation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_kitchen_task_status",
                schema: "kitchen",
                table: "tasks");

            migrationBuilder.AddColumn<string>(
                name: "cancellation_reason",
                schema: "kitchen",
                table: "tasks",
                type: "character varying(240)",
                maxLength: 240,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "cancelled_at",
                schema: "kitchen",
                table: "tasks",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "cancelled_by",
                schema: "kitchen",
                table: "tasks",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "ck_kitchen_task_status",
                schema: "kitchen",
                table: "tasks",
                sql: "status IN ('submitted', 'preparing', 'ready', 'served', 'cancelled')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_kitchen_task_status",
                schema: "kitchen",
                table: "tasks");

            migrationBuilder.DropColumn(
                name: "cancellation_reason",
                schema: "kitchen",
                table: "tasks");

            migrationBuilder.DropColumn(
                name: "cancelled_at",
                schema: "kitchen",
                table: "tasks");

            migrationBuilder.DropColumn(
                name: "cancelled_by",
                schema: "kitchen",
                table: "tasks");

            migrationBuilder.AddCheckConstraint(
                name: "ck_kitchen_task_status",
                schema: "kitchen",
                table: "tasks",
                sql: "status IN ('submitted', 'preparing', 'ready', 'served')");
        }
    }
}
