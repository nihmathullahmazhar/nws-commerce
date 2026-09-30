import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, History, PackagePlus, Search, SlidersHorizontal } from 'lucide-react';
import type { Database, Enums } from '@nws-commerce/db';
import { supabase } from '../lib/supabase';
import { unwrap } from '../lib/api';
import { useOrg } from '../lib/workspace';
import { date, dateTime, money, qty, titleCase } from '../lib/format';
import {
  Badge, Button, Card, Checkbox, Dialog, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, Table, Td, Textarea, Th, useToast,
} from '@nws-commerce/ui';

type StockRow = Database['public']['Functions']['stock_overview']['Returns'][number];

export function Inventory() {
  const org = useOrg();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const locationId = params.get('location') ?? '';
  const lowOnly = params.get('low') === '1';
  const [adjusting, setAdjusting] = useState<StockRow | null>(null);
  const [history, setHistory] = useState<StockRow | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['stock', org.id, locationId, search, lowOnly],
    queryFn: async () => unwrap(await supabase.rpc('stock_overview', {
      p_organization_id: org.id, p_location_id: locationId || null, p_query: search || null, p_low_only: lowOnly,
    })),
  });

  const setParam = (k: string, v: string) => { const next = new URLSearchParams(params); if (v) next.set(k, v); else next.delete(k); setParams(next, { replace: true }); };
  const showCost = org.can('reports.view');
  const totalValue = showCost ? (data ?? []).reduce((s, r) => s + (r.stock_value ?? 0), 0) : null;

  return (
    <>
      <PageHeader title="Inventory"
        description="One stock count per item per location, shared by the store, the counter and every other channel."
        actions={org.can('inventory.receive') && (
          <Link to="/inventory/receive"><Button variant="primary" icon={<PackagePlus className="size-4" />}>Receive stock</Button></Link>
        )} />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-faint" />
            <Input className="pl-8" placeholder="Name, SKU or barcode" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {org.locations.length > 1 && (
            <Select className="w-48" value={locationId} onChange={(e) => setParam('location', e.target.value)}>
              <option value="">All locations</option>
              {org.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          )}
          <Checkbox label="Low stock only" checked={lowOnly} onChange={(v) => setParam('low', v ? '1' : '')} />
          {totalValue !== null && <span className="ml-auto text-sm text-muted">Stock value <span className="num font-medium text-text">{money(totalValue, org.currency)}</span></span>}
        </div>
        <ErrorNote error={error} />
        {isLoading ? <Spinner /> : !data?.length ? (
          lowOnly || search ? <EmptyState title="Nothing matches" icon={<Search className="size-5" />} /> :
          <EmptyState icon={<Boxes className="size-5" />} title="No stock recorded yet"
            action={org.can('inventory.receive') && <Link to="/inventory/receive"><Button variant="primary">Receive your first delivery</Button></Link>}>
            Stock appears here once you receive it. Every unit in and out, from any channel, is kept in the stock ledger.
          </EmptyState>
        ) : (
          <Table>
            <thead><tr>
              <Th>Item</Th>{org.locations.length > 1 && <Th>Location</Th>}
              <Th align="right">On hand</Th><Th align="right">Held</Th><Th align="right">Available</Th>
              {showCost && <Th align="right">Avg cost</Th>}<Th />
            </tr></thead>
            <tbody>
              {data.map((r) => (
                <tr key={`${r.variant_id}-${r.location_id}`}>
                  <Td>
                    <Link to={`/products/${r.product_id}`} className="font-medium hover:text-accent">{r.product_name}</Link>
                    <div className="text-xs text-muted">{[r.variant_title !== 'Default' && r.variant_title, r.sku, r.tracking_mode !== 'none' && `${r.tracking_mode}-tracked`].filter(Boolean).join(' · ')}</div>
                  </Td>
                  {org.locations.length > 1 && <Td className="text-muted">{r.location_name}</Td>}
                  <Td align="right">{qty(r.on_hand, r.unit_of_measure)}</Td>
                  <Td align="right" className="text-muted">{r.reserved ? qty(r.reserved) : '-'}</Td>
                  <Td align="right">
                    <span className="inline-flex items-center gap-2">
                      {r.is_low && <Badge tone="warn">Low</Badge>}{qty(r.available, r.unit_of_measure)}
                    </span>
                  </Td>
                  {showCost && <Td align="right" className="text-muted">{money(r.avg_unit_cost, org.currency)}</Td>}
                  <Td align="right" className="whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => setHistory(r)} aria-label="History" title="History"><History className="size-4" /></Button>
                    {org.can('inventory.adjust') && <Button size="sm" variant="ghost" onClick={() => setAdjusting(r)} aria-label="Adjust" title="Adjust"><SlidersHorizontal className="size-4" /></Button>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {adjusting && <AdjustDialog row={adjusting} onClose={() => setAdjusting(null)} />}
      {history && <HistoryDialog row={history} onClose={() => setHistory(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
function AdjustDialog({ row, onClose }: { row: StockRow; onClose: () => void }) {
  const org = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState<Enums['movement_type']>('adjustment_out');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [serials, setSerials] = useState<string[]>([]);
  const [newSerials, setNewSerials] = useState('');
  const [lot, setLot] = useState('');
  const [expiry, setExpiry] = useState('');
  const [threshold, setThreshold] = useState(row.low_stock_threshold === null ? '' : String(row.low_stock_threshold));
  const removing = reason !== 'adjustment_in';

  const units = useQuery({
    queryKey: ['serials-here', row.variant_id, row.location_id],
    enabled: row.tracking_mode === 'serial',
    queryFn: async () => unwrap(await supabase.from('serial_units').select('id, serial')
      .eq('variant_id', row.variant_id!).eq('location_id', row.location_id!).eq('status', 'available').order('received_at')),
  });
  const lots = useQuery({
    queryKey: ['lots-here', row.variant_id, row.location_id],
    enabled: row.tracking_mode === 'batch',
    queryFn: async () => unwrap(await supabase.from('batch_stock').select('on_hand, reserved, batches!inner(lot_code, expires_on, variant_id)')
      .eq('location_id', row.location_id!).eq('batches.variant_id', row.variant_id!).gt('on_hand', 0)),
  });

  const adjust = useMutation({
    mutationFn: async () => {
      const addSerials = newSerials.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
      const quantity = row.tracking_mode === 'serial' ? (removing ? serials.length : addSerials.length) : Number(amount);
      return unwrap(await supabase.rpc('adjust_stock', {
        p_location_id: row.location_id!, p_variant_id: row.variant_id!, p_quantity: quantity, p_reason: reason, p_note: note,
        p_serials: row.tracking_mode === 'serial' ? (removing ? serials : addSerials) : null,
        p_lot_code: row.tracking_mode === 'batch' ? lot || null : null,
        p_expires_on: row.tracking_mode === 'batch' && !removing && expiry ? expiry : null,
      }));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['stock'] }); toast('Stock adjusted'); onClose(); },
  });
  const saveThreshold = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('set_low_stock_threshold', {
      p_location_id: row.location_id!, p_variant_id: row.variant_id!, p_threshold: threshold === '' ? null : Number(threshold),
    })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['stock'] }); toast('Low-stock level saved'); },
  });

  return (
    <Dialog open onClose={onClose} title={`Adjust ${row.product_name}`}
      description={`${row.variant_title !== 'Default' ? `${row.variant_title} · ` : ''}${row.location_name} · ${qty(row.on_hand, row.unit_of_measure)} on hand, ${qty(row.available, row.unit_of_measure)} available`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={adjust.isPending} form="adjust-form" type="submit">Record adjustment</Button></>}>
      <form id="adjust-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); adjust.mutate(); }}>
        <ErrorNote error={adjust.error} />
        <Field label="What happened">
          <Select value={reason} onChange={(e) => { setReason(e.target.value as Enums['movement_type']); setSerials([]); }}>
            <option value="adjustment_out">Count found fewer / written off</option>
            <option value="damage">Damaged, expired or destroyed</option>
            <option value="adjustment_in">Count found more</option>
          </Select>
        </Field>

        {row.tracking_mode === 'serial' ? (removing ? (
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium">Which units</legend>
            {units.data?.length ? (
              <div className="grid max-h-48 gap-1.5 overflow-y-auto sm:grid-cols-2">
                {units.data.map((u) => (
                  <Checkbox key={u.id} label={u.serial} checked={serials.includes(u.serial)}
                    onChange={(on) => setSerials((s) => (on ? [...s, u.serial] : s.filter((x) => x !== u.serial)))} />
                ))}
              </div>
            ) : <p className="text-sm text-muted">No units available to remove here.</p>}
          </fieldset>
        ) : (
          <Field label="Serial numbers found" hint="One per line or comma-separated."><Textarea rows={3} value={newSerials} onChange={(e) => setNewSerials(e.target.value)} /></Field>
        )) : (
          <Field label={`Quantity (${row.unit_of_measure})`}><Input type="number" min="0" step="any" required value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        )}

        {row.tracking_mode === 'batch' && (removing ? (
          <Field label="Lot">
            <Select required value={lot} onChange={(e) => setLot(e.target.value)}>
              <option value="">Choose a lot</option>
              {lots.data?.map((b) => <option key={b.batches.lot_code} value={b.batches.lot_code}>{b.batches.lot_code} · {qty(b.on_hand)} · expires {date(b.batches.expires_on)}</option>)}
            </Select>
          </Field>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Lot"><Input required value={lot} onChange={(e) => setLot(e.target.value)} /></Field>
            <Field label="Expires"><Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></Field>
          </div>
        ))}

        <Field label="Reason" hint="Kept in the stock ledger with your name."><Input required minLength={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. monthly count, water damage" /></Field>
      </form>

      <div className="mt-6 border-t border-border pt-4">
        <div className="flex items-end gap-2">
          <Field label="Low-stock level" hint="Flag this item when available stock falls to this level." className="flex-1">
            <Input type="number" min="0" step="any" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder={String(org.settings.low_stock_default ?? 3)} />
          </Field>
          <Button type="button" busy={saveThreshold.isPending} onClick={() => saveThreshold.mutate()} className="mb-5">Save</Button>
        </div>
        <ErrorNote error={saveThreshold.error} />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
function HistoryDialog({ row, onClose }: { row: StockRow; onClose: () => void }) {
  const org = useOrg();
  const { data, isLoading, error } = useQuery({
    queryKey: ['movements', row.variant_id, row.location_id],
    queryFn: async () => unwrap(await supabase.rpc('stock_movements', {
      p_organization_id: org.id, p_variant_id: row.variant_id!, p_location_id: row.location_id, p_limit: 200,
    })),
  });
  const showCost = org.can('reports.view');
  return (
    <Dialog open onClose={onClose} wide title={`${row.product_name} · stock ledger`}
      description={`${row.location_name}. Every movement is permanent; corrections are new entries.`}>
      <ErrorNote error={error} />
      {isLoading ? <Spinner /> : !data?.length ? <p className="text-sm text-muted">No movements yet.</p> : (
        <div className="-mx-5">
          <Table>
            <thead><tr><Th>When</Th><Th>Movement</Th><Th align="right">Qty</Th>{showCost && <Th align="right">Unit cost</Th>}<Th>Reference</Th><Th>By</Th></tr></thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id}>
                  <Td className="whitespace-nowrap text-muted">{dateTime(m.created_at)}</Td>
                  <Td>
                    {titleCase(m.movement_type)}
                    {(m.serial || m.lot_code) && <div className="text-xs text-muted">{m.serial ?? `Lot ${m.lot_code}`}</div>}
                    {m.note && <div className="text-xs text-muted">{m.note}</div>}
                  </Td>
                  <Td align="right" className={(m.quantity ?? 0) < 0 ? 'text-danger' : 'text-ok'}>{(m.quantity ?? 0) > 0 ? '+' : ''}{qty(m.quantity)}</Td>
                  {showCost && <Td align="right" className="text-muted">{money(m.unit_cost, org.currency)}</Td>}
                  <Td>{m.source_type === 'order' && m.source_id ? <Link className="text-accent hover:underline" to={`/orders/${m.source_id}`}>{m.reference}</Link> : m.reference ?? '-'}</Td>
                  <Td className="text-muted">{m.actor_email ?? '-'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Dialog>
  );
}
