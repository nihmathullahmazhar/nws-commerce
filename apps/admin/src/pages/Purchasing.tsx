import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, PackagePlus, Plus, Trash2, Truck } from 'lucide-react';
import type { Enums, Json, Tables } from '@nws-commerce/db';
import {
  Badge, Button, Card, Checkbox, Dialog, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, Table, Tabs, Td, Textarea, Th, useToast,
} from '@nws-commerce/ui';
import { supabase } from '../lib/supabase';
import { unwrap } from '../lib/api';
import { useOrg } from '../lib/workspace';
import { date, money, qty } from '../lib/format';
import { VariantPicker, type VariantHit } from '../components/VariantPicker';

type Tab = 'orders' | 'reorder' | 'suppliers';
type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info';
const PO_STATUS: Record<Enums['po_status'], { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' }, ordered: { label: 'Ordered', tone: 'info' },
  partially_received: { label: 'Part received', tone: 'warn' }, received: { label: 'Received', tone: 'ok' },
  closed: { label: 'Closed short', tone: 'neutral' }, cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export function Purchasing() {
  const org = useOrg();
  const [tab, setTab] = useState<Tab>('orders');
  const canBuy = org.can('purchasing.manage');
  return (
    <>
      <PageHeader title="Purchasing" description="What you've ordered from suppliers, and receiving it into stock." />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'orders', label: 'Purchase orders' },
        ...(canBuy ? [{ value: 'reorder' as const, label: 'Running low' }, { value: 'suppliers' as const, label: 'Suppliers' }] : []),
      ]} />
      {tab === 'orders' && <Orders />}
      {tab === 'reorder' && canBuy && <Reorder onCreated={() => setTab('orders')} />}
      {tab === 'suppliers' && canBuy && <Suppliers />}
    </>
  );
}

// ---------------------------------------------------------------------------
function Orders() {
  const org = useOrg();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['pos-purchase', org.id],
    queryFn: async () => unwrap(await supabase.from('purchase_orders')
      .select('id, number, status, total, expected_on, created_at, suppliers(name), locations(name)')
      .eq('organization_id', org.id).order('created_at', { ascending: false }).limit(200)),
  });
  return (
    <Card padded={false} title="Purchase orders"
      actions={org.can('purchasing.manage') && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing('new')}>New purchase order</Button>}>
      <ErrorNote error={error} />
      {isLoading ? <Spinner /> : !data?.length ? (
        <EmptyState icon={<ClipboardList className="size-5" />} title="No purchase orders yet">
          Raise a purchase order when you buy from a supplier. Stock is received against it - in one delivery or several - at the agreed cost.
        </EmptyState>
      ) : (
        <Table>
          <thead><tr><Th>Order</Th><Th>Supplier</Th><Th>Deliver to</Th><Th>Expected</Th><Th>Status</Th><Th align="right">Value</Th></tr></thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.id} className="hover:bg-surface-2/60">
                <Td><button className="font-medium hover:text-accent" onClick={() => setOpen(p.id)}>{p.number}</button><div className="text-xs text-muted">{date(p.created_at)}</div></Td>
                <Td>{p.suppliers?.name}</Td>
                <Td className="text-muted">{p.locations?.name}</Td>
                <Td className="text-muted">{p.expected_on ? date(p.expected_on) : '-'}</Td>
                <Td><Badge tone={PO_STATUS[p.status].tone}>{PO_STATUS[p.status].label}</Badge></Td>
                <Td align="right">{money(p.total, org.currency)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && <PoEditor id={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(id) => { setEditing(null); setOpen(id); }} />}
      {open && <PoDetail id={open} onClose={() => setOpen(null)} onEdit={() => { setEditing(open); setOpen(null); }} />}
    </Card>
  );
}

interface DraftLine { variant_id: string; name: string; quantity: string; unit_cost: string }

