#!/usr/bin/env bash
# DEV ONLY. (Re)creates the local database the admin app runs against, and the
# first owner account and business. The business starts empty - no demo data.
#
#   npm run dev:setup -- <email> <password> "<Business name>" [plan]
#
# plan: ecommerce | ecommerce_pro | retail (default) | omnichannel | enterprise
set -euo pipefail
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="${NWSC_DEV_DB:-nwscommerce_dev}"
export PGOPTIONS="-c client_min_messages=warning"

if [[ $# -lt 3 ]]; then
  echo "usage: npm run dev:setup -- <email> <password> \"<Business name>\" [plan]" >&2
  exit 1
fi
EMAIL="$1"; PASSWORD="$2"; NAME="$3"; PLAN="${4:-retail}"
if [[ ${#PASSWORD} -lt 8 ]]; then echo "password must be at least 8 characters" >&2; exit 1; fi
SLUG="$(echo "$NAME" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')"

if psql -X -lqt | cut -d'|' -f1 | grep -qw "$DB"; then
  echo "This replaces the local database '$DB' (everything in it is lost)."
  read -r -p "Type 'reset' to continue: " ANSWER
  [[ "$ANSWER" == "reset" ]] || { echo "cancelled"; exit 1; }
fi

bash "$ROOT/scripts/build-paste.sh" >/dev/null
dropdb --if-exists "$DB"
createdb "$DB"
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/db/tests/00_local_supabase_shim.sql" >/dev/null 2>&1
psql -X -q -1 -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/database_to_paste.sql" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/dev/local_supabase_extras.sql" >/dev/null

ORG=$(psql -X -Atq -v ON_ERROR_STOP=1 -d "$DB" \
  -v email="$EMAIL" -v password="$PASSWORD" -v name="$NAME" -v slug="$SLUG" -v plan="$PLAN" <<'SQL'
select public.create_organization(:'name', :'slug', auth.dev_create_user(:'email', :'password'), :'plan');
SQL
)
echo "local database '$DB' ready"
echo "  business: $NAME ($SLUG, plan $PLAN) -> $ORG"
echo "  sign in:  $EMAIL"
echo
echo "next: npm run dev:api   (then npm run dev:admin in another terminal)"
