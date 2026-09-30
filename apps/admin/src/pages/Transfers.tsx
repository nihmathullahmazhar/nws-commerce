import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Plus, Trash2, Truck } from 'lucide-react';
import type { Enums, Json } from '@nws-commerce/db';
import { Badge, Button, Card, Dialog, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, Table, Td, Textarea, Th, useToast } from '@nws-commerce/ui';
import { supabase } from '../lib/supabase';
import { unwrap } from '../lib/api';
import { useOrg } from '../lib/workspace';
import { dateTime, qty } from '../lib/format';
import { VariantPicker, type VariantHit } from '../components/VariantPicker';

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info';
const STATUS: Record<Enums['transfer_status'], { label: string; tone: Tone }> = {
  requested: { label: 'Requested', tone: 'warn' }, approved: { label: 'Approved - to pack', tone: 'info' },
  dispatched: { label: 'In transit', tone: 'accent' }, received: { label: 'Received', tone: 'ok' }, cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export function Transfers() {
  const org = useOrg();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['transfers', org.id],
    queryFn: async () => unwrap(await supabase.from('stock_transfers')
      .select('id, number, status, requested_at, note, from:locations!stock_transfers_organization_id_from_location_id_fkey(name), to:locations!stock_transfers_organization_id_to_location_id_fkey(name), stock_transfer_lines(quantity)')
      .eq('organization_id', org.id).order('requested_at', { ascending: false }).limit(200)),
  });
  return (
    <>
      <PageHeader title="Transfers" description="Moving stock between your shops and warehouse. Approved stock is held; dispatched stock is in transit until it's received."
        actions={org.can('transfers.request') && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Request transfer</Button>} />
      <Card padded={false}>
        <ErrorNote error={error} />
        {isLoading ? <Spinner /> : !data?.length ? (
          <EmptyState icon={<Truck className="size-5" />} title="No transfers yet">Request stock from another location. A manager approves, the sending shop dispatches, the receiving shop checks it in.</EmptyState>
        ) : (
          <Table>
            <thead><tr><Th>Transfer</Th><Th>Route</Th><Th align="right">Units</Th><Th>Status</Th></tr></thead>
            <tbody>
              {data.map((t) => (
                <tr key={t.id} className="hover:bg-surface-2/60">
                  <Td><button className="font-medium hover:text-accent" onClick={() => setOpen(t.id)}>{t.number}</button><div className="text-xs text-muted">{dateTime(t.requested_at)}</div></Td>
                  <Td><span className="inline-flex items-center gap-1.5">{t.from?.name}<ArrowRight className="size-3.5 text-muted" />{t.to?.name}</span></Td>
                  <Td align="right">{qty(t.stock_transfer_lines.reduce((s, l) => s + l.quantity, 0))}</Td>
                  <Td><Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {creating && <NewTransfer onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpen(id); }} />}
      {open && <TransferDetail id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function NewTransfer({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const org = useOrg();
  const qc = useQueryClient();
  const active = org.locations.filter((l) => l.is_active);
  const [from, setFrom] = useState(active[0]?.id ?? '');
  const [to, setTo] = useState(active[1]?.id ?? '');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<{ variant_id: string; name: string; available: number; quantity: string }[]>([]);
  const create = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('request_transfer', {
      p_from: from, p_to: to, p_note: note || null,
      p_lines: lines.map((l) => ({ variant_id: l.variant_id, quantity: Number(l.quantity) })) as unknown as Json,
    })),
    onSuccess: (id) => { qc.invalidateQueries({ queryKey: ['transfers'] }); onCreated(id); },
  });
  const add = (v: VariantHit) => setLines((ls) => ls.some((l) => l.variant_id === v.variant_id) ? ls
    : [...ls, { variant_id: v.variant_id!, name: `${v.product_name}${v.variant_title !== 'Default' ? ` · ${v.variant_title}` : ''}`, available: Number(v.available ?? 0), quantity: '1' }]);
  return (
    <Dialog open onClose={onClose} wide title="Request a transfer"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={create.isPending} disabled={!lines.length || from === to || lines.some((l) => !(Number(l.quantity) > 0))} onClick={() => create.mutate()}>Request</Button></>}>
      <div className="space-y-4">
        <ErrorNote error={create.error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From"><Select value={from} onChange={(e) => { setFrom(e.target.value); setLines([]); }}>{active.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
          <Field label="To" error={from === to ? 'Choose a different location.' : undefined}><Select value={to} onChange={(e) => setTo(e.target.value)}>{active.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        </div>
        <VariantPicker key={from} onPick={add} locationId={from} placeholder="Add an item (stock shown is at the sending location)" />
        {lines.length > 0 && (
          <ul className="divide-y divide-border rounded-md border border-border">
            {lines.map((l, i) => (
              <li key={l.variant_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span>{l.name} <span className="text-xs text-muted">{qty(l.available)} available there</span></span>
                <span className="flex items-center gap-2">
                  <Input className="h-8 w-24 text-right" type="number" min="0" step="any" value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
                  <Button size="sm" variant="ghost" aria-label="Remove" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. for the weekend promotion" /></Field>
      </div>
    </Dialog>
  );
}

function TransferDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const org = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [receiving, setReceiving] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const { data: t, error } = useQuery({
    queryKey: ['transfer', id],
    queryFn: async () => unwrap(await supabase.from('stock_transfers')
      .select('*, from:locations!stock_transfers_organization_id_from_location_id_fkey(name), to:locations!stock_transfers_organization_id_to_location_id_fkey(name), stock_transfer_lines(id, quantity, quantity_received, serials, product_variants(title, products(name)))')
      .eq('id', id).single()),
  });
  const act = useMutation({
    mutationFn: async (a: 'approve' | 'dispatch' | 'cancel' | 'receive') => {
      if (a === 'approve') return unwrap(await supabase.rpc('approve_transfer', { p_transfer_id: id }));
      if (a === 'dispatch') return unwrap(await supabase.rpc('dispatch_transfer', { p_transfer_id: id }));
      if (a === 'cancel') return unwrap(await supabase.rpc('cancel_transfer', { p_transfer_id: id, p_reason: 'cancelled in admin' }));
      return unwrap(await supabase.rpc('receive_transfer', {
        p_transfer_id: id, p_note: note || null,
        p_lines: t!.stock_transfer_lines.map((l) => ({ line_id: l.id, quantity_received: counts[l.id] === undefined ? l.quantity : Number(counts[l.id]) })) as unknown as Json,
      }));
    },
    onSuccess: (_d, a) => {
      qc.invalidateQueries({ queryKey: ['transfer', id] }); qc.invalidateQueries({ queryKey: ['transfers'] }); qc.invalidateQueries({ queryKey: ['stock'] });
      toast({ approve: 'Approved - stock is held for it', dispatch: 'Dispatched - now in transit', cancel: 'Transfer cancelled', receive: 'Received into stock' }[a]);
      if (a === 'receive') setReceiving(false);
    },
  });
  if (!t) return <Dialog open onClose={onClose} title="Transfer"><ErrorNote error={error} /><Spinner /></Dialog>;
  const short = t.stock_transfer_lines.some((l) => counts[l.id] !== undefined && Number(counts[l.id]) < l.quantity);
  const steps: [string, string | null][] = [['Requested', t.requested_at], ['Approved', t.approved_at], ['Dispatched', t.dispatched_at], ['Received', t.received_at]];
  return (
    <Dialog open onClose={onClose} wide title={`${t.number} · ${t.from?.name} → ${t.to?.name}`} description={<Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>}
      footer={<>
        {['requested', 'approved'].includes(t.status) && org.can('transfers.approve') && <Button variant="danger" onClick={() => act.mutate('cancel')}>Cancel</Button>}
        {t.status === 'requested' && org.can('transfers.approve') && <Button variant="primary" busy={act.isPending} onClick={() => act.mutate('approve')}>Approve</Button>}
        {t.status === 'approved' && org.can('inventory.adjust') && <Button variant="primary" busy={act.isPending} onClick={() => act.mutate('dispatch')}>Mark dispatched</Button>}
        {t.status === 'dispatched' && org.can('inventory.receive') && !receiving && <Button variant="primary" onClick={() => setReceiving(true)}>Check in</Button>}
        {receiving && <Button variant="primary" busy={act.isPending} disabled={short && note.trim().length < 3} onClick={() => act.mutate('receive')}>Receive into stock</Button>}
      </>}>
      <ErrorNote error={act.error} />
      <ol className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">{steps.map(([l, at]) => <li key={l} className={at ? 'text-text' : ''}>{l}{at ? ` · ${dateTime(at)}` : ''}</li>)}</ol>
      <Table>
        <thead><tr><Th>Item</Th><Th align="right">Sent</Th><Th align="right">{receiving ? 'Arrived' : 'Received'}</Th></tr></thead>
        <tbody>
          {t.stock_transfer_lines.map((l) => (
            <tr key={l.id}>
              <Td>{l.product_variants?.products?.name}{l.product_variants?.title !== 'Default' && <span className="text-muted"> · {l.product_variants?.title}</span>}
                {l.serials && <div className="font-mono text-xs text-muted">{l.serials.join(', ')}</div>}</Td>
              <Td align="right">{qty(l.quantity)}</Td>
              <Td align="right">{receiving
                ? <Input className="ml-auto h-8 w-24 text-right" type="number" min="0" max={l.quantity} step="any" value={counts[l.id] ?? String(l.quantity)} onChange={(e) => setCounts((c) => ({ ...c, [l.id]: e.target.value }))} />
                : l.quantity_received === null ? '-' : <span className={l.quantity_received < l.quantity ? 'text-danger' : 'text-ok'}>{qty(l.quantity_received)}</span>}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {receiving && short && <Field label="Less arrived than was sent - what happened?" className="mt-4"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>}
      {t.note && <p className="mt-3 text-sm text-muted">Note: {t.note}</p>}
      {t.receive_note && <p className="mt-1 text-sm text-danger">On arrival: {t.receive_note}</p>}
    </Dialog>
  );
}
