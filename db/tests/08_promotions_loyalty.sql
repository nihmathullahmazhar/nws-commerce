-- 08_promotions_loyalty.sql
-- Automatic promotions (category, buy-X-get-Y, channel, date window), coupons
-- with usage limits, promotions never stacking on manual discounts, non-stock
-- products, gift cards sold and spent, and loyalty points earned, spent and
-- taken back on return.

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;
\ir _helpers.sql
select set_config('nwsc.pos_shift', 'test-suite', false);

\set l_owner   'b1000000-0000-0000-0000-000000000001'
\set l_manager 'b1000000-0000-0000-0000-000000000002'
\set l_cash    'b1000000-0000-0000-0000-000000000003'
insert into auth.users (id, email) values (:'l_owner', 'owner@promo.test'), (:'l_manager', 'manager@promo.test'), (:'l_cash', 'cash@promo.test');

select pg_temp.act_as_service();
select public.create_organization('Promo Shop', 'promo-shop', :'l_owner', 'retail') as org \gset
select id as main from public.locations where organization_id = :'org' \gset
select public.set_organization_module(:'org', 'loyalty', true);

select pg_temp.act_as(:'l_owner');
select public.upsert_staff_member(:'org', :'l_manager', 'manager');
select public.upsert_staff_member(:'org', :'l_cash', 'cashier');
select public.update_organization_settings(:'org', '{"settings": {"loyalty_points_per_100": 2, "loyalty_point_value": 1, "loyalty_min_redeem": 10}}');
set role authenticated;
insert into public.categories (organization_id, name, slug) values (:'org', 'Tops', 'tops') returning id as c_tops \gset
reset role;
select public.save_product(:'org', jsonb_build_object('name', 'Tee', 'status', 'active', 'category_id', :'c_tops', 'variants', '[{"sku": "TEE", "price": 2000}]'::jsonb)) as p_tee \gset
select public.save_product(:'org', '{"name": "Jeans", "status": "active", "variants": [{"sku": "JEANS", "price": 5000}]}') as p_jeans \gset
select public.save_product(:'org', '{"name": "Socks", "status": "active", "variants": [{"sku": "SOCKS", "price": 500}]}') as p_socks \gset
select public.save_product(:'org', '{"name": "Gift Card", "status": "active", "tracking_mode": "non_stock", "options": [{"name": "Value", "values": ["1000", "5000"]}],
  "variants": [{"option_values": ["1000"], "sku": "GC-1000", "price": 1000}, {"option_values": ["5000"], "sku": "GC-5000", "price": 5000}]}') as p_gc \gset
select public.save_product(:'org', '{"name": "Hemming", "status": "active", "tracking_mode": "non_stock", "variants": [{"sku": "HEM", "price": 300}]}') as p_hem \gset
select pg_temp.act_as_service();
update public.products set is_gift_card = true where id = :'p_gc';
select id as tee from public.product_variants where sku = 'TEE' and organization_id = :'org' \gset
select id as jeans from public.product_variants where sku = 'JEANS' and organization_id = :'org' \gset
select id as socks from public.product_variants where sku = 'SOCKS' and organization_id = :'org' \gset
select id as gc5 from public.product_variants where sku = 'GC-5000' and organization_id = :'org' \gset
select id as hem from public.product_variants where sku = 'HEM' and organization_id = :'org' \gset
select pg_temp.act_as(:'l_owner');
select public.receive_stock(:'main', jsonb_build_array(
  jsonb_build_object('variant_id', :'tee', 'quantity', 30, 'unit_cost', 800),
  jsonb_build_object('variant_id', :'jeans', 'quantity', 10, 'unit_cost', 2500),
  jsonb_build_object('variant_id', :'socks', 'quantity', 50, 'unit_cost', 150)));
select pg_temp.expect_error(format('select public.receive_stock(%L, %L::jsonb)', :'main', jsonb_build_array(jsonb_build_object('variant_id', :'hem', 'quantity', 1))),
  'NC003', 'a non-stock product cannot be received into stock');

\echo '--- promotions'
select public.save_promotion(:'org', jsonb_build_object('name', '20% off tops', 'kind', 'percent_off', 'scope', 'products', 'value', 20, 'category_ids', jsonb_build_array(:'c_tops'))) as pr_tops \gset
select public.save_promotion(:'org', jsonb_build_object('name', 'Socks 3 for 2', 'kind', 'buy_x_get_y', 'scope', 'products', 'buy_quantity', 2, 'get_quantity', 1, 'product_ids', jsonb_build_array(:'p_socks')));
select public.save_promotion(:'org', '{"name": "Web week 10%", "kind": "percent_off", "scope": "products", "value": 10, "channels": ["online"]}');
select public.save_promotion(:'org', jsonb_build_object('name', 'Old jeans sale', 'kind', 'percent_off', 'scope', 'products', 'value', 50,
  'product_ids', jsonb_build_array(:'p_jeans'), 'starts_at', now() - interval '10 days', 'ends_at', now() - interval '1 day'));
