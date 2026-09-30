-- 05_pos_flow.sql
-- The counter: tills, shifts with a float, sales tied to the cashier's own shift,
-- cash paid in / out, held sales, receipts, collecting on an earlier order, and a
-- close that must explain any difference between expected and counted cash.

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;
\ir _helpers.sql
-- No nwsc.pos_shift marker here: this suite goes through pos_sale like a real till.

\set p_owner    'e0000000-0000-0000-0000-000000000001'
\set p_manager  'e0000000-0000-0000-0000-000000000002'
\set p_cash1    'e0000000-0000-0000-0000-000000000003'
\set p_cash2    'e0000000-0000-0000-0000-000000000004'
\set p_owner2   'e0000000-0000-0000-0000-000000000005'
insert into auth.users (id, email) values
  (:'p_owner', 'owner@till.test'), (:'p_manager', 'manager@till.test'), (:'p_cash1', 'anne@till.test'),
  (:'p_cash2', 'ben@till.test'), (:'p_owner2', 'owner@webonly.test');

select pg_temp.act_as_service();
select public.create_organization('Till Shop', 'till-shop', :'p_owner', 'retail') as org \gset
select id as main from public.locations where organization_id = :'org' \gset
select public.create_organization('Web Only', 'web-only', :'p_owner2', 'ecommerce') as org2 \gset
select id as main2 from public.locations where organization_id = :'org2' \gset

select pg_temp.act_as(:'p_owner');
select public.upsert_staff_member(:'org', :'p_manager', 'manager');
select public.upsert_staff_member(:'org', :'p_cash1', 'cashier');
select public.upsert_staff_member(:'org', :'p_cash2', 'cashier');
select public.update_organization_settings(:'org', '{"settings": {"receipt_footer": "Exchanges within 7 days with this receipt"}}');
select public.save_product(:'org', '{"name": "Canvas Tote", "status": "active", "variants": [{"sku": "TOTE", "barcode": "4793333000017", "price": 2000}]}') as tote_p \gset
select id as tote from public.product_variants where sku = 'TOTE' and organization_id = :'org' \gset
select public.receive_stock(:'main', jsonb_build_array(jsonb_build_object('variant_id', :'tote', 'quantity', 20, 'unit_cost', 800)));

\echo '--- tills'
set role authenticated;
insert into public.pos_terminals (organization_id, location_id, code, name) values (:'org', :'main', 'TILL1', 'Front counter') returning id as till1 \gset
insert into public.pos_terminals (organization_id, location_id, code, name) values (:'org', :'main', 'TILL2', 'Back counter') returning id as till2 \gset
reset role;
select pg_temp.act_as(:'p_owner2');
select pg_temp.expect_error(format('insert into public.pos_terminals (organization_id, location_id, code, name) values (%L, %L, %L, %L)', :'org2', :'main2', 'T1', 'Till'),
  'NC002', 'a business without the POS module cannot add a till', 'authenticated');
select pg_temp.act_as(:'p_cash1');
select pg_temp.expect_error(format('insert into public.pos_terminals (organization_id, location_id, code, name) values (%L, %L, %L, %L)', :'org', :'main', 'T9', 'Mine'),
  '42501', 'a cashier cannot add tills', 'authenticated');

\echo '--- shifts and sales'
select pg_temp.expect_error(format('select public.place_order(%L, %L, %L::jsonb, p_payments => %L::jsonb)', :'main', 'pos',
  jsonb_build_array(pg_temp.line(:'tote', 1)), '[{"method": "cash", "amount": 2000}]'),
  'NC003', 'the API cannot ring up a counter sale outside a till shift', 'authenticated');
select pg_temp.expect_error(format('select public.pos_open_shift(%L, -1)', :'till1'), 'NC003', 'a float cannot be negative');

select public.pos_open_shift(:'till1', 5000) as sh \gset
select (:'sh'::jsonb->>'shift_id') as shift1 \gset
select pg_temp.ok(:'sh'::jsonb->>'status' = 'open' and :'sh'::jsonb->>'number' = 'SH-000001' and (:'sh'::jsonb->>'expected_cash')::numeric = 5000,
                  'a cashier opens a shift on a till with a counted float');
