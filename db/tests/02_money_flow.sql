-- 02_money_flow.sql
-- Tax (inclusive and exclusive), split tender and change, discounts with role
-- limits and manager PIN approval, PIN lockout, store credit, pay-later orders,
-- gateway webhooks, refunds, and totals that always add up.

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;
\ir _helpers.sql

-- Direct database sessions (these suites) stand in for the till: counter sales
-- need an open shift, which pos_sale() marks per transaction. 05_pos_flow.sql
-- tests the real path and that the API cannot skip it.
select set_config('nwsc.pos_shift', 'test-suite', false);

create function pg_temp.cash(p_amount numeric) returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', p_amount))
$$;

\set m_owner   'b0000000-0000-0000-0000-000000000001'
\set m_manager 'b0000000-0000-0000-0000-000000000002'
\set m_cashier 'b0000000-0000-0000-0000-000000000003'
\set m_shopper 'b0000000-0000-0000-0000-000000000004'

insert into auth.users (id, email) values
  (:'m_owner', 'owner@money.test'), (:'m_manager', 'manager@money.test'),
  (:'m_cashier', 'cashier@money.test'), (:'m_shopper', 'shopper@money.test');

-- ---------------------------------------------------------------------------
-- Setup: one shop, 18% VAT by default, a 5% item and a tax-exempt item
-- ---------------------------------------------------------------------------
\echo '--- setup'
select pg_temp.act_as_service();
select public.create_organization('Money Shop', 'money-shop', :'m_owner', 'retail') as org \gset
select id as main from public.locations where organization_id = :'org' \gset

select pg_temp.act_as(:'m_owner');
select public.upsert_staff_member(:'org', :'m_manager', 'manager');
select public.upsert_staff_member(:'org', :'m_cashier', 'cashier');

set role authenticated;
insert into public.tax_rates (organization_id, code, name, rate_percent, is_default)
values (:'org', 'VAT', 'VAT', 18, true) returning id as vat \gset
insert into public.tax_rates (organization_id, code, name, rate_percent)
values (:'org', 'LOW', 'Reduced rate', 5) returning id as low \gset

insert into public.products (organization_id, name, slug, status) values (:'org', 'Widget', 'widget', 'active') returning id as p1 \gset
insert into public.product_variants (organization_id, product_id, sku, price) values (:'org', :'p1', 'WID', 1180) returning id as widget \gset
insert into public.products (organization_id, name, slug, status, tax_exempt) values (:'org', 'Book', 'book', 'active', true) returning id as p2 \gset
insert into public.product_variants (organization_id, product_id, sku, price) values (:'org', :'p2', 'BOOK', 1000) returning id as book \gset
insert into public.products (organization_id, name, slug, status, tax_rate_id) values (:'org', 'Gadget', 'gadget', 'active', :'low') returning id as p3 \gset
insert into public.product_variants (organization_id, product_id, sku, price) values (:'org', :'p3', 'GAD', 2100) returning id as gadget \gset
reset role;

select public.receive_stock(:'main', jsonb_build_array(
  jsonb_build_object('variant_id', :'widget', 'quantity', 100, 'unit_cost', 700),
  jsonb_build_object('variant_id', :'book',   'quantity', 100, 'unit_cost', 600),
  jsonb_build_object('variant_id', :'gadget', 'quantity', 100, 'unit_cost', 1500)));

select pg_temp.act_as(:'m_cashier');
set role authenticated;
insert into public.customers (organization_id, full_name, phone) values (:'org', 'Credit Customer', '+94770000001') returning id as cust \gset
reset role;

-- ---------------------------------------------------------------------------
-- 1. Tax
-- ---------------------------------------------------------------------------
\echo '--- tax'
select pg_temp.act_as(:'m_cashier');
select public.place_order(:'main', 'pos', jsonb_build_array(pg_temp.line(:'widget', 1)),
                          p_payments => pg_temp.cash(2000)) as s \gset
select pg_temp.ok((:'s'::jsonb->>'total')::numeric = 1180 and (:'s'::jsonb->>'tax_total')::numeric = 180
                  and (:'s'::jsonb->>'tax_inclusive')::boolean,
                  'shelf price 1180 includes 18% VAT of 180.00');
