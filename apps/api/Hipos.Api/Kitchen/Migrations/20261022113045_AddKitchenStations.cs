using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Kitchen.Migrations
{
    /// <inheritdoc />
    public partial class AddKitchenStations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "station_id",
                schema: "kitchen",
                table: "tasks",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "stations",
                schema: "kitchen",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    code = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_stations", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "station_categories",
                schema: "kitchen",
                columns: table => new
                {
                    firm_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    branch_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    category_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    station_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_station_categories", x => new { x.firm_id, x.branch_id, x.category_id });
                    table.ForeignKey(
                        name: "FK_station_categories_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "kitchen",
                        principalTable: "stations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_tasks_station_id",
                schema: "kitchen",
                table: "tasks",
                column: "station_id");

            migrationBuilder.CreateIndex(
                name: "IX_station_categories_station_id",
                schema: "kitchen",
                table: "station_categories",
                column: "station_id");

            migrationBuilder.CreateIndex(
                name: "IX_stations_firm_id_branch_id_code",
                schema: "kitchen",
                table: "stations",
                columns: new[] { "firm_id", "branch_id", "code" },
                unique: true);

            migrationBuilder.Sql("""
                INSERT INTO kitchen.stations (id, firm_id, branch_id, code, name, is_active) VALUES
                    ('a1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'oven', 'Fırın', TRUE),
                    ('a1000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'hot', 'Sıcak Mutfak', TRUE),
                    ('a1000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'bar', 'Bar', TRUE),
                    ('a1000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'cold', 'Soğuk Mutfak', TRUE)
                ON CONFLICT (firm_id, branch_id, code) DO NOTHING;

                INSERT INTO kitchen.station_categories (firm_id, branch_id, category_id, station_id) VALUES
                    ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'pizza', 'a1000000-0000-4000-8000-000000000001'),
                    ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'sandwich', 'a1000000-0000-4000-8000-000000000002'),
                    ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'drinks', 'a1000000-0000-4000-8000-000000000003'),
                    ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'dessert', 'a1000000-0000-4000-8000-000000000004')
                ON CONFLICT (firm_id, branch_id, category_id) DO NOTHING;

                UPDATE kitchen.tasks AS task
                SET station_id = mapping.station_id
                FROM sales.order_lines AS line
                INNER JOIN catalog.products AS product ON product.id = line.product_id
                INNER JOIN kitchen.station_categories AS mapping ON mapping.category_id = product.category_id
                WHERE line.id = task.order_line_id AND mapping.firm_id = task.firm_id
                    AND mapping.branch_id = task.branch_id;
                """);

            migrationBuilder.AddForeignKey(
                name: "FK_tasks_stations_station_id",
                schema: "kitchen",
                table: "tasks",
                column: "station_id",
                principalSchema: "kitchen",
                principalTable: "stations",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_tasks_stations_station_id",
                schema: "kitchen",
                table: "tasks");

            migrationBuilder.DropTable(
                name: "station_categories",
                schema: "kitchen");

            migrationBuilder.DropTable(
                name: "stations",
                schema: "kitchen");

            migrationBuilder.DropIndex(
                name: "IX_tasks_station_id",
                schema: "kitchen",
                table: "tasks");

            migrationBuilder.DropColumn(
                name: "station_id",
                schema: "kitchen",
                table: "tasks");
        }
    }
}
