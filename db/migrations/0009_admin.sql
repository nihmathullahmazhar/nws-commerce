-- 0009_admin.sql
-- Commands and read models for the admin app: atomic product save, organisation
-- settings, staff by email, stock overview and movement history (cost only for
-- people who may see it), variant search for pickers, dashboard summary.

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- Cost is management information: hide cost columns from direct reads.
-- Cost figures come through functions that require reports.view.
-- ---------------------------------------------------------------------------
revoke select on public.stock_levels, public.inventory_movements, public.serial_units from authenticated;
grant select (organization_id, location_id, variant_id, on_hand, reserved, low_stock_threshold, updated_at)
  on public.stock_levels to authenticated;
grant select (id, organization_id, location_id, variant_id, batch_id, serial_unit_id, movement_type, quantity,
              source_type, source_id, note, created_by, created_at)
  on public.inventory_movements to authenticated;
grant select (id, organization_id, variant_id, serial, status, location_id, received_at, updated_at)
  on public.serial_units to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.slugify(p_text text) returns text
language sql immutable as $$
  select nullif(trim(both '-' from regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g')), '')
$$;

create or replace function public._unique_product_slug(p_org uuid, p_base text, p_product uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_base text := coalesce(public.slugify(p_base), 'product');
  v_slug text := v_base;
  v_n    int := 1;
begin
  while exists (select 1 from public.products p
                 where p.organization_id = p_org and p.slug = v_slug and p.id is distinct from p_product) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;
  return v_slug;
end $$;

-- ---------------------------------------------------------------------------
-- save_product: the product, its options, variants and attributes in one go
-- ---------------------------------------------------------------------------
-- p_product = {
--   id?, name, slug?, summary?, description?, status?, brand_id?, category_id?,
--   tracking_mode?, unit_of_measure?, allow_fractional?, tax_rate_id?, tax_exempt?,
--   options:    [{name, values: [..]}],                     -- may be empty
--   variants:   [{id?, option_values: [..], title?, sku?, barcode?, price,
--                 compare_at_price?, is_active?}],          -- at least one
--   attributes: {"<attribute_id>": value, ...}
-- }
-- The payload is the product's complete new state (what the edit form shows):
-- a field left out is cleared, not kept. Variants left out are deactivated,
-- never deleted, because sold stock refers to them.
create or replace function public.save_product(p_organization_id uuid, p_product jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id       uuid := nullif(p_product->>'id', '')::uuid;
  v_existing public.products%rowtype;
  v_options  jsonb := coalesce(p_product->'options', '[]'::jsonb);
  v_variants jsonb := coalesce(p_product->'variants', '[]'::jsonb);
  v_opt_count int;
  v_keep     uuid[] := '{}';
  v_opt      jsonb;
  v_opt_id   uuid;
  v_var      jsonb;
  v_var_id   uuid;
  v_vals     text[];
  v_val_ids  uuid[];
  v_title    text;
  v_combos   text[] := '{}';
  v_key      text;
  v_attr     record;
  v_i        int;
  v_constraint text;
begin
  perform public.assert_permission(p_organization_id, 'catalog.manage');

  if coalesce(btrim(p_product->>'name'), '') = '' then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'a product needs a name';
  end if;
  if jsonb_typeof(v_options) <> 'array' or jsonb_typeof(v_variants) <> 'array' or jsonb_array_length(v_variants) = 0 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'a product needs at least one variant';
  end if;
  v_opt_count := jsonb_array_length(v_options);
  if v_opt_count > 3 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'at most three options (e.g. size, colour, material)';
  end if;
  if (select count(distinct lower(btrim(o->>'name'))) from jsonb_array_elements(v_options) o) <> v_opt_count
     or exists (select 1 from jsonb_array_elements(v_options) o
                 where coalesce(btrim(o->>'name'), '') = '' or jsonb_typeof(o->'values') <> 'array'
                    or jsonb_array_length(o->'values') = 0) then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
      detail = 'each option needs a unique name and at least one value';
  end if;

  if v_id is not null then
    select * into v_existing from public.products where id = v_id and organization_id = p_organization_id for update;
    if not found then
      raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'product';
    end if;
  end if;

  begin
    if v_id is null then
      insert into public.products
        (organization_id, name, slug, summary, description, status, brand_id, category_id, tracking_mode,
         unit_of_measure, allow_fractional, tax_rate_id, tax_exempt)
      values
        (p_organization_id, btrim(p_product->>'name'),
         public._unique_product_slug(p_organization_id, coalesce(nullif(p_product->>'slug', ''), p_product->>'name'), null),
         p_product->>'summary', p_product->>'description',
         coalesce(p_product->>'status', 'draft')::public.product_status,
         nullif(p_product->>'brand_id', '')::uuid, nullif(p_product->>'category_id', '')::uuid,
         coalesce(p_product->>'tracking_mode', 'none')::public.tracking_mode,
         coalesce(nullif(p_product->>'unit_of_measure', ''), 'each'),
         coalesce((p_product->>'allow_fractional')::boolean, false),
         nullif(p_product->>'tax_rate_id', '')::uuid, coalesce((p_product->>'tax_exempt')::boolean, false))
      returning id into v_id;
    else
      update public.products set
        name             = btrim(p_product->>'name'),
        slug             = case when nullif(p_product->>'slug', '') is null or p_product->>'slug' = v_existing.slug
                                then v_existing.slug
                                else public._unique_product_slug(p_organization_id, p_product->>'slug', v_id) end,
        summary          = p_product->>'summary',
        description      = p_product->>'description',
        status           = coalesce(p_product->>'status', v_existing.status::text)::public.product_status,
        brand_id         = nullif(p_product->>'brand_id', '')::uuid,
        category_id      = nullif(p_product->>'category_id', '')::uuid,
        tracking_mode    = coalesce(p_product->>'tracking_mode', v_existing.tracking_mode::text)::public.tracking_mode,
        unit_of_measure  = coalesce(nullif(p_product->>'unit_of_measure', ''), v_existing.unit_of_measure),
        allow_fractional = coalesce((p_product->>'allow_fractional')::boolean, v_existing.allow_fractional),
        tax_rate_id      = nullif(p_product->>'tax_rate_id', '')::uuid,
        tax_exempt       = coalesce((p_product->>'tax_exempt')::boolean, v_existing.tax_exempt)
      where id = v_id;
    end if;
  exception when foreign_key_violation then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'unknown brand, category or tax rate';
  end;

  -- Options: drop the ones no longer listed (their variant links go with them),
  -- then upsert by name and reconcile values.
  delete from public.product_options po
   where po.product_id = v_id
     and not exists (select 1 from jsonb_array_elements(v_options) o where lower(btrim(o->>'name')) = lower(po.name));

  v_i := 0;
  for v_opt in select o from jsonb_array_elements(v_options) o loop
    v_i := v_i + 1;
    select id into v_opt_id from public.product_options
     where product_id = v_id and lower(name) = lower(btrim(v_opt->>'name'));
    if v_opt_id is null then
      insert into public.product_options (organization_id, product_id, name, position)
      values (p_organization_id, v_id, btrim(v_opt->>'name'), v_i) returning id into v_opt_id;
    else
      update public.product_options set name = btrim(v_opt->>'name'), position = v_i where id = v_opt_id;
    end if;

    delete from public.product_option_values pv
     where pv.option_id = v_opt_id
       and not exists (select 1 from jsonb_array_elements_text(v_opt->'values') x where btrim(x) = pv.value);
    insert into public.product_option_values (organization_id, option_id, value, position)
    select p_organization_id, v_opt_id, btrim(x.v), x.n
      from jsonb_array_elements_text(v_opt->'values') with ordinality x(v, n)
    on conflict (option_id, value) do update set position = excluded.position;
    v_opt_id := null;
  end loop;

  -- Variants
  for v_var in select x from jsonb_array_elements(v_variants) x loop
    v_vals := array(select btrim(x) from jsonb_array_elements_text(coalesce(v_var->'option_values', '[]'::jsonb)) x);
    if cardinality(v_vals) <> v_opt_count then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
        detail = format('each variant needs one value per option (%s)', v_opt_count);
    end if;
    v_key := lower(array_to_string(v_vals, '|'));
    if v_key = any (v_combos) then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
        detail = format('two variants are both "%s"', array_to_string(v_vals, ' / '));
    end if;
    v_combos := v_combos || v_key;

    -- resolve option values in option order
    select array_agg(pv.id order by po.position) into v_val_ids
      from unnest(v_vals) with ordinality u(val, n)
      join public.product_options po on po.product_id = v_id and po.position = u.n
      join public.product_option_values pv on pv.option_id = po.id and pv.value = u.val;
    if coalesce(cardinality(v_val_ids), 0) <> v_opt_count then
      raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
        detail = format('"%s" uses a value that is not in its option', array_to_string(v_vals, ' / '));
    end if;

    v_title := coalesce(nullif(btrim(v_var->>'title'), ''),
                        nullif(array_to_string(v_vals, ' / '), ''), 'Default');
    v_var_id := nullif(v_var->>'id', '')::uuid;

    begin
      if v_var_id is not null then
        update public.product_variants set
          title = v_title, sku = nullif(btrim(v_var->>'sku'), ''), barcode = nullif(btrim(v_var->>'barcode'), ''),
          price = (v_var->>'price')::numeric, compare_at_price = nullif(v_var->>'compare_at_price', '')::numeric,
          is_active = coalesce((v_var->>'is_active')::boolean, true)
        where id = v_var_id and product_id = v_id;
        if not found then
          raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'variant does not belong to this product';
        end if;
      else
        insert into public.product_variants
          (organization_id, product_id, title, sku, barcode, price, compare_at_price, is_active, position)
        values
          (p_organization_id, v_id, v_title, nullif(btrim(v_var->>'sku'), ''), nullif(btrim(v_var->>'barcode'), ''),
           (v_var->>'price')::numeric, nullif(v_var->>'compare_at_price', '')::numeric,
           coalesce((v_var->>'is_active')::boolean, true), cardinality(v_keep) + 1)
        returning id into v_var_id;
      end if;
    exception
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
          detail = case when v_constraint like '%barcode%' then format('barcode %s is already used', v_var->>'barcode')
                        else format('SKU %s is already used', v_var->>'sku') end;
      when check_violation or not_null_violation then
        raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
          detail = format('"%s": price is required and a compare-at price must be higher than the price', v_title);
    end;

    delete from public.variant_option_values where variant_id = v_var_id;
    insert into public.variant_option_values (organization_id, variant_id, option_value_id)
    select p_organization_id, v_var_id, x from unnest(v_val_ids) x;

    update public.product_variants set position = cardinality(v_keep) + 1 where id = v_var_id;
    v_keep := v_keep || v_var_id;
  end loop;

  update public.product_variants set is_active = false
   where product_id = v_id and not (id = any (v_keep)) and is_active;

  -- Attributes (structured specifications)
  if p_product ? 'attributes' then
    delete from public.product_attribute_values where product_id = v_id;
    for v_attr in select key, value from jsonb_each(coalesce(p_product->'attributes', '{}'::jsonb)) loop
      continue when v_attr.value is null or v_attr.value = 'null'::jsonb or v_attr.value = '""'::jsonb;
      insert into public.product_attribute_values (organization_id, product_id, attribute_id, value)
      select p_organization_id, v_id, ad.id, v_attr.value
        from public.attribute_definitions ad
       where ad.id = v_attr.key::uuid and ad.organization_id = p_organization_id;
    end loop;
  end if;

  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Organisation settings (a whitelist, not arbitrary JSON)
-- ---------------------------------------------------------------------------
create or replace function public.update_organization_settings(p_organization_id uuid, p_changes jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_allowed constant text[] := array['checkout_hold_minutes', 'checkout_max_line_quantity', 'discount_limits',
                                     'receipt_footer', 'contact_email', 'contact_phone', 'low_stock_default'];
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
  if exists (select 1 from jsonb_each_text(coalesce(p_changes->'settings'->'discount_limits', '{}'::jsonb)) d
              where d.key::text not in ('owner','admin','manager','cashier','stock_keeper','viewer')
                 or d.value::numeric < 0 or d.value::numeric > 100) then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'discount limits are 0-100 per role';
  end if;

  update public.organizations
     set name = coalesce(nullif(btrim(p_changes->>'name'), ''), name),
         prices_include_tax = coalesce((p_changes->>'prices_include_tax')::boolean, prices_include_tax),
         timezone = coalesce(nullif(p_changes->>'timezone', ''), timezone),
         settings = settings || coalesce(p_changes->'settings', '{}'::jsonb)
   where id = p_organization_id
  returning settings into v_settings;
  return v_settings;
end $$;

-- What the signed-in user needs to open the admin: their organisations, role,
-- permissions and switched-on modules.
create or replace function public.my_workspaces()
returns table (organization_id uuid, name text, slug text, currency_code char(3), timezone text,
               prices_include_tax boolean, settings jsonb, role public.staff_role, permissions text[],
               location_ids uuid[], modules public.module_key[])
language sql stable security definer set search_path = public, pg_temp as $$
  select o.id, o.name, o.slug, o.currency_code, o.timezone, o.prices_include_tax, o.settings,
         m.role, public.role_permissions(m.role), m.location_ids,
         coalesce((select array_agg(om.module order by om.module) from public.organization_modules om
                    where om.organization_id = o.id and om.enabled), '{}')
    from public.memberships m join public.organizations o on o.id = m.organization_id
   where m.user_id = auth.uid() and m.is_active
   order by o.name
$$;

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
create or replace function public.list_staff(p_organization_id uuid)
returns table (user_id uuid, email text, role public.staff_role, location_ids uuid[], is_active boolean,
               has_pin boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_permission(p_organization_id, 'staff.manage');
  return query
    select m.user_id, u.email::text, m.role, m.location_ids, m.is_active,
           exists (select 1 from public.staff_pins sp where sp.organization_id = m.organization_id and sp.user_id = m.user_id),
           m.created_at
      from public.memberships m join auth.users u on u.id = m.user_id
     where m.organization_id = p_organization_id
     order by m.is_active desc, m.role, u.email;
end $$;

-- Adds someone who already has an account. (Email invitations need the auth
-- admin API and come with the hosted Supabase project.)
create or replace function public.add_staff_by_email(
  p_organization_id uuid, p_email text, p_role public.staff_role, p_location_ids uuid[] default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid;
begin
  perform public.assert_permission(p_organization_id, 'staff.manage');
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  if v_user is null then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND',
      detail = 'no account uses that email yet - ask them to sign up first';
  end if;
  perform public.upsert_staff_member(p_organization_id, v_user, p_role, p_location_ids, true);
  return v_user;
end $$;

-- ---------------------------------------------------------------------------
-- Inventory read models
-- ---------------------------------------------------------------------------
create or replace function public.search_variants(
  p_organization_id uuid, p_query text, p_location_id uuid default null, p_limit int default 20)
returns table (variant_id uuid, product_id uuid, product_name text, variant_title text, sku text, barcode text,
               price numeric, status public.product_status, tracking_mode public.tracking_mode,
               unit_of_measure text, allow_fractional boolean, on_hand numeric, available numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (public.has_permission(p_organization_id, 'catalog.view')
          or public.has_permission(p_organization_id, 'inventory.view')) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED', detail = 'catalog.view';
  end if;
  return query
    select v.id, p.id, p.name, v.title, v.sku, v.barcode, v.price, p.status, p.tracking_mode,
           p.unit_of_measure, p.allow_fractional,
           case when p.tracking_mode = 'non_stock' then null else coalesce(sum(s.on_hand), 0) end,
           case when p.tracking_mode = 'non_stock' then null else coalesce(sum(s.on_hand - s.reserved), 0) end
      from public.product_variants v
      join public.products p on p.id = v.product_id
      left join public.stock_levels s on s.variant_id = v.id and (p_location_id is null or s.location_id = p_location_id)
     where v.organization_id = p_organization_id and v.is_active and p.status <> 'archived'
       and (coalesce(btrim(p_query), '') = ''
            or v.barcode = btrim(p_query)
            or v.sku ilike btrim(p_query) || '%'
            or p.name ilike '%' || btrim(p_query) || '%'
            or v.title ilike '%' || btrim(p_query) || '%')
     group by v.id, p.id
     order by (v.barcode = btrim(p_query) or lower(v.sku) = lower(btrim(p_query))) desc, p.name, v.position
     limit least(greatest(p_limit, 1), 100);
end $$;

create or replace function public.stock_overview(
  p_organization_id uuid, p_location_id uuid default null, p_query text default null,
  p_low_only boolean default false, p_limit int default 200, p_offset int default 0)
returns table (variant_id uuid, product_id uuid, product_name text, variant_title text, sku text,
               tracking_mode public.tracking_mode, unit_of_measure text,
               location_id uuid, location_name text, on_hand numeric, reserved numeric, available numeric,
               low_stock_threshold numeric, is_low boolean, avg_unit_cost numeric, stock_value numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_costs   boolean;
  v_default numeric;
begin
  perform public.assert_permission(p_organization_id, 'inventory.view');
  v_costs := public.has_permission(p_organization_id, 'reports.view');
  select coalesce((settings->>'low_stock_default')::numeric, 3) into v_default
    from public.organizations where id = p_organization_id;

  return query
    select v.id, p.id, p.name, v.title, v.sku, p.tracking_mode, p.unit_of_measure,
           l.id, l.name, s.on_hand, s.reserved, s.on_hand - s.reserved,
           s.low_stock_threshold,
           (s.on_hand - s.reserved) <= coalesce(s.low_stock_threshold, v_default),
           case when v_costs then s.avg_unit_cost end,
           case when v_costs then round(s.on_hand * s.avg_unit_cost, 2) end
      from public.stock_levels s
      join public.product_variants v on v.id = s.variant_id
      join public.products p on p.id = v.product_id
      join public.locations l on l.id = s.location_id
     where s.organization_id = p_organization_id
       and (p_location_id is null or s.location_id = p_location_id)
       and (coalesce(btrim(p_query), '') = '' or p.name ilike '%' || btrim(p_query) || '%'
            or v.sku ilike btrim(p_query) || '%' or v.barcode = btrim(p_query))
       and (not p_low_only or (s.on_hand - s.reserved) <= coalesce(s.low_stock_threshold, v_default))
     order by p.name, v.position, l.name
     limit least(greatest(p_limit, 1), 1000) offset greatest(p_offset, 0);
end $$;

create or replace function public.stock_movements(
  p_organization_id uuid, p_variant_id uuid, p_location_id uuid default null, p_limit int default 100)
returns table (id bigint, created_at timestamptz, location_name text, movement_type public.movement_type,
               quantity numeric, unit_cost numeric, lot_code text, serial text, source_type text,
               source_id uuid, reference text, note text, actor_email text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_costs boolean;
begin
  perform public.assert_permission(p_organization_id, 'inventory.view');
  v_costs := public.has_permission(p_organization_id, 'reports.view');
  return query
    select m.id, m.created_at, l.name, m.movement_type, m.quantity,
           case when v_costs then m.unit_cost end,
           b.lot_code, su.serial, m.source_type, m.source_id,
           coalesce(o.number, r.number), m.note, u.email::text
      from public.inventory_movements m
      join public.locations l on l.id = m.location_id
      left join public.batches b on b.id = m.batch_id
      left join public.serial_units su on su.id = m.serial_unit_id
      left join public.orders o on m.source_type = 'order' and o.id = m.source_id
      left join public.stock_receipts r on m.source_type = 'stock_receipt' and r.id = m.source_id
      left join auth.users u on u.id = m.created_by
     where m.organization_id = p_organization_id and m.variant_id = p_variant_id
       and (p_location_id is null or m.location_id = p_location_id)
     order by m.id desc
     limit least(greatest(p_limit, 1), 500);
end $$;

create or replace function public.set_low_stock_threshold(p_location_id uuid, p_variant_id uuid, p_threshold numeric)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.locations where id = p_location_id;
  if v_org is null or not exists (select 1 from public.product_variants where id = p_variant_id and organization_id = v_org) then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'location or variant';
  end if;
  perform public.assert_permission(v_org, 'inventory.adjust');
  if p_threshold is not null and p_threshold < 0 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'threshold cannot be negative';
  end if;
  perform public._lock_stock_row(v_org, p_location_id, p_variant_id);
  update public.stock_levels set low_stock_threshold = p_threshold
   where location_id = p_location_id and variant_id = p_variant_id;
end $$;

-- ---------------------------------------------------------------------------
-- Dashboard
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_summary(p_organization_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_default numeric;
begin
  perform public.assert_permission(p_organization_id, 'reports.view');
  select coalesce((settings->>'low_stock_default')::numeric, 3) into v_default
    from public.organizations where id = p_organization_id;

  return jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'orders', count(*), 'gross', coalesce(sum(o.subtotal), 0), 'discounts', coalesce(sum(o.discount_total), 0),
        'tax', coalesce(sum(o.tax_total), 0), 'sales', coalesce(sum(o.total), 0),
        'refunds', coalesce(sum(o.amount_refunded), 0),
        'net', coalesce(sum(o.total - o.amount_refunded), 0),
        'outstanding', coalesce(sum(greatest(o.total - o.amount_paid, 0)), 0))
        from public.orders o
       where o.organization_id = p_organization_id and o.status in ('confirmed', 'completed')
         and o.placed_at >= p_from and o.placed_at < p_to),
    'by_channel', coalesce((
      select jsonb_agg(jsonb_build_object('channel', c.channel, 'orders', c.n, 'sales', c.sales) order by c.sales desc)
        from (select o.channel, count(*) n, sum(o.total) sales from public.orders o
               where o.organization_id = p_organization_id and o.status in ('confirmed', 'completed')
                 and o.placed_at >= p_from and o.placed_at < p_to
               group by o.channel) c), '[]'::jsonb),
    'by_method', coalesce((
      select jsonb_agg(jsonb_build_object('method', x.method, 'amount', x.amount) order by x.amount desc)
        from (select p.method, sum(case when p.kind = 'payment' then p.amount else -p.amount end) amount
                from public.payments p
               where p.organization_id = p_organization_id and p.status = 'captured'
                 and p.created_at >= p_from and p.created_at < p_to
               group by p.method) x), '[]'::jsonb),
    'awaiting_payment', (select count(*) from public.orders o
                          where o.organization_id = p_organization_id and o.status = 'pending_payment'),
    'stock_conflicts', (select count(*) from public.orders o
                         where o.organization_id = p_organization_id and o.status = 'stock_conflict'),
    'low_stock', (select count(*) from public.stock_levels s
                   where s.organization_id = p_organization_id
                     and s.on_hand - s.reserved <= coalesce(s.low_stock_threshold, v_default)),
    'catalogue', jsonb_build_object(
      'products', (select count(*) from public.products p where p.organization_id = p_organization_id and p.status <> 'archived'),
      'active',   (select count(*) from public.products p where p.organization_id = p_organization_id and p.status = 'active'),
      'stocked',  (select count(distinct s.variant_id) from public.stock_levels s
                    where s.organization_id = p_organization_id and s.on_hand > 0)),
    'setup', jsonb_build_object(
      'has_tax_rate', exists (select 1 from public.tax_rates t where t.organization_id = p_organization_id and t.is_active),
      'has_product',  exists (select 1 from public.products p where p.organization_id = p_organization_id),
      'has_stock',    exists (select 1 from public.inventory_movements m where m.organization_id = p_organization_id),
      'has_staff',    (select count(*) > 1 from public.memberships m where m.organization_id = p_organization_id),
      'has_sale',     exists (select 1 from public.orders o where o.organization_id = p_organization_id)));
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
