-- _helpers.sql - shared by the SQL suites (included with \ir). Session-local.

-- ---------------------------------------------------------------------------
create function pg_temp.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_cond, false) then raise notice 'OK: %', p_label;
  else raise notice 'PROBLEM: %', p_label; end if;
end $$;

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
  perform set_config('request.jwt.claim.role', case when p_user is null then 'anon' else 'authenticated' end, false);
end $$;

create function pg_temp.act_as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claim.role', 'service_role', false);
end $$;

-- Runs p_sql (optionally as a database role) and checks it fails with p_state.
create function pg_temp.expect_error(p_sql text, p_state text, p_label text, p_role text default null)
returns void language plpgsql as $$
declare v_state text; v_msg text; v_detail text;
begin
  begin
    if p_role is not null then execute format('set local role %I', p_role); end if;
    execute p_sql;
    reset role;
    raise notice 'PROBLEM: % (no error raised)', p_label;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_detail = pg_exception_detail;
    if v_state = p_state then raise notice 'OK: % (% %)', p_label, v_state, v_msg;
    else raise notice 'PROBLEM: % (expected %, got % % %)', p_label, p_state, v_state, v_msg, v_detail; end if;
  end;
end $$;

-- Runs p_sql as a database role and returns its single value as text.
create function pg_temp.scalar_as(p_role text, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute format('set local role %I', p_role);
  execute p_sql into v;
  reset role;
  return v;
end $$;

create function pg_temp.line(p_variant uuid, p_qty numeric, p_serials text[] default null, p_lot text default null)
returns jsonb language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object('variant_id', p_variant, 'quantity', p_qty,
                                              'serials', to_jsonb(p_serials), 'lot_code', p_lot))
$$;

create function pg_temp.on_hand(p_location uuid, p_variant uuid) returns numeric language sql as $$
  select coalesce((select on_hand from public.stock_levels where location_id = p_location and variant_id = p_variant), 0)
$$;
create function pg_temp.reserved(p_location uuid, p_variant uuid) returns numeric language sql as $$
  select coalesce((select reserved from public.stock_levels where location_id = p_location and variant_id = p_variant), 0)
$$;

