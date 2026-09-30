#!/usr/bin/env python3
"""Emits packages/db/src/database.types.ts from the catalog dumps written by generate-types.sh."""
import collections
import os
import re

D = os.environ["NWSC_TYPES_DIR"]

enums = {}
for line in open(f'{D}/enums.txt'):
    line = line.rstrip('\n')
    if not line:
        continue
    name, vals = line.split('|', 1)
    enums[name] = [v.strip()[1:-1] for v in vals.split(',')]

SCALAR = {
    'uuid': 'string', 'text': 'string', 'citext': 'string', 'bpchar': 'string', 'varchar': 'string',
    'int2': 'number', 'int4': 'number', 'int8': 'number', 'numeric': 'number',
    'float4': 'number', 'float8': 'number', 'bool': 'boolean', 'jsonb': 'Json', 'json': 'Json',
    'date': 'string', 'timestamptz': 'string', 'timestamp': 'string', 'time': 'string',
    'timetz': 'string', 'inet': 'string', 'tsvector': 'string', 'interval': 'string', 'bytea': 'string',
}


def ts_type(fmt, typname):
    arr = fmt.endswith('[]')
    base = typname[1:] if typname.startswith('_') else typname
    t = f'Enums["{base}"]' if base in enums else SCALAR.get(base, 'unknown')
    return t + '[]' if arr else t


funcs = []
try:
    for line in open(f'{D}/funcs.txt'):
        parts = line.rstrip('\n').split('|')
        if len(parts) != 7:
            continue
        funcs.append(dict(name=parts[0], args=parts[1], rettype=parts[2],
                          typname=parts[3], setof=(parts[4] == 't'), kind=parts[5], result=parts[6]))
except FileNotFoundError:
    pass

def split_args(raw):
    """Splits a pg_get_function_arguments string on top-level commas."""
    parts, depth, current, quoted = [], 0, [], False
    for ch in raw:
        if ch == "'":
            quoted = not quoted
        if not quoted:
            if ch in '([':
                depth += 1
            elif ch in ')]':
                depth -= 1
            elif ch == ',' and depth == 0:
                parts.append(''.join(current).strip())
                current = []
                continue
        current.append(ch)
    if ''.join(current).strip():
        parts.append(''.join(current).strip())
    return parts


PG_TO_TS = {
    'uuid': 'string', 'text': 'string', 'citext': 'string', 'character': 'string',
    'character varying': 'string', 'date': 'string', 'timestamp with time zone': 'string',
    'timestamp without time zone': 'string', 'time without time zone': 'string',
    'inet': 'string', 'numeric': 'number', 'integer': 'number', 'bigint': 'number',
    'smallint': 'number', 'double precision': 'number', 'real': 'number',
    'boolean': 'boolean', 'jsonb': 'Json', 'json': 'Json',
}


def parse_arg(raw):
    """'p_date date DEFAULT CURRENT_DATE' -> ('p_date', 'string', True)"""
    optional = ' DEFAULT ' in raw
    head = raw.split(' DEFAULT ')[0].strip()
    for mode in ('VARIADIC ', 'OUT ', 'INOUT ', 'IN '):
        if head.startswith(mode):
            head = head[len(mode):]
    pieces = head.split(' ', 1)
    if len(pieces) != 2:
        return None
    name, pg_type = pieces[0], pieces[1].strip()
    is_array = pg_type.endswith('[]')
    base = pg_type[:-2].strip() if is_array else pg_type
    base = re.sub(r'\(.*\)$', '', base).strip()
    base = base[len('public.'):] if base.startswith('public.') else base
    if base in enums:
        ts = f'Enums["{base}"]'
    else:
        ts = PG_TO_TS.get(base, 'unknown')
    if is_array:
        ts += '[]'
    return name, ts, optional


relationships = collections.defaultdict(list)
try:
    for line in open(f'{D}/fks.txt'):
        parts = line.rstrip('\n').split('|')
        if len(parts) != 6:
            continue
        table, name, columns, ref_table, ref_columns, one_to_one = parts
        relationships[table].append(dict(
            name=name,
            columns=columns.split(','),
            ref_table=ref_table,
            ref_columns=ref_columns.split(','),
            one_to_one=(one_to_one == 't'),
        ))
except FileNotFoundError:
    pass


def emit_relationships(rel):
    if not rel:
        return ['        Relationships: [];']
    lines = ['        Relationships: [']
    for r in rel:
        cols_ts = ', '.join(f'"{c}"' for c in r['columns'])
        ref_ts = ', '.join(f'"{c}"' for c in r['ref_columns'])
        lines.append('          {')
        lines.append(f'            foreignKeyName: "{r["name"]}";')
        lines.append(f'            columns: [{cols_ts}];')
        lines.append(f'            isOneToOne: {"true" if r["one_to_one"] else "false"};')
        lines.append(f'            referencedRelation: "{r["ref_table"]}";')
        lines.append(f'            referencedColumns: [{ref_ts}];')
        lines.append('          },')
    lines.append('        ];')
    return lines


