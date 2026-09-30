-- 04_storefront_flow.sql
-- The online store: catalogue with facets, product page, token carts, quotes that
-- match checkout, checkout with delivery/pickup and COD/bank transfer, guest
-- order pages by token, signed-in customer profiles.

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;
\ir _helpers.sql

\set s_owner  'd0000000-0000-0000-0000-000000000001'
\set s_buyer  'd0000000-0000-0000-0000-000000000002'
\set s_other  'd0000000-0000-0000-0000-000000000003'
insert into auth.users (id, email) values
  (:'s_owner', 'owner@store.test'), (:'s_buyer', 'buyer@mail.test'), (:'s_other', 'other@mail.test');

\set cart_a 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
\set cart_b 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

-- ---------------------------------------------------------------------------
-- Setup: a small shop with a category tree, brands, a filterable spec, VAT
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select public.create_organization('Corner Store', 'corner-store', :'s_owner', 'retail') as org \gset
select id as main from public.locations where organization_id = :'org' \gset

select pg_temp.act_as(:'s_owner');
select public.update_organization_settings(:'org', '{"settings": {"delivery_fee": 350, "free_delivery_over": 10000, "bank_transfer_details": "BOC 0001234567, Corner Store (Pvt) Ltd"}}');
set role authenticated;
insert into public.tax_rates (organization_id, code, name, rate_percent, is_default) values (:'org', 'VAT', 'VAT', 18, true);
insert into public.categories (organization_id, name, slug) values (:'org', 'Clothing', 'clothing') returning id as c_clothing \gset
insert into public.categories (organization_id, name, slug, parent_id) values (:'org', 'Shirts', 'shirts', :'c_clothing') returning id as c_shirts \gset
insert into public.categories (organization_id, name, slug) values (:'org', 'Pantry', 'pantry') returning id as c_pantry \gset
insert into public.brands (organization_id, name, slug) values (:'org', 'Loom', 'loom') returning id as b_loom \gset
insert into public.brands (organization_id, name, slug) values (:'org', 'Field', 'field') returning id as b_field \gset
insert into public.attribute_definitions (organization_id, code, label, data_type, options, is_filterable)
values (:'org', 'material', 'Material', 'option', array['Cotton', 'Linen'], true) returning id as a_mat \gset
reset role;

select public.save_product(:'org', jsonb_build_object('name', 'Linen Shirt', 'status', 'active', 'category_id', :'c_shirts', 'brand_id', :'b_loom',
  'options', '[{"name": "Size", "values": ["S", "M"]}]'::jsonb,
  'variants', '[{"option_values": ["S"], "sku": "LS-S", "price": 5900}, {"option_values": ["M"], "sku": "LS-M", "price": 5900}]'::jsonb,
  'attributes', jsonb_build_object(:'a_mat', 'Linen'))) as linen \gset
select public.save_product(:'org', jsonb_build_object('name', 'Cotton Tee', 'status', 'active', 'category_id', :'c_shirts', 'brand_id', :'b_field',
  'variants', '[{"sku": "CT-1", "price": 2400, "compare_at_price": 2900}]'::jsonb,
  'attributes', jsonb_build_object(:'a_mat', 'Cotton'))) as tee \gset
select public.save_product(:'org', jsonb_build_object('name', 'Red Rice 1kg', 'status', 'active', 'category_id', :'c_pantry', 'tax_exempt', true,
  'variants', '[{"sku": "RR-1", "barcode": "4792222000019", "price": 480}]'::jsonb)) as rice \gset
select public.save_product(:'org', '{"name": "Secret Draft", "status": "draft", "variants": [{"price": 1}]}') as draft \gset

select id as ls_s from public.product_variants where sku = 'LS-S' \gset
select id as ls_m from public.product_variants where sku = 'LS-M' \gset
select id as ct from public.product_variants where sku = 'CT-1' \gset
select id as rr from public.product_variants where sku = 'RR-1' \gset

select public.receive_stock(:'main', jsonb_build_array(
  jsonb_build_object('variant_id', :'ls_s', 'quantity', 3, 'unit_cost', 3000),
  jsonb_build_object('variant_id', :'ct', 'quantity', 10, 'unit_cost', 1000),
  jsonb_build_object('variant_id', :'rr', 'quantity', 50, 'unit_cost', 300)));

