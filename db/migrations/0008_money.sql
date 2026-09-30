-- 0008_money.sql
-- Phase 2: tax, manual discounts with manager approval, payments (split tender,
-- cash change, pay-later, gateway webhooks), refunds and store credit.
--
-- New error codes:
--   NC007 PAYMENT_INCOMPLETE / INSUFFICIENT_STORE_CREDIT
--   NC008 APPROVAL_REQUIRED

set check_function_bodies = off;

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Tax
-- ---------------------------------------------------------------------------

create table public.tax_rates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code            text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,15}$'),
  name            text not null,
  rate_percent    numeric(6,3) not null check (rate_percent >= 0 and rate_percent <= 100),
  is_default      boolean not null default false,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id)
);
create unique index tax_rates_one_default on public.tax_rates (organization_id) where is_default;

create trigger tax_rates_audit after insert or update or delete on public.tax_rates
  for each row execute function public.audit_row();

-- Retail shelf prices usually include tax; some B2B setups quote without it.
alter table public.organizations add column prices_include_tax boolean not null default true;

-- A product uses its own rate, else the organisation default; exempt means none.
alter table public.products
  add column tax_rate_id uuid,
  add column tax_exempt  boolean not null default false,
  add foreign key (organization_id, tax_rate_id) references public.tax_rates (organization_id, id);

-- ---------------------------------------------------------------------------
-- Order money columns
-- ---------------------------------------------------------------------------

create type public.payment_state as enum ('unpaid', 'partially_paid', 'paid', 'partially_refunded', 'refunded');

alter table public.orders
  add column tax_inclusive   boolean not null default true,
  add column amount_paid     numeric(14,2) not null default 0,
  add column amount_refunded numeric(14,2) not null default 0,
  add column payment_status  public.payment_state not null default 'unpaid',
  drop constraint orders_check,
  add constraint orders_totals_valid check (
    total = subtotal - discount_total + case when tax_inclusive then 0 else tax_total end
    and subtotal >= 0 and discount_total >= 0 and tax_total >= 0 and total >= 0),
  add constraint orders_refund_valid check (amount_refunded >= 0 and amount_refunded <= amount_paid);

-- line_subtotal = quantity x unit price
-- line_total    = line_subtotal - discount_amount (+ tax_amount when prices exclude tax)
alter table public.order_lines
  add column line_subtotal   numeric(14,2),
  add column discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  add column tax_rate        numeric(6,3) not null default 0,
  add column tax_amount      numeric(14,2) not null default 0 check (tax_amount >= 0);
update public.order_lines set line_subtotal = line_total where line_subtotal is null;
alter table public.order_lines alter column line_subtotal set not null;

-- ---------------------------------------------------------------------------
-- Payments and refunds
-- ---------------------------------------------------------------------------

create type public.payment_method as enum (
  'cash', 'card', 'bank_transfer', 'qr', 'online_gateway', 'store_credit', 'cash_on_delivery');
create type public.payment_kind as enum ('payment', 'refund');
create type public.payment_status as enum ('pending', 'captured', 'failed', 'voided');

create table public.payments (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null,
  order_id           uuid not null,
  kind               public.payment_kind not null default 'payment',
  method             public.payment_method not null,
  status             public.payment_status not null default 'captured',
  amount             numeric(14,2) not null check (amount > 0),
  -- Cash only: what the customer handed over and what went back.
  tendered           numeric(14,2),
  change_given       numeric(14,2) check (change_given is null or change_given >= 0),
  provider           text,
  provider_reference text,
  payload            jsonb not null default '{}'::jsonb,
  note               text,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  captured_at        timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, order_id) references public.orders (organization_id, id),
  check (method = 'cash' or (tendered is null and change_given is null))
);
create index payments_order_idx on public.payments (order_id, created_at);
create index payments_org_time_idx on public.payments (organization_id, created_at);
-- A gateway may call back more than once; the same reference is recorded once.
create unique index payments_provider_ref_uq on public.payments (organization_id, provider, kind, provider_reference)
  where provider is not null and provider_reference is not null;

create trigger payments_append_only before delete on public.payments
  for each row execute function public.prevent_mutation();

-- ---------------------------------------------------------------------------
-- Store credit (append-only ledger; balance kept on the customer under lock)
-- ---------------------------------------------------------------------------

alter table public.customers
  add column store_credit_balance numeric(14,2) not null default 0,
  add constraint customers_store_credit_nonneg check (store_credit_balance >= 0);

create table public.store_credit_ledger (
  id              bigint generated always as identity primary key,
  organization_id uuid not null,
  customer_id     uuid not null,
  amount          numeric(14,2) not null check (amount <> 0),
  reason          text not null,
  source_type     text not null,
  source_id       uuid,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id)
);
create index store_credit_ledger_customer_idx on public.store_credit_ledger (customer_id, created_at);

create or replace function public.store_credit_apply() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_balance numeric;
begin
  select store_credit_balance into v_balance from public.customers
   where id = new.customer_id and organization_id = new.organization_id
   for update;
  if not found then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'customer';
  end if;
  if v_balance + new.amount < 0 then
    raise exception using errcode = 'NC007', message = 'INSUFFICIENT_STORE_CREDIT',
      detail = json_build_object('balance', v_balance, 'requested', -new.amount)::text;
  end if;
  update public.customers set store_credit_balance = store_credit_balance + new.amount
   where id = new.customer_id;
  return new;
