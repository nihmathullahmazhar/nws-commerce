-- 0001_core.sql
-- Tenancy, plans and modules, staff, locations, audit log and the helpers every
-- later file leans on. Nothing here knows what kind of shop it is running.

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Every capability beyond the catalogue and the stock ledger is a module. Plans
-- switch groups of them on; vertical add-ons (serial numbers, batches and
-- expiry, warranty) are switched on per client regardless of plan.
create type public.module_key as enum (
  'storefront', 'pos', 'multi_location', 'purchasing', 'transfers', 'returns',
  'promotions', 'loyalty', 'wholesale', 'reviews', 'mobile_app',
  'serial_tracking', 'batch_tracking', 'warranty'
);

create type public.staff_role as enum ('owner', 'admin', 'manager', 'cashier', 'stock_keeper', 'viewer');
create type public.location_kind as enum ('store', 'warehouse');

-- ---------------------------------------------------------------------------
-- Organisations, plans, modules
-- ---------------------------------------------------------------------------

create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(btrim(name)) > 0),
  slug          text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  currency_code char(3) not null default 'LKR' check (currency_code ~ '^[A-Z]{3}$'),
  timezone      text not null default 'Asia/Colombo',
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.plans (
  code     text primary key,
  name     text not null,
  modules  public.module_key[] not null,
  position int not null default 0
);

-- Reference data, not demo content: these are the packages NWS sells.
insert into public.plans (code, name, modules, position) values
  ('ecommerce',     'E-Commerce',     array['storefront','reviews','promotions']::public.module_key[], 1),
  ('ecommerce_pro', 'E-Commerce Pro', array['storefront','reviews','promotions','purchasing','returns']::public.module_key[], 2),
  ('retail',        'Retail',         array['storefront','reviews','promotions','purchasing','returns','pos']::public.module_key[], 3),
  ('omnichannel',   'Omnichannel',    array['storefront','reviews','promotions','purchasing','returns','pos',
                                              'multi_location','transfers','loyalty']::public.module_key[], 4),
  ('enterprise',    'Enterprise',     array['storefront','reviews','promotions','purchasing','returns','pos',
                                              'multi_location','transfers','loyalty','wholesale','mobile_app']::public.module_key[], 5);

create table public.organization_modules (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module          public.module_key not null,
  enabled         boolean not null default true,
  changed_at      timestamptz not null default now(),
  primary key (organization_id, module)
);

-- ---------------------------------------------------------------------------
-- Staff and locations
-- ---------------------------------------------------------------------------

create table public.memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            public.staff_role not null,
  -- null means every location; otherwise the member may only act at these.
  location_ids    uuid[],
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

create table public.locations (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  code                text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,15}$'),
  name                text not null check (length(btrim(name)) > 0),
  kind                public.location_kind not null default 'store',
  -- Stock at this location counts towards what the storefront can sell.
  sells_online        boolean not null default false,
  -- Lower is tried first when an online order picks where to fulfil from.
  fulfilment_priority int not null default 100,
  is_active           boolean not null default true,
  address             jsonb not null default '{}'::jsonb,
  phone               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id)
);

