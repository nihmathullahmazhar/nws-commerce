-- 06_returns_warranty.sql
-- Returns at the till and in the admin, inspection before restock, refunds that
-- match what was paid (discounts included, rounding settled), exchanges in one
-- step, online return requests, return periods, and warranty lookup and claims.

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;
\ir _helpers.sql

\set r_owner   'f0000000-0000-0000-0000-000000000001'
\set r_manager 'f0000000-0000-0000-0000-000000000002'
\set r_cash    'f0000000-0000-0000-0000-000000000003'
\set r_stock   'f0000000-0000-0000-0000-000000000004'
insert into auth.users (id, email) values
  (:'r_owner', 'owner@ret.test'), (:'r_manager', 'manager@ret.test'), (:'r_cash', 'cash@ret.test'), (:'r_stock', 'stock@ret.test');

select pg_temp.act_as_service();
select public.create_organization('Return Shop', 'return-shop', :'r_owner', 'retail') as org \gset
select id as main from public.locations where organization_id = :'org' \gset
select public.set_organization_module(:'org', 'serial_tracking', true);
select public.set_organization_module(:'org', 'warranty', true);

select pg_temp.act_as(:'r_owner');
select public.upsert_staff_member(:'org', :'r_manager', 'manager');
select public.upsert_staff_member(:'org', :'r_cash', 'cashier');
select public.upsert_staff_member(:'org', :'r_stock', 'stock_keeper');
select public.update_organization_settings(:'org', '{"settings": {"return_days": 7, "bank_transfer_details": "BOC 123"}}');
set role authenticated;
insert into public.tax_rates (organization_id, code, name, rate_percent, is_default) values (:'org', 'VAT', 'VAT', 18, true);
insert into public.pos_terminals (organization_id, location_id, code, name) values (:'org', :'main', 'T1', 'Till 1') returning id as till \gset
reset role;
select public.save_product(:'org', '{"name": "Oxford Shirt", "status": "active", "variants": [{"sku": "SHIRT", "price": 5000}]}');
select public.save_product(:'org', '{"name": "Rain Jacket", "status": "active", "variants": [{"sku": "JACKET", "price": 8000}]}');
select public.save_product(:'org', '{"name": "Mug", "status": "active", "variants": [{"sku": "MUG", "price": 1000}]}');
select public.save_product(:'org', '{"name": "Nova Phone", "status": "active", "tracking_mode": "serial", "variants": [{"sku": "PHONE", "price": 100000}]}') as phone_p \gset
update public.products set warranty_months = 12 where id = :'phone_p';
select id as shirt from public.product_variants where sku = 'SHIRT' and organization_id = :'org' \gset
select id as jacket from public.product_variants where sku = 'JACKET' and organization_id = :'org' \gset
select id as mug from public.product_variants where sku = 'MUG' and organization_id = :'org' \gset
select id as phone from public.product_variants where sku = 'PHONE' and organization_id = :'org' \gset
select public.receive_stock(:'main', jsonb_build_array(
  jsonb_build_object('variant_id', :'shirt', 'quantity', 10, 'unit_cost', 2000),
  jsonb_build_object('variant_id', :'jacket', 'quantity', 5, 'unit_cost', 3500),
  jsonb_build_object('variant_id', :'mug', 'quantity', 10, 'unit_cost', 300),
  jsonb_build_object('variant_id', :'phone', 'quantity', 2, 'unit_cost', 80000, 'serials', '["IMEI-AAA", "IMEI-BBB"]'::jsonb)));

select pg_temp.act_as(:'r_cash');
set role authenticated;
insert into public.customers (organization_id, full_name, phone) values (:'org', 'Priya', '+94771110000') returning id as priya \gset
reset role;
select public.pos_open_shift(:'till', 10000)->>'shift_id' as shift \gset
select public.pos_sale(:'shift', jsonb_build_array(pg_temp.line(:'shirt', 2), pg_temp.line(:'phone', 1, array['IMEI-AAA'])),
  '[{"method": "cash", "amount": 110000}]', 'ret-sale-000001', :'priya') as s1 \gset
