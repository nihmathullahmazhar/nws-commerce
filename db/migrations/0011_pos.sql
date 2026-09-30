-- 0011_pos.sql
-- Phase 5: the counter. Tills (terminals), cashier shifts with a cash float,
-- paid in / paid out / cash drops, sales tied to the shift that took them,
-- held sales, receipts and X / Z shift reports.
--
-- Selling itself is place_order(): stock, prices, discounts, approvals and
-- tender rules are the same tested code whichever screen calls it.

set check_function_bodies = off;

create type public.shift_status as enum ('open', 'closed');
create type public.cash_movement_kind as enum ('paid_in', 'paid_out', 'drop');

-- ---------------------------------------------------------------------------
-- Tills
-- ---------------------------------------------------------------------------
create table public.pos_terminals (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id     uuid not null,
  code            text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,15}$'),
  name            text not null check (length(btrim(name)) > 0),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id)
);

create or replace function public.pos_terminals_enforce_module() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_module(new.organization_id, 'pos');
  return new;
end $$;
create trigger pos_terminals_module_guard before insert on public.pos_terminals
  for each row execute function public.pos_terminals_enforce_module();
create trigger pos_terminals_audit after insert or update on public.pos_terminals
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------------
-- Shifts
-- ---------------------------------------------------------------------------
create table public.pos_shifts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  terminal_id     uuid not null,
  location_id     uuid not null,
  number          text not null,
  status          public.shift_status not null default 'open',
  opened_by       uuid not null default auth.uid(),
  opened_at       timestamptz not null default now(),
  opening_float   numeric(14,2) not null check (opening_float >= 0),
  closed_by       uuid,
  closed_at       timestamptz,
  expected_cash   numeric(14,2),
  counted_cash    numeric(14,2) check (counted_cash is null or counted_cash >= 0),
  variance        numeric(14,2),
  close_note      text,
  unique (organization_id, number),
  unique (organization_id, id),
  foreign key (organization_id, terminal_id) references public.pos_terminals (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id),
  check ((status = 'closed') = (closed_at is not null))
);
-- One open shift per till.
create unique index pos_shifts_one_open on public.pos_shifts (terminal_id) where status = 'open';
create index pos_shifts_org_time_idx on public.pos_shifts (organization_id, opened_at desc);

create table public.pos_cash_movements (
  id              bigint generated always as identity primary key,
  organization_id uuid not null,
  shift_id        uuid not null,
  kind            public.cash_movement_kind not null,
  amount          numeric(14,2) not null check (amount > 0),
  reason          text not null check (length(btrim(reason)) >= 3),
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  foreign key (organization_id, shift_id) references public.pos_shifts (organization_id, id)
);
create trigger pos_cash_movements_append_only before update or delete on public.pos_cash_movements
  for each row execute function public.prevent_mutation();

-- Sales and money taken at a till know which till and shift.
alter table public.orders
  add column terminal_id uuid,
  add column shift_id    uuid,
  add foreign key (organization_id, terminal_id) references public.pos_terminals (organization_id, id),
  add foreign key (organization_id, shift_id) references public.pos_shifts (organization_id, id);
create index orders_shift_idx on public.orders (shift_id) where shift_id is not null;

alter table public.payments
  add column shift_id uuid,
  add foreign key (organization_id, shift_id) references public.pos_shifts (organization_id, id);
create index payments_shift_idx on public.payments (shift_id) where shift_id is not null;

