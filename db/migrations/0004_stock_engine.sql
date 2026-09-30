-- 0004_stock_engine.sql
-- Internal building blocks used by every command that moves stock. None of
-- these are callable from the API (see 0007_security.sql); commands check
-- permissions and then call them.
--
-- Every function here locks the stock_levels row for (location, variant) before
-- touching batch_stock or serial_units rows, which is the schema-wide lock order.

set check_function_bodies = off;

create or replace function public._lock_stock_row(p_org uuid, p_location uuid, p_variant uuid)
returns public.stock_levels
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_level public.stock_levels%rowtype;
begin
  insert into public.stock_levels (organization_id, location_id, variant_id)
  values (p_org, p_location, p_variant)
  on conflict (location_id, variant_id) do nothing;

  select * into v_level from public.stock_levels
   where location_id = p_location and variant_id = p_variant
   for update;
  return v_level;
end $$;

create or replace function public._out_of_stock(p_variant uuid, p_location uuid, p_available numeric, p_requested numeric)
returns void
language plpgsql as $$
begin
  raise exception using errcode = 'NC001', message = 'OUT_OF_STOCK',
    detail = json_build_object('variant_id', p_variant, 'location_id', p_location,
                               'available', greatest(p_available, 0), 'requested', p_requested)::text;
end $$;

create or replace function public._tracking_mode(p_variant uuid) returns public.tracking_mode
language sql stable security definer set search_path = public, pg_temp as $$
  select p.tracking_mode from public.product_variants v
    join public.products p on p.id = v.product_id
   where v.id = p_variant
$$;

-- Batches that may be sold today, first expiry first. A batch expiring today
-- can still be sold today; an expired one only leaves through an adjustment.
create or replace function public._sellable_batch(p_expires_on date) returns boolean
language sql stable as $$
  select p_expires_on is null or p_expires_on >= current_date
$$;

