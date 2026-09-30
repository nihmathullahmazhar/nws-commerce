-- 01_core_flow.sql
-- End-to-end: provisioning, modules, staff, catalogue (four kinds of product),
-- receiving, counter sales, online checkout with holds, expiry, conflicts,
-- adjustments, serial lookup, tenant isolation, RLS and ledger integrity.
--
-- Assertions print 'OK: ...' or 'PROBLEM: ...'; run.sh fails on any PROBLEM.

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

\ir _helpers.sql

-- Direct database sessions (these suites) stand in for the till: counter sales
-- need an open shift, which pos_sale() marks per transaction. 05_pos_flow.sql
-- tests the real path and that the API cannot skip it.
select set_config('nwsc.pos_shift', 'test-suite', false);

-- ---------------------------------------------------------------------------
-- 1. People
-- ---------------------------------------------------------------------------
\set owner    '11111111-1111-1111-1111-111111111111'
\set manager  '22222222-2222-2222-2222-222222222222'
\set cashier  '33333333-3333-3333-3333-333333333333'
\set cashier2 '44444444-4444-4444-4444-444444444444'
\set stocker  '55555555-5555-5555-5555-555555555555'
\set shopper  '66666666-6666-6666-6666-666666666666'
\set outsider '77777777-7777-7777-7777-777777777777'
\set owner2   '88888888-8888-8888-8888-888888888888'

insert into auth.users (id, email) values
  (:'owner', 'owner@shop.test'), (:'manager', 'manager@shop.test'), (:'cashier', 'cashier@shop.test'),
  (:'cashier2', 'cashier2@shop.test'), (:'stocker', 'stock@shop.test'), (:'shopper', 'shopper@mail.test'),
  (:'outsider', 'outsider@mail.test'), (:'owner2', 'owner@other.test');

-- ---------------------------------------------------------------------------
-- 2. Provisioning and modules
-- ---------------------------------------------------------------------------
\echo '--- provisioning'
select pg_temp.act_as(:'owner');
select pg_temp.expect_error(format('select public.create_organization(%L, %L, %L)', 'Nope', 'nope', :'owner'),
  '42501', 'a shop owner cannot provision organisations');

select pg_temp.act_as_service();
select public.create_organization('Test Retail Co', 'test-retail', :'owner', 'retail') as org \gset
select id as main from public.locations where organization_id = :'org' and code = 'MAIN' \gset

select pg_temp.ok((select array_agg(module order by module)::text[] from public.organization_modules
                    where organization_id = :'org' and enabled)
                  = array['storefront','pos','purchasing','returns','promotions','reviews'],
                  'retail plan switches on exactly its modules');

select pg_temp.act_as(:'owner');
select pg_temp.expect_error(format(
  'insert into public.locations (organization_id, code, name) values (%L, %L, %L)', :'org', 'KANDY', 'Kandy'),
  'NC002', 'a second location needs multi_location', 'authenticated');

select pg_temp.act_as_service();
select public.apply_plan(:'org', 'omnichannel');
select pg_temp.ok(public.module_enabled(:'org', 'multi_location') and public.module_enabled(:'org', 'transfers'),
                  'upgrading to omnichannel adds multi_location and transfers');

select pg_temp.act_as(:'owner');
set role authenticated;
insert into public.locations (organization_id, code, name, kind, sells_online, fulfilment_priority)
values (:'org', 'KANDY', 'Kandy Store', 'store', false, 50) returning id as kandy \gset
insert into public.locations (organization_id, code, name, kind, sells_online, fulfilment_priority)
values (:'org', 'WH', 'Main Warehouse', 'warehouse', true, 20) returning id as wh \gset
reset role;

-- ---------------------------------------------------------------------------
-- 3. Staff
-- ---------------------------------------------------------------------------
\echo '--- staff'
select pg_temp.act_as(:'owner');
select public.upsert_staff_member(:'org', :'manager', 'manager');
select public.upsert_staff_member(:'org', :'cashier', 'cashier', array[:'main']::uuid[]);
select public.upsert_staff_member(:'org', :'cashier2', 'cashier', array[:'kandy']::uuid[]);
select public.upsert_staff_member(:'org', :'stocker', 'stock_keeper');
select pg_temp.expect_error(format('select public.upsert_staff_member(%L, %L, %L)', :'org', :'outsider', 'owner'),
  '42501', 'an owner cannot create another owner');