export function PoEditor({ id, initial, onClose, onSaved }: {
  id: string | null; initial?: { supplier_id?: string; location_id?: string; lines: DraftLine[] }; onClose: () => void; onSaved: (id: string) => void;
}) {
  const org = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ supplier_id: initial?.supplier_id ?? '', location_id: initial?.location_id ?? org.locations.find((l) => l.is_active)?.id ?? '', expected_on: '', supplier_reference: '', note: '' });
  const [lines, setLines] = useState<DraftLine[]>(initial?.lines ?? []);
  const [loaded, setLoaded] = useState(!id);

  const suppliers = useQuery({
    queryKey: ['suppliers', org.id],
    queryFn: async () => unwrap(await supabase.from('suppliers').select('id, name').eq('organization_id', org.id).eq('is_active', true).order('name')),
  });
  useQuery({
    queryKey: ['po-edit', id],
    enabled: !!id && !loaded,
    queryFn: async () => {
      const po = unwrap(await supabase.from('purchase_orders').select('*, purchase_order_lines(variant_id, quantity_ordered, unit_cost, position, product_variants(title, products(name)))').eq('id', id!).single());
      setForm({ supplier_id: po.supplier_id, location_id: po.location_id, expected_on: po.expected_on ?? '', supplier_reference: po.supplier_reference ?? '', note: po.note ?? '' });
      setLines([...po.purchase_order_lines].sort((a, b) => a.position - b.position).map((l) => ({
        variant_id: l.variant_id, name: `${l.product_variants?.products?.name}${l.product_variants?.title !== 'Default' ? ` · ${l.product_variants?.title}` : ''}`,
        quantity: String(l.quantity_ordered), unit_cost: String(l.unit_cost),
      })));
      setLoaded(true);
      return po;
    },
  });

  const save = useMutation({
    mutationFn: async (place: boolean) => {
      const poId = unwrap(await supabase.rpc('save_purchase_order', {
        p_organization_id: org.id,
        p_po: { ...(id ? { id } : {}), ...form, lines: lines.map((l) => ({ variant_id: l.variant_id, quantity: Number(l.quantity), unit_cost: Number(l.unit_cost) })) } as unknown as Json,
      }));
      if (place) unwrap(await supabase.rpc('place_purchase_order', { p_po_id: poId }));
      return { poId, place };
    },
    onSuccess: ({ poId, place }) => { qc.invalidateQueries({ queryKey: ['pos-purchase'] }); qc.invalidateQueries({ queryKey: ['po', poId] }); toast(place ? 'Purchase order placed' : 'Draft saved'); onSaved(poId); },
  });

  const add = (v: VariantHit) => setLines((ls) => ls.some((l) => l.variant_id === v.variant_id) ? ls
    : [...ls, { variant_id: v.variant_id!, name: `${v.product_name}${v.variant_title !== 'Default' ? ` · ${v.variant_title}` : ''}`, quantity: '1', unit_cost: '' }]);
  const total = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_cost || 0), 0);
  const ready = form.supplier_id && form.location_id && lines.length > 0 && lines.every((l) => Number(l.quantity) > 0 && l.unit_cost !== '');

  return (
    <Dialog open onClose={onClose} wide title={id ? 'Edit purchase order' : 'New purchase order'}
      footer={<><Button onClick={onClose}>Cancel</Button>
        <Button busy={save.isPending && !save.variables} disabled={!ready} onClick={() => save.mutate(false)}>Save draft</Button>
        <Button variant="primary" busy={save.isPending && save.variables} disabled={!ready} onClick={() => save.mutate(true)}>Place order</Button></>}>
      {!loaded ? <Spinner /> : (
        <div className="space-y-4">
          <ErrorNote error={save.error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Supplier" hint={suppliers.data?.length === 0 ? 'Add a supplier under the Suppliers tab first.' : undefined}>
              <Select value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
                <option value="">Choose</option>{suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Deliver to">
              <Select value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })}>
                {org.locations.filter((l) => l.is_active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
            <Field label="Expected"><Input type="date" value={form.expected_on} onChange={(e) => setForm({ ...form, expected_on: e.target.value })} /></Field>
            <Field label="Supplier's quote / reference"><Input value={form.supplier_reference} onChange={(e) => setForm({ ...form, supplier_reference: e.target.value })} /></Field>
          </div>
          <VariantPicker onPick={add} placeholder="Add an item to the order" />
          {lines.length > 0 && (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted"><th className="pb-2">Item</th><th className="pb-2 text-right">Quantity</th><th className="pb-2 text-right">Cost each</th><th className="pb-2 text-right">Line</th><th /></tr></thead>
              <tbody className="divide-y divide-border">
                {lines.map((l, i) => (
                  <tr key={l.variant_id}>
                    <td className="py-2">{l.name}</td>
                    <td className="py-2 text-right"><Input className="ml-auto h-8 w-24 text-right" type="number" min="0" step="any" value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} /></td>
                    <td className="py-2 text-right"><Input className="ml-auto h-8 w-28 text-right" type="number" min="0" step="0.01" value={l.unit_cost} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unit_cost: e.target.value } : x)))} /></td>
                    <td className="num py-2 text-right">{money(Number(l.quantity || 0) * Number(l.unit_cost || 0), org.currency)}</td>
                    <td className="py-2 text-right"><Button size="sm" variant="ghost" aria-label="Remove" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={3} className="pt-2 text-right font-medium">Total</td><td className="num pt-2 text-right font-semibold">{money(total, org.currency)}</td><td /></tr></tfoot>
            </table>
          )}
          <Field label="Note"><Textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
        </div>
      )}
    </Dialog>
  );
}

