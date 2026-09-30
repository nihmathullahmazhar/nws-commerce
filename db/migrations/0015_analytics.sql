-- 0015_analytics.sql
-- Reports across every channel, read live from the same ledgers the tills and
-- the store write. There are no copies or nightly jobs, so a report is always
-- current and always agrees with the orders behind it.
--
-- Definitions (the same in every report):
--   * A sale counts once its order is confirmed or completed, on the day it was
--     placed, in the business's own time zone.
--   * Net sales = what the goods sold for after every discount, excluding tax,
--     less returns (on the day of the return). Delivery fees are shown on their own.
--   * Gift cards sold are money held for the customer, not a sale: they are
--     counted separately and left out of sales, items and profit.
--   * Cost of goods = the cost recorded on each unit as it left stock. A return
--     put back on sale gives that cost back; one written off or damaged does not,
--     so the loss shows in profit. A return still awaiting inspection has not
--     given its cost back yet.
--   * A manager limited to some locations sees only those locations.
-- Every report needs `reports.view`.

-- ---------------------------------------------------------------------------
-- Indexes for reporting reads
-- ---------------------------------------------------------------------------
create index if not exists inventory_movements_org_type_time_idx
  on public.inventory_movements (organization_id, movement_type, created_at);
create index if not exists inventory_movements_variant_type_time_idx
  on public.inventory_movements (variant_id, movement_type, created_at);
create index if not exists orders_placed_by_idx on public.orders (organization_id, placed_by, placed_at);
create index if not exists order_promotions_promotion_idx on public.order_promotions (promotion_id);

-- ---------------------------------------------------------------------------
-- Scope helpers (never granted)
-- ---------------------------------------------------------------------------

-- The caller's locations: null means all of them.
create or replace function public._report_locations(p_org uuid) returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select case when public.is_platform_admin() then null
              else (select m.location_ids from public.memberships m
                     where m.organization_id = p_org and m.user_id = auth.uid() and m.is_active) end
$$;

-- Checks the caller and the filters, and turns local dates into instants.
create or replace function public._report_begin(
  p_org uuid, p_from date, p_to date, p_location uuid,
  out w_start timestamptz, out w_end timestamptz, out tz text, out locs uuid[])
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_permission(p_org, 'reports.view');
  if p_location is not null then
    perform public.assert_location_access(p_org, p_location);
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'choose a date range';
  end if;
  if p_to - p_from > 1100 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'a report covers at most three years';
  end if;
  select o.timezone into tz from public.organizations o where o.id = p_org;
  w_start := p_from::timestamp at time zone tz;
  w_end := (p_to + 1)::timestamp at time zone tz;
  locs := public._report_locations(p_org);
end $$;

-- Orders that count as sales in a window.
create or replace function public._report_orders(
  p_org uuid, p_start timestamptz, p_end timestamptz, p_locs uuid[], p_location uuid, p_channel public.sales_channel)
returns setof public.orders
language sql stable security definer set search_path = public, pg_temp as $$
  select o.* from public.orders o
   where o.organization_id = p_org and o.status in ('confirmed', 'completed')
     and o.placed_at >= p_start and o.placed_at < p_end
     and (p_locs is null or o.location_id = any (p_locs))
     and (p_location is null or o.location_id = p_location)
     and (p_channel is null or o.channel = p_channel)
$$;

-- One row per order line, with its share of the cost of the units that left stock.
create or replace function public._report_lines(
  p_org uuid, p_start timestamptz, p_end timestamptz, p_locs uuid[], p_location uuid, p_channel public.sales_channel)