select id as l_shirt from public.order_lines where order_id = (:'s1'::jsonb->>'order_id')::uuid and variant_id = :'shirt' \gset
select id as l_phone from public.order_lines where order_id = (:'s1'::jsonb->>'order_id')::uuid and variant_id = :'phone' \gset

-- ---------------------------------------------------------------------------
\echo '--- returns at the till'
select (public.pos_shift_summary(:'shift')->>'expected_cash')::numeric as cash_before \gset
select public.pos_return(:'shift', (:'s1'::jsonb->>'order_id')::uuid, jsonb_build_array(jsonb_build_object('order_line_id', :'l_shirt', 'quantity', 1, 'reason', 'too small')),
  '[{"method": "cash", "amount": 5000}]', 'ret-return-00001') as r1 \gset
select pg_temp.ok(:'r1'::jsonb->>'number' = 'RET-000001' and (:'r1'::jsonb->>'refund_total')::numeric = 5000
                  and :'r1'::jsonb->'lines'->0->>'disposition' = 'pending_inspection',
                  'a till return refunds what was paid and sends the item to inspection');
select pg_temp.ok(pg_temp.on_hand(:'main', :'shirt') = 8, 'a returned item is not back on sale until inspected');
select pg_temp.ok((public.pos_shift_summary(:'shift')->>'expected_cash')::numeric = :'cash_before'::numeric - 5000,
                  'a cash refund comes out of this shift''s drawer');
select pg_temp.ok((select payment_status = 'partially_refunded' and amount_refunded = 5000 from public.orders where id = (:'s1'::jsonb->>'order_id')::uuid),
                  'the original sale shows the refund');
select pg_temp.ok((public.pos_return(:'shift', (:'s1'::jsonb->>'order_id')::uuid, jsonb_build_array(jsonb_build_object('order_line_id', :'l_shirt', 'quantity', 1)),
                     '[{"method": "cash", "amount": 5000}]', 'ret-return-00001')->>'replayed')::boolean
                  and (select count(*) from public.returns where order_id = (:'s1'::jsonb->>'order_id')::uuid) = 1,
                  'a double-tapped return is taken once');

select pg_temp.expect_error(format('select public.pos_return(%L, %L, %L::jsonb, %L::jsonb, %L)', :'shift', :'s1'::jsonb->>'order_id',
  jsonb_build_array(jsonb_build_object('order_line_id', :'l_shirt', 'quantity', 2)), '[{"method": "cash", "amount": 10000}]', 'ret-return-00002'),
  'NC003', 'you cannot return more than was bought (1 left)');
select pg_temp.expect_error(format('select public.pos_return(%L, %L, %L::jsonb, %L::jsonb, %L)', :'shift', :'s1'::jsonb->>'order_id',
  jsonb_build_array(jsonb_build_object('order_line_id', :'l_phone', 'quantity', 1, 'serials', '["IMEI-BBB"]'::jsonb)), '[{"method": "cash", "amount": 100000}]', 'ret-return-00003'),
  'NC004', 'a serialised return must be the unit that was sold');
select pg_temp.expect_error(format('select public.pos_return(%L, %L, %L::jsonb, %L::jsonb, %L)', :'shift', :'s1'::jsonb->>'order_id',
  jsonb_build_array(jsonb_build_object('order_line_id', :'l_shirt', 'quantity', 1, 'disposition', 'restock')), '[{"method": "cash", "amount": 5000}]', 'ret-return-00004'),
  '42501', 'a cashier cannot put returned goods straight back on sale');
select pg_temp.expect_error(format('select public.pos_return(%L, %L, %L::jsonb, %L::jsonb, %L)', :'shift', :'s1'::jsonb->>'order_id',
  jsonb_build_array(jsonb_build_object('order_line_id', :'l_shirt', 'quantity', 1)), '[{"method": "cash", "amount": 4000}]', 'ret-return-00005'),
  'NC003', 'the refunds must add up to what the return is worth');

