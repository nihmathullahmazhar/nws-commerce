-- 0007_security.sql
-- Row-level security on every table, write access closed on everything the
-- commands own, and an explicit allowlist of callable functions.
--
-- Supabase grants ALL on new tables to anon/authenticated by default, so the
-- revokes below matter there; locally they document intent.

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'organizations','plans','organization_modules','memberships','locations','audit_log',
    'brands','categories','attribute_definitions','category_attributes','products',
    'product_options','product_option_values','product_variants','variant_option_values',
    'product_attribute_values','product_media',
    'stock_levels','batches','batch_stock','serial_units','stock_receipts','inventory_movements',
    'stock_reservations','customers','document_sequences','orders','order_lines','order_line_units']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Table privileges
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Public catalogue and store info: anyone may read (RLS narrows to active rows).
grant select on public.plans, public.locations, public.brands, public.categories,
  public.attribute_definitions, public.category_attributes, public.products, public.product_options,
  public.product_option_values, public.product_variants, public.variant_option_values,
  public.product_attribute_values, public.product_media
  to anon, authenticated;

-- Staff-only reads.
grant select on public.organizations, public.organization_modules, public.memberships, public.audit_log,
  public.stock_levels, public.batches, public.batch_stock, public.serial_units, public.stock_receipts,
  public.inventory_movements, public.stock_reservations, public.customers, public.orders,
  public.order_lines, public.order_line_units
  to authenticated;

-- Direct writes are allowed only where the table is plain master data.
grant insert, update, delete on public.brands, public.categories, public.attribute_definitions,
  public.category_attributes, public.products, public.product_options, public.product_option_values,
  public.product_variants, public.variant_option_values, public.product_attribute_values,
  public.product_media
  to authenticated;
grant insert, update on public.locations, public.customers to authenticated;

-- Everything the commands own is closed to direct writes, whatever the defaults.
revoke insert, update, delete, truncate on public.organizations, public.plans, public.organization_modules,
  public.memberships, public.audit_log, public.stock_levels, public.batches, public.batch_stock,
  public.serial_units, public.stock_receipts, public.inventory_movements, public.stock_reservations,
  public.document_sequences, public.orders, public.order_lines, public.order_line_units
  from anon, authenticated;
revoke all on public.organizations, public.organization_modules, public.memberships, public.audit_log,
  public.stock_levels, public.batches, public.batch_stock, public.serial_units, public.stock_receipts,
  public.inventory_movements, public.stock_reservations, public.document_sequences, public.customers,
  public.orders, public.order_lines, public.order_line_units
  from anon;
revoke all on public.document_sequences from authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

create policy plans_read on public.plans for select using (true);

create policy organizations_read on public.organizations for select
  using (public.is_member(id));

create policy organization_modules_read on public.organization_modules for select
  using (public.is_member(organization_id));

create policy memberships_read on public.memberships for select
  using (user_id = auth.uid() or public.has_permission(organization_id, 'staff.manage'));

create policy audit_log_read on public.audit_log for select
  using (public.has_permission(organization_id, 'audit.view'));

-- Locations double as the public store directory.
create policy locations_read on public.locations for select
  using (is_active or public.is_member(organization_id));
create policy locations_insert on public.locations for insert
  with check (public.has_permission(organization_id, 'locations.manage'));
create policy locations_update on public.locations for update
  using (public.has_permission(organization_id, 'locations.manage'))
  with check (public.has_permission(organization_id, 'locations.manage'));

-- Catalogue: shoppers see what is live, staff see everything, managers edit.
do $$
declare t text;
begin
  foreach t in array array['brands','categories'] loop
    execute format($f$
      create policy %1$s_read on public.%1$I for select
        using (is_active or public.is_member(organization_id))$f$, t);
  end loop;

  foreach t in array array['attribute_definitions','category_attributes'] loop
    execute format($f$
      create policy %1$s_read on public.%1$I for select using (true)$f$, t);
  end loop;

  foreach t in array array['brands','categories','attribute_definitions','category_attributes','products',
                           'product_options','product_option_values','product_variants',
                           'variant_option_values','product_attribute_values','product_media'] loop
    execute format($f$
      create policy %1$s_insert on public.%1$I for insert
        with check (public.has_permission(organization_id, 'catalog.manage'))$f$, t);
    execute format($f$
      create policy %1$s_update on public.%1$I for update
        using (public.has_permission(organization_id, 'catalog.manage'))
        with check (public.has_permission(organization_id, 'catalog.manage'))$f$, t);
    execute format($f$
      create policy %1$s_delete on public.%1$I for delete
        using (public.has_permission(organization_id, 'catalog.manage'))$f$, t);
  end loop;
end $$;

create policy products_read on public.products for select
  using (status = 'active' or public.is_member(organization_id));