-- ---------------------------------------------------------------------------
-- Reserve: hold stock for a source (an unpaid online order, a held sale)
-- ---------------------------------------------------------------------------
create or replace function public._reserve_line(
  p_org         uuid,
  p_location    uuid,
  p_variant     uuid,
  p_quantity    numeric,
  p_source_type text,
  p_source_id   uuid,
  p_expires_at  timestamptz,
  p_serials     text[] default null,
  p_lot_code    text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_mode      public.tracking_mode := public._tracking_mode(p_variant);
  v_level     public.stock_levels%rowtype;
  v_units     uuid[];
  v_unit      uuid;
  v_remaining numeric := p_quantity;
  v_take      numeric;
  r           record;
begin
  if v_mode = 'non_stock' then return; end if;  -- nothing to hold
  v_level := public._lock_stock_row(p_org, p_location, p_variant);
  if v_level.on_hand - v_level.reserved < p_quantity then
    perform public._out_of_stock(p_variant, p_location, v_level.on_hand - v_level.reserved, p_quantity);
  end if;

  if v_mode = 'serial' then
    if p_serials is not null then
      select array_agg(id) into v_units from (
        select su.id from public.serial_units su
         where su.organization_id = p_org and su.variant_id = p_variant
           and su.location_id = p_location and su.status = 'available'
           and su.serial = any (p_serials)
         for update) s;
      if coalesce(cardinality(v_units), 0) <> cardinality(p_serials) then
        raise exception using errcode = 'NC004', message = 'SERIAL_UNAVAILABLE',
          detail = 'one or more of the given serial numbers is not available here';
      end if;
    else
      select array_agg(id) into v_units from (
        select su.id from public.serial_units su
         where su.organization_id = p_org and su.variant_id = p_variant
           and su.location_id = p_location and su.status = 'available'
         order by su.received_at, su.id
         limit p_quantity
         for update skip locked) s;
      if coalesce(cardinality(v_units), 0) < p_quantity then
        perform public._out_of_stock(p_variant, p_location, coalesce(cardinality(v_units), 0), p_quantity);
      end if;
    end if;

    update public.serial_units set status = 'reserved' where id = any (v_units);
    foreach v_unit in array v_units loop
      insert into public.stock_reservations
        (organization_id, location_id, variant_id, serial_unit_id, quantity, expires_at, source_type, source_id)
      values (p_org, p_location, p_variant, v_unit, 1, p_expires_at, p_source_type, p_source_id);
    end loop;

  elsif v_mode = 'batch' then
    for r in
      select bs.batch_id, bs.on_hand - bs.reserved as available
        from public.batch_stock bs
        join public.batches b on b.id = bs.batch_id
       where bs.location_id = p_location and b.variant_id = p_variant
         and bs.on_hand - bs.reserved > 0
         and public._sellable_batch(b.expires_on)
         and (p_lot_code is null or b.lot_code = p_lot_code)
       order by b.expires_on nulls last, b.created_at
       for update of bs
    loop
      exit when v_remaining <= 0;
      v_take := least(r.available, v_remaining);
      update public.batch_stock set reserved = reserved + v_take
       where location_id = p_location and batch_id = r.batch_id;
      insert into public.stock_reservations
        (organization_id, location_id, variant_id, batch_id, quantity, expires_at, source_type, source_id)
      values (p_org, p_location, p_variant, r.batch_id, v_take, p_expires_at, p_source_type, p_source_id);
      v_remaining := v_remaining - v_take;
    end loop;
    if v_remaining > 0 then
      perform public._out_of_stock(p_variant, p_location, p_quantity - v_remaining, p_quantity);
    end if;

  else
    insert into public.stock_reservations
      (organization_id, location_id, variant_id, quantity, expires_at, source_type, source_id)
    values (p_org, p_location, p_variant, p_quantity, p_expires_at, p_source_type, p_source_id);
  end if;

  update public.stock_levels set reserved = reserved + p_quantity, updated_at = now()
   where location_id = p_location and variant_id = p_variant;
end $$;

-- ---------------------------------------------------------------------------
-- Release: give a reservation back (cancelled, expired)
-- ---------------------------------------------------------------------------
create or replace function public._release_reservation(p_reservation_id uuid, p_final public.reservation_status)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.stock_reservations%rowtype;
begin
  select * into r from public.stock_reservations where id = p_reservation_id;
  perform public._lock_stock_row(r.organization_id, r.location_id, r.variant_id);
  -- Re-read under the stock lock: a concurrent release may have beaten us.
  select * into r from public.stock_reservations where id = p_reservation_id for update;
  if r.status <> 'active' then
    return;
  end if;

  update public.stock_levels set reserved = reserved - r.quantity, updated_at = now()
   where location_id = r.location_id and variant_id = r.variant_id;
  if r.batch_id is not null then
    update public.batch_stock set reserved = reserved - r.quantity
     where location_id = r.location_id and batch_id = r.batch_id;
  end if;
  if r.serial_unit_id is not null then
    update public.serial_units set status = 'available'
     where id = r.serial_unit_id and status = 'reserved';
  end if;
  update public.stock_reservations set status = p_final, closed_at = now() where id = r.id;
end $$;

-- ---------------------------------------------------------------------------
-- Consume: turn every active reservation of a source into a stock issue
-- ---------------------------------------------------------------------------
create or replace function public._consume_reservations(
  p_source_type   text,
  p_source_id     uuid,
  p_movement_type public.movement_type) returns void
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
    -- Under the stock lock the reservation must still be live; callers hold the
    -- source (order) row lock, so this only fires if that rule is broken.
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
      update public.serial_units set status = 'sold' where id = r.serial_unit_id;
    end if;

    insert into public.inventory_movements
      (organization_id, location_id, variant_id, batch_id, serial_unit_id, movement_type, quantity, source_type, source_id)
    values (r.organization_id, r.location_id, r.variant_id, r.batch_id, r.serial_unit_id,
            p_movement_type, -r.quantity, p_source_type, p_source_id);

    update public.stock_reservations set status = 'consumed', closed_at = now() where id = r.id;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Issue: take stock out immediately (counter sale, write-off, damage)
-- Returns the serial units issued, if any.
-- ---------------------------------------------------------------------------
create or replace function public._issue_line(
  p_org           uuid,
  p_location      uuid,
  p_variant       uuid,
  p_quantity      numeric,
  p_movement_type public.movement_type,
  p_source_type   text,
  p_source_id     uuid,
  p_serials       text[] default null,
  p_lot_code      text default null,
  p_serial_final  public.serial_status default 'sold',
  p_note          text default null) returns uuid[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_mode      public.tracking_mode := public._tracking_mode(p_variant);
  v_level     public.stock_levels%rowtype;
  v_units     uuid[] := '{}';
  v_unit      uuid;
  v_remaining numeric := p_quantity;
  v_take      numeric;
  r           record;
begin
  if v_mode = 'non_stock' then return v_units; end if;  -- nothing leaves the shelf
  v_level := public._lock_stock_row(p_org, p_location, p_variant);
  if v_level.on_hand - v_level.reserved < p_quantity then
    perform public._out_of_stock(p_variant, p_location, v_level.on_hand - v_level.reserved, p_quantity);
  end if;

  if v_mode = 'serial' then
    if p_serials is null then
      select array_agg(id) into v_units from (
        select su.id from public.serial_units su
         where su.organization_id = p_org and su.variant_id = p_variant
           and su.location_id = p_location and su.status = 'available'
         order by su.received_at, su.id
         limit p_quantity
         for update skip locked) s;
    else
      -- Conditional update: two counters scanning the same unit cannot both win.
      with taken as (
        update public.serial_units su set status = p_serial_final
         where su.organization_id = p_org and su.variant_id = p_variant
           and su.location_id = p_location and su.status = 'available'
           and su.serial = any (p_serials)
        returning su.id)
      select array_agg(id) into v_units from taken;
      if coalesce(cardinality(v_units), 0) <> cardinality(p_serials) then
        raise exception using errcode = 'NC004', message = 'SERIAL_UNAVAILABLE',
          detail = 'one or more of the given serial numbers is not in stock here';
      end if;
    end if;
    if coalesce(cardinality(v_units), 0) < p_quantity then
      perform public._out_of_stock(p_variant, p_location, coalesce(cardinality(v_units), 0), p_quantity);
    end if;
    update public.serial_units set status = p_serial_final where id = any (v_units);

    foreach v_unit in array v_units loop
      insert into public.inventory_movements
        (organization_id, location_id, variant_id, serial_unit_id, movement_type, quantity, source_type, source_id, note)
      values (p_org, p_location, p_variant, v_unit, p_movement_type, -1, p_source_type, p_source_id, p_note);
    end loop;

  elsif v_mode = 'batch' then
    for r in
      select bs.batch_id, bs.on_hand - bs.reserved as available
        from public.batch_stock bs
        join public.batches b on b.id = bs.batch_id
       where bs.location_id = p_location and b.variant_id = p_variant
         and bs.on_hand - bs.reserved > 0
         -- Expired lots are never sold; a named expired lot can still be written off.
         and (public._sellable_batch(b.expires_on)
              or (p_lot_code is not null and p_movement_type <> 'sale'))
         and (p_lot_code is null or b.lot_code = p_lot_code)
       order by b.expires_on nulls last, b.created_at
       for update of bs
    loop
      exit when v_remaining <= 0;
      v_take := least(r.available, v_remaining);
      insert into public.inventory_movements
        (organization_id, location_id, variant_id, batch_id, movement_type, quantity, source_type, source_id, note)
      values (p_org, p_location, p_variant, r.batch_id, p_movement_type, -v_take, p_source_type, p_source_id, p_note);
      v_remaining := v_remaining - v_take;
    end loop;
    if v_remaining > 0 then
      perform public._out_of_stock(p_variant, p_location, p_quantity - v_remaining, p_quantity);
    end if;

  else
    insert into public.inventory_movements
      (organization_id, location_id, variant_id, movement_type, quantity, source_type, source_id, note)
    values (p_org, p_location, p_variant, p_movement_type, -p_quantity, p_source_type, p_source_id, p_note);
  end if;

  return v_units;
end $$;

-- ---------------------------------------------------------------------------
-- Stock in: receipts and positive adjustments
-- ---------------------------------------------------------------------------
create or replace function public._stock_in_line(
  p_org           uuid,
  p_location      uuid,
  p_variant       uuid,
  p_quantity      numeric,
  p_movement_type public.movement_type,
  p_unit_cost     numeric,
  p_source_type   text,
  p_source_id     uuid,
  p_serials       text[] default null,
  p_lot_code      text default null,
  p_expires_on    date default null,
  p_note          text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_mode   public.tracking_mode := public._tracking_mode(p_variant);
  v_batch  public.batches%rowtype;
  v_serial text;
  v_unit   uuid;
begin
  if v_mode = 'non_stock' then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'this product is not stocked';
  end if;
  if v_mode = 'serial' then
    if p_serials is null or cardinality(p_serials) <> p_quantity then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
        detail = 'serial-tracked stock needs exactly one serial number per unit';
    end if;
    if (select count(distinct s) from unnest(p_serials) s) <> cardinality(p_serials) then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'duplicate serial numbers';
    end if;
    perform public._lock_stock_row(p_org, p_location, p_variant);
    foreach v_serial in array p_serials loop
      begin
        insert into public.serial_units (organization_id, variant_id, serial, status, location_id, unit_cost)
        values (p_org, p_variant, btrim(v_serial), 'available', p_location, p_unit_cost)
        returning id into v_unit;
      exception when unique_violation then
        raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
          detail = format('serial %s is already registered for this item', v_serial);
      end;
      insert into public.inventory_movements
        (organization_id, location_id, variant_id, serial_unit_id, movement_type, quantity, unit_cost, source_type, source_id, note)
      values (p_org, p_location, p_variant, v_unit, p_movement_type, 1, p_unit_cost, p_source_type, p_source_id, p_note);
    end loop;

  elsif v_mode = 'batch' then
    if p_lot_code is null or btrim(p_lot_code) = '' then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
        detail = 'batch-tracked stock needs a lot code';
    end if;
    insert into public.batches (organization_id, variant_id, lot_code, expires_on)
    values (p_org, p_variant, btrim(p_lot_code), p_expires_on)
    on conflict (organization_id, variant_id, lot_code) do nothing;
    select * into v_batch from public.batches
     where organization_id = p_org and variant_id = p_variant and lot_code = btrim(p_lot_code);
    if p_expires_on is not null and v_batch.expires_on is distinct from p_expires_on then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
        detail = format('lot %s is already recorded with expiry %s', v_batch.lot_code, v_batch.expires_on);
    end if;
    insert into public.inventory_movements
      (organization_id, location_id, variant_id, batch_id, movement_type, quantity, unit_cost, source_type, source_id, note)
    values (p_org, p_location, p_variant, v_batch.id, p_movement_type, p_quantity, p_unit_cost, p_source_type, p_source_id, p_note);

  else
    if p_serials is not null or p_lot_code is not null then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
        detail = 'this product is not serial- or batch-tracked';
    end if;
    insert into public.inventory_movements
      (organization_id, location_id, variant_id, movement_type, quantity, unit_cost, source_type, source_id, note)
    values (p_org, p_location, p_variant, p_movement_type, p_quantity, p_unit_cost, p_source_type, p_source_id, p_note);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Integrity: the current position must always equal what the ledger says
-- ---------------------------------------------------------------------------
create or replace function public._inventory_integrity(p_org uuid)
returns table (check_name text, location_id uuid, variant_id uuid, expected numeric, actual numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  -- on_hand = sum of the ledger
  select 'on_hand_matches_ledger', s.location_id, s.variant_id,
         coalesce(m.total, 0), s.on_hand
    from public.stock_levels s
    left join (select im.location_id, im.variant_id, sum(im.quantity) total
                 from public.inventory_movements im where im.organization_id = p_org
                group by 1, 2) m using (location_id, variant_id)
   where s.organization_id = p_org and s.on_hand <> coalesce(m.total, 0)
  union all
  -- reserved = sum of active reservations
  select 'reserved_matches_reservations', s.location_id, s.variant_id,
         coalesce(r.total, 0), s.reserved
    from public.stock_levels s
    left join (select sr.location_id, sr.variant_id, sum(sr.quantity) total
                 from public.stock_reservations sr
                where sr.organization_id = p_org and sr.status = 'active'
                group by 1, 2) r using (location_id, variant_id)
   where s.organization_id = p_org and s.reserved <> coalesce(r.total, 0)
  union all
  -- batch-tracked: batch lots add up to the variant position
  select 'batches_match_variant', s.location_id, s.variant_id,
         coalesce(b.total, 0), s.on_hand
    from public.stock_levels s
    join public.product_variants v on v.id = s.variant_id
    join public.products p on p.id = v.product_id and p.tracking_mode = 'batch'
    left join (select bs.location_id, bt.variant_id, sum(bs.on_hand) total
                 from public.batch_stock bs join public.batches bt on bt.id = bs.batch_id
                where bs.organization_id = p_org group by 1, 2) b using (location_id, variant_id)
   where s.organization_id = p_org and s.on_hand <> coalesce(b.total, 0)
  union all
  -- serial-tracked: units physically here add up to the variant position
  select 'serials_match_variant', s.location_id, s.variant_id,
         coalesce(u.total, 0), s.on_hand
    from public.stock_levels s
    join public.product_variants v on v.id = s.variant_id
    join public.products p on p.id = v.product_id and p.tracking_mode = 'serial'
    left join (select su.location_id, su.variant_id, count(*)::numeric total
                 from public.serial_units su
                where su.organization_id = p_org and su.status in ('available','reserved')
                group by 1, 2) u using (location_id, variant_id)
   where s.organization_id = p_org and s.on_hand <> coalesce(u.total, 0)
$$;