end $$;

create trigger store_credit_ledger_apply before insert on public.store_credit_ledger
  for each row execute function public.store_credit_apply();
create trigger store_credit_ledger_append_only before update or delete on public.store_credit_ledger
  for each row execute function public.prevent_mutation();

-- ---------------------------------------------------------------------------
-- Manager overrides: PINs and one-time approvals
-- ---------------------------------------------------------------------------

create table public.staff_pins (
  organization_id uuid not null,
  user_id         uuid not null,
  pin_hash        text not null,
  failed_attempts int not null default 0,
  locked_until    timestamptz,
  updated_at      timestamptz not null default now(),
  primary key (organization_id, user_id),
  foreign key (organization_id, user_id) references public.memberships (organization_id, user_id) on delete cascade
);

create table public.approvals (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  purpose              text not null,
  approver_id          uuid not null,
  requested_by         uuid not null,
  max_discount_percent numeric(5,2) not null,
  expires_at           timestamptz not null,
  used_at              timestamptz,
  order_id             uuid,
  created_at           timestamptz not null default now()
);
create index approvals_org_idx on public.approvals (organization_id, created_at desc);

create or replace function public._member_has_permission(p_org uuid, p_user uuid, p_permission text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.memberships m
     where m.organization_id = p_org and m.user_id = p_user and m.is_active
       and public.role_permissions(m.role) && array['*', p_permission])
$$;

-- The largest discount (percent of the order) a member may give on their own.
-- Configurable per organisation in settings.discount_limits: {"cashier": 5, ...}
create or replace function public._discount_limit(p_org uuid, p_user uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select (o.settings->'discount_limits'->>m.role::text)::numeric
       from public.organizations o where o.id = p_org),
    case m.role when 'owner' then 100 when 'admin' then 100 when 'manager' then 50 else 0 end)
    from public.memberships m
   where m.organization_id = p_org and m.user_id = p_user and m.is_active
$$;

