-- 0010_storefront.sql
-- Phase 4: what the online store (and later the app) needs.
--   * orders learn how they reach the customer: delivery / pickup, contact, fee
--   * a server-side cart keyed by a secret token (the app will share it)
--   * catalogue listing with facets, product page, category tree
--   * quote_order: prices a basket with exactly the code checkout uses
--   * checkout: contact + fulfilment + payment method on top of start_checkout
--   * order lookup for guests by a private token; customer profiles for sign-ups

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- Orders: fulfilment, contact, delivery fee, private access token
-- ---------------------------------------------------------------------------
create type public.fulfilment_method as enum ('in_store', 'pickup', 'delivery');

alter table public.orders
  add column fulfilment_method       public.fulfilment_method not null default 'in_store',
  add column contact                 jsonb not null default '{}'::jsonb,
  add column shipping_address        jsonb,
  add column shipping_total          numeric(14,2) not null default 0 check (shipping_total >= 0),
  add column intended_payment_method public.payment_method,
  -- Lets a guest open their own order page without an account.
  add column access_token            text not null default encode(extensions.gen_random_bytes(18), 'hex'),
  drop constraint orders_totals_valid,
  add constraint orders_totals_valid check (
    total = subtotal - discount_total + case when tax_inclusive then 0 else tax_total end + shipping_total
    and subtotal >= 0 and discount_total >= 0 and tax_total >= 0 and total >= 0);

-- ---------------------------------------------------------------------------
-- Carts
-- ---------------------------------------------------------------------------
create table public.carts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- sha256 of the browser's / app's secret token; the token itself is never stored.
  token_hash      text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, token_hash)
);

create table public.cart_items (
  cart_id         uuid not null references public.carts(id) on delete cascade,
  organization_id uuid not null,
  variant_id      uuid not null,
  quantity        numeric(14,3) not null check (quantity > 0),
  added_at        timestamptz not null default now(),
  primary key (cart_id, variant_id),
  foreign key (organization_id, variant_id) references public.product_variants (organization_id, id) on delete cascade
);

alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
revoke all on public.carts, public.cart_items from anon, authenticated;
grant all on public.carts, public.cart_items to service_role;
-- No policies: carts are reached only through the cart_* functions, by token.

