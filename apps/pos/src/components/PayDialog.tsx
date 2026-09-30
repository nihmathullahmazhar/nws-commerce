import { useMemo, useState } from 'react';
import { Banknote, CreditCard, Gift, Landmark, QrCode, Star, Trash2, Wallet } from 'lucide-react';
import type { Enums } from '@nws-commerce/db';
import { Button, Dialog, ErrorNote, Input } from '@nws-commerce/ui';
import { money } from '../lib/format';
import { supabase } from '../lib/supabase';
import { unwrap } from '../lib/api';

export interface Tender { method: Enums['payment_method']; amount: number; reference?: string; code?: string }

/** A customer's points, and what they are worth here. */
export interface PointsWallet { balance: number; value: number; min: number }

const METHODS: { method: Enums['payment_method']; label: string; icon: React.ReactNode }[] = [
  { method: 'cash', label: 'Cash', icon: <Banknote className="size-5" /> },
  { method: 'card', label: 'Card', icon: <CreditCard className="size-5" /> },
  { method: 'bank_transfer', label: 'Transfer', icon: <Landmark className="size-5" /> },
  { method: 'qr', label: 'QR', icon: <QrCode className="size-5" /> },
  { method: 'store_credit', label: 'Store credit', icon: <Wallet className="size-5" /> },
  { method: 'gift_card', label: 'Gift card', icon: <Gift className="size-5" /> },
  { method: 'loyalty_points', label: 'Points', icon: <Star className="size-5" /> },
];

/** Round-up suggestions for cash: exact, then the next common note totals. */
function cashSuggestions(due: number): number[] {
  const out = new Set<number>([Math.round(due * 100) / 100]);
  for (const step of [100, 500, 1000, 5000]) out.add(Math.ceil(due / step) * step);
  return [...out].filter((v) => v >= due).sort((a, b) => a - b).slice(0, 5);
}

