import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import type { Enums } from '@nws-commerce/db';
import { supabase } from '../lib/supabase';
import { unwrap } from '../lib/api';
import { useOrg } from '../lib/workspace';
import { dateTime, money, qty } from '../lib/format';
import { CHANNEL, METHOD, ORDER_STATUS, PAYMENT_STATE } from '../lib/labels';
import { ReturnDialog } from '../components/ReturnDialog';
import { Badge, Button, Card, Dialog, ErrorNote, Field, Input, PageHeader, Select, Spinner, Table, Td, Th, useToast } from '@nws-commerce/ui';

export function OrderDetail() {
  const { id } = useParams();
  const org = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [paying, setPaying] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [returning, setReturning] = useState(false);

  const { data: o, isLoading, error } = useQuery({
    queryKey: ['order', id],
    queryFn: async () => unwrap(await supabase.from('orders')
      .select('*, customers(id, full_name, phone, email), locations(name), order_lines(*, order_line_units(serial_units(serial))), payments(*), order_promotions(amount, promotions(name))')
      .eq('id', id!).single()),
  });

  const act = useMutation({
    mutationFn: async (action: 'confirm' | 'cancel') => action === 'confirm'
      ? unwrap(await supabase.rpc('confirm_order', { p_order_id: id! }))
      : unwrap(await supabase.rpc('cancel_order', { p_order_id: id!, p_reason: 'cancelled from admin' })),
    onSuccess: (_d, action) => { qc.invalidateQueries({ queryKey: ['order', id] }); qc.invalidateQueries({ queryKey: ['orders'] }); toast(action === 'confirm' ? 'Order confirmation attempted' : 'Order cancelled'); },
  });

  if (isLoading) return <Spinner />;
  if (!o) return <ErrorNote error={error ?? new Error('Order not found')} />;

  const balance = Math.max(o.total - o.amount_paid, 0);
  const refundable = o.amount_paid - o.amount_refunded;
  const open = ['pending_payment', 'expired', 'stock_conflict'].includes(o.status);
  const lines = [...o.order_lines].sort((a, b) => a.position - b.position);
  const payments = [...o.payments].sort((a, b) => a.created_at.localeCompare(b.created_at));

  return (
    <>
      <PageHeader
        back={<Link to="/orders" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text"><ArrowLeft className="size-4" />Orders</Link>}
        title={<span className="flex items-center gap-3">{o.number}<Badge tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</Badge></span>}
        description={`${CHANNEL[o.channel]} · ${o.locations?.name ?? ''} · ${dateTime(o.placed_at)}`}
        actions={<>
          {open && org.can('orders.manage') && <Button onClick={() => act.mutate('cancel')} busy={act.isPending && act.variables === 'cancel'}>Cancel order</Button>}
          {open && org.can('orders.manage') && <Button onClick={() => act.mutate('confirm')} busy={act.isPending && act.variables === 'confirm'}>Confirm without payment</Button>}
          {org.has('returns') && ['confirmed', 'completed'].includes(o.status) && org.can('orders.manage') && <Button onClick={() => setReturning(true)}>Return items</Button>}
          {refundable > 0 && org.can('orders.manage') && <Button onClick={() => setRefunding(true)}>Refund money only</Button>}
          {balance > 0 && !['cancelled', 'expired'].includes(o.status) && (org.can('orders.manage') || org.can('pos.sell')) &&
            <Button variant="primary" onClick={() => setPaying(true)}>Record payment</Button>}
        </>} />

      <ErrorNote error={act.error} />
      {o.status === 'stock_conflict' && (
        <div className="mb-5 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          This order was paid after its stock hold lapsed, and the stock had gone. Restock and confirm it, or refund the customer and cancel it.
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card padded={false} title="Items">
            <Table>
              <thead><tr><Th>Item</Th><Th align="right">Qty</Th><Th align="right">Price</Th><Th align="right">Discount</Th><Th align="right">Total</Th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <Td>
                      <div className="font-medium">{l.product_name}{l.variant_title !== 'Default' && <span className="font-normal text-muted"> · {l.variant_title}</span>}</div>
                      <div className="text-xs text-muted">
                        {[l.sku, l.lot_code && `Lot ${l.lot_code}`, l.tax_rate > 0 && `${l.tax_rate}% tax ${money(l.tax_amount, org.currency)}`].filter(Boolean).join(' · ')}
                      </div>
                      {l.order_line_units.length > 0 && <div className="mt-0.5 font-mono text-xs text-muted">{l.order_line_units.map((u) => u.serial_units?.serial).join(', ')}</div>}
                    </Td>
                    <Td align="right">{qty(l.quantity)}</Td>
                    <Td align="right">{money(l.unit_price, org.currency)}</Td>
                    <Td align="right" className="text-muted">{l.discount_amount > 0 ? `-${money(l.discount_amount, org.currency)}` : '-'}</Td>
                    <Td align="right" className="font-medium">{money(l.line_total, org.currency)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <dl className="space-y-1.5 border-t border-border px-4 py-3 text-sm">
              <Row label="Subtotal" value={money(o.subtotal, org.currency)} />
              {o.order_promotions.map((p, i) => (
                <Row key={i} label={`Promotion: ${p.promotions?.name ?? ''}`} value={`-${money(p.amount, org.currency)}`} muted />
              ))}
              {o.coupon_code && <Row label="Coupon" value={o.coupon_code} muted />}
              {o.discount_total > 0 && <Row label="Discounts" value={`-${money(o.discount_total, org.currency)}`} />}
              <Row label={o.tax_inclusive ? 'Tax included' : 'Tax'} value={money(o.tax_total, org.currency)} muted={o.tax_inclusive} />
              {o.shipping_total > 0 && <Row label="Delivery" value={money(o.shipping_total, org.currency)} />}
              <Row label="Total" value={money(o.total, org.currency)} strong />
            </dl>
          </Card>

          <Card padded={false} title="Payments" actions={<Badge tone={PAYMENT_STATE[o.payment_status].tone}>{PAYMENT_STATE[o.payment_status].label}</Badge>}>
            {payments.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted">No payments yet.</p> : (
              <Table>
                <thead><tr><Th>When</Th><Th>Method</Th><Th>Reference</Th><Th align="right">Amount</Th></tr></thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className={p.status === 'failed' ? 'opacity-60' : ''}>
                      <Td className="whitespace-nowrap text-muted">{dateTime(p.created_at)}</Td>
                      <Td>
                        {p.kind === 'refund' ? 'Refund · ' : ''}{METHOD[p.method]}
                        {p.status !== 'captured' && <> <Badge tone="danger">{p.status}</Badge></>}
                        {p.change_given ? <div className="text-xs text-muted">Tendered {money(p.tendered, org.currency)}, change {money(p.change_given, org.currency)}</div> : null}
                        {p.note && <div className="text-xs text-muted">{p.note}</div>}
                      </Td>
                      <Td className="text-muted">{[p.provider, p.provider_reference].filter(Boolean).join(' ') || '-'}</Td>
                      <Td align="right" className={p.kind === 'refund' ? 'text-danger' : ''}>{p.kind === 'refund' ? '-' : ''}{money(p.amount, org.currency)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            <dl className="space-y-1.5 border-t border-border px-4 py-3 text-sm">
              <Row label="Paid" value={money(o.amount_paid, org.currency)} />
              {o.amount_refunded > 0 && <Row label="Refunded" value={`-${money(o.amount_refunded, org.currency)}`} />}
              <Row label="Balance due" value={money(balance, org.currency)} strong />
            </dl>
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Customer">
            {o.customers ? (
              <div className="text-sm">
                <Link to={`/customers/${o.customers.id}`} className="font-medium hover:text-accent">{o.customers.full_name ?? 'Unnamed customer'}</Link>
                <div className="text-muted">{o.customers.phone}</div>
                <div className="text-muted">{o.customers.email}</div>
              </div>
            ) : <p className="text-sm text-muted">Walk-in or guest - no customer record.</p>}
          </Card>
          {o.channel !== 'pos' && (
            <Card title={o.fulfilment_method === 'delivery' ? 'Deliver to' : o.fulfilment_method === 'pickup' ? 'Collection' : 'Fulfilment'}>
              <div className="space-y-1 text-sm">
                {(() => {
                  const c = (o.contact ?? {}) as { full_name?: string; phone?: string; email?: string };
                  const a = (o.shipping_address ?? {}) as { line1?: string; line2?: string; city?: string; postcode?: string };
                  return <>
                    {c.full_name && <div className="font-medium">{c.full_name}</div>}
                    {c.phone && <div className="num text-muted">{c.phone}</div>}
                    {c.email && <div className="text-muted">{c.email}</div>}
                    {o.fulfilment_method === 'delivery' && <div className="pt-2">{[a.line1, a.line2, a.city, a.postcode].filter(Boolean).join(', ')}</div>}
                    {o.fulfilment_method === 'pickup' && <div className="pt-2 text-muted">Customer collects from {o.locations?.name}</div>}
                    {o.shipping_total > 0 && <div className="text-muted">Delivery charged {money(o.shipping_total, org.currency)}</div>}
                    {o.intended_payment_method && <div className="pt-2"><Badge tone="info">Pays by {METHOD[o.intended_payment_method].toLowerCase()}</Badge></div>}
                  </>;
                })()}
              </div>
            </Card>
          )}
          {o.note && <Card title="Note"><p className="whitespace-pre-line text-sm text-muted">{o.note}</p></Card>}
          {o.reservation_expires_at && <Card title="Stock hold"><p className="text-sm text-muted">Held until {dateTime(o.reservation_expires_at)}.</p></Card>}
        </div>
      </div>

      {paying && <PaymentDialog orderId={o.id} due={balance} hasCustomer={!!o.customers} onClose={() => setPaying(false)} />}
      {returning && <ReturnDialog orderId={o.id} hasCustomer={!!o.customers} onClose={() => setReturning(false)} />}
      {refunding && <RefundDialog orderId={o.id} refundable={refundable} hasCustomer={!!o.customers} onClose={() => setRefunding(false)} />}
    </>
  );
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'font-semibold text-text' : muted ? 'text-muted' : 'text-text'}`}>
      <dt>{label}</dt><dd className="num">{value}</dd>
    </div>
  );
}

const TAKE_METHODS: Enums['payment_method'][] = ['cash', 'card', 'bank_transfer', 'qr', 'cash_on_delivery', 'store_credit'];

function PaymentDialog({ orderId, due, hasCustomer, onClose }: { orderId: string; due: number; hasCustomer: boolean; onClose: () => void }) {
  const org = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [method, setMethod] = useState<Enums['payment_method']>('bank_transfer');
  const [amount, setAmount] = useState(String(due));
  const [reference, setReference] = useState('');
  const pay = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('record_payment', {
      p_order_id: orderId, p_method: method, p_amount: Number(amount), p_reference: reference || null,
    })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['order', orderId] }); qc.invalidateQueries({ queryKey: ['orders'] }); toast('Payment recorded'); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} title="Record a payment" description={`${money(due, org.currency)} is due. An online order that becomes fully paid is confirmed and its stock released for delivery.`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={pay.isPending} form="pay-form" type="submit">Record</Button></>}>
      <form id="pay-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); pay.mutate(); }}>
        <ErrorNote error={pay.error} />
        <Field label="Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value as Enums['payment_method'])}>
            {TAKE_METHODS.filter((m) => m !== 'store_credit' || hasCustomer).map((m) => <option key={m} value={m}>{METHOD[m]}</option>)}
          </Select>
        </Field>
        <Field label="Amount"><Input type="number" min="0.01" step="0.01" max={due} required value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Reference" hint="Bank slip, card authorisation or courier receipt number."><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
      </form>
    </Dialog>
  );
}

function RefundDialog({ orderId, refundable, hasCustomer, onClose }: { orderId: string; refundable: number; hasCustomer: boolean; onClose: () => void }) {
  const org = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [method, setMethod] = useState<Enums['payment_method']>(hasCustomer ? 'store_credit' : 'cash');
  const [amount, setAmount] = useState(String(refundable));
  const [reason, setReason] = useState('');
  const refund = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('refund_payment', {
      p_order_id: orderId, p_amount: Number(amount), p_method: method, p_reason: reason,
    })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['order', orderId] }); toast('Refund recorded'); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} title="Refund" description={`Up to ${money(refundable, org.currency)} can be refunded. This moves money only - returning goods to stock comes with the returns module.`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" busy={refund.isPending} form="refund-form" type="submit">Refund</Button></>}>
      <form id="refund-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); refund.mutate(); }}>
        <ErrorNote error={refund.error} />
        <Field label="Refund to">
          <Select value={method} onChange={(e) => setMethod(e.target.value as Enums['payment_method'])}>
            {hasCustomer && <option value="store_credit">Store credit</option>}
            <option value="cash">Cash</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option><option value="online_gateway">Online gateway</option>
          </Select>
        </Field>
        <Field label="Amount"><Input type="number" min="0.01" step="0.01" max={refundable} required value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Reason"><Input required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </form>
    </Dialog>
  );
}
