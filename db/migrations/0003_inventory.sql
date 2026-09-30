-- 0003_inventory.sql
-- One stock ledger for every channel and every location.
--
-- inventory_movements is the source of truth and is append-only. stock_levels
-- (and batch_stock) are the current position, changed ONLY by the trigger that
-- applies each movement, under a row lock, inside the same transaction. The
-- CHECK constraints make overselling impossible even for a buggy caller:
--   on_hand >= 0, reserved >= 0, reserved <= on_hand.

set check_function_bodies = off;

create type public.movement_type as enum (
  'receipt',          -- goods received (with or without a purchase order)
  'sale',             -- issued against an order, any channel
  'sale_return',      -- a customer return put back into stock
  'adjustment_in',    -- stock count found more
  'adjustment_out',   -- stock count found less / written off
  'damage',           -- damaged, expired, destroyed
  'transfer_out',
  'transfer_in'
);

create type public.reservation_status as enum ('active', 'consumed', 'released', 'expired');

create type public.serial_status as enum (
  'available', 'reserved', 'sold', 'in_transit', 'inspection',
  'damaged', 'written_off', 'returned_to_supplier'
);

-- ---------------------------------------------------------------------------
-- Current position
-- ---------------------------------------------------------------------------

create table public.stock_levels (
  organization_id     uuid not null,
  location_id         uuid not null,
  variant_id          uuid not null,
  on_hand             numeric(14,3) not null default 0,
  reserved            numeric(14,3) not null default 0,
  -- Weighted average cost of what is on hand; the cost of goods sold is taken
  -- from here at the moment of sale (serialised units carry their own cost).
  avg_unit_cost       numeric(14,4) not null default 0,
  low_stock_threshold numeric(14,3),
  updated_at          timestamptz not null default now(),
  primary key (location_id, variant_id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id),
  foreign key (organization_id, variant_id) references public.product_variants (organization_id, id),
  constraint stock_levels_on_hand_nonneg check (on_hand >= 0),
  constraint stock_levels_reserved_valid check (reserved >= 0 and reserved <= on_hand)
);
create index stock_levels_variant_idx on public.stock_levels (variant_id);
create index stock_levels_org_idx on public.stock_levels (organization_id);

-- ---------------------------------------------------------------------------
-- Batch / lot module
-- ---------------------------------------------------------------------------

create table public.batches (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  variant_id      uuid not null,
  lot_code        text not null check (length(btrim(lot_code)) > 0),
  expires_on      date,
  manufactured_on date,
  created_at      timestamptz not null default now(),
  unique (organization_id, variant_id, lot_code),
  unique (organization_id, id),
  foreign key (organization_id, variant_id) references public.product_variants (organization_id, id)
);

create table public.batch_stock (
  organization_id uuid not null,
  location_id     uuid not null,
  batch_id        uuid not null,
  on_hand         numeric(14,3) not null default 0,
  reserved        numeric(14,3) not null default 0,
  primary key (location_id, batch_id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id),
  foreign key (organization_id, batch_id) references public.batches (organization_id, id),
  constraint batch_stock_on_hand_nonneg check (on_hand >= 0),
  constraint batch_stock_reserved_valid check (reserved >= 0 and reserved <= on_hand)
);

-- ---------------------------------------------------------------------------
-- Serial module (IMEI, serial number, chassis number...)
-- ---------------------------------------------------------------------------

create table public.serial_units (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  variant_id      uuid not null,
  serial          text not null check (serial = btrim(serial) and length(serial) > 0),
  status          public.serial_status not null default 'available',
  location_id     uuid,
  unit_cost       numeric(14,4),
  -- clock_timestamp, not now(): units received in one delivery keep their scan
  -- order, so "oldest unit first" is deterministic.
  received_at     timestamptz not null default clock_timestamp(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, variant_id, serial),
  unique (organization_id, id),
  foreign key (organization_id, variant_id) references public.product_variants (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id)
);
create index serial_units_lookup_idx on public.serial_units (organization_id, upper(serial));
create index serial_units_pick_idx on public.serial_units (variant_id, location_id, status, received_at);

create trigger serial_units_touch before update on public.serial_units
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Stock receipts (goods in, independent of purchasing)
-- ---------------------------------------------------------------------------

create table public.stock_receipts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id     uuid not null,
  number          text not null,
  reference       text,
  note            text,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  unique (organization_id, number),
  unique (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id)
);

-- ---------------------------------------------------------------------------
-- The ledger
-- ---------------------------------------------------------------------------

create table public.inventory_movements (
  id              bigint generated always as identity primary key,
  organization_id uuid not null,
  location_id     uuid not null,
  variant_id      uuid not null,
  batch_id        uuid,
  serial_unit_id  uuid,
  movement_type   public.movement_type not null,
  quantity        numeric(14,3) not null check (quantity <> 0),
  unit_cost       numeric(14,4),
  source_type     text not null,
  source_id       uuid,
  note            text,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations (organization_id, id),
  foreign key (organization_id, variant_id) references public.product_variants (organization_id, id),
  foreign key (organization_id, batch_id) references public.batches (organization_id, id),
  foreign key (organization_id, serial_unit_id) references public.serial_units (organization_id, id),
  check (
    (movement_type in ('receipt','sale_return','adjustment_in','transfer_in') and quantity > 0) or
    (movement_type in ('sale','adjustment_out','damage','transfer_out') and quantity < 0))
);
create index inventory_movements_stock_idx on public.inventory_movements (location_id, variant_id, created_at);
create index inventory_movements_source_idx on public.inventory_movements (source_type, source_id);
create index inventory_movements_serial_idx on public.inventory_movements (serial_unit_id) where serial_unit_id is not null;
create index inventory_movements_org_time_idx on public.inventory_movements (organization_id, created_at);

