-- 0012_returns_warranty.sql
-- Phase 6: returns, exchanges, inspection, warranty.
--
-- Returns
--   * refunds are what the customer paid for that line (discount and tax
--     included, delivery excluded), pro rata, with rounding settled on the last unit
--   * returned goods go to INSPECTION, never straight back on sale; inspection
--     decides restock / damaged / service / write-off (restocking at the counter
--     needs inventory.adjust)
--   * serialised units must be the exact units sold on that line
--   * exchanges happen in one transaction: the return's value pays toward the new
--     sale as 'return_credit', which clients cannot use anywhere else
-- Warranty (module 'warranty')
--   * products carry warranty_months; each sold line keeps a snapshot
--   * one lookup by serial / IMEI, order number or phone, across every channel
--   * claims with a status history

set check_function_bodies = off;

alter type public.payment_method add value if not exists 'return_credit';

create type public.return_status as enum ('requested', 'received', 'cancelled');
create type public.return_disposition as enum ('pending_inspection', 'restock', 'damaged', 'service', 'write_off');
create type public.warranty_claim_status as enum (
  'open', 'received', 'in_repair', 'awaiting_parts', 'ready', 'replaced', 'refunded', 'rejected', 'closed');

-- ---------------------------------------------------------------------------
-- Warranty on products and sold lines
-- ---------------------------------------------------------------------------
alter table public.products
  add column warranty_months int check (warranty_months is null or warranty_months between 0 and 120),
  add column warranty_terms  text;

alter table public.order_lines add column warranty_months int;

-- Snapshot at sale time: changing a product's warranty later does not change what was sold.
create or replace function public.order_lines_snapshot_warranty() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.warranty_months is null then
    select p.warranty_months into new.warranty_months
      from public.product_variants v join public.products p on p.id = v.product_id
     where v.id = new.variant_id;
  end if;
  return new;
end $$;
create trigger order_lines_warranty before insert on public.order_lines
  for each row execute function public.order_lines_snapshot_warranty();

-- ---------------------------------------------------------------------------
-- Returns
-- ---------------------------------------------------------------------------
create table public.returns (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  number          text not null,
  order_id        uuid not null,
  status          public.return_status not null,
  channel         public.sales_channel not null,
  location_id     uuid,
  customer_id     uuid,
  shift_id        uuid,
  reason          text,
  refund_total    numeric(14,2) not null default 0 check (refund_total >= 0),
  idempotency_key text,
  requested_at    timestamptz not null default now(),
  received_at     timestamptz,
  received_by     uuid,
  created_by      uuid default auth.uid(),
  exchange_order_id uuid,
  unique (organization_id, number),
  unique (organization_id, id),
  foreign key (organization_id, order_id) references public.orders (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id),
  foreign key (organization_id, shift_id) references public.pos_shifts (organization_id, id),
  foreign key (organization_id, exchange_order_id) references public.orders (organization_id, id),
  check ((status = 'received') = (received_at is not null and location_id is not null))
);
create unique index returns_idempotency_uq on public.returns (organization_id, idempotency_key) where idempotency_key is not null;
create index returns_order_idx on public.returns (order_id);
create index returns_org_time_idx on public.returns (organization_id, requested_at desc);

create table public.return_lines (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  return_id       uuid not null,
  order_line_id   uuid not null,
  variant_id      uuid not null,
  quantity        numeric(14,3) not null check (quantity > 0),
  serial_unit_id  uuid,
  batch_id        uuid,
  line_refund     numeric(14,2) not null check (line_refund >= 0),
  unit_cost       numeric(14,4),
  reason          text,
  disposition     public.return_disposition not null default 'pending_inspection',
  inspected_by    uuid,
  inspected_at    timestamptz,
  inspection_note text,
  unique (organization_id, id),
  foreign key (organization_id, return_id) references public.returns (organization_id, id) on delete cascade,
  foreign key (organization_id, order_line_id) references public.order_lines (organization_id, id),
  foreign key (organization_id, variant_id) references public.product_variants (organization_id, id),
  foreign key (organization_id, serial_unit_id) references public.serial_units (organization_id, id),
  foreign key (organization_id, batch_id) references public.batches (organization_id, id),
  check (serial_unit_id is null or quantity = 1)
);
create index return_lines_return_idx on public.return_lines (return_id);
create index return_lines_order_line_idx on public.return_lines (order_line_id);
create index return_lines_pending_idx on public.return_lines (organization_id) where disposition in ('pending_inspection', 'service');

-- ---------------------------------------------------------------------------
-- Warranty claims
-- ---------------------------------------------------------------------------
create table public.warranty_claims (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  number          text not null,
  order_line_id   uuid not null,
  serial_unit_id  uuid,
  customer_id     uuid,
  status          public.warranty_claim_status not null default 'open',
  issue           text not null check (length(btrim(issue)) >= 3),
  within_warranty boolean not null,
  expires_on      date,
  resolution      text,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, number),
  unique (organization_id, id),
  foreign key (organization_id, order_line_id) references public.order_lines (organization_id, id),
  foreign key (organization_id, serial_unit_id) references public.serial_units (organization_id, id),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id)
);
create index warranty_claims_org_idx on public.warranty_claims (organization_id, created_at desc);
create index warranty_claims_line_idx on public.warranty_claims (order_line_id);

create table public.warranty_claim_events (
  id              bigint generated always as identity primary key,
  organization_id uuid not null,
  claim_id        uuid not null,
  status          public.warranty_claim_status not null,
  note            text,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  foreign key (organization_id, claim_id) references public.warranty_claims (organization_id, id) on delete cascade
);
create trigger warranty_claim_events_append_only before update or delete on public.warranty_claim_events
  for each row execute function public.prevent_mutation();
create trigger warranty_claims_touch before update on public.warranty_claims
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Return helpers
-- ---------------------------------------------------------------------------
-- Quantity of an order line already returned or asked to be returned.
create or replace function public._returned_quantity(p_order_line uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(rl.quantity), 0)
    from public.return_lines rl join public.returns r on r.id = rl.return_id
   where rl.order_line_id = p_order_line and r.status <> 'cancelled'
$$;

create or replace function public._returned_value(p_order_line uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(rl.line_refund), 0)
    from public.return_lines rl join public.returns r on r.id = rl.return_id
   where rl.order_line_id = p_order_line and r.status <> 'cancelled'
$$;

