import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Enums, Json, ReturnPreview, ReturnSummary } from '@nws-commerce/db';
import { Button, Checkbox, Dialog, ErrorNote, Field, Input, Select, Spinner, useToast } from '@nws-commerce/ui';
import { supabase } from '../lib/supabase';
import { unwrap } from '../lib/api';
import { useOrg } from '../lib/workspace';
import { money, qty } from '../lib/format';
import { METHOD } from '../lib/labels';

/** Take back items from an order: pick lines (and serials), see the exact refund, choose how it's paid back. */
export function ReturnDialog({ orderId, hasCustomer, onClose }: { orderId: string; hasCustomer: boolean; onClose: () => void }) {
  const org = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string[]>>({});
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(false);
  const [locationId, setLocationId] = useState(org.locations.find((l) => l.is_active)?.id ?? '');
  const [method, setMethod] = useState<Enums['payment_method']>(hasCustomer ? 'store_credit' : 'cash');

  const lines = useMemo(() => Object.entries(amounts).flatMap(([id, v]) => {
    const s = serials[id];
    if (s) return s.length ? [{ order_line_id: id, quantity: s.length, serials: s }] : [];
    const n = Number(v);
    return n > 0 ? [{ order_line_id: id, quantity: n }] : [];
  }).map((l) => ({ ...l, reason: reason || undefined, ...(restock ? { disposition: 'restock' } : {}) })), [amounts, serials, reason, restock]);

  const base = useQuery({
    queryKey: ['return-preview', orderId],
    queryFn: async () => unwrap(await supabase.rpc('preview_return', { p_order_id: orderId })) as unknown as ReturnPreview,
  });
  const preview = useQuery({
    queryKey: ['return-preview', orderId, JSON.stringify(lines)],
    enabled: lines.length > 0,
    queryFn: async () => unwrap(await supabase.rpc('preview_return', { p_order_id: orderId, p_lines: lines as unknown as Json })) as unknown as ReturnPreview,
  });

  const take = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('create_return', {
      p_order_id: orderId, p_location_id: locationId, p_lines: lines as unknown as Json,
      p_refunds: [{ method }] as unknown as Json, p_reason: reason || null, p_idempotency_key: null,
    })) as unknown as ReturnSummary,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['order', orderId] });
      qc.invalidateQueries({ queryKey: ['returns'] });
      qc.invalidateQueries({ queryKey: ['return-preview', orderId] });
      toast(`${r.number} taken - ${money(r.refund_total, org.currency)} refunded`);
      onClose();
    },
  });

  const refund = lines.length ? preview.data?.refund_total : 0;
  const paidBack = refund !== undefined && base.data ? Math.min(refund, base.data.refundable) : undefined;

  return (
    <Dialog open onClose={onClose} wide title={`Return items${base.data ? ` from ${base.data.order_number}` : ''}`}
      description="Returned goods go to inspection unless you put them straight back on sale."
      footer={<><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={take.isPending} disabled={!lines.length || paidBack === undefined || !locationId}
          onClick={() => take.mutate()}>Take return{paidBack !== undefined && lines.length ? ` · refund ${money(paidBack, org.currency)}` : ''}</Button></>}>
      {base.isLoading ? <Spinner /> : !base.data ? <ErrorNote error={base.error} /> : (
        <div className="space-y-5">
          <ErrorNote error={take.error ?? preview.error} />
          {!base.data.within_return_period && <p className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">This sale is outside your return period. You can still take it back as a manager.</p>}
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="pb-2">Item</th><th className="pb-2 text-right">Bought</th><th className="pb-2 text-right">Can return</th><th className="pb-2 text-right">Returning</th></tr></thead>
            <tbody className="divide-y divide-border">
              {base.data.lines.map((l) => (
                <tr key={l.order_line_id} className="align-top">
                  <td className="py-2">{l.name}{l.variant !== 'Default' && <span className="text-muted"> · {l.variant}</span>}<div className="text-xs text-muted">{money(l.line_total, org.currency)} paid</div></td>
                  <td className="py-2 text-right">{qty(l.quantity)}</td>
                  <td className="py-2 text-right">{qty(l.returnable)}</td>
                  <td className="py-2 text-right">
                    {l.returnable <= 0 ? <span className="text-muted">-</span> : l.serials ? (
                      <div className="space-y-1 text-left">
                        {l.serials.map((s) => (
                          <Checkbox key={s} label={s} checked={serials[l.order_line_id]?.includes(s) ?? false}
                            onChange={(on) => { setSerials((x) => ({ ...x, [l.order_line_id]: on ? [...(x[l.order_line_id] ?? []), s] : (x[l.order_line_id] ?? []).filter((y) => y !== s) })); setAmounts((a) => ({ ...a, [l.order_line_id]: 'serial' })); }} />
                        ))}
                      </div>
                    ) : (
                      <Input className="ml-auto h-8 w-20 text-right" type="number" min="0" max={l.returnable} step="any"
                        value={amounts[l.order_line_id] ?? ''} onChange={(e) => setAmounts((a) => ({ ...a, [l.order_line_id]: e.target.value }))} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. wrong size, faulty" /></Field>
            <Field label="Received at">
              <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                {org.locations.filter((l) => l.is_active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
            <Field label="Refund to">
              <Select value={method} onChange={(e) => setMethod(e.target.value as Enums['payment_method'])}>
                {hasCustomer && <option value="store_credit">{METHOD.store_credit}</option>}
                {(['cash', 'card', 'bank_transfer', 'online_gateway'] as const).map((m) => <option key={m} value={m}>{METHOD[m]}</option>)}
              </Select>
            </Field>
          </div>
          {org.can('inventory.adjust') && <Checkbox label="Unopened - put straight back on sale" hint="Otherwise the items wait in Returns for inspection." checked={restock} onChange={setRestock} />}
          {lines.length > 0 && refund !== undefined && (
            <p className="text-sm">Worth <span className="num font-semibold">{money(refund, org.currency)}</span> (what was paid for them, discounts and tax included).
              {base.data.refundable < refund && <> Only {money(base.data.refundable, org.currency)} was paid, so that is what goes back.</>}</p>
          )}
        </div>
      )}
    </Dialog>
  );
}
