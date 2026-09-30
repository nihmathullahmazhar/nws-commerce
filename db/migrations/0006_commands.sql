-- 0006_commands.sql
-- The API. Clients never write stock, orders or reservations directly; they
-- call these functions, which check permission, module and location access and
-- then do the whole job in one transaction.
--
-- Lock order: order row, then stock_levels rows in variant order, then
-- batch/serial rows. Every command below follows it.

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- Line input: validate, merge duplicates, price from the catalogue
-- ---------------------------------------------------------------------------
-- Lines are [{variant_id, quantity, serials?: [...], lot_code?}]. Prices always
-- come from the catalogue; a client cannot propose one.
create or replace function public._order_input(p_org uuid, p_lines jsonb)
returns table (
  variant_id    uuid,
  lot_code      text,
  quantity      numeric,
  serials       text[],
  product_name  text,
  variant_title text,
  sku           text,
  unit_price    numeric,
  tracking_mode public.tracking_mode)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  r record;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'an order needs at least one line';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) e
              where jsonb_typeof(e) <> 'object' or not (e ? 'variant_id') or not (e ? 'quantity')
                 or (e ? 'serials' and jsonb_typeof(e->'serials') <> 'array')) then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
      detail = 'each line needs variant_id and quantity; serials must be a list';
  end if;

  for r in
    with raw as (
      select (e->>'variant_id')::uuid                as variant_id,
             (e->>'quantity')::numeric               as quantity,
             nullif(btrim(e->>'lot_code'), '')       as lot_code,
             e->'serials'                            as serials
        from jsonb_array_elements(p_lines) e),
    grouped as (
      select g.variant_id, g.lot_code, sum(g.quantity) as quantity,
             bool_or(g.serials is not null)          as has_serials,
             (select array_agg(btrim(s))
                from raw r2 cross join lateral jsonb_array_elements_text(r2.serials) s
               where r2.variant_id = g.variant_id
                 and r2.lot_code is not distinct from g.lot_code) as serials
        from raw g
       group by g.variant_id, g.lot_code)
    select gr.*, v.organization_id as v_org, v.title, v.sku, v.price, v.is_active,
           p.name, p.status, p.tracking_mode, p.allow_fractional
      from grouped gr
      left join public.product_variants v on v.id = gr.variant_id
      left join public.products p on p.id = v.product_id
     order by gr.variant_id, gr.lot_code nulls first
  loop
    if r.v_org is distinct from p_org then
      raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = format('variant %s', r.variant_id);
    end if;
    if not r.is_active or r.status <> 'active' then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = format('%s is not for sale', r.name);
    end if;
    if r.quantity is null or r.quantity <= 0 then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'quantity must be positive';
    end if;
    if not r.allow_fractional and r.quantity <> trunc(r.quantity) then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
        detail = format('%s is sold in whole units', r.name);
    end if;
    if r.has_serials then
      if r.tracking_mode <> 'serial' then
        raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
          detail = format('%s is not serial-tracked', r.name);
      end if;
      if coalesce(cardinality(r.serials), 0) <> r.quantity
         or (select count(distinct s) from unnest(r.serials) s) <> cardinality(r.serials) then
        raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
          detail = format('%s needs one distinct serial number per unit', r.name);
      end if;
    end if;
    if r.lot_code is not null and r.tracking_mode <> 'batch' then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
        detail = format('%s is not batch-tracked', r.name);
    end if;

    variant_id    := r.variant_id;
    lot_code      := r.lot_code;
    quantity      := r.quantity;
    serials       := case when r.has_serials then r.serials end;
    product_name  := r.name;
    variant_title := r.title;
    sku           := r.sku;
    unit_price    := r.price;
    tracking_mode := r.tracking_mode;
    return next;
  end loop;
end $$;

create or replace function public._order_summary(p_order uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'order_id', o.id, 'number', o.number, 'status', o.status, 'channel', o.channel,
    'location_id', o.location_id, 'customer_id', o.customer_id,
    'currency_code', o.currency_code, 'subtotal', o.subtotal, 'total', o.total,
    'reservation_expires_at', o.reservation_expires_at,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'line_id', ol.id, 'variant_id', ol.variant_id, 'name', ol.product_name,
               'variant', ol.variant_title, 'quantity', ol.quantity,
               'unit_price', ol.unit_price, 'line_total', ol.line_total,
               'serials', (select jsonb_agg(su.serial order by su.serial)
                             from public.order_line_units u
                             join public.serial_units su on su.id = u.serial_unit_id
                            where u.order_line_id = ol.id))
             order by ol.position)
        from public.order_lines ol where ol.order_id = o.id), '[]'::jsonb))
  from public.orders o where o.id = p_order