-- Adds lines to a return and returns their refund value.
-- p_lines = [{order_line_id, quantity, serials?: [...], reason?, disposition?: 'restock'}]
create or replace function public._add_return_lines(p_return uuid, p_lines jsonb, p_allow_restock boolean) returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r        public.returns%rowtype;
  ol       public.order_lines%rowtype;
  e        jsonb;
  v_qty    numeric;
  v_left   numeric;
  v_value  numeric;
  v_total  numeric := 0;
  v_mode   public.tracking_mode;
  v_frac   boolean;
  v_disp   public.return_disposition;
  v_batch  uuid;
  v_cost   numeric;
  v_serial text;
  v_unit   uuid;
  v_i      int;
begin
  select * into r from public.returns where id = p_return;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'choose at least one item to return';
  end if;

  for e in select x from jsonb_array_elements(p_lines) x order by x->>'order_line_id' loop
    select * into ol from public.order_lines
     where id = (e->>'order_line_id')::uuid and order_id = r.order_id for update;
    if not found then
      raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'that item is not on this order';
    end if;
    select p.tracking_mode, p.allow_fractional into v_mode, v_frac
      from public.product_variants v join public.products p on p.id = v.product_id where v.id = ol.variant_id;
    if exists (select 1 from public.product_variants v join public.products p on p.id = v.product_id
                where v.id = ol.variant_id and p.is_gift_card) then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'gift cards cannot be returned';
    end if;

    v_qty := (e->>'quantity')::numeric;
    v_left := ol.quantity - public._returned_quantity(ol.id);
    if v_qty is null or v_qty <= 0 or v_qty > v_left then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
        detail = format('%s: %s can still be returned', ol.product_name, v_left);
    end if;
    if not v_frac and v_qty <> trunc(v_qty) then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = format('%s is returned in whole units', ol.product_name);
    end if;

    v_disp := case when e->>'disposition' = 'restock' then 'restock' else 'pending_inspection' end;
    if v_disp = 'restock' and not p_allow_restock then
      raise exception using errcode = '42501', message = 'PERMISSION_DENIED',
        detail = 'returned goods go to inspection; only stock staff can put them straight back on sale';
    end if;

    -- The refund for these units: pro rata of what the line cost the customer;
    -- the last units returned take whatever rounding is left.
    v_value := case when v_qty = v_left then ol.line_total - public._returned_value(ol.id)
                    else round(ol.line_total * v_qty / ol.quantity, 2) end;

    -- What the goods cost when they were sold (for a correct restock valuation).
    select case when sum(-m.quantity) > 0 then sum(-m.quantity * m.unit_cost) / sum(-m.quantity) end,
           (array_agg(m.batch_id order by m.quantity))[1]
      into v_cost, v_batch
      from public.inventory_movements m
     where m.source_type = 'order' and m.source_id = r.order_id and m.variant_id = ol.variant_id and m.movement_type = 'sale';

    if v_mode = 'serial' then
      if coalesce(jsonb_array_length(e->'serials'), 0) <> v_qty then
        raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
          detail = format('%s: give the serial number of each unit coming back', ol.product_name);
      end if;
      v_i := 0;
      for v_serial in select btrim(x) from jsonb_array_elements_text(e->'serials') x loop
        v_i := v_i + 1;
        select su.id into v_unit
          from public.order_line_units u join public.serial_units su on su.id = u.serial_unit_id
         where u.order_line_id = ol.id and upper(su.serial) = upper(v_serial)
           and not exists (select 1 from public.return_lines x join public.returns rr on rr.id = x.return_id
                            where x.serial_unit_id = su.id and rr.status <> 'cancelled');
        if v_unit is null then
          raise exception using errcode = 'NC004', message = 'SERIAL_UNAVAILABLE',
            detail = format('%s was not sold on this order, or has already been returned', v_serial);
        end if;
        insert into public.return_lines
          (organization_id, return_id, order_line_id, variant_id, quantity, serial_unit_id, line_refund, unit_cost, reason, disposition)
        values
          (r.organization_id, r.id, ol.id, ol.variant_id, 1, v_unit,
           case when v_i = v_qty then v_value - round(v_value / v_qty, 2) * (v_qty - 1) else round(v_value / v_qty, 2) end,
           (select su.unit_cost from public.serial_units su where su.id = v_unit), nullif(btrim(e->>'reason'), ''), v_disp);
      end loop;
    else
      insert into public.return_lines
        (organization_id, return_id, order_line_id, variant_id, quantity, batch_id, line_refund, unit_cost, reason, disposition)
      values
        (r.organization_id, r.id, ol.id, ol.variant_id, v_qty, case when v_mode = 'batch' then v_batch end, v_value, v_cost,
         nullif(btrim(e->>'reason'), ''), v_disp);
    end if;
    v_total := v_total + v_value;
  end loop;

  update public.returns set refund_total = refund_total + v_total where id = r.id;
  return v_total;
end $$;

