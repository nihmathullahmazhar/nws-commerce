import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, BarChart3, Download, Minus } from 'lucide-react';
import type {
  CustomerReport, Enums, InventoryReport, ProductGroup, ProductReport, PromotionReport, ReportInterval, ReportTotals,
  SalesReport, StaffReport,
} from '@nws-commerce/db';
import { Badge, Button, Card, EmptyState, ErrorNote, Input, PageHeader, Select, Spinner, Stat, Table, Tabs, Td, Th } from '@nws-commerce/ui';
import { supabase } from '../lib/supabase';
import { unwrap } from '../lib/api';
import { useOrg } from '../lib/workspace';
import { CHANNEL, METHOD } from '../lib/labels';
import { date, money, qty, titleCase } from '../lib/format';
import { addDays, autoInterval, bucketLabel, PRESETS, presetRange, rangeLabel, todayIn, type Preset } from '../lib/dates';
import { downloadCsv } from '../lib/csv';
import { BarChart, Heatmap, ShareBar } from '../components/charts';

type Tab = 'sales' | 'products' | 'stock' | 'customers' | 'promotions' | 'staff';
interface Filters { from: string; to: string; location: string | null; channel: Enums['sales_channel'] | null }

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '-' : `${v}%`);

function useReport<T>(name: string, args: Record<string, unknown>, enabled = true) {
  const org = useOrg();
  return useQuery({
    queryKey: ['report', name, org.id, args],
    enabled,
    placeholderData: (prev) => prev,
    queryFn: async () => unwrap(await supabase.rpc(name as 'report_sales', { p_organization_id: org.id, ...args } as never)) as unknown as T,
  });
}

export function Reports() {
  const org = useOrg();
  const [params, setParams] = useSearchParams();
  const today = todayIn(org.timezone);
  const preset = (params.get('range') as Preset | null) ?? '30d';
  const [from, to] = preset === 'custom'
    ? [params.get('from') ?? addDays(today, -29), params.get('to') ?? today]
    : presetRange(preset, today);
  const tab = (params.get('tab') as Tab | null) ?? 'sales';
  const f: Filters = { from, to, location: params.get('loc') || null, channel: (params.get('ch') as Filters['channel']) || null };

  const set = (patch: Record<string, string | null>) => setParams((p) => {
    const next = new URLSearchParams(p);
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === '') next.delete(k); else next.set(k, v); }
    return next;
  }, { replace: true });

  const channels = (['pos', 'online', 'mobile_app', 'phone_order', 'admin_order'] as const).filter((c) =>
    c === 'pos' ? org.has('pos') : c === 'online' ? org.has('storefront') : c === 'mobile_app' ? org.has('mobile_app') : true);
  const tabs: { value: Tab; label: string }[] = [
    { value: 'sales', label: 'Sales' }, { value: 'products', label: 'Products' }, { value: 'stock', label: 'Stock' },
    { value: 'customers', label: 'Customers' },
    { value: 'promotions', label: 'Discounts' },
    { value: 'staff', label: 'Staff' },
  ];
  const dated = tab !== 'stock';

  return (
    <>
      <PageHeader title="Reports" description={`Every channel, read live from the same ledgers as the tills and the store. Days are counted in ${org.timezone.replace('_', ' ')}.`} />
      <Tabs value={tab} onChange={(t) => set({ tab: t === 'sales' ? null : t })} tabs={tabs} />

      {/* Filters: one row, above every chart. */}
      <div className="mb-5 flex flex-wrap items-end gap-2">
        {dated && (
          <>
            <label className="text-xs text-muted">
              <span className="mb-1 block">Period</span>
              <Select className="h-9 w-40" value={preset} onChange={(e) => {
                const v = e.target.value as Preset;
                set(v === 'custom' ? { range: v, from, to } : { range: v === '30d' ? null : v, from: null, to: null });
              }}>
                {PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </Select>
            </label>
            {preset === 'custom' && (
              <>
                <label className="text-xs text-muted"><span className="mb-1 block">From</span>
                  <Input className="h-9 w-38" type="date" value={from} max={to} onChange={(e) => e.target.value && set({ from: e.target.value })} /></label>
                <label className="text-xs text-muted"><span className="mb-1 block">To</span>
                  <Input className="h-9 w-38" type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && set({ to: e.target.value })} /></label>
              </>
            )}
          </>
        )}
        {org.locations.length > 1 && (
          <label className="text-xs text-muted">
            <span className="mb-1 block">Location</span>
            <Select className="h-9 w-44" value={f.location ?? ''} onChange={(e) => set({ loc: e.target.value })}>
              {(org.locationIds === null) && <option value="">All locations</option>}
              {org.locationIds !== null && <option value="">All my locations</option>}
              {org.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </label>
        )}
        {dated && channels.length > 1 && (
          <label className="text-xs text-muted">
            <span className="mb-1 block">Channel</span>
            <Select className="h-9 w-36" value={f.channel ?? ''} onChange={(e) => set({ ch: e.target.value })}>
              <option value="">All channels</option>
              {channels.map((c) => <option key={c} value={c}>{CHANNEL[c]}</option>)}
            </Select>
          </label>
        )}
        {dated && <p className="ml-auto self-center text-sm text-muted">{rangeLabel(from, to)}</p>}
      </div>

      {tab === 'sales' && <SalesTab f={f} interval={(params.get('by') as ReportInterval | null) ?? autoInterval(from, to)} onInterval={(by) => set({ by })} />}
      {tab === 'products' && <ProductsTab f={f} group={(params.get('group') as ProductGroup | null) ?? 'product'} onGroup={(g) => set({ group: g === 'product' ? null : g })} />}
      {tab === 'stock' && <StockTab location={f.location} days={Number(params.get('days') ?? 30)} onDays={(d) => set({ days: d === 30 ? null : String(d) })} />}
      {tab === 'customers' && <CustomersTab f={f} />}
      {tab === 'promotions' && <DiscountsTab f={f} />}
      {tab === 'staff' && <StaffTab f={f} />}
    </>
  );
}

