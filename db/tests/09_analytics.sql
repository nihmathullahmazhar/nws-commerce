-- 09_analytics.sql
-- Reports agree with a hand-worked set of sales: net sales without tax or gift
-- cards, cost of goods from the units that left stock, returns putting cost back
-- only when restocked, days in the business's time zone, the previous period,
-- products, stock value and dead stock, customers, promotions, staff, and who
-- may see what.

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;
\ir _helpers.sql
select set_config('nwsc.pos_shift', 'test-suite', false);

\set a_owner   'b9000000-0000-0000-0000-000000000001'
\set a_cash    'b9000000-0000-0000-0000-000000000002'
\set a_branch  'b9000000-0000-0000-0000-000000000003'
insert into auth.users (id, email) values (:'a_owner', 'owner@reports.test'), (:'a_cash', 'cash@reports.test'),
  (:'a_branch', 'branch@reports.test');

select pg_temp.act_as_service();
select public.create_organization('Report Shop', 'report-shop', :'a_owner', 'retail') as org \gset
select id as main from public.locations where organization_id = :'org' \gset
select public.set_organization_module(:'org', 'multi_location', true);
select public.set_organization_module(:'org', 'loyalty', true);

select pg_temp.act_as(:'a_owner');
set role authenticated;
insert into public.locations (organization_id, code, name, kind) values (:'org', 'GALLE', 'Galle', 'store') returning id as galle \gset
insert into public.categories (organization_id, name, slug) values (:'org', 'Bags', 'bags') returning id as c_bags \gset
insert into public.customers (organization_id, full_name, phone) values (:'org', 'Ruwan', '+94770000001') returning id as ruwan \gset
insert into public.customers (organization_id, full_name, phone) values (:'org', 'Sara', '+94770000002') returning id as sara \gset
reset role;
select public.upsert_staff_member(:'org', :'a_cash', 'cashier');
select public.upsert_staff_member(:'org', :'a_branch', 'manager', array[:'galle']::uuid[]);
select public.save_product(:'org', jsonb_build_object('name', 'Tote', 'status', 'active', 'category_id', :'c_bags', 'variants', '[{"sku": "TOTE", "price": 1000}]'::jsonb));
select public.save_product(:'org', '{"name": "Repair", "status": "active", "tracking_mode": "non_stock", "variants": [{"sku": "FIX", "price": 500}]}') as p_fix \gset
select public.save_product(:'org', '{"name": "Old Clutch", "status": "active", "variants": [{"sku": "CLUTCH", "price": 3000}]}');
select public.save_product(:'org', '{"name": "Voucher", "status": "active", "tracking_mode": "non_stock", "variants": [{"sku": "GIFT", "price": 5000}]}') as p_gift \gset
select pg_temp.act_as_service();
update public.products set is_gift_card = true where id = :'p_gift';
select id as tote from public.product_variants where sku = 'TOTE' and organization_id = :'org' \gset
select id as fix from public.product_variants where sku = 'FIX' and organization_id = :'org' \gset
select id as clutch from public.product_variants where sku = 'CLUTCH' and organization_id = :'org' \gset
select id as gift from public.product_variants where sku = 'GIFT' and organization_id = :'org' \gset
select public.save_promotion(:'org', jsonb_build_object('name', 'Repairs 20% off', 'kind', 'percent_off', 'scope', 'products', 'value', 20,
  'product_ids', jsonb_build_array(:'p_fix'))) as promo \gset

select pg_temp.act_as(:'a_owner');
select public.receive_stock(:'main', jsonb_build_array(jsonb_build_object('variant_id', :'tote', 'quantity', 10, 'unit_cost', 600)));
select public.receive_stock(:'galle', jsonb_build_array(jsonb_build_object('variant_id', :'tote', 'quantity', 5, 'unit_cost', 600)));
-- The clutch arrived 90 days ago and has never sold: dead stock.
select pg_temp.act_as_service();
insert into public.inventory_movements (organization_id, location_id, variant_id, movement_type, quantity, unit_cost, source_type, created_at)
values (:'org', :'main', :'clutch', 'receipt', 2, 1500, 'opening_stock', now() - interval '90 days');

-- A sale in January, at 20:00 UTC = 01:30 the next day in Colombo.
select pg_temp.act_as(:'a_cash');
select public.place_order(:'galle', 'pos', jsonb_build_array(pg_temp.line(:'tote', 1)), :'sara',
  p_payments => '[{"method": "cash", "amount": 1000}]') as s0 \gset
