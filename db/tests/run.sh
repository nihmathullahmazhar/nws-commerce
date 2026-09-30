#!/usr/bin/env bash
# Builds database_to_paste.sql, applies it to a throwaway local database and runs
# every verification suite. Fails on any PROBLEM line or any SQL error.
#
#   npm run db:verify            (or: bash db/tests/run.sh [database-name])
set -euo pipefail
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB="${1:-nwscommerce_verify}"
LOG="$(mktemp -t nwsc_verify)"
trap 'rm -f "$LOG"' EXIT

bash "$ROOT/scripts/build-paste.sh"
dropdb --if-exists "$DB"
createdb "$DB"
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/db/tests/00_local_supabase_shim.sql" >/dev/null 2>&1
# One transaction, as the Supabase SQL editor runs a pasted script: catches
# things like using a new enum value in the same run that added it.
psql -X -q -1 -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/database_to_paste.sql" >/dev/null
echo "schema applied to $DB"

# Assertions report through NOTICEs, which psql does not treat as errors, so the
# output is captured and scanned for PROBLEM lines.
run_sql() {
  echo; echo "== $(basename "$1")"
  psql -X -q -o /dev/null -v ON_ERROR_STOP=1 -d "$DB" -f "$1" 2>&1 \
    | sed -E 's/^psql:[^:]+:[0-9]+: (NOTICE:  )?//' | grep -vE '^-+$' | tee -a "$LOG"
}
run_sql "$ROOT/db/tests/01_core_flow.sql"
run_sql "$ROOT/db/tests/02_money_flow.sql"
run_sql "$ROOT/db/tests/03_admin_flow.sql"
run_sql "$ROOT/db/tests/04_storefront_flow.sql"
run_sql "$ROOT/db/tests/05_pos_flow.sql"
run_sql "$ROOT/db/tests/06_returns_warranty.sql"
run_sql "$ROOT/db/tests/07_purchasing_transfers.sql"
run_sql "$ROOT/db/tests/08_promotions_loyalty.sql"
run_sql "$ROOT/db/tests/09_analytics.sql"
run_sql "$ROOT/db/tests/10_mobile_app.sql"

echo; echo "== race.sh"
bash "$ROOT/db/tests/race.sh" "$DB" 2>&1 | tee -a "$LOG" || true

echo
PASSED=$(grep -c '^OK:' "$LOG" || true)
if grep -qE '^PROBLEM|ERROR' "$LOG"; then
  echo "verification FAILED ($PASSED passed):"
  grep -E '^PROBLEM|ERROR' "$LOG"
  exit 1
fi
echo "verification passed: $PASSED checks"