select public.pos_return(:'shift', (:'s1'::jsonb->>'order_id')::uuid,
  jsonb_build_array(jsonb_build_object('order_line_id', :'l_phone', 'quantity', 1, 'serials', '["imei-aaa"]'::jsonb, 'reason', 'screen flickers')),
  '[{"method": "store_credit", "amount": 100000}]', 'ret-return-00006') as r2 \gset
select pg_temp.ok((select status = 'inspection' from public.serial_units where serial = 'IMEI-AAA')
                  and (select store_credit_balance from public.customers where id = :'priya') = 100000,
                  'a returned phone waits in inspection; the refund went to store credit');

-- ---------------------------------------------------------------------------
select public.preview_return((:'s1'::jsonb->>'order_id')::uuid, jsonb_build_array(jsonb_build_object('order_line_id', :'l_shirt', 'quantity', 1))) as pv \gset
select pg_temp.ok((:'pv'::jsonb->>'refund_total')::numeric = 5000
                  and (select (l->>'returnable')::numeric from jsonb_array_elements(:'pv'::jsonb->'lines') l where l->>'order_line_id' = :'l_shirt') = 1
                  and not exists (select 1 from public.returns where number like 'RET-%' and organization_id = :'org' and status = 'requested'),
                  'a return preview shows the refund and what is left, and keeps nothing');

\echo '--- inspection'
select pg_temp.expect_error(format('select public.inspect_return_line(%L, %L)', :'r1'::jsonb->'lines'->0->>'return_line_id', 'restock'),
  '42501', 'a cashier cannot decide what happens to returned stock');
select pg_temp.act_as(:'r_stock');
select public.inspect_return_line((:'r1'::jsonb->'lines'->0->>'return_line_id')::uuid, 'restock', 'unworn, tags on');
select pg_temp.ok(pg_temp.on_hand(:'main', :'shirt') = 9
                  and (select unit_cost from public.inventory_movements where movement_type = 'sale_return' and variant_id = :'shirt') = 2000,
                  'restocking puts it back on sale at the cost it was sold at');
select pg_temp.expect_error(format('select public.inspect_return_line(%L, %L)', :'r1'::jsonb->'lines'->0->>'return_line_id', 'damaged'),
  'NC006', 'an inspected line is not decided twice');
select pg_temp.expect_error(format('select public.inspect_return_line(%L, %L)', :'r2'::jsonb->'lines'->0->>'return_line_id', 'write_off'),
  'NC003', 'writing off needs a reason');
select public.inspect_return_line((:'r2'::jsonb->'lines'->0->>'return_line_id')::uuid, 'service', 'sent to the brand service centre');
select public.inspect_return_line((:'r2'::jsonb->'lines'->0->>'return_line_id')::uuid, 'write_off', 'beyond repair');
select pg_temp.ok((select status = 'written_off' from public.serial_units where serial = 'IMEI-AAA') and pg_temp.on_hand(:'main', :'phone') = 1,
                  'a unit back from service can still be written off; it never re-entered stock');

-- ---------------------------------------------------------------------------
\echo '--- refunds follow discounts and rounding'
select pg_temp.act_as(:'r_manager');
select pg_temp.act_as(:'r_owner');
set role authenticated;
insert into public.pos_terminals (organization_id, location_id, code, name) values (:'org', :'main', 'T2', 'Till 2') returning id as till2 \gset
reset role;
select pg_temp.act_as(:'r_manager');
select public.pos_open_shift(:'till2', 0)->>'shift_id' as mshift \gset
select public.pos_sale(:'mshift', jsonb_build_array(pg_temp.line(:'mug', 3)), '[{"method": "card", "amount": 2700}]', 'ret-sale-000002',
  null, '{"type": "percent", "value": 10}') as s2 \gset
select id as l_mug from public.order_lines where order_id = (:'s2'::jsonb->>'order_id')::uuid \gset
select pg_temp.ok((public.pos_return(:'mshift', (:'s2'::jsonb->>'order_id')::uuid, jsonb_build_array(jsonb_build_object('order_line_id', :'l_mug', 'quantity', 1)),
                     '[{"method": "card", "amount": 900}]', 'ret-return-00010')->>'refund_total')::numeric = 900,
                  'a discounted item refunds its discounted price (1000 less 10% = 900)');
