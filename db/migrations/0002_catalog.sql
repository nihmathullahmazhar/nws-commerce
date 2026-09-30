-- 0002_catalog.sql
-- Brands, categories, attribute definitions, products, options, variants, media.
-- The catalogue is vertical-neutral: a T-shirt (size x colour), a phone
-- (storage x colour, serial-tracked), a medicine (batch-tracked) and loose rice
-- (sold by the kg) are all the same shapes with different settings.

set check_function_bodies = off;

-- none   : counted stock only
-- serial : every unit has its own identifier (IMEI, serial, chassis no.) - module serial_tracking
-- batch  : stock is held in lots with optional expiry, sold first-expiry-first-out - module batch_tracking
create type public.tracking_mode as enum ('none', 'serial', 'batch');
create type public.product_status as enum ('draft', 'active', 'archived');
create type public.attribute_type as enum ('text', 'number', 'boolean', 'option');

create table public.brands (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (length(btrim(name)) > 0),
  slug            text not null check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  logo_path       text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, slug),
  unique (organization_id, id)
);

create table public.categories (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parent_id       uuid,
  name            text not null check (length(btrim(name)) > 0),
  slug            text not null check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  description     text,
  position        int not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, slug),
  unique (organization_id, id),
  foreign key (organization_id, parent_id) references public.categories (organization_id, id)
);

-- Structured specifications. A category lists which attributes apply to it,
-- which is what makes filtering and side-by-side comparison possible.
create table public.attribute_definitions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code            text not null check (code ~ '^[a-z][a-z0-9_]*$'),
  label           text not null,
  data_type       public.attribute_type not null,
  unit            text,
  options         text[],
  is_filterable   boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id),
  check ((data_type = 'option') = (options is not null and cardinality(options) > 0))
);

create table public.category_attributes (
  organization_id uuid not null,
  category_id     uuid not null,
  attribute_id    uuid not null,
  position        int not null default 0,
  is_required     boolean not null default false,
  primary key (category_id, attribute_id),
  foreign key (organization_id, category_id) references public.categories (organization_id, id) on delete cascade,
  foreign key (organization_id, attribute_id) references public.attribute_definitions (organization_id, id) on delete cascade
);

create table public.products (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null check (length(btrim(name)) > 0),
  slug             text not null check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  brand_id         uuid,
  category_id      uuid,
  summary          text,
  description      text,
  status           public.product_status not null default 'draft',
  tracking_mode    public.tracking_mode not null default 'none',
  -- The unit stock is counted and sold in: 'each', 'kg', 'm', 'l'...
  unit_of_measure  text not null default 'each',
  allow_fractional boolean not null default false,
  seo              jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, slug),
  unique (organization_id, id),
  foreign key (organization_id, brand_id) references public.brands (organization_id, id),
  foreign key (organization_id, category_id) references public.categories (organization_id, id),
  check (not (tracking_mode = 'serial' and allow_fractional))
);
create index products_org_status_idx on public.products (organization_id, status);
create index products_category_idx on public.products (category_id);
create index products_brand_idx on public.products (brand_id);

create table public.product_options (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  product_id      uuid not null,
  name            text not null check (length(btrim(name)) > 0),
  position        int not null default 0,
  unique (product_id, name),
  unique (organization_id, id),
  foreign key (organization_id, product_id) references public.products (organization_id, id) on delete cascade
);

create table public.product_option_values (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  option_id       uuid not null,
  value           text not null check (length(btrim(value)) > 0),
  position        int not null default 0,
  unique (option_id, value),
  unique (organization_id, id),
  foreign key (organization_id, option_id) references public.product_options (organization_id, id) on delete cascade
);

create table public.product_variants (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  product_id       uuid not null,
  title            text not null default 'Default',
  sku              text,
  barcode          text,
  price            numeric(14,2) not null check (price >= 0),
  compare_at_price numeric(14,2) check (compare_at_price is null or compare_at_price > price),
  position         int not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, product_id) references public.products (organization_id, id) on delete cascade
);
create unique index product_variants_sku_uq on public.product_variants (organization_id, lower(sku)) where sku is not null;
create unique index product_variants_barcode_uq on public.product_variants (organization_id, barcode) where barcode is not null;
create index product_variants_product_idx on public.product_variants (product_id);