const filterArgs = (f: Filters) => ({ p_from: f.from, p_to: f.to, p_location_id: f.location, p_channel: f.channel });
const fileSuffix = (f: Filters) => (f.from === f.to ? f.from : `${f.from}_to_${f.to}`);

function Loading({ error, loading }: { error: unknown; loading: boolean }) {
  if (error) return <ErrorNote error={error} />;
  return loading ? <Spinner /> : null;
}

function CsvButton({ onClick }: { onClick: () => void }) {
  return <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={onClick}>CSV</Button>;
}

/** Change against the previous period, with an arrow and words (never colour alone). */
function Delta({ cur, prev, invert = false }: { cur: number; prev: number; invert?: boolean }) {
  if (prev === 0) return <span className="text-faint">{cur === 0 ? 'no change' : 'none the period before'}</span>;
  const change = ((cur - prev) / Math.abs(prev)) * 100;
  if (Math.abs(change) < 0.05) return <span className="inline-flex items-center gap-1 text-muted"><Minus className="size-3" />same as before</span>;
  const good = invert ? change < 0 : change > 0;
  return (
    <span className={`inline-flex items-center gap-1 ${good ? 'text-ok' : 'text-danger'}`}>
      {change > 0 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
      {Math.abs(change).toFixed(1)}% vs previous
    </span>
  );
}

// ---------------------------------------------------------------------------
function SalesTab({ f, interval, onInterval }: { f: Filters; interval: ReportInterval; onInterval: (v: ReportInterval) => void }) {
  const org = useOrg();
  const cur = org.currency;
  const [asTable, setAsTable] = useState(false);
  const { data, error, isLoading } = useReport<SalesReport>('report_sales', { ...filterArgs(f), p_interval: interval });
  if (!data) return <Loading error={error} loading={isLoading} />;
  const t = data.totals, p = data.previous;
  const empty = t.orders === 0 && t.returns === 0;

  return (
    <div className="space-y-5">
      <ErrorNote error={error} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Net sales" value={money(t.net_sales, cur)} sub={<Delta cur={t.net_sales} prev={p.net_sales} />} />
        <Stat label="Gross profit" value={money(t.gross_profit, cur)} sub={<>{t.margin !== null ? `${t.margin}% margin · ` : ''}<Delta cur={t.gross_profit} prev={p.gross_profit} /></>} />
        <Stat label="Sales" value={t.orders.toLocaleString()} sub={<Delta cur={t.orders} prev={p.orders} />} />
        <Stat label="Average sale" value={money(t.average_sale, cur)} sub={t.items_per_sale !== null ? `${t.items_per_sale} items per sale` : undefined} />
        <Stat label="Discounts" value={money(t.discounts, cur)} sub={t.gross > 0 ? `${((t.discounts / t.gross) * 100).toFixed(1)}% of gross` : undefined} />
        <Stat label="Returns" value={money(t.returns, cur)} sub={`${qty(t.returned_items)} item${t.returned_items === 1 ? '' : 's'} brought back`} />
      </div>

      {empty ? (
        <Card><EmptyState icon={<BarChart3 className="size-5" />} title="No sales in this period">Pick a longer period, or check the location and channel filters.</EmptyState></Card>
      ) : (
        <>
          <Card title="Net sales" description={`${titleCase(interval)} by ${interval}, after discounts and returns, excluding tax.`}
            actions={<div className="flex items-center gap-1">
              <Select className="h-8 w-28" value={interval} onChange={(e) => onInterval(e.target.value as ReportInterval)} aria-label="Group by">
                <option value="day">By day</option><option value="week">By week</option><option value="month">By month</option>
              </Select>
              <Button size="sm" variant="ghost" onClick={() => setAsTable((v) => !v)}>{asTable ? 'Chart' : 'Table'}</Button>
              <CsvButton onClick={() => downloadCsv(`sales-${fileSuffix(f)}.csv`, ['Period', 'Sales', 'Net sales', 'Gross profit'],
                data.series.map((s) => [s.bucket, s.orders, s.net_sales, s.gross_profit]))} />
            </div>}>
            {asTable ? (
              <div className="max-h-96 overflow-y-auto">
                <Table>
                  <thead><tr><Th>Period</Th><Th align="right">Sales</Th><Th align="right">Net sales</Th><Th align="right">Gross profit</Th></tr></thead>
                  <tbody>{data.series.map((s) => (
                    <tr key={s.bucket}><Td>{bucketLabel(s.bucket, interval, true)}</Td><Td align="right">{s.orders}</Td>
                      <Td align="right">{money(s.net_sales, cur)}</Td><Td align="right">{money(s.gross_profit, cur)}</Td></tr>
                  ))}</tbody>
                </Table>
              </div>
            ) : (
              <BarChart title={`Net sales by ${interval}`} formatAxis={(v) => compact.format(v)}
                data={data.series.map((s) => ({
                  key: s.bucket, label: bucketLabel(s.bucket, interval), value: s.net_sales,
                  tooltip: <>
                    <div className="mb-1 font-medium text-text">{bucketLabel(s.bucket, interval, true)}</div>
                    <TipRow label="Net sales" value={money(s.net_sales, cur)} />
                    <TipRow label="Gross profit" value={money(s.gross_profit, cur)} />
                    <TipRow label="Sales" value={String(s.orders)} />
                  </>,
                }))} />
            )}
          </Card>

          <div className="grid gap-5 lg:grid-cols-3 [&>*]:min-w-0">
            <Card title="By channel">
              <ShareList rows={data.by_channel.map((c) => ({ key: c.channel, label: CHANNEL[c.channel], sub: `${c.orders} sale${c.orders === 1 ? '' : 's'}`, value: c.net_sales }))} currency={cur} />
            </Card>
            {org.locations.length > 1 ? (
              <Card title="By location">
                <ShareList rows={data.by_location.map((l) => ({ key: l.location_id, label: l.name, sub: `${l.orders} sale${l.orders === 1 ? '' : 's'}`, value: l.net_sales }))} currency={cur} />
              </Card>
            ) : <MoneyCard t={t} currency={cur} />}
            <Card padded={false} title="Payments" description="Money in and out, by method.">
              <Table>
                <thead><tr><Th>Method</Th><Th align="right">Taken</Th><Th align="right">Refunded</Th></tr></thead>
                <tbody>{data.by_method.map((m) => (
                  <tr key={m.method}><Td>{METHOD[m.method]}</Td><Td align="right">{money(m.taken, cur)}</Td>
                    <Td align="right" className="text-muted">{m.refunded > 0 ? money(m.refunded, cur) : '-'}</Td></tr>
                ))}</tbody>
              </Table>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-3 [&>*]:min-w-0">
            <Card title="Busy times" className="lg:col-span-2" description="Net sales by weekday and hour. Use it for staffing and opening hours.">
              <Heatmap cells={data.by_hour} format={(v) => money(v, cur)} />
            </Card>
            {org.locations.length > 1 && <MoneyCard t={t} currency={cur} />}
          </div>
        </>
      )}
    </div>
  );
}

function TipRow({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3 text-muted"><span>{label}</span><span className="tabular-nums text-text">{value}</span></div>;
}

/** Where the money in the period came from and went. */
function MoneyCard({ t, currency }: { t: ReportTotals; currency: string }) {
  const rows: [string, number, boolean?][] = [
    ['Gross sales', t.gross], ['Discounts', -t.discounts], ['Returns', -t.returns], ['Net sales', t.net_sales, true],
    ['Cost of goods', -t.cogs], ['Gross profit', t.gross_profit, true],
  ];
  return (
    <Card title="Profit">
      <dl className="space-y-1.5 text-sm">
        {rows.map(([label, v, strong]) => (
          <div key={label} className={`flex justify-between ${strong ? 'border-t border-border pt-1.5 font-semibold' : 'text-muted'}`}>
            <dt>{label}</dt><dd className="tabular-nums">{money(v, currency)}</dd>
          </div>
        ))}
      </dl>
      <dl className="mt-4 space-y-1 border-t border-border pt-3 text-xs text-muted">
        <div className="flex justify-between"><dt>Tax collected</dt><dd className="tabular-nums">{money(t.tax, currency)}</dd></div>
        {t.shipping > 0 && <div className="flex justify-between"><dt>Delivery fees</dt><dd className="tabular-nums">{money(t.shipping, currency)}</dd></div>}
        {t.gift_cards_sold > 0 && <div className="flex justify-between"><dt>Gift cards sold (not in sales)</dt><dd className="tabular-nums">{money(t.gift_cards_sold, currency)}</dd></div>}
      </dl>
    </Card>
  );
}

function ShareList({ rows, currency }: { rows: { key: string; label: string; sub: string; value: number }[]; currency: string }) {
  const total = rows.reduce((s, r) => s + Math.max(r.value, 0), 0);
  if (!rows.length) return <p className="text-sm text-muted">Nothing in this period.</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const share = total > 0 ? (Math.max(r.value, 0) / total) * 100 : 0;
        return (
          <li key={r.key}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{r.label} <span className="text-xs font-normal text-muted">{r.sub}</span></span>
              <span className="tabular-nums">{money(r.value, currency)}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-accent" style={{ width: `${share}%` }} /></div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
type SortKey = 'quantity' | 'net_sales' | 'gross_profit' | 'margin' | 'return_rate';

function SortTh({ k, sort, onSort, children }: { k: SortKey; sort: SortKey; onSort: (k: SortKey) => void; children: ReactNode }) {
  return (
    <Th align="right">
      <button className={`inline-flex items-center gap-1 ${sort === k ? 'text-text' : ''}`} onClick={() => onSort(k)} aria-sort={sort === k ? 'descending' : undefined}>
        {children}{sort === k && <ArrowDown className="size-3" />}
      </button>
    </Th>
  );
}

function ProductsTab({ f, group, onGroup }: { f: Filters; group: ProductGroup; onGroup: (g: ProductGroup) => void }) {
  const org = useOrg();
  const cur = org.currency;
  const [sort, setSort] = useState<SortKey>('net_sales');
  const { data, error, isLoading } = useReport<ProductReport>('report_products', { ...filterArgs(f), p_group: group, p_limit: 500 });
  const rows = useMemo(() => [...(data?.rows ?? [])].sort((a, b) => (b[sort] ?? -Infinity) - (a[sort] ?? -Infinity)), [data, sort]);
  const noun = { product: 'Product', variant: 'Variant', category: 'Category', brand: 'Brand' }[group];

  return (
    <Card padded={false} title="What sold" description="Net of discounts and returns, excluding tax. Profit uses what each unit cost when it left stock."
      actions={<div className="flex items-center gap-1">
        <Select className="h-8 w-32" value={group} onChange={(e) => onGroup(e.target.value as ProductGroup)} aria-label="Group by">
          <option value="product">Products</option><option value="variant">Variants</option><option value="category">Categories</option><option value="brand">Brands</option>
        </Select>
        {data && <CsvButton onClick={() => downloadCsv(`${group}-sales-${fileSuffix(f)}.csv`,
          [noun, 'SKU', 'Quantity', 'Sales', 'Discounts', 'Net sales', 'Cost of goods', 'Gross profit', 'Margin %', 'Returned', 'Return rate %', 'Share %'],
          rows.map((r) => [r.name, r.detail, r.quantity, r.orders, r.discounts, r.net_sales, r.cogs, r.gross_profit, r.margin, r.returned, r.return_rate, r.share]))} />}
      </div>}>
      {!data ? <div className="p-4"><Loading error={error} loading={isLoading} /></div> : !rows.length ? (
        <EmptyState icon={<BarChart3 className="size-5" />} title="Nothing sold in this period" />
      ) : (
        <>
          <Table>
            <thead><tr>
              <Th>{noun}</Th>
              <SortTh k="quantity" sort={sort} onSort={setSort}>Qty</SortTh>
              <SortTh k="net_sales" sort={sort} onSort={setSort}>Net sales</SortTh>
              <Th>Share</Th>
              <SortTh k="gross_profit" sort={sort} onSort={setSort}>Profit</SortTh>
              <SortTh k="margin" sort={sort} onSort={setSort}>Margin</SortTh>
              <SortTh k="return_rate" sort={sort} onSort={setSort}>Returned</SortTh>
            </tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id ?? 'none'}>
                <Td><div className="font-medium">{r.name}</div>{r.detail && <div className="font-mono text-xs text-muted">{r.detail}</div>}</Td>
                <Td align="right">{qty(r.quantity)}</Td>
                <Td align="right">{money(r.net_sales, cur)}</Td>
                <Td><ShareBar percent={r.share} /></Td>
                <Td align="right" className={r.gross_profit < 0 ? 'text-danger' : ''}>{money(r.gross_profit, cur)}</Td>
                <Td align="right">{pct(r.margin)}</Td>
                <Td align="right" className="text-muted">{r.returned > 0 ? `${qty(r.returned)} (${pct(r.return_rate)})` : '-'}</Td>
              </tr>
            ))}</tbody>
          </Table>
          {data.count > rows.length && <p className="px-4 py-3 text-xs text-muted">Showing the top {rows.length} of {data.count}. The CSV has the same rows.</p>}
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
function StockTab({ location, days, onDays }: { location: string | null; days: number; onDays: (d: number) => void }) {
  const org = useOrg();
  const cur = org.currency;
  const [show, setShow] = useState<'all' | 'dead' | 'short'>('all');
  const { data, error, isLoading } = useReport<InventoryReport>('report_inventory', { p_location_id: location, p_days: days });
  if (!data) return <Loading error={error} loading={isLoading} />;
  const t = data.totals;
  const items = data.items.filter((i) => (show === 'dead' ? i.dead : show === 'short' ? i.days_cover !== null && i.days_cover <= 14 && i.on_hand > 0 : true));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted"><span className="mb-1 block">Look back</span>
          <Select className="h-9 w-40" value={days} onChange={(e) => onDays(Number(e.target.value))}>
            {[30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>{d} days</option>)}
          </Select></label>
        <p className="self-center text-xs text-muted">Stock is as of now. "Sold" and dead stock use the last {days} days.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Stock value at cost" value={money(t.value, cur)} sub={`${qty(t.units)} units · ${t.variants} items`} />
        <Stat label="At selling price" value={money(t.retail_value, cur)} sub={t.retail_value > 0 ? `${(((t.retail_value - t.value) / t.retail_value) * 100).toFixed(1)}% margin if all sold` : undefined} />
        <Stat label="Dead stock" value={money(t.dead_value, cur)} sub={`${t.dead_variants} item${t.dead_variants === 1 ? '' : 's'} unsold in ${days} days`} />
        <Stat label="Out of stock" value={t.out_of_stock.toLocaleString()} sub="items with none on hand" />
      </div>
      <div className="grid gap-5 lg:grid-cols-3 [&>*]:min-w-0">
        <Card padded={false} title="By category">
          {!data.by_category.length ? <p className="p-4 text-sm text-muted">No stock on hand.</p> : (
            <Table>
              <thead><tr><Th>Category</Th><Th align="right">Units</Th><Th align="right">Value</Th></tr></thead>
              <tbody>{data.by_category.map((c) => (
                <tr key={c.category}><Td>{c.category}</Td><Td align="right">{qty(c.units)}</Td><Td align="right">{money(c.value, cur)}</Td></tr>
              ))}</tbody>
            </Table>
          )}
        </Card>
        <Card padded={false} className="lg:col-span-2" title="Items"
          actions={<div className="flex items-center gap-1">
            <Select className="h-8 w-52" value={show} onChange={(e) => setShow(e.target.value as typeof show)} aria-label="Show">
              <option value="all">All stocked items</option><option value="dead">Dead stock</option><option value="short">Two weeks or less left</option>
            </Select>
            <CsvButton onClick={() => downloadCsv(`stock-${new Date().toISOString().slice(0, 10)}.csv`,
              ['Product', 'Variant', 'SKU', 'Category', 'On hand', 'Held', 'Value at cost', 'Value at price', `Sold (${days} days)`, 'Days of cover', 'Last sold', 'Dead stock'],
              items.map((i) => [i.product, i.variant, i.sku, i.category, i.on_hand, i.reserved, i.value, i.retail_value, i.sold, i.days_cover, i.last_sold_at?.slice(0, 10), i.dead ? 'yes' : '']))} />
          </div>}>
          {!items.length ? <p className="p-6 text-center text-sm text-muted">{show === 'dead' ? 'No dead stock. Everything has sold recently.' : 'Nothing to show.'}</p> : (
            <div className="max-h-[32rem] overflow-y-auto">
              <Table>
                <thead><tr><Th>Item</Th><Th align="right">On hand</Th><Th align="right">Value</Th><Th align="right">Sold</Th><Th align="right">Cover</Th><Th>Last sold</Th></tr></thead>
                <tbody>{items.slice(0, 500).map((i) => (
                  <tr key={i.variant_id}>
                    <Td><div className="font-medium">{i.product}{i.variant !== 'Default' && <span className="font-normal text-muted"> · {i.variant}</span>}</div>
                      <div className="text-xs text-muted">{[i.sku, i.category].filter(Boolean).join(' · ')}</div></Td>
                    <Td align="right">{qty(i.on_hand)}</Td>
                    <Td align="right">{money(i.value, cur)}</Td>
                    <Td align="right">{qty(i.sold)}</Td>
                    <Td align="right">{i.days_cover === null ? '-' : `${i.days_cover} d`}</Td>
                    <Td>{i.dead ? <Badge tone="warn">Dead stock</Badge> : <span className="text-muted">{i.last_sold_at ? date(i.last_sold_at) : 'never'}</span>}</Td>
                  </tr>
                ))}</tbody>
              </Table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function CustomersTab({ f }: { f: Filters }) {
  const org = useOrg();
  const cur = org.currency;
  const { data, error, isLoading } = useReport<CustomerReport>('report_customers', { ...filterArgs(f), p_limit: 50 });
  if (!data) return <Loading error={error} loading={isLoading} />;
  const t = data.totals;
  const named = t.orders - t.walk_in_orders;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Customers" value={t.customers.toLocaleString()} sub={`${t.new_customers} new · ${t.returning_customers} returning`} />
        <Stat label="Came back in the period" value={t.repeat_customers.toLocaleString()} sub={t.customers > 0 ? `${((t.repeat_customers / t.customers) * 100).toFixed(0)}% bought more than once` : undefined} />
        <Stat label="Average spend" value={money(t.average_spend, cur)} sub="per named customer" />
        <Stat label="Sales to named customers" value={t.orders > 0 ? `${((named / t.orders) * 100).toFixed(0)}%` : '-'} sub={`${t.walk_in_orders} walk-in sale${t.walk_in_orders === 1 ? '' : 's'}`} />
      </div>
      <Card padded={false} title="Top customers"
        actions={<CsvButton onClick={() => downloadCsv(`customers-${fileSuffix(f)}.csv`, ['Customer', 'Phone', 'Sales', 'Spent', 'Last sale', 'New', 'Points'],
          data.top.map((c) => [c.name, c.phone, c.orders, c.spent, c.last_order_at.slice(0, 10), c.is_new ? 'yes' : '', c.loyalty_points]))} />}>
        {!data.top.length ? <p className="p-6 text-center text-sm text-muted">No named customers bought in this period. Adding a customer at the till (F4) builds this list.</p> : (
          <Table>
            <thead><tr><Th>Customer</Th><Th align="right">Sales</Th><Th align="right">Spent</Th><Th>Last sale</Th>{org.has('loyalty') && <Th align="right">Points</Th>}</tr></thead>
            <tbody>{data.top.map((c) => (
              <tr key={c.customer_id}>
                <Td><Link to={`/customers/${c.customer_id}`} className="font-medium hover:text-accent">{c.name || c.phone || 'Unnamed'}</Link>
                  {c.is_new && <span className="ml-2"><Badge tone="info">New</Badge></span>}</Td>
                <Td align="right">{c.orders}</Td>
                <Td align="right">{money(c.spent, cur)}</Td>
                <Td className="text-muted">{date(c.last_order_at)}</Td>
                {org.has('loyalty') && <Td align="right">{c.loyalty_points.toLocaleString()}</Td>}
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
function DiscountsTab({ f }: { f: Filters }) {
  const org = useOrg();
  const cur = org.currency;
  const { data, error, isLoading } = useReport<PromotionReport>('report_promotions', filterArgs(f));
  if (!data) return <Loading error={error} loading={isLoading} />;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Given by promotions" value={money(data.promo_discounts, cur)} sub={`on ${data.orders_with_promotion} sale${data.orders_with_promotion === 1 ? '' : 's'}`} />
        <Stat label="Given by staff" value={money(data.manual_discounts, cur)} sub={`on ${data.orders_with_manual_discount} sale${data.orders_with_manual_discount === 1 ? '' : 's'}`} />
      </div>
      {org.has('promotions') && (
        <Card padded={false} title="Promotions" description="Sales value is the whole of each sale a promotion was on.">
          {!data.promotions.length ? <p className="p-6 text-center text-sm text-muted">No promotion was used in this period.</p> : (
            <Table>
              <thead><tr><Th>Promotion</Th><Th align="right">Used on</Th><Th align="right">Given away</Th><Th align="right">Sales value</Th></tr></thead>
              <tbody>{data.promotions.map((p) => (
                <tr key={p.promotion_id}>
                  <Td><div className="font-medium">{p.name}</div><div className="text-xs text-muted">{p.coupon_code ? <span className="font-mono">{p.coupon_code}</span> : 'automatic'}{!p.is_active && ' · off now'}</div></Td>
                  <Td align="right">{p.orders} sale{p.orders === 1 ? '' : 's'}</Td>
                  <Td align="right">{money(p.discount, cur)}</Td>
                  <Td align="right">{money(p.order_value, cur)}</Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function StaffTab({ f }: { f: Filters }) {
  const org = useOrg();
  const cur = org.currency;
  const { data, error, isLoading } = useReport<StaffReport>('report_staff', filterArgs(f));
  if (!data) return <Loading error={error} loading={isLoading} />;
  return (
    <Card padded={false} title="By person" description="Who rang up each sale, the discounts they gave (promotions not included) and the returns they took."
      actions={<CsvButton onClick={() => downloadCsv(`staff-${fileSuffix(f)}.csv`, ['Person', 'Role', 'Sales', 'Sales value', 'Net sales', 'Average sale', 'Discounts given', 'Discount %', 'Returns', 'Refunded'],
        data.staff.map((s) => [s.name, s.role, s.orders, s.order_value, s.net_sales, s.average_sale, s.manual_discounts, s.discount_rate, s.returns, s.refunded]))} />}>
      {!data.staff.length ? <p className="p-6 text-center text-sm text-muted">No sales or returns in this period.</p> : (
        <Table>
          <thead><tr><Th>Person</Th><Th align="right">Sales</Th><Th align="right">Sales value</Th><Th align="right">Average</Th><Th align="right">Discounts given</Th><Th align="right">Returns</Th></tr></thead>
          <tbody>{data.staff.map((s) => (
            <tr key={s.user_id ?? 'self'}>
              <Td><div className="font-medium">{s.name}</div>{s.role && <div className="text-xs text-muted">{titleCase(s.role)}</div>}</Td>
              <Td align="right">{s.orders}</Td>
              <Td align="right">{money(s.order_value, cur)}</Td>
              <Td align="right">{money(s.average_sale, cur)}</Td>
              <Td align="right">{s.manual_discounts > 0 ? <>{money(s.manual_discounts, cur)} <span className="text-xs text-muted">({pct(s.discount_rate)})</span></> : '-'}</Td>
              <Td align="right">{s.returns > 0 ? <>{s.returns} <span className="text-xs text-muted">({money(s.refunded, cur)})</span></> : '-'}</Td>
            </tr>
          ))}</tbody>
        </Table>
      )}
    </Card>
  );
}