-- ---------------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id              bigint generated always as identity primary key,
  organization_id uuid,
  table_name      text not null,
  row_id          text,
  action          text not null,
  old_data        jsonb,
  new_data        jsonb,
  actor_id        uuid default auth.uid(),
  created_at      timestamptz not null default now()
);
create index audit_log_org_idx on public.audit_log (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Generic trigger functions
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function public.prevent_mutation() returns trigger
language plpgsql as $$
begin
  raise exception using errcode = 'NC006', message = 'APPEND_ONLY',
    detail = format('%s rows can only be inserted', tg_table_name);
end $$;

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
begin
  if tg_op = 'UPDATE' and v_old = v_new then
    return new;
  end if;
  insert into public.audit_log (organization_id, table_name, row_id, action, old_data, new_data)
  values (
    coalesce((v_row->>'organization_id')::uuid,
             case when tg_table_name = 'organizations' then (v_row->>'id')::uuid end),
    tg_table_name,
    coalesce(v_row->>'id', v_row->>'user_id', v_row->>'module'),
    lower(tg_op), v_old, v_new);
  return coalesce(new, old);
end $$;

create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function public.prevent_mutation();

create trigger organizations_touch before update on public.organizations
  for each row execute function public.touch_updated_at();
create trigger memberships_touch before update on public.memberships
  for each row execute function public.touch_updated_at();
create trigger locations_touch before update on public.locations
  for each row execute function public.touch_updated_at();

create trigger organizations_audit after insert or update on public.organizations
  for each row execute function public.audit_row();
create trigger organization_modules_audit after insert or update or delete on public.organization_modules
  for each row execute function public.audit_row();
create trigger memberships_audit after insert or update or delete on public.memberships
  for each row execute function public.audit_row();
create trigger locations_audit after insert or update on public.locations
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------------
-- Identity, permission and module helpers
-- ---------------------------------------------------------------------------
-- Error codes raised by this schema (clients switch on these):
--   NC001 OUT_OF_STOCK        NC004 SERIAL_UNAVAILABLE
--   NC002 MODULE_DISABLED     NC005 NOT_FOUND
--   NC003 INVALID_INPUT       NC006 INVALID_STATE / APPEND_ONLY
--   42501 PERMISSION_DENIED

-- NWS itself: the service role (Edge Functions, provisioning scripts) or a
-- direct database session such as the Supabase SQL editor. A direct session
-- only counts while it carries no JWT role: every API request has one (anon at
-- least) and arrives as `authenticator`, so it can never pass as a direct session.
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(auth.role() = 'service_role', false)
      or (auth.role() is null
          and (session_user = 'postgres'
               or coalesce((select r.rolsuper from pg_roles r where r.rolname = session_user), false)))
$$;

create or replace function public.role_permissions(p_role public.staff_role) returns text[]
language sql immutable as $$
  select case p_role
    when 'owner'        then array['*']
    when 'admin'        then array['*']
    when 'manager'      then array['catalog.view','catalog.manage','inventory.view','inventory.receive',
                                   'inventory.adjust','orders.view','orders.manage','pos.sell','pos.override',
                                   'customers.view','customers.manage','reports.view','locations.manage',
                                   'purchasing.manage','transfers.request','transfers.approve']
    when 'cashier'      then array['catalog.view','inventory.view','orders.view','pos.sell',
                                   'customers.view','customers.manage']
    when 'stock_keeper' then array['catalog.view','inventory.view','inventory.receive','inventory.adjust',
                                   'transfers.request']
    when 'viewer'       then array['catalog.view','inventory.view','orders.view','customers.view','reports.view']
  end
$$;

create or replace function public.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.memberships m
     where m.organization_id = p_org and m.user_id = auth.uid() and m.is_active)
$$;

