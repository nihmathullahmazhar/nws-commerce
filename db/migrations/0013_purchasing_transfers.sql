-- 0013_purchasing_transfers.sql
-- Phase 7: suppliers, purchase orders and receiving against them; stock
-- transfers between locations (requested -> approved -> dispatched -> received).
--
-- Every unit that moves still goes through inventory_movements, so the ledger,
-- holds, lots and serials stay exact. Approving a transfer holds the stock at
-- the source; dispatching takes it out (in transit); receiving puts it in at the
-- destination at the same cost.

set check_function_bodies = off;

create type public.po_status as enum ('draft', 'ordered', 'partially_received', 'received', 'closed', 'cancelled');
create type public.transfer_status as enum ('requested', 'approved', 'dispatched', 'received', 'cancelled');

-- ---------------------------------------------------------------------------
-- Suppliers
-- ---------------------------------------------------------------------------
create table public.suppliers (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  name               text not null check (length(btrim(name)) > 0),
  contact_name       text,
  phone              text,
  email              text,
  address            jsonb not null default '{}'::jsonb,
  payment_terms_days int check (payment_terms_days is null or payment_terms_days between 0 and 365),
  notes              text,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (organization_id, id)
);
create unique index suppliers_name_uq on public.suppliers (organization_id, lower(name));
create trigger suppliers_touch before update on public.suppliers for each row execute function public.touch_updated_at();

create or replace function public.suppliers_enforce_module() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_module(new.organization_id, 'purchasing');
  return new;
end $$;
create trigger suppliers_module_guard before insert on public.suppliers
  for each row execute function public.suppliers_enforce_module();

-- ---------------------------------------------------------------------------
-- Purchase orders
-- ---------------------------------------------------------------------------
create table public.purchase_orders (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  number          text not null,
  supplier_id     uuid not null,
  location_id     uuid not null,
  status          public.po_status not null default 'draft',
  expected_on     date,
  supplier_reference text,
  note            text,
  total           numeric(14,2) not null default 0,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  ordered_at      timestamptz,
  closed_at       timestamptz,
  updated_at      timestamptz not null default now(),
  unique (organization_id, number),
  unique (organization_id, id),
  foreign key (organization_id, supplier_id) references public.suppliers (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id)
);
create index purchase_orders_org_idx on public.purchase_orders (organization_id, created_at desc);
create trigger purchase_orders_touch before update on public.purchase_orders for each row execute function public.touch_updated_at();
create trigger purchase_orders_audit after insert or update on public.purchase_orders for each row execute function public.audit_row();

create table public.purchase_order_lines (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  purchase_order_id uuid not null,
  variant_id        uuid not null,
  quantity_ordered  numeric(14,3) not null check (quantity_ordered > 0),
  quantity_received numeric(14,3) not null default 0 check (quantity_received >= 0),
  unit_cost         numeric(14,4) not null check (unit_cost >= 0),
  position          int not null default 0,
  unique (purchase_order_id, variant_id),
  unique (organization_id, id),
  foreign key (organization_id, purchase_order_id) references public.purchase_orders (organization_id, id) on delete cascade,
  foreign key (organization_id, variant_id) references public.product_variants (organization_id, id),
  check (quantity_received <= quantity_ordered)
);

alter table public.stock_receipts
  add column purchase_order_id uuid,
  add column supplier_id uuid,
  add foreign key (organization_id, purchase_order_id) references public.purchase_orders (organization_id, id),
  add foreign key (organization_id, supplier_id) references public.suppliers (organization_id, id);

