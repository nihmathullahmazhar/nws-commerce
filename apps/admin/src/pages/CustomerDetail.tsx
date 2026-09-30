import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { unwrap } from '../lib/api';
import { useOrg } from '../lib/workspace';
import { dateTime, money } from '../lib/format';
import { CHANNEL, ORDER_STATUS } from '../lib/labels';
import { Badge, Button, Card, Dialog, ErrorNote, Field, Input, PageHeader, Spinner, Stat, Table, Td, Th, useToast } from '@nws-commerce/ui';
import { CustomerDialog } from './Customers';

export function CustomerDetail() {
  const { id } = useParams();
  const org = useOrg();
  const [editing, setEditing] = useState(false);
  const [crediting, setCrediting] = useState(false);
  const [pointing, setPointing] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['customer', id],
    queryFn: async () => {
      const [customer, orders, ledger, points] = await Promise.all([
        supabase.from('customers').select('*').eq('id', id!).single(),
        supabase.from('orders').select('id, number, channel, status, total, amount_paid, amount_refunded, placed_at')
          .eq('customer_id', id!).order('placed_at', { ascending: false }).limit(100),
        supabase.from('store_credit_ledger').select('*').eq('customer_id', id!).order('created_at', { ascending: false }).limit(50),
        supabase.from('loyalty_ledger').select('*').eq('customer_id', id!).order('created_at', { ascending: false }).limit(50),
      ]);
      return { customer: unwrap(customer), orders: unwrap(orders), ledger: unwrap(ledger), points: unwrap(points) };
    },
  });

  if (isLoading) return <Spinner />;
  if (!data) return <ErrorNote error={error} />;
  const { customer: c, orders, ledger, points } = data;
  const loyalty = org.has('loyalty');
  const counted = orders.filter((o) => ['confirmed', 'completed'].includes(o.status));
  const spent = counted.reduce((s, o) => s + o.total - o.amount_refunded, 0);
  const byChannel = counted.reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.channel]: (acc[o.channel] ?? 0) + 1 }), {});

  return (
    <>
      <PageHeader
        back={<Link to="/customers" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text"><ArrowLeft className="size-4" />Customers</Link>}
        title={c.full_name || 'Unnamed customer'}
        description={[c.phone, c.email].filter(Boolean).join(' · ')}
        actions={<>
          {loyalty && org.can('orders.manage') && <Button onClick={() => setPointing(true)}>Adjust points</Button>}
          {org.can('orders.manage') && <Button onClick={() => setCrediting(true)}>Adjust store credit</Button>}
          {org.can('customers.manage') && <Button onClick={() => setEditing(true)}>Edit</Button>}
        </>} />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Lifetime spend" value={money(spent, org.currency)} />
        <Stat label="Orders" value={counted.length} sub={Object.entries(byChannel).map(([k, n]) => `${n} ${CHANNEL[k as keyof typeof CHANNEL].toLowerCase()}`).join(' · ') || undefined} />
        <Stat label="Store credit" value={money(c.store_credit_balance, org.currency)} />
        {loyalty ? <Stat label="Loyalty points" value={c.loyalty_points.toLocaleString()} sub={c.auth_user_id ? 'Online account' : 'In-store only'} />
          : <Stat label="Account" value={c.auth_user_id ? 'Online account' : 'In-store only'} />}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card padded={false} title="Orders" className="lg:col-span-2" description="Every channel, one history.">
          {orders.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted">No orders yet.</p> : (
            <Table>
              <thead><tr><Th>Order</Th><Th>Channel</Th><Th>Status</Th><Th align="right">Total</Th></tr></thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <Td><Link to={`/orders/${o.id}`} className="font-medium hover:text-accent">{o.number}</Link><div className="text-xs text-muted">{dateTime(o.placed_at)}</div></Td>
                    <Td>{CHANNEL[o.channel]}</Td>
                    <Td><Badge tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</Badge></Td>
                    <Td align="right">{money(o.total, org.currency)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <div className="space-y-5">
        {loyalty && (
          <Card padded={false} title="Points history">
            {points.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted">No points yet.</p> : (
              <ul className="divide-y divide-border">
                {points.map((l) => (
                  <li key={l.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
                    <div className="min-w-0"><div className="truncate">{l.reason}</div><div className="text-xs text-muted">{dateTime(l.created_at)}</div></div>
                    <span className={`num shrink-0 ${l.points < 0 ? 'text-danger' : 'text-ok'}`}>{l.points > 0 ? '+' : ''}{l.points.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        <Card padded={false} title="Store credit history">
          {ledger.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted">No store credit activity.</p> : (
            <ul className="divide-y divide-border">
              {ledger.map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0"><div className="truncate">{l.reason}</div><div className="text-xs text-muted">{dateTime(l.created_at)}</div></div>
                  <span className={`num shrink-0 ${l.amount < 0 ? 'text-danger' : 'text-ok'}`}>{l.amount > 0 ? '+' : ''}{money(l.amount, org.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        </div>
      </div>

      {pointing && <PointsDialog customerId={c.id} balance={c.loyalty_points} onClose={() => setPointing(false)} />}
      {editing && <CustomerDialog existing={c} onClose={() => setEditing(false)} />}
      {crediting && <CreditDialog customerId={c.id} balance={c.store_credit_balance} onClose={() => setCrediting(false)} />}
    </>
  );
}

function CreditDialog({ customerId, balance, onClose }: { customerId: string; balance: number; onClose: () => void }) {
  const org = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const adjust = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('adjust_store_credit', { p_customer_id: customerId, p_amount: Number(amount), p_reason: reason })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customer', customerId] }); toast('Store credit updated'); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} title="Adjust store credit" description={`Current balance ${money(balance, org.currency)}. Use a negative amount to take credit away.`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={adjust.isPending} form="credit-form" type="submit">Save</Button></>}>
      <form id="credit-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); adjust.mutate(); }}>
        <ErrorNote error={adjust.error} />
        <Field label="Amount"><Input type="number" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Reason" hint="Kept permanently in the credit history."><Input required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </form>
    </Dialog>
  );
}

function PointsDialog({ customerId, balance, onClose }: { customerId: string; balance: number; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const n = Math.trunc(Number(points));
  const save = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('adjust_loyalty_points', { p_customer_id: customerId, p_points: n, p_reason: reason })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customer', customerId] }); toast('Points updated'); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} title="Adjust points" description={`Now ${balance.toLocaleString()} points. Use a negative number to take points away.`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={save.isPending} disabled={!n || reason.trim().length < 3} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-4">
        <ErrorNote error={save.error} />
        <Field label="Points"><Input type="number" step="1" value={points} onChange={(e) => setPoints(e.target.value)} placeholder="e.g. 200 or -50" /></Field>
        <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. birthday bonus" /></Field>
      </div>
    </Dialog>
  );
}