select pg_temp.ok((:'s'::jsonb->>'change_due')::numeric = 820
                  and (:'s'::jsonb->'payments'->0->>'tendered')::numeric = 2000
                  and (:'s'::jsonb->'payments'->0->>'amount')::numeric = 1180
                  and :'s'::jsonb->>'payment_status' = 'paid',
                  'cash 2000 for 1180: payment recorded as 1180, change 820');

select public.place_order(:'main', 'pos', jsonb_build_array(pg_temp.line(:'book', 2)),
                          p_payments => '[{"method": "card", "amount": 2000, "reference": "AUTH-1"}]') as s \gset
select pg_temp.ok((:'s'::jsonb->>'tax_total')::numeric = 0 and (:'s'::jsonb->>'total')::numeric = 2000,
                  'tax-exempt products carry no tax');

select public.place_order(:'main', 'pos', jsonb_build_array(pg_temp.line(:'gadget', 1)),
                          p_payments => pg_temp.cash(2100)) as s \gset
select pg_temp.ok((:'s'::jsonb->>'tax_total')::numeric = 100 and (:'s'::jsonb->'lines'->0->>'tax_rate')::numeric = 5,
                  'a product''s own rate overrides the default (2100 incl. 5% = 100.00)');

select pg_temp.act_as_service();
update public.organizations set prices_include_tax = false where id = :'org';
select pg_temp.act_as(:'m_cashier');
select public.place_order(:'main', 'pos', jsonb_build_array(pg_temp.line(:'widget', 1)),
                          p_payments => pg_temp.cash(1392.40)) as s \gset
select pg_temp.ok((:'s'::jsonb->>'subtotal')::numeric = 1180 and (:'s'::jsonb->>'tax_total')::numeric = 212.40
                  and (:'s'::jsonb->>'total')::numeric = 1392.40,
                  'with tax-exclusive pricing, 18% is added on top (1180 + 212.40)');
select pg_temp.act_as_service();
update public.organizations set prices_include_tax = true where id = :'org';

-- ---------------------------------------------------------------------------
-- 2. Tender
-- ---------------------------------------------------------------------------
\echo '--- tender'
select pg_temp.act_as(:'m_cashier');
select public.place_order(:'main', 'pos', jsonb_build_array(pg_temp.line(:'widget', 2)),
         p_payments => '[{"method": "card", "amount": 1000}, {"method": "cash", "amount": 2000}]') as s \gset
select pg_temp.ok(jsonb_array_length(:'s'::jsonb->'payments') = 2
                  and (:'s'::jsonb->>'change_due')::numeric = 640 and :'s'::jsonb->>'payment_status' = 'paid',
                  'split tender: card 1000 + cash 2000 for 2360 gives 640 change');

select pg_temp.expect_error(format('select public.place_order(%L, %L, %L::jsonb, p_payments => %L::jsonb)',
  :'main', 'pos', jsonb_build_array(pg_temp.line(:'widget', 1)), '[{"method": "card", "amount": 5000}]'),
  'NC003', 'a card cannot be charged more than is due');
select on_hand as stock_before from public.stock_levels where variant_id = :'widget' \gset
select pg_temp.expect_error(format('select public.place_order(%L, %L, %L::jsonb, p_payments => %L::jsonb)',
  :'main', 'pos', jsonb_build_array(pg_temp.line(:'widget', 1)), pg_temp.cash(500)),
  'NC007', 'a counter sale must be paid in full');
select pg_temp.ok((select on_hand from public.stock_levels where variant_id = :'widget') = :'stock_before',
                  'an unpaid counter sale leaves stock untouched');
select pg_temp.expect_error(format('select public.place_order(%L, %L, %L::jsonb, p_payments => %L::jsonb)',
  :'main', 'pos', jsonb_build_array(pg_temp.line(:'widget', 1)), '[{"method": "online_gateway", "amount": 1180}]'),
  'NC003', 'the counter cannot record a gateway payment');