select pg_temp.act_as_service();
update public.orders set placed_at = '2026-01-15 20:00:00+00' where id = (:'s0'::jsonb->>'order_id')::uuid;

-- Today:
--   s1  Main  2 x Tote                       2,000   cost 1,200   Ruwan
--   s2  Main  1 x Tote 10% off + Repair       900 + 400 (promo)   cost 600   Ruwan
--   s3  Main  gift card 5,000 (walk-in; not a sale)
--   s4  Galle 1 x Tote                       1,000   cost 600     Sara (by the branch manager)
--   return: 1 x Tote from s1, restocked -> -1,000 sales, +600 cost back
select pg_temp.act_as(:'a_cash');
select public.place_order(:'main', 'pos', jsonb_build_array(pg_temp.line(:'tote', 2)), :'ruwan',
  p_payments => '[{"method": "card", "amount": 2000}]') as s1 \gset
select pg_temp.act_as(:'a_owner');
select public.place_order(:'main', 'pos', jsonb_build_array(pg_temp.line(:'tote', 1) || '{"discount": {"type": "percent", "value": 10}}', pg_temp.line(:'fix', 1)), :'ruwan',
  p_payments => '[{"method": "cash", "amount": 1300}]') as s2 \gset
select pg_temp.act_as(:'a_cash');
select public.place_order(:'main', 'pos', jsonb_build_array(pg_temp.line(:'gift', 1)),
  p_payments => '[{"method": "cash", "amount": 5000}]') as s3 \gset
select pg_temp.act_as(:'a_branch');
select public.place_order(:'galle', 'pos', jsonb_build_array(pg_temp.line(:'tote', 1)), :'sara',
  p_payments => '[{"method": "card", "amount": 1000}]') as s4 \gset
select pg_temp.act_as(:'a_owner');
select public.create_return((:'s1'::jsonb->>'order_id')::uuid, :'main',
  jsonb_build_array(jsonb_build_object('order_line_id', (:'s1'::jsonb->'lines'->0->>'line_id'), 'quantity', 1)),
  '[{"method": "card"}]') as rt \gset
select public.inspect_return_line((:'rt'::jsonb->'lines'->0->>'return_line_id')::uuid, 'restock');

select (now() at time zone 'Asia/Colombo')::date as today \gset

\echo '--- sales'
select public.report_sales(:'org', :'today', :'today') as rs \gset
select pg_temp.ok((:'rs'::jsonb->'totals'->>'orders')::int = 4
                  and (:'rs'::jsonb->'totals'->>'order_value')::numeric = 2000 + 1300 + 5000 + 1000
                  and (:'rs'::jsonb->'totals'->>'gift_cards_sold')::numeric = 5000,
                  'four orders worth 9,300 were taken, 5,000 of it a gift card');
select pg_temp.ok((:'rs'::jsonb->'totals'->>'gross')::numeric = 4500
                  and (:'rs'::jsonb->'totals'->>'discounts')::numeric = 200
                  and (:'rs'::jsonb->'totals'->>'promo_discounts')::numeric = 100
                  and (:'rs'::jsonb->'totals'->>'manual_discounts')::numeric = 100
                  and (:'rs'::jsonb->'totals'->>'items')::numeric = 5,
                  'gross 4,500 less 100 promotion and 100 manual discount; the gift card is not an item');
select pg_temp.ok((:'rs'::jsonb->'totals'->>'returns')::numeric = 1000
                  and (:'rs'::jsonb->'totals'->>'net_sales')::numeric = 4300 - 1000
                  and (:'rs'::jsonb->'totals'->>'cogs')::numeric = 2400 - 600
                  and (:'rs'::jsonb->'totals'->>'gross_profit')::numeric = 3300 - 1800
                  and (:'rs'::jsonb->'totals'->>'margin')::numeric = 45.5,
                  'net sales 3,300 after the return; cost 1,800 once the restocked tote gave back 600; profit 1,500 (45.5%)');
select pg_temp.ok((:'rs'::jsonb->'totals'->>'average_sale')::numeric = 2325
                  and (:'rs'::jsonb->'totals'->>'customers')::int = 2,
                  'average sale 2,325 across two named customers');
select pg_temp.ok((select (x->>'net_sales')::numeric from jsonb_array_elements(:'rs'::jsonb->'by_location') x where x->>'name' = 'Galle') = 1000
                  and (select (x->>'net_sales')::numeric from jsonb_array_elements(:'rs'::jsonb->'by_location') x where x->>'location_id' = :'main') = 2300,
                  'by location: Main 2,300 after its return, Galle 1,000');
