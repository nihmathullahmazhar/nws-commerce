-- 07_purchasing_transfers.sql
-- Suppliers, purchase orders received in parts (with serials and lots), reorder
-- suggestions, and transfers that hold, move and receive stock between locations.

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;
\ir _helpers.sql
select set_config('nwsc.pos_shift', 'test-suite', false);

\set t_owner   'a1000000-0000-0000-0000-000000000001'
\set t_manager 'a1000000-0000-0000-0000-000000000002'
\set t_stock   'a1000000-0000-0000-0000-000000000003'
\set t_kandy   'a1000000-0000-0000-0000-000000000004'
\set t_cash    'a1000000-0000-0000-0000-000000000005'
insert into auth.users (id, email) values
  (:'t_owner', 'owner@chain.test'), (:'t_manager', 'manager@chain.test'), (:'t_stock', 'stock@chain.test'),
  (:'t_kandy', 'kandy@chain.test'), (:'t_cash', 'cash@chain.test');

select pg_temp.act_as_service();
select public.create_organization('Chain Store', 'chain-store', :'t_owner', 'omnichannel') as org \gset
select id as main from public.locations where organization_id = :'org' \gset
select public.set_organization_module(:'org', 'serial_tracking', true);
select public.set_organization_module(:'org', 'batch_tracking', true);

select pg_temp.act_as(:'t_owner');
set role authenticated;
insert into public.locations (organization_id, code, name, kind) values (:'org', 'KANDY', 'Kandy', 'store') returning id as kandy \gset
reset role;
select public.upsert_staff_member(:'org', :'t_manager', 'manager');
select public.upsert_staff_member(:'org', :'t_stock', 'stock_keeper', array[:'main']::uuid[]);
select public.upsert_staff_member(:'org', :'t_kandy', 'stock_keeper', array[:'kandy']::uuid[]);
select public.upsert_staff_member(:'org', :'t_cash', 'cashier');
select public.save_product(:'org', '{"name": "Kettle", "status": "active", "variants": [{"sku": "KETTLE", "price": 6500}]}');
select public.save_product(:'org', '{"name": "Tablet", "status": "active", "tracking_mode": "serial", "variants": [{"sku": "TAB", "price": 45000}]}');
select public.save_product(:'org', '{"name": "Sunscreen", "status": "active", "tracking_mode": "batch", "variants": [{"sku": "SPF", "price": 1900}]}');
select id as kettle from public.product_variants where sku = 'KETTLE' and organization_id = :'org' \gset
select id as tab from public.product_variants where sku = 'TAB' and organization_id = :'org' \gset
select id as spf from public.product_variants where sku = 'SPF' and organization_id = :'org' \gset

-- ---------------------------------------------------------------------------
\echo '--- suppliers and purchase orders'
select pg_temp.act_as(:'t_manager');
set role authenticated;
insert into public.suppliers (organization_id, name, phone, payment_terms_days) values (:'org', 'Lanka Distributors', '+94112000000', 30) returning id as sup \gset
reset role;
select pg_temp.act_as(:'t_cash');
select pg_temp.expect_error(format('insert into public.suppliers (organization_id, name) values (%L, %L)', :'org', 'Sneaky Co'),
  '42501', 'a cashier cannot add suppliers', 'authenticated');
select pg_temp.expect_error(format('select public.save_purchase_order(%L, %L::jsonb)', :'org',
  jsonb_build_object('supplier_id', :'sup', 'location_id', :'main', 'lines', jsonb_build_array(jsonb_build_object('variant_id', :'kettle', 'quantity', 1, 'unit_cost', 1)))),
  '42501', 'a cashier cannot raise purchase orders');

select pg_temp.act_as(:'t_manager');
select public.save_purchase_order(:'org', jsonb_build_object('supplier_id', :'sup', 'location_id', :'main', 'supplier_reference', 'QT-55',
  'lines', jsonb_build_array(
    jsonb_build_object('variant_id', :'kettle', 'quantity', 10, 'unit_cost', 3000),
    jsonb_build_object('variant_id', :'tab', 'quantity', 2, 'unit_cost', 30000),
    jsonb_build_object('variant_id', :'spf', 'quantity', 24, 'unit_cost', 900)))) as po \gset
select pg_temp.ok((select number = 'PO-000001' and status = 'draft' and total = 10*3000 + 2*30000 + 24*900 from public.purchase_orders where id = :'po'),
                  'a draft PO is numbered and totalled');