create policy product_variants_read on public.product_variants for select
  using (public.is_member(organization_id) or (is_active and exists (
    select 1 from public.products p where p.id = product_id and p.status = 'active')));

create policy product_options_read on public.product_options for select
  using (public.is_member(organization_id) or exists (
    select 1 from public.products p where p.id = product_id and p.status = 'active'));

create policy product_option_values_read on public.product_option_values for select
  using (public.is_member(organization_id) or exists (
    select 1 from public.product_options o join public.products p on p.id = o.product_id
     where o.id = option_id and p.status = 'active'));

create policy variant_option_values_read on public.variant_option_values for select
  using (public.is_member(organization_id) or exists (
    select 1 from public.product_variants v join public.products p on p.id = v.product_id
     where v.id = variant_id and v.is_active and p.status = 'active'));

create policy product_attribute_values_read on public.product_attribute_values for select
  using (public.is_member(organization_id) or exists (
    select 1 from public.products p where p.id = product_id and p.status = 'active'));

create policy product_media_read on public.product_media for select
  using (public.is_member(organization_id) or exists (
    select 1 from public.products p where p.id = product_id and p.status = 'active'));

-- Stock: readable by staff with inventory.view, writable by nobody.
do $$
declare t text;
begin
  foreach t in array array['stock_levels','batches','batch_stock','serial_units','stock_receipts',
                           'inventory_movements','stock_reservations'] loop
    execute format($f$
      create policy %1$s_read on public.%1$I for select
        using (public.has_permission(organization_id, 'inventory.view'))$f$, t);
  end loop;
end $$;

-- Customers: themselves, or staff.
create policy customers_read on public.customers for select
  using ((auth_user_id is not null and auth_user_id = auth.uid())
         or public.has_permission(organization_id, 'customers.view'));
create policy customers_insert on public.customers for insert
  with check (public.has_permission(organization_id, 'customers.manage'));
create policy customers_update on public.customers for update
  using (public.has_permission(organization_id, 'customers.manage'))
  with check (public.has_permission(organization_id, 'customers.manage'));

-- Orders: staff with orders.view, or the customer the order belongs to.
create or replace function public.owns_order(p_order uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and exists (
    select 1 from public.orders o join public.customers c on c.id = o.customer_id
     where o.id = p_order and c.auth_user_id = auth.uid())
$$;

create policy orders_read on public.orders for select
  using (public.has_permission(organization_id, 'orders.view') or public.owns_order(id));
create policy order_lines_read on public.order_lines for select
  using (public.has_permission(organization_id, 'orders.view') or public.owns_order(order_id));
create policy order_line_units_read on public.order_line_units for select
  using (public.has_permission(organization_id, 'orders.view') or exists (
    select 1 from public.order_lines ol where ol.id = order_line_id and public.owns_order(ol.order_id)));

-- document_sequences: no policy at all, so no API access.

-- ---------------------------------------------------------------------------
-- Function privileges: closed by default, explicit allowlist
-- ---------------------------------------------------------------------------
-- PostgreSQL grants EXECUTE to PUBLIC on every new function and anon /
-- authenticated inherit it, so PUBLIC is the grant that has to go.
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public;
grant execute on all functions in schema public to service_role;

-- Used inside RLS policies, so every API role must be able to call them.
grant execute on function
  public.is_platform_admin(), public.role_permissions(public.staff_role), public.is_member(uuid),
  public.has_permission(uuid, text), public.has_location_access(uuid, uuid),
  public.module_enabled(uuid, public.module_key), public.owns_order(uuid)
  to anon, authenticated;

-- Storefront (guests and signed-in shoppers).
grant execute on function
  public.storefront_organization(text),
  public.storefront_availability(uuid, uuid[]),
  public.start_checkout(uuid, jsonb, text, public.sales_channel, uuid, text)
  to anon, authenticated;

-- Signed-in users (staff commands check their own permissions).
grant execute on function
  public.cancel_order(uuid, text),
  public.place_order(uuid, public.sales_channel, jsonb, uuid, text, text),
  public.confirm_order(uuid),
  public.receive_stock(uuid, jsonb, text, text),
  public.adjust_stock(uuid, uuid, numeric, public.movement_type, text, text[], text, date, numeric),
  public.lookup_serial(uuid, text),
  public.inventory_integrity_report(uuid),
  public.upsert_staff_member(uuid, uuid, public.staff_role, uuid[], boolean)
  to authenticated;

-- create_organization, apply_plan, set_organization_module, expire_reservations:
-- service_role only (granted above).

-- ---------------------------------------------------------------------------
-- Realtime: staff screens (POS, stock views) follow stock and order changes.
-- Realtime applies the same RLS, so shoppers receive nothing from these.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.stock_levels, public.orders;