cols = collections.OrderedDict()
kinds = {}
for line in open(f'{D}/cols.txt'):
    parts = line.rstrip('\n').split('|')
    if len(parts) != 9:
        continue
    rel, name, _num, fmt, typname, nullable, has_def, generated, kind = parts
    cols.setdefault(rel, []).append(dict(
        name=name, fmt=fmt, typname=typname,
        nullable=(nullable == 't'), has_default=(has_def == 't'), generated=(generated == 't')))
    kinds[rel] = kind


def emit_fields(fields, mode):
    lines = []
    for f in fields:
        t = ts_type(f['fmt'], f['typname'])
        if mode == 'Row':
            opt = ''
        elif mode == 'Insert':
            opt = '?' if (f['nullable'] or f['has_default'] or f['generated']) else ''
        else:
            opt = '?'
        lines.append(f'          {f["name"]}{opt}: {t}{" | null" if f["nullable"] else ""};')
    return '\n'.join(lines)


out = ['''// -----------------------------------------------------------------------------
// NWS Commerce - database types
//
// Generated from the live schema in `database_to_paste.sql`. Do not edit by hand:
// re-run `npm run db:types` after changing the schema.
// -----------------------------------------------------------------------------

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {''']

tables = sorted(r for r, k in kinds.items() if k == 'table')
views = sorted(r for r, k in kinds.items() if k == 'view')

for rel in tables:
    fields = cols[rel]
    writable = [f for f in fields if not f['generated']]
    out += [f'      {rel}: {{', '        Row: {', emit_fields(fields, 'Row'), '        };',
            '        Insert: {', emit_fields(writable, 'Insert'), '        };',
            '        Update: {', emit_fields(writable, 'Update'), '        };']
    out += emit_relationships(relationships.get(rel, []))
    out += ['      };']

out += ['    };', '    Views: {']
for rel in views:
    out += [f'      {rel}: {{', '        Row: {', emit_fields(cols[rel], 'Row'), '        };',
            '        Relationships: [];', '      };']
out += ['    };', '    Functions: {']

SKIP_PREFIXES = ('tg_',)
seen_fn = set()
for fn in funcs:
    if fn['typname'] == 'trigger' or fn['name'].startswith(SKIP_PREFIXES) or fn['name'] in seen_fn:
        continue
    seen_fn.add(fn['name'])

    arg_lines = []
    for raw in split_args(fn['args']):
        parsed = parse_arg(raw)
        if not parsed:
            continue
        arg_name, arg_type, optional = parsed
        # Every SQL parameter accepts NULL; one with a DEFAULT may also be omitted.
        arg_lines.append(
            f'          {arg_name}?: {arg_type} | null;' if optional
            else f'          {arg_name}: {arg_type} | null;')

    if fn['result'].startswith('TABLE('):
        cols_ts = []
        for raw in split_args(fn['result'][len('TABLE('):-1]):
            parsed = parse_arg(raw)
            if parsed:
                cols_ts.append(f'{parsed[0]}: {parsed[1]} | null')
        ret = '{ ' + '; '.join(cols_ts) + ' }'
    elif fn['kind'] == 'composite' and fn['typname'] in cols:
        ret = f'Database["public"]["Tables"]["{fn["typname"]}"]["Row"]'
    elif fn['typname'] == 'void':
        ret = 'undefined'
    else:
        ret = ts_type(fn['rettype'], fn['typname'])
    if fn['setof']:
        ret = f'{ret}[]'

    out.append(f'      {fn["name"]}: {{')
    out.append('        Args: ' + ('{' if arg_lines else 'Record<string, never>;'))
    if arg_lines:
        out += arg_lines
        out.append('        };')
    out.append(f'        Returns: {ret};')
    out.append('      };')

out += ['    };', '    Enums: {']
for name in sorted(enums):
    out.append(f'      {name}: ' + ' | '.join(f'"{v}"' for v in enums[name]) + ';')
out += ['    };',
        '    CompositeTypes: {',
        '      [_ in never]: never;',
        '    };',
        '  };', '}', '',
        'export type Enums = Database["public"]["Enums"];',
        'export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];',
        'export type TablesInsert<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Insert"];',
        'export type TablesUpdate<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Update"];',
        'export type Views<T extends keyof Database["public"]["Views"]> = Database["public"]["Views"][T]["Row"];', '']

open('packages/db/src/database.types.ts', 'w').write('\n'.join(out))
