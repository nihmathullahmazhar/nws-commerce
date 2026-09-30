-- 0005_orders.sql
-- Customers, document numbering and the single order model. A counter sale, an
-- online order, an app order, a phone order and an order keyed in by admin are
-- all rows in `orders`; only `channel` differs. That is what lets one customer
-- see every purchase and one report add up every channel.

set check_function_bodies = off;

create type public.sales_channel as enum ('online', 'pos', 'mobile_app', 'phone_order', 'admin_order');

create type public.order_status as enum (
  'pending_payment',  -- online: stock is reserved, waiting for the payment gateway
  'confirmed',        -- stock issued; payment captured or taken at the counter
  'completed',        -- handed over / delivered
  'cancelled',
  'expired',          -- the reservation lapsed before payment arrived
  'stock_conflict'    -- paid after the hold lapsed and the stock was gone: needs refund or backorder
);

-- ---------------------------------------------------------------------------
-- Customers (shared by storefront, POS and app)
-- ---------------------------------------------------------------------------

create table public.customers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  auth_user_id    uuid references auth.users(id) on delete set null,
  full_name       text,
  -- Stored normalised (+94771234567); counter staff look customers up by phone.
  phone           text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),
  email           text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  notes           text,
  marketing_consent boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id)
);
create unique index customers_phone_uq on public.customers (organization_id, phone) where phone is not null;
create unique index customers_email_uq on public.customers (organization_id, lower(email)) where email is not null;
create unique index customers_auth_uq on public.customers (organization_id, auth_user_id) where auth_user_id is not null;

create trigger customers_touch before update on public.customers
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Gap-free document numbers
-- ---------------------------------------------------------------------------
-- A row per (organisation, document type, scope) incremented under a row lock.
-- Unlike a sequence, a rolled-back transaction gives its number back, so
-- invoice numbers have no holes.

create table public.document_sequences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  doc_type        text not null,
  scope           text not null default '',
  prefix          text not null,
  next_value      bigint not null default 1 check (next_value > 0),
  pad             int not null default 6,
  primary key (organization_id, doc_type, scope)
);

create or replace function public.next_document_number(
  p_org uuid, p_doc_type text, p_prefix text, p_scope text default '') returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_value bigint;
  v_prefix text;
  v_pad int;
begin
  insert into public.document_sequences (organization_id, doc_type, scope, prefix)
  values (p_org, p_doc_type, p_scope, p_prefix)
  on conflict do nothing;

  update public.document_sequences
     set next_value = next_value + 1
   where organization_id = p_org and doc_type = p_doc_type and scope = p_scope
  returning next_value - 1, prefix, pad into v_value, v_prefix, v_pad;

  return v_prefix || lpad(v_value::text, v_pad, '0');
end $$;

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

create table public.orders (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  number                 text not null,
  channel                public.sales_channel not null,
  location_id            uuid not null,
  customer_id            uuid,
  status                 public.order_status not null,
  currency_code          char(3) not null,
  subtotal               numeric(14,2) not null default 0,
  discount_total         numeric(14,2) not null default 0,
  tax_total              numeric(14,2) not null default 0,
  total                  numeric(14,2) not null default 0,
  idempotency_key        text,
  reservation_expires_at timestamptz,
  note                   text,
  placed_by              uuid default auth.uid(),
  placed_at              timestamptz not null default now(),
  confirmed_at           timestamptz,
  cancelled_at           timestamptz,
  updated_at             timestamptz not null default now(),
  unique (organization_id, number),
  unique (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id),
  check (total = subtotal - discount_total + tax_total)
);
create unique index orders_idempotency_uq on public.orders (organization_id, idempotency_key)
  where idempotency_key is not null;
create index orders_org_time_idx on public.orders (organization_id, placed_at desc);
create index orders_customer_idx on public.orders (customer_id, placed_at desc);
create index orders_channel_idx on public.orders (organization_id, channel, placed_at);

create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

create table public.order_lines (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  order_id        uuid not null,
  variant_id      uuid not null,
  -- Snapshots: what the customer bought, as it was named and priced then.
  product_name    text not null,
  variant_title   text not null,
  sku             text,
  lot_code        text,
  quantity        numeric(14,3) not null check (quantity > 0),
  unit_price      numeric(14,2) not null check (unit_price >= 0),
  line_total      numeric(14,2) not null,
  position        int not null default 0,
  unique (organization_id, id),
  foreign key (organization_id, order_id) references public.orders (organization_id, id) on delete cascade,
  foreign key (organization_id, variant_id) references public.product_variants (organization_id, id)
);
create index order_lines_order_idx on public.order_lines (order_id, position);
create index order_lines_variant_idx on public.order_lines (variant_id);

-- Which identified units went out on which line (serial module).
create table public.order_line_units (
  organization_id uuid not null,
  order_line_id   uuid not null,
  serial_unit_id  uuid not null,
  primary key (order_line_id, serial_unit_id),
  foreign key (organization_id, order_line_id) references public.order_lines (organization_id, id) on delete cascade,
  foreign key (organization_id, serial_unit_id) references public.serial_units (organization_id, id)
);
create index order_line_units_serial_idx on public.order_line_units (serial_unit_id);