select public.pos_return(:'mshift', (:'s2'::jsonb->>'order_id')::uuid, jsonb_build_array(jsonb_build_object('order_line_id', :'l_mug', 'quantity', 2, 'disposition', 'restock')),
  '[{"method": "card", "amount": 1800}]', 'ret-return-00011') as r11 \gset
select pg_temp.ok((:'r11'::jsonb->>'refund_total')::numeric = 1800
                  and (select amount_refunded = amount_paid from public.orders where id = (:'s2'::jsonb->>'order_id')::uuid),
                  'returning the rest refunds exactly what is left - never more than was paid');
select pg_temp.ok(pg_temp.on_hand(:'main', :'mug') = 9, 'a manager can restock on return when the goods are unopened');

-- ---------------------------------------------------------------------------
\echo '--- exchanges'
select pg_temp.act_as(:'r_cash');
select (public.pos_shift_summary(:'shift')->>'expected_cash')::numeric as cash_before \gset
select public.pos_sale(:'shift', jsonb_build_array(pg_temp.line(:'shirt', 1)), '[{"method": "cash", "amount": 5000}]', 'ret-sale-000003') as s3 \gset
select id as l_s3 from public.order_lines where order_id = (:'s3'::jsonb->>'order_id')::uuid \gset
select public.pos_exchange(:'shift', (:'s3'::jsonb->>'order_id')::uuid,
  jsonb_build_array(jsonb_build_object('order_line_id', :'l_s3', 'quantity', 1, 'reason', 'prefers the jacket')),
  jsonb_build_array(pg_temp.line(:'jacket', 1)), '[{"method": "cash", "amount": 3000}]', 'ret-exch-0000001') as ex \gset
select pg_temp.ok((:'ex'::jsonb->>'credit_used')::numeric = 5000 and (:'ex'::jsonb->'sale'->>'total')::numeric = 8000
                  and :'ex'::jsonb->'sale'->>'payment_status' = 'paid' and (:'ex'::jsonb->>'leftover_refunded')::numeric = 0,
                  'exchange up: return 5,000, jacket 8,000, customer pays 3,000');
select pg_temp.ok((public.pos_shift_summary(:'shift')->>'expected_cash')::numeric = :'cash_before'::numeric + 5000 + 3000,
                  'only real cash moves the drawer (the 5,000 sale, then 3,000 on the exchange)');
select id as l_jacket from public.order_lines where order_id = (:'ex'::jsonb->'sale'->>'order_id')::uuid \gset
select public.pos_exchange(:'shift', (:'ex'::jsonb->'sale'->>'order_id')::uuid,
  jsonb_build_array(jsonb_build_object('order_line_id', :'l_jacket', 'quantity', 1)),
  jsonb_build_array(pg_temp.line(:'mug', 2)), '[]', 'ret-exch-0000002') as ex2 \gset
select pg_temp.ok((:'ex2'::jsonb->>'credit_used')::numeric = 2000 and (:'ex2'::jsonb->>'leftover_refunded')::numeric = 6000
                  and :'ex2'::jsonb->>'leftover_method' = 'cash',
                  'exchange down: jacket 8,000 for two mugs 2,000 - 6,000 back in cash');
select pg_temp.ok((select sum(case when kind = 'refund' then -amount else amount end) from public.payments
                    where order_id = (:'ex'::jsonb->'sale'->>'order_id')::uuid and status = 'captured') = 0,
                  'the exchanged-away jacket sale nets to zero: its value moved to the mugs and the change');
select pg_temp.expect_error(format('select public.pos_sale(%L, %L::jsonb, %L::jsonb, %L)', :'shift',
  jsonb_build_array(pg_temp.line(:'mug', 1)), '[{"method": "return_credit", "amount": 1000}]', 'ret-sale-cheat01'),
  'NC003', 'return credit cannot be used as money outside an exchange');

