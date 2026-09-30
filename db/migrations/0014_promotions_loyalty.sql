-- 0014_promotions_loyalty.sql
-- Phase 8: promotions and coupons, gift cards, loyalty points, and non-stock
-- products (services, fees, gift cards) that never touch the stock ledger.
--
-- Pricing: promotions are worked out inside _write_order_lines (0008), so the
-- storefront quote, the till quote, checkout and the sale all agree. The best
-- promotion applies per line (never on top of a manual discount), plus at most
-- one order-level promotion (never on top of a manual order discount).
-- Promotional discounts do not count against a cashier's discount limit.
--
-- NOTE on enum values: Supabase runs a pasted script in one transaction, where a
-- value added by ALTER TYPE ... ADD VALUE cannot be used yet. The new values
-- below are only ever referenced inside function bodies, which run later.

set check_function_bodies = off;

alter type public.tracking_mode add value if not exists 'non_stock';
alter type public.payment_method add value if not exists 'gift_card';
alter type public.payment_method add value if not exists 'loyalty_points';

create type public.promotion_kind as enum ('percent_off', 'amount_off', 'buy_x_get_y');
create type public.promotion_scope as enum ('products', 'order');

-- ---------------------------------------------------------------------------
-- Gift card products
-- ---------------------------------------------------------------------------
alter table public.products add column is_gift_card boolean not null default false;

create or replace function public.products_gift_card_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.is_gift_card then
    perform public.assert_module(new.organization_id, 'loyalty');
    if new.tracking_mode <> 'non_stock' then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'a gift card is a non-stock product';
    end if;
    new.tax_exempt := true;  -- a gift card is money, not goods
  end if;
  return new;
end $$;
create trigger products_gift_card_guard before insert or update of is_gift_card, tracking_mode on public.products
  for each row execute function public.products_gift_card_guard();

-- ---------------------------------------------------------------------------
-- Promotions
-- ---------------------------------------------------------------------------
create table public.promotions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (length(btrim(name)) > 0),
  kind            public.promotion_kind not null,
  scope           public.promotion_scope not null,
  value           numeric(14,2) not null default 0 check (value >= 0),
  buy_quantity    int check (buy_quantity is null or buy_quantity >= 1),
  get_quantity    int check (get_quantity is null or get_quantity >= 1),
  min_subtotal    numeric(14,2) check (min_subtotal is null or min_subtotal >= 0),
  product_ids     uuid[] not null default '{}',
  category_ids    uuid[] not null default '{}',
  brand_ids       uuid[] not null default '{}',
  coupon_code     text check (coupon_code is null or coupon_code ~ '^[A-Z0-9_-]{3,32}$'),
  channels        public.sales_channel[],
  starts_at       timestamptz,
  ends_at         timestamptz,
  usage_limit     int check (usage_limit is null or usage_limit >= 1),
  usage_count     int not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id),
  check (kind <> 'percent_off' or value <= 100),
  check (kind <> 'buy_x_get_y' or (buy_quantity is not null and get_quantity is not null and scope = 'products')),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create unique index promotions_coupon_uq on public.promotions (organization_id, coupon_code) where coupon_code is not null;
create trigger promotions_touch before update on public.promotions for each row execute function public.touch_updated_at();
create trigger promotions_audit after insert or update on public.promotions for each row execute function public.audit_row();

alter table public.orders
  add column coupon_code          text,
  add column promo_discount_total numeric(14,2) not null default 0;
alter table public.order_lines add column promo_discount numeric(14,2) not null default 0;

create table public.order_promotions (
  organization_id uuid not null,
  order_id        uuid not null,
  promotion_id    uuid not null,
  amount          numeric(14,2) not null,
  primary key (order_id, promotion_id),
  foreign key (organization_id, order_id) references public.orders (organization_id, id) on delete cascade,
  foreign key (organization_id, promotion_id) references public.promotions (organization_id, id)
);

-- Promotions a line or an order could take right now.
create or replace function public._live_promotions(p_org uuid, p_channel public.sales_channel, p_coupon text)
returns setof public.promotions
language sql stable security definer set search_path = public, pg_temp as $$
  select p.* from public.promotions p
   where p.organization_id = p_org and p.is_active and public.module_enabled(p_org, 'promotions')
     and (p.starts_at is null or p.starts_at <= now()) and (p.ends_at is null or p.ends_at > now())
     and (p.channels is null or p_channel = any (p.channels))
     and (p.usage_limit is null or p.usage_count < p.usage_limit)
     and (p.coupon_code is null or p.coupon_code = p_coupon)
