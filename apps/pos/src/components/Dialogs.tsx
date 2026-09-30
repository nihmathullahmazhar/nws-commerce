import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import type { OverrideResult, ShiftSummary } from '@nws-commerce/db';
import { Button, Dialog, ErrorNote, Field, Input, Select, Spinner } from '@nws-commerce/ui';
import { supabase } from '../lib/supabase';
import { unwrap } from '../lib/api';
import { dateTime, money, titleCase } from '../lib/format';
import { normalisePhone } from '../lib/phone';
import type { Customer, TicketLine } from '../lib/ticket';

// ---------------------------------------------------------------------------
// Manager approval: the manager types their PIN on the till.
// ---------------------------------------------------------------------------
const REASONS: Record<string, string> = {
  wrong_pin: 'Wrong PIN.', locked: 'Too many wrong PINs - this manager is locked for 15 minutes.',
  no_pin: 'This manager has not set a PIN.', not_authorised: 'This person cannot approve discounts.', self_approval: 'You cannot approve your own discount.',
};

export function ApprovalDialog({ orgId, percent, onClose, onApproved }: {
  orgId: string; percent: number; onClose: () => void; onApproved: (approvalId: string) => void;
}) {
  const [approver, setApprover] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: approvers = [], isLoading } = useQuery({
    queryKey: ['pos-approvers', orgId],
    queryFn: async () => unwrap(await supabase.rpc('pos_approvers', { p_organization_id: orgId })),
  });

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      const r = unwrap(await supabase.rpc('request_override', { p_organization_id: orgId, p_approver_id: approver, p_pin: pin, p_purpose: 'discount' })) as unknown as OverrideResult;
      if (!r.approved) setError(`${REASONS[r.reason ?? ''] ?? 'Not approved.'}${r.attempts_left !== undefined ? ` ${r.attempts_left} tries left.` : ''}`);
      else if ((r.max_discount_percent ?? 0) < percent) setError(`This manager can approve up to ${r.max_discount_percent}%, and this sale is ${percent}% off.`);
      else onApproved(r.approval_id!);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not approve.'); }
    finally { setBusy(false); setPin(''); }
  }

  return (
    <Dialog open onClose={onClose} title="Manager approval" description={`This sale has ${percent}% off, more than you can give on your own.`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!approver || pin.length < 4} onClick={approve}>Approve</Button></>}>
      {isLoading ? <Spinner /> : approvers.length === 0 ? (
        <p className="text-sm text-muted">No manager with a PIN is available. Managers set their PIN in the admin under Settings → Staff.</p>
      ) : (
        <div className="space-y-4">
          <Field label="Manager">
            <Select className="h-11" value={approver} onChange={(e) => setApprover(e.target.value)}>
              <option value="">Choose</option>
              {approvers.map((a) => <option key={a.user_id!} value={a.user_id!}>{a.email} (up to {a.discount_limit}%)</option>)}
            </Select>
          </Field>
          <Field label="PIN"><Input className="h-11 text-center text-xl tracking-[0.5em]" type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter' && approver && pin.length >= 4) void approve(); }} /></Field>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Serial capture: scan each unit's IMEI / serial before it goes on the ticket.
// ---------------------------------------------------------------------------
export function SerialDialog({ line, locationId, onClose, onDone }: {
  line: Pick<TicketLine, 'name' | 'variant' | 'variantId' | 'serials'>; locationId: string; onClose: () => void; onDone: (serials: string[]) => void;
}) {
  const [serials, setSerials] = useState<string[]>(line.serials ?? []);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const s = text.trim();
    if (!s) return;
    if (serials.some((x) => x.toUpperCase() === s.toUpperCase())) { setError('Already scanned.'); setText(''); return; }
    const { data } = await supabase.from('serial_units').select('serial, status, location_id')
      .eq('variant_id', line.variantId).ilike('serial', s).limit(1);
    const unit = data?.[0];
    if (!unit) setError(`${s} is not a unit of this item.`);
    else if (unit.location_id !== locationId || unit.status !== 'available') setError(`${unit.serial} is ${unit.status === 'available' ? 'at another location' : titleCase(unit.status)}.`);
    else { setSerials((x) => [...x, unit.serial]); setError(null); }
    setText('');
  }

  return (
    <Dialog open onClose={onClose} title={`Scan serial numbers · ${line.name}`} description={line.variant !== 'Default' ? line.variant : undefined}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={serials.length === 0} onClick={() => onDone(serials)}>Add {serials.length || ''} to sale</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <Input autoFocus className="h-11 font-mono" placeholder="Scan or type the IMEI / serial, then Enter" value={text} onChange={(e) => setText(e.target.value)} />
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      <ul className="mt-3 space-y-1">
        {serials.map((s) => (
          <li key={s} className="flex items-center justify-between rounded bg-surface-2 px-3 py-1.5 font-mono text-sm">
            {s}<button className="text-xs text-muted hover:text-danger" onClick={() => setSerials((x) => x.filter((y) => y !== s))}>remove</button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Customer: find by phone or name, or add in two fields.
// ---------------------------------------------------------------------------
export function CustomerDialog({ orgId, onClose, onPick }: { orgId: string; onClose: () => void; onPick: (c: Customer | null) => void }) {
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const term = q.trim().replace(/[%,()]/g, '');
  const phone = normalisePhone(term);
  const { data = [], isFetching } = useQuery({
    queryKey: ['pos-customers', orgId, term],
    enabled: term.length >= 3,
    queryFn: async () => unwrap(await supabase.from('customers').select('id, full_name, phone, store_credit_balance, loyalty_points')
      .eq('organization_id', orgId)
      .or([`full_name.ilike.%${term}%`, phone && `phone.eq.${phone}`, `phone.ilike.%${term.replace(/\D/g, '') || '_none_'}%`].filter(Boolean).join(','))
      .limit(8)) as Customer[],
  });

  async function create() {
    if (!phone) { setError('Enter a valid phone number first.'); return; }
    const { data, error } = await supabase.from('customers').insert({ organization_id: orgId, full_name: name.trim() || null, phone })
      .select('id, full_name, phone, store_credit_balance, loyalty_points').single();
    if (error) setError(error.code === '23505' ? 'A customer already has that number.' : error.message);
    else onPick(data as Customer);
  }

  return (
    <Dialog open onClose={onClose} title="Customer" footer={<><Button onClick={() => onPick(null)}>Walk-in (no customer)</Button><Button onClick={onClose}>Close</Button></>}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-faint" />
        <Input autoFocus className="h-11 pl-9" placeholder="Phone number or name" value={q} onChange={(e) => { setQ(e.target.value); setAdding(false); }} />
      </div>
      {term.length >= 3 && (
        <ul className="mt-3 divide-y divide-border rounded-md border border-border">
          {data.map((c) => (
            <li key={c.id}><button className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-surface-2" onClick={() => onPick(c)}>
              <span><span className="font-medium">{c.full_name ?? 'Unnamed'}</span> <span className="num text-muted">{c.phone}</span></span>
              {c.store_credit_balance > 0 && <span className="text-xs text-ok">credit {money(c.store_credit_balance)}</span>}
            </button></li>
          ))}
          {!isFetching && data.length === 0 && <li className="px-3 py-2.5 text-sm text-muted">No match.</li>}
        </ul>
      )}
      {phone && !data.some((c) => c.phone === phone) && (
        adding ? (
          <div className="mt-3 flex gap-2">
            <Input className="h-11" autoFocus placeholder={`Name for ${phone}`} value={name} onChange={(e) => setName(e.target.value)} />
            <Button className="h-11" variant="primary" onClick={create}>Save</Button>
          </div>
        ) : <Button className="mt-3" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>New customer {phone}</Button>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Cash in / out
// ---------------------------------------------------------------------------
export function CashDialog({ shiftId, currency, onClose, onDone }: { shiftId: string; currency: string; onClose: () => void; onDone: (s: ShiftSummary) => void }) {
  const [kind, setKind] = useState<'paid_out' | 'paid_in' | 'drop'>('paid_out');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { onDone(unwrap(await supabase.rpc('pos_cash_movement', { p_shift_id: shiftId, p_kind: kind, p_amount: Number(amount), p_reason: reason })) as unknown as ShiftSummary); }
    catch (e) { setError(e); } finally { setBusy(false); }
  }
  return (
    <Dialog open onClose={onClose} title="Cash in / out"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!(Number(amount) > 0) || reason.trim().length < 3} onClick={save}>Record</Button></>}>
      <div className="space-y-4">
        <ErrorNote error={error} />
        <div className="grid grid-cols-3 gap-2">
          {([['paid_out', 'Paid out'], ['paid_in', 'Paid in'], ['drop', 'Drop to safe']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setKind(k)} className={`h-11 rounded-md border text-sm ${kind === k ? 'border-accent bg-accent-soft font-semibold text-accent' : 'border-border'}`}>{l}</button>
          ))}
        </div>
        <Field label={`Amount (${currency})`}><Input className="h-11" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Reason"><Input className="h-11" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. courier fee, float top-up" /></Field>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Shift report (X) and closing (Z)
// ---------------------------------------------------------------------------
export function ShiftReport({ s, currency }: { s: ShiftSummary; currency: string }) {
  const m = (v: number | null | undefined) => money(v ?? 0, currency);
  return (
    <div className="space-y-3 text-sm">
      <div className="text-muted">{s.number} · {s.terminal.name} · {s.cashier}<br />Opened {dateTime(s.opened_at)}{s.closed_at ? ` · closed ${dateTime(s.closed_at)}` : ''}</div>
      <dl className="space-y-1">
        <div className="flex justify-between"><dt>Sales</dt><dd className="num">{s.sales.count} · {m(s.sales.total)}</dd></div>
        <div className="flex justify-between text-muted"><dt>Discounts given</dt><dd className="num">{m(s.sales.discounts)}</dd></div>
      </dl>
      <div className="border-t border-border pt-2">
        {s.by_method.map((b) => (
          <div key={b.method} className="flex justify-between"><span>{titleCase(b.method)}</span><span className="num">{m(b.net)}{b.refunded > 0 ? ` (refunded ${m(b.refunded)})` : ''}</span></div>
        ))}
      </div>
      <dl className="space-y-1 border-t border-border pt-2">
        <div className="flex justify-between"><dt>Opening float</dt><dd className="num">{m(s.opening_float)}</dd></div>
        {s.cash_movements.map((c, i) => (
          <div key={i} className="flex justify-between text-muted"><dt>{titleCase(c.kind)}: {c.reason}</dt><dd className="num">{c.kind === 'paid_in' ? '+' : '-'}{m(c.amount)}</dd></div>
        ))}
        <div className="flex justify-between font-semibold"><dt>Cash that should be in the drawer</dt><dd className="num">{m(s.expected_cash)}</dd></div>
        {s.counted_cash !== null && <>
          <div className="flex justify-between"><dt>Counted</dt><dd className="num">{m(s.counted_cash)}</dd></div>
          <div className={`flex justify-between font-semibold ${s.variance ? 'text-danger' : 'text-ok'}`}><dt>{(s.variance ?? 0) > 0 ? 'Over' : (s.variance ?? 0) < 0 ? 'Short' : 'Balanced'}</dt><dd className="num">{m(Math.abs(s.variance ?? 0))}</dd></div>
          {s.close_note && <div className="text-muted">Note: {s.close_note}</div>}
        </>}
      </dl>
    </div>
  );
}

export function CloseShiftDialog({ shift, currency, onClose, onClosed }: {
  shift: ShiftSummary; currency: string; onClose: () => void; onClosed: (z: ShiftSummary) => void;
}) {
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const diff = counted === '' ? 0 : Number(counted) - shift.expected_cash;
  async function close() {
    setBusy(true);
    try { onClosed(unwrap(await supabase.rpc('pos_close_shift', { p_shift_id: shift.shift_id, p_counted_cash: Number(counted), p_note: note || null })) as unknown as ShiftSummary); }
    catch (e) { setError(e); } finally { setBusy(false); }
  }
  return (
    <Dialog open onClose={onClose} title="Close shift" description="Count the drawer without looking at the expected figure first; the difference is recorded."
      footer={<><Button onClick={onClose}>Keep selling</Button><Button variant="primary" busy={busy} disabled={counted === '' || (diff !== 0 && note.trim().length < 3)} onClick={close}>Close shift</Button></>}>
      <div className="space-y-4">
        <ErrorNote error={error} />
        <Field label={`Cash counted (${currency})`}><Input autoFocus className="h-12 text-lg" type="number" min="0" step="0.01" value={counted} onChange={(e) => setCounted(e.target.value)} /></Field>
        {counted !== '' && diff !== 0 && (
          <Field label={`The drawer is ${diff > 0 ? 'over' : 'short'} by ${money(Math.abs(diff), currency)} - what happened?`}>
            <Input className="h-11" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
        {counted !== '' && diff === 0 && <p className="text-sm text-ok">The drawer balances.</p>}
      </div>
    </Dialog>
  );
}
