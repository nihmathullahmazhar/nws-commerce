#!/usr/bin/env bash
# Concurrency proof. Separate database sessions - POS counters and online
# shoppers - wait at a barrier and then all try to take the same stock at the
# same instant. The database must let exactly as many succeed as there are
# units, refuse the rest cleanly, deadlock never, and leave the ledger exact.
#
# Usage: race.sh <database>   (the schema must already be applied)
set -euo pipefail
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
DB="$1"
WORK="$(mktemp -d -t nwsc_race)"
trap 'rm -rf "$WORK"' EXIT
FAIL=0

q() { psql -X -Atq -v ON_ERROR_STOP=1 -d "$DB" -c "$1"; }

ok()      { echo "OK: $1"; }
problem() { echo "PROBLEM: $1"; FAIL=1; }

# ---------------------------------------------------------------------------
# Setup: one organisation, three cashiers, four contested items
# ---------------------------------------------------------------------------
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null <<'SQL'
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'race-owner@test'),
  ('a0000000-0000-0000-0000-000000000002', 'race-till1@test'),
  ('a0000000-0000-0000-0000-000000000003', 'race-till2@test'),
  ('a0000000-0000-0000-0000-000000000004', 'race-till3@test');

select set_config('request.jwt.claim.role', 'service_role', false);
create table public.race_ctx (key text primary key, id uuid);
insert into public.race_ctx
select 'org', public.create_organization('Race Shop', 'race-shop', 'a0000000-0000-0000-0000-000000000001', 'omnichannel');
select public.set_organization_module((select id from public.race_ctx where key = 'org'), 'serial_tracking', true);
select public.set_organization_module((select id from public.race_ctx where key = 'org'), 'batch_tracking', true);
insert into public.race_ctx select 'main', id from public.locations
 where organization_id = (select id from public.race_ctx where key = 'org');

select public.upsert_staff_member((select id from public.race_ctx where key = 'org'), u, 'cashier')
  from unnest(array['a0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000003',
                    'a0000000-0000-0000-0000-000000000004']::uuid[]) u;

do $$
declare
  v_org  uuid := (select id from public.race_ctx where key = 'org');
  v_main uuid := (select id from public.race_ctx where key = 'main');
  v_p uuid; v_v uuid;
begin
  -- last-unit: 1 in stock
  insert into public.products (organization_id, name, slug, status) values (v_org, 'Last Unit', 'last-unit', 'active') returning id into v_p;
  insert into public.product_variants (organization_id, product_id, sku, price) values (v_org, v_p, 'LAST', 100) returning id into v_v;
  insert into public.race_ctx values ('last', v_v);
  perform public.receive_stock(v_main, jsonb_build_array(jsonb_build_object('variant_id', v_v, 'quantity', 1, 'unit_cost', 50)));

  -- serial: a single identified unit
  insert into public.products (organization_id, name, slug, status, tracking_mode) values (v_org, 'One Device', 'one-device', 'active', 'serial') returning id into v_p;
  insert into public.product_variants (organization_id, product_id, sku, price) values (v_org, v_p, 'DEV', 1000) returning id into v_v;
  insert into public.race_ctx values ('device', v_v);
  perform public.receive_stock(v_main, jsonb_build_array(jsonb_build_object('variant_id', v_v, 'quantity', 1, 'unit_cost', 800,
                                                                            'serials', jsonb_build_array('RACE-SN-1'))));

  -- hot item: 5 units, 40 buyers
  insert into public.products (organization_id, name, slug, status) values (v_org, 'Hot Item', 'hot-item', 'active') returning id into v_p;
  insert into public.product_variants (organization_id, product_id, sku, price) values (v_org, v_p, 'HOT', 10) returning id into v_v;
  insert into public.race_ctx values ('hot', v_v);
  perform public.receive_stock(v_main, jsonb_build_array(jsonb_build_object('variant_id', v_v, 'quantity', 5, 'unit_cost', 5)));

  -- batch item: 6 units over two lots, 15 buyers
  insert into public.products (organization_id, name, slug, status, tracking_mode) values (v_org, 'Batch Item', 'batch-item', 'active', 'batch') returning id into v_p;
  insert into public.product_variants (organization_id, product_id, sku, price) values (v_org, v_p, 'BAT', 20) returning id into v_v;
  insert into public.race_ctx values ('batch', v_v);
  perform public.receive_stock(v_main, jsonb_build_array(
    jsonb_build_object('variant_id', v_v, 'quantity', 2, 'unit_cost', 10, 'lot_code', 'L1', 'expires_on', current_date + 10),
    jsonb_build_object('variant_id', v_v, 'quantity', 4, 'unit_cost', 10, 'lot_code', 'L2', 'expires_on', current_date + 90)));
end $$;
SQL