-- ---------------------------------------------------------------------------
-- Held sales (a parked ticket: no stock is held, prices are rechecked on resume)
-- ---------------------------------------------------------------------------
create table public.pos_held_sales (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  terminal_id     uuid not null,
  label           text,
  lines           jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0),
  customer_id     uuid,
  created_by      uuid not null default auth.uid(),
  created_at      timestamptz not null default now(),
  foreign key (organization_id, terminal_id) references public.pos_terminals (organization_id, id) on delete cascade,
  foreign key (organization_id, customer_id) references public.customers (organization_id, id) on delete set null (customer_id)
);
create index pos_held_sales_terminal_idx on public.pos_held_sales (terminal_id, created_at);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- The caller's own open shift, locked. Only the cashier who opened a shift sells on it.
create or replace function public._my_open_shift(p_shift_id uuid) returns public.pos_shifts
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.pos_shifts%rowtype;
begin
  select * into s from public.pos_shifts where id = p_shift_id for share;
  if not found then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'shift';
  end if;
  perform public.assert_module(s.organization_id, 'pos');
  perform public.assert_permission(s.organization_id, 'pos.sell');
  if s.status <> 'open' then
    raise exception using errcode = 'NC006', message = 'INVALID_STATE', detail = 'this shift is closed - open a new one';
  end if;
  if s.opened_by is distinct from auth.uid() and not public.is_platform_admin() then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED', detail = 'this shift belongs to another cashier';
  end if;
  return s;
end $$;

