using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hipos.Api.Sales.Migrations
{
    /// <inheritdoc />
    public partial class AddKitchenOrderSnapshots : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "kitchen_items_json",
                schema: "sales",
                table: "orders",
                type: "jsonb",
                nullable: false,
                defaultValue: "[]");

            migrationBuilder.Sql("""
                UPDATE sales.orders AS order_row
                SET kitchen_items_json = COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                        'ProductId', line.product_id::text,
                        'ProductName', line.product_name,
                        'Quantity', line.quantity,
                        'Note', line.note,
                        'Options', COALESCE(line.options_json, '[]'::jsonb)
                    ) ORDER BY line.id)
                    FROM sales.order_lines AS line
                    WHERE line.order_id = order_row.id
                ), '[]'::jsonb);

                WITH RECURSIVE split_tree(root_check_id, target_check_id, firm_id, branch_id) AS (
                    SELECT split.source_check_id, split.target_check_id, split.firm_id, split.branch_id
                    FROM sales.check_splits AS split
                    WHERE NOT EXISTS (
                        SELECT 1 FROM sales.check_splits AS previous
                        WHERE previous.target_check_id = split.source_check_id
                          AND previous.firm_id = split.firm_id
                          AND previous.branch_id = split.branch_id
                    )
                    UNION ALL
                    SELECT tree.root_check_id, split.target_check_id, tree.firm_id, tree.branch_id
                    FROM split_tree AS tree
                    JOIN sales.check_splits AS split
                      ON split.source_check_id = tree.target_check_id
                     AND split.firm_id = tree.firm_id
                     AND split.branch_id = tree.branch_id
                ), split_kitchen_items AS (
                    SELECT tree.root_check_id, tree.firm_id, tree.branch_id,
                        jsonb_agg(item.value ORDER BY split_order.created_at, split_order.id, item.ordinality) AS items
                    FROM split_tree AS tree
                    JOIN sales.orders AS split_order
                      ON split_order.check_id = tree.target_check_id
                     AND split_order.firm_id = tree.firm_id
                     AND split_order.branch_id = tree.branch_id
                     AND split_order.source = 'split'
                    CROSS JOIN LATERAL jsonb_array_elements(split_order.kitchen_items_json)
                        WITH ORDINALITY AS item(value, ordinality)
                    GROUP BY tree.root_check_id, tree.firm_id, tree.branch_id
                ), root_kitchen_orders AS (
                    SELECT DISTINCT ON (order_row.check_id)
                        order_row.id, order_row.check_id, order_row.firm_id, order_row.branch_id
                    FROM sales.orders AS order_row
                    WHERE order_row.source = 'waiter_web'
                    ORDER BY order_row.check_id, order_row.created_at, order_row.id
                )
                UPDATE sales.orders AS kitchen_order
                SET kitchen_items_json = kitchen_order.kitchen_items_json || split_items.items
                FROM split_kitchen_items AS split_items
                JOIN root_kitchen_orders AS root_order
                  ON root_order.check_id = split_items.root_check_id
                 AND root_order.firm_id = split_items.firm_id
                 AND root_order.branch_id = split_items.branch_id
                WHERE kitchen_order.id = root_order.id;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "kitchen_items_json",
                schema: "sales",
                table: "orders");
        }
    }
}