-- ---------------------------------------------------------------------------
-- 3. Discounts, limits and manager approval
-- ---------------------------------------------------------------------------
\echo '--- discounts'
select pg_temp.expect_error(format('select public.place_order(%L, %L, %L::jsonb, p_payments => %L::jsonb)',
  :'main', 'pos',
  jsonb_build_array(pg_temp.line(:'widget', 1) || '{"discount": {"type": "percent", "value": 10}}'),
  pg_temp.cash(2000)),
  'NC008', 'a cashier (limit 0%) needs approval for a 10% discount');

select pg_temp.act_as(:'m_manager');
select public.set_my_pin(:'org', '4321');
select pg_temp.expect_error(format('select public.set_my_pin(%L, %L)', :'org', '12'), 'NC003', 'a PIN must be 4-8 digits');

select pg_temp.act_as(:'m_cashier');
select pg_temp.ok(public.request_override(:'org', :'m_manager', '0000')->>'reason' = 'wrong_pin',
                  'a wrong PIN is refused and counted');
select public.request_override(:'org', :'m_manager', '4321') as appr \gset
select pg_temp.ok((:'appr'::jsonb->>'approved')::boolean and (:'appr'::jsonb->>'max_discount_percent')::numeric = 50,
                  'the manager''s PIN issues a one-time approval up to their 50% limit');

select public.place_order(:'main', 'pos',
         jsonb_build_array(pg_temp.line(:'widget', 1) || '{"discount": {"type": "percent", "value": 10}}'),
         p_payments => pg_temp.cash(2000), p_approval_id => (:'appr'::jsonb->>'approval_id')::uuid) as s \gset
select pg_temp.ok((:'s'::jsonb->>'discount_total')::numeric = 118 and (:'s'::jsonb->>'total')::numeric = 1062
                  and (:'s'::jsonb->>'tax_total')::numeric = round(1062 - 1062 / 1.18, 2),
                  'approved 10% off: 1180 -> 1062, tax recalculated on the discounted price');
select pg_temp.ok((select order_id = (:'s'::jsonb->>'order_id')::uuid and used_at is not null
                     from public.approvals where id = (:'appr'::jsonb->>'approval_id')::uuid),
                  'the approval is tied to the sale it was used on');
select pg_temp.expect_error(format('select public.place_order(%L, %L, %L::jsonb, p_payments => %L::jsonb, p_approval_id => %L)',
  :'main', 'pos',
  jsonb_build_array(pg_temp.line(:'widget', 1) || '{"discount": {"type": "percent", "value": 10}}'),
  pg_temp.cash(2000), :'appr'::jsonb->>'approval_id'),
  'NC008', 'an approval cannot be used twice');

select pg_temp.act_as(:'m_manager');
select public.place_order(:'main', 'pos',
         jsonb_build_array(pg_temp.line(:'widget', 1), pg_temp.line(:'book', 1)),
         p_payments => pg_temp.cash(5000),
         p_order_discount => '{"type": "amount", "value": 500}') as s \gset
select pg_temp.ok((:'s'::jsonb->>'discount_total')::numeric = 500 and (:'s'::jsonb->>'total')::numeric = 1680,
                  'a manager gives Rs 500 off the order within their own limit');
select pg_temp.ok((select sum(discount_amount) = 500 and bool_and(discount_amount > 0)
                     from public.order_lines where order_id = (:'s'::jsonb->>'order_id')::uuid)
                  and (select tax_amount from public.order_lines
                        where order_id = (:'s'::jsonb->>'order_id')::uuid and variant_id = :'book') = 0,
                  'an order discount is spread across lines; the exempt line still carries no tax');
select pg_temp.expect_error(format('select public.place_order(%L, %L, %L::jsonb, p_payments => %L::jsonb, p_order_discount => %L::jsonb)',
  :'main', 'pos', jsonb_build_array(pg_temp.line(:'widget', 1)), pg_temp.cash(2000), '{"type": "percent", "value": 60}'),
  'NC008', 'a manager cannot exceed their own 50% limit');