select pg_temp.act_as(:'t_stock');
select pg_temp.expect_error(format('select public.receive_purchase_order(%L, %L::jsonb)', :'po',
  jsonb_build_array(jsonb_build_object('po_line_id', (select id from public.purchase_order_lines where purchase_order_id = :'po' and variant_id = :'kettle'), 'quantity', 1))),
  'NC006', 'goods cannot be received against an order that was never placed');
select pg_temp.act_as(:'t_manager');
select public.place_purchase_order(:'po');
select pg_temp.expect_error(format('select public.save_purchase_order(%L, %L::jsonb)', :'org',
  jsonb_build_object('id', :'po', 'supplier_id', :'sup', 'location_id', :'main', 'lines', jsonb_build_array(jsonb_build_object('variant_id', :'kettle', 'quantity', 99, 'unit_cost', 1)))),
  'NC006', 'a placed order cannot be edited');

select id as pl_kettle from public.purchase_order_lines where purchase_order_id = :'po' and variant_id = :'kettle' \gset
select id as pl_tab from public.purchase_order_lines where purchase_order_id = :'po' and variant_id = :'tab' \gset
select id as pl_spf from public.purchase_order_lines where purchase_order_id = :'po' and variant_id = :'spf' \gset

select pg_temp.act_as(:'t_stock');
select public.receive_purchase_order(:'po', jsonb_build_array(
  jsonb_build_object('po_line_id', :'pl_kettle', 'quantity', 6),
  jsonb_build_object('po_line_id', :'pl_tab', 'quantity', 2, 'serials', '["TAB-001", "TAB-002"]'::jsonb),
  jsonb_build_object('po_line_id', :'pl_spf', 'quantity', 24, 'lot_code', 'L-24A', 'expires_on', current_date + 365)), 'DN-881') as rc \gset
select pg_temp.ok(:'rc'::jsonb->>'status' = 'partially_received'
                  and pg_temp.on_hand(:'main', :'kettle') = 6 and pg_temp.on_hand(:'main', :'tab') = 2 and pg_temp.on_hand(:'main', :'spf') = 24,
                  'a first delivery lands 6 of 10 kettles, both tablets by serial and a lot of sunscreen');
select pg_temp.ok((select avg_unit_cost from public.stock_levels where location_id = :'main' and variant_id = :'kettle') = 3000
                  and (select purchase_order_id = :'po'::uuid and supplier_id = :'sup'::uuid from public.stock_receipts where id = (:'rc'::jsonb->>'receipt_id')::uuid),
                  'goods are costed at the PO price and the receipt points back to the PO and supplier');
select pg_temp.expect_error(format('select public.receive_purchase_order(%L, %L::jsonb)', :'po',
  jsonb_build_array(jsonb_build_object('po_line_id', :'pl_kettle', 'quantity', 5))),
  'NC003', 'you cannot receive more than is still outstanding (4)');
select public.receive_purchase_order(:'po', jsonb_build_array(jsonb_build_object('po_line_id', :'pl_kettle', 'quantity', 4, 'unit_cost', 3300)));
select pg_temp.ok((select status = 'received' from public.purchase_orders where id = :'po')
                  and (select avg_unit_cost from public.stock_levels where location_id = :'main' and variant_id = :'kettle') = 3120,
                  'the last 4 at a new cost complete the PO and move the average (6 @3000 + 4 @3300 = 3120)');

select pg_temp.act_as(:'t_manager');
select public.save_purchase_order(:'org', jsonb_build_object('supplier_id', :'sup', 'location_id', :'main',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'kettle', 'quantity', 5, 'unit_cost', 3100)))) as po2 \gset
select public.close_purchase_order(:'po2', 'supplier out of stock');
select pg_temp.ok((select status = 'cancelled' from public.purchase_orders where id = :'po2'), 'an order with nothing received is cancelled');

select public.set_low_stock_threshold(:'main', :'kettle', 12);
select pg_temp.ok((select suggested = 14 and last_supplier = 'Lanka Distributors' and last_cost = 3000
                     from public.reorder_suggestions(:'org') where variant_id = :'kettle'),
                  'reorder suggestions: 10 on hand under a level of 12 -> buy 14, from the last supplier at the last (non-cancelled) PO cost');

-- ---------------------------------------------------------------------------
\echo '--- transfers'
select pg_temp.act_as(:'t_cash');
select pg_temp.expect_error(format('select public.request_transfer(%L, %L, %L::jsonb)', :'main', :'kandy', jsonb_build_array(pg_temp.line(:'kettle', 1))),
  '42501', 'a cashier cannot move stock between shops');