-- ---------------------------------------------------------------------------
-- Transfers
-- ---------------------------------------------------------------------------
create table public.stock_transfers (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  number           text not null,
  from_location_id uuid not null,
  to_location_id   uuid not null,
  status           public.transfer_status not null default 'requested',
  note             text,
  requested_by     uuid default auth.uid(),
  requested_at     timestamptz not null default now(),
  approved_by      uuid, approved_at timestamptz,
  dispatched_by    uuid, dispatched_at timestamptz,
  received_by      uuid, received_at timestamptz,
  receive_note     text,
  unique (organization_id, number),
  unique (organization_id, id),
  foreign key (organization_id, from_location_id) references public.locations (organization_id, id),
  foreign key (organization_id, to_location_id) references public.locations (organization_id, id),
  check (from_location_id <> to_location_id)
);
create index stock_transfers_org_idx on public.stock_transfers (organization_id, requested_at desc);

create table public.stock_transfer_lines (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  transfer_id       uuid not null,
  variant_id        uuid not null,
  quantity          numeric(14,3) not null check (quantity > 0),
  serials           text[],
  quantity_received numeric(14,3),
  unique (transfer_id, variant_id),
  unique (organization_id, id),
  foreign key (organization_id, transfer_id) references public.stock_transfers (organization_id, id) on delete cascade,
  foreign key (organization_id, variant_id) references public.product_variants (organization_id, id)
);

-- ---------------------------------------------------------------------------
-- Engine: consuming holds with a chosen serial status
-- ---------------------------------------------------------------------------
-- A sale marks units 'sold'; a transfer dispatch marks them 'in_transit'.
drop function public._consume_reservations(text, uuid, public.movement_type);
create or replace function public._consume_reservations(
  p_source_type   text,
  p_source_id     uuid,
  p_movement_type public.movement_type,
  p_serial_final  public.serial_status default 'sold') returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.stock_reservations%rowtype;
begin
  for r in
    select * from public.stock_reservations
     where source_type = p_source_type and source_id = p_source_id and status = 'active'
     order by location_id, variant_id, id
  loop
    perform public._lock_stock_row(r.organization_id, r.location_id, r.variant_id);
    if (select sr.status from public.stock_reservations sr where sr.id = r.id for update) <> 'active' then
      raise exception using errcode = 'NC006', message = 'INVALID_STATE', detail = 'reservation is no longer active';
    end if;

    update public.stock_levels set reserved = reserved - r.quantity
     where location_id = r.location_id and variant_id = r.variant_id;
    if r.batch_id is not null then
      update public.batch_stock set reserved = reserved - r.quantity
       where location_id = r.location_id and batch_id = r.batch_id;
    end if;
    if r.serial_unit_id is not null then
      update public.serial_units set status = p_serial_final where id = r.serial_unit_id;
    end if;

    insert into public.inventory_movements
      (organization_id, location_id, variant_id, batch_id, serial_unit_id, movement_type, quantity, source_type, source_id)
    values (r.organization_id, r.location_id, r.variant_id, r.batch_id, r.serial_unit_id,
            p_movement_type, -r.quantity, p_source_type, p_source_id);

    update public.stock_reservations set status = 'consumed', closed_at = now() where id = r.id;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Purchasing commands