$$;

create or replace function public._is_idempotency_clash(p_constraint text) returns boolean
language sql immutable as $$ select p_constraint = 'orders_idempotency_uq' $$;

-- ---------------------------------------------------------------------------
-- place_order: counter, phone and admin orders - stock leaves immediately
-- ---------------------------------------------------------------------------
create or replace function public.place_order(
  p_location_id     uuid,
  p_channel         public.sales_channel,
  p_lines           jsonb,
  p_customer_id     uuid default null,
  p_idempotency_key text default null,
  p_note            text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_org      uuid;
  v_currency char(3);
  v_order    uuid;
  v_line     uuid;
  v_units    uuid[];
  v_pos      int := 0;
  v_subtotal numeric := 0;
  v_constraint text;
  r          record;
begin
  select l.organization_id, o.currency_code into v_org, v_currency
    from public.locations l join public.organizations o on o.id = l.organization_id
   where l.id = p_location_id and l.is_active;
  if v_org is null then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'location';
  end if;

  if p_channel in ('online', 'mobile_app') then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
      detail = 'online and app orders go through start_checkout';
  elsif p_channel = 'pos' then
    perform public.assert_module(v_org, 'pos');
    perform public.assert_permission(v_org, 'pos.sell');
  else
    perform public.assert_permission(v_org, 'orders.manage');
  end if;
  perform public.assert_location_access(v_org, p_location_id);

  if p_idempotency_key is not null then
    select o.id into v_order from public.orders o
     where o.organization_id = v_org and o.idempotency_key = p_idempotency_key;
    if found then
      return public._order_summary(v_order) || '{"replayed": true}'::jsonb;
    end if;
  end if;

  if p_customer_id is not null and not exists (
       select 1 from public.customers c where c.id = p_customer_id and c.organization_id = v_org) then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'customer';
  end if;

  begin
    insert into public.orders
      (organization_id, number, channel, location_id, customer_id, status, currency_code,
       idempotency_key, note, confirmed_at)
    values
      (v_org, public.next_document_number(v_org, 'order', 'ORD-'), p_channel, p_location_id,
       p_customer_id, 'confirmed', v_currency, p_idempotency_key, p_note, now())
    returning id into v_order;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if not public._is_idempotency_clash(v_constraint) then
      raise;
    end if;
    -- The same request is being placed concurrently and got there first.
    select o.id into v_order from public.orders o
     where o.organization_id = v_org and o.idempotency_key = p_idempotency_key;
    return public._order_summary(v_order) || '{"replayed": true}'::jsonb;
  end;

  for r in select * from public._order_input(v_org, p_lines) loop
    if p_channel = 'pos' and r.tracking_mode = 'serial' and r.serials is null then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
        detail = format('scan the serial number of each %s sold at the counter', r.product_name);
    end if;

    v_pos := v_pos + 1;
    insert into public.order_lines
      (organization_id, order_id, variant_id, product_name, variant_title, sku, lot_code,
       quantity, unit_price, line_total, position)
    values
      (v_org, v_order, r.variant_id, r.product_name, r.variant_title, r.sku, r.lot_code,
       r.quantity, r.unit_price, round(r.quantity * r.unit_price, 2), v_pos)
    returning id into v_line;

    v_units := public._issue_line(v_org, p_location_id, r.variant_id, r.quantity, 'sale',
                                  'order', v_order, r.serials, r.lot_code);
    if coalesce(cardinality(v_units), 0) > 0 then
      insert into public.order_line_units (organization_id, order_line_id, serial_unit_id)
      select v_org, v_line, u from unnest(v_units) u;
    end if;

    v_subtotal := v_subtotal + round(r.quantity * r.unit_price, 2);
  end loop;

  update public.orders set subtotal = v_subtotal, total = v_subtotal where id = v_order;
  return public._order_summary(v_order);
end $$;

-- ---------------------------------------------------------------------------
-- start_checkout: online / app orders - stock is held until payment arrives
-- ---------------------------------------------------------------------------
create or replace function public.start_checkout(
  p_organization_id uuid,
  p_lines           jsonb,
  p_idempotency_key text,
  p_channel         public.sales_channel default 'online',
  p_customer_id     uuid default null,
  p_note            text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_currency   char(3);
  v_settings   jsonb;
  v_customer   uuid;
  v_hold       int;
  v_max        numeric;
  v_expires    timestamptz;
  v_order      uuid;
  v_done       boolean := false;
  v_detail     text;
  v_constraint text;
  v_pos        int;
  v_subtotal   numeric;
  v_loc        record;
  r            record;
begin
  select o.currency_code, o.settings into v_currency, v_settings
    from public.organizations o where o.id = p_organization_id;
  if not found then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'organization';
  end if;

  if p_channel = 'online' then
    perform public.assert_module(p_organization_id, 'storefront');
  elsif p_channel = 'mobile_app' then
    perform public.assert_module(p_organization_id, 'mobile_app');
  else
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
      detail = 'counter, phone and admin orders go through place_order';
  end if;

  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
      detail = 'an idempotency key of at least 8 characters is required';
  end if;

  select o.id into v_order from public.orders o
   where o.organization_id = p_organization_id and o.idempotency_key = p_idempotency_key;
  if found then
    return public._order_summary(v_order) || '{"replayed": true}'::jsonb;
  end if;

  -- Staff may place a checkout for a named customer; shoppers are themselves or a guest.
  if public.has_permission(p_organization_id, 'orders.manage') then
    v_customer := p_customer_id;
    if v_customer is not null and not exists (
         select 1 from public.customers c where c.id = v_customer and c.organization_id = p_organization_id) then
      raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'customer';
    end if;
  elsif p_customer_id is not null then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED',
      detail = 'shoppers cannot order on behalf of another customer';
  elsif auth.uid() is not null then
    select c.id into v_customer from public.customers c
     where c.organization_id = p_organization_id and c.auth_user_id = auth.uid();
  end if;

  if exists (select 1 from jsonb_array_elements(p_lines) e where e ? 'serials' or e ? 'lot_code') then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
      detail = 'online orders are allocated units and lots automatically';
  end if;

  v_hold := least(greatest(coalesce((v_settings->>'checkout_hold_minutes')::int, 15), 1), 120);
  v_max  := coalesce((v_settings->>'checkout_max_line_quantity')::numeric, 20);
  if exists (select 1 from public._order_input(p_organization_id, p_lines) i where i.quantity > v_max) then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
      detail = format('at most %s of one item per order', v_max);
  end if;
  v_expires := now() + make_interval(mins => v_hold);

  -- Fulfil from the first online location that can supply every line.
  for v_loc in
    select l.id from public.locations l
     where l.organization_id = p_organization_id and l.is_active and l.sells_online
     order by l.fulfilment_priority, l.code
  loop
    begin
      insert into public.orders
        (organization_id, number, channel, location_id, customer_id, status, currency_code,
         idempotency_key, reservation_expires_at, note)
      values
        (p_organization_id, public.next_document_number(p_organization_id, 'order', 'ORD-'), p_channel,
         v_loc.id, v_customer, 'pending_payment', v_currency, p_idempotency_key, v_expires, p_note)
      returning id into v_order;

      v_pos := 0;
      v_subtotal := 0;
      for r in select * from public._order_input(p_organization_id, p_lines) loop
        v_pos := v_pos + 1;
        insert into public.order_lines
          (organization_id, order_id, variant_id, product_name, variant_title, sku,
           quantity, unit_price, line_total, position)
        values
          (p_organization_id, v_order, r.variant_id, r.product_name, r.variant_title, r.sku,
           r.quantity, r.unit_price, round(r.quantity * r.unit_price, 2), v_pos);
        perform public._reserve_line(p_organization_id, v_loc.id, r.variant_id, r.quantity,
                                     'order', v_order, v_expires);
        v_subtotal := v_subtotal + round(r.quantity * r.unit_price, 2);
      end loop;

      update public.orders set subtotal = v_subtotal, total = v_subtotal where id = v_order;
      v_done := true;
      exit;
    exception
      when sqlstate 'NC001' or sqlstate 'NC004' then
        get stacked diagnostics v_detail = pg_exception_detail;
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if not public._is_idempotency_clash(v_constraint) then
          raise;
        end if;
        select o.id into v_order from public.orders o
         where o.organization_id = p_organization_id and o.idempotency_key = p_idempotency_key;
        return public._order_summary(v_order) || '{"replayed": true}'::jsonb;
    end;
  end loop;

  if not v_done then
    raise exception using errcode = 'NC001', message = 'OUT_OF_STOCK',
      detail = coalesce(v_detail, 'no location is set up to fulfil online orders');
  end if;

  return public._order_summary(v_order);
end $$;

-- ---------------------------------------------------------------------------
-- confirm_order: payment captured (gateway webhook) - reservations become sales
-- ---------------------------------------------------------------------------
create or replace function public.confirm_order(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o public.orders%rowtype;
  r record;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'order';
  end if;
  perform public.assert_permission(o.organization_id, 'orders.manage');

  if o.status in ('confirmed', 'completed') then
    return public._order_summary(o.id) || '{"replayed": true}'::jsonb;
  elsif o.status = 'cancelled' then
    raise exception using errcode = 'NC006', message = 'INVALID_STATE', detail = 'order was cancelled';
  end if;

  -- The hold lapsed (or an earlier attempt hit a conflict): try to take the
  -- stock again now. If it has gone, park the order for a refund or backorder
  -- instead of overselling.
  if not exists (select 1 from public.stock_reservations sr
                  where sr.source_type = 'order' and sr.source_id = o.id and sr.status = 'active') then
    begin
      for r in
        select ol.variant_id, sum(ol.quantity) as quantity
          from public.order_lines ol where ol.order_id = o.id
         group by ol.variant_id order by ol.variant_id
      loop
        perform public._reserve_line(o.organization_id, o.location_id, r.variant_id, r.quantity,
                                     'order', o.id, null);
      end loop;
    exception when sqlstate 'NC001' or sqlstate 'NC004' then
      update public.orders set status = 'stock_conflict', reservation_expires_at = null where id = o.id;
      return public._order_summary(o.id);
    end;
  end if;

  perform public._consume_reservations('order', o.id, 'sale');

  insert into public.order_line_units (organization_id, order_line_id, serial_unit_id)
  select o.organization_id, ol.id, sr.serial_unit_id
    from public.stock_reservations sr
    join lateral (select l.id from public.order_lines l
                   where l.order_id = o.id and l.variant_id = sr.variant_id
                   order by l.position limit 1) ol on true
   where sr.source_type = 'order' and sr.source_id = o.id
     and sr.status = 'consumed' and sr.serial_unit_id is not null
  on conflict do nothing;

  update public.orders
     set status = 'confirmed', confirmed_at = now(), reservation_expires_at = null
   where id = o.id;
  return public._order_summary(o.id);
end $$;

-- ---------------------------------------------------------------------------
-- cancel_order: before payment - the held stock goes back on sale
-- ---------------------------------------------------------------------------
create or replace function public.cancel_order(p_order_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o public.orders%rowtype;
  r record;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'order';
  end if;

  if not public.has_permission(o.organization_id, 'orders.manage') and not (
       o.status = 'pending_payment' and auth.uid() is not null and exists (
         select 1 from public.customers c where c.id = o.customer_id and c.auth_user_id = auth.uid())) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED', detail = 'orders.manage';
  end if;

  if o.status = 'cancelled' then
    return public._order_summary(o.id) || '{"replayed": true}'::jsonb;
  elsif o.status not in ('pending_payment', 'expired', 'stock_conflict') then
    raise exception using errcode = 'NC006', message = 'INVALID_STATE',
      detail = 'a confirmed order is reversed through a return, not cancelled';
  end if;

  for r in
    select sr.id from public.stock_reservations sr
     where sr.source_type = 'order' and sr.source_id = o.id and sr.status = 'active'
     order by sr.location_id, sr.variant_id, sr.id
  loop
    perform public._release_reservation(r.id, 'released');
  end loop;

  update public.orders
     set status = 'cancelled', cancelled_at = now(), reservation_expires_at = null,
         note = case when p_reason is null then note
                     else concat_ws(E'\n', note, 'Cancelled: ' || p_reason) end
   where id = o.id;
  return public._order_summary(o.id);
end $$;

-- ---------------------------------------------------------------------------
-- expire_reservations: run every minute (pg_cron / scheduled Edge Function)
-- ---------------------------------------------------------------------------
create or replace function public.expire_reservations() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order uuid;
  v_count int := 0;
  r record;
begin
  if not public.is_platform_admin() then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED', detail = 'platform admin only';
  end if;

  loop
    -- One order at a time, skipping any a payment confirmation is holding.
    select o.id into v_order from public.orders o
     where o.status = 'pending_payment' and o.reservation_expires_at < now()
     order by o.reservation_expires_at
     limit 1
     for update skip locked;
    exit when not found;

    for r in
      select sr.id from public.stock_reservations sr
       where sr.source_type = 'order' and sr.source_id = v_order and sr.status = 'active'
       order by sr.location_id, sr.variant_id, sr.id
    loop
      perform public._release_reservation(r.id, 'expired');
    end loop;
    update public.orders set status = 'expired' where id = v_order;
    v_count := v_count + 1;
  end loop;

  -- Holds from other sources (held counter sales, pickups) as they are added.
  for r in
    select sr.id from public.stock_reservations sr
     where sr.status = 'active' and sr.source_type <> 'order' and sr.expires_at < now()
     order by sr.location_id, sr.variant_id, sr.id
  loop
    perform public._release_reservation(r.id, 'expired');
  end loop;

  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- receive_stock: goods in
-- ---------------------------------------------------------------------------
-- Lines are [{variant_id, quantity, unit_cost?, serials?: [...], lot_code?, expires_on?}].
create or replace function public.receive_stock(
  p_location_id uuid,
  p_lines       jsonb,
  p_reference   text default null,
  p_note        text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org     uuid;
  v_receipt uuid;
  v_number  text;
  v_count   int := 0;
  e         jsonb;
begin
  select l.organization_id into v_org from public.locations l where l.id = p_location_id and l.is_active;
  if v_org is null then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'location';
  end if;
  perform public.assert_permission(v_org, 'inventory.receive');
  perform public.assert_location_access(v_org, p_location_id);

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'nothing to receive';
  end if;

  v_number := public.next_document_number(v_org, 'receipt', 'RCV-');
  insert into public.stock_receipts (organization_id, location_id, number, reference, note)
  values (v_org, p_location_id, v_number, p_reference, p_note)
  returning id into v_receipt;

  for e in
    select x from jsonb_array_elements(p_lines) x order by x->>'variant_id'
  loop
    if not exists (select 1 from public.product_variants v
                    where v.id = (e->>'variant_id')::uuid and v.organization_id = v_org) then
      raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = format('variant %s', e->>'variant_id');
    end if;
    if coalesce((e->>'quantity')::numeric, 0) <= 0 or coalesce((e->>'unit_cost')::numeric, 0) < 0 then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
        detail = 'quantity must be positive and cost cannot be negative';
    end if;

    perform public._stock_in_line(
      v_org, p_location_id, (e->>'variant_id')::uuid, (e->>'quantity')::numeric, 'receipt',
      (e->>'unit_cost')::numeric, 'stock_receipt', v_receipt,
      case when e ? 'serials' then array(select jsonb_array_elements_text(e->'serials')) end,
      nullif(btrim(e->>'lot_code'), ''),
      (e->>'expires_on')::date);
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('receipt_id', v_receipt, 'number', v_number, 'lines', v_count);
end $$;

-- ---------------------------------------------------------------------------
-- adjust_stock: counts, write-offs, damage. Always positive quantity; the
-- reason gives the direction. A note is mandatory.
-- ---------------------------------------------------------------------------
create or replace function public.adjust_stock(
  p_location_id uuid,
  p_variant_id  uuid,
  p_quantity    numeric,
  p_reason      public.movement_type,
  p_note        text,
  p_serials     text[] default null,
  p_lot_code    text default null,
  p_expires_on  date default null,
  p_unit_cost   numeric default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org  uuid;
  v_mode public.tracking_mode;
  v_id   uuid := gen_random_uuid();
begin
  select l.organization_id into v_org from public.locations l where l.id = p_location_id and l.is_active;
  if v_org is null then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'location';
  end if;
  perform public.assert_permission(v_org, 'inventory.adjust');
  perform public.assert_location_access(v_org, p_location_id);

  if not exists (select 1 from public.product_variants v where v.id = p_variant_id and v.organization_id = v_org) then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'variant';
  end if;
  if p_reason not in ('adjustment_in', 'adjustment_out', 'damage') then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
      detail = 'reason must be adjustment_in, adjustment_out or damage';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'quantity must be positive';
  end if;
  if p_note is null or length(btrim(p_note)) < 3 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'say why the stock is being adjusted';
  end if;

  v_mode := public._tracking_mode(p_variant_id);

  if p_reason = 'adjustment_in' then
    perform public._stock_in_line(v_org, p_location_id, p_variant_id, p_quantity, 'adjustment_in',
                                  p_unit_cost, 'adjustment', v_id, p_serials, p_lot_code, p_expires_on, p_note);
  else
    if v_mode = 'serial' and (p_serials is null or cardinality(p_serials) <> p_quantity) then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
        detail = 'name the serial number of each unit being removed';
    end if;
    if v_mode = 'batch' and p_lot_code is null then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'name the lot being removed';
    end if;
    perform public._issue_line(v_org, p_location_id, p_variant_id, p_quantity, p_reason, 'adjustment', v_id,
                               p_serials, p_lot_code,
                               case p_reason when 'damage' then 'damaged' else 'written_off' end::public.serial_status,
                               p_note);
  end if;

  return jsonb_build_object('adjustment_id', v_id);
end $$;

-- ---------------------------------------------------------------------------
-- lookup_serial: one box for IMEI / serial search, whichever channel sold it
-- ---------------------------------------------------------------------------
create or replace function public.lookup_serial(p_organization_id uuid, p_serial text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_module(p_organization_id, 'serial_tracking');
  if not (public.has_permission(p_organization_id, 'orders.view')
          or public.has_permission(p_organization_id, 'inventory.view')) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED', detail = 'orders.view';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'serial_unit_id', su.id,
      'serial',         su.serial,
      'status',         su.status,
      'product',        p.name,
      'variant',        v.title,
      'sku',            v.sku,
      'location',       l.name,
      'received_at',    su.received_at,
      'sale', (
        select jsonb_build_object(
          'order_id', o.id, 'number', o.number, 'channel', o.channel,
          'placed_at', o.placed_at, 'confirmed_at', o.confirmed_at, 'location', ol.name,
          'customer', case when c.id is null then null
                           else jsonb_build_object('id', c.id, 'name', c.full_name, 'phone', c.phone) end)
          from public.order_line_units olu
          join public.order_lines ln on ln.id = olu.order_line_id
          join public.orders o on o.id = ln.order_id
          join public.locations ol on ol.id = o.location_id
          left join public.customers c on c.id = o.customer_id
         where olu.serial_unit_id = su.id
         order by o.placed_at desc
         limit 1),
      'history', (
        select jsonb_agg(jsonb_build_object('type', m.movement_type, 'quantity', m.quantity,
                                            'at', m.created_at, 'source_type', m.source_type,
                                            'source_id', m.source_id) order by m.id)
          from public.inventory_movements m where m.serial_unit_id = su.id))
      order by su.received_at desc)
      from public.serial_units su
      join public.product_variants v on v.id = su.variant_id
      join public.products p on p.id = v.product_id
      left join public.locations l on l.id = su.location_id
     where su.organization_id = p_organization_id
       and upper(su.serial) = upper(btrim(p_serial))), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Storefront reads
-- ---------------------------------------------------------------------------
-- What the storefront may sell right now: stock at online locations, minus
-- holds, minus expired lots. Cost and location detail are not exposed.
create or replace function public.storefront_availability(p_organization_id uuid, p_variant_ids uuid[] default null)
returns table (variant_id uuid, available numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select v.id,
         case when p.tracking_mode = 'non_stock' then 999999
              when p.tracking_mode = 'batch' then
           coalesce((select sum(bs.on_hand - bs.reserved)
                       from public.batch_stock bs
                       join public.batches b on b.id = bs.batch_id
                       join public.locations l on l.id = bs.location_id
                      where b.variant_id = v.id and l.sells_online and l.is_active
                        and public._sellable_batch(b.expires_on)), 0)
         else
           coalesce((select sum(s.on_hand - s.reserved)
                       from public.stock_levels s
                       join public.locations l on l.id = s.location_id
                      where s.variant_id = v.id and l.sells_online and l.is_active), 0)
         end
    from public.product_variants v
    join public.products p on p.id = v.product_id
   where v.organization_id = p_organization_id
     and v.is_active and p.status = 'active'
     and (p_variant_ids is null or v.id = any (p_variant_ids))
$$;

create or replace function public.inventory_integrity_report(p_organization_id uuid)
returns table (check_name text, location_id uuid, variant_id uuid, expected numeric, actual numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_permission(p_organization_id, 'reports.view');
  return query select * from public._inventory_integrity(p_organization_id);
end $$;
