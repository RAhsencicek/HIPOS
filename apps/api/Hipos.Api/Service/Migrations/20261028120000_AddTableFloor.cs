using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Service.Migrations;

[DbContext(typeof(ServiceDbContext))]
[Migration("20261028120000_AddTableFloor")]
public partial class AddTableFloor : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(name: "floor", schema: "service", table: "tables",
            type: "character varying(16)", maxLength: 16, nullable: true);
        migrationBuilder.AddCheckConstraint(name: "ck_table_floor", schema: "service", table: "tables",
            sql: "floor IS NULL OR floor IN ('lower','upper')");
    }
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropCheckConstraint(name: "ck_table_floor", schema: "service", table: "tables");
        migrationBuilder.DropColumn(name: "floor", schema: "service", table: "tables");
    }
}
