import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Receipt, Search } from 'lucide-react';
import type { Enums } from '@nws-commerce/db';
import { supabase } from '../lib/supabase';
import { unwrap } from '../lib/api';
import { useOrg } from '../lib/workspace';
import { dateTime, money } from '../lib/format';
import { CHANNEL, ORDER_STATUS, PAYMENT_STATE } from '../lib/labels';
import { Badge, Card, EmptyState, ErrorNote, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@nws-commerce/ui';

export function Orders() {
  const org = useOrg();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const status = params.get('status') ?? '';
  const channel = params.get('channel') ?? '';
  const setParam = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };

  const { data, isLoading, error } = useQuery({
    queryKey: ['orders', org.id, status, channel, search],
    queryFn: async () => {
      let q = supabase.from('orders')
        .select('id, number, channel, status, payment_status, total, placed_at, customers(full_name, phone), locations(name)')
        .eq('organization_id', org.id).order('placed_at', { ascending: false }).limit(200);
      if (status) q = q.eq('status', status as Enums['order_status']);
      if (channel) q = q.eq('channel', channel as Enums['sales_channel']);
      if (search.trim()) q = q.ilike('number', `%${search.trim()}%`);
      return unwrap(await q);
    },
  });

  return (
    <>
      <PageHeader title="Orders" description="Counter, online, app, phone and admin orders in one list." />
      <Card padded={false}>
        <div className="flex flex-wrap gap-2 border-b border-border p-3">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-faint" />
            <Input className="pl-8" placeholder="Order number" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select className="w-44" value={status} onChange={(e) => setParam('status', e.target.value)}>
            <option value="">Any status</option>
            {Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
          <Select className="w-36" value={channel} onChange={(e) => setParam('channel', e.target.value)}>
            <option value="">Any channel</option>
            {Object.entries(CHANNEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        <ErrorNote error={error} />
        {isLoading ? <Spinner /> : !data?.length ? (
          status || channel || search
            ? <EmptyState title="No orders match" icon={<Search className="size-5" />} />
            : <EmptyState icon={<Receipt className="size-5" />} title="No orders yet">
                Orders from the counter, the online store and phone orders all land here, each with its channel.
              </EmptyState>
        ) : (
          <Table>
            <thead><tr><Th>Order</Th><Th>Customer</Th><Th>Channel</Th><Th>Status</Th><Th>Payment</Th><Th align="right">Total</Th></tr></thead>
            <tbody>
              {data.map((o) => (
                <tr key={o.id} className="hover:bg-surface-2/60">
                  <Td>
                    <Link to={`/orders/${o.id}`} className="font-medium hover:text-accent">{o.number}</Link>
                    <div className="text-xs text-muted">{dateTime(o.placed_at)}{org.locations.length > 1 && o.locations ? ` · ${o.locations.name}` : ''}</div>
                  </Td>
                  <Td className="text-muted">{o.customers?.full_name ?? o.customers?.phone ?? 'Walk-in / guest'}</Td>
                  <Td>{CHANNEL[o.channel]}</Td>
                  <Td><Badge tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</Badge></Td>
                  <Td><Badge tone={PAYMENT_STATE[o.payment_status].tone}>{PAYMENT_STATE[o.payment_status].label}</Badge></Td>
                  <Td align="right" className="font-medium">{money(o.total, org.currency)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