-- ---------------------------------------------------------------------------
-- 1. Catalogue
-- ---------------------------------------------------------------------------
\echo '--- catalogue'
select pg_temp.act_as(null);
select public.storefront_catalog(:'org', 'clothing') as cat \gset
select pg_temp.ok((:'cat'::jsonb->>'total')::int = 2, 'a parent category lists products from its sub-categories');
select pg_temp.ok(jsonb_array_length(:'cat'::jsonb->'facets'->'brands') = 2
                  and :'cat'::jsonb->'facets'->'attributes'->0->>'label' = 'Material'
                  and (:'cat'::jsonb->'facets'->'price'->>'min')::numeric = 2400,
                  'facets offer both brands, the Material spec and the price range');
select pg_temp.ok((public.storefront_catalog(:'org', 'clothing', null, jsonb_build_object('attributes', jsonb_build_object(:'a_mat', jsonb_build_array('Linen'))))->'items'->0->>'name') = 'Linen Shirt',
                  'filtering by a specification narrows the list');
select pg_temp.ok((public.storefront_catalog(:'org', null, null, '{"brands": ["field"]}')->>'total')::int = 1,
                  'filtering by brand narrows the list');
select pg_temp.ok((public.storefront_catalog(:'org', null, 'rice')->'items'->0->>'name') = 'Red Rice 1kg'
                  and (public.storefront_catalog(:'org', null, '4792222000019')->>'total')::int = 1,
                  'search finds products by name and by barcode');
select pg_temp.ok((public.storefront_catalog(:'org', null, null, '{}', 'price_asc')->'items'->0->>'name') = 'Red Rice 1kg',
                  'sorting by price puts the cheapest first');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(public.storefront_catalog(:'org')->'items') i where i->>'name' = 'Secret Draft'),
                  'drafts never reach the store');
select pg_temp.ok((select bool_and((i->>'in_stock')::boolean) from jsonb_array_elements(public.storefront_catalog(:'org')->'items') i),
                  'every listed product reports whether it is in stock');

select public.storefront_product(:'org', 'linen-shirt') as pdp \gset
select pg_temp.ok(jsonb_array_length(:'pdp'::jsonb->'variants') = 2
                  and (select (v->>'available')::numeric from jsonb_array_elements(:'pdp'::jsonb->'variants') v where v->>'sku' = 'LS-S') = 3
                  and (select (v->>'available')::numeric from jsonb_array_elements(:'pdp'::jsonb->'variants') v where v->>'sku' = 'LS-M') = 0
                  and :'pdp'::jsonb->'breadcrumbs'->0->>'slug' = 'clothing'
                  and :'pdp'::jsonb->'specifications'->0->>'label' = 'Material',
                  'the product page has variants with live availability, breadcrumbs and specifications');
select pg_temp.ok(public.storefront_product(:'org', 'secret-draft') is null, 'a draft product page does not exist');
select pg_temp.ok((public.storefront_settings(:'org')->>'delivery_fee')::numeric = 350
                  and not (public.storefront_settings(:'org') ? 'discount_limits'),
                  'the store sees delivery and payment options, not internal settings');

-- ---------------------------------------------------------------------------
-- 2. Carts
-- ---------------------------------------------------------------------------
\echo '--- carts'
select public.cart_set_item(:'org', :'cart_a', :'ls_s', 2);
select public.cart_set_item(:'org', :'cart_a', :'rr', 3) as cart \gset
select pg_temp.ok((:'cart'::jsonb->>'count')::numeric = 5 and (:'cart'::jsonb->>'subtotal')::numeric = 2*5900 + 3*480,
                  'a cart holds lines by token and totals them');