-- ---------------------------------------------------------------------------
\echo '--- return period'
select pg_temp.act_as_service();
update public.orders set confirmed_at = now() - interval '30 days' where id = (:'s3'::jsonb->>'order_id')::uuid;
select pg_temp.act_as(:'r_cash');
select public.pos_sale(:'shift', jsonb_build_array(pg_temp.line(:'mug', 1)), '[{"method": "cash", "amount": 1000}]', 'ret-sale-000005') as s5 \gset
select pg_temp.act_as_service();
update public.orders set confirmed_at = now() - interval '30 days' where id = (:'s5'::jsonb->>'order_id')::uuid;
select pg_temp.act_as(:'r_cash');
select pg_temp.expect_error(format('select public.pos_return(%L, %L, %L::jsonb, %L::jsonb, %L)', :'shift', :'s5'::jsonb->>'order_id',
  jsonb_build_array(jsonb_build_object('order_line_id', (select id from public.order_lines where order_id = (:'s5'::jsonb->>'order_id')::uuid), 'quantity', 1)),
  '[{"method": "cash", "amount": 1000}]', 'ret-return-00020'),
  'NC006', 'a cashier cannot take a return outside the return period');
select pg_temp.act_as(:'r_manager');
select pg_temp.ok((public.create_return((:'s5'::jsonb->>'order_id')::uuid, :'main',
                     jsonb_build_array(jsonb_build_object('order_line_id', (select id from public.order_lines where order_id = (:'s5'::jsonb->>'order_id')::uuid), 'quantity', 1)),
                     '[{"method": "cash", "amount": 1000}]', 'goodwill')->>'status') = 'received',
                  'a manager can still take it from the admin');

-- ---------------------------------------------------------------------------
\echo '--- online returns'
select pg_temp.act_as(null);
select public.checkout(:'org', jsonb_build_array(pg_temp.line(:'shirt', 2)), 'ret-web-00000001',
  '{"full_name": "Web Buyer", "phone": "+94770001111"}', '{"method": "pickup"}', 'bank_transfer') as w \gset
select pg_temp.act_as(:'r_manager');
select public.record_payment((:'w'::jsonb->>'order_id')::uuid, 'bank_transfer', 10000, 'BOC-1');
select id as l_web from public.order_lines where order_id = (:'w'::jsonb->>'order_id')::uuid \gset
select pg_temp.act_as(null);
select pg_temp.expect_error(format('select public.request_return(%L, %L, %L::jsonb, %L)', :'w'::jsonb->>'order_id', 'guess',
  jsonb_build_array(jsonb_build_object('order_line_id', :'l_web', 'quantity', 1)), 'wrong colour'),
  'NC005', 'nobody else can request a return on an order');
select public.request_return((:'w'::jsonb->>'order_id')::uuid, :'w'::jsonb->>'access_token',
  jsonb_build_array(jsonb_build_object('order_line_id', :'l_web', 'quantity', 1)), 'wrong colour') as wr \gset
select pg_temp.ok(:'wr'::jsonb->>'status' = 'requested' and (:'wr'::jsonb->>'refund_total')::numeric = 5000
                  and (select amount_refunded from public.orders where id = (:'w'::jsonb->>'order_id')::uuid) = 0,
                  'a customer asks to return online; nothing moves until it arrives');
select pg_temp.expect_error(format('select public.request_return(%L, %L, %L::jsonb, %L)', :'w'::jsonb->>'order_id', :'w'::jsonb->>'access_token',
  jsonb_build_array(jsonb_build_object('order_line_id', :'l_web', 'quantity', 2)), 'both'),
  'NC003', 'a second request cannot cover items already being returned');
select pg_temp.act_as(:'r_manager');
select public.receive_return((:'wr'::jsonb->>'return_id')::uuid, :'main', '[{"method": "bank_transfer", "amount": 5000, "reference": "BOC-R1"}]') as wr2 \gset
select pg_temp.ok(:'wr2'::jsonb->>'status' = 'received' and (select amount_refunded from public.orders where id = (:'w'::jsonb->>'order_id')::uuid) = 5000,
                  'staff receive it and refund by bank transfer');