select pg_temp.act_as(:'p_cash2');
select pg_temp.expect_error(format('select public.pos_open_shift(%L, 1000)', :'till1'), 'NC006', 'a till has one open shift at a time');
select pg_temp.expect_error(format('select public.pos_sale(%L, %L::jsonb, %L::jsonb, %L)', :'shift1',
  jsonb_build_array(pg_temp.line(:'tote', 1)), '[{"method": "cash", "amount": 2000}]', 'ben-sale-0000001'),
  '42501', 'nobody else can ring up sales on a cashier''s shift');

select pg_temp.act_as(:'p_cash1');
select public.pos_sale(:'shift1', jsonb_build_array(pg_temp.line(:'tote', 2)), '[{"method": "cash", "amount": 5000}]', 'anne-sale-000001') as s1 \gset
select pg_temp.ok((:'s1'::jsonb->>'change_due')::numeric = 1000 and :'s1'::jsonb->>'payment_status' = 'paid',
                  'cash 5000 for 4000: change 1000');
select pg_temp.ok((select shift_id = :'shift1'::uuid and terminal_id = :'till1'::uuid and channel = 'pos' from public.orders where id = (:'s1'::jsonb->>'order_id')::uuid)
                  and (select bool_and(shift_id = :'shift1'::uuid) from public.payments where order_id = (:'s1'::jsonb->>'order_id')::uuid),
                  'the sale and its payment belong to the till and shift');
select pg_temp.ok((public.pos_sale(:'shift1', jsonb_build_array(pg_temp.line(:'tote', 2)), '[{"method": "cash", "amount": 5000}]', 'anne-sale-000001')->>'replayed')::boolean
                  and pg_temp.on_hand(:'main', :'tote') = 18, 'a double-tapped Pay button sells once');
select public.pos_sale(:'shift1', jsonb_build_array(pg_temp.line(:'tote', 1)), '[{"method": "card", "amount": 2000, "reference": "AUTH-77"}]', 'anne-sale-000002');

select public.pos_quote(:'shift1', jsonb_build_array(pg_temp.line(:'tote', 2)), '{"type": "percent", "value": 10}') as q \gset
select pg_temp.ok((:'q'::jsonb->>'total')::numeric = 3600 and (:'q'::jsonb->>'needs_approval')::boolean
                  and (:'q'::jsonb->'stock'->>:'tote')::numeric = 17,
                  'a till quote prices the discount, flags that it needs a manager and shows shelf stock');
select pg_temp.ok(not exists (select 1 from public.orders where number like 'QUOTE-%'), 'a till quote leaves nothing behind');
select pg_temp.act_as(:'p_manager');
select public.set_my_pin(:'org', '8642');
select pg_temp.act_as(:'p_cash1');
select pg_temp.ok((select count(*) = 1 and bool_and(email = 'manager@till.test') from public.pos_approvers(:'org')),
                  'the till lists managers who can approve (with a PIN set)');
select pg_temp.ok(public.pos_context(:'org')->'my_open_shift'->>'shift_id' = :'shift1'
                  and jsonb_array_length(public.pos_context(:'org')->'terminals') = 2,
                  'reopening the till screen finds my open shift and the tills');

\echo '--- cash in and out'
select public.pos_cash_movement(:'shift1', 'paid_out', 300, 'milk for the staff room');
select public.pos_cash_movement(:'shift1', 'paid_in', 100, 'change from the bank');
select pg_temp.expect_error(format('select public.pos_cash_movement(%L, %L, 99999, %L)', :'shift1', 'drop', 'to the safe'),
  'NC003', 'you cannot drop more cash than the drawer holds');
select pg_temp.expect_error(format('select public.pos_cash_movement(%L, %L, 10, %L)', :'shift1', 'paid_out', ''),
  'NC003', 'cash out needs a reason');
select pg_temp.ok((public.pos_shift_summary(:'shift1')->>'expected_cash')::numeric = 5000 + 4000 + 100 - 300,
                  'expected cash = float + cash sales + paid in - paid out (card sales excluded)');

\echo '--- held sales'
select public.pos_hold_sale(:'shift1', jsonb_build_array(pg_temp.line(:'tote', 3)), null, 'lady in blue') as held \gset
select pg_temp.ok(pg_temp.on_hand(:'main', :'tote') = 17, 'parking a sale does not take stock');
select pg_temp.ok(public.pos_resume_sale(:'shift1', :'held')->'lines'->0->>'quantity' = '3', 'a held sale comes back with its lines');
select pg_temp.expect_error(format('select public.pos_resume_sale(%L, %L)', :'shift1', :'held'), 'NC005', 'a held sale can only be resumed once');
select public.pos_hold_sale(:'shift1', jsonb_build_array(pg_temp.line(:'tote', 1))) as held2 \gset

