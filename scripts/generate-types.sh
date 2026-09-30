#!/usr/bin/env bash
# Regenerates src/types/database.types.ts from a PostgreSQL database that already has
# database_to_paste.sql applied. Defaults to the local verification database.
set -euo pipefail
DB="${1:-nwscommerce_dev}"
OUT_DIR="$(mktemp -d -t nwsc_types)"
trap 'rm -rf "$OUT_DIR"' EXIT
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"

psql -At -F '|' -d "$DB" -c "
select t.typname || '|' || string_agg(quote_literal(e.enumlabel), ',' order by e.enumsortorder)
from pg_type t join pg_enum e on e.enumtypid = t.oid
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public' group by t.typname order by t.typname;" > "$OUT_DIR/enums.txt"

psql -At -F '|' -d "$DB" -c "
select c.relname, a.attname, a.attnum, format_type(a.atttypid, a.atttypmod), t.typname,
       not a.attnotnull, (a.attidentity <> '' or a.atthasdef or a.attgenerated <> ''),
       (a.attgenerated <> ''), case when c.relkind = 'v' then 'view' else 'table' end
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_type t on t.oid = a.atttypid
where n.nspname = 'public' and c.relkind in ('r','v') and a.attnum > 0 and not a.attisdropped
order by c.relname, a.attnum;" > "$OUT_DIR/cols.txt"

psql -At -F '|' -d "$DB" -c "
select p.proname, coalesce(pg_get_function_arguments(p.oid), ''),
       format_type(p.prorettype, null), t.typname, p.proretset,
       case when exists (select 1 from pg_type rt
                         where rt.oid = p.prorettype and rt.typtype = 'c' and rt.typrelid <> 0)
            then 'composite' else 'scalar' end,
       replace(pg_get_function_result(p.oid), '|', '/')
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_type t on t.oid = p.prorettype
where n.nspname = 'public' and p.prokind = 'f' and p.proname !~ '^_'
order by p.proname;" > "$OUT_DIR/funcs.txt"

psql -At -F '|' -d "$DB" -c "
select c.relname,
       con.conname,
       (select string_agg(a.attname, ',' order by k.ord)
          from unnest(con.conkey) with ordinality k(attnum, ord)
          join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum),
       rc.relname,
       (select string_agg(a.attname, ',' order by k.ord)
          from unnest(con.confkey) with ordinality k(attnum, ord)
          join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum),
       (select count(*) > 0 from pg_index i
         where i.indrelid = con.conrelid and i.indisunique
           and i.indnatts = array_length(con.conkey, 1)
           and i.indkey::int2[] @> con.conkey and con.conkey @> i.indkey::int2[])
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_class rc on rc.oid = con.confrelid
join pg_namespace n on n.oid = c.relnamespace
where con.contype = 'f' and n.nspname = 'public'
order by c.relname, con.conname;" > "$OUT_DIR/fks.txt"

NWSC_TYPES_DIR="$OUT_DIR" python3 scripts/generate-types.py
echo "wrote packages/db/src/database.types.ts"