select pg_temp.ok((select (x->>'taken')::numeric from jsonb_array_elements(:'rs'::jsonb->'by_method') x where x->>'method' = 'card') = 3000
                  and (select (x->>'refunded')::numeric from jsonb_array_elements(:'rs'::jsonb->'by_method') x where x->>'method' = 'card') = 1000,
                  'by payment method: 3,000 taken on card, 1,000 refunded to card');
select pg_temp.ok(jsonb_array_length(:'rs'::jsonb->'series') = 1 and (:'rs'::jsonb->'series'->0->>'net_sales')::numeric = 3300
                  and (:'rs'::jsonb->'series'->0->>'gross_profit')::numeric = 1500,
                  'the day series carries the same net sales and profit');

select public.report_sales(:'org', '2026-01-14', '2026-01-17') as jan \gset
select pg_temp.ok(jsonb_array_length(:'jan'::jsonb->'series') = 4
                  and (select (x->>'orders')::int from jsonb_array_elements(:'jan'::jsonb->'series') x where x->>'bucket' = '2026-01-16') = 1
                  and (select (x->>'orders')::int from jsonb_array_elements(:'jan'::jsonb->'series') x where x->>'bucket' = '2026-01-15') = 0,
                  'a sale at 20:00 UTC on the 15th is counted on the 16th, the Colombo date; empty days still appear');
select pg_temp.ok((:'jan'::jsonb->'by_hour'->0->>'weekday')::int = 5 and (:'jan'::jsonb->'by_hour'->0->>'hour')::int = 1,
                  'the weekday-by-hour grid puts it on Friday at 01:00 local');
select pg_temp.ok((public.report_sales(:'org', '2026-01-17', '2026-01-17')->'previous'->>'orders')::int = 1
                  and public.report_sales(:'org', '2026-01-17', '2026-01-17')->'range'->>'previous_from' = '2026-01-16',
                  'the previous period is the same length immediately before');
select pg_temp.ok(jsonb_array_length(public.report_sales(:'org', '2026-01-01', '2026-03-31', p_interval => 'month')->'series') = 3,
                  'grouping by month gives one bucket per month');

\echo '--- products'
select public.report_products(:'org', :'today', :'today') as rp \gset
select pg_temp.ok((:'rp'::jsonb->'rows'->0->>'name') = 'Tote'
                  and (:'rp'::jsonb->'rows'->0->>'quantity')::numeric = 4
                  and (:'rp'::jsonb->'rows'->0->>'net_sales')::numeric = 2900
                  and (:'rp'::jsonb->'rows'->0->>'cogs')::numeric = 1800
                  and (:'rp'::jsonb->'rows'->0->>'returned')::numeric = 1
                  and (:'rp'::jsonb->'rows'->0->>'return_rate')::numeric = 25,
                  'Tote: 4 sold, 1 back (25%), 2,900 net, 1,800 cost');
select pg_temp.ok((:'rp'::jsonb->'rows'->1->>'name') = 'Repair' and (:'rp'::jsonb->'rows'->1->>'cogs')::numeric = 0
                  and (:'rp'::jsonb->>'net_sales')::numeric = 3300
                  and not exists (select 1 from jsonb_array_elements(:'rp'::jsonb->'rows') x where x->>'name' = 'Voucher'),
                  'a service has no cost; gift cards are not in the product ranking; the rows add up to net sales');
select pg_temp.ok((select (x->>'net_sales')::numeric from jsonb_array_elements(public.report_products(:'org', :'today', :'today', p_group => 'category')->'rows') x
                    where x->>'name' = 'No category') = 400,
                  'by category, uncategorised sales are grouped together');
select pg_temp.expect_error(format('select public.report_products(%L, %L, %L, p_group => %L)', :'org', :'today', :'today', 'colour'),
  'NC003', 'an unknown grouping is refused');

\echo '--- inventory'
select public.report_inventory(:'org') as ri \gset
select pg_temp.ok((:'ri'::jsonb->'totals'->>'units')::numeric = (10 - 3 + 1) + (5 - 2) + 2
                  and (:'ri'::jsonb->'totals'->>'value')::numeric = 11 * 600 + 2 * 1500,
                  'stock on hand is 13 units worth 9,600 at cost');
