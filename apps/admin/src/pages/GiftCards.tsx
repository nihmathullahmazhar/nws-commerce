import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, Search } from 'lucide-react';
import { Badge, Button, Card, Dialog, EmptyState, ErrorNote, Field, Input, PageHeader, Spinner, Table, Td, Th, useToast } from '@nws-commerce/ui';
import { supabase } from '../lib/supabase';
import { unwrap } from '../lib/api';
import { useOrg } from '../lib/workspace';
import { date, dateTime, money } from '../lib/format';

interface Lookup { code: string; balance: number; initial_value: number; status: string; expires_on: string | null; created_at: string; history: { amount: number; reason: string; at: string }[] }

export function GiftCards() {
  const org = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [found, setFound] = useState<Lookup | null>(null);
  const [lookupError, setLookupError] = useState<unknown>(null);
  const [issuing, setIssuing] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const cards = useQuery({
    queryKey: ['gift-cards', org.id],
    queryFn: async () => unwrap(await supabase.from('gift_cards').select('id, code, initial_value, balance, status, created_at, note, customers(full_name)')
      .eq('organization_id', org.id).order('created_at', { ascending: false }).limit(100)),
  });
  async function lookup(e: FormEvent) {
    e.preventDefault();
    setLookupError(null);
    try { setFound(unwrap(await supabase.rpc('gift_card_lookup', { p_organization_id: org.id, p_code: code })) as unknown as Lookup); }
    catch (err) { setFound(null); setLookupError(err); }
  }
  const issue = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('issue_gift_card', { p_organization_id: org.id, p_amount: Number(amount), p_reason: reason })) as unknown as Lookup,
    onSuccess: (g) => { qc.invalidateQueries({ queryKey: ['gift-cards'] }); setIssuing(false); setFound(g); setAmount(''); setReason(''); toast(`Card ${g.code} issued`); },
  });
  const voidCard = useMutation({
    mutationFn: async (c: string) => unwrap(await supabase.rpc('void_gift_card', { p_organization_id: org.id, p_code: c, p_reason: 'voided in admin' })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['gift-cards'] }); setFound(null); toast('Card voided'); },
  });

  return (
    <>
      <PageHeader title="Gift cards" description="Cards are issued when a gift-card product is sold, or given here as goodwill. Customers spend them at the till."
        actions={org.can('orders.manage') && <Button icon={<Gift className="size-4" />} onClick={() => setIssuing(true)}>Give a card</Button>} />
      <form onSubmit={lookup} className="mb-5 flex gap-2">
        <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-faint" />
          <Input className="h-10 pl-9 font-mono uppercase" placeholder="Card code, e.g. ABCD-EFGH-JKMN-PQRS" value={code} onChange={(e) => setCode(e.target.value)} /></div>
        <Button type="submit" variant="primary" className="h-10">Check balance</Button>
      </form>
      <ErrorNote error={lookupError} />
      {found && (
        <Card className="mb-5" title={<span className="font-mono">{found.code}</span>}
          actions={found.status === 'active' && org.can('orders.manage') && <Button size="sm" variant="danger" onClick={() => voidCard.mutate(found.code)}>Void</Button>}>
          <div className="flex items-baseline gap-3"><span className="num text-3xl font-semibold">{money(found.balance, org.currency)}</span>
            <span className="text-sm text-muted">of {money(found.initial_value, org.currency)}</span><Badge tone={found.status === 'active' ? 'ok' : 'neutral'}>{found.status}</Badge></div>
          <ul className="mt-3 space-y-1 text-sm">
            {found.history.map((h, i) => <li key={i} className="flex justify-between"><span className="text-muted">{dateTime(h.at)} · {h.reason}</span><span className={`num ${h.amount < 0 ? 'text-danger' : 'text-ok'}`}>{h.amount > 0 ? '+' : ''}{money(h.amount, org.currency)}</span></li>)}
          </ul>
        </Card>
      )}
      <Card padded={false} title="Recent cards">
        {cards.isLoading ? <Spinner /> : !cards.data?.length ? <EmptyState icon={<Gift className="size-5" />} title="No gift cards yet">Create a product, tick "Sell as a gift card", and sell it at the till.</EmptyState> : (
          <Table>
            <thead><tr><Th>Card</Th><Th>Issued</Th><Th align="right">Value</Th><Th align="right">Balance</Th><Th>Status</Th></tr></thead>
            <tbody>
              {cards.data.map((c) => (
                <tr key={c.id}>
                  <Td className="font-mono text-xs">{c.code.slice(0, 4)}-****-****-{c.code.slice(-4)}<div className="font-sans text-muted">{c.customers?.full_name ?? c.note}</div></Td>
                  <Td className="text-muted">{date(c.created_at)}</Td>
                  <Td align="right">{money(c.initial_value, org.currency)}</Td>
                  <Td align="right">{money(c.balance, org.currency)}</Td>
                  <Td><Badge tone={c.status === 'active' && c.balance > 0 ? 'ok' : 'neutral'}>{c.status === 'void' ? 'Void' : c.balance > 0 ? 'Active' : 'Used'}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Dialog open={issuing} onClose={() => setIssuing(false)} title="Give a gift card" description="For goodwill, prizes or replacing a lost card. Sold cards come from the till."
        footer={<><Button onClick={() => setIssuing(false)}>Cancel</Button><Button variant="primary" busy={issue.isPending} disabled={!(Number(amount) > 0) || reason.trim().length < 3} onClick={() => issue.mutate()}>Issue</Button></>}>
        <div className="space-y-4">
          <ErrorNote error={issue.error} />
          <Field label={`Value (${org.currency})`}><Input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. apology for late delivery" /></Field>
        </div>
      </Dialog>
    </>
  );
}