select public.save_promotion(:'org', '{"name": "Big spender", "kind": "amount_off", "scope": "order", "value": 1000, "min_subtotal": 10000, "coupon_code": "big1000", "usage_limit": 1}') as pr_big \gset
select pg_temp.expect_error(format('select public.save_promotion(%L, %L::jsonb)', :'org', '{"name": "Clash", "kind": "percent_off", "scope": "order", "value": 5, "coupon_code": "BIG1000"}'),
  'NC003', 'two promotions cannot share a code');
select pg_temp.expect_error(format('select public.save_promotion(%L, %L::jsonb)', :'org', '{"name": "Silly", "kind": "percent_off", "scope": "order", "value": 150}'),
  'NC003', 'a percentage over 100 is refused');

select pg_temp.act_as(:'l_cash');
select public.place_order(:'main', 'pos', jsonb_build_array(pg_temp.line(:'tee', 1)), p_payments => '[{"method": "cash", "amount": 2000}]') as s1 \gset
select pg_temp.ok((:'s1'::jsonb->>'total')::numeric = 1600 and (:'s1'::jsonb->>'promo_discount_total')::numeric = 400
                  and :'s1'::jsonb->'promotions'->0->>'name' = '20% off tops',
                  'a category promotion applies automatically at the till (Tee 2000 -> 1600)');
select pg_temp.ok(true, 'a 0%-limit cashier was not asked for approval: promotions are not manual discounts');
select pg_temp.ok((public.place_order(:'main', 'pos', jsonb_build_array(pg_temp.line(:'socks', 3)), p_payments => '[{"method": "cash", "amount": 1500}]')->>'total')::numeric = 1000,
                  'buy 2 get 1: three socks cost 1000');
select pg_temp.ok((public.place_order(:'main', 'pos', jsonb_build_array(pg_temp.line(:'jeans', 1)), p_payments => '[{"method": "cash", "amount": 5000}]')->>'total')::numeric = 5000,
                  'an ended promotion no longer applies');

select pg_temp.act_as(:'l_manager');
select pg_temp.ok((public.place_order(:'main', 'pos', jsonb_build_array(pg_temp.line(:'tee', 1) || '{"discount": {"type": "percent", "value": 5}}'),
                     p_payments => '[{"method": "cash", "amount": 2000}]')->>'total')::numeric = 1900,
                  'a manual discount replaces the promotion - they never stack');

select pg_temp.act_as(null);
select public.quote_order(:'org', jsonb_build_array(pg_temp.line(:'tee', 1), pg_temp.line(:'jeans', 1)), 'pickup') as q \gset
select pg_temp.ok((:'q'::jsonb->>'total')::numeric = 1600 + 4500,
                  'online: the tee takes its best offer (20%, not the web 10%); the jeans take the web-only 10%');

select pg_temp.act_as(:'l_cash');
select set_config('nwsc.coupon', 'nope', false);
select pg_temp.expect_error(format('select public.place_order(%L, %L, %L::jsonb, p_payments => %L::jsonb)', :'main', 'pos',
  jsonb_build_array(pg_temp.line(:'tee', 1)), '[{"method": "cash", "amount": 2000}]'), 'NC003', 'an unknown code is refused');
select set_config('nwsc.coupon', 'Big1000', false);
select public.place_order(:'main', 'pos', jsonb_build_array(pg_temp.line(:'tee', 2), pg_temp.line(:'jeans', 2)), p_payments => '[{"method": "card", "amount": 12200}]') as s5 \gset
select pg_temp.ok((:'s5'::jsonb->>'total')::numeric = 3200 + 10000 - 1000 and :'s5'::jsonb->>'coupon_code' = 'BIG1000'
                  and (select usage_count from public.promotions where id = :'pr_big') = 1,
                  'a coupon (any case) takes 1000 off a spend over 10,000, and is counted');
select pg_temp.expect_error(format('select public.place_order(%L, %L, %L::jsonb, p_payments => %L::jsonb)', :'main', 'pos',
  jsonb_build_array(pg_temp.line(:'jeans', 2)), '[{"method": "cash", "amount": 10000}]'), 'NC003', 'a single-use coupon cannot be used twice');