create or replace function public.has_permission(p_org uuid, p_permission text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_platform_admin() or exists (
    select 1 from public.memberships m
     where m.organization_id = p_org and m.user_id = auth.uid() and m.is_active
       and public.role_permissions(m.role) && array['*', p_permission])
$$;

create or replace function public.has_location_access(p_org uuid, p_location uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_platform_admin() or exists (
    select 1 from public.memberships m
     where m.organization_id = p_org and m.user_id = auth.uid() and m.is_active
       and (m.location_ids is null or p_location = any (m.location_ids)))
$$;

create or replace function public.assert_permission(p_org uuid, p_permission text) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.has_permission(p_org, p_permission) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED', detail = p_permission;
  end if;
end $$;

create or replace function public.assert_location_access(p_org uuid, p_location uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.has_location_access(p_org, p_location) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED',
      detail = 'no access to this location';
  end if;
end $$;

create or replace function public.module_enabled(p_org uuid, p_module public.module_key) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.organization_modules om
     where om.organization_id = p_org and om.module = p_module and om.enabled)
$$;

create or replace function public.assert_module(p_org uuid, p_module public.module_key) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.module_enabled(p_org, p_module) then
    raise exception using errcode = 'NC002', message = 'MODULE_DISABLED', detail = p_module::text;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Location rules: a second active location needs multi_location
-- ---------------------------------------------------------------------------

create or replace function public.locations_enforce_module() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.is_active and (tg_op = 'INSERT' or not old.is_active)
     and not public.module_enabled(new.organization_id, 'multi_location')
     and exists (select 1 from public.locations l
                  where l.organization_id = new.organization_id and l.is_active and l.id <> new.id) then
    raise exception using errcode = 'NC002', message = 'MODULE_DISABLED', detail = 'multi_location';
  end if;
  return new;
end $$;

create trigger locations_module_guard before insert or update of is_active on public.locations
  for each row execute function public.locations_enforce_module();

-- ---------------------------------------------------------------------------
-- Provisioning (NWS only)
-- ---------------------------------------------------------------------------

create or replace function public.apply_plan(p_organization_id uuid, p_plan text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_modules public.module_key[];
  v_addons  constant public.module_key[] := array['serial_tracking','batch_tracking','warranty']::public.module_key[];
begin
  if not public.is_platform_admin() then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED', detail = 'platform admin only';
  end if;
  select modules into v_modules from public.plans where code = p_plan;
  if v_modules is null then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = format('plan %s', p_plan);
  end if;

  insert into public.organization_modules (organization_id, module, enabled)
  select p_organization_id, m, true from unnest(v_modules) m
  on conflict (organization_id, module) do update set enabled = true, changed_at = now()
    where not public.organization_modules.enabled;

  -- Plan modules outside the new plan go off; vertical add-ons are left alone.
  update public.organization_modules
     set enabled = false, changed_at = now()
   where organization_id = p_organization_id and enabled
     and not (module = any (v_modules)) and not (module = any (v_addons));

  update public.organizations
     set settings = settings || jsonb_build_object('plan', p_plan)
   where id = p_organization_id;
end $$;

create or replace function public.set_organization_module(
  p_organization_id uuid, p_module public.module_key, p_enabled boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_platform_admin() then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED', detail = 'platform admin only';
  end if;
  insert into public.organization_modules (organization_id, module, enabled)
  values (p_organization_id, p_module, p_enabled)
  on conflict (organization_id, module) do update set enabled = excluded.enabled, changed_at = now();
end $$;

create or replace function public.create_organization(
  p_name          text,
  p_slug          text,
  p_owner_user_id uuid,
  p_plan          text default 'retail',
  p_currency_code text default 'LKR',
  p_location_name text default 'Main Store') returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid;
begin
  if not public.is_platform_admin() then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED', detail = 'platform admin only';
  end if;

  insert into public.organizations (name, slug, currency_code)
  values (p_name, p_slug, upper(p_currency_code))
  returning id into v_org;

  perform public.apply_plan(v_org, p_plan);

  if p_owner_user_id is not null then
    insert into public.memberships (organization_id, user_id, role)
    values (v_org, p_owner_user_id, 'owner');
  end if;

  insert into public.locations (organization_id, code, name, kind, sells_online, fulfilment_priority)
  values (v_org, 'MAIN', p_location_name, 'store', true, 10);

  return v_org;
end $$;

-- Owners and admins manage their own staff; nobody can grant 'owner' except NWS.
create or replace function public.upsert_staff_member(
  p_organization_id uuid,
  p_user_id         uuid,
  p_role            public.staff_role,
  p_location_ids    uuid[] default null,
  p_is_active       boolean default true) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_permission(p_organization_id, 'staff.manage');
  if p_role = 'owner' and not public.is_platform_admin() then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED', detail = 'only NWS assigns owners';
  end if;
  if p_user_id = auth.uid() then
    raise exception using errcode = 'NC006', message = 'INVALID_STATE', detail = 'you cannot change your own membership';
  end if;
  if p_location_ids is not null and exists (
       select 1 from unnest(p_location_ids) l(id)
        where not exists (select 1 from public.locations x
                           where x.id = l.id and x.organization_id = p_organization_id)) then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'unknown location';
  end if;

  insert into public.memberships (organization_id, user_id, role, location_ids, is_active)
  values (p_organization_id, p_user_id, p_role, p_location_ids, p_is_active)
  on conflict (organization_id, user_id) do update
     set role = excluded.role, location_ids = excluded.location_ids, is_active = excluded.is_active;
end $$;

-- Public storefront identity for an organisation, without its settings.
create or replace function public.storefront_organization(p_slug text)
returns table (id uuid, name text, slug text, currency_code char(3), timezone text)
language sql stable security definer set search_path = public, pg_temp as $$
  select o.id, o.name, o.slug, o.currency_code, o.timezone
    from public.organizations o
   where o.slug = p_slug and (public.module_enabled(o.id, 'storefront') or public.module_enabled(o.id, 'mobile_app'))
$$;
