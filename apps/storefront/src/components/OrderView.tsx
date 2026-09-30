'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Clock } from 'lucide-react';
import { describeDbError, type OrderSummary } from '@nws-commerce/db';
import type { Store } from '@/lib/store';
import { browserClient } from '@/lib/supabase';
import { money, qty } from '@/lib/format';
import { Totals } from './Totals';

/** What the order link returns: the order, plus gift cards it bought and points it earned. */
type TokenOrder = OrderSummary & { gift_cards: { code: string; value: number; balance: number }[]; points_earned: number | null };

const STATUS: Record<OrderSummary['status'], string> = {
  pending_payment: 'Waiting for your payment', confirmed: 'Confirmed', completed: 'Completed',
  cancelled: 'Cancelled', expired: 'Expired - payment did not arrive in time', stock_conflict: 'We are sorting out stock for this order',
};

export function OrderView({ store, orderId }: { store: Store; orderId: string }) {
  const token = useSearchParams().get('t');
  const [order, setOrder] = useState<TokenOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    browserClient().rpc('get_order_by_token', { p_order_id: orderId, p_token: token ?? '' })
      .then(({ data, error }) => (error ? setError(describeDbError(error)) : setOrder(data as unknown as TokenOrder)));
  }, [orderId, token]);

  if (error) return <div className="mx-auto max-w-md py-20 text-center"><h1 className="text-xl font-semibold">Order not found</h1><p className="mt-2 text-ink-2">Use the link from your confirmation, or sign in to see your orders.</p></div>;
  if (!order) return <p className="py-20 text-center text-ink-2">Loading your order...</p>;

  const waitingTransfer = order.status === 'pending_payment' && order.intended_payment_method === 'bank_transfer';
  const cur = store.currency_code;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-start gap-3">
        {order.status === 'confirmed' || order.status === 'completed'
          ? <CheckCircle2 className="mt-1 size-7 shrink-0 text-ok" /> : <Clock className="mt-1 size-7 shrink-0 text-warn" />}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{order.status === 'confirmed' ? 'Thank you - your order is confirmed'
            : waitingTransfer ? 'Almost done - one step left' : `Order ${order.number}`}</h1>
          <p className="mt-1 text-ink-2">Order {order.number} · {STATUS[order.status]}</p>
        </div>
      </div>

      {waitingTransfer && (
        <section className="mt-8 rounded-lg border border-warn/40 bg-surface p-5">
          <h2 className="font-semibold">Transfer {money(order.balance_due, cur)} to complete your order</h2>
          <p className="mt-2 whitespace-pre-line text-sm text-ink-2">{store.bank_transfer_details}</p>
          <p className="mt-3 text-sm">Use <span className="font-semibold">{order.number}</span> as the reference.
            {order.reservation_expires_at && <> Your items are held until {new Date(order.reservation_expires_at).toLocaleString('en-LK', { dateStyle: 'medium', timeStyle: 'short' })}.</>}</p>
        </section>
      )}
      {order.intended_payment_method === 'cash_on_delivery' && order.status === 'confirmed' && (
        <p className="mt-6 text-sm text-ink-2">Please have {money(order.balance_due, cur)} ready {order.fulfilment_method === 'pickup' ? 'when you collect' : 'when it arrives'}. We&apos;ll call {order.contact.phone} if we need anything.</p>
      )}

      <div className="mt-8 grid gap-8 sm:grid-cols-2">
        <section>
          <h2 className="mb-2 font-semibold">{order.fulfilment_method === 'pickup' ? 'Collect from' : 'Delivering to'}</h2>
          {order.fulfilment_method === 'pickup'
            ? <p className="text-sm text-ink-2">{store.pickup_locations[0]?.name ?? store.name}</p>
            : <p className="text-sm text-ink-2">{order.contact.full_name}<br />{[order.shipping_address?.line1, order.shipping_address?.line2, order.shipping_address?.city, order.shipping_address?.postcode].filter(Boolean).join(', ')}</p>}
        </section>
        <section>
          <h2 className="mb-2 font-semibold">Contact</h2>
          <p className="text-sm text-ink-2">{order.contact.phone}{order.contact.email && <><br />{order.contact.email}</>}</p>
        </section>
      </div>

      <section className="mt-8 rounded-lg border border-line bg-surface p-5">
        <ul className="divide-y divide-line text-sm">
          {order.lines.map((l) => (
            <li key={l.line_id} className="flex justify-between gap-3 py-2">
              <span>{qty(l.quantity)} x {l.name}{l.variant !== 'Default' ? ` (${l.variant})` : ''}</span>
              <span className="num">{money(l.line_total, cur)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 border-t border-line pt-4"><Totals quote={order} currency={cur} /></div>
      </section>
      {order.gift_cards.length > 0 && (
        <section className="mt-6 rounded-lg border border-line bg-surface p-5">
          <h2 className="font-semibold">Your gift card{order.gift_cards.length > 1 ? 's' : ''}</h2>
          <p className="mt-1 text-sm text-ink-2">Give the code to whoever will use it. It works at the counter; keep it private, since the code is the card.</p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {order.gift_cards.map((g) => (
              <li key={g.code} className="flex justify-between gap-3"><span className="font-mono">{g.code}</span>
                <span className="num">{money(g.balance, cur)}{g.balance !== g.value && <span className="text-ink-3"> of {money(g.value, cur)}</span>}</span></li>
            ))}
          </ul>
        </section>
      )}
      {order.points_earned ? <p className="mt-4 text-sm text-ink-2">This order earned you {order.points_earned.toLocaleString()} loyalty points.</p> : null}
      {store.returns_enabled && ['confirmed', 'completed'].includes(order.status) && token && (
        <ReturnRequest order={order} token={token} returnDays={store.return_days} />
      )}
      <Link href="/search" className="mt-8 inline-block text-sm underline">Continue shopping</Link>
    </div>
  );
}

function ReturnRequest({ order, token, returnDays }: { order: OrderSummary; token: string; returnDays: number | null }) {
  const [open, setOpen] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [state, setState] = useState<{ ok?: string; error?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const lines = Object.entries(amounts).filter(([, v]) => Number(v) > 0).map(([id, v]) => ({ order_line_id: id, quantity: Number(v) }));
    if (!lines.length) { setState({ error: 'Choose what you are sending back.' }); return; }
    setBusy(true);
    const { data, error } = await browserClient().rpc('request_return', { p_order_id: order.order_id, p_token: token, p_lines: lines, p_reason: reason });
    setBusy(false);
    if (error) setState({ error: describeDbError(error) });
    else setState({ ok: `Return ${(data as { number: string }).number} requested. Send or bring the items back with this number; we refund once they arrive and have been checked.` });
  }

  if (state.ok) return <p className="mt-8 rounded-lg border border-line bg-surface p-4 text-sm">{state.ok}</p>;
  return (
    <section className="mt-8">
      {!open ? (
        <button onClick={() => setOpen(true)} className="text-sm underline">Return items{returnDays ? ` (within ${returnDays} days)` : ''}</button>
      ) : (
        <form onSubmit={submit} className="space-y-4 rounded-lg border border-line bg-surface p-5">
          <h2 className="font-semibold">What are you returning?</h2>
          <ul className="space-y-2 text-sm">
            {order.lines.filter((l) => !l.serials?.length).map((l) => (
              <li key={l.line_id} className="flex items-center justify-between gap-3">
                <span>{l.name}{l.variant !== 'Default' ? ` (${l.variant})` : ''} <span className="text-ink-3">- bought {qty(l.quantity)}</span></span>
                <input type="number" min="0" max={l.quantity} step="any" aria-label={`Quantity of ${l.name} to return`}
                  value={amounts[l.line_id] ?? ''} onChange={(e) => setAmounts((a) => ({ ...a, [l.line_id]: e.target.value }))}
                  className="h-9 w-20 rounded-md border border-line bg-bg px-2 text-right" />
              </li>
            ))}
          </ul>
          {order.lines.some((l) => l.serials?.length) && <p className="text-xs text-ink-2">Items with a serial number are returned in store or by calling us.</p>}
          <textarea required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are you returning it?"
            className="h-20 w-full rounded-md border border-line bg-bg px-3 py-2 text-sm" />
          {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
          <button disabled={busy} className="h-10 rounded-md bg-brand px-4 text-sm font-medium text-brand-fg disabled:opacity-40">{busy ? 'Sending...' : 'Request return'}</button>
        </form>
      )}
    </section>
  );
}