create or replace function public._shift_expected_cash(p_shift_id uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select s.opening_float
       + coalesce((select sum(case when p.kind = 'payment' then p.amount else -p.amount end)
                     from public.payments p
                    where p.shift_id = s.id and p.method = 'cash' and p.status = 'captured'), 0)
       + coalesce((select sum(case when m.kind = 'paid_in' then m.amount else -m.amount end)
                     from public.pos_cash_movements m where m.shift_id = s.id), 0)
    from public.pos_shifts s where s.id = p_shift_id
$$;

-- ---------------------------------------------------------------------------
-- Commands
-- ---------------------------------------------------------------------------
create or replace function public.pos_open_shift(p_terminal_id uuid, p_opening_float numeric) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t public.pos_terminals%rowtype;
  v_id uuid;
begin
  select * into t from public.pos_terminals where id = p_terminal_id and is_active;
  if not found then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'till';
  end if;
  perform public.assert_module(t.organization_id, 'pos');
  perform public.assert_permission(t.organization_id, 'pos.sell');
  perform public.assert_location_access(t.organization_id, t.location_id);
  if p_opening_float is null or p_opening_float < 0 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'count the float in the drawer (0 or more)';
  end if;
  begin
    insert into public.pos_shifts (organization_id, terminal_id, location_id, number, opening_float)
    values (t.organization_id, t.id, t.location_id,
            public.next_document_number(t.organization_id, 'shift', 'SH-'), p_opening_float)
    returning id into v_id;
  exception when unique_violation then
    raise exception using errcode = 'NC006', message = 'INVALID_STATE', detail = 'this till already has an open shift - close it first';
  end;
  return public.pos_shift_summary(v_id);
end $$;

-- A sale at the counter: place_order on the caller's own open shift.
create or replace function public.pos_sale(
  p_shift_id        uuid,
  p_lines           jsonb,
  p_payments        jsonb,
  p_idempotency_key text,
  p_customer_id     uuid default null,
  p_order_discount  jsonb default null,
  p_approval_id     uuid default null,
  p_note            text default null,
  p_coupon          text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s        public.pos_shifts%rowtype;
  v_result jsonb;
  v_order  uuid;
begin
  s := public._my_open_shift(p_shift_id);
  perform set_config('nwsc.coupon', coalesce(p_coupon, ''), true);
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'an idempotency key is required';
  end if;

  perform set_config('nwsc.pos_shift', s.id::text, true);
  v_result := public.place_order(s.location_id, 'pos', p_lines, p_customer_id, p_idempotency_key, p_note,
                                 p_payments, p_order_discount, p_approval_id);
  v_order := (v_result->>'order_id')::uuid;

  if not (v_result ? 'replayed') then
    update public.orders set terminal_id = s.terminal_id, shift_id = s.id, fulfilment_method = 'in_store'
     where id = v_order;
    update public.payments set shift_id = s.id where order_id = v_order and shift_id is null;
  end if;
  return v_result || jsonb_build_object('shift_id', s.id);
end $$;

-- Money taken at the till against an earlier order (a phone order collected in store).
create or replace function public.pos_take_payment(
  p_shift_id uuid, p_order_id uuid, p_method public.payment_method, p_amount numeric, p_reference text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s        public.pos_shifts%rowtype;
  v_result jsonb;
begin
  s := public._my_open_shift(p_shift_id);
  v_result := public.record_payment(p_order_id, p_method, p_amount, p_reference, null);
  update public.payments set shift_id = s.id
   where id = (select p.id from public.payments p where p.order_id = p_order_id order by p.created_at desc, p.id desc limit 1)
     and shift_id is null;
  return v_result;
end $$;

create or replace function public.pos_cash_movement(
  p_shift_id uuid, p_kind public.cash_movement_kind, p_amount numeric, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.pos_shifts%rowtype;
begin
  s := public._my_open_shift(p_shift_id);
  if p_amount is null or p_amount <= 0 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'amount must be positive';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'say what the cash is for';
  end if;
  if p_kind in ('paid_out', 'drop') and p_amount > public._shift_expected_cash(s.id) then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'there is not that much cash in the drawer';
  end if;
  insert into public.pos_cash_movements (organization_id, shift_id, kind, amount, reason)
  values (s.organization_id, s.id, p_kind, p_amount, btrim(p_reason));
  return public.pos_shift_summary(s.id);
end $$;

create or replace function public.pos_close_shift(p_shift_id uuid, p_counted_cash numeric, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s          public.pos_shifts%rowtype;
  v_expected numeric;
begin
  select * into s from public.pos_shifts where id = p_shift_id for update;
  if not found then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'shift';
  end if;
  if s.status = 'closed' then
    raise exception using errcode = 'NC006', message = 'INVALID_STATE', detail = 'this shift is already closed';
  end if;
  -- The cashier closes their own shift; a manager can close anyone's.
  if s.opened_by = auth.uid() then
    perform public.assert_permission(s.organization_id, 'pos.sell');
  else
    perform public.assert_permission(s.organization_id, 'pos.override');
  end if;
  if p_counted_cash is null or p_counted_cash < 0 then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT', detail = 'count the cash in the drawer';
  end if;

  v_expected := public._shift_expected_cash(s.id);
  if p_counted_cash <> v_expected and coalesce(btrim(p_note), '') = '' then
    raise exception using errcode = 'NC003', message = 'INVALID_INPUT',
      detail = format('the drawer is %s by %s - add a note to explain it',
                      case when p_counted_cash > v_expected then 'over' else 'short' end, abs(p_counted_cash - v_expected));
  end if;

  update public.pos_shifts
     set status = 'closed', closed_by = auth.uid(), closed_at = now(), expected_cash = v_expected,
         counted_cash = p_counted_cash, variance = p_counted_cash - v_expected, close_note = nullif(btrim(p_note), '')
   where id = s.id;
  -- Parked tickets on this till do not survive the shift.
  delete from public.pos_held_sales where terminal_id = s.terminal_id;
  return public.pos_shift_summary(s.id);
end $$;

-- X report while open, Z report once closed: the same figures.
create or replace function public.pos_shift_summary(p_shift_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  s public.pos_shifts%rowtype;
begin
  select * into s from public.pos_shifts where id = p_shift_id;
  if not found then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'shift';
  end if;
  if s.opened_by is distinct from auth.uid() and not public.has_permission(s.organization_id, 'reports.view') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED', detail = 'reports.view';
  end if;

  return jsonb_build_object(
    'shift_id', s.id, 'number', s.number, 'status', s.status,
    'terminal', (select jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name) from public.pos_terminals t where t.id = s.terminal_id),
    'location', (select l.name from public.locations l where l.id = s.location_id),
    'cashier', (select u.email from auth.users u where u.id = s.opened_by),
    'opened_at', s.opened_at, 'closed_at', s.closed_at,
    'opening_float', s.opening_float,
    'sales', (select jsonb_build_object(
                'count', count(*), 'gross', coalesce(sum(o.subtotal), 0), 'discounts', coalesce(sum(o.discount_total), 0),
                'tax', coalesce(sum(o.tax_total), 0), 'total', coalesce(sum(o.total), 0))
                from public.orders o where o.shift_id = s.id and o.status in ('confirmed', 'completed')),
    'by_method', coalesce((select jsonb_agg(jsonb_build_object('method', x.method, 'taken', x.taken, 'refunded', x.refunded, 'net', x.taken - x.refunded) order by x.method)
                  from (select p.method,
                               coalesce(sum(p.amount) filter (where p.kind = 'payment'), 0) taken,
                               coalesce(sum(p.amount) filter (where p.kind = 'refund'), 0) refunded
                          from public.payments p where p.shift_id = s.id and p.status = 'captured'
                         group by p.method) x), '[]'::jsonb),
    'cash_movements', coalesce((select jsonb_agg(jsonb_build_object('kind', m.kind, 'amount', m.amount, 'reason', m.reason, 'at', m.created_at) order by m.id)
                       from public.pos_cash_movements m where m.shift_id = s.id), '[]'::jsonb),
    'expected_cash', coalesce(s.expected_cash, public._shift_expected_cash(s.id)),
    'counted_cash', s.counted_cash, 'variance', s.variance, 'close_note', s.close_note);
end $$;

create or replace function public.pos_hold_sale(p_shift_id uuid, p_lines jsonb, p_customer_id uuid default null, p_label text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s    public.pos_shifts%rowtype;
  v_id uuid;
begin
  s := public._my_open_shift(p_shift_id);
  -- Validates the lines now so a bad ticket is not parked.
  perform count(*) from public._order_input(s.organization_id, p_lines);
  insert into public.pos_held_sales (organization_id, terminal_id, label, lines, customer_id)
  values (s.organization_id, s.terminal_id, nullif(btrim(p_label), ''), p_lines, p_customer_id)
  returning id into v_id;
  return v_id;
end $$;

-- Takes a held ticket back off the shelf (it is removed; the till rings it up again).
create or replace function public.pos_resume_sale(p_shift_id uuid, p_held_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.pos_shifts%rowtype;
  h public.pos_held_sales%rowtype;
begin
  s := public._my_open_shift(p_shift_id);
  delete from public.pos_held_sales where id = p_held_id and terminal_id = s.terminal_id returning * into h;
  if not found then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'held sale (already resumed?)';
  end if;
  return jsonb_build_object('lines', h.lines, 'customer_id', h.customer_id, 'label', h.label);
end $$;

-- Everything a printed or emailed receipt needs.
create or replace function public.pos_receipt(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order_id;
  if not found or not (public.has_permission(o.organization_id, 'orders.view') or public.has_permission(o.organization_id, 'pos.sell')) then
    raise exception using errcode = 'NC005', message = 'NOT_FOUND', detail = 'order';
  end if;
  return public._order_summary(o.id) || jsonb_build_object(
    'business', (select jsonb_build_object('name', g.name, 'phone', g.settings->>'contact_phone', 'footer', g.settings->>'receipt_footer')
                   from public.organizations g where g.id = o.organization_id),
    'location', (select jsonb_build_object('name', l.name, 'address', l.address, 'phone', l.phone) from public.locations l where l.id = o.location_id),
    'terminal', (select t.name from public.pos_terminals t where t.id = o.terminal_id),
    'cashier', (select u.email from auth.users u where u.id = o.placed_by),
    'customer', (select jsonb_build_object('name', c.full_name, 'phone', c.phone, 'loyalty_points', c.loyalty_points) from public.customers c where c.id = o.customer_id),
    'gift_cards', coalesce((select jsonb_agg(jsonb_build_object('code', g.code, 'value', g.initial_value) order by g.created_at)
                             from public.gift_cards g join public.order_lines ol on ol.id = g.order_line_id where ol.order_id = o.id), '[]'::jsonb),
    'points_earned', (select points from public.loyalty_ledger where source_type = 'order_earned' and source_id = o.id));
end $$;

-- ---------------------------------------------------------------------------
-- Read models for the POS screen
-- ---------------------------------------------------------------------------
-- The ticket's totals as the sale will charge them (a rolled-back draft through
-- the real pricing code), whether the discount needs a manager, and shelf stock.
create or replace function public.pos_quote(p_shift_id uuid, p_lines jsonb, p_order_discount jsonb default null, p_coupon text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s        public.pos_shifts%rowtype;
  v_org    public.organizations%rowtype;
  v_order  uuid;
  v_pct    numeric;
  v_limit  numeric;
  v_result jsonb;
begin
  s := public._my_open_shift(p_shift_id);
  perform set_config('nwsc.coupon', coalesce(p_coupon, ''), true);
  select * into v_org from public.organizations where id = s.organization_id;
  v_limit := case when public.is_platform_admin() then 100 else coalesce(public._discount_limit(s.organization_id, auth.uid()), 0) end;
  begin
    insert into public.orders (organization_id, number, channel, location_id, status, currency_code, tax_inclusive)
    values (s.organization_id, 'QUOTE-' || gen_random_uuid(), 'pos', s.location_id, 'pending_payment',
            v_org.currency_code, v_org.prices_include_tax)
    returning id into v_order;
    v_pct := public._write_order_lines(s.organization_id, v_order, p_lines, p_order_discount, true);
    v_result := public._order_summary(v_order);
    raise exception using errcode = 'NCQ00', message = 'QUOTE_ROLLBACK';
  exception when sqlstate 'NCQ00' then
    null;
  end;
  return (v_result - 'order_id' - 'number' - 'status' - 'payments' - 'contact' - 'shipping_address'
                   - 'intended_payment_method' - 'reservation_expires_at' - 'placed_at' - 'customer_id')
         || jsonb_build_object(
              'discount_percent', v_pct, 'my_discount_limit', v_limit, 'needs_approval', v_pct > v_limit,
              'stock', coalesce((select jsonb_object_agg(sl.variant_id, sl.on_hand - sl.reserved)
                                   from public.stock_levels sl
                                  where sl.location_id = s.location_id
                                    and sl.variant_id in (select (e->>'variant_id')::uuid from jsonb_array_elements(p_lines) e)), '{}'::jsonb));
end $$;

-- Who may approve at this till (names only; cashiers cannot list staff).
create or replace function public.pos_approvers(p_organization_id uuid)
returns table (user_id uuid, email text, role public.staff_role, discount_limit numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_permission(p_organization_id, 'pos.sell');
  return query
    select m.user_id, u.email::text, m.role, public._discount_limit(p_organization_id, m.user_id)
      from public.memberships m join auth.users u on u.id = m.user_id
     where m.organization_id = p_organization_id and m.is_active and m.user_id <> auth.uid()
       and public.role_permissions(m.role) && array['*', 'pos.override']
       and exists (select 1 from public.staff_pins sp where sp.organization_id = m.organization_id and sp.user_id = m.user_id)
     order by m.role, u.email;
end $$;

-- What the till screen needs on start: my tills and any shift I left open.
create or replace function public.pos_context(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_module(p_organization_id, 'pos');
  perform public.assert_permission(p_organization_id, 'pos.sell');
  return jsonb_build_object(
    'terminals', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'code', t.code, 'name', t.name, 'location_id', t.location_id, 'location', l.name,
               'open_shift', (select jsonb_build_object('id', sh.id, 'number', sh.number, 'cashier', u.email,
                                                        'mine', sh.opened_by = auth.uid(), 'opened_at', sh.opened_at)
                                from public.pos_shifts sh join auth.users u on u.id = sh.opened_by
                               where sh.terminal_id = t.id and sh.status = 'open'))
             order by l.name, t.code)
        from public.pos_terminals t join public.locations l on l.id = t.location_id
       where t.organization_id = p_organization_id and t.is_active and l.is_active
         and public.has_location_access(p_organization_id, t.location_id)), '[]'::jsonb),
    'my_open_shift', (select public.pos_shift_summary(sh.id) from public.pos_shifts sh
                       where sh.organization_id = p_organization_id and sh.opened_by = auth.uid() and sh.status = 'open'
                       order by sh.opened_at desc limit 1));
end $$;

-- ---------------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------------
alter table public.pos_terminals enable row level security;
alter table public.pos_shifts enable row level security;
alter table public.pos_cash_movements enable row level security;
alter table public.pos_held_sales enable row level security;

grant select on public.pos_terminals, public.pos_shifts, public.pos_cash_movements, public.pos_held_sales to authenticated;
grant insert, update on public.pos_terminals to authenticated;
grant all on public.pos_terminals, public.pos_shifts, public.pos_cash_movements, public.pos_held_sales to service_role;
revoke all on public.pos_terminals, public.pos_shifts, public.pos_cash_movements, public.pos_held_sales from anon;
revoke insert, update, delete, truncate on public.pos_shifts, public.pos_cash_movements, public.pos_held_sales from authenticated;

create policy pos_terminals_read on public.pos_terminals for select
  using (public.has_permission(organization_id, 'pos.sell') or public.has_permission(organization_id, 'reports.view'));
create policy pos_terminals_insert on public.pos_terminals for insert
  with check (public.has_permission(organization_id, 'locations.manage'));
create policy pos_terminals_update on public.pos_terminals for update
  using (public.has_permission(organization_id, 'locations.manage'))
  with check (public.has_permission(organization_id, 'locations.manage'));
create policy pos_shifts_read on public.pos_shifts for select
  using (opened_by = auth.uid() or public.has_permission(organization_id, 'reports.view'));
create policy pos_cash_movements_read on public.pos_cash_movements for select
  using (public.has_permission(organization_id, 'reports.view')
         or exists (select 1 from public.pos_shifts s where s.id = shift_id and s.opened_by = auth.uid()));
create policy pos_held_sales_read on public.pos_held_sales for select
  using (public.has_permission(organization_id, 'pos.sell'));

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

grant execute on function
  public.is_platform_admin(), public.role_permissions(public.staff_role), public.is_member(uuid),
  public.has_permission(uuid, text), public.has_location_access(uuid, uuid),
  public.module_enabled(uuid, public.module_key), public.owns_order(uuid), public.slugify(text)
  to anon, authenticated;

grant execute on function
  public.storefront_organization(text), public.storefront_settings(uuid), public.storefront_availability(uuid, uuid[]),
  public.storefront_categories(uuid), public.storefront_catalog(uuid, text, text, jsonb, text, int, int),
  public.storefront_product(uuid, text), public.cart_get(uuid, text), public.cart_set_item(uuid, text, uuid, numeric),
  public.cart_clear(uuid, text), public.quote_order(uuid, jsonb, public.fulfilment_method, text, public.sales_channel),
  public.checkout(uuid, jsonb, text, jsonb, jsonb, public.payment_method, public.sales_channel, text, text),
  public.get_order_by_token(uuid, text), public.start_checkout(uuid, jsonb, text, public.sales_channel, uuid, text)
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
  public.dashboard_summary(uuid, timestamptz, timestamptz),
  public.pos_open_shift(uuid, numeric),
  public.pos_sale(uuid, jsonb, jsonb, text, uuid, jsonb, uuid, text, text),
  public.pos_take_payment(uuid, uuid, public.payment_method, numeric, text),
  public.pos_cash_movement(uuid, public.cash_movement_kind, numeric, text),
  public.pos_close_shift(uuid, numeric, text),
  public.pos_shift_summary(uuid),
  public.pos_hold_sale(uuid, jsonb, uuid, text),
  public.pos_resume_sale(uuid, uuid),
  public.pos_receipt(uuid),
  public.pos_quote(uuid, jsonb, jsonb, text),
  public.pos_approvers(uuid),
  public.pos_context(uuid)
  to authenticated;

alter publication supabase_realtime add table public.pos_held_sales;