select pg_temp.act_as(:'cashier');
select pg_temp.expect_error(format('select public.upsert_staff_member(%L, %L, %L)', :'org', :'outsider', 'cashier'),
  '42501', 'a cashier cannot add staff');

-- ---------------------------------------------------------------------------
-- 4. Catalogue: plain, serial, batch and sold-by-weight products
-- ---------------------------------------------------------------------------
\echo '--- catalogue'
select pg_temp.act_as(:'owner');
set role authenticated;

insert into public.categories (organization_id, name, slug) values (:'org', 'Apparel', 'apparel') returning id as cat_apparel \gset
insert into public.brands (organization_id, name, slug) values (:'org', 'House Brand', 'house-brand') returning id as brand \gset
insert into public.attribute_definitions (organization_id, code, label, data_type, options, is_filterable)
values (:'org', 'material', 'Material', 'option', array['Cotton','Linen'], true) returning id as attr_material \gset
insert into public.category_attributes (organization_id, category_id, attribute_id) values (:'org', :'cat_apparel', :'attr_material');

-- A T-shirt: size x colour
insert into public.products (organization_id, name, slug, brand_id, category_id, status)
values (:'org', 'Everyday Tee', 'everyday-tee', :'brand', :'cat_apparel', 'active') returning id as tee \gset
insert into public.product_attribute_values (organization_id, product_id, attribute_id, value)
values (:'org', :'tee', :'attr_material', '"Cotton"');
insert into public.product_options (organization_id, product_id, name, position) values (:'org', :'tee', 'Size', 1) returning id as opt_size \gset
insert into public.product_option_values (organization_id, option_id, value, position) values (:'org', :'opt_size', 'S', 1) returning id as val_s \gset
insert into public.product_option_values (organization_id, option_id, value, position) values (:'org', :'opt_size', 'M', 2) returning id as val_m \gset
insert into public.product_variants (organization_id, product_id, title, sku, barcode, price)
values (:'org', :'tee', 'S', 'TEE-S', '4790000000011', 2500) returning id as tee_s \gset
insert into public.product_variants (organization_id, product_id, title, sku, barcode, price, compare_at_price)
values (:'org', :'tee', 'M', 'TEE-M', '4790000000028', 2500, 3000) returning id as tee_m \gset
insert into public.variant_option_values (organization_id, variant_id, option_value_id)
values (:'org', :'tee_s', :'val_s'), (:'org', :'tee_m', :'val_m');

-- Loose rice, sold by the kilogram
insert into public.products (organization_id, name, slug, status, unit_of_measure, allow_fractional)
values (:'org', 'Basmati Rice (loose)', 'basmati-rice-loose', 'active', 'kg', true) returning id as rice \gset
insert into public.product_variants (organization_id, product_id, sku, price)
values (:'org', :'rice', 'RICE-KG', 650) returning id as rice_kg \gset

-- A draft that shoppers must not see
insert into public.products (organization_id, name, slug, status)
values (:'org', 'Coming Soon Speaker', 'coming-soon-speaker', 'draft') returning id as draft \gset
insert into public.product_variants (organization_id, product_id, sku, price)
values (:'org', :'draft', 'SPK-1', 9900) returning id as draft_v \gset
reset role;

select pg_temp.expect_error(format(
  'insert into public.products (organization_id, name, slug, tracking_mode) values (%L, %L, %L, %L)',
  :'org', 'Phone X', 'phone-x', 'serial'),
  'NC002', 'serial-tracked products need the serial_tracking module', 'authenticated');

select pg_temp.expect_error(format(
  'insert into public.product_variants (organization_id, product_id, sku, price) values (%L, %L, %L, 1)',
  :'org', :'tee', 'tee-s'),
  '23505', 'SKUs are unique per organisation, ignoring case', 'authenticated');

select pg_temp.act_as_service();
select public.set_organization_module(:'org', 'serial_tracking', true);
select public.set_organization_module(:'org', 'batch_tracking', true);

select pg_temp.act_as(:'owner');
set role authenticated;
insert into public.products (organization_id, name, slug, status, tracking_mode)
values (:'org', 'Phone X', 'phone-x', 'active', 'serial') returning id as phone \gset
insert into public.product_variants (organization_id, product_id, title, sku, price)
values (:'org', :'phone', '128GB Black', 'PHX-128-BLK', 150000) returning id as phone_v \gset
insert into public.products (organization_id, name, slug, status, tracking_mode)
values (:'org', 'Vitamin C 500mg', 'vitamin-c-500', 'active', 'batch') returning id as vit \gset
insert into public.product_variants (organization_id, product_id, title, sku, price)
values (:'org', :'vit', '60 tablets', 'VITC-60', 1200) returning id as vit_v \gset
reset role;

