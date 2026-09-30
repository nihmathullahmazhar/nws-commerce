import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { unwrap } from '../lib/api';
import { useOrg } from '../lib/workspace';
import { date, money } from '../lib/format';
import { normalisePhone } from '../lib/phone';
import { Button, Card, Dialog, EmptyState, ErrorNote, Field, Input, PageHeader, Spinner, Table, Td, Th, useToast } from '@nws-commerce/ui';

export function Customers() {
  const org = useOrg();
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['customers', org.id, search],
    queryFn: async () => {
      let q = supabase.from('customers').select('id, full_name, phone, email, store_credit_balance, created_at')
        .eq('organization_id', org.id).order('created_at', { ascending: false }).limit(200);
      const s = search.trim().replace(/[%,()]/g, '');
      if (s) {
        const phone = normalisePhone(s);
        q = q.or([`full_name.ilike.%${s}%`, `email.ilike.%${s}%`, `phone.ilike.%${s.replace(/\D/g, '')}%`, phone && `phone.eq.${phone}`].filter(Boolean).join(','));
      }
      return unwrap(await q);
    },
  });

  return (
    <>
      <PageHeader title="Customers" description="One customer record across the online store, the counter and the app."
        actions={org.can('customers.manage') && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Add customer</Button>} />
      <Card padded={false}>
        <div className="border-b border-border p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-faint" />
            <Input className="pl-8" placeholder="Name, phone or email" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <ErrorNote error={error} />
        {isLoading ? <Spinner /> : !data?.length ? (
          search ? <EmptyState title="No customers match" icon={<Search className="size-5" />} /> :
          <EmptyState icon={<Users className="size-5" />} title="No customers yet">
            Customers are created when someone signs up online or a cashier adds them at the counter. Counter staff find them by phone number.
          </EmptyState>
        ) : (
          <Table>
            <thead><tr><Th>Customer</Th><Th>Phone</Th><Th>Email</Th><Th align="right">Store credit</Th><Th>Since</Th></tr></thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="hover:bg-surface-2/60">
                  <Td><Link to={`/customers/${c.id}`} className="font-medium hover:text-accent">{c.full_name || 'Unnamed'}</Link></Td>
                  <Td className="num text-muted">{c.phone ?? '-'}</Td>
                  <Td className="text-muted">{c.email ?? '-'}</Td>
                  <Td align="right">{c.store_credit_balance > 0 ? money(c.store_credit_balance, org.currency) : '-'}</Td>
                  <Td className="text-muted">{date(c.created_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {adding && <CustomerDialog onClose={() => setAdding(false)} />}
    </>
  );
}

export function CustomerDialog({ onClose, existing }: {
  onClose: () => void; existing?: { id: string; full_name: string | null; phone: string | null; email: string | null; notes: string | null };
}) {
  const org = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState(existing?.full_name ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const [email, setEmail] = useState(existing?.email ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const normalised = phone.trim() ? normalisePhone(phone) : null;
      if (phone.trim() && !normalised) { setPhoneError('That does not look like a phone number.'); throw new Error('Check the phone number.'); }
      setPhoneError(null);
      const row = { full_name: name.trim() || null, phone: normalised, email: email.trim() || null, notes: notes.trim() || null };
      if (existing) return unwrap(await supabase.from('customers').update(row).eq('id', existing.id).select('id').single());
      return unwrap(await supabase.from('customers').insert({ ...row, organization_id: org.id }).select('id').single());
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customer', c.id] });
      toast(existing ? 'Customer saved' : 'Customer added');
      onClose();
      if (!existing) navigate(`/customers/${c.id}`);
    },
  });

  return (
    <Dialog open onClose={onClose} title={existing ? 'Edit customer' : 'New customer'}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={save.isPending} form="customer-form" type="submit">Save</Button></>}>
      <form id="customer-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <ErrorNote error={save.error?.message === 'Check the phone number.' ? null : save.error} />
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Phone" hint="Local numbers like 077 123 4567 are saved as +94 77 123 4567." error={phoneError}>
          <Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </form>
    </Dialog>
  );
}
