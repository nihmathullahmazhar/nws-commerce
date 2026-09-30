import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PackageCheck, Undo2 } from 'lucide-react';
import type { Enums, Json, ReturnSummary } from '@nws-commerce/db';
import { Badge, Button, Card, Dialog, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, Table, Td, Th, useToast } from '@nws-commerce/ui';
import { supabase } from '../lib/supabase';
import { unwrap } from '../lib/api';
import { useOrg } from '../lib/workspace';
import { CHANNEL, DISPOSITION, METHOD, RETURN_STATUS } from '../lib/labels';
import { dateTime, money, qty } from '../lib/format';

export function Returns() {
  const org = useOrg();
  const [open, setOpen] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['returns', org.id],
    queryFn: async () => unwrap(await supabase.from('returns')
      .select('id, number, status, channel, refund_total, requested_at, received_at, reason, orders!returns_organization_id_order_id_fkey(number), return_lines(disposition)')
      .eq('organization_id', org.id).order('requested_at', { ascending: false }).limit(200)),
  });

  const awaiting = (data ?? []).filter((r) => r.status === 'received' && r.return_lines.some((l) => l.disposition === 'pending_inspection' || l.disposition === 'service'));
  const requested = (data ?? []).filter((r) => r.status === 'requested');

  return (
    <>
      <PageHeader title="Returns" description="Returns from the counter, the online store and the admin. Returned goods wait here for inspection before they're sold again." />
      <ErrorNote error={error} />
      {isLoading ? <Spinner /> : !data?.length ? (
        <Card><EmptyState icon={<Undo2 className="size-5" />} title="No returns yet">
          Take a return from an order's page, or at the till. Customers can also ask to return online orders from their order page.
        </EmptyState></Card>
      ) : (
        <div className="space-y-5">
          {(requested.length > 0 || awaiting.length > 0) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {requested.length > 0 && <div className="rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">{requested.length} online return{requested.length === 1 ? '' : 's'} waiting for the parcel to arrive</div>}
              {awaiting.length > 0 && <div className="rounded-lg border border-info/30 bg-info-soft px-4 py-3 text-sm text-info">{awaiting.length} return{awaiting.length === 1 ? '' : 's'} with goods to inspect</div>}
            </div>
          )}
          <Card padded={false}>
            <Table>
              <thead><tr><Th>Return</Th><Th>Order</Th><Th>Channel</Th><Th>Status</Th><Th>Goods</Th><Th align="right">Refund</Th></tr></thead>
              <tbody>
                {data.map((r) => {
                  const pending = r.return_lines.filter((l) => l.disposition === 'pending_inspection' || l.disposition === 'service').length;
                  return (
                    <tr key={r.id} className="hover:bg-surface-2/60">
                      <Td><button onClick={() => setOpen(r.id)} className="font-medium hover:text-accent">{r.number}</button><div className="text-xs text-muted">{dateTime(r.requested_at)}</div></Td>
                      <Td className="text-muted">{r.orders?.number}</Td>
                      <Td>{CHANNEL[r.channel]}</Td>
                      <Td><Badge tone={RETURN_STATUS[r.status].tone}>{RETURN_STATUS[r.status].label}</Badge></Td>
                      <Td>{r.status !== 'received' ? '-' : pending ? <Badge tone="warn">{pending} to inspect</Badge> : <Badge tone="ok">Done</Badge>}</Td>
                      <Td align="right">{money(r.refund_total, org.currency)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
        </div>
      )}
      {open && <ReturnDetail id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function ReturnDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const org = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [inspecting, setInspecting] = useState<ReturnSummary['lines'][number] | null>(null);
  const [disposition, setDisposition] = useState<Enums['return_disposition']>('restock');
  const [note, setNote] = useState('');
  const [locationId, setLocationId] = useState(org.locations.find((l) => l.is_active)?.id ?? '');
  const [method, setMethod] = useState<Enums['payment_method']>('bank_transfer');

  const { data: r, error } = useQuery({
    queryKey: ['return', id],
    queryFn: async () => {
      const ret = unwrap(await supabase.from('returns').select('*, orders!returns_organization_id_order_id_fkey(number, customer_id), return_lines(*, order_lines(product_name, variant_title), serial_units(serial))').eq('id', id).single());
      return ret;
    },
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['return', id] }); qc.invalidateQueries({ queryKey: ['returns'] }); qc.invalidateQueries({ queryKey: ['stock'] }); };

  const inspect = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('inspect_return_line', { p_return_line_id: inspecting!.return_line_id, p_disposition: disposition, p_note: note || null })),
    onSuccess: () => { toast('Inspection recorded'); setInspecting(null); setNote(''); refresh(); },
  });
  const receive = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('receive_return', { p_return_id: id, p_location_id: locationId, p_refunds: [{ method }] as unknown as Json })),
    onSuccess: () => { toast('Return received and refunded'); refresh(); },
  });
  const cancel = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('cancel_return', { p_return_id: id, p_reason: 'not sent back' })),
    onSuccess: () => { toast('Return cancelled'); refresh(); },
  });

  return (
    <Dialog open onClose={onClose} wide title={r ? `${r.number} · ${RETURN_STATUS[r.status].label}` : 'Return'}
      description={r ? <>From <Link className="text-accent hover:underline" to={`/orders/${r.order_id}`}>{r.orders?.number}</Link>{r.reason ? ` · ${r.reason}` : ''}</> : undefined}>
      <ErrorNote error={error ?? inspect.error ?? receive.error ?? cancel.error} />
      {!r ? <Spinner /> : (
        <div className="space-y-5">
          <Table>
            <thead><tr><Th>Item</Th><Th align="right">Qty</Th><Th align="right">Refund</Th><Th>What happens to it</Th><Th /></tr></thead>
            <tbody>
              {r.return_lines.map((l) => (
                <tr key={l.id}>
                  <Td>{l.order_lines?.product_name}{l.serial_units && <div className="font-mono text-xs text-muted">{l.serial_units.serial}</div>}{l.reason && <div className="text-xs text-muted">{l.reason}</div>}</Td>
                  <Td align="right">{qty(l.quantity)}</Td>
                  <Td align="right">{money(l.line_refund, org.currency)}</Td>
                  <Td><Badge tone={DISPOSITION[l.disposition].tone}>{DISPOSITION[l.disposition].label}</Badge>{l.inspection_note && <div className="text-xs text-muted">{l.inspection_note}</div>}</Td>
                  <Td align="right">{r.status === 'received' && (l.disposition === 'pending_inspection' || l.disposition === 'service') && org.can('inventory.adjust') &&
                    <Button size="sm" onClick={() => { setInspecting({ return_line_id: l.id } as ReturnSummary['lines'][number]); setDisposition('restock'); }}>Inspect</Button>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {r.status === 'requested' && org.can('orders.manage') && (
            <div className="rounded-lg border border-border p-4">
              <h3 className="mb-3 text-sm font-semibold">The parcel has arrived</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Received at"><Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>{org.locations.filter((l) => l.is_active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
                <Field label="Refund to"><Select value={method} onChange={(e) => setMethod(e.target.value as Enums['payment_method'])}>
                  {r.orders?.customer_id && <option value="store_credit">{METHOD.store_credit}</option>}
                  {(['bank_transfer', 'online_gateway', 'cash', 'card'] as const).map((m) => <option key={m} value={m}>{METHOD[m]}</option>)}</Select></Field>
                <div className="flex items-end gap-2"><Button variant="primary" busy={receive.isPending} icon={<PackageCheck className="size-4" />} onClick={() => receive.mutate()}>Receive &amp; refund</Button>
                  <Button variant="ghost" onClick={() => cancel.mutate()}>Cancel</Button></div>
              </div>
            </div>
          )}
        </div>
      )}
      <Dialog open={!!inspecting} onClose={() => setInspecting(null)} title="Inspect returned item"
        footer={<><Button onClick={() => setInspecting(null)}>Cancel</Button><Button variant="primary" busy={inspect.isPending} onClick={() => inspect.mutate()}>Record</Button></>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {(['restock', 'service', 'damaged', 'write_off'] as const).map((d) => (
              <button key={d} onClick={() => setDisposition(d)} className={`rounded-md border px-3 py-2.5 text-left text-sm ${disposition === d ? 'border-accent bg-accent-soft font-semibold text-accent' : 'border-border'}`}>
                {DISPOSITION[d].label}<div className="text-xs font-normal text-muted">{{ restock: 'Sellable - back in stock at cost', service: 'Sent for repair; decide again later', damaged: 'Not sellable; kept aside', write_off: 'Gone - no longer stock' }[d]}</div>
              </button>
            ))}
          </div>
          <Field label="Note" hint={disposition === 'damaged' || disposition === 'write_off' ? 'Required: say what is wrong.' : undefined}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </Dialog>
    </Dialog>
  );
}