select pg_temp.act_as(:'cashier');
select pg_temp.expect_error(format(
  'insert into public.brands (organization_id, name, slug) values (%L, %L, %L)', :'org', 'X', 'x'),
  '42501', 'a cashier cannot edit the catalogue', 'authenticated');

-- ---------------------------------------------------------------------------
-- 5. Receiving
-- ---------------------------------------------------------------------------
\echo '--- receiving'
\set imei1 '356938035643809'
\set imei2 '356938035643817'
\set imei3 '356938035643825'

select pg_temp.act_as(:'stocker');
select public.receive_stock(:'main', jsonb_build_array(
  jsonb_build_object('variant_id', :'tee_s', 'quantity', 10, 'unit_cost', 1000),
  jsonb_build_object('variant_id', :'tee_m', 'quantity', 10, 'unit_cost', 1100),
  jsonb_build_object('variant_id', :'phone_v', 'quantity', 3, 'unit_cost', 120000,
                     'serials', jsonb_build_array(:'imei1', :'imei2', :'imei3')),
  jsonb_build_object('variant_id', :'vit_v', 'quantity', 5,  'unit_cost', 500, 'lot_code', 'LOT-A', 'expires_on', current_date + 30),
  jsonb_build_object('variant_id', :'vit_v', 'quantity', 10, 'unit_cost', 520, 'lot_code', 'LOT-B', 'expires_on', current_date + 200),
  jsonb_build_object('variant_id', :'vit_v', 'quantity', 4,  'unit_cost', 480, 'lot_code', 'LOT-C', 'expires_on', current_date - 1),
  jsonb_build_object('variant_id', :'rice_kg', 'quantity', 25.5, 'unit_cost', 400)),
  'INV-7781', 'opening delivery') ->> 'number' as rcv1 \gset

select pg_temp.ok(:'rcv1' = 'RCV-000001', 'receipts are numbered RCV-000001 onward');
select pg_temp.ok(pg_temp.on_hand(:'main', :'tee_s') = 10 and pg_temp.on_hand(:'main', :'phone_v') = 3
                  and pg_temp.on_hand(:'main', :'vit_v') = 19 and pg_temp.on_hand(:'main', :'rice_kg') = 25.5,
                  'receipt lands every kind of product on hand');
select pg_temp.ok((select round(avg_unit_cost, 2) from public.stock_levels where location_id = :'main' and variant_id = :'vit_v')
                  = round((5*500 + 10*520 + 4*480) / 19.0, 2), 'average cost weights all three lots');

select public.receive_stock(:'main', jsonb_build_array(
  jsonb_build_object('variant_id', :'tee_s', 'quantity', 10, 'unit_cost', 1200)));
select pg_temp.ok((select avg_unit_cost from public.stock_levels where location_id = :'main' and variant_id = :'tee_s') = 1100,
                  'a second delivery moves the weighted average (10 @1000 + 10 @1200 = 1100)');

select pg_temp.expect_error(format('select public.receive_stock(%L, %L::jsonb)', :'main',
  jsonb_build_array(jsonb_build_object('variant_id', :'phone_v', 'quantity', 1, 'serials', jsonb_build_array(:'imei1')))),
  'NC003', 'a serial number cannot be received twice');
select pg_temp.expect_error(format('select public.receive_stock(%L, %L::jsonb)', :'main',
  jsonb_build_array(jsonb_build_object('variant_id', :'phone_v', 'quantity', 2, 'serials', jsonb_build_array('111')))),
  'NC003', 'serial count must match quantity');
select pg_temp.expect_error(format('select public.receive_stock(%L, %L::jsonb)', :'main',
  jsonb_build_array(jsonb_build_object('variant_id', :'tee_s', 'quantity', 2.5))),
  'NC003', 'whole-unit products reject fractional quantities');
select pg_temp.expect_error(format('select public.receive_stock(%L, %L::jsonb)', :'main',
  jsonb_build_array(jsonb_build_object('variant_id', :'vit_v', 'quantity', 1, 'lot_code', 'LOT-A', 'expires_on', current_date + 99))),
  'NC003', 'a lot cannot be re-received with a different expiry');

select pg_temp.act_as(:'cashier');
select pg_temp.expect_error(format('select public.receive_stock(%L, %L::jsonb)', :'main',
  jsonb_build_array(jsonb_build_object('variant_id', :'tee_s', 'quantity', 1))),
  '42501', 'a cashier cannot receive stock');