select pg_temp.ok((public.cart_get(:'org', :'cart_b')->>'count')::int = 0, 'another token sees an empty cart');
select pg_temp.ok((public.cart_set_item(:'org', :'cart_a', :'rr', 0)->>'count')::numeric = 2, 'setting quantity 0 removes a line');
select pg_temp.expect_error(format('select public.cart_set_item(%L, %L, %L, 1)', :'org', 'short', :'ct'), 'NC003', 'a guessable cart token is refused');
select pg_temp.expect_error(format('select public.cart_set_item(%L, %L, %L, 1)', :'org', :'cart_a',
  (select id from public.product_variants where product_id = :'draft')), 'NC005', 'a draft product cannot be added');
select pg_temp.expect_error(format('select public.cart_set_item(%L, %L, %L, 1.5)', :'org', :'cart_a', :'ct'), 'NC003', 'a whole-unit item cannot be added in halves');
select pg_temp.expect_error('select count(*) from public.carts', '42501', 'carts are not readable directly', 'anon');

-- ---------------------------------------------------------------------------
-- 3. Quote and checkout
-- ---------------------------------------------------------------------------
\echo '--- quote and checkout'
select public.quote_order(:'org', jsonb_build_array(pg_temp.line(:'ls_s', 1), pg_temp.line(:'rr', 2)), 'delivery') as q \gset
select pg_temp.ok((:'q'::jsonb->>'subtotal')::numeric = 5900 + 960 and (:'q'::jsonb->>'shipping_total')::numeric = 350
                  and (:'q'::jsonb->>'total')::numeric = 5900 + 960 + 350
                  and (:'q'::jsonb->>'tax_total')::numeric = round(5900 - 5900 / 1.18, 2),
                  'a quote prices lines, VAT (exempt rice untaxed) and the delivery fee');
select pg_temp.ok(not exists (select 1 from public.orders where number like 'QUOTE-%'), 'a quote leaves nothing behind');
select pg_temp.ok((public.quote_order(:'org', jsonb_build_array(pg_temp.line(:'ls_s', 2)), 'delivery')->>'shipping_total')::numeric = 0,
                  'delivery is free over the threshold');
select pg_temp.ok((public.quote_order(:'org', jsonb_build_array(pg_temp.line(:'rr', 1)), 'pickup')->>'shipping_total')::numeric = 0,
                  'pickup costs nothing');

select public.checkout(:'org', jsonb_build_array(pg_temp.line(:'ls_s', 1), pg_temp.line(:'rr', 2)), 'web-cod-00000001',
  '{"full_name": "Guest Buyer", "phone": "+94771234000", "email": "guest@mail.test"}',
  '{"method": "delivery", "address": {"line1": "12 Temple Road", "city": "Kandy"}}', 'cash_on_delivery') as cod \gset
select pg_temp.ok(:'cod'::jsonb->>'status' = 'confirmed' and :'cod'::jsonb->>'payment_status' = 'unpaid'
                  and (:'cod'::jsonb->>'total')::numeric = (:'q'::jsonb->>'total')::numeric
                  and :'cod'::jsonb->>'fulfilment_method' = 'delivery' and length(:'cod'::jsonb->>'access_token') = 36,
                  'cash on delivery confirms at once, charging exactly what was quoted');
select pg_temp.ok(pg_temp.on_hand(:'main', :'ls_s') = 2 and pg_temp.reserved(:'main', :'ls_s') = 0,
                  'a COD order takes its stock straight away');
select pg_temp.ok((public.checkout(:'org', jsonb_build_array(pg_temp.line(:'ls_s', 1)), 'web-cod-00000001',
                     '{"full_name": "Guest Buyer", "phone": "+94771234000"}', '{"method": "pickup"}', 'cash_on_delivery')->>'replayed')::boolean
                  and pg_temp.on_hand(:'main', :'ls_s') = 2,
                  'a retried checkout returns the first order and takes nothing more');

select public.checkout(:'org', jsonb_build_array(pg_temp.line(:'ct', 2)), 'web-bank-0000001',
  '{"full_name": "Transfer Buyer", "phone": "+94770000999"}', '{"method": "pickup"}', 'bank_transfer') as bank \gset
select pg_temp.ok(:'bank'::jsonb->>'status' = 'pending_payment'
                  and (:'bank'::jsonb->>'reservation_expires_at')::timestamptz > now() + interval '23 hours'
                  and pg_temp.reserved(:'main', :'ct') = 2,
                  'a bank transfer order holds its stock for a day');