-- ---------------------------------------------------------------------------
-- Reservations (online checkouts, held sales, pickups)
-- ---------------------------------------------------------------------------

create table public.stock_reservations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id     uuid not null,
  variant_id      uuid not null,
  batch_id        uuid,
  serial_unit_id  uuid,
  quantity        numeric(14,3) not null check (quantity > 0),
  status          public.reservation_status not null default 'active',
  expires_at      timestamptz,
  source_type     text not null,
  source_id       uuid not null,
  created_at      timestamptz not null default now(),
  closed_at       timestamptz,
  foreign key (organization_id, location_id) references public.locations (organization_id, id),
  foreign key (organization_id, variant_id) references public.product_variants (organization_id, id),
  foreign key (organization_id, batch_id) references public.batches (organization_id, id),
  foreign key (organization_id, serial_unit_id) references public.serial_units (organization_id, id)
);
create index stock_reservations_source_idx on public.stock_reservations (source_type, source_id);
create index stock_reservations_expiry_idx on public.stock_reservations (expires_at) where status = 'active';

-- ---------------------------------------------------------------------------
-- Applying a movement
-- ---------------------------------------------------------------------------
-- Lock order everywhere in this schema: stock_levels row first, then the
-- batch_stock / serial_units rows under it. Keeping one order is what keeps
-- concurrent sales from deadlocking each other.

create or replace function public.inventory_movement_apply() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_mode   public.tracking_mode;
  v_frac   boolean;
  v_level  public.stock_levels%rowtype;
  v_bstock public.batch_stock%rowtype;
begin
  select p.tracking_mode, p.allow_fractional into v_mode, v_frac
    from public.product_variants v
    join public.products p on p.id = v.product_id
   where v.id = new.variant_id and v.organization_id = new.organization_id;
  if not found then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'variant';
  end if;

  if not v_frac and new.quantity <> trunc(new.quantity) then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
      detail = 'this product is counted in whole units';
  end if;
  -- 'non_stock' (0014): services, fees and gift cards never have stock.
  if v_mode = 'non_stock' then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'this product is not stocked';
  end if;

  -- The shape of a movement must match how the product is tracked.
  if v_mode = 'serial' then
    if new.serial_unit_id is null or new.batch_id is not null or abs(new.quantity) <> 1 then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
        detail = 'serial-tracked stock moves one identified unit at a time';
    end if;
  elsif v_mode = 'batch' then
    if new.batch_id is null or new.serial_unit_id is not null then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
        detail = 'batch-tracked stock must name its batch';
    end if;
  elsif new.batch_id is not null or new.serial_unit_id is not null then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
      detail = 'this product is not serial- or batch-tracked';
  end if;

  insert into public.stock_levels (organization_id, location_id, variant_id)
  values (new.organization_id, new.location_id, new.variant_id)
  on conflict (location_id, variant_id) do nothing;

  -- FOR UPDATE waits for any concurrent sale of the same item and then reads
  -- the row as that sale left it, so the check below always sees the truth.
  select * into v_level from public.stock_levels
   where location_id = new.location_id and variant_id = new.variant_id
   for update;

  if v_level.on_hand + new.quantity < v_level.reserved then
    raise exception using errcode = 'NC001', message = 'OUT_OF_STOCK',
      detail = json_build_object('variant_id', new.variant_id, 'location_id', new.location_id,
                                 'available', v_level.on_hand - v_level.reserved,
                                 'requested', -new.quantity)::text;
  end if;

  if new.unit_cost is null then
    if new.serial_unit_id is not null then
      select unit_cost into new.unit_cost from public.serial_units where id = new.serial_unit_id;
    end if;
    new.unit_cost := coalesce(new.unit_cost, v_level.avg_unit_cost);
  end if;

  update public.stock_levels
     set on_hand = on_hand + new.quantity,
         avg_unit_cost = case
           when new.quantity > 0 and on_hand + new.quantity > 0
             then round((on_hand * avg_unit_cost + new.quantity * new.unit_cost) / (on_hand + new.quantity), 4)
           else avg_unit_cost end,
         updated_at = now()
   where location_id = new.location_id and variant_id = new.variant_id;

  if new.batch_id is not null then
    insert into public.batch_stock (organization_id, location_id, batch_id)
    values (new.organization_id, new.location_id, new.batch_id)
    on conflict (location_id, batch_id) do nothing;

    select * into v_bstock from public.batch_stock
     where location_id = new.location_id and batch_id = new.batch_id
     for update;

    if v_bstock.on_hand + new.quantity < v_bstock.reserved then
      raise exception using errcode = 'NC001', message = 'OUT_OF_STOCK',
        detail = json_build_object('variant_id', new.variant_id, 'batch_id', new.batch_id,
                                   'available', v_bstock.on_hand - v_bstock.reserved,
                                   'requested', -new.quantity)::text;
    end if;

    update public.batch_stock set on_hand = on_hand + new.quantity
     where location_id = new.location_id and batch_id = new.batch_id;
  end if;

  return new;
end $$;

create trigger inventory_movements_apply before insert on public.inventory_movements
  for each row execute function public.inventory_movement_apply();
create trigger inventory_movements_append_only before update or delete on public.inventory_movements
  for each row execute function public.prevent_mutation();