-- ---------------------------------------------------------------------------
-- 6. Counter (POS) sales
-- ---------------------------------------------------------------------------
\echo '--- counter sales'
select pg_temp.act_as(:'cashier');
set role authenticated;
insert into public.customers (organization_id, full_name, phone)
values (:'org', 'Walk-in Regular', '+94771234567') returning id as cust \gset
reset role;

select public.place_order(:'main', 'pos', jsonb_build_array(
         pg_temp.line(:'tee_s', 2),
         pg_temp.line(:'phone_v', 1, array[:'imei2']),
         pg_temp.line(:'rice_kg', 1.25),
         pg_temp.line(:'vit_v', 3)),
       :'cust', 'pos-till1-0001', p_payments => '[{"method": "cash", "amount": 200000}]') as sale1 \gset

select pg_temp.ok((:'sale1'::jsonb)->>'number' = 'ORD-000001' and (:'sale1'::jsonb)->>'status' = 'confirmed'
                  and (:'sale1'::jsonb)->>'channel' = 'pos', 'counter sale is confirmed as ORD-000001');
select pg_temp.ok(((:'sale1'::jsonb)->>'total')::numeric = 2*2500 + 150000 + 812.50 + 3*1200,
                  'prices come from the catalogue, including 1.25 kg of rice');
select pg_temp.ok(pg_temp.on_hand(:'main', :'tee_s') = 18 and pg_temp.on_hand(:'main', :'phone_v') = 2
                  and pg_temp.on_hand(:'main', :'rice_kg') = 24.25,
                  'counter sale takes stock out immediately');
select pg_temp.ok((select bs.on_hand from public.batch_stock bs join public.batches b on b.id = bs.batch_id
                    where bs.location_id = :'main' and b.lot_code = 'LOT-A') = 2,
                  'batch sale takes from the earliest-expiring lot first (LOT-A 5 -> 2)');
select pg_temp.ok((select unit_cost from public.inventory_movements
                    where source_id = ((:'sale1'::jsonb)->>'order_id')::uuid and variant_id = :'tee_s') = 1100,
                  'cost of goods sold is the weighted average at the moment of sale');
select pg_temp.ok((select unit_cost from public.inventory_movements
                    where source_id = ((:'sale1'::jsonb)->>'order_id')::uuid and variant_id = :'phone_v') = 120000,
                  'a serialised unit carries its own cost');

select pg_temp.ok((public.place_order(:'main', 'pos', jsonb_build_array(pg_temp.line(:'tee_s', 2)),
                                      :'cust', 'pos-till1-0001')->>'replayed')::boolean
                  and pg_temp.on_hand(:'main', :'tee_s') = 18,
                  'replaying the same idempotency key returns the original sale, stock untouched');

select pg_temp.expect_error(format('select public.place_order(%L, %L, %L::jsonb)', :'main', 'pos',
  jsonb_build_array(pg_temp.line(:'phone_v', 1))),
  'NC003', 'the counter must scan the serial of a serialised item');
select pg_temp.expect_error(format('select public.place_order(%L, %L, %L::jsonb)', :'main', 'pos',
  jsonb_build_array(pg_temp.line(:'phone_v', 1, array[:'imei2']))),
  'NC004', 'a sold serial number cannot be sold again');
select pg_temp.expect_error(format('select public.place_order(%L, %L, %L::jsonb)', :'main', 'pos',
  jsonb_build_array(pg_temp.line(:'tee_m', 11))),
  'NC001', 'selling more than is on hand is refused');
select pg_temp.ok(pg_temp.on_hand(:'main', :'tee_m') = 10, 'a refused sale leaves stock untouched');
select pg_temp.expect_error(format('select public.place_order(%L, %L, %L::jsonb)', :'main', 'pos',
  jsonb_build_array(pg_temp.line(:'vit_v', 13))),
  'NC001', 'expired lots are not sellable (2 + 10 sellable, 4 expired)');
select pg_temp.expect_error(format('select public.place_order(%L, %L, %L::jsonb)', :'main', 'pos',
  jsonb_build_array(pg_temp.line(:'draft_v', 1))),
  'NC003', 'draft products cannot be sold');
select pg_temp.expect_error(format('select public.place_order(%L, %L, %L::jsonb)', :'main', 'online',
  jsonb_build_array(pg_temp.line(:'tee_m', 1))),
  'NC003', 'online orders cannot bypass checkout');

