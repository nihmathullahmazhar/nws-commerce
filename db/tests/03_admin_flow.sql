-- 03_admin_flow.sql
-- The admin app's commands and read models: atomic product save with options and
-- variants, settings, staff by email, variant search, stock overview with cost
-- hidden from those who may not see it, movement history, dashboard.

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;
\ir _helpers.sql

-- Direct database sessions (these suites) stand in for the till: counter sales
-- need an open shift, which pos_sale() marks per transaction. 05_pos_flow.sql
-- tests the real path and that the API cannot skip it.
select set_config('nwsc.pos_shift', 'test-suite', false);

\set a_owner   'c0000000-0000-0000-0000-000000000001'
\set a_cashier 'c0000000-0000-0000-0000-000000000002'
\set a_newbie  'c0000000-0000-0000-0000-000000000003'

insert into auth.users (id, email) values
  (:'a_owner', 'owner@admin.test'), (:'a_cashier', 'cashier@admin.test'), (:'a_newbie', 'newbie@admin.test');

select pg_temp.act_as_service();
select public.create_organization('Admin Shop', 'admin-shop', :'a_owner', 'retail') as org \gset
select id as main from public.locations where organization_id = :'org' \gset
select pg_temp.act_as(:'a_owner');
select public.upsert_staff_member(:'org', :'a_cashier', 'cashier');

-- ---------------------------------------------------------------------------
-- 1. Workspaces and settings
-- ---------------------------------------------------------------------------
\echo '--- workspaces and settings'
select pg_temp.ok((select count(*) = 1 and bool_and(role = 'owner' and 'pos' = any (modules) and '*' = any (permissions))
                     from public.my_workspaces()),
                  'the owner sees their one workspace with role, permissions and modules');
select pg_temp.ok((public.update_organization_settings(:'org',
                     '{"settings": {"discount_limits": {"cashier": 5}, "checkout_hold_minutes": 20}}')->'discount_limits'->>'cashier')::numeric = 5,
                  'the owner sets a 5% cashier discount limit');
select pg_temp.expect_error(format('select public.update_organization_settings(%L, %L)', :'org', '{"settings": {"plan": "enterprise"}}'),
  'NC003', 'settings outside the whitelist are refused (no self-upgrading the plan)');
select pg_temp.expect_error(format('select public.update_organization_settings(%L, %L)', :'org', '{"settings": {"discount_limits": {"cashier": 150}}}'),
  'NC003', 'discount limits stay within 0-100');
select pg_temp.act_as(:'a_cashier');
select pg_temp.expect_error(format('select public.update_organization_settings(%L, %L)', :'org', '{"name": "Mine now"}'),
  '42501', 'a cashier cannot change settings');

-- ---------------------------------------------------------------------------
-- 2. Staff
-- ---------------------------------------------------------------------------
\echo '--- staff'
select pg_temp.act_as(:'a_owner');
select pg_temp.expect_error(format('select public.add_staff_by_email(%L, %L, %L)', :'org', 'nobody@nowhere.test', 'cashier'),
  'NC005', 'adding someone without an account says so');
select public.add_staff_by_email(:'org', 'NEWBIE@admin.test', 'stock_keeper');
select pg_temp.ok((select count(*) = 3 and bool_or(email = 'newbie@admin.test' and role = 'stock_keeper')
                     from public.list_staff(:'org')),
                  'staff are added by email (any case) and listed with their emails');
select pg_temp.act_as(:'a_cashier');
select pg_temp.expect_error(format('select * from public.list_staff(%L)', :'org'), '42501', 'a cashier cannot list staff');

-- ---------------------------------------------------------------------------
-- 3. save_product
-- ---------------------------------------------------------------------------
\echo '--- save_product'
select pg_temp.act_as(:'a_owner');
select public.save_product(:'org', '{
  "name": "Linen Shirt", "status": "active",
  "options": [{"name": "Size", "values": ["S", "M"]}, {"name": "Colour", "values": ["Sand"]}],
  "variants": [
    {"option_values": ["S", "Sand"], "sku": "LIN-S", "barcode": "4791111000011", "price": 4500},
    {"option_values": ["M", "Sand"], "sku": "LIN-M", "price": 4500, "compare_at_price": 5200}]}') as shirt \gset

select pg_temp.ok((select slug from public.products where id = :'shirt') = 'linen-shirt'
                  and (select string_agg(title, ',' order by position) from public.product_variants where product_id = :'shirt') = 'S / Sand,M / Sand',
                  'a product is saved with its slug, options and titled variants in one call');
select pg_temp.ok((select count(*) from public.variant_option_values vov
                     join public.product_variants v on v.id = vov.variant_id where v.product_id = :'shirt') = 4,
                  'each variant is linked to one value per option');

select public.save_product(:'org', '{"name": "Linen Shirt", "variants": [{"price": 100, "sku": "LIN-OTHER"}]}') as shirt2 \gset
select pg_temp.ok((select slug from public.products where id = :'shirt2') = 'linen-shirt-2', 'a clashing slug gets a suffix');

select id as var_s from public.product_variants where sku = 'LIN-S' \gset
select public.save_product(:'org', jsonb_build_object(
  'id', :'shirt', 'name', 'Linen Shirt', 'status', 'active',
  'options', '[{"name": "Size", "values": ["S", "L"]}, {"name": "Colour", "values": ["Sand"]}]'::jsonb,
  'variants', jsonb_build_array(
     jsonb_build_object('id', :'var_s', 'option_values', jsonb_build_array('S', 'Sand'), 'sku', 'LIN-S',
                        'barcode', '4791111000011', 'price', 4700),
     jsonb_build_object('option_values', jsonb_build_array('L', 'Sand'), 'sku', 'LIN-L', 'price', 4900))));