select pg_temp.expect_error(format('select public.place_order(%L, %L, %L::jsonb, p_payments => %L::jsonb, p_order_discount => %L::jsonb)',
  :'main', 'pos', jsonb_build_array(pg_temp.line(:'widget', 1)), pg_temp.cash(2000), '{"type": "amount", "value": 5000}'),
  'NC003', 'a discount cannot exceed what it applies to');

select pg_temp.act_as(null);
select pg_temp.expect_error(format('select public.start_checkout(%L, %L::jsonb, %L)', :'org',
  jsonb_build_array(pg_temp.line(:'widget', 1) || '{"discount": {"type": "percent", "value": 50}}'), 'money-web-9001'),
  'NC003', 'shoppers cannot give themselves a discount');

-- PIN lockout
select pg_temp.act_as(:'m_cashier');
select public.request_override(:'org', :'m_manager', '1111') from generate_series(1, 5);
select pg_temp.ok(public.request_override(:'org', :'m_manager', '4321')->>'reason' = 'locked',
                  'five wrong PINs lock the approver out, even for the right PIN');
select pg_temp.ok(public.request_override(:'org', :'m_cashier', '4321')->>'reason' = 'self_approval',
                  'nobody approves their own discount');

-- ---------------------------------------------------------------------------
-- 4. Store credit
-- ---------------------------------------------------------------------------
\echo '--- store credit'
select pg_temp.act_as(:'m_manager');
select pg_temp.ok(public.adjust_store_credit(:'cust', 1000, 'goodwill for late delivery') = 1000,
                  'a manager can grant store credit with a reason');

select pg_temp.act_as(:'m_cashier');
select pg_temp.expect_error(format('select public.adjust_store_credit(%L, 100, %L)', :'cust', 'please'),
  '42501', 'a cashier cannot grant store credit');
select pg_temp.expect_error(format('select public.place_order(%L, %L, %L::jsonb, %L, p_payments => %L::jsonb)',
  :'main', 'pos', jsonb_build_array(pg_temp.line(:'widget', 1)), :'cust', '[{"method": "store_credit", "amount": 1180}]'),
  'NC007', 'store credit cannot be overspent');
select public.place_order(:'main', 'pos', jsonb_build_array(pg_temp.line(:'widget', 1)), :'cust',
         p_payments => '[{"method": "store_credit", "amount": 1000}, {"method": "cash", "amount": 180}]') as s \gset
select pg_temp.ok(:'s'::jsonb->>'payment_status' = 'paid'
                  and (select store_credit_balance from public.customers where id = :'cust') = 0,
                  'credit 1000 + cash 180 settles 1180 and empties the balance');
select pg_temp.expect_error(format('select public.place_order(%L, %L, %L::jsonb, p_payments => %L::jsonb)',
  :'main', 'pos', jsonb_build_array(pg_temp.line(:'book', 1)), '[{"method": "store_credit", "amount": 1000}]'),
  'NC003', 'store credit needs a customer on the sale');

-- ---------------------------------------------------------------------------
-- 5. Pay later: phone order, cash on delivery
-- ---------------------------------------------------------------------------
\echo '--- pay later'
select pg_temp.act_as(:'m_manager');
select public.place_order(:'main', 'phone_order', jsonb_build_array(pg_temp.line(:'book', 3)), :'cust') as ph \gset
select pg_temp.ok(:'ph'::jsonb->>'status' = 'confirmed' and :'ph'::jsonb->>'payment_status' = 'unpaid'
                  and (:'ph'::jsonb->>'balance_due')::numeric = 3000,
                  'a phone order can go out unpaid, with the balance owed');
select pg_temp.ok(public.record_payment((:'ph'::jsonb->>'order_id')::uuid, 'cash_on_delivery', 1000)->>'payment_status' = 'partially_paid',
                  'part of the balance collected on delivery');
select pg_temp.expect_error(format('select public.record_payment(%L, %L, 5000)', :'ph'::jsonb->>'order_id', 'cash_on_delivery'),
  'NC003', 'collecting more than is owed is refused');
select pg_temp.ok(public.record_payment((:'ph'::jsonb->>'order_id')::uuid, 'cash_on_delivery', 2000)->>'payment_status' = 'paid',
                  'the rest is collected and the order is paid');