create or replace function public.set_my_pin(p_organization_id uuid, p_pin text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED', detail = 'not a member';
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'a PIN is 4 to 8 digits';
  end if;
  insert into public.staff_pins (organization_id, user_id, pin_hash)
  values (p_organization_id, auth.uid(), extensions.crypt(p_pin, extensions.gen_salt('bf', 8)))
  on conflict (organization_id, user_id) do update
     set pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = null, updated_at = now();
end $$;

-- A cashier asks a manager to approve something at the till. Returns (rather
-- than raises) on failure, so wrong-PIN attempts are recorded and can lock.
create or replace function public.request_override(
  p_organization_id uuid,
  p_approver_id     uuid,
  p_pin             text,
  p_purpose         text default 'discount') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pin public.staff_pins%rowtype;
  v_id  uuid;
  v_max numeric;
begin
  if not (public.has_permission(p_organization_id, 'pos.sell')
          or public.has_permission(p_organization_id, 'orders.manage')) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED', detail = 'pos.sell';
  end if;
  if p_approver_id = auth.uid() then
    return jsonb_build_object('approved', false, 'reason', 'self_approval');
  end if;
  if not public._member_has_permission(p_organization_id, p_approver_id, 'pos.override') then
    return jsonb_build_object('approved', false, 'reason', 'not_authorised');
  end if;

  select * into v_pin from public.staff_pins
   where organization_id = p_organization_id and user_id = p_approver_id
   for update;
  if not found then
    return jsonb_build_object('approved', false, 'reason', 'no_pin');
  end if;
  if v_pin.locked_until is not null and v_pin.locked_until > now() then
    return jsonb_build_object('approved', false, 'reason', 'locked', 'locked_until', v_pin.locked_until);
  end if;

  if p_pin is null or extensions.crypt(p_pin, v_pin.pin_hash) <> v_pin.pin_hash then
    update public.staff_pins
       set failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end,
           locked_until    = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' end
     where organization_id = p_organization_id and user_id = p_approver_id;
    return jsonb_build_object('approved', false, 'reason', 'wrong_pin',
                              'attempts_left', greatest(4 - v_pin.failed_attempts, 0));
  end if;

  update public.staff_pins set failed_attempts = 0, locked_until = null
   where organization_id = p_organization_id and user_id = p_approver_id;

  v_max := coalesce(public._discount_limit(p_organization_id, p_approver_id), 0);
  insert into public.approvals (organization_id, purpose, approver_id, requested_by, max_discount_percent, expires_at)
  values (p_organization_id, p_purpose, p_approver_id, auth.uid(), v_max, now() + interval '5 minutes')
  returning id into v_id;

  return jsonb_build_object('approved', true, 'approval_id', v_id, 'max_discount_percent', v_max);
end $$;

-- ---------------------------------------------------------------------------
-- Pricing: discounts and tax, written onto the order lines
-- ---------------------------------------------------------------------------

-- {"type": "percent", "value": 10} or {"type": "amount", "value": 500}
create or replace function public._discount_amount(p_discount jsonb, p_base numeric) returns numeric
language plpgsql immutable as $$
declare
  v_value numeric;
begin
  if p_discount is null or p_discount = 'null'::jsonb then
    return 0;
  end if;
  v_value := (p_discount->>'value')::numeric;
  if p_discount->>'type' = 'percent' and v_value > 0 and v_value <= 100 then
    return round(p_base * v_value / 100, 2);
  elsif p_discount->>'type' = 'amount' and v_value > 0 and v_value <= p_base then
    return round(v_value, 2);
  end if;
  raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
    detail = 'a discount is {type: percent, value: 0-100} or {type: amount, value <= the amount it applies to}';
end $$;

drop function public._order_input(uuid, jsonb);

-- As in 0006, plus an optional per-line discount.
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
  tracking_mode public.tracking_mode,
  discount      jsonb)
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
                 or (e ? 'serials' and jsonb_typeof(e->'serials') <> 'array')
                 or (e ? 'discount' and jsonb_typeof(e->'discount') not in ('object', 'null'))) then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
      detail = 'each line needs variant_id and quantity; serials must be a list; discount an object';
  end if;

  for r in
    with raw as (
      select (e->>'variant_id')::uuid                as variant_id,
             (e->>'quantity')::numeric               as quantity,
             nullif(btrim(e->>'lot_code'), '')       as lot_code,
             e->'serials'                            as serials,
             nullif(e->'discount', 'null'::jsonb)    as discount
        from jsonb_array_elements(p_lines) e),
    grouped as (
      select g.variant_id, g.lot_code, sum(g.quantity) as quantity,
             bool_or(g.serials is not null)          as has_serials,
             (select array_agg(btrim(s))
                from raw r2 cross join lateral jsonb_array_elements_text(r2.serials) s
               where r2.variant_id = g.variant_id
                 and r2.lot_code is not distinct from g.lot_code) as serials,
             count(distinct g.discount)              as discount_variants,
             (array_agg(g.discount) filter (where g.discount is not null))[1] as discount
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
    if r.discount_variants > 1 then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
        detail = format('%s appears twice with different discounts', r.name);
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
    discount      := r.discount;
    return next;
  end loop;
end $$;

-- Prices the lines and writes lines and order totals:
--   * manual line discounts, or failing those the best live promotion for the line
--     (percent / amount / buy-X-get-Y on its product, category or brand)
--   * a manual order discount, or failing that the best order-level promotion
--     (with its minimum spend), spread across lines in proportion
--   * tax per line on what is left
-- Gift cards are money, not goods: no discount or promotion of any kind touches
-- them, and they count toward no minimum spend.
-- A coupon code, if any, arrives in the transaction setting nwsc.coupon (set by
-- quote_order / checkout / pos_quote / pos_sale). An unknown or expired code is
-- refused. Promotions used are recorded in order_promotions and counted against
-- their usage limits (under a row lock, so two tills cannot overshoot).
-- Returns the MANUAL discount as a percentage of the undiscounted subtotal:
-- promotions never count against a cashier's discount limit.
create or replace function public._write_order_lines(
  p_org             uuid,
  p_order           uuid,
  p_lines           jsonb,
  p_order_discount  jsonb,
  p_allow_discounts boolean) returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_inclusive    boolean;
  v_channel      public.sales_channel;
  v_default_rate numeric;
  v_coupon       text := nullif(upper(btrim(coalesce(current_setting('nwsc.coupon', true), ''))), '');
  v_coupon_used  boolean := false;
  v_gross        numeric := 0;
  v_base         numeric := 0;   -- what order-level discounts apply to (gift cards left out)
  v_last         int := 0;       -- the last line that takes a share of the order discount
  v_gift         boolean[] := '{}';
  v_manual       numeric := 0;
  v_order_disc   numeric := 0;
  v_order_promo  uuid;
  v_alloc_left   numeric;
  v_count        int := 0;
  v_i            int := 0;
  v_sub          numeric;
  v_ldisc        numeric;
  v_promo        numeric;
  v_promo_id     uuid;
  v_net          numeric;
  v_alloc        numeric;
  v_rate         numeric;
  v_tax          numeric;
  v_total        numeric;
  v_disc_total   numeric := 0;
  v_promo_total  numeric := 0;
  v_tax_total    numeric := 0;
  v_grand        numeric := 0;
  v_used         jsonb := '{}'::jsonb;
  v_promo_ids    uuid[] := '{}';
  v_promos       numeric[] := '{}';
  r              record;
  pr             record;
begin
  select o.tax_inclusive, o.channel into v_inclusive, v_channel from public.orders o where o.id = p_order;
  select tr.rate_percent into v_default_rate from public.tax_rates tr
   where tr.organization_id = p_org and tr.is_default and tr.is_active;

  if not p_allow_discounts and (p_order_discount is not null
       or exists (select 1 from jsonb_array_elements(p_lines) e where nullif(e->'discount', 'null'::jsonb) is not null)) then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'discounts cannot be applied here';
  end if;
  if v_coupon is not null and not exists (select 1 from public._live_promotions(p_org, v_channel, v_coupon) lp where lp.coupon_code = v_coupon) then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'that code is not valid right now';
  end if;

  -- Pass 1: subtotal and what each line's discount (manual or promotion) leaves.
  for r in
    select i.*, p.id as product_id, p.category_id, p.brand_id, p.is_gift_card
      from public._order_input(p_org, p_lines) i
      join public.product_variants v on v.id = i.variant_id join public.products p on p.id = v.product_id
     order by i.variant_id, i.lot_code nulls first
  loop
    v_count := v_count + 1;
    if r.is_gift_card and r.discount is not null then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'a gift card cannot be discounted';
    end if;
    v_sub := round(r.quantity * r.unit_price, 2);
    v_ldisc := public._discount_amount(r.discount, v_sub);
    v_promo := 0; v_promo_id := null;
    if r.discount is null and not r.is_gift_card then
      select lp.id, least(case lp.kind
                when 'percent_off' then round(v_sub * lp.value / 100, 2)
                when 'amount_off'  then round(lp.value * r.quantity, 2)
                else floor(r.quantity / (lp.buy_quantity + lp.get_quantity)) * lp.get_quantity * r.unit_price end, v_sub)
        into v_promo_id, v_promo
        from public._live_promotions(p_org, v_channel, v_coupon) lp
       where lp.scope = 'products'
         and (cardinality(lp.product_ids) + cardinality(lp.category_ids) + cardinality(lp.brand_ids) = 0
              or r.product_id = any (lp.product_ids) or r.category_id = any (lp.category_ids) or r.brand_id = any (lp.brand_ids))
       order by 2 desc nulls last, lp.created_at
       limit 1;
      v_promo := coalesce(v_promo, 0);
      if v_promo = 0 then v_promo_id := null; end if;
    end if;
    v_promo_ids := v_promo_ids || v_promo_id;
    v_promos := v_promos || v_promo;
    v_gift := v_gift || r.is_gift_card;
    v_gross := v_gross + v_sub;
    v_manual := v_manual + v_ldisc;
    if not r.is_gift_card then
      v_base := v_base + v_sub - v_ldisc - v_promo;
      v_last := v_count;
    end if;
  end loop;

  -- Order-level: a manual discount wins; otherwise the best order promotion.
  if p_order_discount is not null then
    v_order_disc := public._discount_amount(p_order_discount, v_base);
    v_manual := v_manual + v_order_disc;
  else
    select lp.id, least(case lp.kind when 'percent_off' then round(v_base * lp.value / 100, 2) else lp.value end, v_base)
      into v_order_promo, v_order_disc
      from public._live_promotions(p_org, v_channel, v_coupon) lp
     where lp.scope = 'order' and v_base > 0 and v_base >= coalesce(lp.min_subtotal, 0)
     order by 2 desc, lp.created_at
     limit 1;
    v_order_disc := coalesce(v_order_disc, 0);
  end if;
  v_alloc_left := v_order_disc;

  -- Pass 2: write the lines.
  -- Same rows in the same order as pass 1 (_order_input sorts its output).
  for r in
    select i.*, p.tax_exempt, ptr.rate_percent as product_rate
      from public._order_input(p_org, p_lines) i
      join public.product_variants v on v.id = i.variant_id
      join public.products p on p.id = v.product_id
      left join public.tax_rates ptr on ptr.id = p.tax_rate_id and ptr.is_active
     order by i.variant_id, i.lot_code nulls first
  loop
    v_i := v_i + 1;
    v_promo_id := v_promo_ids[v_i];
    v_promo := v_promos[v_i];
    v_sub := round(r.quantity * r.unit_price, 2);
    v_ldisc := public._discount_amount(r.discount, v_sub) + v_promo;
    v_net := v_sub - v_ldisc;

    if v_gift[v_i] then
      v_alloc := 0;
    elsif v_i = v_last then
      v_alloc := least(v_alloc_left, v_net);
    elsif v_base > 0 then
      v_alloc := least(round(v_order_disc * v_net / v_base, 2), v_alloc_left, v_net);
    else
      v_alloc := 0;
    end if;
    v_alloc_left := v_alloc_left - v_alloc;
    v_net := v_net - v_alloc;

    v_rate := case when r.tax_exempt then 0 else coalesce(r.product_rate, v_default_rate, 0) end;
    if v_inclusive then
      v_tax := round(v_net - v_net / (1 + v_rate / 100), 2);
      v_total := v_net;
    else
      v_tax := round(v_net * v_rate / 100, 2);
      v_total := v_net + v_tax;
    end if;

    insert into public.order_lines
      (organization_id, order_id, variant_id, product_name, variant_title, sku, lot_code, quantity,
       unit_price, line_subtotal, discount_amount, promo_discount, tax_rate, tax_amount, line_total, position)
    values
      (p_org, p_order, r.variant_id, r.product_name, r.variant_title, r.sku, r.lot_code, r.quantity,
       r.unit_price, v_sub, v_ldisc + v_alloc, v_promo + case when v_order_promo is not null then v_alloc else 0 end,
       v_rate, v_tax, v_total, v_i);

    if v_promo_id is not null then
      v_used := jsonb_set(v_used, array[v_promo_id::text], to_jsonb(coalesce((v_used->>v_promo_id::text)::numeric, 0) + v_promo));
    end if;
    v_disc_total := v_disc_total + v_ldisc + v_alloc;
    v_promo_total := v_promo_total + v_promo + case when v_order_promo is not null then v_alloc else 0 end;
    v_tax_total := v_tax_total + v_tax;
    v_grand := v_grand + v_total;
  end loop;
  if v_order_promo is not null and v_order_disc > 0 then
    v_used := jsonb_set(v_used, array[v_order_promo::text], to_jsonb(coalesce((v_used->>v_order_promo::text)::numeric, 0) + v_order_disc));
  end if;

  -- Record and count the promotions used; a limit reached meanwhile refuses the order.
  for pr in select key::uuid as id, value::numeric as amount from jsonb_each_text(v_used) order by key loop
    update public.promotions set usage_count = usage_count + 1
     where id = pr.id and (usage_limit is null or usage_count < usage_limit);
    if not found then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'a promotion on this order has just run out - please try again';
    end if;
    insert into public.order_promotions (organization_id, order_id, promotion_id, amount) values (p_org, p_order, pr.id, pr.amount);
    if (select coupon_code from public.promotions where id = pr.id) = v_coupon then v_coupon_used := true; end if;
  end loop;

  update public.orders
     set subtotal = v_gross, discount_total = v_disc_total, tax_total = v_tax_total, total = v_grand,
         promo_discount_total = v_promo_total, coupon_code = case when v_coupon_used then v_coupon end
   where id = p_order;

  return case when v_gross > 0 then round(v_manual * 100 / v_gross, 2) else 0 end;
end $$;

-- ---------------------------------------------------------------------------
-- Payment bookkeeping
-- ---------------------------------------------------------------------------

-- Balance due is total - paid. A refund is money the shop gave back (goodwill,
-- a returned item, a cancelled order); it never puts the customer in debt.
create or replace function public._refresh_payment_status(p_order uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_paid     numeric;
  v_refunded numeric;
  v_total    numeric;
begin
  select coalesce(sum(p.amount) filter (where p.kind = 'payment'), 0),
         coalesce(sum(p.amount) filter (where p.kind = 'refund'), 0)
    into v_paid, v_refunded
    from public.payments p where p.order_id = p_order and p.status = 'captured';
  select o.total into v_total from public.orders o where o.id = p_order;

  update public.orders
     set amount_paid = v_paid,
         amount_refunded = v_refunded,
         payment_status = case
           when v_refunded > 0 and v_refunded >= v_paid then 'refunded'
           when v_refunded > 0 then 'partially_refunded'
           when v_paid >= v_total then 'paid'
           when v_paid > 0 then 'partially_paid'
           else 'unpaid' end::public.payment_state
   where id = p_order;
end $$;

-- Tenders at the counter: [{method, amount, reference?}]. Card, transfer, QR and
-- store credit may not exceed what is due; cash may, and the excess is change.
-- Returns the change to hand back.
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
           or coalesce(x->>'method', '') not in ('cash', 'card', 'bank_transfer', 'qr', 'store_credit')
           or coalesce((x->>'amount')::numeric, 0) <= 0) then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
      detail = 'payments are [{method: cash|card|bank_transfer|qr|store_credit, amount > 0}]';
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
-- Summary, now with money
-- ---------------------------------------------------------------------------
create or replace function public._order_summary(p_order uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'order_id', o.id, 'number', o.number, 'status', o.status, 'channel', o.channel,
    'location_id', o.location_id, 'customer_id', o.customer_id,
    'currency_code', o.currency_code, 'tax_inclusive', o.tax_inclusive,
    'subtotal', o.subtotal, 'discount_total', o.discount_total, 'tax_total', o.tax_total, 'total', o.total,
    'amount_paid', o.amount_paid, 'amount_refunded', o.amount_refunded,
    'balance_due', greatest(o.total - o.amount_paid, 0),
    'payment_status', o.payment_status,
    'reservation_expires_at', o.reservation_expires_at,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'line_id', ol.id, 'variant_id', ol.variant_id, 'name', ol.product_name,
               'variant', ol.variant_title, 'quantity', ol.quantity, 'unit_price', ol.unit_price,
               'line_subtotal', ol.line_subtotal, 'discount_amount', ol.discount_amount,
               'tax_rate', ol.tax_rate, 'tax_amount', ol.tax_amount, 'line_total', ol.line_total,
               'serials', (select jsonb_agg(su.serial order by su.serial)
                             from public.order_line_units u
                             join public.serial_units su on su.id = u.serial_unit_id
                            where u.order_line_id = ol.id))
             order by ol.position)
        from public.order_lines ol where ol.order_id = o.id), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'payment_id', p.id, 'kind', p.kind, 'method', p.method, 'status', p.status,
               'amount', p.amount, 'tendered', p.tendered, 'change_given', p.change_given,
               'provider', p.provider, 'reference', p.provider_reference, 'at', p.created_at)
             order by p.created_at, p.id)
        from public.payments p where p.order_id = o.id), '[]'::jsonb))
  from public.orders o where o.id = p_order