select pg_temp.ok((select price from public.product_variants where id = :'var_s') = 4700
                  and (select is_active from public.product_variants where sku = 'LIN-M') = false
                  and exists (select 1 from public.product_variants where sku = 'LIN-L' and title = 'L / Sand' and is_active),
                  'editing keeps variant ids, deactivates dropped variants and adds new ones');

select pg_temp.expect_error(format('select public.save_product(%L, %L)', :'org',
  '{"name": "Dupes", "options": [{"name": "Size", "values": ["S"]}], "variants": [{"option_values": ["S"], "price": 1}, {"option_values": ["S"], "price": 2}]}'),
  'NC003', 'two variants cannot be the same combination');
select pg_temp.expect_error(format('select public.save_product(%L, %L)', :'org',
  '{"name": "Stray", "options": [{"name": "Size", "values": ["S"]}], "variants": [{"option_values": ["XL"], "price": 1}]}'),
  'NC003', 'a variant cannot use a value its option does not have');
select pg_temp.expect_error(format('select public.save_product(%L, %L)', :'org',
  '{"name": "Copycat", "variants": [{"sku": "lin-s", "price": 1}]}'),
  'NC003', 'a duplicate SKU is refused with a readable message');
select pg_temp.expect_error(format('select public.save_product(%L, %L)', :'org', '{"name": "Empty", "variants": []}'),
  'NC003', 'a product needs at least one variant');
select pg_temp.expect_error(format('select public.save_product(%L, %L)', :'org',
  '{"name": "Bad price", "variants": [{"price": 100, "compare_at_price": 50}]}'),
  'NC003', 'a compare-at price must be above the price');
select pg_temp.expect_error(format('select public.save_product(%L, %L)', :'org',
  '{"name": "Phone", "tracking_mode": "serial", "variants": [{"price": 1}]}'),
  'NC002', 'save_product still respects modules');
select pg_temp.ok((select count(*) from public.products where organization_id = :'org') = 2,
                  'failed saves leave nothing half-written');

select pg_temp.act_as(:'a_cashier');
select pg_temp.expect_error(format('select public.save_product(%L, %L)', :'org', '{"name": "X", "variants": [{"price": 1}]}'),
  '42501', 'a cashier cannot save products');

-- ---------------------------------------------------------------------------
-- 4. Stock views: search, overview, cost visibility, history, thresholds
-- ---------------------------------------------------------------------------
\echo '--- stock views'
select pg_temp.act_as(:'a_owner');
select public.receive_stock(:'main', jsonb_build_array(
  jsonb_build_object('variant_id', :'var_s', 'quantity', 4, 'unit_cost', 2000)), 'SUP-INV-1') ->> 'number' as rcv \gset

select pg_temp.act_as(:'a_cashier');
select pg_temp.ok((select count(*) = 1 and bool_and(sku = 'LIN-S' and on_hand = 4)
                     from public.search_variants(:'org', '4791111000011')),
                  'a barcode finds its variant with stock');
select pg_temp.ok((select count(*) from public.search_variants(:'org', 'lin-')) = 3,
                  'an SKU prefix finds the active variants');
select pg_temp.ok((select avg_unit_cost is null and stock_value is null and on_hand = 4
                     from public.stock_overview(:'org') where variant_id = :'var_s'),
                  'a cashier sees stock but not cost');
select pg_temp.expect_error('select avg_unit_cost from public.stock_levels', '42501',
  'a cashier cannot read cost from the table directly', 'authenticated');
select pg_temp.expect_error('select unit_cost from public.inventory_movements', '42501',
  'a cashier cannot read movement costs directly', 'authenticated');

select pg_temp.act_as(:'a_owner');
select pg_temp.ok((select avg_unit_cost = 2000 and stock_value = 8000
                     from public.stock_overview(:'org') where variant_id = :'var_s'),
                  'the owner sees average cost and stock value');
select pg_temp.ok((select reference = :'rcv' and actor_email = 'owner@admin.test' and unit_cost = 2000
                     from public.stock_movements(:'org', :'var_s') limit 1),
                  'movement history shows the receipt number, who did it and the cost');

select public.set_low_stock_threshold(:'main', :'var_s', 5);
select pg_temp.ok((select is_low from public.stock_overview(:'org', p_low_only => true) where variant_id = :'var_s'),
                  'below its threshold, an item shows as low stock');

-- ---------------------------------------------------------------------------
-- 5. Dashboard
-- ---------------------------------------------------------------------------
\echo '--- dashboard'
select pg_temp.act_as(:'a_cashier');
select public.place_order(:'main', 'pos', jsonb_build_array(pg_temp.line(:'var_s', 1)),
                          p_payments => '[{"method": "card", "amount": 4700}]');
select pg_temp.expect_error(format('select public.dashboard_summary(%L, now() - interval ''1 day'', now())', :'org'),
  '42501', 'a cashier cannot see the dashboard figures');

select pg_temp.act_as(:'a_owner');
select public.dashboard_summary(:'org', date_trunc('day', now()), now() + interval '1 minute') as dash \gset
select pg_temp.ok((:'dash'::jsonb->'totals'->>'sales')::numeric = 4700
                  and :'dash'::jsonb->'by_channel'->0->>'channel' = 'pos'
                  and :'dash'::jsonb->'by_method'->0->>'method' = 'card'
                  and (:'dash'::jsonb->>'low_stock')::int = 1,
                  'today''s sales, channel split, payment split and low stock add up');
select pg_temp.ok((:'dash'::jsonb->'setup'->>'has_product')::boolean and not (:'dash'::jsonb->'setup'->>'has_tax_rate')::boolean,
                  'the setup checklist knows what is done and what is not');