select pg_temp.ok((:'ri'::jsonb->'totals'->>'dead_variants')::int = 1 and (:'ri'::jsonb->'totals'->>'dead_value')::numeric = 3000
                  and (select (x->>'dead')::boolean from jsonb_array_elements(:'ri'::jsonb->'items') x where x->>'sku' = 'CLUTCH')
                  and not (select (x->>'dead')::boolean from jsonb_array_elements(:'ri'::jsonb->'items') x where x->>'sku' = 'TOTE'),
                  'the clutch, in stock 90 days and never sold, is dead stock; the tote is not');
select pg_temp.ok((select (x->>'sold')::numeric from jsonb_array_elements(:'ri'::jsonb->'items') x where x->>'sku' = 'TOTE') = 4
                  and (select (x->>'days_cover')::numeric from jsonb_array_elements(:'ri'::jsonb->'items') x where x->>'sku' = 'TOTE') = 83,
                  'the tote sold 4 net in 30 days (5 out, 1 back); 11 on hand is about 83 days of cover');
select pg_temp.ok((public.report_inventory(:'org', :'galle')->'totals'->>'units')::numeric = 3,
                  'one location''s stock can be reported on its own');

\echo '--- customers, promotions, staff'
select public.report_customers(:'org', :'today', :'today') as rc \gset
select pg_temp.ok((:'rc'::jsonb->'totals'->>'customers')::int = 2
                  and (:'rc'::jsonb->'totals'->>'new_customers')::int = 1
                  and (:'rc'::jsonb->'totals'->>'returning_customers')::int = 1
                  and (:'rc'::jsonb->'totals'->>'repeat_customers')::int = 1
                  and (:'rc'::jsonb->'totals'->>'walk_in_orders')::int = 1,
                  'Ruwan is new and bought twice; Sara bought before, in January; one sale was a walk-in');
select pg_temp.ok(:'rc'::jsonb->'top'->0->>'name' = 'Ruwan' and (:'rc'::jsonb->'top'->0->>'spent')::numeric = 3300,
                  'the top customer is Ruwan with 3,300');
select public.report_promotions(:'org', :'today', :'today') as rpm \gset
select pg_temp.ok((:'rpm'::jsonb->>'promo_discounts')::numeric = 100 and (:'rpm'::jsonb->>'manual_discounts')::numeric = 100
                  and :'rpm'::jsonb->'promotions'->0->>'name' = 'Repairs 20% off'
                  and (:'rpm'::jsonb->'promotions'->0->>'orders')::int = 1,
                  'promotions gave 100 away on one order; staff discounts another 100');
select public.report_staff(:'org', :'today', :'today') as rst \gset
select pg_temp.ok((select (x->>'orders')::int from jsonb_array_elements(:'rst'::jsonb->'staff') x where x->>'name' = 'cash@reports.test') = 2
                  and (select (x->>'returns')::int from jsonb_array_elements(:'rst'::jsonb->'staff') x where x->>'name' = 'owner@reports.test') = 1
                  and (select (x->>'manual_discounts')::numeric from jsonb_array_elements(:'rst'::jsonb->'staff') x where x->>'name' = 'owner@reports.test') = 100,
                  'per person: the cashier rang up two sales; the owner gave the 100 discount and took the return');

\echo '--- who may see reports'
select pg_temp.act_as(:'a_branch');
select pg_temp.ok((public.report_sales(:'org', :'today', :'today')->'totals'->>'orders')::int = 1
                  and (public.report_sales(:'org', :'today', :'today')->'totals'->>'net_sales')::numeric = 1000
                  and (public.report_inventory(:'org')->'totals'->>'units')::numeric = 3,
                  'a manager limited to Galle sees only Galle''s sales and stock');
select pg_temp.expect_error(format('select public.report_sales(%L, %L, %L, %L)', :'org', :'today', :'today', :'main'),
  '42501', 'and cannot ask for another location');
select pg_temp.act_as(:'a_cash');
select pg_temp.expect_error(format('select public.report_sales(%L, %L, %L)', :'org', :'today', :'today'),
  '42501', 'a cashier cannot see reports');
select pg_temp.act_as(:'a_owner');
select pg_temp.expect_error(format('select public.report_sales(%L, %L, %L)', :'org', :'today', '2026-01-01'),
  'NC003', 'a range that ends before it starts is refused');
select pg_temp.expect_error(format('select public._report_lines(%L, now(), now(), null, null, null)', :'org'),
  '42501', 'the raw report helpers are not callable by staff', 'authenticated');