-- Puts one inspected return line back on sale at the return's location.
create or replace function public._restock_return_line(p_line uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  l public.return_lines%rowtype;
  r public.returns%rowtype;
begin
  select * into l from public.return_lines where id = p_line;
  select * into r from public.returns where id = l.return_id;
  if public._tracking_mode(l.variant_id) = 'non_stock' then
    return;  -- a service or fee: nothing goes back on the shelf
  end if;
  if l.serial_unit_id is not null then
    update public.serial_units set status = 'available', location_id = r.location_id where id = l.serial_unit_id;
  end if;
  insert into public.inventory_movements
    (organization_id, location_id, variant_id, batch_id, serial_unit_id, movement_type, quantity, unit_cost, source_type, source_id, note)
  values
    (l.organization_id, r.location_id, l.variant_id, l.batch_id, l.serial_unit_id, 'sale_return', l.quantity, l.unit_cost,
     'return', r.id, 'returned by customer, ' || r.number);
end $$;

-- Goods physically arrive: serial units come back into the building (inspection),
-- lines marked restock go straight back on sale.
create or replace function public._receive_return_goods(p_return uuid, p_location uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  l record;
begin
  update public.returns set status = 'received', location_id = p_location, received_at = now(), received_by = auth.uid()
   where id = p_return;
  for l in select * from public.return_lines where return_id = p_return order by variant_id, id loop
    if l.serial_unit_id is not null then
      update public.serial_units set status = 'inspection', location_id = p_location where id = l.serial_unit_id;
    end if;
    if l.disposition = 'restock' then
      perform public._restock_return_line(l.id);
      update public.return_lines set inspected_by = auth.uid(), inspected_at = now(),
             inspection_note = coalesce(inspection_note, 'restocked on return') where id = l.id;
    end if;
  end loop;
end $$;

-- Money back for a received return. p_refunds = [{method, amount, reference?}].
-- The refunds must add up to the return's value (or what is left of what was
-- actually paid, if less). 'return_credit' is only accepted from an exchange.
create or replace function public._refund_return(p_return uuid, p_refunds jsonb, p_shift uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r        public.returns%rowtype;
  o        public.orders%rowtype;
  v_due    numeric;
  v_sum    numeric;
  e        jsonb;
  v_method public.payment_method;
  v_amount numeric;
begin
  select * into r from public.returns where id = p_return;
  select * into o from public.orders where id = r.order_id for update;
  v_due := least(r.refund_total, o.amount_paid - o.amount_refunded);
  p_refunds := coalesce(p_refunds, '[]'::jsonb);
  -- A single refund without an amount takes exactly what is due, so screens
  -- never have to reproduce the rounding rules.
  if jsonb_typeof(p_refunds) = 'array' and jsonb_array_length(p_refunds) = 1 and not (p_refunds->0 ? 'amount') then
    p_refunds := jsonb_build_array(p_refunds->0 || jsonb_build_object('amount', v_due));
  end if;
  select coalesce(sum((x->>'amount')::numeric), 0) into v_sum from jsonb_array_elements(p_refunds) x;
  if round(v_sum, 2) <> round(v_due, 2) then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
      detail = json_build_object('refund_due', v_due, 'refunds_given', v_sum)::text;
  end if;

  for e in select x from jsonb_array_elements(p_refunds) x loop
    v_method := (e->>'method')::public.payment_method;
    v_amount := (e->>'amount')::numeric;
    continue when v_amount = 0;
    if v_amount < 0 then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'refund amounts are positive';
    end if;
    if v_method = 'return_credit' and coalesce(current_setting('nwsc.exchange_return', true), '') <> r.id::text then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'return credit is only used by an exchange';
    end if;
    if v_method = 'store_credit' then
      if o.customer_id is null then
        raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'store credit needs a customer on the order';
      end if;
      insert into public.store_credit_ledger (organization_id, customer_id, amount, reason, source_type, source_id)
      values (o.organization_id, o.customer_id, v_amount, 'Return ' || r.number || ' on order ' || o.number, 'return', r.id);
    end if;
    insert into public.payments (organization_id, order_id, kind, method, amount, provider_reference, note, shift_id, captured_at)
    values (o.organization_id, o.id, 'refund', v_method, v_amount, coalesce(nullif(e->>'reference', ''), r.number),
            'Return ' || r.number, p_shift, now());
  end loop;
  perform public._refresh_payment_status(o.id);
  perform public._return_loyalty(r.id);  -- 0014
end $$;

create or replace function public._return_summary(p_return uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'return_id', r.id, 'number', r.number, 'status', r.status, 'channel', r.channel,
    'order_id', r.order_id, 'order_number', o.number, 'location_id', r.location_id,
    'customer_id', r.customer_id, 'reason', r.reason, 'refund_total', r.refund_total,
    'requested_at', r.requested_at, 'received_at', r.received_at, 'exchange_order_id', r.exchange_order_id,
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
                'return_line_id', rl.id, 'order_line_id', rl.order_line_id, 'name', ol.product_name, 'variant', ol.variant_title,
                'quantity', rl.quantity, 'serial', su.serial, 'line_refund', rl.line_refund, 'reason', rl.reason,
                'disposition', rl.disposition, 'inspected_at', rl.inspected_at, 'inspection_note', rl.inspection_note)
              order by ol.position, su.serial)
              from public.return_lines rl
              join public.order_lines ol on ol.id = rl.order_line_id
              left join public.serial_units su on su.id = rl.serial_unit_id
             where rl.return_id = r.id), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(jsonb_build_object('method', p.method, 'amount', p.amount, 'at', p.created_at) order by p.created_at)
                           from public.payments p where p.order_id = r.order_id and p.kind = 'refund' and p.note = 'Return ' || r.number), '[]'::jsonb))
  from public.returns r join public.orders o on o.id = r.order_id
  where r.id = p_return
$$;

