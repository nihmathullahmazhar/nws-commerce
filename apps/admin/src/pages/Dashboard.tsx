import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Check, Circle } from 'lucide-react';
import type { DashboardSummary } from '@nws-commerce/db';
import { supabase } from '../lib/supabase';
import { unwrap } from '../lib/api';
import { useOrg } from '../lib/workspace';
import { money, titleCase } from '../lib/format';
import { Card, ErrorNote, PageHeader, Spinner, Stat, Tabs } from '@nws-commerce/ui';

type Range = 'today' | '7d' | '30d';

function rangeBounds(range: Range): [string, string] {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (range === '7d') start.setDate(start.getDate() - 6);
  if (range === '30d') start.setDate(start.getDate() - 29);
  const end = new Date(Date.now() + 60_000);
  return [start.toISOString(), end.toISOString()];
}

export function Dashboard() {
  const org = useOrg();
  const [range, setRange] = useState<Range>('today');
  const [from, to] = rangeBounds(range);

  const { data, error, isLoading } = useQuery({
    queryKey: ['dashboard', org.id, range],
    queryFn: async () => unwrap(await supabase.rpc('dashboard_summary', {
      p_organization_id: org.id, p_from: from, p_to: to,
    })) as unknown as DashboardSummary,
  });

  return (
    <>
      <PageHeader title="Dashboard" description={`${org.name} · every channel, one set of numbers`} />
      <Tabs value={range} onChange={setRange} tabs={[
        { value: 'today', label: 'Today' }, { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' },
      ]} />
      <ErrorNote error={error} />
      {isLoading || !data ? <Spinner /> : <DashboardBody data={data} currency={org.currency} />}
    </>
  );
}

function DashboardBody({ data, currency }: { data: DashboardSummary; currency: string }) {
  const t = data.totals;
  const setupDone = Object.values(data.setup).every(Boolean);
  const alerts = [
    data.stock_conflicts > 0 && { to: '/orders?status=stock_conflict', text: `${data.stock_conflicts} paid order${data.stock_conflicts === 1 ? '' : 's'} could not be fulfilled - refund or restock`, tone: 'danger' },
    data.awaiting_payment > 0 && { to: '/orders?status=pending_payment', text: `${data.awaiting_payment} online order${data.awaiting_payment === 1 ? '' : 's'} waiting for payment`, tone: 'warn' },
    data.low_stock > 0 && { to: '/inventory?low=1', text: `${data.low_stock} item${data.low_stock === 1 ? ' is' : 's are'} running low`, tone: 'warn' },
  ].filter(Boolean) as { to: string; text: string; tone: string }[];

  return (
    <div className="space-y-6">
      {!setupDone && <SetupChecklist setup={data.setup} />}

      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a) => (
            <Link key={a.to} to={a.to} className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-sm ${a.tone === 'danger' ? 'border-danger/30 bg-danger-soft text-danger' : 'border-warn/30 bg-warn-soft text-warn'}`}>
              <span className="flex items-center gap-2"><AlertTriangle className="size-4" />{a.text}</span>
              <ArrowRight className="size-4" />
            </Link>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sales" value={money(t.sales, currency)} sub={`${t.orders} order${t.orders === 1 ? '' : 's'}`} />
        <Stat label="Average order" value={t.orders ? money(t.sales / t.orders, currency) : '-'} />
        <Stat label="Discounts given" value={money(t.discounts, currency)} />
        <Stat label="Refunded" value={money(t.refunds, currency)} sub={t.outstanding > 0 ? `${money(t.outstanding, currency)} still owed` : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Sales by channel" description="Counter, online, app, phone and admin orders from the same ledger">
          <BarList
            empty="No sales in this period."
            rows={data.by_channel.map((c) => ({ label: titleCase(c.channel), value: c.sales, note: `${c.orders} order${c.orders === 1 ? '' : 's'}` }))}
            format={(v) => money(v, currency)} />
        </Card>
        <Card title="Money in by payment method" description="Payments less refunds">
          <BarList
            empty="No payments in this period."
            rows={data.by_method.map((m) => ({ label: titleCase(m.method), value: m.amount }))}
            format={(v) => money(v, currency)} />
        </Card>
      </div>
    </div>
  );
}

/** One series, sorted, direct-labelled: magnitude comparison without a legend. */
function BarList({ rows, format, empty }: {
  rows: { label: string; value: number; note?: string }[]; format: (v: number) => string; empty: string;
}) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${format(r.value)}${r.note ? ` (${r.note})` : ''}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="text-text">{r.label}{r.note && <span className="ml-2 text-xs text-muted">{r.note}</span>}</span>
            <span className="num font-medium text-text">{format(r.value)}</span>
          </div>
          <div className="h-2 rounded bg-surface-2">
            <div className="h-2 rounded bg-accent" style={{ width: `${Math.max((Math.abs(r.value) / max) * 100, 1.5)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** First-run tour: what to do first, in order. No sample data is created. */
function SetupChecklist({ setup }: { setup: DashboardSummary['setup'] }) {
  const org = useOrg();
  const steps = [
    { done: setup.has_tax_rate, title: 'Set your tax rate', body: 'Add VAT (or mark products exempt) so every price is taxed correctly.', to: '/settings?tab=tax', show: org.can('settings.manage') },
    { done: setup.has_product, title: 'Add your first product', body: 'Sizes, colours or storage become variants, each with its own SKU, barcode and price.', to: '/products/new', show: org.can('catalog.manage') },
    { done: setup.has_stock, title: 'Receive stock', body: 'Record what is on your shelves. Every unit in or out is kept in the stock ledger.', to: '/inventory/receive', show: org.can('inventory.receive') },
    { done: setup.has_staff, title: 'Add your staff', body: 'Give cashiers, managers and stock keepers their own logins and limits.', to: '/settings?tab=staff', show: org.can('staff.manage') },
    { done: setup.has_sale, title: 'Make your first sale', body: 'Sales from the counter and the online store appear here as they happen.', to: null, show: true },
  ].filter((s) => s.show);
  const done = steps.filter((s) => s.done).length;

  return (
    <Card title="Getting started" description={`${done} of ${steps.length} done. Your business starts empty - nothing here is sample data.`}>
      <ol className="divide-y divide-border">
        {steps.map((s) => (
          <li key={s.title} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            {s.done ? <Check className="mt-0.5 size-4 text-ok" /> : <Circle className="mt-0.5 size-4 text-faint" />}
            <div className="min-w-0 flex-1">
              <div className={`text-sm font-medium ${s.done ? 'text-muted line-through' : 'text-text'}`}>{s.title}</div>
              {!s.done && <div className="mt-0.5 text-sm text-muted">{s.body}</div>}
            </div>
            {!s.done && s.to && <Link to={s.to} className="text-sm font-medium text-accent hover:underline">Start</Link>}
          </li>
        ))}
      </ol>
    </Card>
  );
}