function PoDetail({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: () => void }) {
  const org = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [receiving, setReceiving] = useState(false);
  const { data: po, error } = useQuery({
    queryKey: ['po', id],
    queryFn: async () => unwrap(await supabase.from('purchase_orders')
      .select('*, suppliers(name, phone), locations(name), purchase_order_lines(id, variant_id, quantity_ordered, quantity_received, unit_cost, position, product_variants(title, sku, products(name, tracking_mode, unit_of_measure))), stock_receipts(number, created_at, reference)')
      .eq('id', id).single()),
  });
  const act = useMutation({
    mutationFn: async (a: 'place' | 'close') => a === 'place'
      ? unwrap(await supabase.rpc('place_purchase_order', { p_po_id: id }))
      : unwrap(await supabase.rpc('close_purchase_order', { p_po_id: id, p_reason: po?.status === 'partially_received' ? 'no more coming' : 'not needed' })),
    onSuccess: (_d, a) => { qc.invalidateQueries({ queryKey: ['po', id] }); qc.invalidateQueries({ queryKey: ['pos-purchase'] }); toast(a === 'place' ? 'Order placed' : 'Order closed'); },
  });
  if (!po) return <Dialog open onClose={onClose} title="Purchase order"><ErrorNote error={error} /><Spinner /></Dialog>;
  const lines = [...po.purchase_order_lines].sort((a, b) => a.position - b.position);
  const open = ['ordered', 'partially_received'].includes(po.status);
  return (
    <Dialog open onClose={onClose} wide title={`${po.number} · ${po.suppliers?.name}`} description={<><Badge tone={PO_STATUS[po.status].tone}>{PO_STATUS[po.status].label}</Badge> Deliver to {po.locations?.name}{po.expected_on ? ` · expected ${date(po.expected_on)}` : ''}</>}
      footer={<>
        {po.status === 'draft' && org.can('purchasing.manage') && <><Button onClick={onEdit}>Edit</Button><Button variant="primary" busy={act.isPending} onClick={() => act.mutate('place')}>Place order</Button></>}
        {(po.status === 'draft' || open) && org.can('purchasing.manage') && <Button variant="danger" onClick={() => act.mutate('close')}>{po.status === 'partially_received' ? 'Close short' : 'Cancel order'}</Button>}
        {open && org.can('inventory.receive') && <Button variant="primary" icon={<PackagePlus className="size-4" />} onClick={() => setReceiving(true)}>Receive delivery</Button>}
      </>}>
      <ErrorNote error={act.error} />
      <Table>
        <thead><tr><Th>Item</Th><Th align="right">Ordered</Th><Th align="right">Received</Th><Th align="right">Cost each</Th></tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <Td>{l.product_variants?.products?.name}{l.product_variants?.title !== 'Default' && <span className="text-muted"> · {l.product_variants?.title}</span>}<div className="text-xs text-muted">{l.product_variants?.sku}</div></Td>
              <Td align="right">{qty(l.quantity_ordered)}</Td>
              <Td align="right" className={l.quantity_received >= l.quantity_ordered ? 'text-ok' : ''}>{qty(l.quantity_received)}</Td>
              <Td align="right">{money(l.unit_cost, org.currency)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="mt-3 flex justify-between text-sm"><span className="text-muted">{po.stock_receipts.length ? `Deliveries: ${po.stock_receipts.map((r) => r.number).join(', ')}` : 'Nothing received yet'}</span><span className="font-semibold">{money(po.total, org.currency)}</span></div>
      {receiving && <ReceivePo po={po} lines={lines} onClose={() => setReceiving(false)} />}
    </Dialog>
  );
}

type PoLine = { id: string; quantity_ordered: number; quantity_received: number; unit_cost: number; product_variants: { title: string; products: { name: string; tracking_mode: Enums['tracking_mode']; unit_of_measure: string } | null } | null };

function ReceivePo({ po, lines, onClose }: { po: Tables<'purchase_orders'>; lines: PoLine[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const outstanding = lines.filter((l) => l.quantity_received < l.quantity_ordered);
  const [rows, setRows] = useState(() => Object.fromEntries(outstanding.map((l) => [l.id, {
    quantity: l.product_variants?.products?.tracking_mode === 'serial' ? '' : String(l.quantity_ordered - l.quantity_received),
    unit_cost: String(l.unit_cost), serials: '', lot_code: '', expires_on: '',
  }])));
  const [reference, setReference] = useState('');
  const serialsOf = (t: string) => t.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

  const receive = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('receive_purchase_order', {
      p_po_id: po.id, p_reference: reference || null,
      p_lines: outstanding.map((l) => {
        const r = rows[l.id];
        const mode = l.product_variants?.products?.tracking_mode;
        const serials = serialsOf(r.serials);
        return {
          po_line_id: l.id, quantity: mode === 'serial' ? serials.length : Number(r.quantity || 0), unit_cost: Number(r.unit_cost),
          ...(mode === 'serial' ? { serials } : {}), ...(mode === 'batch' ? { lot_code: r.lot_code, ...(r.expires_on ? { expires_on: r.expires_on } : {}) } : {}),
        };
      }).filter((x) => x.quantity > 0) as unknown as Json,
    })) as unknown as { number: string },
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['po', po.id] }); qc.invalidateQueries({ queryKey: ['pos-purchase'] }); qc.invalidateQueries({ queryKey: ['stock'] }); toast(`Received as ${r.number}`); onClose(); },
  });

  return (
    <Dialog open onClose={onClose} wide title={`Receive against ${po.number}`} description="Enter what actually arrived. Anything not delivered stays outstanding."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={receive.isPending} onClick={() => receive.mutate()}>Receive into stock</Button></>}>
      <div className="space-y-4">
        <ErrorNote error={receive.error} />
        <Field label="Delivery note / invoice"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        {outstanding.map((l) => {
          const r = rows[l.id];
          const mode = l.product_variants?.products?.tracking_mode;
          const set = (patch: Partial<typeof r>) => setRows((x) => ({ ...x, [l.id]: { ...x[l.id], ...patch } }));
          return (
            <div key={l.id} className="rounded-md border border-border p-3">
              <div className="mb-2 flex justify-between text-sm"><span className="font-medium">{l.product_variants?.products?.name}{l.product_variants?.title !== 'Default' && <span className="text-muted"> · {l.product_variants?.title}</span>}</span>
                <span className="text-muted">{qty(l.quantity_ordered - l.quantity_received)} outstanding</span></div>
              <div className="grid gap-3 sm:grid-cols-3">
                {mode === 'serial' ? (
                  <Field label={`Serial numbers (${serialsOf(r.serials).length})`} className="sm:col-span-2"><Textarea rows={2} className="font-mono text-xs" value={r.serials} onChange={(e) => set({ serials: e.target.value })} placeholder="One per line" /></Field>
                ) : (
                  <Field label="Arrived"><Input type="number" min="0" step="any" value={r.quantity} onChange={(e) => set({ quantity: e.target.value })} /></Field>
                )}
                <Field label="Cost each"><Input type="number" min="0" step="0.01" value={r.unit_cost} onChange={(e) => set({ unit_cost: e.target.value })} /></Field>
                {mode === 'batch' && <>
                  <Field label="Lot"><Input value={r.lot_code} onChange={(e) => set({ lot_code: e.target.value })} /></Field>
                  <Field label="Expires"><Input type="date" value={r.expires_on} onChange={(e) => set({ expires_on: e.target.value })} /></Field>
                </>}
              </div>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
function Reorder({ onCreated }: { onCreated: () => void }) {
  const org = useOrg();
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<{ supplier_id?: string; location_id?: string; lines: DraftLine[] } | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['reorder', org.id],
    queryFn: async () => unwrap(await supabase.rpc('reorder_suggestions', { p_organization_id: org.id })),
  });
  const rows = useMemo(() => data ?? [], [data]);
  const key = (r: (typeof rows)[number]) => `${r.variant_id}-${r.location_id}`;
  const chosen = rows.filter((r) => picked[key(r)]);

  function makePo() {
    const locations = new Set(chosen.map((r) => r.location_id));
    const suppliers = new Set(chosen.map((r) => r.last_supplier_id).filter(Boolean));
    setDraft({
      supplier_id: suppliers.size === 1 ? [...suppliers][0]! : undefined,
      location_id: locations.size === 1 ? [...locations][0]! : undefined,
      lines: chosen.map((r) => ({ variant_id: r.variant_id!, name: `${r.product_name}${r.variant_title !== 'Default' ? ` · ${r.variant_title}` : ''}`,
        quantity: String(Math.max(r.suggested ?? 1, 1)), unit_cost: r.last_cost === null ? '' : String(r.last_cost) })),
    });
  }

  return (
    <Card padded={false} title="Running low" description="Items at or under their low-stock level, allowing for what's already on order."
      actions={chosen.length > 0 && <Button size="sm" variant="primary" onClick={makePo}>Order {chosen.length} item{chosen.length === 1 ? '' : 's'}</Button>}>
      <ErrorNote error={error} />
      {isLoading ? <Spinner /> : !rows.length ? <p className="px-4 py-8 text-center text-sm text-muted">Nothing is running low.</p> : (
        <Table>
          <thead><tr><Th /><Th>Item</Th><Th>Location</Th><Th align="right">Available</Th><Th align="right">Low at</Th><Th align="right">On order</Th><Th align="right">Suggested</Th><Th>Last bought from</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={key(r)}>
                <Td><Checkbox label="" checked={!!picked[key(r)]} onChange={(v) => setPicked((p) => ({ ...p, [key(r)]: v }))} /></Td>
                <Td>{r.product_name}{r.variant_title !== 'Default' && <span className="text-muted"> · {r.variant_title}</span>}</Td>
                <Td className="text-muted">{r.location_name}</Td>
                <Td align="right">{qty(r.available)}</Td><Td align="right" className="text-muted">{qty(r.low_stock_level)}</Td>
                <Td align="right" className="text-muted">{qty(r.on_order)}</Td><Td align="right" className="font-medium">{qty(r.suggested)}</Td>
                <Td className="text-muted">{r.last_supplier ? `${r.last_supplier} · ${money(r.last_cost, org.currency)}` : '-'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {draft && <PoEditor id={null} initial={draft} onClose={() => setDraft(null)} onSaved={() => { setDraft(null); setPicked({}); onCreated(); }} />}
    </Card>
  );
}

// ---------------------------------------------------------------------------
function Suppliers() {
  const org = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Partial<Tables<'suppliers'>> | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['suppliers-admin', org.id],
    queryFn: async () => unwrap(await supabase.from('suppliers').select('*').eq('organization_id', org.id).order('name')),
  });
  const save = useMutation({
    mutationFn: async (s: Partial<Tables<'suppliers'>>) => {
      const row = { name: s.name!.trim(), contact_name: s.contact_name || null, phone: s.phone || null, email: s.email || null,
        payment_terms_days: s.payment_terms_days ?? null, notes: s.notes || null, is_active: s.is_active ?? true };
      return s.id ? unwrap(await supabase.from('suppliers').update(row).eq('id', s.id))
        : unwrap(await supabase.from('suppliers').insert({ ...row, organization_id: org.id }));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers-admin'] }); qc.invalidateQueries({ queryKey: ['suppliers'] }); setEditing(null); toast('Supplier saved'); },
  });
  return (
    <Card padded={false} title="Suppliers" actions={<Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEditing({ is_active: true })}>Add supplier</Button>}>
      <ErrorNote error={error} />
      {isLoading ? <Spinner /> : !data?.length ? <EmptyState icon={<Truck className="size-5" />} title="No suppliers yet">Add the distributors and wholesalers you buy from.</EmptyState> : (
        <Table>
          <thead><tr><Th>Supplier</Th><Th>Contact</Th><Th>Terms</Th><Th /></tr></thead>
          <tbody>
            {data.map((s) => (
              <tr key={s.id} className={s.is_active ? '' : 'opacity-60'}>
                <Td className="font-medium">{s.name}</Td>
                <Td className="text-muted">{[s.contact_name, s.phone, s.email].filter(Boolean).join(' · ') || '-'}</Td>
                <Td className="text-muted">{s.payment_terms_days !== null ? `${s.payment_terms_days} days` : '-'}</Td>
                <Td align="right"><Button size="sm" variant="ghost" onClick={() => setEditing(s)}>Edit</Button></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit supplier' : 'New supplier'}
        footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" busy={save.isPending} disabled={!editing?.name?.trim()} onClick={() => save.mutate(editing!)}>Save</Button></>}>
        {editing && (
          <div className="space-y-4">
            <ErrorNote error={save.error} />
            <Field label="Name"><Input value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Contact person"><Input value={editing.contact_name ?? ''} onChange={(e) => setEditing({ ...editing, contact_name: e.target.value })} /></Field>
              <Field label="Phone"><Input value={editing.phone ?? ''} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></Field>
              <Field label="Email"><Input type="email" value={editing.email ?? ''} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></Field>
              <Field label="Payment terms (days)"><Input type="number" min="0" value={editing.payment_terms_days ?? ''} onChange={(e) => setEditing({ ...editing, payment_terms_days: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
            </div>
            <Field label="Notes"><Textarea rows={2} value={editing.notes ?? ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
            {editing.id && <Checkbox label="Active" checked={editing.is_active ?? true} onChange={(v) => setEditing({ ...editing, is_active: v })} />}
          </div>
        )}
      </Dialog>
    </Card>
  );
}