$$;

-- ---------------------------------------------------------------------------
-- Gift cards
-- ---------------------------------------------------------------------------
create table public.gift_cards (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code            text not null,
  initial_value   numeric(14,2) not null check (initial_value > 0),
  balance         numeric(14,2) not null default 0 check (balance >= 0),
  status          text not null default 'active' check (status in ('active', 'void')),
  expires_on      date,
  customer_id     uuid,
  order_line_id   uuid,
  note            text,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id),
  foreign key (organization_id, order_line_id) references public.order_lines (organization_id, id)
);

create table public.gift_card_ledger (
  id              bigint generated always as identity primary key,
  organization_id uuid not null,
  gift_card_id    uuid not null,
  amount          numeric(14,2) not null check (amount <> 0),
  reason          text not null,
  order_id        uuid,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  foreign key (organization_id, gift_card_id) references public.gift_cards (organization_id, id)
);

create or replace function public.gift_card_apply() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v public.gift_cards%rowtype;
begin
  select * into v from public.gift_cards where id = new.gift_card_id for update;
  if new.amount < 0 and (v.status <> 'active' or (v.expires_on is not null and v.expires_on < current_date)) then
    raise exception using errcode = 'NC006', message = 'INVALID_STATE', detail = 'this gift card is not active';
  end if;
  if v.balance + new.amount < 0 then
    raise exception using errcode = 'NC007', message = 'INSUFFICIENT_GIFT_CARD',
      detail = json_build_object('balance', v.balance, 'requested', -new.amount)::text;
  end if;
  update public.gift_cards set balance = balance + new.amount where id = v.id;
  return new;
end $$;
create trigger gift_card_ledger_apply before insert on public.gift_card_ledger for each row execute function public.gift_card_apply();
create trigger gift_card_ledger_append_only before update or delete on public.gift_card_ledger for each row execute function public.prevent_mutation();

-- XXXX-XXXX-XXXX-XXXX from an alphabet without look-alikes (no 0/O, 1/I/L).
create or replace function public._new_gift_card_code(p_org uuid) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_alpha constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code  text;
begin
  loop
    v_bytes := extensions.gen_random_bytes(16);
    v_code := '';
    for i in 0..15 loop
      v_code := v_code || substr(v_alpha, (get_byte(v_bytes, i) % length(v_alpha)) + 1, 1);
      if i in (3, 7, 11) then v_code := v_code || '-'; end if;
    end loop;
    exit when not exists (select 1 from public.gift_cards where organization_id = p_org and code = v_code);
  end loop;
  return v_code;
end $$;

create or replace function public._issue_gift_card(p_org uuid, p_amount numeric, p_reason text, p_customer uuid, p_order_line uuid, p_order uuid)
returns public.gift_cards
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v public.gift_cards%rowtype;
begin
  insert into public.gift_cards (organization_id, code, initial_value, customer_id, order_line_id, note)
  values (p_org, public._new_gift_card_code(p_org), p_amount, p_customer, p_order_line, p_reason)
  returning * into v;
  insert into public.gift_card_ledger (organization_id, gift_card_id, amount, reason, order_id)
  values (p_org, v.id, p_amount, p_reason, p_order);
  select * into v from public.gift_cards where id = v.id;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Loyalty points
-- ---------------------------------------------------------------------------
alter table public.customers
  add column loyalty_points int not null default 0,
  add constraint customers_loyalty_nonneg check (loyalty_points >= 0);

create table public.loyalty_ledger (
  id              bigint generated always as identity primary key,
  organization_id uuid not null,
  customer_id     uuid not null,
  points          int not null check (points <> 0),
  reason          text not null,
  source_type     text not null,
  source_id       uuid,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id)
);
create index loyalty_ledger_customer_idx on public.loyalty_ledger (customer_id, created_at desc);
create unique index loyalty_ledger_earn_once on public.loyalty_ledger (source_id) where source_type = 'order_earned';

create or replace function public.loyalty_apply() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_points int;
begin
  select loyalty_points into v_points from public.customers where id = new.customer_id for update;
  if v_points + new.points < 0 then
    raise exception using errcode = 'NC007', message = 'INSUFFICIENT_POINTS',
      detail = json_build_object('balance', v_points, 'requested', -new.points)::text;
  end if;
  update public.customers set loyalty_points = loyalty_points + new.points where id = new.customer_id;
  return new;
