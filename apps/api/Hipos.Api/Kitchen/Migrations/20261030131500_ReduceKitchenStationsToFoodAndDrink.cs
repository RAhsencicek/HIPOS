using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Kitchen.Migrations
{
    /// <inheritdoc />
    public partial class ReduceKitchenStationsToFoodAndDrink : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                UPDATE kitchen.stations 
                SET code = 'food', name = 'Yiyecek', is_active = TRUE 
                WHERE id = 'a1000000-0000-4000-8000-000000000001';

                INSERT INTO kitchen.stations (id, firm_id, branch_id, code, name, is_active)
                VALUES ('a1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'food', 'Yiyecek', TRUE)
                ON CONFLICT (firm_id, branch_id, code) DO UPDATE SET name = 'Yiyecek', is_active = TRUE;

                UPDATE kitchen.stations 
                SET code = 'drink', name = 'İçecek', is_active = TRUE 
                WHERE id = 'a1000000-0000-4000-8000-000000000003';

                INSERT INTO kitchen.stations (id, firm_id, branch_id, code, name, is_active)
                VALUES ('a1000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'drink', 'İçecek', TRUE)
                ON CONFLICT (firm_id, branch_id, code) DO UPDATE SET name = 'İçecek', is_active = TRUE;

                UPDATE kitchen.tasks 
                SET station_id = 'a1000000-0000-4000-8000-000000000001'
                WHERE station_id IN ('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000004');

                UPDATE kitchen.tasks 
                SET station_id = 'a1000000-0000-4000-8000-000000000003'
                WHERE station_id = 'a1000000-0000-4000-8000-000000000003';

                DELETE FROM kitchen.station_categories 
                WHERE firm_id = '11111111-1111-4111-8111-111111111111' 
                  AND branch_id = '33333333-3333-4333-8333-333333333333';

                INSERT INTO kitchen.station_categories (firm_id, branch_id, category_id, station_id)
                VALUES 
                    ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'pizza', 'a1000000-0000-4000-8000-000000000001'),
                    ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'sandwich', 'a1000000-0000-4000-8000-000000000001'),
                    ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'dessert', 'a1000000-0000-4000-8000-000000000001'),
                    ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'drinks', 'a1000000-0000-4000-8000-000000000003')
                ON CONFLICT (firm_id, branch_id, category_id) DO UPDATE SET station_id = EXCLUDED.station_id;

                DELETE FROM kitchen.stations 
                WHERE id IN ('a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000004');
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
        }
    }
}
