import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, PackagePlus, Trash2 } from 'lucide-react';
import type { Json, ReceiveResult } from '@nws-commerce/db';
import { supabase } from '../lib/supabase';
import { unwrap } from '../lib/api';
import { useOrg } from '../lib/workspace';
import { money } from '../lib/format';
import { VariantPicker, type VariantHit } from '../components/VariantPicker';
import { Button, Card, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Table, Td, Textarea, Th, useToast } from '@nws-commerce/ui';

interface Line { key: string; variant: VariantHit; quantity: string; unit_cost: string; serials: string; lot_code: string; expires_on: string }

const serialList = (text: string) => text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

export function ReceiveStock() {
  const org = useOrg();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const allowed = org.locations.filter((l) => l.is_active && (!org.locationIds || org.locationIds.includes(l.id)));
  const [locationId, setLocationId] = useState(allowed[0]?.id ?? '');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);

  function add(v: VariantHit) {
    setLines((ls) => [...ls, { key: crypto.randomUUID(), variant: v, quantity: v.tracking_mode === 'serial' ? '' : '1', unit_cost: '', serials: '', lot_code: '', expires_on: '' }]);
  }
  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const receive = useMutation({
    mutationFn: async () => {
      const payload = lines.map((l) => {
        const serials = serialList(l.serials);
        return {
          variant_id: l.variant.variant_id,
          quantity: l.variant.tracking_mode === 'serial' ? serials.length : Number(l.quantity),
          ...(l.unit_cost !== '' ? { unit_cost: Number(l.unit_cost) } : {}),
          ...(l.variant.tracking_mode === 'serial' ? { serials } : {}),
          ...(l.variant.tracking_mode === 'batch' ? { lot_code: l.lot_code, ...(l.expires_on ? { expires_on: l.expires_on } : {}) } : {}),
        };
      });
      return unwrap(await supabase.rpc('receive_stock', {
        p_location_id: locationId, p_lines: payload as unknown as Json, p_reference: reference || null, p_note: note || null,
      })) as unknown as ReceiveResult;
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast(`Received as ${r.number}`);
      navigate('/inventory');
    },
  });

  const total = lines.reduce((s, l) => {
    const q = l.variant.tracking_mode === 'serial' ? serialList(l.serials).length : Number(l.quantity || 0);
    return s + q * Number(l.unit_cost || 0);
  }, 0);

  return (
    <form onSubmit={(e) => { e.preventDefault(); receive.mutate(); }}>
      <PageHeader
        back={<Link to="/inventory" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text"><ArrowLeft className="size-4" />Inventory</Link>}
        title="Receive stock"
        description="Record a delivery. Costs update each item's average cost; nothing is sold until it's received."
        actions={<Button type="submit" variant="primary" busy={receive.isPending} disabled={!lines.length || !locationId}>Receive {lines.length ? `${lines.length} line${lines.length === 1 ? '' : 's'}` : ''}</Button>} />

      <div className="space-y-5">
        <Card>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Into location">
              <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} required>
                {allowed.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
            <Field label="Supplier reference" hint="Invoice or delivery note number."><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
            <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
        </Card>

        <Card padded={false} title="Items">
          <div className="border-b border-border p-3"><VariantPicker onPick={add} locationId={locationId} placeholder="Search or scan a product to add it" /></div>
          <ErrorNote error={receive.error} />
          {lines.length === 0 ? (
            <EmptyState icon={<PackagePlus className="size-5" />} title="Add the items in this delivery">
              Search by name or SKU, or scan a barcode. Serial-tracked items ask for each serial number; batch items ask for the lot and expiry.
            </EmptyState>
          ) : (
            <Table>
              <thead><tr><Th>Item</Th><Th>Quantity</Th><Th align="right">Unit cost</Th><Th /></tr></thead>
              <tbody>
                {lines.map((l) => {
                  const v = l.variant;
                  return (
                    <tr key={l.key} className="align-top">
                      <Td className="min-w-56">
                        <div className="font-medium">{v.product_name}{v.variant_title !== 'Default' && <span className="font-normal text-muted"> · {v.variant_title}</span>}</div>
                        <div className="text-xs text-muted">{v.sku ?? 'No SKU'}</div>
                        {v.tracking_mode === 'batch' && (
                          <div className="mt-2 grid max-w-sm grid-cols-2 gap-2">
                            <Input className="h-8" placeholder="Lot code" required value={l.lot_code} onChange={(e) => update(l.key, { lot_code: e.target.value })} />
                            <Input className="h-8" type="date" aria-label="Expiry date" value={l.expires_on} onChange={(e) => update(l.key, { expires_on: e.target.value })} />
                          </div>
                        )}
                      </Td>
                      <Td className="min-w-40">
                        {v.tracking_mode === 'serial' ? (
                          <>
                            <Textarea className="min-h-16 font-mono text-xs" placeholder="One serial / IMEI per line" required value={l.serials} onChange={(e) => update(l.key, { serials: e.target.value })} />
                            <div className="mt-1 text-xs text-muted">{serialList(l.serials).length} unit{serialList(l.serials).length === 1 ? '' : 's'}</div>
                          </>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Input className="h-8 w-28" type="number" min="0" step={v.allow_fractional ? 'any' : '1'} required value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} />
                            {v.unit_of_measure !== 'each' && <span className="text-xs text-muted">{v.unit_of_measure}</span>}
                          </div>
                        )}
                      </Td>
                      <Td align="right"><Input className="h-8 w-32 text-right" type="number" min="0" step="0.01" placeholder="Cost each" value={l.unit_cost} onChange={(e) => update(l.key, { unit_cost: e.target.value })} /></Td>
                      <Td align="right"><Button type="button" size="sm" variant="ghost" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Remove line"><Trash2 className="size-4" /></Button></Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
          {lines.length > 0 && total > 0 && (
            <div className="flex justify-end border-t border-border px-4 py-3 text-sm">Delivery value <span className="num ml-2 font-semibold">{money(total, org.currency)}</span></div>
          )}
        </Card>
      </div>
    </form>
  );
}