select pg_temp.expect_error(format('select public.checkout(%L, %L::jsonb, %L, %L, %L, %L)', :'org',
  jsonb_build_array(pg_temp.line(:'ct', 1)), 'web-bad-00000001', '{"full_name": "X", "phone": "0771234567"}', '{"method": "pickup"}', 'cash_on_delivery'),
  'NC003', 'a phone number must be in international form');
select pg_temp.expect_error(format('select public.checkout(%L, %L::jsonb, %L, %L, %L, %L)', :'org',
  jsonb_build_array(pg_temp.line(:'ct', 1)), 'web-bad-00000002', '{"full_name": "X", "phone": "+94771234567"}', '{"method": "delivery", "address": {"line1": "1 Road"}}', 'cash_on_delivery'),
  'NC003', 'delivery needs a city');
select pg_temp.expect_error(format('select public.checkout(%L, %L::jsonb, %L, %L, %L, %L)', :'org',
  jsonb_build_array(pg_temp.line(:'ct', 1)), 'web-bad-00000003', '{"full_name": "X", "phone": "+94771234567"}', '{"method": "pickup"}', 'online_gateway'),
  'NC003', 'online payment is refused until a gateway is set up');
select pg_temp.expect_error(format('select public.checkout(%L, %L::jsonb, %L, %L, %L, %L)', :'org',
  jsonb_build_array(pg_temp.line(:'ls_m', 1)), 'web-bad-00000004', '{"full_name": "X", "phone": "+94771234567"}', '{"method": "pickup"}', 'cash_on_delivery'),
  'NC001', 'an out-of-stock size cannot be ordered');

-- ---------------------------------------------------------------------------
-- 4. Order pages and accounts
-- ---------------------------------------------------------------------------
\echo '--- order pages and accounts'
select pg_temp.ok(public.get_order_by_token((:'cod'::jsonb->>'order_id')::uuid, :'cod'::jsonb->>'access_token')->>'number' = :'cod'::jsonb->>'number',
                  'a guest opens their order with its private token');
select pg_temp.expect_error(format('select public.get_order_by_token(%L, %L)', :'cod'::jsonb->>'order_id', 'guess'),
  'NC005', 'a wrong token reveals nothing');

-- the same number already belongs to a customer the counter created
select pg_temp.act_as_service();
insert into public.customers (organization_id, full_name, phone) values (:'org', 'Counter Regular', '+94771234000');
select pg_temp.act_as(:'s_buyer');
select public.ensure_customer_profile(:'org', 'Signed Up Buyer', '+94771234000') as buyer_cust \gset
select pg_temp.ok((select phone is null and email = 'buyer@mail.test' and auth_user_id = :'s_buyer' from public.customers where id = :'buyer_cust'),
                  'a sign-up does not take over a phone number another customer already has');
select public.checkout(:'org', jsonb_build_array(pg_temp.line(:'ct', 1)), 'web-acct-0000001',
  '{"full_name": "Signed Up Buyer", "phone": "+94775550000"}', '{"method": "pickup"}', 'cash_on_delivery') as mine \gset
select pg_temp.ok(((:'mine'::jsonb)->>'customer_id')::uuid = :'buyer_cust'::uuid
                  and pg_temp.scalar_as('authenticated', 'select count(*) from public.orders') = '1',
                  'a signed-in shopper''s order joins their account, and they see only their own orders');
select pg_temp.act_as(:'s_other');
select pg_temp.ok(pg_temp.scalar_as('authenticated', 'select count(*) from public.orders') = '0', 'another shopper sees none of it');

select pg_temp.act_as_service();
select pg_temp.ok((select count(*) from public._inventory_integrity(:'org')) = 0, 'stock still agrees with the ledger');
select pg_temp.ok(not exists (select 1 from public.orders o where o.organization_id = :'org'
                               and o.total <> o.subtotal - o.discount_total + case when o.tax_inclusive then 0 else o.tax_total end + o.shipping_total),
                  'every order total includes its delivery fee exactly once');