returns table (order_id uuid, placed_at timestamptz, location_id uuid, channel public.sales_channel, customer_id uuid,
               placed_by uuid, line_id uuid, variant_id uuid, product_id uuid, category_id uuid, brand_id uuid,
               is_gift_card boolean, quantity numeric, gross numeric, discount numeric, promo numeric,
               net numeric, tax numeric, cost numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with o as (select * from public._report_orders(p_org, p_start, p_end, p_locs, p_location, p_channel)),
  l as (select ol.id as lid, ol.order_id as oid, ol.variant_id as vid, ol.quantity as qty, ol.line_subtotal, ol.discount_amount,
               ol.promo_discount, ol.line_total, ol.tax_amount, o.placed_at as placed, o.location_id as loc, o.channel as ch,
               o.customer_id as cust, o.placed_by as by_user, p.id as pid, p.category_id as cid, p.brand_id as bid, p.is_gift_card as gift
          from o join public.order_lines ol on ol.order_id = o.id
          join public.product_variants v on v.id = ol.variant_id
          join public.products p on p.id = v.product_id),
  c as (select m.source_id as oid, m.variant_id as vid, sum(-m.quantity * coalesce(m.unit_cost, 0)) as cost
          from public.inventory_movements m
         where m.organization_id = p_org and m.source_type = 'order' and m.movement_type = 'sale'
           and m.source_id in (select id from o)
         group by 1, 2),
  q as (select oid, vid, sum(qty) as qty from l group by 1, 2)
  select l.oid, l.placed, l.loc, l.ch, l.cust, l.by_user, l.lid, l.vid, l.pid, l.cid, l.bid, l.gift,
         l.qty, l.line_subtotal, l.discount_amount, l.promo_discount, l.line_total - l.tax_amount, l.tax_amount,
         coalesce(round(c.cost * l.qty / nullif(q.qty, 0), 2), 0)
    from l
    left join q on q.oid = l.oid and q.vid = l.vid
    left join c on c.oid = l.oid and c.vid = l.vid
$$;

-- One row per returned line in a window, valued excluding tax.
create or replace function public._report_returns(
  p_org uuid, p_start timestamptz, p_end timestamptz, p_locs uuid[], p_location uuid, p_channel public.sales_channel)
returns table (return_id uuid, requested_at timestamptz, order_id uuid, location_id uuid, channel public.sales_channel,
               variant_id uuid, product_id uuid, category_id uuid, brand_id uuid, quantity numeric,
               value numeric, refund numeric, cost_back numeric, created_by uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.id, r.requested_at, o.id, o.location_id, o.channel, rl.variant_id, p.id, p.category_id, p.brand_id, rl.quantity,
         coalesce(round(rl.line_refund * (ol.line_total - ol.tax_amount) / nullif(ol.line_total, 0), 2), 0),
         rl.line_refund,
         case when rl.disposition = 'restock' then round(rl.quantity * coalesce(rl.unit_cost, 0), 2) else 0 end,
         r.created_by
    from public.returns r
    join public.return_lines rl on rl.return_id = r.id
    join public.order_lines ol on ol.id = rl.order_line_id
    join public.orders o on o.id = r.order_id
    join public.product_variants v on v.id = rl.variant_id
    join public.products p on p.id = v.product_id
   where r.organization_id = p_org and r.status <> 'cancelled'
     and r.requested_at >= p_start and r.requested_at < p_end
     and (p_locs is null or o.location_id = any (p_locs))
     and (p_location is null or o.location_id = p_location)
     and (p_channel is null or o.channel = p_channel)
$$;

-- The headline numbers for a window.
create or replace function public._report_totals(
  p_org uuid, p_start timestamptz, p_end timestamptz, p_locs uuid[], p_location uuid, p_channel public.sales_channel)
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with o as (select * from public._report_orders(p_org, p_start, p_end, p_locs, p_location, p_channel)),
  l as (select * from public._report_lines(p_org, p_start, p_end, p_locs, p_location, p_channel)),
  r as (select * from public._report_returns(p_org, p_start, p_end, p_locs, p_location, p_channel)),
  t as (
    select (select count(*) from o) as orders,
           (select coalesce(sum(total), 0) from o) as order_value,
           (select coalesce(sum(shipping_total), 0) from o) as shipping,
           (select count(distinct customer_id) from o) as customers,
           (select coalesce(sum(quantity), 0) from l where not is_gift_card) as items,
           (select coalesce(sum(gross), 0) from l where not is_gift_card) as gross,
           (select coalesce(sum(discount), 0) from l where not is_gift_card) as discounts,
           (select coalesce(sum(promo), 0) from l where not is_gift_card) as promo,
           (select coalesce(sum(net), 0) from l where not is_gift_card) as net,
           (select coalesce(sum(tax), 0) from l) as tax,
           (select coalesce(sum(cost), 0) from l where not is_gift_card) as cost,
           (select coalesce(sum(net), 0) from l where is_gift_card) as gift_cards_sold,
           (select coalesce(sum(value), 0) from r) as returns,
           (select coalesce(sum(quantity), 0) from r) as returned_items,
           (select coalesce(sum(cost_back), 0) from r) as cost_back)
  select jsonb_build_object(
    'orders', orders, 'order_value', order_value, 'shipping', shipping, 'customers', customers,
    'items', items, 'gross', gross, 'discounts', discounts, 'promo_discounts', promo, 'manual_discounts', discounts - promo,
    'tax', tax, 'returns', returns, 'returned_items', returned_items,
    'net_sales', net - returns, 'cogs', cost - cost_back, 'gross_profit', net - returns - (cost - cost_back),
    'margin', case when net - returns > 0 then round((net - returns - (cost - cost_back)) * 100 / (net - returns), 1) end,
    'average_sale', case when orders > 0 then round(order_value / orders, 2) end,
    'items_per_sale', case when orders > 0 then round(items / orders, 2) end,
    'gift_cards_sold', gift_cards_sold)
  from t
$$;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

-- Sales overview: totals against the previous period of the same length, a
-- series by day, week or month, the split by channel, location and payment
-- method, and a weekday-by-hour grid.
create or replace function public.report_sales(
  p_organization_id uuid, p_from date, p_to date, p_location_id uuid default null,
  p_channel public.sales_channel default null, p_interval text default 'day')
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  w         record;
  p         record;
  v_days    int := p_to - p_from + 1;
  v_step    interval;
  v_result  jsonb;
begin
  select * into w from public._report_begin(p_organization_id, p_from, p_to, p_location_id);
  if p_interval not in ('day', 'week', 'month') then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'group by day, week or month';
  end if;
  v_step := ('1 ' || p_interval)::interval;
  select * into p from public._report_begin(p_organization_id, p_from - v_days, p_from - 1, p_location_id);

  with l as (select * from public._report_lines(p_organization_id, w.w_start, w.w_end, w.locs, p_location_id, p_channel) where not is_gift_card),
  r as (select * from public._report_returns(p_organization_id, w.w_start, w.w_end, w.locs, p_location_id, p_channel)),
  o as (select * from public._report_orders(p_organization_id, w.w_start, w.w_end, w.locs, p_location_id, p_channel)),
  buckets as (
    select g::date as bucket
      from generate_series(date_trunc(p_interval, p_from::timestamp), p_to::timestamp, v_step) g),
  ls as (select date_trunc(p_interval, (placed_at at time zone w.tz))::date as bucket, order_id, net, cost from l),
  rs as (select date_trunc(p_interval, (requested_at at time zone w.tz))::date as bucket, value, cost_back from r)
  select jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to, 'previous_from', p_from - v_days, 'previous_to', p_from - 1,
                                'interval', p_interval, 'timezone', w.tz),
    'totals', public._report_totals(p_organization_id, w.w_start, w.w_end, w.locs, p_location_id, p_channel),
    'previous', public._report_totals(p_organization_id, p.w_start, p.w_end, p.locs, p_location_id, p_channel),
    'series', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'bucket', b.bucket, 'orders', coalesce(la.orders, 0),
               'net_sales', coalesce(la.net, 0) - coalesce(ra.value, 0),
               'gross_profit', coalesce(la.profit, 0) - coalesce(ra.profit, 0))
             order by b.bucket), '[]'::jsonb)
        from buckets b
        left join (select bucket, count(distinct order_id) as orders, sum(net) as net, sum(net - cost) as profit
                     from ls group by bucket) la on la.bucket = b.bucket
        left join (select bucket, sum(value) as value, sum(value - cost_back) as profit
                     from rs group by bucket) ra on ra.bucket = b.bucket),
    'by_channel', (
      select coalesce(jsonb_agg(jsonb_build_object('channel', x.channel, 'orders', x.orders, 'net_sales', x.net_sales)
                                order by x.net_sales desc), '[]'::jsonb)
        from (select c.channel,
                     (select count(*) from o where o.channel = c.channel) as orders,
                     coalesce((select sum(net) from l where l.channel = c.channel), 0)
                       - coalesce((select sum(value) from r where r.channel = c.channel), 0) as net_sales
                from (select distinct channel from o union select distinct channel from r) c) x),
    'by_location', (
      select coalesce(jsonb_agg(jsonb_build_object('location_id', x.id, 'name', x.name, 'orders', x.orders, 'net_sales', x.net_sales)
                                order by x.net_sales desc), '[]'::jsonb)
        from (select loc.id, loc.name,
                     (select count(*) from o where o.location_id = loc.id) as orders,
                     coalesce((select sum(net) from l where l.location_id = loc.id), 0)
                       - coalesce((select sum(value) from r where r.location_id = loc.id), 0) as net_sales
                from public.locations loc
               where loc.id in (select location_id from o union select location_id from r)) x),
    'by_method', (
      select coalesce(jsonb_agg(jsonb_build_object('method', x.method, 'taken', x.taken, 'refunded', x.refunded, 'net', x.taken - x.refunded)
                                order by x.taken - x.refunded desc), '[]'::jsonb)
        from (select pm.method,
                     coalesce(sum(pm.amount) filter (where pm.kind = 'payment'), 0) as taken,
                     coalesce(sum(pm.amount) filter (where pm.kind = 'refund'), 0) as refunded
                from public.payments pm join public.orders ord on ord.id = pm.order_id
               where pm.organization_id = p_organization_id and pm.status = 'captured'
                 and pm.created_at >= w.w_start and pm.created_at < w.w_end
                 and (w.locs is null or ord.location_id = any (w.locs))
                 and (p_location_id is null or ord.location_id = p_location_id)
                 and (p_channel is null or ord.channel = p_channel)
               group by pm.method) x),
    'by_hour', (
      select coalesce(jsonb_agg(jsonb_build_object('weekday', x.dow, 'hour', x.hr, 'orders', x.orders, 'net_sales', x.net)
                                order by x.dow, x.hr), '[]'::jsonb)
        from (select extract(isodow from (placed_at at time zone w.tz))::int as dow,
                     extract(hour from (placed_at at time zone w.tz))::int as hr,
                     count(distinct order_id) as orders, sum(net) as net
                from l group by 1, 2) x))
  into v_result;
  return v_result;