create or replace function public._cart_id(p_org uuid, p_token text, p_create boolean) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_hash text;
  v_id   uuid;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'a cart token of at least 32 characters is required';
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  select id into v_id from public.carts where organization_id = p_org and token_hash = v_hash;
  if v_id is null and p_create then
    insert into public.carts (organization_id, token_hash) values (p_org, v_hash)
    on conflict (organization_id, token_hash) do update set updated_at = now()
    returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.cart_get(p_organization_id uuid, p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_cart uuid := public._cart_id(p_organization_id, p_token, false);
begin
  if v_cart is null then
    return jsonb_build_object('items', '[]'::jsonb, 'count', 0, 'subtotal', 0);
  end if;
  return (
    with lines as (
      select ci.variant_id, ci.quantity, v.title, v.sku, v.price, v.compare_at_price,
             p.name, p.slug, p.unit_of_measure, p.allow_fractional,
             (v.is_active and p.status = 'active') as for_sale,
             coalesce(a.available, 0) as available,
             (select m.storage_path from public.product_media m where m.product_id = p.id
               order by (m.variant_id = v.id) desc nulls last, m.position limit 1) as image,
             ci.added_at
        from public.cart_items ci
        join public.product_variants v on v.id = ci.variant_id
        join public.products p on p.id = v.product_id
        left join public.storefront_availability(p_organization_id,
                    array(select variant_id from public.cart_items where cart_id = v_cart)) a on a.variant_id = ci.variant_id
       where ci.cart_id = v_cart)
    select jsonb_build_object(
      'items', coalesce(jsonb_agg(jsonb_build_object(
                 'variant_id', l.variant_id, 'quantity', l.quantity, 'name', l.name, 'slug', l.slug,
                 'variant', l.title, 'sku', l.sku, 'unit_price', l.price, 'compare_at_price', l.compare_at_price,
                 'unit_of_measure', l.unit_of_measure, 'allow_fractional', l.allow_fractional,
                 'line_total', round(l.quantity * l.price, 2), 'available', l.available,
                 'for_sale', l.for_sale, 'image', l.image) order by l.added_at), '[]'::jsonb),
      'count', coalesce(sum(case when l.allow_fractional then 1 else l.quantity end), 0),
      'subtotal', coalesce(sum(round(l.quantity * l.price, 2)) filter (where l.for_sale), 0))
      from lines l);
end $$;

-- Sets a line's quantity (0 removes it) and returns the cart.
create or replace function public.cart_set_item(
  p_organization_id uuid, p_token text, p_variant_id uuid, p_quantity numeric) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cart uuid;
  v_frac boolean;
  v_max  numeric;
begin
  perform public.assert_module(p_organization_id, 'storefront');
  select p.allow_fractional into v_frac
    from public.product_variants v join public.products p on p.id = v.product_id
   where v.id = p_variant_id and v.organization_id = p_organization_id and v.is_active and p.status = 'active';
  if not found then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'this item is not for sale';
  end if;
  if p_quantity is null or p_quantity < 0 or (not v_frac and p_quantity <> trunc(p_quantity)) then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'quantity must be zero or more, in whole units for this item';
  end if;
  select coalesce((settings->>'checkout_max_line_quantity')::numeric, 20) into v_max
    from public.organizations where id = p_organization_id;
  if p_quantity > v_max then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = format('at most %s of one item per order', v_max);
  end if;

  v_cart := public._cart_id(p_organization_id, p_token, true);
  if p_quantity = 0 then
    delete from public.cart_items where cart_id = v_cart and variant_id = p_variant_id;
  else
    insert into public.cart_items (cart_id, organization_id, variant_id, quantity)
    values (v_cart, p_organization_id, p_variant_id, p_quantity)
    on conflict (cart_id, variant_id) do update set quantity = excluded.quantity;
  end if;
  update public.carts set updated_at = now() where id = v_cart;
  return public.cart_get(p_organization_id, p_token);
end $$;

create or replace function public.cart_clear(p_organization_id uuid, p_token text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cart uuid := public._cart_id(p_organization_id, p_token, false);
begin
  if v_cart is not null then
    delete from public.cart_items where cart_id = v_cart;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Delivery fee
-- ---------------------------------------------------------------------------
-- settings.delivery_fee (default 0) and settings.free_delivery_over (optional),
-- judged on what the goods cost after discounts, including tax.
create or replace function public._apply_fulfilment(p_order uuid, p_method public.fulfilment_method) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_settings jsonb;
  v_goods    numeric;
  v_fee      numeric := 0;
begin
  select o.settings, ord.total into v_settings, v_goods
    from public.orders ord join public.organizations o on o.id = ord.organization_id
   where ord.id = p_order;
  if p_method = 'delivery' then
    v_fee := coalesce((v_settings->>'delivery_fee')::numeric, 0);
    if (v_settings->>'free_delivery_over') is not null and v_goods >= (v_settings->>'free_delivery_over')::numeric then
      v_fee := 0;
    end if;
  end if;
  update public.orders
     set fulfilment_method = p_method,
         total = total - shipping_total + v_fee,
         shipping_total = v_fee
   where id = p_order;
end $$;

-- ---------------------------------------------------------------------------
-- Summary gains fulfilment and contact
-- ---------------------------------------------------------------------------
create or replace function public._order_summary(p_order uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'order_id', o.id, 'number', o.number, 'status', o.status, 'channel', o.channel,
    'location_id', o.location_id, 'customer_id', o.customer_id,
    'currency_code', o.currency_code, 'tax_inclusive', o.tax_inclusive,
    'subtotal', o.subtotal, 'discount_total', o.discount_total, 'tax_total', o.tax_total,
    'shipping_total', o.shipping_total, 'total', o.total,
    'amount_paid', o.amount_paid, 'amount_refunded', o.amount_refunded,
    'balance_due', greatest(o.total - o.amount_paid, 0),
    'payment_status', o.payment_status,
    'fulfilment_method', o.fulfilment_method, 'contact', o.contact, 'shipping_address', o.shipping_address,
    'intended_payment_method', o.intended_payment_method,
    'reservation_expires_at', o.reservation_expires_at, 'placed_at', o.placed_at,
    'coupon_code', o.coupon_code, 'promo_discount_total', o.promo_discount_total,
    'promotions', coalesce((select jsonb_agg(jsonb_build_object('name', pm.name, 'amount', op.amount) order by op.amount desc)
                             from public.order_promotions op join public.promotions pm on pm.id = op.promotion_id
                            where op.order_id = o.id), '[]'::jsonb),
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
-- quote_order: price a basket exactly as checkout will, without keeping anything
-- ---------------------------------------------------------------------------
-- A draft order is written with the real pricing code, summarised, and rolled
-- back. The quote can never drift from what checkout charges.
create or replace function public.quote_order(
  p_organization_id uuid, p_lines jsonb, p_fulfilment_method public.fulfilment_method default 'delivery',
  p_coupon text default null, p_channel public.sales_channel default 'online')
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_loc     uuid;
  v_order   uuid;
  v_result  jsonb;
  v_org     public.organizations%rowtype;
begin
  -- Priced as the channel will sell it, so channel-only promotions show.
  if p_channel = 'online' then
    perform public.assert_module(p_organization_id, 'storefront');
  elsif p_channel = 'mobile_app' then
    perform public.assert_module(p_organization_id, 'mobile_app');
  else
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'quotes are for the online store or the app';
  end if;
  perform set_config('nwsc.coupon', coalesce(p_coupon, ''), true);
  select * into v_org from public.organizations where id = p_organization_id;
  select l.id into v_loc from public.locations l
   where l.organization_id = p_organization_id and l.is_active and l.sells_online
   order by l.fulfilment_priority, l.code limit 1;
  if v_loc is null then
    raise exception using errcode = 'NC006', message = 'INVALID_STATE', detail = 'no location fulfils online orders';
  end if;

  begin
    insert into public.orders (organization_id, number, channel, location_id, status, currency_code, tax_inclusive)
    values (p_organization_id, 'QUOTE-' || gen_random_uuid(), p_channel, v_loc, 'pending_payment',
            v_org.currency_code, v_org.prices_include_tax)
    returning id into v_order;
    perform public._write_order_lines(p_organization_id, v_order, p_lines, null, false);
    perform public._apply_fulfilment(v_order, p_fulfilment_method);
    v_result := public._order_summary(v_order);
    raise exception using errcode = 'NCQ00', message = 'QUOTE_ROLLBACK';
  exception when sqlstate 'NCQ00' then
    null;  -- the draft is gone; v_result survives
  end;

  return v_result - 'order_id' - 'number' - 'status' - 'location_id' - 'customer_id' - 'payments'
                  - 'amount_paid' - 'amount_refunded' - 'payment_status' - 'reservation_expires_at'
                  - 'placed_at' - 'contact' - 'shipping_address' - 'intended_payment_method';
end $$;

-- ---------------------------------------------------------------------------
-- Customer profiles for people who sign up online
-- ---------------------------------------------------------------------------
-- Creates (or updates the name on) the signed-in user's customer record. A phone
-- number already used by another customer - say, one created at the counter - is
-- not attached: linking an online login to someone's in-store history needs a
-- verified number, which comes with SMS verification.
create or replace function public.ensure_customer_profile(
  p_organization_id uuid, p_full_name text default null, p_phone text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id    uuid;
  v_email text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED', detail = 'sign in first';
  end if;
  if p_phone is not null and p_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'phone must be in international form, e.g. +94771234567';
  end if;
  select email into v_email from auth.users where id = auth.uid();

  select id into v_id from public.customers where organization_id = p_organization_id and auth_user_id = auth.uid();
  if v_id is null then
    insert into public.customers (organization_id, auth_user_id, full_name, email, phone)
    values (p_organization_id, auth.uid(), nullif(btrim(p_full_name), ''),
            case when not exists (select 1 from public.customers c
                                   where c.organization_id = p_organization_id and lower(c.email) = lower(v_email))
                 then v_email end,
            case when p_phone is not null and not exists (select 1 from public.customers c
                                   where c.organization_id = p_organization_id and c.phone = p_phone)
                 then p_phone end)
    returning id into v_id;
  elsif nullif(btrim(p_full_name), '') is not null then
    update public.customers set full_name = btrim(p_full_name) where id = v_id;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- checkout: the storefront's order command
-- ---------------------------------------------------------------------------
-- p_contact    = {full_name, phone (+94...), email?}
-- p_fulfilment = {method: delivery|pickup, address?: {line1, line2?, city, postcode?}}
-- p_payment_method:
--   cash_on_delivery  (pay on delivery / at pickup) -> confirmed now, stock leaves
--   bank_transfer     -> held for settings.bank_transfer_hold_hours (default 24) until staff record it
--   online_gateway    -> held for the normal checkout window until the gateway webhook confirms
create or replace function public.checkout(
  p_organization_id uuid,
  p_lines           jsonb,
  p_idempotency_key text,
  p_contact         jsonb,
  p_fulfilment      jsonb,
  p_payment_method  public.payment_method,
  p_channel         public.sales_channel default 'online',
  p_note            text default null,
  p_coupon          text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_settings jsonb;
  v_method   public.fulfilment_method;
  v_summary  jsonb;
  v_order    uuid;
  v_customer uuid;
  v_until    timestamptz;
  v_address  jsonb;
begin
  select settings into v_settings from public.organizations where id = p_organization_id;
  if not found then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'organization';
  end if;

  -- contact
  if coalesce(btrim(p_contact->>'full_name'), '') = '' then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'please give your name';
  end if;
  if coalesce(p_contact->>'phone', '') !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'please give a phone number we can reach you on';
  end if;
  if coalesce(p_contact->>'email', '') <> '' and p_contact->>'email' !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'that email address does not look right';
  end if;

  -- fulfilment
  v_method := case p_fulfilment->>'method' when 'delivery' then 'delivery' when 'pickup' then 'pickup' end::public.fulfilment_method;
  if v_method is null then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'choose delivery or pickup';
  end if;
  if v_method = 'delivery' then
    if not coalesce((v_settings->>'delivery_enabled')::boolean, true) then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'this store does not deliver';
    end if;
    v_address := p_fulfilment->'address';
    if coalesce(btrim(v_address->>'line1'), '') = '' or coalesce(btrim(v_address->>'city'), '') = '' then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'a delivery address needs a street and a city';
    end if;
  elsif not coalesce((v_settings->>'pickup_enabled')::boolean, true) then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'this store does not offer pickup';
  end if;

  -- payment method
  if p_payment_method = 'cash_on_delivery' and not coalesce((v_settings->>'allow_cash_on_delivery')::boolean, true)
     or p_payment_method = 'bank_transfer' and coalesce(v_settings->>'bank_transfer_details', '') = ''
     or p_payment_method = 'online_gateway' and not coalesce((v_settings->>'online_payments_enabled')::boolean, false)
     or p_payment_method not in ('cash_on_delivery', 'bank_transfer', 'online_gateway') then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'that payment method is not available';
  end if;

  perform set_config('nwsc.coupon', coalesce(p_coupon, ''), true);
  v_summary := public.start_checkout(p_organization_id, p_lines, p_idempotency_key, p_channel, null, p_note);
  v_order := (v_summary->>'order_id')::uuid;
  if v_summary ? 'replayed' then
    return public._order_summary(v_order)
           || jsonb_build_object('access_token', (select access_token from public.orders where id = v_order), 'replayed', true);
  end if;

  -- A signed-in shopper gets (or keeps) their customer record.
  v_customer := (v_summary->>'customer_id')::uuid;
  if v_customer is null and auth.uid() is not null and auth.role() = 'authenticated' then
    v_customer := public.ensure_customer_profile(p_organization_id, p_contact->>'full_name', p_contact->>'phone');
  end if;

  update public.orders
     set customer_id = v_customer,
         contact = jsonb_strip_nulls(jsonb_build_object(
           'full_name', btrim(p_contact->>'full_name'), 'phone', p_contact->>'phone',
           'email', nullif(btrim(coalesce(p_contact->>'email', '')), ''))),
         shipping_address = case when v_method = 'delivery' then v_address end,
         intended_payment_method = p_payment_method
   where id = v_order;
  perform public._apply_fulfilment(v_order, v_method);

  if p_payment_method = 'bank_transfer' then
    v_until := now() + make_interval(hours => least(greatest(coalesce((v_settings->>'bank_transfer_hold_hours')::int, 24), 1), 168));
    update public.orders set reservation_expires_at = v_until where id = v_order;
    update public.stock_reservations set expires_at = v_until
     where source_type = 'order' and source_id = v_order and status = 'active';
  elsif p_payment_method = 'cash_on_delivery' then
    perform public._confirm_order(v_order);
  end if;

  return public._order_summary(v_order)
         || jsonb_build_object('access_token', (select access_token from public.orders where id = v_order));
end $$;

-- The order page for a guest: the id plus the private token from checkout.
create or replace function public.get_order_by_token(p_order_id uuid, p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_token text;
begin
  select access_token into v_token from public.orders where id = p_order_id;
  if v_token is null or p_token is null or v_token <> p_token then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'order';
  end if;
  -- The link is the buyer's proof, so it also carries any gift cards they bought
  -- (issued once the order is paid) and the points it earned.
  return public._order_summary(p_order_id) || jsonb_build_object(
    'gift_cards', coalesce((select jsonb_agg(jsonb_build_object('code', g.code, 'value', g.initial_value, 'balance', g.balance) order by g.created_at)
                              from public.gift_cards g join public.order_lines ol on ol.id = g.order_line_id
                             where ol.order_id = p_order_id), '[]'::jsonb),
    'points_earned', (select points from public.loyalty_ledger where source_type = 'order_earned' and source_id = p_order_id));
end $$;

-- ---------------------------------------------------------------------------
-- Catalogue read models
-- ---------------------------------------------------------------------------
create or replace function public.storefront_categories(p_organization_id uuid)
returns table (id uuid, parent_id uuid, name text, slug text, sort_order int, product_count bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, c.parent_id, c.name, c.slug, c.position,
         (select count(*) from public.products p where p.category_id = c.id and p.status = 'active')
    from public.categories c
   where c.organization_id = p_organization_id and c.is_active
   order by c.position, c.name
$$;

-- Listing with facets. Facets are counted over the whole scope (category +
-- search), before brand/price/spec filters, so every option stays visible.
-- p_filters = {"brands": ["slug", ...], "min_price": n, "max_price": n,
--              "in_stock": true, "attributes": {"<attribute_id>": ["value", ...]}}
-- p_sort = relevance | newest | price_asc | price_desc | name
create or replace function public.storefront_catalog(
  p_organization_id uuid,
  p_category_slug   text default null,
  p_query           text default null,
  p_filters         jsonb default '{}'::jsonb,
  p_sort            text default 'newest',
  p_limit           int default 24,
  p_offset          int default 0) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_cats   uuid[];
  v_q      text := nullif(btrim(coalesce(p_query, '')), '');
  v_f      jsonb := coalesce(p_filters, '{}'::jsonb);
  v_brands text[] := array(select jsonb_array_elements_text(coalesce(v_f->'brands', '[]'::jsonb)));
  v_min    numeric := (v_f->>'min_price')::numeric;
  v_max    numeric := (v_f->>'max_price')::numeric;
  v_stock  boolean := coalesce((v_f->>'in_stock')::boolean, false);
  v_attrs  jsonb := coalesce(v_f->'attributes', '{}'::jsonb);
begin
  if p_category_slug is not null then
    with recursive tree as (
      select c.id from public.categories c
       where c.organization_id = p_organization_id and c.slug = p_category_slug and c.is_active
      union all
      select c.id from public.categories c join tree t on c.parent_id = t.id where c.is_active)
    select array_agg(id) into v_cats from tree;
    if v_cats is null then
      return jsonb_build_object('total', 0, 'items', '[]'::jsonb, 'facets',
        jsonb_build_object('brands', '[]'::jsonb, 'attributes', '[]'::jsonb, 'price', null));
    end if;
  end if;

  return (
    with avail as (
      select a.variant_id, a.available from public.storefront_availability(p_organization_id, null) a),
    scope as (
      select p.id, p.name, p.slug, p.summary, p.created_at, b.slug as brand_slug, b.name as brand_name,
             min(v.price) as min_price, max(v.price) as max_price,
             (array_agg(v.compare_at_price order by v.price))[1] as compare_at_price,
             count(v.id) as variant_count,
             coalesce(sum(av.available), 0) > 0 as in_stock,
             case when v_q is null then 0
                  when lower(p.name) = lower(v_q) then 3
                  when p.name ilike v_q || '%' then 2
                  else 1 end as relevance
        from public.products p
        join public.product_variants v on v.product_id = p.id and v.is_active
        left join public.brands b on b.id = p.brand_id and b.is_active
        left join avail av on av.variant_id = v.id
       where p.organization_id = p_organization_id and p.status = 'active'
         and (v_cats is null or p.category_id = any (v_cats))
         and (v_q is null
              or p.name ilike '%' || v_q || '%' or p.summary ilike '%' || v_q || '%' or b.name ilike '%' || v_q || '%'
              or exists (select 1 from public.product_variants x
                          where x.product_id = p.id and x.is_active and (x.sku ilike v_q || '%' or x.barcode = v_q)))
       group by p.id, b.slug, b.name),
    filtered as (
      select s.* from scope s
       where (cardinality(v_brands) = 0 or s.brand_slug = any (v_brands))
         and (v_min is null or s.max_price >= v_min)
         and (v_max is null or s.min_price <= v_max)
         and (not v_stock or s.in_stock)
         and not exists (
           select 1 from jsonb_each(v_attrs) f
            where jsonb_typeof(f.value) = 'array' and jsonb_array_length(f.value) > 0
              and not exists (
                select 1 from public.product_attribute_values pav
                 where pav.product_id = s.id and pav.attribute_id::text = f.key
                   and (pav.value #>> '{}') in (select jsonb_array_elements_text(f.value))))),
    page as (
      select f.* from filtered f
       order by
         case when p_sort = 'relevance' or (p_sort is null and v_q is not null) then f.relevance end desc nulls last,
         case when p_sort = 'price_asc' then f.min_price end asc nulls last,
         case when p_sort = 'price_desc' then f.min_price end desc nulls last,
         case when p_sort = 'name' then f.name end asc nulls last,
         f.created_at desc, f.id
       limit least(greatest(p_limit, 1), 96) offset greatest(p_offset, 0))
    select jsonb_build_object(
      'total', (select count(*) from filtered),
      'items', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', pg.id, 'slug', pg.slug, 'name', pg.name, 'summary', pg.summary,
                  'brand', pg.brand_name, 'min_price', pg.min_price, 'max_price', pg.max_price,
                  'compare_at_price', pg.compare_at_price, 'variant_count', pg.variant_count, 'in_stock', pg.in_stock,
                  'image', (select m.storage_path from public.product_media m where m.product_id = pg.id order by m.position limit 1))
                ) from page pg), '[]'::jsonb),
      'facets', jsonb_build_object(
        'brands', coalesce((select jsonb_agg(jsonb_build_object('slug', x.brand_slug, 'name', x.brand_name, 'count', x.n) order by x.brand_name)
                              from (select brand_slug, brand_name, count(*) n from scope where brand_slug is not null group by 1, 2) x), '[]'::jsonb),
        'price', (select jsonb_build_object('min', min(min_price), 'max', max(max_price)) from scope),
        'attributes', coalesce((
          select jsonb_agg(jsonb_build_object('id', ad.id, 'code', ad.code, 'label', ad.label, 'unit', ad.unit, 'values', vals.v) order by ad.label)
            from public.attribute_definitions ad
            join lateral (
              select jsonb_agg(jsonb_build_object('value', t.val, 'count', t.n) order by t.val) v
                from (select pav.value #>> '{}' val, count(*) n
                        from public.product_attribute_values pav join scope s on s.id = pav.product_id
                       where pav.attribute_id = ad.id group by 1) t) vals on vals.v is not null
           where ad.organization_id = p_organization_id and ad.is_filterable), '[]'::jsonb))));
end $$;

create or replace function public.storefront_product(p_organization_id uuid, p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  p public.products%rowtype;
begin
  select * into p from public.products
   where organization_id = p_organization_id and slug = p_slug and status = 'active';
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'name', p.name, 'summary', p.summary, 'description', p.description,
    'tracking_mode', p.tracking_mode, 'unit_of_measure', p.unit_of_measure, 'allow_fractional', p.allow_fractional,
    'seo', p.seo,
    'brand', (select jsonb_build_object('name', b.name, 'slug', b.slug) from public.brands b where b.id = p.brand_id and b.is_active),
    'breadcrumbs', coalesce((
      with recursive up(id, parent_id, name, slug, depth) as (
        select c.id, c.parent_id, c.name, c.slug, 0 from public.categories c where c.id = p.category_id and c.is_active
        union all
        select c.id, c.parent_id, c.name, c.slug, up.depth + 1 from public.categories c join up on c.id = up.parent_id)
      select jsonb_agg(jsonb_build_object('name', name, 'slug', slug) order by depth desc) from up), '[]'::jsonb),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object('name', o.name,
               'values', (select jsonb_agg(v.value order by v.position) from public.product_option_values v where v.option_id = o.id))
             order by o.position)
        from public.product_options o where o.product_id = p.id), '[]'::jsonb),
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id, 'title', v.title, 'sku', v.sku, 'price', v.price, 'compare_at_price', v.compare_at_price,
               'available', coalesce(a.available, 0),
               'option_values', (select jsonb_agg(ov.value order by po.position)
                                   from public.variant_option_values vov
                                   join public.product_option_values ov on ov.id = vov.option_value_id
                                   join public.product_options po on po.id = ov.option_id
                                  where vov.variant_id = v.id))
             order by v.position)
        from public.product_variants v
        left join public.storefront_availability(p_organization_id,
                    array(select id from public.product_variants where product_id = p.id)) a on a.variant_id = v.id
       where v.product_id = p.id and v.is_active), '[]'::jsonb),
    'media', coalesce((select jsonb_agg(jsonb_build_object('path', m.storage_path, 'alt', m.alt_text, 'variant_id', m.variant_id) order by m.position)
                         from public.product_media m where m.product_id = p.id), '[]'::jsonb),
    'specifications', coalesce((
      select jsonb_agg(jsonb_build_object('label', ad.label, 'value', pav.value, 'unit', ad.unit, 'type', ad.data_type) order by ca.position nulls last, ad.label)
        from public.product_attribute_values pav
        join public.attribute_definitions ad on ad.id = pav.attribute_id
        left join public.category_attributes ca on ca.attribute_id = ad.id and ca.category_id = p.category_id
       where pav.product_id = p.id), '[]'::jsonb),
    'related', coalesce((
      select jsonb_agg(r) from (
        select jsonb_build_object('slug', rp.slug, 'name', rp.name,
                 'min_price', (select min(price) from public.product_variants where product_id = rp.id and is_active),
                 'image', (select storage_path from public.product_media where product_id = rp.id order by position limit 1)) r
          from public.products rp
         where rp.organization_id = p_organization_id and rp.status = 'active' and rp.id <> p.id
           and rp.category_id is not distinct from p.category_id and p.category_id is not null
         order by rp.created_at desc limit 4) x), '[]'::jsonb));
