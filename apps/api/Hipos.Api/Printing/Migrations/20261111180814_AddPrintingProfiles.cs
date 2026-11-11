using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Printing.Migrations
{
    /// <inheritdoc />
    public partial class AddPrintingProfiles : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "printing");

            migrationBuilder.CreateTable(
                name: "printer_profiles",
                schema: "printing",
                columns: table => new
                {
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    delivery_mode = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false, defaultValue: "Auto"),
                    auto_print_kitchen_on_order = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    auto_split_kitchen_by_station = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    cashier_name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    cashier_type = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    cashier_enabled = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    cashier_ip = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    cashier_port = table.Column<int>(type: "integer", nullable: false, defaultValue: 9100),
                    cashier_system_printer_name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: true),
                    cashier_fallback_to_usb = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    kitchen_name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    kitchen_type = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    kitchen_enabled = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    kitchen_ip = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    kitchen_port = table.Column<int>(type: "integer", nullable: false, defaultValue: 9100),
                    kitchen_system_printer_name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: true),
                    kitchen_fallback_to_usb = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    bar_name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    bar_type = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    bar_enabled = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    bar_ip = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    bar_port = table.Column<int>(type: "integer", nullable: false, defaultValue: 9100),
                    bar_system_printer_name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: true),
                    bar_fallback_to_usb = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    updated_by = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_printer_profiles", x => new { x.firm_id, x.branch_id });
                    table.CheckConstraint("ck_printer_profile_version_positive", "version > 0");
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "printer_profiles",
                schema: "printing");
        }
    }
}