end $$;

-- Products, variants, categories or brands, ranked by net sales.
create or replace function public.report_products(
  p_organization_id uuid, p_from date, p_to date, p_location_id uuid default null,
  p_channel public.sales_channel default null, p_group text default 'product', p_limit int default 100)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  w        record;
  v_result jsonb;
begin
  select * into w from public._report_begin(p_organization_id, p_from, p_to, p_location_id);
  if p_group not in ('product', 'variant', 'category', 'brand') then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'group by product, variant, category or brand';
  end if;

  with l as (select * from public._report_lines(p_organization_id, w.w_start, w.w_end, w.locs, p_location_id, p_channel) where not is_gift_card),
  r as (select * from public._report_returns(p_organization_id, w.w_start, w.w_end, w.locs, p_location_id, p_channel)),
  lk as (select case p_group when 'product' then product_id when 'variant' then variant_id
                             when 'category' then category_id else brand_id end as k, * from l),
  rk as (select case p_group when 'product' then product_id when 'variant' then variant_id
                             when 'category' then category_id else brand_id end as k, * from r),
  g as (
    select k,
           sum(quantity) as quantity, count(distinct order_id) as orders, sum(net) as net, sum(cost) as cost,
           sum(discount) as discounts
      from lk group by k),
  gr as (select k, sum(quantity) as quantity, sum(value) as value, sum(cost_back) as cost_back from rk group by k),
  keys as (select k from g union select k from gr),
  rws as (
    select keys.k,
           coalesce(g.quantity, 0) as quantity, coalesce(g.orders, 0) as orders, coalesce(g.discounts, 0) as discounts,
           coalesce(g.net, 0) - coalesce(gr.value, 0) as net_sales,
           coalesce(g.cost, 0) - coalesce(gr.cost_back, 0) as cogs,
           coalesce(gr.quantity, 0) as returned
      from keys
      left join g on g.k is not distinct from keys.k
      left join gr on gr.k is not distinct from keys.k),
  total as (select sum(net_sales) as net from rws)
  select jsonb_build_object(
    'group', p_group,
    'net_sales', coalesce((select net from total), 0),
    'count', (select count(*) from rws),
    'rows', coalesce((
      select jsonb_agg(x.j order by x.net_sales desc, x.name)
        from (
          select rws.net_sales, coalesce(nm.name, '') as name, jsonb_build_object(
                   'id', rws.k, 'name', coalesce(nm.name, case p_group when 'category' then 'No category' when 'brand' then 'No brand' else '?' end),
                   'detail', nm.detail,
                   'quantity', rws.quantity, 'orders', rws.orders, 'discounts', rws.discounts,
                   'net_sales', rws.net_sales, 'cogs', rws.cogs, 'gross_profit', rws.net_sales - rws.cogs,
                   'margin', case when rws.net_sales > 0 then round((rws.net_sales - rws.cogs) * 100 / rws.net_sales, 1) end,
                   'returned', rws.returned,
                   'return_rate', case when rws.quantity > 0 then round(rws.returned * 100 / rws.quantity, 1) end,
                   'share', case when (select net from total) > 0 then round(rws.net_sales * 100 / (select net from total), 1) end) as j
            from rws
            left join lateral (
              select case p_group
                       when 'product'  then (select p.name from public.products p where p.id = rws.k)
                       when 'variant'  then (select p.name || case when v.title <> 'Default' then ' · ' || v.title else '' end
                                               from public.product_variants v join public.products p on p.id = v.product_id where v.id = rws.k)
                       when 'category' then (select c.name from public.categories c where c.id = rws.k)
                       else (select b.name from public.brands b where b.id = rws.k) end as name,
                     case when p_group = 'variant' then (select v.sku from public.product_variants v where v.id = rws.k) end as detail
            ) nm on true
           order by rws.net_sales desc
           limit greatest(coalesce(p_limit, 100), 1)) x), '[]'::jsonb))
  into v_result;
  return v_result;