end $$;

-- Public details the storefront shows: how to pay and collect, never internal settings.
create or replace function public.storefront_settings(p_organization_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'name', o.name, 'currency_code', o.currency_code, 'prices_include_tax', o.prices_include_tax,
    'delivery_enabled', coalesce((o.settings->>'delivery_enabled')::boolean, true),
    'pickup_enabled', coalesce((o.settings->>'pickup_enabled')::boolean, true),
    'delivery_fee', coalesce((o.settings->>'delivery_fee')::numeric, 0),
    'free_delivery_over', (o.settings->>'free_delivery_over')::numeric,
    'allow_cash_on_delivery', coalesce((o.settings->>'allow_cash_on_delivery')::boolean, true),
    'bank_transfer_details', nullif(o.settings->>'bank_transfer_details', ''),
    'online_payments_enabled', coalesce((o.settings->>'online_payments_enabled')::boolean, false),
    'contact_phone', o.settings->>'contact_phone', 'contact_email', o.settings->>'contact_email',
    'returns_enabled', public.module_enabled(o.id, 'returns'), 'return_days', (o.settings->>'return_days')::int,
    'coupons_enabled', public.module_enabled(o.id, 'promotions'),
    'web_enabled', public.module_enabled(o.id, 'storefront'), 'app_enabled', public.module_enabled(o.id, 'mobile_app'),
    'loyalty_enabled', public.module_enabled(o.id, 'loyalty'),
    'pickup_locations', coalesce((select jsonb_agg(jsonb_build_object('name', l.name, 'address', l.address, 'phone', l.phone) order by l.fulfilment_priority)
                                    from public.locations l where l.organization_id = o.id and l.is_active and l.sells_online and l.kind = 'store'), '[]'::jsonb))
    from public.organizations o
   where o.id = p_organization_id and (public.module_enabled(o.id, 'storefront') or public.module_enabled(o.id, 'mobile_app'))