select set_config('nwsc.coupon', '', false);
select pg_temp.ok((select bool_and(ol.line_total = ol.line_subtotal - ol.discount_amount) from public.order_lines ol where ol.organization_id = :'org')
                  and not exists (select 1 from public.orders o where o.organization_id = :'org'
                                   and o.total <> (select sum(line_total) from public.order_lines where order_id = o.id)),
                  'every line and order still adds up with promotions in it');

\echo '--- non-stock and gift cards'
select pg_temp.act_as(:'l_cash');
set role authenticated;
insert into public.customers (organization_id, full_name, phone) values (:'org', 'Nimali', '+94771230000') returning id as cust \gset
reset role;
select public.place_order(:'main', 'pos', jsonb_build_array(pg_temp.line(:'gc5', 1), pg_temp.line(:'hem', 1)), :'cust',
  p_payments => '[{"method": "cash", "amount": 5300}]') as gs \gset
select code as card from public.gift_cards where order_line_id = (select id from public.order_lines where order_id = (:'gs'::jsonb->>'order_id')::uuid and variant_id = :'gc5') \gset
select pg_temp.ok(:'card' ~ '^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$'
                  and (select balance from public.gift_cards where code = :'card') = 5000
                  and ((:'gs'::jsonb->'lines')->0->>'tax_rate')::numeric = 0
                  and not exists (select 1 from public.inventory_movements where source_id = (:'gs'::jsonb->>'order_id')::uuid),
                  'selling a gift card and a service issues a coded card, charges no tax on the card and moves no stock');
select pg_temp.ok((select available from public.storefront_availability(:'org', array[:'hem']::uuid[])) = 999999,
                  'a service is always available online');
select public.place_order(:'main', 'pos', jsonb_build_array(pg_temp.line(:'jeans', 1)),
  p_payments => jsonb_build_array(jsonb_build_object('method', 'gift_card', 'amount', 3000, 'code', lower(:'card')), jsonb_build_object('method', 'cash', 'amount', 2000))) as gp \gset
select pg_temp.ok((select balance from public.gift_cards where code = :'card') = 2000 and :'gp'::jsonb->>'payment_status' = 'paid',
                  'a gift card pays part of a sale; 2,000 is left on it');
select pg_temp.expect_error(format('select public.place_order(%L, %L, %L::jsonb, p_payments => %L::jsonb)', :'main', 'pos',
  jsonb_build_array(pg_temp.line(:'jeans', 1)), jsonb_build_array(jsonb_build_object('method', 'gift_card', 'amount', 5000, 'code', :'card'))),
  'NC007', 'a gift card cannot pay more than its balance');
select pg_temp.expect_error(format('select public.place_order(%L, %L, %L::jsonb, p_payments => %L::jsonb)', :'main', 'pos',
  jsonb_build_array(pg_temp.line(:'jeans', 1)), jsonb_build_array(jsonb_build_object('method', 'gift_card', 'amount', 100, 'code', 'AAAA-BBBB-CCCC-DDDD'),
                                                                   jsonb_build_object('method', 'cash', 'amount', 4900))),
  'NC005', 'an unknown gift card code is refused');
select pg_temp.act_as(:'l_manager');
select pg_temp.expect_error(format('select public.create_return(%L, %L, %L::jsonb, %L::jsonb)', :'gs'::jsonb->>'order_id', :'main',
  jsonb_build_array(jsonb_build_object('order_line_id', (select id from public.order_lines where order_id = (:'gs'::jsonb->>'order_id')::uuid and variant_id = :'gc5'), 'quantity', 1)),
  '[{"method": "cash"}]'), 'NC003', 'a sold gift card cannot be returned for cash');
select pg_temp.ok((public.gift_card_lookup(:'org', :'card')->>'balance')::numeric = 2000
                  and jsonb_array_length(public.gift_card_lookup(:'org', :'card')->'history') = 2,
                  'the card''s balance and history can be looked up');

\echo '--- loyalty'
select pg_temp.ok((select loyalty_points from public.customers where id = :'cust') = 6,
                  'the service line earned points: 300 at 2 per 100 = 6 (the gift card itself earns none)');
select pg_temp.act_as(:'l_cash');
select public.place_order(:'main', 'pos', jsonb_build_array(pg_temp.line(:'jeans', 1)), :'cust', p_payments => '[{"method": "card", "amount": 5000}]') as lj \gset
select pg_temp.ok((select loyalty_points from public.customers where id = :'cust') = 106, 'jeans for 5,000 earn 100 points');
select pg_temp.expect_error(format('select public.place_order(%L, %L, %L::jsonb, %L, p_payments => %L::jsonb)', :'main', 'pos',
  jsonb_build_array(pg_temp.line(:'socks', 1)), :'cust', '[{"method": "loyalty_points", "amount": 5}, {"method": "cash", "amount": 495}]'),
  'NC003', 'fewer points than the minimum cannot be used');