-- ---------------------------------------------------------------------------
-- Creates or updates a draft PO. p_po = {id?, supplier_id, location_id, expected_on?,
-- supplier_reference?, note?, lines: [{variant_id, quantity, unit_cost}]}
create or replace function public.save_purchase_order(p_organization_id uuid, p_po jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id    uuid := nullif(p_po->>'id', '')::uuid;
  v_po    public.purchase_orders%rowtype;
  e       jsonb;
  v_i     int := 0;
begin
  perform public.assert_module(p_organization_id, 'purchasing');
  perform public.assert_permission(p_organization_id, 'purchasing.manage');
  if not exists (select 1 from public.suppliers where id = (p_po->>'supplier_id')::uuid and organization_id = p_organization_id and is_active) then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'supplier';
  end if;
  if not exists (select 1 from public.locations where id = (p_po->>'location_id')::uuid and organization_id = p_organization_id and is_active) then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'delivery location';
  end if;
  if jsonb_typeof(p_po->'lines') <> 'array' or jsonb_array_length(p_po->'lines') = 0 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'a purchase order needs at least one line';
  end if;

  if v_id is null then
    insert into public.purchase_orders (organization_id, number, supplier_id, location_id, expected_on, supplier_reference, note)
    values (p_organization_id, public.next_document_number(p_organization_id, 'purchase_order', 'PO-'),
            (p_po->>'supplier_id')::uuid, (p_po->>'location_id')::uuid, nullif(p_po->>'expected_on', '')::date,
            nullif(btrim(p_po->>'supplier_reference'), ''), nullif(btrim(p_po->>'note'), ''))
    returning id into v_id;
  else
    select * into v_po from public.purchase_orders where id = v_id and organization_id = p_organization_id for update;
    if not found then
      raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'purchase order';
    end if;
    if v_po.status <> 'draft' then
      raise exception using errcode = 'NC006', message = 'INVALID_STATE', detail = 'only a draft purchase order can be edited';
    end if;
    update public.purchase_orders
       set supplier_id = (p_po->>'supplier_id')::uuid, location_id = (p_po->>'location_id')::uuid,
           expected_on = nullif(p_po->>'expected_on', '')::date, supplier_reference = nullif(btrim(p_po->>'supplier_reference'), ''),
           note = nullif(btrim(p_po->>'note'), '')
     where id = v_id;
    delete from public.purchase_order_lines where purchase_order_id = v_id;
  end if;

  for e in select x from jsonb_array_elements(p_po->'lines') x loop
    v_i := v_i + 1;
    if not exists (select 1 from public.product_variants where id = (e->>'variant_id')::uuid and organization_id = p_organization_id) then
      raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'variant';
    end if;
    if coalesce((e->>'quantity')::numeric, 0) <= 0 or coalesce((e->>'unit_cost')::numeric, -1) < 0 then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'each line needs a quantity and a cost';
    end if;
    begin
      insert into public.purchase_order_lines (organization_id, purchase_order_id, variant_id, quantity_ordered, unit_cost, position)
      values (p_organization_id, v_id, (e->>'variant_id')::uuid, (e->>'quantity')::numeric, (e->>'unit_cost')::numeric, v_i);
    exception when unique_violation then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'an item appears twice - combine the lines';
    end;
  end loop;

  update public.purchase_orders
     set total = (select coalesce(sum(round(quantity_ordered * unit_cost, 2)), 0) from public.purchase_order_lines where purchase_order_id = v_id)
   where id = v_id;
  return v_id;
end $$;

create or replace function public.place_purchase_order(p_po_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  po public.purchase_orders%rowtype;
begin
  select * into po from public.purchase_orders where id = p_po_id for update;
  if not found then raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'purchase order'; end if;
  perform public.assert_permission(po.organization_id, 'purchasing.manage');
  if po.status <> 'draft' then
    raise exception using errcode = 'NC006', message = 'INVALID_STATE', detail = 'this purchase order has already been placed';
  end if;
  update public.purchase_orders set status = 'ordered', ordered_at = now() where id = po.id;
end $$;

-- Cancel (nothing received yet) or close short (some received, no more coming).
create or replace function public.close_purchase_order(p_po_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  po public.purchase_orders%rowtype;
begin
  select * into po from public.purchase_orders where id = p_po_id for update;
  if not found then raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'purchase order'; end if;
  perform public.assert_permission(po.organization_id, 'purchasing.manage');
  if po.status in ('received', 'closed', 'cancelled') then
    raise exception using errcode = 'NC006', message = 'INVALID_STATE', detail = format('this purchase order is already %s', po.status);
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'say why';
  end if;
  update public.purchase_orders
     set status = case when po.status = 'partially_received' then 'closed' else 'cancelled' end::public.po_status,
         closed_at = now(), note = concat_ws(E'\n', note, 'Closed: ' || btrim(p_reason))
   where id = po.id;
end $$;

-- Goods in against a PO. p_lines = [{po_line_id, quantity, unit_cost?, serials?, lot_code?, expires_on?}]
create or replace function public.receive_purchase_order(p_po_id uuid, p_lines jsonb, p_reference text default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  po        public.purchase_orders%rowtype;
  pl        public.purchase_order_lines%rowtype;
  e         jsonb;
  v_qty     numeric;
  v_receipt uuid;
  v_number  text;
begin
  select * into po from public.purchase_orders where id = p_po_id for update;
  if not found then raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'purchase order'; end if;
  perform public.assert_permission(po.organization_id, 'inventory.receive');
  perform public.assert_location_access(po.organization_id, po.location_id);
  if po.status not in ('ordered', 'partially_received') then
    raise exception using errcode = 'NC006', message = 'INVALID_STATE',
      detail = case po.status when 'draft' then 'place the order before receiving against it' else format('this purchase order is %s', po.status) end;
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'nothing to receive';
  end if;

  v_number := public.next_document_number(po.organization_id, 'receipt', 'RCV-');
  insert into public.stock_receipts (organization_id, location_id, number, reference, note, purchase_order_id, supplier_id)
  values (po.organization_id, po.location_id, v_number, coalesce(p_reference, po.supplier_reference), p_note, po.id, po.supplier_id)
  returning id into v_receipt;

  for e in select x from jsonb_array_elements(p_lines) x order by x->>'po_line_id' loop
    v_qty := (e->>'quantity')::numeric;
    continue when coalesce(v_qty, 0) = 0;
    select * into pl from public.purchase_order_lines where id = (e->>'po_line_id')::uuid and purchase_order_id = po.id for update;
    if not found then
      raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'that line is not on this purchase order';
    end if;
    if v_qty < 0 or v_qty > pl.quantity_ordered - pl.quantity_received then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
        detail = format('%s outstanding on this line', pl.quantity_ordered - pl.quantity_received);
    end if;
    perform public._stock_in_line(po.organization_id, po.location_id, pl.variant_id, v_qty, 'receipt',
      coalesce((e->>'unit_cost')::numeric, pl.unit_cost), 'stock_receipt', v_receipt,
      case when e ? 'serials' then array(select jsonb_array_elements_text(e->'serials')) end,
      nullif(btrim(e->>'lot_code'), ''), (e->>'expires_on')::date, po.number);
    update public.purchase_order_lines set quantity_received = quantity_received + v_qty where id = pl.id;
  end loop;

  update public.purchase_orders
     set status = case when not exists (select 1 from public.purchase_order_lines
                                         where purchase_order_id = po.id and quantity_received < quantity_ordered)
                       then 'received' else 'partially_received' end::public.po_status,
         closed_at = case when not exists (select 1 from public.purchase_order_lines
                                            where purchase_order_id = po.id and quantity_received < quantity_ordered)
                          then now() end
   where id = po.id;

  return jsonb_build_object('receipt_id', v_receipt, 'number', v_number,
                            'status', (select status from public.purchase_orders where id = po.id));
end $$;

-- What to buy: items at or under their low-stock level, with the last supplier and cost.
create or replace function public.reorder_suggestions(p_organization_id uuid, p_location_id uuid default null)
returns table (variant_id uuid, product_name text, variant_title text, sku text, location_id uuid, location_name text,
               available numeric, low_stock_level numeric, on_order numeric, suggested numeric,
               last_supplier_id uuid, last_supplier text, last_cost numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_default numeric;
begin
  perform public.assert_permission(p_organization_id, 'purchasing.manage');
  select coalesce((settings->>'low_stock_default')::numeric, 3) into v_default from public.organizations where id = p_organization_id;
  return query
    with levels as (
      select s.variant_id, s.location_id, s.on_hand - s.reserved as available, coalesce(s.low_stock_threshold, v_default) as lvl
        from public.stock_levels s
       where s.organization_id = p_organization_id and (p_location_id is null or s.location_id = p_location_id)),
    open_po as (
      select po.location_id, pl.variant_id, sum(pl.quantity_ordered - pl.quantity_received) as qty
        from public.purchase_order_lines pl join public.purchase_orders po on po.id = pl.purchase_order_id
       where po.organization_id = p_organization_id and po.status in ('draft', 'ordered', 'partially_received')
       group by 1, 2),
    last_buy as (
      select distinct on (pl.variant_id) pl.variant_id, po.supplier_id, pl.unit_cost
        from public.purchase_order_lines pl join public.purchase_orders po on po.id = pl.purchase_order_id
       where po.organization_id = p_organization_id and po.status <> 'cancelled'
       order by pl.variant_id, po.created_at desc)
    select l.variant_id, p.name, v.title, v.sku, l.location_id, loc.name, l.available, l.lvl,
           coalesce(o.qty, 0), greatest(ceil(l.lvl * 2 - l.available - coalesce(o.qty, 0)), 0),
           lb.supplier_id, sup.name, lb.unit_cost
      from levels l
      join public.product_variants v on v.id = l.variant_id and v.is_active
      join public.products p on p.id = v.product_id and p.status = 'active'
      join public.locations loc on loc.id = l.location_id
      left join open_po o on o.variant_id = l.variant_id and o.location_id = l.location_id
      left join last_buy lb on lb.variant_id = l.variant_id
      left join public.suppliers sup on sup.id = lb.supplier_id
     where l.available <= l.lvl and l.available + coalesce(o.qty, 0) <= l.lvl
     order by p.name, v.position;
end $$;

-- ---------------------------------------------------------------------------
-- Transfer commands
-- ---------------------------------------------------------------------------
-- p_lines = [{variant_id, quantity, serials?}]
create or replace function public.request_transfer(p_from uuid, p_to uuid, p_lines jsonb, p_note text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid;
  v_id  uuid;
  e     jsonb;
  v_mode public.tracking_mode;
begin
  select organization_id into v_org from public.locations where id = p_from and is_active;
  if v_org is null or not exists (select 1 from public.locations where id = p_to and organization_id = v_org and is_active) then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'location';
  end if;
  perform public.assert_module(v_org, 'transfers');
  perform public.assert_permission(v_org, 'transfers.request');
  if p_from = p_to then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'choose two different locations';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'a transfer needs at least one item';
  end if;

  insert into public.stock_transfers (organization_id, number, from_location_id, to_location_id, note)
  values (v_org, public.next_document_number(v_org, 'transfer', 'TR-'), p_from, p_to, nullif(btrim(p_note), ''))
  returning id into v_id;

  for e in select x from jsonb_array_elements(p_lines) x loop
    select p.tracking_mode into v_mode from public.product_variants v join public.products p on p.id = v.product_id
     where v.id = (e->>'variant_id')::uuid and v.organization_id = v_org;
    if not found then raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'variant'; end if;
    if coalesce((e->>'quantity')::numeric, 0) <= 0 then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'quantities must be positive';
    end if;
    if e ? 'serials' and (v_mode <> 'serial' or jsonb_array_length(e->'serials') <> (e->>'quantity')::numeric) then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'serial numbers only for serial-tracked items, one per unit';
    end if;
    begin
      insert into public.stock_transfer_lines (organization_id, transfer_id, variant_id, quantity, serials)
      values (v_org, v_id, (e->>'variant_id')::uuid, (e->>'quantity')::numeric,
              case when e ? 'serials' then array(select btrim(x) from jsonb_array_elements_text(e->'serials') x) end);
    exception when unique_violation then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'an item appears twice - combine the lines';
    end;
  end loop;
  return v_id;
end $$;

-- Approval holds the stock at the source so it can't be sold before it leaves.
create or replace function public.approve_transfer(p_transfer_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t public.stock_transfers%rowtype;
  l record;
begin
  select * into t from public.stock_transfers where id = p_transfer_id for update;
  if not found then raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'transfer'; end if;
  perform public.assert_permission(t.organization_id, 'transfers.approve');
  if t.status <> 'requested' then
    raise exception using errcode = 'NC006', message = 'INVALID_STATE', detail = format('this transfer is %s', t.status);
  end if;
  for l in select * from public.stock_transfer_lines where transfer_id = t.id order by variant_id loop
    perform public._reserve_line(t.organization_id, t.from_location_id, l.variant_id, l.quantity, 'transfer', t.id, null, l.serials, null);
  end loop;
  update public.stock_transfers set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = t.id;
end $$;

-- The goods leave: out of source stock, serial units in transit.
create or replace function public.dispatch_transfer(p_transfer_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t public.stock_transfers%rowtype;
begin
  select * into t from public.stock_transfers where id = p_transfer_id for update;
  if not found then raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'transfer'; end if;
  perform public.assert_permission(t.organization_id, 'inventory.adjust');
  perform public.assert_location_access(t.organization_id, t.from_location_id);
  if t.status <> 'approved' then
    raise exception using errcode = 'NC006', message = 'INVALID_STATE', detail = 'a transfer is approved before it is dispatched';
  end if;
  perform public._consume_reservations('transfer', t.id, 'transfer_out', 'in_transit');
  update public.stock_transfers set status = 'dispatched', dispatched_by = auth.uid(), dispatched_at = now() where id = t.id;
end $$;

-- The goods arrive. p_lines (optional) = [{line_id, quantity_received, serials?}];
-- omitted means everything arrived. Anything short needs a note; it stays out of
-- stock (lost or damaged in transit) and missing serial units are written off.
create or replace function public.receive_transfer(p_transfer_id uuid, p_lines jsonb default null, p_note text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t        public.stock_transfers%rowtype;
  l        public.stock_transfer_lines%rowtype;
  m        record;
  e        jsonb;
  v_recv   numeric;
  v_left   numeric;
  v_take   numeric;
  v_serials text[];
  v_short  boolean := false;
begin
  select * into t from public.stock_transfers where id = p_transfer_id for update;
  if not found then raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'transfer'; end if;
  perform public.assert_permission(t.organization_id, 'inventory.receive');
  perform public.assert_location_access(t.organization_id, t.to_location_id);
  if t.status <> 'dispatched' then
    raise exception using errcode = 'NC006', message = 'INVALID_STATE', detail = 'only a dispatched transfer can be received';
  end if;

  for l in select * from public.stock_transfer_lines where transfer_id = t.id order by variant_id loop
    e := (select x from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x where x->>'line_id' = l.id::text);
    v_recv := coalesce((e->>'quantity_received')::numeric, l.quantity);
    if v_recv < 0 or v_recv > l.quantity then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = format('between 0 and %s arrived', l.quantity);
    end if;
    if v_recv < l.quantity then v_short := true; end if;
    v_serials := case when e ? 'serials' then array(select upper(btrim(x)) from jsonb_array_elements_text(e->'serials') x) end;
    v_left := v_recv;

    for m in
      select im.serial_unit_id, im.batch_id, -im.quantity as qty, im.unit_cost, su.serial
        from public.inventory_movements im left join public.serial_units su on su.id = im.serial_unit_id
       where im.source_type = 'transfer' and im.source_id = t.id and im.variant_id = l.variant_id and im.movement_type = 'transfer_out'
       order by im.id
    loop
      if m.serial_unit_id is not null then
        if (v_serials is null and v_left >= 1) or upper(m.serial) = any (coalesce(v_serials, '{}')) then
          update public.serial_units set status = 'available', location_id = t.to_location_id where id = m.serial_unit_id;
          insert into public.inventory_movements (organization_id, location_id, variant_id, serial_unit_id, movement_type, quantity, unit_cost, source_type, source_id, note)
          values (t.organization_id, t.to_location_id, l.variant_id, m.serial_unit_id, 'transfer_in', 1, m.unit_cost, 'transfer', t.id, t.number);
          v_left := v_left - 1;
        else
          update public.serial_units set status = 'written_off' where id = m.serial_unit_id;
        end if;
      else
        v_take := least(m.qty, v_left);
        if v_take > 0 then
          insert into public.inventory_movements (organization_id, location_id, variant_id, batch_id, movement_type, quantity, unit_cost, source_type, source_id, note)
          values (t.organization_id, t.to_location_id, l.variant_id, m.batch_id, 'transfer_in', v_take, m.unit_cost, 'transfer', t.id, t.number);
          v_left := v_left - v_take;
        end if;
      end if;
    end loop;
    if v_serials is not null and v_left <> 0 then
      raise exception using errcode = 'NC004', message = 'SERIAL_UNAVAILABLE', detail = 'the serials received do not match what was dispatched';
    end if;
    update public.stock_transfer_lines set quantity_received = v_recv where id = l.id;
  end loop;

  if v_short and coalesce(btrim(p_note), '') = '' then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'less arrived than was sent - say what happened';
  end if;
  update public.stock_transfers
     set status = 'received', received_by = auth.uid(), received_at = now(), receive_note = nullif(btrim(p_note), '')
   where id = t.id;
end $$;

create or replace function public.cancel_transfer(p_transfer_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t public.stock_transfers%rowtype;
  r record;
begin
  select * into t from public.stock_transfers where id = p_transfer_id for update;
  if not found then raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'transfer'; end if;
  perform public.assert_permission(t.organization_id, 'transfers.approve');
  if t.status not in ('requested', 'approved') then
    raise exception using errcode = 'NC006', message = 'INVALID_STATE', detail = 'goods already on the way cannot be cancelled - receive them';
  end if;
  for r in select id from public.stock_reservations where source_type = 'transfer' and source_id = t.id and status = 'active' order by location_id, variant_id, id loop
    perform public._release_reservation(r.id, 'released');
  end loop;
  update public.stock_transfers set status = 'cancelled', note = concat_ws(E'\n', note, 'Cancelled: ' || coalesce(p_reason, '')) where id = t.id;
end $$;

-- ---------------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------------
alter table public.suppliers enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_lines enable row level security;

grant select on public.suppliers, public.purchase_orders, public.purchase_order_lines, public.stock_transfers, public.stock_transfer_lines to authenticated;
grant insert, update on public.suppliers to authenticated;
grant all on public.suppliers, public.purchase_orders, public.purchase_order_lines, public.stock_transfers, public.stock_transfer_lines to service_role;
revoke all on public.suppliers, public.purchase_orders, public.purchase_order_lines, public.stock_transfers, public.stock_transfer_lines from anon;
revoke insert, update, delete, truncate on public.purchase_orders, public.purchase_order_lines, public.stock_transfers, public.stock_transfer_lines from authenticated;

create policy suppliers_read on public.suppliers for select
  using (public.has_permission(organization_id, 'purchasing.manage') or public.has_permission(organization_id, 'inventory.receive'));
create policy suppliers_insert on public.suppliers for insert with check (public.has_permission(organization_id, 'purchasing.manage'));
create policy suppliers_update on public.suppliers for update
  using (public.has_permission(organization_id, 'purchasing.manage')) with check (public.has_permission(organization_id, 'purchasing.manage'));
create policy purchase_orders_read on public.purchase_orders for select
  using (public.has_permission(organization_id, 'purchasing.manage') or public.has_permission(organization_id, 'inventory.receive'));
create policy purchase_order_lines_read on public.purchase_order_lines for select
  using (public.has_permission(organization_id, 'purchasing.manage') or public.has_permission(organization_id, 'inventory.receive'));
create policy stock_transfers_read on public.stock_transfers for select using (public.has_permission(organization_id, 'inventory.view'));
create policy stock_transfer_lines_read on public.stock_transfer_lines for select using (public.has_permission(organization_id, 'inventory.view'));

select public._regrant_api();