end $$;
create trigger loyalty_ledger_apply before insert on public.loyalty_ledger for each row execute function public.loyalty_apply();
create trigger loyalty_ledger_append_only before update or delete on public.loyalty_ledger for each row execute function public.prevent_mutation();

-- settings.loyalty_points_per_100 (default 1): points earned per 100 spent.
-- settings.loyalty_point_value (default 1): currency value of one point when spent.
-- settings.loyalty_min_redeem (default 0): fewest points spent at once.
create or replace function public._loyalty_setting(p_org uuid, p_key text, p_default numeric) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((settings->>p_key)::numeric, p_default) from public.organizations where id = p_org
$$;

-- What spend earns points: the order total less delivery, gift cards bought and
-- whatever was paid with points.
create or replace function public._award_loyalty(p_order uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o        public.orders%rowtype;
  v_amount numeric;
  v_points int;
begin
  select * into o from public.orders where id = p_order;
  if o.customer_id is null or o.status not in ('confirmed', 'completed') or not public.module_enabled(o.organization_id, 'loyalty') then
    return;
  end if;
  if exists (select 1 from public.loyalty_ledger where source_type = 'order_earned' and source_id = o.id) then
    return;
  end if;
  v_amount := o.total - o.shipping_total
            - coalesce((select sum(ol.line_total) from public.order_lines ol
                          join public.product_variants v on v.id = ol.variant_id join public.products p on p.id = v.product_id
                         where ol.order_id = o.id and p.is_gift_card), 0)
            - coalesce((select sum(py.amount) from public.payments py
                         where py.order_id = o.id and py.kind = 'payment' and py.method = 'loyalty_points' and py.status = 'captured'), 0);
  v_points := floor(greatest(v_amount, 0) / 100 * public._loyalty_setting(o.organization_id, 'loyalty_points_per_100', 1));
  if v_points > 0 then
    insert into public.loyalty_ledger (organization_id, customer_id, points, reason, source_type, source_id)
    values (o.organization_id, o.customer_id, v_points, 'Earned on ' || o.number, 'order_earned', o.id);
  end if;
end $$;

-- A return takes back what that part of the sale earned (never below zero).
create or replace function public._return_loyalty(p_return uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r        public.returns%rowtype;
  o        public.orders%rowtype;
  v_points int;
  v_have   int;
begin
  select * into r from public.returns where id = p_return;
  select * into o from public.orders where id = r.order_id;
  if o.customer_id is null or not exists (select 1 from public.loyalty_ledger where source_type = 'order_earned' and source_id = o.id) then
    return;
  end if;
  v_points := floor(r.refund_total / 100 * public._loyalty_setting(o.organization_id, 'loyalty_points_per_100', 1));
  select loyalty_points into v_have from public.customers where id = o.customer_id for update;
  v_points := least(v_points, v_have);
  if v_points > 0 then
    insert into public.loyalty_ledger (organization_id, customer_id, points, reason, source_type, source_id)
    values (o.organization_id, o.customer_id, -v_points, 'Returned ' || r.number, 'return', r.id);
  end if;
end $$;

-- Gift cards bought on a confirmed order are issued once, one card per unit.
create or replace function public._issue_order_gift_cards(p_order uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o public.orders%rowtype;
  l record;
begin
  select * into o from public.orders where id = p_order;
  if o.status not in ('confirmed', 'completed') then return; end if;
  for l in
    select ol.* from public.order_lines ol
      join public.product_variants v on v.id = ol.variant_id join public.products p on p.id = v.product_id
     where ol.order_id = o.id and p.is_gift_card
       and not exists (select 1 from public.gift_cards g where g.order_line_id = ol.id)
  loop
    for i in 1..(l.quantity::int) loop
      perform public._issue_gift_card(o.organization_id, l.unit_price, 'Sold on ' || o.number, o.customer_id, l.id, o.id);
    end loop;
  end loop;
end $$;

-- Everything that happens once an order is confirmed (sale at the counter, or
-- an online order's payment arriving).
create or replace function public._after_confirm(p_order uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._issue_order_gift_cards(p_order);
  perform public._award_loyalty(p_order);
end $$;

-- ---------------------------------------------------------------------------
-- Commands
-- ---------------------------------------------------------------------------
-- p_promo = {id?, name, kind, scope, value, buy_quantity?, get_quantity?, min_subtotal?,
--            product_ids?, category_ids?, brand_ids?, coupon_code?, channels?, starts_at?,
--            ends_at?, usage_limit?, is_active?}
create or replace function public.save_promotion(p_organization_id uuid, p_promo jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id   uuid := nullif(p_promo->>'id', '')::uuid;
  v_code text := nullif(upper(btrim(coalesce(p_promo->>'coupon_code', ''))), '');
  v_row  public.promotions%rowtype;
begin
  perform public.assert_module(p_organization_id, 'promotions');
  perform public.assert_permission(p_organization_id, 'catalog.manage');
  v_row.organization_id := p_organization_id;
  v_row.name := btrim(p_promo->>'name');
  v_row.kind := (p_promo->>'kind')::public.promotion_kind;
  v_row.scope := coalesce(p_promo->>'scope', 'products')::public.promotion_scope;
  v_row.value := coalesce((p_promo->>'value')::numeric, 0);
  v_row.buy_quantity := (p_promo->>'buy_quantity')::int;
  v_row.get_quantity := (p_promo->>'get_quantity')::int;
  v_row.min_subtotal := (p_promo->>'min_subtotal')::numeric;
  v_row.product_ids := coalesce(array(select jsonb_array_elements_text(p_promo->'product_ids'))::uuid[], '{}');
  v_row.category_ids := coalesce(array(select jsonb_array_elements_text(p_promo->'category_ids'))::uuid[], '{}');
  v_row.brand_ids := coalesce(array(select jsonb_array_elements_text(p_promo->'brand_ids'))::uuid[], '{}');
  v_row.coupon_code := v_code;
  v_row.channels := case when jsonb_typeof(p_promo->'channels') = 'array' and jsonb_array_length(p_promo->'channels') > 0
                         then array(select jsonb_array_elements_text(p_promo->'channels'))::public.sales_channel[] end;
  v_row.starts_at := nullif(p_promo->>'starts_at', '')::timestamptz;
  v_row.ends_at := nullif(p_promo->>'ends_at', '')::timestamptz;
  v_row.usage_limit := (p_promo->>'usage_limit')::int;
  v_row.is_active := coalesce((p_promo->>'is_active')::boolean, true);
  if v_row.kind <> 'buy_x_get_y' and v_row.value <= 0 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'give the discount a value';
  end if;

  begin
    if v_id is null then
      insert into public.promotions (organization_id, name, kind, scope, value, buy_quantity, get_quantity, min_subtotal, product_ids,
                                     category_ids, brand_ids, coupon_code, channels, starts_at, ends_at, usage_limit, is_active)
      values (v_row.organization_id, v_row.name, v_row.kind, v_row.scope, v_row.value, v_row.buy_quantity, v_row.get_quantity,
              v_row.min_subtotal, v_row.product_ids, v_row.category_ids, v_row.brand_ids, v_row.coupon_code, v_row.channels,
              v_row.starts_at, v_row.ends_at, v_row.usage_limit, v_row.is_active)
      returning id into v_id;
    else
      update public.promotions
         set name = v_row.name, kind = v_row.kind, scope = v_row.scope, value = v_row.value, buy_quantity = v_row.buy_quantity,
             get_quantity = v_row.get_quantity, min_subtotal = v_row.min_subtotal, product_ids = v_row.product_ids,
             category_ids = v_row.category_ids, brand_ids = v_row.brand_ids, coupon_code = v_row.coupon_code, channels = v_row.channels,
             starts_at = v_row.starts_at, ends_at = v_row.ends_at, usage_limit = v_row.usage_limit, is_active = v_row.is_active
       where id = v_id and organization_id = p_organization_id;
      if not found then raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'promotion'; end if;
    end if;
  exception
    when unique_violation then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = format('the code %s is already used by another promotion', v_code);
    when check_violation then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
        detail = 'check the promotion: percent 0-100, buy/get quantities for buy-X-get-Y (products only), codes 3-32 letters/digits, end after start';
  end;
  return v_id;
end $$;

-- Balance and history of a gift card (the till checks it before taking it).
create or replace function public.gift_card_lookup(p_organization_id uuid, p_code text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  g public.gift_cards%rowtype;
begin
  perform public.assert_module(p_organization_id, 'loyalty');
  if not (public.has_permission(p_organization_id, 'pos.sell') or public.has_permission(p_organization_id, 'orders.view')) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED', detail = 'pos.sell';
  end if;
  select * into g from public.gift_cards where organization_id = p_organization_id and code = upper(btrim(p_code));
  if not found then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'no gift card has that code';
  end if;
  return jsonb_build_object('gift_card_id', g.id, 'code', g.code, 'balance', g.balance, 'initial_value', g.initial_value,
    'status', case when g.status = 'void' then 'void' when g.expires_on < current_date then 'expired'
                   when g.balance = 0 then 'used' else 'active' end,
    'expires_on', g.expires_on, 'created_at', g.created_at,
    'history', (select jsonb_agg(jsonb_build_object('amount', l.amount, 'reason', l.reason, 'at', l.created_at) order by l.id)
                  from public.gift_card_ledger l where l.gift_card_id = g.id));
end $$;

-- A card given away (goodwill, a prize, a replacement) rather than sold.
create or replace function public.issue_gift_card(p_organization_id uuid, p_amount numeric, p_reason text, p_customer_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  g public.gift_cards%rowtype;
begin
  perform public.assert_module(p_organization_id, 'loyalty');
  perform public.assert_permission(p_organization_id, 'orders.manage');
  if p_amount is null or p_amount <= 0 or coalesce(btrim(p_reason), '') = '' then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'an amount and a reason are required';
  end if;
  g := public._issue_gift_card(p_organization_id, p_amount, btrim(p_reason), p_customer_id, null, null);
  return public.gift_card_lookup(p_organization_id, g.code);
end $$;

create or replace function public.void_gift_card(p_organization_id uuid, p_code text, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_permission(p_organization_id, 'orders.manage');
  update public.gift_cards set status = 'void', note = concat_ws(E'\n', note, 'Void: ' || p_reason)
   where organization_id = p_organization_id and code = upper(btrim(p_code)) and status = 'active';
  if not found then raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'no active gift card has that code'; end if;
end $$;

create or replace function public.adjust_loyalty_points(p_customer_id uuid, p_points int, p_reason text) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.customers where id = p_customer_id;
  if v_org is null then raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'customer'; end if;
  perform public.assert_module(v_org, 'loyalty');
  perform public.assert_permission(v_org, 'orders.manage');
  if coalesce(p_points, 0) = 0 or coalesce(btrim(p_reason), '') = '' then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'points and a reason are required';
  end if;
  insert into public.loyalty_ledger (organization_id, customer_id, points, reason, source_type)
  values (v_org, p_customer_id, p_points, btrim(p_reason), 'adjustment');
  return (select loyalty_points from public.customers where id = p_customer_id);
end $$;

-- ---------------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------------
alter table public.promotions enable row level security;
alter table public.order_promotions enable row level security;
alter table public.gift_cards enable row level security;
alter table public.gift_card_ledger enable row level security;
alter table public.loyalty_ledger enable row level security;

grant select on public.promotions, public.order_promotions, public.gift_cards, public.gift_card_ledger, public.loyalty_ledger to authenticated;
grant all on public.promotions, public.order_promotions, public.gift_cards, public.gift_card_ledger, public.loyalty_ledger to service_role;
revoke all on public.promotions, public.order_promotions, public.gift_cards, public.gift_card_ledger, public.loyalty_ledger from anon;
revoke insert, update, delete, truncate on public.promotions, public.order_promotions, public.gift_cards, public.gift_card_ledger, public.loyalty_ledger from authenticated;
-- The loyalty balance and gift-card flag move only through their own paths.
revoke update (loyalty_points) on public.customers from authenticated;

create policy promotions_read on public.promotions for select using (public.is_member(organization_id));
create policy order_promotions_read on public.order_promotions for select
  using (public.has_permission(organization_id, 'orders.view') or public.owns_order(order_id));
create policy gift_cards_read on public.gift_cards for select using (public.has_permission(organization_id, 'orders.view'));
create policy gift_card_ledger_read on public.gift_card_ledger for select using (public.has_permission(organization_id, 'orders.view'));
create policy loyalty_ledger_read on public.loyalty_ledger for select
  using (public.has_permission(organization_id, 'customers.view')
         or exists (select 1 from public.customers c where c.id = customer_id and c.auth_user_id = auth.uid()));

select public._regrant_api();