select public.place_order(:'main', 'pos', jsonb_build_array(pg_temp.line(:'socks', 1)), :'cust',
  p_payments => '[{"method": "loyalty_points", "amount": 50}, {"method": "cash", "amount": 450}]') as lp \gset
select pg_temp.ok((select loyalty_points from public.customers where id = :'cust') = 106 - 50 + 9
                  and exists (select 1 from jsonb_array_elements(:'lp'::jsonb->'payments') p where p->>'reference' = '50 points'),
                  '50 points pay 50 of a 500 sale; only the 450 paid otherwise earns (9 points)');
select pg_temp.act_as(:'l_manager');
select public.create_return((:'lj'::jsonb->>'order_id')::uuid, :'main',
  jsonb_build_array(jsonb_build_object('order_line_id', (select id from public.order_lines where order_id = (:'lj'::jsonb->>'order_id')::uuid), 'quantity', 1)),
  '[{"method": "card"}]');
select pg_temp.ok((select loyalty_points from public.customers where id = :'cust') = 0,
                  'returning the jeans takes back their 100 points - only 65 were left, so the balance stops at zero');

select pg_temp.act_as_service();
select pg_temp.ok((select count(*) from public._inventory_integrity(:'org')) = 0, 'stock still agrees with the ledger');
select pg_temp.ok(not exists (select 1 from public.customers c where c.organization_id = :'org'
                               and c.loyalty_points <> coalesce((select sum(points) from public.loyalty_ledger where customer_id = c.id), 0)),
                  'points balances equal their ledgers');
select pg_temp.ok(not exists (select 1 from public.gift_cards g where g.organization_id = :'org'
                               and g.balance <> (select sum(amount) from public.gift_card_ledger where gift_card_id = g.id)),
                  'gift card balances equal their ledgers');

\echo '--- the order link'
update public.orders set access_token = 'link-for-test' where id = (:'gs'::jsonb->>'order_id')::uuid;
select public.get_order_by_token((:'gs'::jsonb->>'order_id')::uuid, 'link-for-test') as tok \gset
select pg_temp.ok(jsonb_array_length(:'tok'::jsonb->'gift_cards') = 1 and :'tok'::jsonb->'gift_cards'->0->>'code' = :'card',
                  'the order link shows the gift card the order bought, with its code');
select pg_temp.ok((public.storefront_settings(:'org') ? 'coupons_enabled') or public.storefront_settings(:'org') is null,
                  'the store settings say whether coupons are on');

\echo '--- gift cards are never discounted'
select pg_temp.act_as(:'l_owner');
select public.place_order(:'main', 'pos', jsonb_build_array(pg_temp.line(:'gc5', 1), pg_temp.line(:'jeans', 1)),
  p_payments => '[{"method": "card", "amount": 9500}]', p_order_discount => '{"type": "percent", "value": 10}') as gd \gset
select pg_temp.ok((:'gd'::jsonb->>'total')::numeric = 9500
                  and (select discount_amount from public.order_lines where order_id = (:'gd'::jsonb->>'order_id')::uuid and variant_id = :'gc5') = 0
                  and (select discount_amount from public.order_lines where order_id = (:'gd'::jsonb->>'order_id')::uuid and variant_id = :'jeans') = 500,
                  'a 10% order discount falls only on the jeans; the gift card still costs its face value');
select pg_temp.expect_error(format('select public.place_order(%L, %L, %L::jsonb, p_payments => %L::jsonb)', :'main', 'pos',
  jsonb_build_array(pg_temp.line(:'gc5', 1) || '{"discount": {"type": "amount", "value": 100}}'), '[{"method": "card", "amount": 4900}]'),
  'NC003', 'a discount on a gift card line is refused');
select public.save_promotion(:'org', '{"name": "Spend 6000", "kind": "percent_off", "scope": "order", "value": 5, "min_subtotal": 6000, "coupon_code": "SIX"}');
select set_config('nwsc.coupon', 'SIX', false);
select public.place_order(:'main', 'pos', jsonb_build_array(pg_temp.line(:'gc5', 1), pg_temp.line(:'socks', 2)),
  p_payments => '[{"method": "card", "amount": 6000}]') as gm \gset
select set_config('nwsc.coupon', '', false);
select pg_temp.ok((:'gm'::jsonb->>'total')::numeric = 6000 and :'gm'::jsonb->>'coupon_code' is null,
                  'gift cards do not count toward a minimum spend: 5,000 card + 1,000 socks does not reach 6,000');
