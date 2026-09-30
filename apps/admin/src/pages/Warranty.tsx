import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, ShieldCheck } from 'lucide-react';
import type { Enums, WarrantyClaim, WarrantyHit } from '@nws-commerce/db';
import { Badge, Button, Card, Dialog, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, Table, Td, Textarea, Th, useToast } from '@nws-commerce/ui';
import { supabase } from '../lib/supabase';
import { unwrap } from '../lib/api';
import { useOrg } from '../lib/workspace';
import { CHANNEL, CLAIM_STATUS } from '../lib/labels';
import { date, dateTime } from '../lib/format';

export function Warranty() {
  const org = useOrg();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [claimFor, setClaimFor] = useState<WarrantyHit | null>(null);
  const [claimId, setClaimId] = useState<string | null>(null);

  const hits = useQuery({
    queryKey: ['warranty', org.id, search],
    enabled: search.length >= 3,
    queryFn: async () => unwrap(await supabase.rpc('warranty_lookup', { p_organization_id: org.id, p_query: search })) as unknown as WarrantyHit[],
  });
  const claims = useQuery({
    queryKey: ['claims', org.id],
    queryFn: async () => unwrap(await supabase.from('warranty_claims').select('id, number, status, issue, within_warranty, created_at, order_lines(product_name)')
      .eq('organization_id', org.id).order('created_at', { ascending: false }).limit(100)),
  });

  return (
    <>
      <PageHeader title="Warranty" description="Find any purchase by serial / IMEI, receipt number or phone number - from the counter, the website or the app." />
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); setSearch(q.trim()); }} className="mb-5 flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-3 size-4 text-faint" />
          <Input autoFocus className="h-10 pl-9" placeholder="IMEI or serial, ORD- number, or 077 123 4567" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button type="submit" variant="primary" className="h-10">Find</Button>
      </form>

      {search && (
        <Card padded={false} className="mb-5" title={`Purchases matching "${search}"`}>
          <ErrorNote error={hits.error} />
          {hits.isLoading ? <Spinner /> : !hits.data?.length ? <p className="px-4 py-6 text-center text-sm text-muted">Nothing found. Try the full serial number or the receipt number.</p> : (
            <Table>
              <thead><tr><Th>Item</Th><Th>Bought</Th><Th>Customer</Th><Th>Warranty</Th><Th /></tr></thead>
              <tbody>
                {hits.data.map((h) => (
                  <tr key={h.order_line_id} className="align-top">
                    <Td><div className="font-medium">{h.product}{h.variant !== 'Default' && <span className="font-normal text-muted"> · {h.variant}</span>}</div>
                      {h.serials && <div className="font-mono text-xs text-muted">{h.serials.join(', ')}</div>}
                      {h.returned_quantity > 0 && <Badge tone="warn">{h.returned_quantity >= h.quantity ? 'Returned' : `${h.returned_quantity} returned`}</Badge>}
                      {h.claims.map((c) => <button key={c.id} onClick={() => setClaimId(c.id)} className="mr-2 text-xs text-accent hover:underline">{c.number} · {CLAIM_STATUS[c.status].label}</button>)}</Td>
                    <Td><Link className="hover:text-accent" to={`/orders/${h.order_id}`}>{h.order_number}</Link><div className="text-xs text-muted">{date(h.purchased_at)} · {CHANNEL[h.channel]} · {h.location}</div></Td>
                    <Td className="text-muted">{h.customer?.name ?? '-'}<div className="num text-xs">{h.customer?.phone}</div></Td>
                    <Td>{h.warranty_status === 'none' ? <Badge>No warranty</Badge> : h.warranty_status === 'active'
                      ? <><Badge tone="ok">Active</Badge><div className="text-xs text-muted">until {date(h.warranty_expires_on)}</div></>
                      : <><Badge tone="danger">Expired</Badge><div className="text-xs text-muted">{date(h.warranty_expires_on)}</div></>}</Td>
                    <Td align="right"><Button size="sm" onClick={() => setClaimFor(h)}>Open claim</Button></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      <Card padded={false} title="Claims">
        {claims.isLoading ? <Spinner /> : !claims.data?.length ? (
          <EmptyState icon={<ShieldCheck className="size-5" />} title="No warranty claims">Find the purchase above, then open a claim for it.</EmptyState>
        ) : (
          <Table>
            <thead><tr><Th>Claim</Th><Th>Item</Th><Th>Issue</Th><Th>Status</Th></tr></thead>
            <tbody>
              {claims.data.map((c) => (
                <tr key={c.id} className="hover:bg-surface-2/60">
                  <Td><button className="font-medium hover:text-accent" onClick={() => setClaimId(c.id)}>{c.number}</button><div className="text-xs text-muted">{date(c.created_at)}</div></Td>
                  <Td>{c.order_lines?.product_name}{!c.within_warranty && <div className="text-xs text-warn">outside warranty</div>}</Td>
                  <Td className="max-w-xs truncate text-muted">{c.issue}</Td>
                  <Td><Badge tone={CLAIM_STATUS[c.status].tone}>{CLAIM_STATUS[c.status].label}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {claimFor && <OpenClaim hit={claimFor} onClose={() => setClaimFor(null)} onOpened={(id) => { setClaimFor(null); setClaimId(id); }} />}
      {claimId && <ClaimDetail id={claimId} onClose={() => setClaimId(null)} />}
    </>
  );
}

function OpenClaim({ hit, onClose, onOpened }: { hit: WarrantyHit; onClose: () => void; onOpened: (id: string) => void }) {
  const org = useOrg();
  const qc = useQueryClient();
  const [issue, setIssue] = useState('');
  const [serial, setSerial] = useState(hit.matched_serial ?? hit.serials?.[0] ?? '');
  const open = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('open_warranty_claim', {
      p_organization_id: org.id, p_order_line_id: hit.order_line_id, p_issue: issue, p_serial: hit.serials ? serial : null,
    })) as unknown as WarrantyClaim,
    onSuccess: (c) => { qc.invalidateQueries({ queryKey: ['claims'] }); qc.invalidateQueries({ queryKey: ['warranty'] }); onOpened(c.claim_id); },
  });
  return (
    <Dialog open onClose={onClose} title={`Warranty claim · ${hit.product}`}
      description={hit.warranty_status === 'active' ? `Under warranty until ${date(hit.warranty_expires_on)}.` : hit.warranty_status === 'expired' ? 'Warranty has expired - the claim will be marked outside warranty.' : 'This item had no warranty.'}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={open.isPending} disabled={issue.trim().length < 3} onClick={() => open.mutate()}>Open claim</Button></>}>
      <div className="space-y-4">
        <ErrorNote error={open.error} />
        {hit.serials && <Field label="Unit"><Select value={serial} onChange={(e) => setSerial(e.target.value)}>{hit.serials.map((s) => <option key={s}>{s}</option>)}</Select></Field>}
        <Field label="What's wrong"><Textarea rows={3} value={issue} onChange={(e) => setIssue(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

const NEXT: Enums['warranty_claim_status'][] = ['received', 'in_repair', 'awaiting_parts', 'ready', 'replaced', 'refunded', 'rejected', 'closed'];

function ClaimDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const org = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<Enums['warranty_claim_status']>('received');
  const [note, setNote] = useState('');
  const [resolution, setResolution] = useState('');
  const { data: c, error } = useQuery({
    queryKey: ['claim', id],
    queryFn: async () => unwrap(await supabase.rpc('warranty_claim', { p_claim_id: id })) as unknown as WarrantyClaim,
  });
  const update = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('update_warranty_claim', { p_claim_id: id, p_status: status, p_note: note || null, p_resolution: resolution || null })),
    onSuccess: () => { toast('Claim updated'); setNote(''); qc.invalidateQueries({ queryKey: ['claim', id] }); qc.invalidateQueries({ queryKey: ['claims'] }); },
  });
  const closing = ['replaced', 'refunded', 'rejected', 'closed'].includes(status);
  return (
    <Dialog open onClose={onClose} wide title={c ? `${c.number} · ${c.product}` : 'Claim'}>
      <ErrorNote error={error ?? update.error} />
      {!c ? <Spinner /> : (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3 text-sm">
            <div><Badge tone={CLAIM_STATUS[c.status].tone}>{CLAIM_STATUS[c.status].label}</Badge> {c.within_warranty ? <Badge tone="ok">In warranty</Badge> : <Badge tone="warn">Outside warranty</Badge>}</div>
            <div><span className="text-muted">Order</span> <Link className="text-accent hover:underline" to={`/orders/${c.order_id}`}>{c.order_number}</Link>{c.serial && <span className="font-mono"> · {c.serial}</span>}</div>
            <div><span className="text-muted">Customer</span> {c.customer?.name ?? '-'} <span className="num text-muted">{c.customer?.phone}</span></div>
            <div><span className="text-muted">Issue</span> {c.issue}</div>
            {c.resolution && <div><span className="text-muted">Resolution</span> {c.resolution}</div>}
            <ol className="space-y-2 border-t border-border pt-3">
              {c.history.map((h, i) => (
                <li key={i}><span className="font-medium">{CLAIM_STATUS[h.status].label}</span> <span className="text-xs text-muted">{dateTime(h.at)} · {h.by}</span>{h.note && <div className="text-muted">{h.note}</div>}</li>
              ))}
            </ol>
          </div>
          {c.status !== 'closed' && org.can('orders.manage') && (
            <div className="space-y-3">
              <Field label="Move to"><Select value={status} onChange={(e) => setStatus(e.target.value as Enums['warranty_claim_status'])}>{NEXT.map((s) => <option key={s} value={s}>{CLAIM_STATUS[s].label}</option>)}</Select></Field>
              <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. sent to service centre, job #1234" /></Field>
              {closing && <Field label="Resolution" hint="Required to finish the claim."><Input value={resolution} onChange={(e) => setResolution(e.target.value)} /></Field>}
              <Button variant="primary" busy={update.isPending} onClick={() => update.mutate()}>Update claim</Button>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