select pg_temp.act_as(:'cashier2');
select pg_temp.expect_error(format('select public.place_order(%L, %L, %L::jsonb)', :'main', 'pos',
  jsonb_build_array(pg_temp.line(:'tee_m', 1))),
  '42501', 'a cashier assigned to Kandy cannot sell at Main');
select pg_temp.act_as(:'stocker');
select pg_temp.expect_error(format('select public.place_order(%L, %L, %L::jsonb)', :'main', 'pos',
  jsonb_build_array(pg_temp.line(:'tee_m', 1))),
  '42501', 'a stock keeper cannot sell');

-- ---------------------------------------------------------------------------
-- 7. Serial lookup (warranty desk)
-- ---------------------------------------------------------------------------
\echo '--- serial lookup'
select pg_temp.act_as(:'cashier');
select public.lookup_serial(:'org', lower('  ' || :'imei2' || ' ')) as found \gset
select pg_temp.ok((:'found'::jsonb)->0->>'status' = 'sold'
                  and (:'found'::jsonb)->0->'sale'->>'number' = 'ORD-000001'
                  and (:'found'::jsonb)->0->'sale'->>'channel' = 'pos'
                  and (:'found'::jsonb)->0->'sale'->'customer'->>'phone' = '+94771234567'
                  and jsonb_array_length((:'found'::jsonb)->0->'history') = 2,
                  'serial lookup returns product, order, channel, customer and unit history');

-- ---------------------------------------------------------------------------
-- 8. Online checkout: holds, confirmation, cancellation
-- ---------------------------------------------------------------------------
\echo '--- online checkout'
select pg_temp.act_as(null);
select public.start_checkout(:'org', jsonb_build_array(pg_temp.line(:'tee_m', 3)), 'web-checkout-0001') as web1 \gset
select pg_temp.ok((:'web1'::jsonb)->>'status' = 'pending_payment'
                  and ((:'web1'::jsonb)->>'location_id')::uuid = :'main'::uuid
                  and (:'web1'::jsonb)->>'reservation_expires_at' is not null,
                  'guest checkout holds stock at the first online location that has it');
select pg_temp.ok(pg_temp.on_hand(:'main', :'tee_m') = 10 and pg_temp.reserved(:'main', :'tee_m') = 3,
                  'a hold reserves without removing stock');
select pg_temp.ok((select available from public.storefront_availability(:'org', array[:'tee_m']::uuid[])) = 7,
                  'the storefront sees stock minus holds');
select pg_temp.expect_error(format('select public.confirm_order(%L)', (:'web1'::jsonb)->>'order_id'),
  '42501', 'a shopper cannot mark their own order paid');

select pg_temp.act_as(:'cashier');
select pg_temp.expect_error(format('select public.place_order(%L, %L, %L::jsonb)', :'main', 'pos',
  jsonb_build_array(pg_temp.line(:'tee_m', 8))),
  'NC001', 'the counter cannot sell stock held for an online order');

select pg_temp.act_as_service();
select public.confirm_order(((:'web1'::jsonb)->>'order_id')::uuid) ->> 'status' as st \gset
select pg_temp.ok(:'st' = 'confirmed' and pg_temp.on_hand(:'main', :'tee_m') = 7 and pg_temp.reserved(:'main', :'tee_m') = 0,
                  'payment confirmation turns the hold into a sale');
select pg_temp.ok((public.confirm_order(((:'web1'::jsonb)->>'order_id')::uuid)->>'replayed')::boolean
                  and pg_temp.on_hand(:'main', :'tee_m') = 7,
                  'a repeated payment webhook changes nothing');

select pg_temp.act_as(null);
select pg_temp.ok((public.start_checkout(:'org', jsonb_build_array(pg_temp.line(:'tee_m', 3)), 'web-checkout-0001')->>'replayed')::boolean,
                  'retrying a checkout with the same key returns the same order');

-- serial: the unit is allocated automatically and released on cancel
select public.start_checkout(:'org', jsonb_build_array(pg_temp.line(:'phone_v', 1)), 'web-checkout-0002') as web2 \gset
select pg_temp.ok((select status from public.serial_units where serial = :'imei1') = 'reserved',
                  'online checkout reserves the oldest available unit');
select pg_temp.act_as_service();
select public.cancel_order(((:'web2'::jsonb)->>'order_id')::uuid, 'payment abandoned') ->> 'status' as st \gset
select pg_temp.ok(:'st' = 'cancelled' and (select status from public.serial_units where serial = :'imei1') = 'available'
                  and pg_temp.reserved(:'main', :'phone_v') = 0,
                  'cancelling returns the unit to sale');