$$;

-- ---------------------------------------------------------------------------
-- place_order, now with discounts, approvals and payment
-- ---------------------------------------------------------------------------
drop function public.place_order(uuid, public.sales_channel, jsonb, uuid, text, text);

create or replace function public.place_order(
  p_location_id     uuid,
  p_channel         public.sales_channel,
  p_lines           jsonb,
  p_customer_id     uuid default null,
  p_idempotency_key text default null,
  p_note            text default null,
  p_payments        jsonb default null,
  p_order_discount  jsonb default null,
  p_approval_id     uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_org        uuid;
  v_currency   char(3);
  v_inclusive  boolean;
  v_order      uuid;
  v_units      uuid[];
  v_pct        numeric;
  v_limit      numeric;
  v_approved   numeric;
  v_change     numeric;
  v_constraint text;
  r            record;
begin
  select l.organization_id, o.currency_code, o.prices_include_tax into v_org, v_currency, v_inclusive
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
    -- Counter sales are rung up on an open till shift so every rupee of cash is
    -- accounted for. pos_sale() marks its transaction; API clients cannot set
    -- this (set_config is not exposed), so they cannot skip the shift.
    if coalesce(current_setting('nwsc.pos_shift', true), '') = '' then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
        detail = 'counter sales are rung up on an open till shift (pos_sale)';
    end if;
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
       tax_inclusive, idempotency_key, note, confirmed_at)
    values
      (v_org, public.next_document_number(v_org, 'order', 'ORD-'), p_channel, p_location_id,
       p_customer_id, 'confirmed', v_currency, v_inclusive, p_idempotency_key, p_note, now())
    returning id into v_order;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if not public._is_idempotency_clash(v_constraint) then
      raise;
    end if;
    select o.id into v_order from public.orders o
     where o.organization_id = v_org and o.idempotency_key = p_idempotency_key;
    return public._order_summary(v_order) || '{"replayed": true}'::jsonb;
  end;

  v_pct := public._write_order_lines(v_org, v_order, p_lines, p_order_discount, true);

  -- A discount beyond the seller's own limit needs a manager's fresh approval.
  if v_pct > 0 and not public.is_platform_admin() then
    v_limit := coalesce(public._discount_limit(v_org, auth.uid()), 0);
    if v_pct > v_limit then
      update public.approvals a
         set used_at = now(), order_id = v_order
       where a.id = p_approval_id and a.organization_id = v_org and a.requested_by = auth.uid()
         and a.used_at is null and a.expires_at > now()
         and public._member_has_permission(v_org, a.approver_id, 'pos.override')
      returning a.max_discount_percent into v_approved;
      if v_approved is null or v_approved < v_pct then
        raise exception using errcode = 'NC008', message = 'APPROVAL_REQUIRED',
          detail = json_build_object('discount_percent', v_pct, 'your_limit', v_limit,
                                     'approved_up_to', v_approved)::text;
      end if;
    end if;
  end if;

  for r in
    select ol.id as line_id, ol.variant_id, ol.lot_code, ol.quantity, i.serials, i.tracking_mode, i.product_name
      from public.order_lines ol
      join public._order_input(v_org, p_lines) i
        on i.variant_id = ol.variant_id and i.lot_code is not distinct from ol.lot_code
     where ol.order_id = v_order
     order by ol.variant_id, ol.lot_code nulls first
  loop
    if p_channel = 'pos' and r.tracking_mode = 'serial' and r.serials is null then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
        detail = format('scan the serial number of each %s sold at the counter', r.product_name);
    end if;
    v_units := public._issue_line(v_org, p_location_id, r.variant_id, r.quantity, 'sale',
                                  'order', v_order, r.serials, r.lot_code);
    if coalesce(cardinality(v_units), 0) > 0 then
      insert into public.order_line_units (organization_id, order_line_id, serial_unit_id)
      select v_org, r.line_id, u from unnest(v_units) u;
    end if;
  end loop;

  -- The counter is paid in full before the customer leaves; phone and admin
  -- orders may be paid later (cash on delivery, invoice).
  v_change := public._take_payments(v_org, v_order, p_payments, p_channel = 'pos');
  perform public._after_confirm(v_order);  -- gift cards issued, points earned (0014)

  return public._order_summary(v_order) || jsonb_build_object('change_due', v_change);