end $$;

-- Stock value, cover and slow movers. p_days is the look-back for "sold" and
-- for "not sold since" (dead stock).
create or replace function public.report_inventory(
  p_organization_id uuid, p_location_id uuid default null, p_days int default 30)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_locs   uuid[];
  v_since  timestamptz;
  v_result jsonb;
begin
  perform public.assert_permission(p_organization_id, 'reports.view');
  if p_location_id is not null then
    perform public.assert_location_access(p_organization_id, p_location_id);
  end if;
  if p_days is null or p_days < 1 or p_days > 730 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'look back between 1 and 730 days';
  end if;
  v_locs := public._report_locations(p_organization_id);
  v_since := now() - make_interval(days => p_days);

  with s as (
    select s.variant_id, sum(s.on_hand) as on_hand, sum(s.reserved) as reserved,
           sum(s.on_hand * s.avg_unit_cost) as value
      from public.stock_levels s
     where s.organization_id = p_organization_id
       and (v_locs is null or s.location_id = any (v_locs))
       and (p_location_id is null or s.location_id = p_location_id)
     group by s.variant_id),
  m as (
    select mv.variant_id,
           sum(case when mv.movement_type = 'sale' then -mv.quantity when mv.movement_type = 'sale_return' then -mv.quantity else 0 end)
             filter (where mv.created_at >= v_since) as sold,
           max(mv.created_at) filter (where mv.movement_type = 'sale') as last_sold_at,
           min(mv.created_at) filter (where mv.quantity > 0) as first_in_at
      from public.inventory_movements mv
     where mv.organization_id = p_organization_id
       and mv.variant_id in (select variant_id from s)
       and (v_locs is null or mv.location_id = any (v_locs))
       and (p_location_id is null or mv.location_id = p_location_id)
     group by mv.variant_id),
  items as (
    select v.id as variant_id, p.name as product, v.title as variant, v.sku, c.name as category,
           s.on_hand, s.reserved, round(s.value, 2) as value, round(s.on_hand * v.price, 2) as retail_value,
           coalesce(m.sold, 0) as sold, m.last_sold_at, m.first_in_at,
           case when coalesce(m.sold, 0) > 0 then round(s.on_hand / (m.sold / p_days::numeric), 0) end as days_cover,
           coalesce(s.on_hand > 0 and coalesce(m.last_sold_at < v_since, true) and m.first_in_at < v_since, false) as dead
      from s
      join public.product_variants v on v.id = s.variant_id
      join public.products p on p.id = v.product_id
      left join public.categories c on c.id = p.category_id
      left join m on m.variant_id = s.variant_id
     where p.tracking_mode <> 'non_stock')
  select jsonb_build_object(
    'days', p_days,
    'totals', (select jsonb_build_object(
                 'variants', count(*) filter (where on_hand > 0), 'units', coalesce(sum(on_hand), 0),
                 'value', coalesce(sum(value), 0), 'retail_value', coalesce(sum(retail_value), 0),
                 'dead_variants', count(*) filter (where dead), 'dead_value', coalesce(sum(value) filter (where dead), 0),
                 'out_of_stock', count(*) filter (where on_hand <= 0))
                 from items),
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object('category', x.category, 'units', x.units, 'value', x.value, 'retail_value', x.retail) order by x.value desc)
        from (select coalesce(category, 'No category') as category, sum(on_hand) as units, sum(value) as value, sum(retail_value) as retail
                from items where on_hand > 0 group by 1) x), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.value desc nulls last, x.product)
        from (select * from items where on_hand > 0 or sold > 0 order by value desc nulls last limit 2000) x), '[]'::jsonb))
  into v_result;
  return v_result;