-- ---------------------------------------------------------------------------
-- 6. Online: gateway webhooks and bank transfers
-- ---------------------------------------------------------------------------
\echo '--- online payments'
select pg_temp.act_as(null);
select public.start_checkout(:'org', jsonb_build_array(pg_temp.line(:'widget', 2)), 'money-web-0001') as w \gset
select pg_temp.ok((:'w'::jsonb->>'total')::numeric = 2360 and (:'w'::jsonb->>'tax_total')::numeric = 360,
                  'online checkout is priced with tax');
select pg_temp.expect_error(format('select public.record_gateway_payment(%L, %L, %L, 2360)', :'w'::jsonb->>'order_id', 'payhere', 'PH-1'),
  '42501', 'only the webhook (service role) can record a gateway payment');

select pg_temp.act_as_service();
select public.record_gateway_payment((:'w'::jsonb->>'order_id')::uuid, 'payhere', 'PH-1', 2360) as r \gset
select pg_temp.ok(:'r'::jsonb->>'status' = 'confirmed' and :'r'::jsonb->>'payment_status' = 'paid',
                  'a captured gateway payment confirms the order');
select pg_temp.ok((public.record_gateway_payment((:'w'::jsonb->>'order_id')::uuid, 'payhere', 'PH-1', 2360)->>'replayed')::boolean
                  and (select count(*) from public.payments where order_id = (:'w'::jsonb->>'order_id')::uuid) = 1,
                  'the same webhook delivered twice is recorded once');

select pg_temp.act_as(null);
select public.start_checkout(:'org', jsonb_build_array(pg_temp.line(:'book', 1)), 'money-web-0002') as w2 \gset
select pg_temp.act_as_service();
select public.record_gateway_payment((:'w2'::jsonb->>'order_id')::uuid, 'payhere', 'PH-2', 1000, 'failed') as r \gset
select pg_temp.ok(:'r'::jsonb->>'status' = 'pending_payment' and :'r'::jsonb->>'payment_status' = 'unpaid',
                  'a failed payment is recorded and the order keeps waiting');

select pg_temp.act_as(:'m_manager');
select public.record_payment((:'w2'::jsonb->>'order_id')::uuid, 'bank_transfer', 1000, 'BOC-778812') as r \gset
select pg_temp.ok(:'r'::jsonb->>'status' = 'confirmed' and :'r'::jsonb->>'payment_status' = 'paid',
                  'a bank transfer seen by staff confirms the online order');

-- paid after the hold lapsed and the stock went elsewhere -> refund
select pg_temp.act_as(null);
select public.start_checkout(:'org', jsonb_build_array(pg_temp.line(:'gadget', 1)), 'money-web-0003') as w3 \gset
update public.orders set reservation_expires_at = now() - interval '1 minute' where id = (:'w3'::jsonb->>'order_id')::uuid;
update public.stock_reservations set expires_at = now() - interval '1 minute' where source_id = (:'w3'::jsonb->>'order_id')::uuid;
select pg_temp.act_as_service();
select public.expire_reservations();
select public.adjust_stock(:'main', :'gadget',
  (select on_hand - reserved from public.stock_levels where variant_id = :'gadget'), 'adjustment_out', 'recall - all units pulled');
select public.record_gateway_payment((:'w3'::jsonb->>'order_id')::uuid, 'payhere', 'PH-3', 2100) as r \gset
select pg_temp.ok(:'r'::jsonb->>'status' = 'stock_conflict' and :'r'::jsonb->>'payment_status' = 'paid',
                  'money that arrives after the stock is gone is kept against a conflicted order');
select public.refund_payment((:'w3'::jsonb->>'order_id')::uuid, 2100, 'online_gateway', 'out of stock after payment', 'PH-3-R') as r \gset
select pg_temp.ok(:'r'::jsonb->>'payment_status' = 'refunded'
                  and public.cancel_order((:'w3'::jsonb->>'order_id')::uuid, 'refunded')->>'status' = 'cancelled',
                  'the conflicted order is refunded in full, then cancelled');

