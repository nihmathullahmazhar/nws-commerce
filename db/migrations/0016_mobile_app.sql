-- 0016_mobile_app.sql
-- The customer app (module `mobile_app`) runs on the same API as the online
-- store: the same catalogue, quotes, checkout and order pages, with its own
-- channel so reports and channel-only promotions can tell it apart. The store
-- lookups answer when either the website or the app is switched on (see 0001
-- and 0010). This adds the signed-in shopper's account in one call.

-- The signed-in shopper's account at one business: profile, points, store
-- credit and every order they have placed in any channel, at the counter
-- included once the till has them as the customer.
create or replace function public.my_account(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  c public.customers%rowtype;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED', detail = 'sign in first';
  end if;
  if not (public.module_enabled(p_organization_id, 'storefront') or public.module_enabled(p_organization_id, 'mobile_app')) then
    raise exception using errcode = 'NC002', message = 'MODULE_DISABLED', detail = 'mobile_app';
  end if;
  select * into c from public.customers where organization_id = p_organization_id and auth_user_id = auth.uid();

  return jsonb_build_object(
    'email', (select u.email from auth.users u where u.id = auth.uid()),
    'profile', case when c.id is not null then
      jsonb_build_object('customer_id', c.id, 'full_name', c.full_name, 'phone', c.phone, 'email', c.email) end,
    'store_credit', coalesce(c.store_credit_balance, 0),
    'loyalty', case when c.id is not null and public.module_enabled(p_organization_id, 'loyalty') then jsonb_build_object(
      'points', c.loyalty_points,
      'point_value', public._loyalty_setting(p_organization_id, 'loyalty_point_value', 1),
      'points_per_100', public._loyalty_setting(p_organization_id, 'loyalty_points_per_100', 1),
      'min_redeem', public._loyalty_setting(p_organization_id, 'loyalty_min_redeem', 0),
      'history', coalesce((
        select jsonb_agg(jsonb_build_object('points', l.points, 'reason', l.reason, 'at', l.created_at) order by l.created_at desc)
          from (select * from public.loyalty_ledger where customer_id = c.id order by created_at desc limit 30) l), '[]'::jsonb)) end,
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'order_id', o.id, 'number', o.number, 'channel', o.channel, 'status', o.status,
               'payment_status', o.payment_status, 'fulfilment_method', o.fulfilment_method,
               'total', o.total, 'placed_at', o.placed_at, 'access_token', o.access_token,
               'items', (select coalesce(sum(ol.quantity), 0) from public.order_lines ol where ol.order_id = o.id),
               'first_item', (select ol.product_name from public.order_lines ol where ol.order_id = o.id order by ol.position limit 1))
             order by o.placed_at desc)
        from (select * from public.orders
               where customer_id = c.id and status <> 'expired'
               order by placed_at desc limit 50) o), '[]'::jsonb));
end $$;

select public._regrant_api();