$$;

-- Settings the admin may now set for the store.
create or replace function public.update_organization_settings(p_organization_id uuid, p_changes jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_allowed constant text[] := array['checkout_hold_minutes', 'checkout_max_line_quantity', 'discount_limits',
                                     'receipt_footer', 'contact_email', 'contact_phone', 'low_stock_default',
                                     'delivery_enabled', 'pickup_enabled', 'delivery_fee', 'free_delivery_over',
                                     'allow_cash_on_delivery', 'bank_transfer_details', 'bank_transfer_hold_hours'];
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
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

grant execute on function
  public.is_platform_admin(), public.role_permissions(public.staff_role), public.is_member(uuid),
  public.has_permission(uuid, text), public.has_location_access(uuid, uuid),
  public.module_enabled(uuid, public.module_key), public.owns_order(uuid), public.slugify(text)
  to anon, authenticated;

grant execute on function
  public.storefront_organization(text),
  public.storefront_settings(uuid),
  public.storefront_availability(uuid, uuid[]),
  public.storefront_categories(uuid),
  public.storefront_catalog(uuid, text, text, jsonb, text, int, int),
  public.storefront_product(uuid, text),
  public.cart_get(uuid, text),
  public.cart_set_item(uuid, text, uuid, numeric),
  public.cart_clear(uuid, text),
  public.quote_order(uuid, jsonb, public.fulfilment_method, text, public.sales_channel),
  public.checkout(uuid, jsonb, text, jsonb, jsonb, public.payment_method, public.sales_channel, text, text),
  public.get_order_by_token(uuid, text),
  public.start_checkout(uuid, jsonb, text, public.sales_channel, uuid, text)
  to anon, authenticated;

grant execute on function
  public.ensure_customer_profile(uuid, text, text),
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
  public.adjust_store_credit(uuid, numeric, text),
  public.save_product(uuid, jsonb),
  public.update_organization_settings(uuid, jsonb),
  public.my_workspaces(),
  public.list_staff(uuid),
  public.add_staff_by_email(uuid, text, public.staff_role, uuid[]),
  public.search_variants(uuid, text, uuid, int),
  public.stock_overview(uuid, uuid, text, boolean, int, int),
  public.stock_movements(uuid, uuid, uuid, int),
  public.set_low_stock_threshold(uuid, uuid, numeric),
  public.dashboard_summary(uuid, timestamptz, timestamptz)
  to authenticated;