select pg_temp.act_as(:'t_stock');
select public.request_transfer(:'main', :'kandy', jsonb_build_array(
  pg_temp.line(:'kettle', 4), pg_temp.line(:'tab', 1, array['TAB-002']), pg_temp.line(:'spf', 10)), 'weekend promo in Kandy') as tr \gset
select pg_temp.ok((select number = 'TR-000001' and status = 'requested' from public.stock_transfers where id = :'tr')
                  and pg_temp.reserved(:'main', :'kettle') = 0, 'a request holds nothing yet');
select pg_temp.expect_error(format('select public.approve_transfer(%L)', :'tr'), '42501', 'a stock keeper cannot approve their own request');

select pg_temp.act_as(:'t_manager');
select public.approve_transfer(:'tr');
select pg_temp.ok(pg_temp.reserved(:'main', :'kettle') = 4 and (select status = 'reserved' from public.serial_units where serial = 'TAB-002'),
                  'approval holds the stock at the source');
select pg_temp.act_as(:'t_cash');
select pg_temp.expect_error(format('select public.place_order(%L, %L, %L::jsonb, p_payments => %L::jsonb)', :'main', 'pos',
  jsonb_build_array(pg_temp.line(:'kettle', 7)), '[{"method": "cash", "amount": 50000}]'),
  'NC001', 'held transfer stock cannot be sold (10 on hand, 4 held)');

select pg_temp.act_as(:'t_kandy');
select pg_temp.expect_error(format('select public.dispatch_transfer(%L)', :'tr'), '42501', 'only staff at the sending shop dispatch');
select pg_temp.act_as(:'t_stock');
select public.dispatch_transfer(:'tr');
select pg_temp.ok(pg_temp.on_hand(:'main', :'kettle') = 6 and pg_temp.reserved(:'main', :'kettle') = 0 and pg_temp.on_hand(:'kandy', :'kettle') = 0
                  and (select status = 'in_transit' from public.serial_units where serial = 'TAB-002'),
                  'dispatch takes the goods out of Main; they are in transit, not yet in Kandy');
select pg_temp.expect_error(format('select public.receive_transfer(%L)', :'tr'), '42501', 'only staff at the receiving shop receive');

select pg_temp.act_as(:'t_kandy');
select pg_temp.expect_error(format('select public.receive_transfer(%L, %L::jsonb)', :'tr',
  jsonb_build_array(jsonb_build_object('line_id', (select id from public.stock_transfer_lines where transfer_id = :'tr' and variant_id = :'kettle'), 'quantity_received', 3))),
  'NC003', 'a short delivery needs an explanation');
select public.receive_transfer(:'tr', jsonb_build_array(
  jsonb_build_object('line_id', (select id from public.stock_transfer_lines where transfer_id = :'tr' and variant_id = :'kettle'), 'quantity_received', 3)),
  'one box crushed in the van');
select pg_temp.ok(pg_temp.on_hand(:'kandy', :'kettle') = 3 and pg_temp.on_hand(:'kandy', :'tab') = 1 and pg_temp.on_hand(:'kandy', :'spf') = 10
                  and (select location_id = :'kandy'::uuid and status = 'available' from public.serial_units where serial = 'TAB-002'),
                  'Kandy receives 3 kettles, the tablet by serial and the sunscreen');
select pg_temp.ok((select avg_unit_cost from public.stock_levels where location_id = :'kandy' and variant_id = :'kettle') = 3120
                  and (select bool_and(b.lot_code = 'L-24A') from public.batch_stock bs join public.batches b on b.id = bs.batch_id where bs.location_id = :'kandy'),
                  'goods arrive at the cost they left with, in the same lot');

select pg_temp.act_as(:'t_stock');
select public.request_transfer(:'main', :'kandy', jsonb_build_array(pg_temp.line(:'kettle', 2))) as tr2 \gset
select pg_temp.act_as(:'t_manager');
select public.approve_transfer(:'tr2');
select public.cancel_transfer(:'tr2', 'Kandy has enough');
select pg_temp.ok(pg_temp.reserved(:'main', :'kettle') = 0, 'cancelling an approved transfer releases the hold');

-- ---------------------------------------------------------------------------
\echo '--- integrity'
select pg_temp.act_as_service();
select pg_temp.ok((select count(*) from public._inventory_integrity(:'org')) = 0, 'every location still agrees with the ledger');
select pg_temp.ok((select coalesce(sum(quantity), 0) from public.inventory_movements where organization_id = :'org' and variant_id = :'kettle' and movement_type in ('transfer_out', 'transfer_in')) = -1,
                  'the kettle lost in transit is the only difference between out and in');