-- ---------------------------------------------------------------------------
-- 7. Refunds
-- ---------------------------------------------------------------------------
\echo '--- refunds'
select pg_temp.act_as(:'m_manager');
select public.refund_payment((:'ph'::jsonb->>'order_id')::uuid, 500, 'store_credit', 'damaged cover') as r \gset
select pg_temp.ok(:'r'::jsonb->>'payment_status' = 'partially_refunded'
                  and (select store_credit_balance from public.customers where id = :'cust') = 500,
                  'a partial refund to store credit lands on the customer''s balance');
select pg_temp.ok((:'r'::jsonb->>'balance_due')::numeric = 0,
                  'a refund never puts the customer in debt (balance due stays 0)');
select pg_temp.expect_error(format('select public.refund_payment(%L, 5000, %L, %L)', :'ph'::jsonb->>'order_id', 'cash', 'too much'),
  'NC003', 'refunds cannot exceed what was paid');
select pg_temp.expect_error(format('select public.refund_payment(%L, 10, %L, %L)', :'ph'::jsonb->>'order_id', 'cash', ''),
  'NC003', 'a refund needs a reason');
select pg_temp.act_as(:'m_cashier');
select pg_temp.expect_error(format('select public.refund_payment(%L, 10, %L, %L)', :'ph'::jsonb->>'order_id', 'cash', 'asked nicely'),
  '42501', 'a cashier cannot refund');

-- ---------------------------------------------------------------------------
-- 8. Money records are locked down and always add up
-- ---------------------------------------------------------------------------
\echo '--- money integrity'
select pg_temp.expect_error(format(
  'insert into public.payments (organization_id, order_id, method, amount) values (%L, %L, %L, 1)',
  :'org', :'ph'::jsonb->>'order_id', 'cash'),
  '42501', 'staff cannot write payments directly', 'authenticated');
select pg_temp.expect_error(format('update public.customers set store_credit_balance = 99999 where id = %L', :'cust'),
  '42501', 'staff cannot edit a store credit balance directly', 'authenticated');
select pg_temp.expect_error(format(
  'insert into public.customers (organization_id, full_name, store_credit_balance) values (%L, %L, 50000)', :'org', 'Fake'),
  '42501', 'staff cannot create a customer with credit already on it', 'authenticated');
select pg_temp.expect_error(format('update public.customers set auth_user_id = %L where id = %L', :'m_cashier', :'cust'),
  '42501', 'staff cannot attach a login to a customer record', 'authenticated');
select pg_temp.ok(pg_temp.scalar_as('authenticated',
  format('update public.customers set notes = %L where id = %L returning notes', 'prefers SMS', :'cust')) = 'prefers SMS',
  'staff can still edit contact details');
select pg_temp.expect_error('select count(*) from public.staff_pins', '42501', 'PIN hashes are not readable', 'authenticated');

select pg_temp.act_as_service();
select pg_temp.expect_error('delete from public.payments', 'NC006', 'payments cannot be deleted');
select pg_temp.expect_error('delete from public.store_credit_ledger', 'NC006', 'the store credit ledger cannot be deleted');

select pg_temp.ok(not exists (
  select 1 from public.orders o
    join (select order_id, sum(line_total) lt, sum(discount_amount) d, sum(tax_amount) t
            from public.order_lines group by 1) l on l.order_id = o.id
   where o.organization_id = :'org' and (l.lt <> o.total or l.d <> o.discount_total or l.t <> o.tax_total)),
  'every order''s lines add up to its totals, discount and tax');
select pg_temp.ok(not exists (
  select 1 from public.customers c
   where c.organization_id = :'org'
     and c.store_credit_balance <> coalesce((select sum(amount) from public.store_credit_ledger l where l.customer_id = c.id), 0)),
  'store credit balances equal their ledgers');
select pg_temp.ok(not exists (
  select 1 from public.orders o
   where o.organization_id = :'org'
     and o.amount_paid <> coalesce((select sum(amount) from public.payments p
                                     where p.order_id = o.id and p.kind = 'payment' and p.status = 'captured'), 0)),
  'every order''s amount paid equals its captured payments');
select pg_temp.ok((select count(*) from public._inventory_integrity(:'org')) = 0,
                  'stock still agrees with the ledger after all of it');