ORG=$(q "select id from public.race_ctx where key = 'org'")
MAIN=$(q "select id from public.race_ctx where key = 'main'")
LAST=$(q "select id from public.race_ctx where key = 'last'")
DEVICE=$(q "select id from public.race_ctx where key = 'device'")
HOT=$(q "select id from public.race_ctx where key = 'hot'")
BATCH=$(q "select id from public.race_ctx where key = 'batch'")
TILLS=(a0000000-0000-0000-0000-000000000002 a0000000-0000-0000-0000-000000000003 a0000000-0000-0000-0000-000000000004)

# ---------------------------------------------------------------------------
# Racers
# ---------------------------------------------------------------------------
# pos  <out> <start> <till-user> <lines-json> [idempotency-key]
pos() {
  local key="${5:-}"
  local keysql="null"; [[ -n "$key" ]] && keysql="'$key'"
  psql -X -Atq -d "$DB" \
    -c "select set_config('request.jwt.claim.sub', '$3', false), set_config('request.jwt.claim.role', 'authenticated', false), set_config('nwsc.pos_shift', 'race', false)" \
    -c "select pg_sleep_until('$2')" \
    -c "select 'WON ' || (public.place_order('$MAIN', 'pos', '$4'::jsonb, null, $keysql, p_payments => '[{\"method\": \"cash\", \"amount\": 5000}]') ->> 'number')" \
    > "$1" 2>&1 &
}
# web  <out> <start> <lines-json> <idempotency-key>
web() {
  psql -X -Atq -d "$DB" \
    -c "select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'anon', false)" \
    -c "select pg_sleep_until('$2')" \
    -c "select 'WON ' || (public.start_checkout('$ORG', '$3'::jsonb, '$4') ->> 'number')" \
    > "$1" 2>&1 &
}
start_at() { q "select (clock_timestamp() + interval '$1 seconds')::text"; }
line()     { echo "[{\"variant_id\": \"$1\", \"quantity\": 1${2:+, \"serials\": [\"$2\"]}}]"; }
winners()  { cat "$WORK"/$1-* | grep -c '^WON ' || true; }
refused()  { cat "$WORK"/$1-* | grep -c 'OUT_OF_STOCK\|SERIAL_UNAVAILABLE' || true; }
odd()      { cat "$WORK"/$1-* | grep '^ERROR' | grep -v 'OUT_OF_STOCK\|SERIAL_UNAVAILABLE' || true; }
available(){ q "select on_hand - reserved from public.stock_levels where location_id = '$MAIN' and variant_id = '$1'"; }

check_round() { # name, expected winners, racers, variant
  local w r o a
  w=$(winners "$1"); r=$(refused "$1"); o=$(odd "$1"); a=$(available "$4")
  if [[ "$w" == "$2" && $((w + r)) == "$3" && -z "$o" && "$a" == "0.000" ]]; then
    ok "$1: $3 racers, exactly $w won, $r refused cleanly, available now 0"
  else
    problem "$1: expected $2 winners of $3; got $w won, $r refused, available $a"
    [[ -n "$o" ]] && echo "$o" | head -5
  fi
}

# Round 1 - the last unit: counter 1, counter 2 and a website shopper at once
T=$(start_at 2)
pos "$WORK/last-pos1" "$T" "${TILLS[0]}" "$(line "$LAST")"
pos "$WORK/last-pos2" "$T" "${TILLS[1]}" "$(line "$LAST")"
web "$WORK/last-web"  "$T" "$(line "$LAST")" "race-last-web-0001"
wait
check_round last 1 3 "$LAST"

# Round 2 - one serial number scanned at two counters while a shopper checks out
T=$(start_at 2)
pos "$WORK/device-pos1" "$T" "${TILLS[0]}" "$(line "$DEVICE" RACE-SN-1)"
pos "$WORK/device-pos2" "$T" "${TILLS[1]}" "$(line "$DEVICE" RACE-SN-1)"
web "$WORK/device-web"  "$T" "$(line "$DEVICE")" "race-device-web-0001"
wait
check_round device 1 3 "$DEVICE"

# Round 3 - 40 buyers (20 at three counters, 20 online) for 5 units
T=$(start_at 3)
for i in $(seq 1 20); do
  pos "$WORK/hot-pos$i" "$T" "${TILLS[$((i % 3))]}" "$(line "$HOT")"
  web "$WORK/hot-web$i" "$T" "$(line "$HOT")" "race-hot-web-$(printf %04d "$i")"
done
wait
check_round hot 5 40 "$HOT"

# Round 4 - 15 buyers for 6 batch-tracked units spread over two lots
T=$(start_at 3)
for i in $(seq 1 8); do pos "$WORK/batch-pos$i" "$T" "${TILLS[$((i % 3))]}" "$(line "$BATCH")"; done
for i in $(seq 1 7); do web "$WORK/batch-web$i" "$T" "$(line "$BATCH")" "race-batch-web-$(printf %04d "$i")"; done
wait
check_round batch 6 15 "$BATCH"