end $$;

-- ---------------------------------------------------------------------------
-- start_checkout, now priced with tax (no manual discounts online)
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
  v_inclusive  boolean;
  v_settings   jsonb;
  v_customer   uuid;
  v_hold       int;
  v_max        numeric;
  v_expires    timestamptz;
  v_order      uuid;
  v_done       boolean := false;
  v_detail     text;
  v_constraint text;
  v_loc        record;
  r            record;
begin
  select o.currency_code, o.settings, o.prices_include_tax into v_currency, v_settings, v_inclusive
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

  for v_loc in
    select l.id from public.locations l
     where l.organization_id = p_organization_id and l.is_active and l.sells_online
     order by l.fulfilment_priority, l.code
  loop
    begin
      insert into public.orders
        (organization_id, number, channel, location_id, customer_id, status, currency_code,
         tax_inclusive, idempotency_key, reservation_expires_at, note)
      values
        (p_organization_id, public.next_document_number(p_organization_id, 'order', 'ORD-'), p_channel,
         v_loc.id, v_customer, 'pending_payment', v_currency, v_inclusive, p_idempotency_key, v_expires, p_note)
      returning id into v_order;

      perform public._write_order_lines(p_organization_id, v_order, p_lines, null, false);

      for r in
        select ol.variant_id, sum(ol.quantity) as quantity
          from public.order_lines ol where ol.order_id = v_order
         group by ol.variant_id order by ol.variant_id
      loop
        perform public._reserve_line(p_organization_id, v_loc.id, r.variant_id, r.quantity,
                                     'order', v_order, v_expires);
      end loop;

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
-- confirm_order split into a permission wrapper and the internal step, so
-- payment functions can confirm an order they have just seen paid.
-- ---------------------------------------------------------------------------
create or replace function public._confirm_order(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o public.orders%rowtype;
  r record;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'order';
  end if;

  if o.status in ('confirmed', 'completed') then
    return public._order_summary(o.id) || '{"replayed": true}'::jsonb;
  elsif o.status = 'cancelled' then
    raise exception using errcode = 'NC006', message = 'INVALID_STATE', detail = 'order was cancelled';
  end if;

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
  perform public._after_confirm(o.id);  -- gift cards issued, points earned (0014)
  return public._order_summary(o.id);
end $$;

create or replace function public.confirm_order(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.orders where id = p_order_id;
  if v_org is null then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'order';
  end if;
  perform public.assert_permission(v_org, 'orders.manage');
  return public._confirm_order(p_order_id);
end $$;

-- ---------------------------------------------------------------------------
-- record_payment: staff take money against an existing order - cash on
-- delivery collected, a bank transfer seen in the account, a pay-later order
-- settled at the counter. A fully paid online order is confirmed.
-- ---------------------------------------------------------------------------
create or replace function public.record_payment(
  p_order_id  uuid,
  p_method    public.payment_method,
  p_amount    numeric,
  p_reference text default null,
  p_note      text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o     public.orders%rowtype;
  v_due numeric;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'order';
  end if;
  if not (public.has_permission(o.organization_id, 'orders.manage')
          or (public.has_permission(o.organization_id, 'pos.sell')
              and public.has_location_access(o.organization_id, o.location_id))) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED', detail = 'orders.manage';
  end if;
  if o.status in ('cancelled', 'expired') then
    raise exception using errcode = 'NC006', message = 'INVALID_STATE', detail = format('order is %s', o.status);
  end if;
  if p_method = 'online_gateway' then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
      detail = 'gateway payments arrive through record_gateway_payment';
  end if;

  v_due := o.total - o.amount_paid;
  if p_amount is null or p_amount <= 0 or p_amount > v_due then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
      detail = json_build_object('due', v_due, 'amount', p_amount)::text;
  end if;

  if p_method = 'store_credit' then
    if o.customer_id is null then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'store credit needs a customer';
    end if;
    insert into public.store_credit_ledger (organization_id, customer_id, amount, reason, source_type, source_id)
    values (o.organization_id, o.customer_id, -p_amount, 'Spent on order ' || o.number, 'order', o.id);
  end if;

  insert into public.payments (organization_id, order_id, method, amount, provider_reference, note, captured_at)
  values (o.organization_id, o.id, p_method, p_amount, p_reference, p_note, now());
  perform public._refresh_payment_status(o.id);

  if o.status in ('pending_payment', 'stock_conflict')
     and (select amount_paid >= total from public.orders where id = o.id) then
    return public._confirm_order(o.id);
  end if;
  return public._order_summary(o.id);
end $$;

-- ---------------------------------------------------------------------------
-- record_gateway_payment: the payment gateway webhook (service role only).
-- The same (provider, reference) is recorded once however often it arrives.
-- ---------------------------------------------------------------------------
create or replace function public.record_gateway_payment(
  p_order_id  uuid,
  p_provider  text,
  p_reference text,
  p_amount    numeric,
  p_status    public.payment_status default 'captured',
  p_payload   jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o public.orders%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED', detail = 'payment webhooks only';
  end if;
  if p_provider is null or p_reference is null or p_amount is null or p_amount <= 0
     or p_status not in ('captured', 'failed') then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
      detail = 'provider, reference, a positive amount and status captured|failed are required';
  end if;

  -- The order row lock serialises duplicate deliveries of the same webhook.
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'order';
  end if;

  if exists (select 1 from public.payments p
              where p.organization_id = o.organization_id and p.provider = p_provider
                and p.kind = 'payment' and p.provider_reference = p_reference) then
    return public._order_summary(o.id) || '{"replayed": true}'::jsonb;
  end if;

  insert into public.payments
    (organization_id, order_id, method, status, amount, provider, provider_reference, payload, captured_at)
  values
    (o.organization_id, o.id, 'online_gateway', p_status, p_amount, p_provider, p_reference, coalesce(p_payload, '{}'),
     case when p_status = 'captured' then now() end);
  perform public._refresh_payment_status(o.id);

  if p_status = 'captured' and o.status in ('pending_payment', 'expired', 'stock_conflict')
     and (select amount_paid >= total from public.orders where id = o.id) then
    return public._confirm_order(o.id);
  end if;
  return public._order_summary(o.id);
end $$;

-- ---------------------------------------------------------------------------
-- refund_payment: money back. Stock is not touched here - putting goods back
-- on the shelf is the returns module's job.
-- ---------------------------------------------------------------------------
create or replace function public.refund_payment(
  p_order_id  uuid,
  p_amount    numeric,
  p_method    public.payment_method,
  p_reason    text,
  p_reference text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o            public.orders%rowtype;
  v_refundable numeric;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'order';
  end if;
  perform public.assert_permission(o.organization_id, 'orders.manage');

  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'say why the money is going back';
  end if;
  v_refundable := o.amount_paid - o.amount_refunded;
  if p_amount is null or p_amount <= 0 or p_amount > v_refundable then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
      detail = json_build_object('refundable', v_refundable, 'amount', p_amount)::text;
  end if;

  if p_method = 'store_credit' then
    if o.customer_id is null then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'store credit needs a customer';
    end if;
    insert into public.store_credit_ledger (organization_id, customer_id, amount, reason, source_type, source_id)
    values (o.organization_id, o.customer_id, p_amount, 'Refund on order ' || o.number || ': ' || p_reason, 'order', o.id);
  end if;

  insert into public.payments
    (organization_id, order_id, kind, method, amount, provider_reference, note, captured_at)
  values
    (o.organization_id, o.id, 'refund', p_method, p_amount, p_reference, p_reason, now());
  perform public._refresh_payment_status(o.id);
  return public._order_summary(o.id);
end $$;

-- ---------------------------------------------------------------------------
-- adjust_store_credit: goodwill credit or a correction, always with a reason
-- ---------------------------------------------------------------------------
create or replace function public.adjust_store_credit(
  p_customer_id uuid,
  p_amount      numeric,
  p_reason      text) returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.customers where id = p_customer_id;
  if v_org is null then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'customer';
  end if;
  perform public.assert_permission(v_org, 'orders.manage');
  if p_amount is null or p_amount = 0 or p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'a non-zero amount and a reason are required';
  end if;
  insert into public.store_credit_ledger (organization_id, customer_id, amount, reason, source_type)
  values (v_org, p_customer_id, p_amount, p_reason, 'adjustment');
  return (select store_credit_balance from public.customers where id = p_customer_id);
end $$;

-- ---------------------------------------------------------------------------
-- Security for everything above
-- ---------------------------------------------------------------------------
alter table public.tax_rates enable row level security;
alter table public.payments enable row level security;
alter table public.store_credit_ledger enable row level security;
alter table public.staff_pins enable row level security;
alter table public.approvals enable row level security;

grant select on public.tax_rates to anon, authenticated;
grant insert, update on public.tax_rates to authenticated;
grant select on public.payments, public.store_credit_ledger, public.approvals to authenticated;
grant all on public.tax_rates, public.payments, public.store_credit_ledger, public.staff_pins, public.approvals to service_role;
revoke all on public.payments, public.store_credit_ledger, public.staff_pins, public.approvals from anon;
revoke insert, update, delete, truncate on public.payments, public.store_credit_ledger, public.approvals from authenticated;
revoke all on public.staff_pins from authenticated;

-- RLS decides which customer rows staff may edit, not which columns. Staff edit
-- contact details only: the store credit balance moves solely through its
-- ledger, and linking a login to a customer record is not a till operation.
revoke insert, update on public.customers from authenticated;
grant insert (organization_id, full_name, phone, email, notes, marketing_consent) on public.customers to authenticated;
grant update (full_name, phone, email, notes, marketing_consent) on public.customers to authenticated;

create policy tax_rates_read on public.tax_rates for select using (is_active or public.is_member(organization_id));
create policy tax_rates_insert on public.tax_rates for insert
  with check (public.has_permission(organization_id, 'settings.manage'));
create policy tax_rates_update on public.tax_rates for update
  using (public.has_permission(organization_id, 'settings.manage'))
  with check (public.has_permission(organization_id, 'settings.manage'));

create policy payments_read on public.payments for select
  using (public.has_permission(organization_id, 'orders.view') or public.owns_order(order_id));
create policy store_credit_ledger_read on public.store_credit_ledger for select
  using (public.has_permission(organization_id, 'customers.view') or exists (
    select 1 from public.customers c where c.id = customer_id and c.auth_user_id = auth.uid()));
create policy approvals_read on public.approvals for select
  using (public.has_permission(organization_id, 'audit.view'));
-- staff_pins: no policy, no API access at all.

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

grant execute on function
  public.is_platform_admin(), public.role_permissions(public.staff_role), public.is_member(uuid),
  public.has_permission(uuid, text), public.has_location_access(uuid, uuid),
  public.module_enabled(uuid, public.module_key), public.owns_order(uuid)
  to anon, authenticated;

grant execute on function
  public.storefront_organization(text),
  public.storefront_availability(uuid, uuid[]),
  public.start_checkout(uuid, jsonb, text, public.sales_channel, uuid, text)
  to anon, authenticated;

grant execute on function
  public.cancel_order(uuid, text),
  public.place_order(uuid, public.sales_channel, jsonb, uuid, text, text, jsonb, jsonb, uuid),
  public.confirm_order(uuid),
  public.receive_stock(uuid, jsonb, text, text),
  public.adjust_stock(uuid, uuid, numeric, public.movement_type, text, text[], text, date, numeric),
  public.lookup_serial(uuid, text),
  public.inventory_integrity_report(uuid),
  public.upsert_staff_member(uuid, uuid, public.staff_role, uuid[], boolean),
  public.set_my_pin(uuid, text),
  public.request_override(uuid, uuid, text, text),
  public.record_payment(uuid, public.payment_method, numeric, text, text),
  public.refund_payment(uuid, numeric, public.payment_method, text, text),
  public.adjust_store_credit(uuid, numeric, text)
  to authenticated;

-- record_gateway_payment: service_role only (granted above).
