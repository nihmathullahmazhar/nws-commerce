import { useMemo, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Enums, Json, ReturnPreview } from '@nws-commerce/db';
import { Button, Checkbox, Dialog, ErrorNote, Field, Input, Select, Spinner } from '@nws-commerce/ui';
import { supabase } from '../lib/supabase';
import { unwrap } from '../lib/api';
import { money, qty } from '../lib/format';

export interface ReturnChoice {
  orderId: string;
  orderNumber: string;
  customerId: string | null;
  lines: { order_line_id: string; quantity: number; serials?: string[]; reason?: string }[];
  /** What the customer gets back: the return's value, capped at what they actually paid. */
  credit: number;
}

/** Find a sale by its receipt number, choose what's coming back, then refund or exchange. */
export function ReturnDialog({ orgId, currency, onClose, onRefund, onExchange, busy, error }: {
  orgId: string; currency: string; busy: boolean; error: unknown;
  onClose: () => void;
  onRefund: (c: ReturnChoice, method: Enums['payment_method']) => void;
  onExchange: (c: ReturnChoice) => void;
}) {
  const [number, setNumber] = useState('');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [findError, setFindError] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string[]>>({});
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<Enums['payment_method']>('cash');

  async function find(e: FormEvent) {
    e.preventDefault();
    setFindError(null);
    const n = number.trim().toUpperCase();
    const { data } = await supabase.from('orders').select('id').eq('organization_id', orgId).eq('number', n.startsWith('ORD-') ? n : `ORD-${n.padStart(6, '0')}`).maybeSingle();
    if (!data) setFindError('No sale with that receipt number.');
    else { setOrderId(data.id); setAmounts({}); setSerials({}); }
  }

  const lines = useMemo(() => Object.entries(amounts).flatMap(([id, v]) => {
    const s = serials[id];
    if (s) return s.length ? [{ order_line_id: id, quantity: s.length, serials: s }] : [];
    const n = Number(v);
    return n > 0 ? [{ order_line_id: id, quantity: n }] : [];
  }).map((l) => ({ ...l, ...(reason ? { reason } : {}) })), [amounts, serials, reason]);

  const base = useQuery({
    queryKey: ['till-return', orderId],
    enabled: !!orderId,
    queryFn: async () => unwrap(await supabase.rpc('preview_return', { p_order_id: orderId! })) as unknown as ReturnPreview,
  });
  const preview = useQuery({
    queryKey: ['till-return', orderId, JSON.stringify(lines)],
    enabled: !!orderId && lines.length > 0,
    queryFn: async () => unwrap(await supabase.rpc('preview_return', { p_order_id: orderId!, p_lines: lines as unknown as Json })) as unknown as ReturnPreview,
  });

  const b = base.data;
  const credit = lines.length && preview.data && b ? Math.min(preview.data.refund_total, b.refundable) : 0;
  const choice = (): ReturnChoice => ({ orderId: orderId!, orderNumber: b!.order_number, customerId: b!.customer_id, lines, credit });

  return (
    <Dialog open onClose={onClose} wide title="Return or exchange"
      footer={b && <>
        <Button onClick={onClose}>Cancel</Button>
        <Select className="h-10 w-40" value={method} onChange={(e) => setMethod(e.target.value as Enums['payment_method'])} aria-label="Refund to">
          <option value="cash">Refund cash</option><option value="card">Refund to card</option>
          {b.customer_id && <option value="store_credit">Store credit</option>}
        </Select>
        <Button busy={busy} disabled={!lines.length || preview.isFetching} onClick={() => onRefund(choice(), method)}>Refund {credit ? money(credit, currency) : ''}</Button>
        <Button variant="primary" disabled={!lines.length || preview.isFetching || busy} onClick={() => onExchange(choice())}>Exchange for other items</Button>
      </>}>
      <form onSubmit={find} className="flex gap-2">
        <Input autoFocus className="h-11" placeholder="Receipt number, e.g. ORD-000123 or 123" value={number} onChange={(e) => setNumber(e.target.value)} />
        <Button type="submit" className="h-11">Find sale</Button>
      </form>
      {findError && <p className="mt-2 text-sm text-danger">{findError}</p>}
      <div className="mt-3"><ErrorNote error={error ?? base.error ?? preview.error} /></div>
      {orderId && (base.isLoading ? <Spinner /> : b && (
        <div className="mt-4 space-y-4">
          <div className="text-sm text-muted">{b.order_number} · {new Date(b.placed_at).toLocaleDateString('en-LK', { dateStyle: 'medium' })}</div>
          {!b.within_return_period && <p className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">Outside the return period - a manager must take this return.</p>}
          <ul className="divide-y divide-border rounded-md border border-border">
            {b.lines.map((l) => (
              <li key={l.order_line_id} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
                <div><div className="font-medium">{l.name}{l.variant !== 'Default' && <span className="font-normal text-muted"> · {l.variant}</span>}</div>
                  <div className="text-xs text-muted">bought {qty(l.quantity)} · {money(l.line_total, currency)} · can return {qty(l.returnable)}</div></div>
                {l.returnable <= 0 ? <span className="text-xs text-muted">already returned</span> : l.serials ? (
                  <div className="space-y-1">{l.serials.map((s) => (
                    <Checkbox key={s} label={s} checked={serials[l.order_line_id]?.includes(s) ?? false}
                      onChange={(on) => { setSerials((x) => ({ ...x, [l.order_line_id]: on ? [...(x[l.order_line_id] ?? []), s] : (x[l.order_line_id] ?? []).filter((y) => y !== s) })); setAmounts((a) => ({ ...a, [l.order_line_id]: 'serial' })); }} />
                  ))}</div>
                ) : (
                  <Input className="h-9 w-20 text-right" type="number" min="0" max={l.returnable} step="any" aria-label="Quantity returned"
                    value={amounts[l.order_line_id] ?? ''} onChange={(e) => setAmounts((a) => ({ ...a, [l.order_line_id]: e.target.value }))} />
                )}
              </li>
            ))}
          </ul>
          <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. wrong size, faulty" /></Field>
          {lines.length > 0 && preview.data && (
            <p className="text-sm">Customer gets back <span className="num font-semibold">{money(credit, currency)}</span>
              {preview.data.refund_total > credit && <span className="text-muted"> (only {money(credit, currency)} was paid)</span>}. The items go to inspection.</p>
          )}
        </div>
      ))}
    </Dialog>
  );
}