-- batch: online orders are allocated first-expiry-first
select pg_temp.act_as(null);
select public.start_checkout(:'org', jsonb_build_array(pg_temp.line(:'vit_v', 2)), 'web-checkout-0005') as web5 \gset
select pg_temp.act_as_service();
select public.confirm_order(((:'web5'::jsonb)->>'order_id')::uuid);
select pg_temp.ok((select bs.on_hand from public.batch_stock bs join public.batches b on b.id = bs.batch_id
                    where bs.location_id = :'main' and b.lot_code = 'LOT-A') = 0,
                  'online batch order took the remaining LOT-A first');
select pg_temp.ok((select available from public.storefront_availability(:'org', array[:'vit_v']::uuid[])) = 10,
                  'storefront availability excludes the expired LOT-C');

-- guardrails
select pg_temp.act_as(null);
select pg_temp.expect_error(format('select public.start_checkout(%L, %L::jsonb, %L)', :'org',
  jsonb_build_array(pg_temp.line(:'phone_v', 1, array[:'imei3'])), 'web-checkout-9001'),
  'NC003', 'shoppers cannot pick serial numbers');
select pg_temp.expect_error(format('select public.start_checkout(%L, %L::jsonb, %L)', :'org',
  jsonb_build_array(pg_temp.line(:'rice_kg', 21)), 'web-checkout-9002'),
  'NC003', 'per-line quantity cap stops one guest holding all the stock');
select pg_temp.expect_error(format('select public.start_checkout(%L, %L::jsonb, %L, %L, %L)', :'org',
  jsonb_build_array(pg_temp.line(:'tee_m', 1)), 'web-checkout-9003', 'online', :'cust'),
  '42501', 'a guest cannot check out as someone else');
select pg_temp.expect_error(format('select public.start_checkout(%L, %L::jsonb, %L)', :'org',
  jsonb_build_array(pg_temp.line(:'tee_m', 1)), 'short'),
  'NC003', 'checkout requires a real idempotency key');

-- ---------------------------------------------------------------------------
-- 9. Expiry and the paid-after-expiry conflict
-- ---------------------------------------------------------------------------
\echo '--- expiry'
select public.start_checkout(:'org', jsonb_build_array(pg_temp.line(:'tee_m', 2)), 'web-checkout-0003') as web3 \gset
update public.orders set reservation_expires_at = now() - interval '1 minute' where id = ((:'web3'::jsonb)->>'order_id')::uuid;
update public.stock_reservations set expires_at = now() - interval '1 minute' where source_id = ((:'web3'::jsonb)->>'order_id')::uuid;

select pg_temp.act_as(null);
select pg_temp.expect_error('select public.expire_reservations()', '42501', 'only the platform runs the expiry job');
select pg_temp.act_as_service();
select pg_temp.ok(public.expire_reservations() = 1, 'the expiry job lapses one order');
select pg_temp.ok((select status from public.orders where id = ((:'web3'::jsonb)->>'order_id')::uuid) = 'expired'
                  and pg_temp.reserved(:'main', :'tee_m') = 0, 'a lapsed hold goes back on sale');
select public.confirm_order(((:'web3'::jsonb)->>'order_id')::uuid) ->> 'status' as st \gset
select pg_temp.ok(:'st' = 'confirmed' and pg_temp.on_hand(:'main', :'tee_m') = 5,
                  'late payment still confirms when the stock is still there');

select pg_temp.act_as(null);
select public.start_checkout(:'org', jsonb_build_array(pg_temp.line(:'tee_m', 5)), 'web-checkout-0004') as web4 \gset
update public.orders set reservation_expires_at = now() - interval '1 minute' where id = ((:'web4'::jsonb)->>'order_id')::uuid;
update public.stock_reservations set expires_at = now() - interval '1 minute' where source_id = ((:'web4'::jsonb)->>'order_id')::uuid;
select pg_temp.act_as_service();
select public.expire_reservations();
select pg_temp.act_as(:'cashier');
select public.place_order(:'main', 'pos', jsonb_build_array(pg_temp.line(:'tee_m', 5)), p_payments => '[{"method": "card", "amount": 12500}]');
select pg_temp.act_as_service();
select public.confirm_order(((:'web4'::jsonb)->>'order_id')::uuid) ->> 'status' as st \gset
select pg_temp.ok(:'st' = 'stock_conflict' and pg_temp.on_hand(:'main', :'tee_m') = 0,
                  'payment after the stock was sold elsewhere is parked as a conflict, never oversold');