end $$;

-- Customers: new against returning, walk-ins, repeat buyers and the top spenders.
create or replace function public.report_customers(
  p_organization_id uuid, p_from date, p_to date, p_location_id uuid default null,
  p_channel public.sales_channel default null, p_limit int default 20)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  w        record;
  v_result jsonb;
begin
  select * into w from public._report_begin(p_organization_id, p_from, p_to, p_location_id);

  with o as (select * from public._report_orders(p_organization_id, w.w_start, w.w_end, w.locs, p_location_id, p_channel)),
  c as (
    select o.customer_id, count(*) as orders, sum(o.total) as spent, max(o.placed_at) as last_at,
           -- New: their first counted order anywhere in the business falls in this window.
           not exists (select 1 from public.orders e
                        where e.customer_id = o.customer_id and e.status in ('confirmed', 'completed')
                          and e.placed_at < w.w_start) as is_new
      from o where o.customer_id is not null group by o.customer_id)
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'orders', (select count(*) from o),
      'walk_in_orders', (select count(*) from o where customer_id is null),
      'walk_in_value', (select coalesce(sum(total), 0) from o where customer_id is null),
      'customers', (select count(*) from c),
      'new_customers', (select count(*) from c where is_new),
      'returning_customers', (select count(*) from c where not is_new),
      'new_value', (select coalesce(sum(spent), 0) from c where is_new),
      'returning_value', (select coalesce(sum(spent), 0) from c where not is_new),
      'repeat_customers', (select count(*) from c where orders > 1),
      'average_spend', (select round(avg(spent), 2) from c)),
    'top', coalesce((
      select jsonb_agg(jsonb_build_object('customer_id', x.customer_id, 'name', x.full_name, 'phone', x.phone,
                                          'orders', x.orders, 'spent', x.spent, 'last_order_at', x.last_at,
                                          'is_new', x.is_new, 'loyalty_points', x.loyalty_points) order by x.spent desc)
        from (select c.*, cu.full_name, cu.phone, cu.loyalty_points
                from c join public.customers cu on cu.id = c.customer_id
               order by c.spent desc limit greatest(coalesce(p_limit, 20), 1)) x), '[]'::jsonb))
  into v_result;
  return v_result;