create table public.variant_option_values (
  organization_id uuid not null,
  variant_id      uuid not null,
  option_value_id uuid not null,
  primary key (variant_id, option_value_id),
  foreign key (organization_id, variant_id) references public.product_variants (organization_id, id) on delete cascade,
  foreign key (organization_id, option_value_id) references public.product_option_values (organization_id, id) on delete cascade
);

create table public.product_attribute_values (
  organization_id uuid not null,
  product_id      uuid not null,
  attribute_id    uuid not null,
  value           jsonb not null,
  primary key (product_id, attribute_id),
  foreign key (organization_id, product_id) references public.products (organization_id, id) on delete cascade,
  foreign key (organization_id, attribute_id) references public.attribute_definitions (organization_id, id) on delete cascade
);
create index product_attribute_values_filter_idx on public.product_attribute_values (attribute_id, value);

create table public.product_media (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  product_id      uuid not null,
  variant_id      uuid,
  storage_path    text not null,
  alt_text        text,
  position        int not null default 0,
  created_at      timestamptz not null default now(),
  foreign key (organization_id, product_id) references public.products (organization_id, id) on delete cascade,
  foreign key (organization_id, variant_id) references public.product_variants (organization_id, id) on delete cascade
);
create index product_media_product_idx on public.product_media (product_id, position);

-- ---------------------------------------------------------------------------
-- Catalogue rules
-- ---------------------------------------------------------------------------

create or replace function public.categories_prevent_cycle() returns trigger
language plpgsql as $$
begin
  if new.parent_id is not null and exists (
    with recursive up(id, parent_id) as (
      select c.id, c.parent_id from public.categories c where c.id = new.parent_id
      union all
      select c.id, c.parent_id from public.categories c join up on c.id = up.parent_id)
    select 1 from up where up.id = new.id) then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'category cannot be its own ancestor';
  end if;
  return new;
end $$;

create trigger categories_cycle_guard before insert or update of parent_id on public.categories
  for each row execute function public.categories_prevent_cycle();

-- Serial and batch tracking are modules; and once stock has moved, the way a
-- product is counted is fixed, because the ledger was written in that shape.
create or replace function public.products_tracking_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.tracking_mode = 'serial' then
    perform public.assert_module(new.organization_id, 'serial_tracking');
  elsif new.tracking_mode = 'batch' then
    perform public.assert_module(new.organization_id, 'batch_tracking');
  end if;

  if tg_op = 'UPDATE'
     and (new.tracking_mode is distinct from old.tracking_mode
          or new.allow_fractional is distinct from old.allow_fractional
          or new.unit_of_measure is distinct from old.unit_of_measure)
     and exists (select 1 from public.inventory_movements m
                   join public.product_variants v on v.id = m.variant_id
                  where v.product_id = new.id) then
    raise exception using errcode = 'NC006', message = 'INVALID_STATE',
      detail = 'tracking mode and unit cannot change after stock has moved';
  end if;
  return new;
end $$;

create trigger products_tracking_guard
  before insert or update of tracking_mode, allow_fractional, unit_of_measure on public.products
  for each row execute function public.products_tracking_guard();

create trigger brands_touch before update on public.brands for each row execute function public.touch_updated_at();
create trigger categories_touch before update on public.categories for each row execute function public.touch_updated_at();
create trigger products_touch before update on public.products for each row execute function public.touch_updated_at();
create trigger product_variants_touch before update on public.product_variants for each row execute function public.touch_updated_at();

-- Price and status changes are part of the audit trail.
create trigger products_audit after insert or update or delete on public.products
  for each row execute function public.audit_row();
create trigger product_variants_audit after insert or update or delete on public.product_variants
  for each row execute function public.audit_row();