# Round 5 - one till double-fires the same sale ten times (network retry storm)
q "select set_config('request.jwt.claim.role', 'service_role', false), public.receive_stock('$MAIN',
     '[{\"variant_id\": \"$HOT\", \"quantity\": 3, \"unit_cost\": 5}]'::jsonb)" >/dev/null
T=$(start_at 2)
for i in $(seq 1 10); do pos "$WORK/idem-$i" "$T" "${TILLS[0]}" "$(line "$HOT")" "till1-sale-0042"; done
wait
DISTINCT=$(cat "$WORK"/idem-* | grep '^WON ' | sort -u | wc -l | tr -d ' ')
ALLWON=$(cat "$WORK"/idem-* | grep -c '^WON ' || true)
ROWS=$(q "select count(*) from public.orders where idempotency_key = 'till1-sale-0042'")
LEFT=$(available "$HOT")
if [[ "$ALLWON" == 10 && "$DISTINCT" == 1 && "$ROWS" == 1 && "$LEFT" == "2.000" ]]; then
  ok "idempotency: 10 simultaneous retries of one sale -> 1 order, 1 unit taken, all 10 callers get the same number"
else
  problem "idempotency: $ALLWON answered, $DISTINCT distinct numbers, $ROWS rows, $LEFT left (expected 10/1/1/2)"
  cat "$WORK"/idem-* | grep -v '^WON ' | head -5
fi

# Round 6 - six tills try to spend the same Rs 100 of store credit on Rs 60 items
CREDIT_PRODUCT=$(q "insert into public.products (organization_id, name, slug, status)
  values ('$ORG', 'Credit Item', 'credit-item', 'active') returning id")
CREDIT_ITEM=$(q "insert into public.product_variants (organization_id, product_id, sku, price)
  values ('$ORG', '$CREDIT_PRODUCT', 'CRD', 60) returning id")
CUST=$(q "insert into public.customers (organization_id, full_name, phone) values ('$ORG', 'Credit Racer', '+94779999999') returning id")
q "select set_config('request.jwt.claim.role', 'service_role', false),
     public.receive_stock('$MAIN', '[{\"variant_id\": \"$CREDIT_ITEM\", \"quantity\": 10, \"unit_cost\": 30}]'::jsonb),
     public.adjust_store_credit('$CUST', 100, 'race test balance')" >/dev/null
T=$(start_at 2)
for i in $(seq 1 6); do
  psql -X -Atq -d "$DB" \
    -c "select set_config('request.jwt.claim.sub', '${TILLS[$((i % 3))]}', false), set_config('request.jwt.claim.role', 'authenticated', false), set_config('nwsc.pos_shift', 'race', false)" \
    -c "select pg_sleep_until('$T')" \
    -c "select 'WON ' || (public.place_order('$MAIN', 'pos', '$(line "$CREDIT_ITEM")'::jsonb, '$CUST',
          p_payments => '[{\"method\": \"store_credit\", \"amount\": 60}]') ->> 'number')" \
    > "$WORK/credit-$i" 2>&1 &
done
wait
CW=$(cat "$WORK"/credit-* | grep -c '^WON ' || true)
CR=$(cat "$WORK"/credit-* | grep -c 'INSUFFICIENT_STORE_CREDIT' || true)
BAL=$(q "select store_credit_balance from public.customers where id = '$CUST'")
LEDGER=$(q "select sum(amount) from public.store_credit_ledger where customer_id = '$CUST'")
if [[ "$CW" == 1 && "$CR" == 5 && "$BAL" == "40.00" && "$LEDGER" == "40.00" ]]; then
  ok "store credit: 6 tills spent the same Rs 100 at once -> 1 sale, 5 refused, balance 40 = ledger"
else
  problem "store credit: $CW won, $CR refused, balance $BAL, ledger $LEDGER (expected 1/5/40/40)"
  cat "$WORK"/credit-* | grep '^ERROR' | grep -v INSUFFICIENT | head -3
fi

# ---------------------------------------------------------------------------
# Aftermath
# ---------------------------------------------------------------------------
if cat "$WORK"/* | grep -qi 'deadlock'; then problem "a deadlock was reported"; else ok "no deadlocks across 87 concurrent sessions"; fi

BAD=$(q "select set_config('request.jwt.claim.role', 'service_role', false) is null,
         (select count(*) from public._inventory_integrity('$ORG'))" | tail -1 | cut -d'|' -f2)
NEG=$(q "select count(*) from public.stock_levels where on_hand < 0 or reserved < 0 or reserved > on_hand")
if [[ "$BAD" == 0 && "$NEG" == 0 ]]; then
  ok "after the races the ledger, holds, lots and serials still agree exactly"
else
  problem "integrity after races: $BAD mismatches, $NEG impossible stock rows"
fi

GAPS=$(q "select count(*) <> coalesce(max(substr(number, 5)::int), 0) from public.orders where organization_id = '$ORG'")
if [[ "$GAPS" == "f" ]]; then ok "order numbers stayed gap-free under contention"; else problem "order numbers have gaps"; fi

exit $FAIL