select pg_temp.ok(public.cancel_order(((:'web4'::jsonb)->>'order_id')::uuid, 'refunded') ->> 'status' = 'cancelled',
                  'a conflicted order can be cancelled for refund');

-- ---------------------------------------------------------------------------
-- 10. Signed-in shopper
-- ---------------------------------------------------------------------------
\echo '--- signed-in shopper'
select pg_temp.act_as_service();
insert into public.customers (organization_id, auth_user_id, full_name, email)
values (:'org', :'shopper', 'Signed In Shopper', 'shopper@mail.test') returning id as shopper_cust \gset

select pg_temp.act_as(:'shopper');
select public.start_checkout(:'org', jsonb_build_array(pg_temp.line(:'tee_s', 1)), 'web-checkout-0006') as web6 \gset
select pg_temp.ok(((:'web6'::jsonb)->>'customer_id')::uuid = :'shopper_cust'::uuid,
                  'a signed-in shopper''s order is attached to their customer record');
select pg_temp.ok(pg_temp.scalar_as('authenticated', 'select count(*) from public.orders') = '1',
                  'a shopper sees only their own orders');
select pg_temp.ok(public.cancel_order(((:'web6'::jsonb)->>'order_id')::uuid) ->> 'status' = 'cancelled',
                  'a shopper can cancel their own unpaid order');

-- ---------------------------------------------------------------------------
-- 11. Adjustments
-- ---------------------------------------------------------------------------
\echo '--- adjustments'
select pg_temp.act_as(:'stocker');
select public.adjust_stock(:'main', :'vit_v', 4, 'damage', 'expired on shelf', null, 'LOT-C');
select pg_temp.ok((select bs.on_hand from public.batch_stock bs join public.batches b on b.id = bs.batch_id
                    where bs.location_id = :'main' and b.lot_code = 'LOT-C') = 0,
                  'an expired lot can be written off by name');
select public.adjust_stock(:'main', :'phone_v', 1, 'adjustment_out', 'unit missing at count', array[:'imei3']);
select pg_temp.ok((select status from public.serial_units where serial = :'imei3') = 'written_off'
                  and pg_temp.on_hand(:'main', :'phone_v') = 1, 'a missing serialised unit is written off');
select public.adjust_stock(:'main', :'tee_s', 2, 'adjustment_in', 'found in back room');
select pg_temp.ok(pg_temp.on_hand(:'main', :'tee_s') = 20, 'a count can add stock back (20 received - 2 sold + 2 found)');
select pg_temp.expect_error(format('select public.adjust_stock(%L, %L, 1, %L, %L)', :'main', :'tee_s', 'damage', ''),
  'NC003', 'an adjustment without a reason is refused');
select pg_temp.expect_error(format('select public.adjust_stock(%L, %L, 1, %L, %L)', :'main', :'vit_v', 'damage', 'broken'),
  'NC003', 'a batch write-off must name the lot');

select pg_temp.act_as(:'owner');
select pg_temp.expect_error(format('update public.products set tracking_mode = %L where id = %L', 'batch', :'tee'),
  'NC006', 'tracking mode is frozen once stock has moved', 'authenticated');

-- ---------------------------------------------------------------------------
-- 12. Tenant isolation and module gates
-- ---------------------------------------------------------------------------
\echo '--- isolation'
select pg_temp.act_as_service();
select public.create_organization('Other Shop', 'other-shop', :'owner2', 'ecommerce') as org2 \gset
select id as main2 from public.locations where organization_id = :'org2' \gset

select pg_temp.act_as(:'owner2');
select pg_temp.ok(pg_temp.scalar_as('authenticated', format('select count(*) from public.orders where organization_id = %L', :'org')) = '0',
                  'another organisation''s owner sees none of our orders');
select pg_temp.ok(pg_temp.scalar_as('authenticated', format('select count(*) from public.stock_levels where organization_id = %L', :'org')) = '0',
                  'another organisation''s owner sees none of our stock');
select pg_temp.expect_error(format('select public.place_order(%L, %L, %L::jsonb)', :'main', 'pos',
  jsonb_build_array(pg_temp.line(:'tee_s', 1))),
  '42501', 'another organisation''s owner cannot sell our stock');