-- ---------------------------------------------------------------------------
\echo '--- warranty'
select pg_temp.act_as(:'r_cash');
select public.pos_sale(:'shift', jsonb_build_array(pg_temp.line(:'phone', 1, array['IMEI-BBB'])), '[{"method": "card", "amount": 100000}]', 'ret-sale-000006', :'priya') as s6 \gset
select public.warranty_lookup(:'org', 'imei-bbb') as wl \gset
select pg_temp.ok(jsonb_array_length(:'wl'::jsonb) = 1 and :'wl'::jsonb->0->>'warranty_status' = 'active'
                  and (:'wl'::jsonb->0->>'warranty_months')::int = 12 and :'wl'::jsonb->0->>'matched_serial' = 'IMEI-BBB'
                  and (:'wl'::jsonb->0->>'warranty_expires_on')::date = (current_date + interval '12 months')::date
                  and :'wl'::jsonb->0->'customer'->>'phone' = '+94771110000',
                  'an IMEI finds the sale, customer and a 12-month warranty expiry');
select pg_temp.ok(jsonb_array_length(public.warranty_lookup(:'org', '0771110000')) >= 3,
                  'a local phone number finds that customer''s purchases');
select pg_temp.ok(jsonb_array_length(public.warranty_lookup(:'org', :'s6'::jsonb->>'number')) = 1, 'a receipt number finds its lines');
select id as l_s6 from public.order_lines where order_id = (:'s6'::jsonb->>'order_id')::uuid \gset
select pg_temp.expect_error(format('select public.open_warranty_claim(%L, %L, %L)', :'org', :'l_s6', 'no sound'),
  'NC003', 'a claim on a serialised item names the unit');
select public.open_warranty_claim(:'org', :'l_s6', 'no sound from speaker', 'IMEI-BBB') as wc \gset
select pg_temp.ok(:'wc'::jsonb->>'number' = 'WC-000001' and (:'wc'::jsonb->>'within_warranty')::boolean, 'a claim is opened within warranty');
select pg_temp.expect_error(format('select public.update_warranty_claim(%L, %L)', :'wc'::jsonb->>'claim_id', 'in_repair'),
  '42501', 'a cashier opens claims but does not run them');
select pg_temp.act_as(:'r_manager');
select public.update_warranty_claim((:'wc'::jsonb->>'claim_id')::uuid, 'in_repair', 'sent to service centre');
select pg_temp.expect_error(format('select public.update_warranty_claim(%L, %L)', :'wc'::jsonb->>'claim_id', 'closed'),
  'NC003', 'a claim is not closed without a resolution');
select pg_temp.ok(jsonb_array_length(public.update_warranty_claim((:'wc'::jsonb->>'claim_id')::uuid, 'closed', 'collected', 'speaker replaced under warranty')->'history') = 3,
                  'every status change is kept in the claim''s history');
select pg_temp.ok((public.warranty_lookup(:'org', 'IMEI-BBB')->0->'claims'->0->>'status') = 'closed', 'the lookup shows the claim');

select pg_temp.act_as_service();
select public.set_organization_module(:'org', 'warranty', false);
select pg_temp.act_as(:'r_manager');
select pg_temp.expect_error(format('select public.warranty_lookup(%L, %L)', :'org', 'IMEI-BBB'), 'NC002', 'warranty lookup is part of the warranty module');

-- ---------------------------------------------------------------------------
\echo '--- integrity'
select pg_temp.act_as_service();
select pg_temp.ok((select count(*) from public._inventory_integrity(:'org')) = 0, 'stock, serials and the ledger still agree');
select pg_temp.ok(not exists (select 1 from public.returns r where r.organization_id = :'org'
                               and r.refund_total <> (select coalesce(sum(line_refund), 0) from public.return_lines where return_id = r.id)),
                  'every return is worth the sum of its lines');
select pg_temp.ok(not exists (select 1 from public.orders o where o.organization_id = :'org' and o.amount_refunded > o.amount_paid),
                  'no order ever refunds more than was paid');