\echo '--- receipts and collecting on earlier orders'
select public.pos_receipt((:'s1'::jsonb->>'order_id')::uuid) as rcpt \gset
select pg_temp.ok(:'rcpt'::jsonb->'business'->>'name' = 'Till Shop' and :'rcpt'::jsonb->>'cashier' = 'anne@till.test'
                  and :'rcpt'::jsonb->>'terminal' = 'Front counter'
                  and :'rcpt'::jsonb->'business'->>'footer' = 'Exchanges within 7 days with this receipt',
                  'the receipt has the business, till, cashier and footer');

select pg_temp.act_as(:'p_manager');
select public.place_order(:'main', 'phone_order', jsonb_build_array(pg_temp.line(:'tote', 1))) as ph \gset
select pg_temp.act_as(:'p_cash1');
select public.pos_take_payment(:'shift1', (:'ph'::jsonb->>'order_id')::uuid, 'cash', 2000);
select pg_temp.ok((public.pos_shift_summary(:'shift1')->>'expected_cash')::numeric = 8800 + 2000,
                  'cash collected at the till for a phone order lands in this shift');

\echo '--- closing'
select pg_temp.act_as(:'p_cash2');
select pg_temp.expect_error(format('select public.pos_close_shift(%L, 10800)', :'shift1'), '42501', 'another cashier cannot close my shift');
select pg_temp.expect_error(format('select public.pos_shift_summary(%L)', :'shift1'), '42501', 'another cashier cannot read my shift report');
select pg_temp.act_as(:'p_cash1');
select pg_temp.expect_error(format('select public.pos_close_shift(%L, 10500)', :'shift1'), 'NC003', 'a short drawer needs an explanation');
select public.pos_close_shift(:'shift1', 10500, 'gave wrong change once') as z \gset
select pg_temp.ok(:'z'::jsonb->>'status' = 'closed' and (:'z'::jsonb->>'variance')::numeric = -300
                  and (:'z'::jsonb->'sales'->>'count')::int = 2 and (:'z'::jsonb->>'expected_cash')::numeric = 10800,
                  'closing records expected, counted and the variance (Z report)');
select pg_temp.ok(not exists (select 1 from public.pos_held_sales where terminal_id = :'till1'), 'parked sales go when the shift closes');
select pg_temp.expect_error(format('select public.pos_sale(%L, %L::jsonb, %L::jsonb, %L)', :'shift1',
  jsonb_build_array(pg_temp.line(:'tote', 1)), '[{"method": "cash", "amount": 2000}]', 'anne-sale-000009'),
  'NC006', 'no sales on a closed shift');

select pg_temp.act_as(:'p_cash2');
select public.pos_open_shift(:'till2', 1000)->>'shift_id' as shift2 \gset
select pg_temp.act_as(:'p_manager');
select pg_temp.ok(public.pos_close_shift(:'shift2', 1000)->>'status' = 'closed', 'a manager can close a cashier''s shift');
select pg_temp.act_as(:'p_owner');
select pg_temp.ok((public.pos_shift_summary(:'shift1')->'by_method') @> '[{"method": "card", "taken": 2000}]'::jsonb,
                  'the owner reads any shift report, split by payment method');
select pg_temp.ok(pg_temp.scalar_as('authenticated', format('select count(*) from public.pos_shifts where organization_id = %L', :'org')) = '2',
                  'the owner sees every shift');
select pg_temp.act_as(:'p_cash2');
select pg_temp.ok(pg_temp.scalar_as('authenticated', format('select count(*) from public.pos_shifts where organization_id = %L', :'org')) = '1',
                  'a cashier sees only their own shifts');
select pg_temp.expect_error(format('update public.pos_shifts set counted_cash = 1 where id = %L', :'shift1'), '42501', 'shifts cannot be edited directly', 'authenticated');

select pg_temp.act_as_service();
select pg_temp.ok((select count(*) from public._inventory_integrity(:'org')) = 0, 'stock still agrees with the ledger');