select pg_temp.expect_error(format('select public.place_order(%L, %L, %L::jsonb)', :'main2', 'pos',
  jsonb_build_array(pg_temp.line(:'tee_s', 1))),
  'NC002', 'an e-commerce-only organisation has no POS');
select pg_temp.expect_error(format('select public.lookup_serial(%L, %L)', :'org2', :'imei1'),
  'NC002', 'serial lookup needs the serial_tracking module');
select pg_temp.expect_error(format('insert into public.products (organization_id, name, slug) values (%L, %L, %L)',
  :'org', 'Sneaky', 'sneaky'),
  '42501', 'another organisation''s owner cannot add to our catalogue', 'authenticated');

-- ---------------------------------------------------------------------------
-- 13. Row-level security for the public and for staff
-- ---------------------------------------------------------------------------
\echo '--- RLS'
select pg_temp.act_as(null);
select pg_temp.ok(pg_temp.scalar_as('anon', format('select count(*) from public.products where organization_id = %L', :'org')) = '4',
                  'the public sees the 4 active products, not the draft');
select pg_temp.ok(pg_temp.scalar_as('anon', format('select count(*) from public.product_variants where id = %L', :'draft_v')) = '0',
                  'the public cannot see a draft product''s variants');
select pg_temp.expect_error('select count(*) from public.stock_levels', '42501', 'the public cannot read stock levels', 'anon');
select pg_temp.expect_error('select count(*) from public.orders', '42501', 'the public cannot read orders', 'anon');
select pg_temp.expect_error(format('insert into public.products (organization_id, name, slug) values (%L, %L, %L)',
  :'org', 'Anon', 'anon'), '42501', 'the public cannot write the catalogue', 'anon');

select pg_temp.act_as(:'outsider');
select pg_temp.ok(pg_temp.scalar_as('authenticated', 'select count(*) from public.orders') = '0'
                  and pg_temp.scalar_as('authenticated', 'select count(*) from public.customers') = '0',
                  'a signed-in stranger sees no orders and no customers');

select pg_temp.act_as(:'cashier');
select pg_temp.ok(pg_temp.scalar_as('authenticated', format('select count(*) > 0 from public.stock_levels where organization_id = %L', :'org')) = 'true',
                  'a cashier can see stock');
select pg_temp.expect_error(format(
  'insert into public.inventory_movements (organization_id, location_id, variant_id, movement_type, quantity, source_type) values (%L, %L, %L, %L, 5, %L)',
  :'org', :'main', :'tee_s', 'receipt', 'manual'),
  '42501', 'staff cannot write the ledger directly', 'authenticated');
select pg_temp.expect_error(format('update public.stock_levels set on_hand = 999 where variant_id = %L', :'tee_s'),
  '42501', 'staff cannot edit stock levels directly', 'authenticated');
select pg_temp.expect_error(format('update public.orders set total = 1 where organization_id = %L', :'org'),
  '42501', 'staff cannot edit orders directly', 'authenticated');
select pg_temp.expect_error(format('select * from public.inventory_integrity_report(%L)', :'org'),
  '42501', 'a cashier cannot run the integrity report');

-- ---------------------------------------------------------------------------
-- 14. Audit, numbering, append-only ledger, integrity
-- ---------------------------------------------------------------------------
\echo '--- audit and integrity'
select pg_temp.act_as(:'owner');
set role authenticated;
update public.product_variants set price = 2750 where id = :'tee_s';
reset role;
select pg_temp.ok(exists (select 1 from public.audit_log
                           where table_name = 'product_variants' and row_id = :'tee_s' and action = 'update'
                             and actor_id = :'owner' and (old_data->>'price')::numeric = 2500
                             and (new_data->>'price')::numeric = 2750),
                  'price changes are audited with who, before and after');

select pg_temp.ok((select count(*) = max(substr(number, 5)::int) from public.orders where organization_id = :'org'),
                  'order numbers have no gaps, even after refused and retried checkouts');

select pg_temp.act_as_service();
select pg_temp.expect_error('update public.inventory_movements set quantity = 100', 'NC006', 'the ledger cannot be edited');
select pg_temp.expect_error('delete from public.inventory_movements', 'NC006', 'the ledger cannot be deleted');
select pg_temp.expect_error('delete from public.audit_log', 'NC006', 'the audit log cannot be deleted');

select pg_temp.act_as(:'owner');
select pg_temp.ok((select count(*) from public.inventory_integrity_report(:'org')) = 0,
                  'stock levels, batches, serials and holds all agree with the ledger');