export function PayDialog({ orgId, total, currency, credit, giftCards, points, busy, error, onClose, onPay }: {
  orgId: string; total: number; currency: string; credit: number | null; giftCards: boolean; points: PointsWallet | null;
  busy: boolean; error: unknown;
  onClose: () => void; onPay: (tenders: Tender[]) => void;
}) {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [method, setMethod] = useState<Enums['payment_method']>('cash');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [card, setCard] = useState<{ code: string; balance: number } | null>(null);
  const [cardError, setCardError] = useState<unknown>(null);

  const nonCash = tenders.filter((t) => t.method !== 'cash').reduce((s, t) => s + t.amount, 0);
  const cash = tenders.filter((t) => t.method === 'cash').reduce((s, t) => s + t.amount, 0);
  const remaining = Math.max(Math.round((total - nonCash - cash) * 100) / 100, 0);
  const change = Math.max(Math.round((cash + nonCash - total) * 100) / 100, 0);
  const suggestions = useMemo(() => cashSuggestions(remaining), [remaining]);

  async function checkCard(code: string) {
    setCardError(null);
    try {
      const g = unwrap(await supabase.rpc('gift_card_lookup', { p_organization_id: orgId, p_code: code })) as unknown as { code: string; balance: number; status: string };
      if (g.status !== 'active') throw new Error(`This card is ${g.status}.`);
      // Money already put on this card in this sale is not available twice.
      const used = tenders.filter((t) => t.code === g.code).reduce((s, t) => s + t.amount, 0);
      setCard({ code: g.code, balance: Math.max(g.balance - used, 0) });
    } catch (e) { setCard(null); setCardError(e); }
  }

  // Points spend in whole points, so the money they cover is capped by the balance left.
  const pointsUsed = tenders.filter((t) => t.method === 'loyalty_points').reduce((s, t) => s + Math.ceil(t.amount / (points?.value || 1)), 0);
  const pointsLeft = points ? points.balance - pointsUsed : 0;
  const pointsWorth = points ? Math.floor(pointsLeft * points.value * 100) / 100 : 0;
  const creditUsed = tenders.filter((t) => t.method === 'store_credit').reduce((s, t) => s + t.amount, 0);
  const creditLeft = Math.max((credit ?? 0) - creditUsed, 0);
  const cap = method === 'store_credit' ? creditLeft : method === 'gift_card' ? (card?.balance ?? 0) : method === 'loyalty_points' ? pointsWorth : Infinity;
  const suggested = Math.min(remaining, cap);

  function add(m: Enums['payment_method'], value: number) {
    if (!(value > 0)) return;
    if (m === 'gift_card' && !card) return;
    value = Math.min(value, m === 'cash' ? Infinity : cap);
    // Only cash can exceed what is due (the rest is change).
    const capped = m === 'cash' ? value : Math.min(value, remaining);
    if (!(capped > 0)) return;
    setTenders((t) => [...t, {
      method: m, amount: Math.round(capped * 100) / 100, ...(reference ? { reference } : {}),
      ...(m === 'gift_card' && card ? { code: card.code, reference: `card ...${card.code.slice(-4)}` } : {}),
    }]);
    if (m === 'gift_card') setCard(null);
    setAmount('');
    setReference('');
  }

  const creditUsable = credit !== null && credit > 0;
  const shown = METHODS.filter((m) => (m.method !== 'store_credit' || creditUsable) && (m.method !== 'gift_card' || giftCards)
    && (m.method !== 'loyalty_points' || (points !== null && points.balance > 0)));
  const covered = remaining === 0 && (tenders.length > 0 || total === 0);

  return (
    <Dialog open onClose={onClose} wide title={`Take payment · ${money(total, currency)}`}
      footer={<>
        <Button onClick={onClose}>Back</Button>
        <Button variant="primary" className="h-11 px-6 text-base" busy={busy} disabled={!covered}
          onClick={() => onPay(tenders)}>{covered ? (change > 0 ? `Complete · change ${money(change, currency)}` : 'Complete sale') : `${money(remaining, currency)} still due`}</Button>
      </>}>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {shown.map((m) => (
              <button key={m.method} onClick={() => { setMethod(m.method); setCardError(null); setReference(''); setAmount(''); }}
                className={`flex h-16 flex-col items-center justify-center gap-1 rounded-lg border text-sm ${method === m.method ? 'border-accent bg-accent-soft font-semibold text-accent' : 'border-border hover:bg-surface-2'}`}>
                {m.icon}{m.label}
              </button>
            ))}
          </div>
          {method === 'cash' && remaining > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {suggestions.map((v) => (
                <button key={v} onClick={() => add('cash', v)} className="num h-12 rounded-lg border border-border text-sm font-medium hover:bg-surface-2">{money(v, currency)}</button>
              ))}
            </div>
          ) : method === 'store_credit' ? (
            <p className="text-sm text-muted">Balance {money(creditLeft, currency)}</p>
          ) : method === 'loyalty_points' && points ? (
            <p className="text-sm text-muted">
              {pointsLeft.toLocaleString()} points, worth {money(pointsWorth, currency)}
              {points.min > 0 && ` · at least ${points.min} at once`}
            </p>
          ) : method === 'gift_card' ? (
            <div className="space-y-2">
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void checkCard(reference); }}>
                <Input autoFocus className="h-11 font-mono uppercase" placeholder="Scan or type the card code" value={reference} onChange={(e) => { setReference(e.target.value); setCard(null); }} />
                <Button type="submit" className="h-11" disabled={!reference.trim()}>Check</Button>
              </form>
              <ErrorNote error={cardError} />
              {card && <p className="text-sm">Card ...{card.code.slice(-4)} has <span className="num font-semibold">{money(card.balance, currency)}</span> to spend.</p>}
            </div>
          ) : null}
          {(method !== 'gift_card' || card) && <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(method, Number(amount || suggested)); }}>
            <Input autoFocus className="h-11 text-base" type="number" min="0" step="0.01" placeholder={`Amount (${money(suggested, currency)})`}
              value={amount} onChange={(e) => setAmount(e.target.value)} />
            {(method === 'card' || method === 'bank_transfer' || method === 'qr') &&
              <Input className="h-11 w-36" placeholder="Ref / auth" value={reference} onChange={(e) => setReference(e.target.value)} />}
            <Button type="submit" className="h-11">Add</Button>
          </form>}
          <p className="text-xs text-muted">Press Enter with the box empty to take the amount still due.</p>
        </div>

        <div className="rounded-lg border border-border">
          <div className="border-b border-border px-4 py-2 text-sm font-medium">Tendered</div>
          {tenders.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted">Nothing yet</p> : (
            <ul className="divide-y divide-border">
              {tenders.map((t, i) => (
                <li key={i} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span>{METHODS.find((m) => m.method === t.method)?.label}{t.reference ? ` · ${t.reference}` : ''}</span>
                  <span className="flex items-center gap-2"><span className="num">{money(t.amount, currency)}</span>
                    <button aria-label="Remove" className="text-muted hover:text-danger" onClick={() => setTenders((x) => x.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button></span>
                </li>
              ))}
            </ul>
          )}
          <dl className="space-y-1 border-t border-border px-4 py-3 text-sm">
            <div className="flex justify-between"><dt>Total</dt><dd className="num">{money(total, currency)}</dd></div>
            <div className="flex justify-between font-semibold"><dt>Still due</dt><dd className="num">{money(remaining, currency)}</dd></div>
            {change > 0 && <div className="flex justify-between text-lg font-bold text-ok"><dt>Change</dt><dd className="num">{money(change, currency)}</dd></div>}
          </dl>
        </div>
      </div>
      <div className="mt-4"><ErrorNote error={error} /></div>
    </Dialog>
  );
}