create or replace function public._new_return(
  p_order public.orders, p_status public.return_status, p_channel public.sales_channel,
  p_reason text, p_idempotency_key text, p_shift uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if p_order.status not in ('confirmed', 'completed') then
    raise exception using errcode = 'NC006', message = 'INVALID_STATE', detail = 'only confirmed orders can be returned';
  end if;
  insert into public.returns (organization_id, number, order_id, status, channel, customer_id, reason, idempotency_key, shift_id)
  values (p_order.organization_id, public.next_document_number(p_order.organization_id, 'return', 'RET-'), p_order.id,
          p_status, p_channel, p_order.customer_id, nullif(btrim(p_reason), ''), p_idempotency_key, p_shift)
  returning id into v_id;
  return v_id;
end $$;

-- Within settings.return_days of the sale (no setting = no limit)?
create or replace function public._within_return_window(p_order public.orders) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select (o.settings->>'return_days') is null
      or coalesce(p_order.confirmed_at, p_order.placed_at) >= now() - make_interval(days => (o.settings->>'return_days')::int)
    from public.organizations o where o.id = p_order.organization_id
$$;

-- ---------------------------------------------------------------------------
-- Return commands
-- ---------------------------------------------------------------------------
-- Staff take a return (admin: any channel's order, any time).
create or replace function public.create_return(
  p_order_id uuid, p_location_id uuid, p_lines jsonb, p_refunds jsonb,
  p_reason text default null, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o    public.orders%rowtype;
  v_id uuid;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'order';
  end if;
  perform public.assert_module(o.organization_id, 'returns');
  perform public.assert_permission(o.organization_id, 'orders.manage');
  perform public.assert_location_access(o.organization_id, p_location_id);
  if not exists (select 1 from public.locations where id = p_location_id and organization_id = o.organization_id and is_active) then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'location';
  end if;
  if p_idempotency_key is not null then
    select id into v_id from public.returns where organization_id = o.organization_id and idempotency_key = p_idempotency_key;
    if found then return public._return_summary(v_id) || '{"replayed": true}'::jsonb; end if;
  end if;

  v_id := public._new_return(o, 'requested', 'admin_order', p_reason, p_idempotency_key, null);
  perform public._add_return_lines(v_id, p_lines, public.has_permission(o.organization_id, 'inventory.adjust'));
  perform public._receive_return_goods(v_id, p_location_id);
  perform public._refund_return(v_id, p_refunds, null);
  return public._return_summary(v_id);
end $$;

-- A return at the till, on the cashier's open shift; cash refunds leave this drawer.
create or replace function public.pos_return(
  p_shift_id uuid, p_order_id uuid, p_lines jsonb, p_refunds jsonb,
  p_idempotency_key text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s    public.pos_shifts%rowtype;
  o    public.orders%rowtype;
  v_id uuid;
begin
  s := public._my_open_shift(p_shift_id);
  select * into o from public.orders where id = p_order_id and organization_id = s.organization_id for update;
  if not found then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'order';
  end if;
  perform public.assert_module(o.organization_id, 'returns');
  if not public._within_return_window(o) and not public.has_permission(o.organization_id, 'orders.manage') then
    raise exception using errcode = 'NC006', message = 'INVALID_STATE', detail = 'this sale is outside the return period - a manager must take the return';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'an idempotency key is required';
  end if;
  select id into v_id from public.returns where organization_id = o.organization_id and idempotency_key = p_idempotency_key;
  if found then return public._return_summary(v_id) || '{"replayed": true}'::jsonb; end if;

  v_id := public._new_return(o, 'requested', 'pos', p_reason, p_idempotency_key, s.id);
  perform public._add_return_lines(v_id, p_lines, public.has_permission(o.organization_id, 'inventory.adjust'));
  perform public._receive_return_goods(v_id, s.location_id);
  perform public._refund_return(v_id, p_refunds, s.id);
  return public._return_summary(v_id);
end $$;

-- Return and buy again in one go. The return's value pays toward the new sale;
-- any value left over is refunded (p_leftover_method, default cash from the drawer).
create or replace function public.pos_exchange(
  p_shift_id        uuid,
  p_order_id        uuid,
  p_return_lines    jsonb,
  p_new_lines       jsonb,
  p_payments        jsonb,
  p_idempotency_key text,
  p_leftover_method public.payment_method default 'cash',
  p_customer_id     uuid default null,
  p_reason          text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s        public.pos_shifts%rowtype;
  o        public.orders%rowtype;
  v_ret    uuid;
  v_value  numeric;
  v_quote  jsonb;
  v_total  numeric;
  v_credit numeric;
  v_sale   jsonb;
begin
  s := public._my_open_shift(p_shift_id);
  select * into o from public.orders where id = p_order_id and organization_id = s.organization_id for update;
  if not found then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'order';
  end if;
  perform public.assert_module(o.organization_id, 'returns');
  if not public._within_return_window(o) and not public.has_permission(o.organization_id, 'orders.manage') then
    raise exception using errcode = 'NC006', message = 'INVALID_STATE', detail = 'this sale is outside the return period - a manager must take the return';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'an idempotency key is required';
  end if;
  if p_leftover_method not in ('cash', 'card', 'bank_transfer', 'store_credit') then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'left-over value goes back as cash, card, transfer or store credit';
  end if;
  select id into v_ret from public.returns where organization_id = o.organization_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('return', public._return_summary(v_ret), 'replayed', true,
      'sale', (select public._order_summary(exchange_order_id) from public.returns where id = v_ret));
  end if;

  -- 1. the return (goods back into inspection or stock)
  v_ret := public._new_return(o, 'requested', 'pos', coalesce(p_reason, 'exchange'), p_idempotency_key, s.id);
  v_value := public._add_return_lines(v_ret, p_return_lines, public.has_permission(o.organization_id, 'inventory.adjust'));
  perform public._receive_return_goods(v_ret, s.location_id);

  -- 2. how much of it the new sale can use
  v_quote := public.pos_quote(s.id, p_new_lines, null);
  v_total := (v_quote->>'total')::numeric;
  v_credit := least(least(v_value, o.amount_paid - o.amount_refunded), v_total);

  -- 3. refund the returned value: as credit toward the new sale, the rest as chosen
  perform set_config('nwsc.exchange_return', v_ret::text, true);
  perform public._refund_return(v_ret, jsonb_build_array(
    jsonb_build_object('method', 'return_credit', 'amount', v_credit),
    jsonb_build_object('method', p_leftover_method, 'amount', least(v_value, o.amount_paid - o.amount_refunded) - v_credit)), s.id);

  -- 4. the new sale, paid first by the return credit
  perform set_config('nwsc.return_credit', v_credit::text, true);
  v_sale := public.pos_sale(s.id, p_new_lines,
              case when v_credit > 0 then jsonb_build_array(jsonb_build_object('method', 'return_credit', 'amount', v_credit, 'reference', (select number from public.returns where id = v_ret)))
                   else '[]'::jsonb end || coalesce(p_payments, '[]'::jsonb),
              p_idempotency_key || '-sale', coalesce(p_customer_id, o.customer_id), null, null,
              'Exchange for ' || (select number from public.returns where id = v_ret));
  perform set_config('nwsc.return_credit', '', true);
  perform set_config('nwsc.exchange_return', '', true);

  update public.returns set exchange_order_id = (v_sale->>'order_id')::uuid where id = v_ret;
  return jsonb_build_object('return', public._return_summary(v_ret), 'sale', v_sale,
                            'credit_used', v_credit, 'leftover_refunded', least(v_value, o.amount_paid - o.amount_refunded) - v_credit,
                            'leftover_method', p_leftover_method);
end $$;

-- A customer asks to return part of an online order (their order page token, or signed in).
create or replace function public.request_return(p_order_id uuid, p_token text, p_lines jsonb, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o    public.orders%rowtype;
  v_id uuid;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found or not (o.access_token = coalesce(p_token, '') or public.owns_order(o.id)) then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'order';
  end if;
  perform public.assert_module(o.organization_id, 'returns');
  if o.channel not in ('online', 'mobile_app') then
    raise exception using errcode = 'NC006', message = 'INVALID_STATE', detail = 'bring in-store purchases back to the shop';
  end if;
  if not public._within_return_window(o) then
    raise exception using errcode = 'NC006', message = 'INVALID_STATE', detail = 'this order is outside the return period';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'tell us why you are returning it';
  end if;
  -- Customers cannot choose serial numbers or restock; staff confirm on receipt.
  if exists (select 1 from jsonb_array_elements(p_lines) e where e ? 'serials' or e ? 'disposition') then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'choose items and quantities only';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) e
               join public.order_lines ol on ol.id = (e->>'order_line_id')::uuid
               join public.product_variants v on v.id = ol.variant_id join public.products p on p.id = v.product_id
              where p.tracking_mode = 'serial') then
    -- Which unit comes back has to be checked by staff against the serial sold.
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'items with serial numbers are returned in store or by calling us';
  end if;

  v_id := public._new_return(o, 'requested', o.channel, p_reason, null, null);
  perform public._add_return_lines(v_id, p_lines, false);
  return public._return_summary(v_id);
end $$;

-- Staff receive a requested return and refund it.
create or replace function public.receive_return(p_return_id uuid, p_location_id uuid, p_refunds jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.returns%rowtype;
begin
  select * into r from public.returns where id = p_return_id for update;
  if not found then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'return';
  end if;
  perform public.assert_permission(r.organization_id, 'orders.manage');
  perform public.assert_location_access(r.organization_id, p_location_id);
  if r.status <> 'requested' then
    raise exception using errcode = 'NC006', message = 'INVALID_STATE', detail = format('this return is %s', r.status);
  end if;
  perform public._receive_return_goods(r.id, p_location_id);
  perform public._refund_return(r.id, p_refunds, null);
  return public._return_summary(r.id);
end $$;

create or replace function public.cancel_return(p_return_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.returns%rowtype;
begin
  select * into r from public.returns where id = p_return_id for update;
  if not found then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'return';
  end if;
  perform public.assert_permission(r.organization_id, 'orders.manage');
  if r.status <> 'requested' then
    raise exception using errcode = 'NC006', message = 'INVALID_STATE', detail = 'only a requested return can be cancelled';
  end if;
  update public.returns set status = 'cancelled', reason = concat_ws(E'\n', reason, 'Cancelled: ' || p_reason) where id = r.id;
  return public._return_summary(r.id);
end $$;

-- Inspection decides what happens to returned goods.
create or replace function public.inspect_return_line(p_return_line_id uuid, p_disposition public.return_disposition, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  l public.return_lines%rowtype;
  r public.returns%rowtype;
begin
  select * into l from public.return_lines where id = p_return_line_id for update;
  if not found then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'return line';
  end if;
  select * into r from public.returns where id = l.return_id;
  perform public.assert_permission(l.organization_id, 'inventory.adjust');
  perform public.assert_location_access(l.organization_id, r.location_id);
  if r.status <> 'received' then
    raise exception using errcode = 'NC006', message = 'INVALID_STATE', detail = 'the goods have not been received yet';
  end if;
  if l.disposition not in ('pending_inspection', 'service') then
    raise exception using errcode = 'NC006', message = 'INVALID_STATE', detail = format('already decided: %s', l.disposition);
  end if;
  if p_disposition = 'pending_inspection' then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'choose restock, damaged, service or write-off';
  end if;
  if p_disposition in ('damaged', 'write_off') and coalesce(btrim(p_note), '') = '' then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'say what is wrong with it';
  end if;

  if p_disposition = 'restock' then
    perform public._restock_return_line(l.id);
  elsif l.serial_unit_id is not null then
    update public.serial_units
       set status = case p_disposition when 'damaged' then 'damaged' when 'write_off' then 'written_off' else 'inspection' end::public.serial_status
     where id = l.serial_unit_id;
  end if;
  update public.return_lines
     set disposition = p_disposition, inspected_by = auth.uid(), inspected_at = now(), inspection_note = nullif(btrim(p_note), '')
   where id = l.id;
  return public._return_summary(r.id);
end $$;

-- ---------------------------------------------------------------------------
-- 'return_credit' as a tender: only inside an exchange, never more than the credit.
-- Replaces _take_payments to recognise it (everything else unchanged).
-- ---------------------------------------------------------------------------
create or replace function public._take_payments(
  p_org          uuid,
  p_order        uuid,
  p_payments     jsonb,
  p_require_full boolean) returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o             public.orders%rowtype;
  v_due         numeric;
  v_noncash     numeric;
  v_cash_given  numeric;
  v_cash_taken  numeric;
  v_credit_cap  numeric := nullif(current_setting('nwsc.return_credit', true), '')::numeric;
  v_card        uuid;
  v_points      int;
  e             jsonb;
begin
  select * into o from public.orders where id = p_order;
  v_due := o.total - o.amount_paid;

  if p_payments is null or p_payments = 'null'::jsonb then
    p_payments := '[]'::jsonb;
  end if;
  if jsonb_typeof(p_payments) <> 'array' or exists (
       select 1 from jsonb_array_elements(p_payments) x
        where jsonb_typeof(x) <> 'object'
           or coalesce(x->>'method', '') not in ('cash', 'card', 'bank_transfer', 'qr', 'store_credit', 'return_credit',
                                                 'gift_card', 'loyalty_points')
           or coalesce((x->>'amount')::numeric, 0) <= 0) then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
      detail = 'payments are [{method: cash|card|bank_transfer|qr|store_credit|gift_card|loyalty_points, amount > 0}]';
  end if;
  if (select coalesce(sum((x->>'amount')::numeric), 0) from jsonb_array_elements(p_payments) x where x->>'method' = 'return_credit')
     > coalesce(v_credit_cap, 0) then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'return credit is only used by an exchange';
  end if;

  select coalesce(sum((x->>'amount')::numeric) filter (where x->>'method' <> 'cash'), 0),
         coalesce(sum((x->>'amount')::numeric) filter (where x->>'method' = 'cash'), 0)
    into v_noncash, v_cash_given
    from jsonb_array_elements(p_payments) x;

  if v_noncash > v_due then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
      detail = 'card, transfer, QR and store credit cannot exceed the amount due';
  end if;
  v_cash_taken := least(v_cash_given, v_due - v_noncash);

  if p_require_full and v_noncash + v_cash_taken < v_due then
    raise exception using errcode = 'NC007', message = 'PAYMENT_INCOMPLETE',
      detail = json_build_object('due', v_due, 'tendered', v_noncash + v_cash_given)::text;
  end if;

  for e in select x from jsonb_array_elements(p_payments) x where x->>'method' <> 'cash' loop
    if e->>'method' = 'store_credit' then
      if o.customer_id is null then
        raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
          detail = 'store credit needs a customer on the order';
      end if;
      insert into public.store_credit_ledger (organization_id, customer_id, amount, reason, source_type, source_id)
      values (p_org, o.customer_id, -(e->>'amount')::numeric, 'Spent on order ' || o.number, 'order', o.id);
    elsif e->>'method' = 'gift_card' then
      perform public.assert_module(p_org, 'loyalty');
      v_card := (select g.id from public.gift_cards g where g.organization_id = p_org and g.code = upper(btrim(coalesce(e->>'code', ''))));
      if v_card is null then
        raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'no gift card has that code';
      end if;
      insert into public.gift_card_ledger (organization_id, gift_card_id, amount, reason, order_id)
      values (p_org, v_card, -(e->>'amount')::numeric, 'Spent on ' || o.number, o.id);
      e := e || jsonb_build_object('reference', 'card ...' || right(upper(btrim(e->>'code')), 4));
    elsif e->>'method' = 'loyalty_points' then
      perform public.assert_module(p_org, 'loyalty');
      if o.customer_id is null then
        raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'points need a customer on the order';
      end if;
      v_points := ceil((e->>'amount')::numeric / nullif(public._loyalty_setting(p_org, 'loyalty_point_value', 1), 0));
      if v_points < public._loyalty_setting(p_org, 'loyalty_min_redeem', 0) then
        raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
          detail = format('at least %s points must be used at once', public._loyalty_setting(p_org, 'loyalty_min_redeem', 0));
      end if;
      insert into public.loyalty_ledger (organization_id, customer_id, points, reason, source_type, source_id)
      values (p_org, o.customer_id, -v_points, 'Spent on ' || o.number, 'order_spent', o.id);
      e := e || jsonb_build_object('reference', v_points || ' points');
    end if;
    insert into public.payments (organization_id, order_id, method, amount, provider_reference, captured_at)
    values (p_org, o.id, (e->>'method')::public.payment_method, (e->>'amount')::numeric,
            nullif(e->>'reference', ''), now());
  end loop;

  if v_cash_taken > 0 then
    insert into public.payments (organization_id, order_id, method, amount, tendered, change_given, captured_at)
    values (p_org, o.id, 'cash', v_cash_taken, v_cash_given, v_cash_given - v_cash_taken, now());
  end if;

  perform public._refresh_payment_status(o.id);
  return v_cash_given - v_cash_taken;
end $$;

-- ---------------------------------------------------------------------------
-- Warranty
-- ---------------------------------------------------------------------------
-- Finds purchases by serial / IMEI, order number or customer phone, in every
-- channel, with warranty dates, returns and claims.
create or replace function public.warranty_lookup(p_organization_id uuid, p_query text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
begin
  perform public.assert_module(p_organization_id, 'warranty');
  if not (public.has_permission(p_organization_id, 'orders.view') or public.has_permission(p_organization_id, 'pos.sell')) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED', detail = 'orders.view';
  end if;
  if length(v_q) < 3 then
    return '[]'::jsonb;
  end if;

  return coalesce((
    with hits as (
      select ol.id as line_id, su.id as unit_id
        from public.serial_units su
        join public.order_line_units u on u.serial_unit_id = su.id
        join public.order_lines ol on ol.id = u.order_line_id
       where su.organization_id = p_organization_id and upper(su.serial) = upper(v_q)
      union
      select ol.id, null from public.orders o join public.order_lines ol on ol.order_id = o.id
       where o.organization_id = p_organization_id and upper(o.number) = upper(v_q)
      union
      select ol.id, null from public.customers c
        join public.orders o on o.customer_id = c.id
        join public.order_lines ol on ol.order_id = o.id
       where c.organization_id = p_organization_id and c.phone is not null
         and c.phone = case when v_q ~ '^\+' then v_q
                            when v_q ~ '^0\d{9}$' then '+94' || substr(v_q, 2) else v_q end
      union
      select ol.id, null from public.orders o join public.order_lines ol on ol.order_id = o.id
       where o.organization_id = p_organization_id and o.contact->>'phone' is not null
         and o.contact->>'phone' = case when v_q ~ '^\+' then v_q when v_q ~ '^0\d{9}$' then '+94' || substr(v_q, 2) else v_q end)
    select jsonb_agg(x order by x->>'purchased_at' desc) from (
      select jsonb_build_object(
        'order_line_id', ol.id, 'order_id', o.id, 'order_number', o.number, 'channel', o.channel,
        'status', o.status, 'location', l.name,
        'purchased_at', coalesce(o.confirmed_at, o.placed_at),
        'customer', coalesce(
           (select jsonb_build_object('id', c.id, 'name', c.full_name, 'phone', c.phone) from public.customers c where c.id = o.customer_id),
           case when o.contact <> '{}'::jsonb then jsonb_build_object('name', o.contact->>'full_name', 'phone', o.contact->>'phone') end),
        'product', ol.product_name, 'variant', ol.variant_title, 'quantity', ol.quantity,
        'serials', (select jsonb_agg(su.serial order by su.serial) from public.order_line_units u
                      join public.serial_units su on su.id = u.serial_unit_id where u.order_line_id = ol.id),
        'matched_serial', (select su.serial from public.serial_units su where su.id = h.unit_id),
        'warranty_months', ol.warranty_months,
        'warranty_expires_on', case when ol.warranty_months > 0
                                    then (coalesce(o.confirmed_at, o.placed_at) + make_interval(months => ol.warranty_months))::date end,
        'warranty_status', case when coalesce(ol.warranty_months, 0) = 0 then 'none'
                                when coalesce(o.confirmed_at, o.placed_at) + make_interval(months => ol.warranty_months) >= now() then 'active'
                                else 'expired' end,
        'returned_quantity', public._returned_quantity(ol.id),
        'claims', coalesce((select jsonb_agg(jsonb_build_object('id', wc.id, 'number', wc.number, 'status', wc.status, 'created_at', wc.created_at) order by wc.created_at)
                              from public.warranty_claims wc where wc.order_line_id = ol.id), '[]'::jsonb)) x
        from (select distinct on (line_id) line_id, unit_id from hits order by line_id, unit_id nulls last) h
        join public.order_lines ol on ol.id = h.line_id
        join public.orders o on o.id = ol.order_id
        join public.locations l on l.id = o.location_id
       where o.status in ('confirmed', 'completed')
       limit 100) s), '[]'::jsonb);
end $$;

create or replace function public.open_warranty_claim(
  p_organization_id uuid, p_order_line_id uuid, p_issue text, p_serial text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ol      public.order_lines%rowtype;
  o       public.orders%rowtype;
  v_unit  uuid;
  v_exp   date;
  v_id    uuid;
begin
  perform public.assert_module(p_organization_id, 'warranty');
  if not (public.has_permission(p_organization_id, 'orders.manage') or public.has_permission(p_organization_id, 'pos.sell')) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED', detail = 'orders.manage';
  end if;
  select * into ol from public.order_lines where id = p_order_line_id and organization_id = p_organization_id;
  if not found then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'purchase';
  end if;
  select * into o from public.orders where id = ol.order_id;
  if o.status not in ('confirmed', 'completed') then
    raise exception using errcode = 'NC006', message = 'INVALID_STATE', detail = 'that order was not completed';
  end if;
  if p_serial is not null then
    select su.id into v_unit from public.order_line_units u join public.serial_units su on su.id = u.serial_unit_id
     where u.order_line_id = ol.id and upper(su.serial) = upper(btrim(p_serial));
    if v_unit is null then
      raise exception using errcode = 'NC004', message = 'SERIAL_UNAVAILABLE', detail = 'that serial number was not sold on this purchase';
    end if;
  elsif exists (select 1 from public.order_line_units where order_line_id = ol.id) then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'give the serial number of the unit being claimed';
  end if;
  if p_issue is null or length(btrim(p_issue)) < 3 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'describe the fault';
  end if;

  v_exp := case when ol.warranty_months > 0 then (coalesce(o.confirmed_at, o.placed_at) + make_interval(months => ol.warranty_months))::date end;
  insert into public.warranty_claims (organization_id, number, order_line_id, serial_unit_id, customer_id, issue, within_warranty, expires_on)
  values (p_organization_id, public.next_document_number(p_organization_id, 'warranty_claim', 'WC-'), ol.id, v_unit, o.customer_id,
          btrim(p_issue), v_exp is not null and v_exp >= current_date, v_exp)
  returning id into v_id;
  insert into public.warranty_claim_events (organization_id, claim_id, status, note)
  values (p_organization_id, v_id, 'open', btrim(p_issue));
  return public.warranty_claim(v_id);
end $$;

create or replace function public.update_warranty_claim(
  p_claim_id uuid, p_status public.warranty_claim_status, p_note text default null, p_resolution text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.warranty_claims%rowtype;
begin
  select * into c from public.warranty_claims where id = p_claim_id for update;
  if not found then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'claim';
  end if;
  perform public.assert_permission(c.organization_id, 'orders.manage');
  if c.status = 'closed' then
    raise exception using errcode = 'NC006', message = 'INVALID_STATE', detail = 'this claim is closed';
  end if;
  if p_status in ('replaced', 'refunded', 'rejected', 'closed') and coalesce(btrim(coalesce(p_resolution, c.resolution)), '') = '' then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'record how the claim was resolved';
  end if;
  update public.warranty_claims set status = p_status, resolution = coalesce(nullif(btrim(p_resolution), ''), resolution) where id = c.id;
  insert into public.warranty_claim_events (organization_id, claim_id, status, note)
  values (c.organization_id, c.id, p_status, nullif(btrim(p_note), ''));
  return public.warranty_claim(c.id);
end $$;

create or replace function public.warranty_claim(p_claim_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  c public.warranty_claims%rowtype;
begin
  select * into c from public.warranty_claims where id = p_claim_id;
  if not found or not (public.has_permission(c.organization_id, 'orders.view') or public.has_permission(c.organization_id, 'pos.sell')) then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'claim';
  end if;
  return (select jsonb_build_object(
    'claim_id', c.id, 'number', c.number, 'status', c.status, 'issue', c.issue, 'resolution', c.resolution,
    'within_warranty', c.within_warranty, 'expires_on', c.expires_on, 'created_at', c.created_at,
    'order_id', o.id, 'order_number', o.number, 'product', ol.product_name, 'variant', ol.variant_title,
    'serial', (select serial from public.serial_units where id = c.serial_unit_id),
    'customer', coalesce((select jsonb_build_object('id', cu.id, 'name', cu.full_name, 'phone', cu.phone) from public.customers cu where cu.id = c.customer_id),
                         case when o.contact <> '{}'::jsonb then jsonb_build_object('name', o.contact->>'full_name', 'phone', o.contact->>'phone') end),
    'history', (select jsonb_agg(jsonb_build_object('status', e.status, 'note', e.note, 'at', e.created_at,
                                                    'by', (select email from auth.users u where u.id = e.created_by)) order by e.id)
                  from public.warranty_claim_events e where e.claim_id = c.id))
    from public.order_lines ol join public.orders o on o.id = ol.order_id where ol.id = c.order_line_id);
end $$;

-- What a return would refund, without taking it (a rolled-back draft through the
-- real calculation), plus what can still be returned on each line.
create or replace function public.preview_return(p_order_id uuid, p_lines jsonb default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o        public.orders%rowtype;
  v_id     uuid;
  v_result jsonb;
begin
  select * into o from public.orders where id = p_order_id;
  if not found or not (public.has_permission(o.organization_id, 'orders.view') or public.has_permission(o.organization_id, 'pos.sell')) then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'order';
  end if;
  v_result := jsonb_build_object(
    'order_id', o.id, 'order_number', o.number, 'channel', o.channel, 'status', o.status,
    'customer_id', o.customer_id, 'placed_at', coalesce(o.confirmed_at, o.placed_at),
    'within_return_period', public._within_return_window(o),
    'refundable', o.amount_paid - o.amount_refunded,
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
               'order_line_id', ol.id, 'name', ol.product_name, 'variant', ol.variant_title, 'quantity', ol.quantity,
               'line_total', ol.line_total, 'returnable', ol.quantity - public._returned_quantity(ol.id),
               'serials', (select jsonb_agg(su.serial order by su.serial) from public.order_line_units u
                             join public.serial_units su on su.id = u.serial_unit_id
                            where u.order_line_id = ol.id
                              and not exists (select 1 from public.return_lines x join public.returns rr on rr.id = x.return_id
                                               where x.serial_unit_id = su.id and rr.status <> 'cancelled')))
             order by ol.position) from public.order_lines ol where ol.order_id = o.id), '[]'::jsonb));
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    return v_result || jsonb_build_object('refund_total', 0);
  end if;
  begin
    v_id := public._new_return(o, 'requested', 'admin_order', null, null, null);
    perform public._add_return_lines(v_id, p_lines, true);
    v_result := v_result || jsonb_build_object('refund_total', (select refund_total from public.returns where id = v_id));
    raise exception using errcode = 'NCQ00', message = 'PREVIEW_ROLLBACK';
  exception when sqlstate 'NCQ00' then
    null;
  end;
  return v_result;
end $$;

create or replace function public.set_product_warranty(p_product_id uuid, p_months int, p_terms text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.products where id = p_product_id;
  if v_org is null then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'product';
  end if;
  perform public.assert_permission(v_org, 'catalog.manage');
  perform public.assert_module(v_org, 'warranty');
  if p_months is not null and (p_months < 0 or p_months > 120) then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'warranty is 0 to 120 months';
  end if;
  update public.products set warranty_months = p_months, warranty_terms = nullif(btrim(p_terms), '') where id = p_product_id;
end $$;

-- ---------------------------------------------------------------------------
-- Settings: return period
-- ---------------------------------------------------------------------------
create or replace function public.update_organization_settings(p_organization_id uuid, p_changes jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_allowed constant text[] := array['checkout_hold_minutes', 'checkout_max_line_quantity', 'discount_limits',
                                     'receipt_footer', 'contact_email', 'contact_phone', 'low_stock_default',
                                     'delivery_enabled', 'pickup_enabled', 'delivery_fee', 'free_delivery_over',
                                     'allow_cash_on_delivery', 'bank_transfer_details', 'bank_transfer_hold_hours',
                                     'return_days', 'loyalty_points_per_100', 'loyalty_point_value', 'loyalty_min_redeem'];
  v_settings jsonb;
  v_key text;
begin
  perform public.assert_permission(p_organization_id, 'settings.manage');
  for v_key in select jsonb_object_keys(coalesce(p_changes->'settings', '{}'::jsonb)) loop
    if not (v_key = any (v_allowed)) then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = format('unknown setting %s', v_key);
    end if;
  end loop;
  if p_changes ? 'name' and coalesce(btrim(p_changes->>'name'), '') = '' then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'the business needs a name';
  end if;
  if coalesce((p_changes->'settings'->>'checkout_hold_minutes')::int, 15) not between 1 and 120 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'checkout hold is 1 to 120 minutes';
  end if;
  if coalesce((p_changes->'settings'->>'bank_transfer_hold_hours')::int, 24) not between 1 and 168 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'bank transfer hold is 1 to 168 hours';
  end if;
  if coalesce((p_changes->'settings'->>'return_days')::int, 7) not between 0 and 365 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'the return period is 0 to 365 days';
  end if;
  if coalesce((p_changes->'settings'->>'delivery_fee')::numeric, 0) < 0
     or coalesce((p_changes->'settings'->>'free_delivery_over')::numeric, 0) < 0 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'delivery amounts cannot be negative';
  end if;
  if exists (select 1 from jsonb_each_text(coalesce(p_changes->'settings'->'discount_limits', '{}'::jsonb)) d
              where d.key::text not in ('owner','admin','manager','cashier','stock_keeper','viewer')
                 or d.value::numeric < 0 or d.value::numeric > 100) then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'discount limits are 0-100 per role';
  end if;
  update public.organizations
     set name = coalesce(nullif(btrim(p_changes->>'name'), ''), name),
         prices_include_tax = coalesce((p_changes->>'prices_include_tax')::boolean, prices_include_tax),
         timezone = coalesce(nullif(p_changes->>'timezone', ''), timezone),
         settings = jsonb_strip_nulls(settings || coalesce(p_changes->'settings', '{}'::jsonb))
   where id = p_organization_id
  returning settings into v_settings;
  return v_settings;
end $$;

-- ---------------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------------
alter table public.returns enable row level security;
alter table public.return_lines enable row level security;
alter table public.warranty_claims enable row level security;
alter table public.warranty_claim_events enable row level security;

grant select on public.returns, public.return_lines, public.warranty_claims, public.warranty_claim_events to authenticated;
grant all on public.returns, public.return_lines, public.warranty_claims, public.warranty_claim_events to service_role;
revoke all on public.returns, public.return_lines, public.warranty_claims, public.warranty_claim_events from anon;
revoke insert, update, delete, truncate on public.returns, public.return_lines, public.warranty_claims, public.warranty_claim_events from authenticated;

create policy returns_read on public.returns for select
  using (public.has_permission(organization_id, 'orders.view') or public.owns_order(order_id));
create policy return_lines_read on public.return_lines for select
  using (public.has_permission(organization_id, 'orders.view')
         or exists (select 1 from public.returns r where r.id = return_id and public.owns_order(r.order_id)));
create policy warranty_claims_read on public.warranty_claims for select
  using (public.has_permission(organization_id, 'orders.view'));
create policy warranty_claim_events_read on public.warranty_claim_events for select
  using (public.has_permission(organization_id, 'orders.view'));

-- Function grants, maintained by rule rather than by list from here on:
--   * names starting with '_' are internal and never granted
--   * platform-only functions are named below
--   * trigger functions are skipped
--   * everything else is callable by signed-in users (each checks its own permission)
--   * the anonymous storefront gets an explicit allowlist
create or replace function public._regrant_api() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  f record;
  v_platform constant text[] := array['create_organization', 'apply_plan', 'set_organization_module',
                                      'expire_reservations', 'record_gateway_payment',
                                      -- building blocks the commands call; not endpoints
                                      'next_document_number', 'assert_permission', 'assert_module',
                                      'assert_location_access'];
  v_anon constant text[] := array['is_platform_admin', 'role_permissions', 'is_member', 'has_permission',
                                  'has_location_access', 'module_enabled', 'owns_order', 'slugify',
                                  'storefront_organization', 'storefront_settings', 'storefront_availability',
                                  'storefront_categories', 'storefront_catalog', 'storefront_product',
                                  'cart_get', 'cart_set_item', 'cart_clear', 'quote_order', 'checkout',
                                  'get_order_by_token', 'start_checkout', 'request_return'];
begin
  execute 'revoke execute on all functions in schema public from public, anon, authenticated';
  execute 'grant execute on all functions in schema public to service_role';
  for f in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and p.prorettype <> 'trigger'::regtype
       and p.proname !~ '^_'
       and not (p.proname = any (v_platform))
  loop
    execute format('grant execute on function %s to authenticated', f.sig);
    if f.proname = any (v_anon) then
      execute format('grant execute on function %s to anon', f.sig);
    end if;
  end loop;
end $$;

select public._regrant_api();