end $$;

-- What promotions and manual discounts gave away, and what they sold.
create or replace function public.report_promotions(
  p_organization_id uuid, p_from date, p_to date, p_location_id uuid default null,
  p_channel public.sales_channel default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  w        record;
  v_result jsonb;
begin
  select * into w from public._report_begin(p_organization_id, p_from, p_to, p_location_id);

  with o as (select * from public._report_orders(p_organization_id, w.w_start, w.w_end, w.locs, p_location_id, p_channel)),
  l as (select * from public._report_lines(p_organization_id, w.w_start, w.w_end, w.locs, p_location_id, p_channel))
  select jsonb_build_object(
    'promo_discounts', (select coalesce(sum(promo), 0) from l),
    'manual_discounts', (select coalesce(sum(discount - promo), 0) from l),
    'orders_with_promotion', (select count(distinct op.order_id) from public.order_promotions op where op.order_id in (select id from o)),
    'orders_with_manual_discount', (select count(distinct order_id) from l where discount > promo),
    'promotions', coalesce((
      select jsonb_agg(jsonb_build_object('promotion_id', x.id, 'name', x.name, 'kind', x.kind, 'coupon_code', x.coupon_code,
                                          'orders', x.orders, 'discount', x.discount, 'order_value', x.order_value,
                                          'is_active', x.is_active) order by x.discount desc)
        from (select pm.id, pm.name, pm.kind, pm.coupon_code, pm.is_active,
                     count(*) as orders, sum(op.amount) as discount, sum(ord.total) as order_value
                from public.order_promotions op
                join o ord on ord.id = op.order_id
                join public.promotions pm on pm.id = op.promotion_id
               group by pm.id) x), '[]'::jsonb))
  into v_result;
  return v_result;
end $$;

-- Who sold what: sales, discounts given and returns taken, per person. Online
-- and app orders placed by customers are grouped as self-service.
create or replace function public.report_staff(
  p_organization_id uuid, p_from date, p_to date, p_location_id uuid default null,
  p_channel public.sales_channel default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  w        record;
  v_result jsonb;
begin
  select * into w from public._report_begin(p_organization_id, p_from, p_to, p_location_id);

  with o as (select * from public._report_orders(p_organization_id, w.w_start, w.w_end, w.locs, p_location_id, p_channel)),
  l as (select * from public._report_lines(p_organization_id, w.w_start, w.w_end, w.locs, p_location_id, p_channel)),
  r as (select return_id, created_by, sum(refund) as refund
          from public._report_returns(p_organization_id, w.w_start, w.w_end, w.locs, p_location_id, p_channel)
         group by 1, 2),
  -- Staff are members; anyone else who placed an order is a customer serving themselves.
  who as (
    select distinct x.uid, (m.user_id is not null) as staff
      from (select placed_by as uid from o union select created_by from r) x
      left join public.memberships m on m.organization_id = p_organization_id and m.user_id = x.uid),
  s as (
    select case when who.staff then who.uid end as uid,
           (select count(*) from o where o.placed_by = who.uid) as orders,
           (select coalesce(sum(total), 0) from o where o.placed_by = who.uid) as order_value,
           (select coalesce(sum(net), 0) from l where l.placed_by = who.uid and not l.is_gift_card) as net,
           (select coalesce(sum(quantity), 0) from l where l.placed_by = who.uid and not l.is_gift_card) as items,
           (select coalesce(sum(discount - promo), 0) from l where l.placed_by = who.uid) as manual_discounts,
           (select count(*) from r where r.created_by = who.uid) as returns,
           (select coalesce(sum(refund), 0) from r where r.created_by = who.uid) as refunded
      from who),
  g as (
    select uid, sum(orders) as orders, sum(order_value) as order_value, sum(net) as net, sum(items) as items,
           sum(manual_discounts) as manual_discounts, sum(returns) as returns, sum(refunded) as refunded
      from s group by uid)
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', g.uid,
           'name', case when g.uid is null then 'Customers (self-service)' else (select u.email::text from auth.users u where u.id = g.uid) end,
           'role', (select m.role from public.memberships m where m.organization_id = p_organization_id and m.user_id = g.uid),
           'orders', g.orders, 'order_value', g.order_value, 'net_sales', g.net, 'items', g.items,
           'average_sale', case when g.orders > 0 then round(g.order_value / g.orders, 2) end,
           'manual_discounts', g.manual_discounts,
           'discount_rate', case when g.net + g.manual_discounts > 0 then round(g.manual_discounts * 100 / (g.net + g.manual_discounts), 1) end,
           'returns', g.returns, 'refunded', g.refunded) order by g.order_value desc), '[]'::jsonb)
    from g
  into v_result;
  return jsonb_build_object('staff', v_result);
end $$;

select public._regrant_api();
