-- 10_mobile_app.sql
-- The customer app runs on the storefront API with its own channel: a business
-- with only the app switched on is found and can sell, quotes price app-only
-- promotions, orders are tagged mobile_app, and a signed-in shopper's account
-- (profile, points, orders from every channel) is theirs alone.

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;
\ir _helpers.sql
select set_config('nwsc.pos_shift', 'test-suite', false);

\set m_owner 'ba000000-0000-0000-0000-000000000001'
\set m_buyer 'ba000000-0000-0000-0000-000000000002'
\set m_other 'ba000000-0000-0000-0000-000000000003'
insert into auth.users (id, email) values (:'m_owner', 'owner@app.test'), (:'m_buyer', 'buyer@app.test'), (:'m_other', 'other@app.test');

select pg_temp.act_as_service();
-- The retail plan has the website; this business sells only through the app.
select public.create_organization('App Shop', 'app-shop', :'m_owner', 'retail') as org \gset
select public.set_organization_module(:'org', 'storefront', false);
select public.set_organization_module(:'org', 'mobile_app', true);
select public.set_organization_module(:'org', 'loyalty', true);
select id as main from public.locations where organization_id = :'org' \gset
select pg_temp.act_as(:'m_owner');
select public.update_organization_settings(:'org', '{"settings": {"delivery_fee": 300, "loyalty_points_per_100": 1}}');
select public.save_product(:'org', '{"name": "Mug", "status": "active", "variants": [{"sku": "MUG", "price": 2000}]}') as p_mug \gset
select id as mug from public.product_variants where sku = 'MUG' and organization_id = :'org' \gset
select public.receive_stock(:'main', jsonb_build_array(jsonb_build_object('variant_id', :'mug', 'quantity', 10, 'unit_cost', 900)));
select public.save_promotion(:'org', jsonb_build_object('name', 'App exclusive 10%', 'kind', 'percent_off', 'scope', 'products', 'value', 10,
  'channels', jsonb_build_array('mobile_app')));

\echo '--- finding the shop'
select pg_temp.act_as(null);
select pg_temp.ok((select count(*) from public.storefront_organization('app-shop')) = 1,
                  'a business with only the app switched on is found by its slug');
select pg_temp.ok((public.storefront_settings(:'org')->>'app_enabled')::boolean and not (public.storefront_settings(:'org')->>'web_enabled')::boolean
                  and (public.storefront_settings(:'org')->>'loyalty_enabled')::boolean,
                  'its settings say the app is on, the website is off, and loyalty is on');

\echo '--- quotes and checkout'
select pg_temp.expect_error(format('select public.quote_order(%L, %L::jsonb, %L)', :'org', jsonb_build_array(pg_temp.line(:'mug', 1)), 'pickup'),
  'NC002', 'a website quote is refused when only the app is on');
select public.quote_order(:'org', jsonb_build_array(pg_temp.line(:'mug', 2)), 'delivery', p_channel => 'mobile_app') as q \gset
select pg_temp.ok((:'q'::jsonb->>'total')::numeric = 3600 + 300 and :'q'::jsonb->'promotions'->0->>'name' = 'App exclusive 10%',
                  'an app quote applies the app-only promotion: 2 x 2,000 less 10% plus 300 delivery');
select pg_temp.expect_error(format('select public.quote_order(%L, %L::jsonb, %L, p_channel => %L)', :'org', jsonb_build_array(pg_temp.line(:'mug', 1)), 'pickup', 'pos'),
  'NC003', 'quotes are only for the store or the app');

select pg_temp.act_as(:'m_buyer');
select public.ensure_customer_profile(:'org', 'App Buyer', '+94771112222') as cust \gset
select public.checkout(:'org', jsonb_build_array(pg_temp.line(:'mug', 2)), 'app-0000000001',
  '{"full_name": "App Buyer", "phone": "+94771112222"}', '{"method": "pickup"}', 'cash_on_delivery', 'mobile_app') as o1 \gset
select pg_temp.ok(:'o1'::jsonb->>'channel' = 'mobile_app' and (:'o1'::jsonb->>'total')::numeric = 3600
                  and (:'o1'::jsonb->>'customer_id')::uuid = :'cust'::uuid,
                  'an app order is tagged mobile_app, gets the app price, and joins the shopper''s account');
select pg_temp.expect_error(format('select public.checkout(%L, %L::jsonb, %L, %L::jsonb, %L::jsonb, %L)', :'org', jsonb_build_array(pg_temp.line(:'mug', 1)),
  'web-0000000001', '{"full_name": "X", "phone": "+94771112222"}', '{"method": "pickup"}', 'cash_on_delivery'),
  'NC002', 'a website checkout is refused when only the app is on');

-- The same shopper buys at the counter too.
select pg_temp.act_as(:'m_owner');
select public.place_order(:'main', 'pos', jsonb_build_array(pg_temp.line(:'mug', 1)), :'cust',
  p_payments => '[{"method": "cash", "amount": 2000}]') as o2 \gset

\echo '--- the account'
select pg_temp.act_as(:'m_buyer');
select public.my_account(:'org') as acct \gset
select pg_temp.ok(:'acct'::jsonb->'profile'->>'full_name' = 'App Buyer' and :'acct'::jsonb->>'email' = 'buyer@app.test'
                  and jsonb_array_length(:'acct'::jsonb->'orders') = 2
                  and :'acct'::jsonb->'orders'->0->>'channel' = 'pos' and :'acct'::jsonb->'orders'->1->>'channel' = 'mobile_app',
                  'the account lists orders from the app and the counter, newest first');
select pg_temp.ok((:'acct'::jsonb->'loyalty'->>'points')::int = 36 + 20
                  and jsonb_array_length(:'acct'::jsonb->'loyalty'->'history') = 2,
                  'points earned in both channels show in one balance, with their history');
select pg_temp.ok((public.get_order_by_token((:'acct'::jsonb->'orders'->0->>'order_id')::uuid, :'acct'::jsonb->'orders'->0->>'access_token')->>'number')
                    = :'o2'::jsonb->>'number',
                  'each order in the account opens with its link');

select pg_temp.act_as(:'m_other');
select public.my_account(:'org') as other \gset
select pg_temp.ok(:'other'::jsonb->'profile' = 'null'::jsonb and jsonb_array_length(:'other'::jsonb->'orders') = 0
                  and :'other'::jsonb->'loyalty' = 'null'::jsonb,
                  'another shopper sees an empty account, not someone else''s');
select pg_temp.act_as(null);
select pg_temp.expect_error(format('select public.my_account(%L)', :'org'), '42501', 'a guest has no account', 'anon');
