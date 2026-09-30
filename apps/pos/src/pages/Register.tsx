import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownUp, Barcode, Clock, Gift, Tag, LogOut, Undo2, Minus, Pause, Percent, Plus, Printer, ReceiptText, Search, Trash2, User, X,
} from 'lucide-react';
import type { Enums, ExchangeResult, Json, OrderSummary, PosQuote, PosReceipt, ReturnSummary, ShiftSummary } from '@nws-commerce/db';
import { Badge, Button, Dialog, ErrorNote, Field, Input, useToast } from '@nws-commerce/ui';
import { supabase } from '../lib/supabase';
import { unwrap } from '../lib/api';
import { dateTime, money, newIdempotencyKey, qty } from '../lib/format';
import type { PosOrg } from '../lib/org';
import { lineFromHit, toLines, type Customer, type Discount, type TicketLine, type VariantHit } from '../lib/ticket';
import { PayDialog, type Tender } from '../components/PayDialog';
import { Receipt } from '../components/Receipt';
import { ApprovalDialog, CashDialog, CloseShiftDialog, CustomerDialog, SerialDialog, ShiftReport } from '../components/Dialogs';
import { ReturnDialog, type ReturnChoice } from '../components/Returns';

type Modal =
  | { kind: 'pay' } | { kind: 'approval'; percent: number } | { kind: 'serial'; hit: VariantHit; lineKey?: string }
  | { kind: 'customer' } | { kind: 'discount'; lineKey: string | null } | { kind: 'coupon' } | { kind: 'qty'; lineKey: string }
  | { kind: 'held' } | { kind: 'cash' } | { kind: 'report' } | { kind: 'close' } | { kind: 'done'; receipt: PosReceipt; change: number }
  | { kind: 'z'; summary: ShiftSummary } | { kind: 'return' } | { kind: 'refunded'; ret: ReturnSummary; method: Enums['payment_method'] } | null;

export function Register({ org, shift: initialShift, onShiftClosed }: { org: PosOrg; shift: ShiftSummary; onShiftClosed: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const cur = org.currency;
  const [shift, setShift] = useState(initialShift);
  const [lines, setLines] = useState<TicketLine[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orderDiscount, setOrderDiscount] = useState<Discount | null>(null);
  const [coupon, setCoupon] = useState<string | null>(null);
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey('till'));
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // An exchange in progress: the return's value pays toward this ticket.
  const [exchange, setExchange] = useState<ReturnChoice | null>(null);
  const [returnBusy, setReturnBusy] = useState(false);
  const [returnError, setReturnError] = useState<unknown>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const locationId = useRef<string | null>(null);

  // The till's location, for stock and serial checks.
  useQuery({
    queryKey: ['till-location', shift.terminal.id],
    queryFn: async () => {
      const t = unwrap(await supabase.from('pos_terminals').select('location_id').eq('id', shift.terminal.id).single());
      locationId.current = t.location_id;
      return t.location_id;
    },
  });

  useEffect(() => { const t = setTimeout(() => setTerm(search.trim()), 150); return () => clearTimeout(t); }, [search]);
  const focusSearch = useCallback(() => setTimeout(() => searchRef.current?.focus(), 0), []);

  const products = useQuery({
    queryKey: ['till-search', org.id, term],
    queryFn: async () => unwrap(await supabase.rpc('search_variants', {
      p_organization_id: org.id, p_query: term, p_location_id: locationId.current, p_limit: 30,
    })),
  });

  // Live totals from the database's own pricing (discounts, tax, approval need, shelf stock).
  const ticketKey = JSON.stringify([toLines(lines), orderDiscount, coupon]);
  const quote = useQuery({
    queryKey: ['till-quote', shift.shift_id, ticketKey],
    enabled: lines.length > 0,
    placeholderData: (prev) => prev,
    queryFn: async () => unwrap(await supabase.rpc('pos_quote', {
      p_shift_id: shift.shift_id, p_lines: toLines(lines) as unknown as Json, p_order_discount: orderDiscount as unknown as Json,
      p_coupon: coupon,
    })) as unknown as PosQuote,
  });
  const q = lines.length ? quote.data : undefined;

  // Any change to the ticket invalidates a manager's approval for the old one.
  useEffect(() => { setApprovalId(null); }, [ticketKey]);

  function addHit(hit: VariantHit, serials?: string[]) {
    if (hit.tracking_mode === 'serial' && !serials) { setModal({ kind: 'serial', hit }); return; }
    setLines((ls) => {
      const existing = ls.find((l) => l.variantId === hit.variant_id && !l.serials && !l.discount);
      if (existing && !serials) return ls.map((l) => (l === existing ? { ...l, quantity: +(l.quantity + 1).toFixed(3) } : l));
      const sameSerialLine = serials && ls.find((l) => l.variantId === hit.variant_id && l.serials);
      if (sameSerialLine) return ls.map((l) => (l === sameSerialLine ? { ...l, serials, quantity: serials.length } : l));
      return [...ls, lineFromHit(hit, serials ? serials.length : 1, serials)];
    });
    setNotice(null);
  }

  async function scan() {
    const text = search.trim();
    if (!text) return;
    const hits = unwrap(await supabase.rpc('search_variants', { p_organization_id: org.id, p_query: text, p_location_id: locationId.current, p_limit: 5 }));
    const exact = hits.find((h) => h.barcode === text || h.sku?.toLowerCase() === text.toLowerCase());
    if (exact) { addHit(exact); setSearch(''); setTerm(''); }
    else if (hits.length === 1) { addHit(hits[0]); setSearch(''); setTerm(''); }
    else if (hits.length === 0) setNotice(`Nothing matches "${text}".`);
  }

  const setLine = (key: string, patch: Partial<TicketLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));

  function newSale() {
    setLines([]); setCustomer(null); setOrderDiscount(null); setCoupon(null); setApprovalId(null); setPayError(null); setExchange(null);
    setIdempotencyKey(newIdempotencyKey('till'));
    setModal(null); setSearch(''); focusSearch();
  }

  function startPay() {
    if (!lines.length || !q) return;
    if (exchange && (orderDiscount || coupon || lines.some((l) => l.discount))) { setNotice('Exchanges are at full price - remove the discount or coupon.'); return; }
    if (q.needs_approval && !approvalId) { setModal({ kind: 'approval', percent: q.discount_percent }); return; }
    setPayError(null);
    setModal({ kind: 'pay' });
  }

  async function pay(tenders: Tender[]) {
    setPaying(true);
    setPayError(null);
    try {
      if (exchange) {
        const ex = unwrap(await supabase.rpc('pos_exchange', {
          p_shift_id: shift.shift_id, p_order_id: exchange.orderId, p_return_lines: exchange.lines as unknown as Json,
          p_new_lines: toLines(lines) as unknown as Json,
          p_payments: tenders.map(toPayment) as unknown as Json,
          p_idempotency_key: idempotencyKey, p_leftover_method: 'cash', p_customer_id: customer?.id ?? null,
        })) as unknown as ExchangeResult;
        const receipt = unwrap(await supabase.rpc('pos_receipt', { p_order_id: ex.sale.order_id })) as unknown as PosReceipt;
        setModal({ kind: 'done', receipt, change: (ex.sale.change_due ?? 0) + ex.leftover_refunded });
        qc.invalidateQueries({ queryKey: ['till-search'] });
        return;
      }
      const sale = unwrap(await supabase.rpc('pos_sale', {
        p_shift_id: shift.shift_id, p_lines: toLines(lines) as unknown as Json,
        p_payments: tenders.map(toPayment) as unknown as Json,
        p_idempotency_key: idempotencyKey, p_customer_id: customer?.id ?? null,
        p_order_discount: orderDiscount as unknown as Json, p_approval_id: approvalId, p_coupon: coupon,
      })) as unknown as OrderSummary;
      const receipt = unwrap(await supabase.rpc('pos_receipt', { p_order_id: sale.order_id })) as unknown as PosReceipt;
      setModal({ kind: 'done', receipt, change: sale.change_due ?? 0 });
      qc.invalidateQueries({ queryKey: ['till-search'] });
    } catch (e) {
      setPayError(e);
    } finally {
      setPaying(false);
    }
  }

  async function takeReturn(choice: ReturnChoice, method: Enums['payment_method']) {
    setReturnBusy(true);
    setReturnError(null);
    try {
      const ret = unwrap(await supabase.rpc('pos_return', {
        p_shift_id: shift.shift_id, p_order_id: choice.orderId, p_lines: choice.lines as unknown as Json,
        p_refunds: [{ method }] as unknown as Json, p_idempotency_key: newIdempotencyKey('till-ret'),
      })) as unknown as ReturnSummary;
      setModal({ kind: 'refunded', ret, method });
    } catch (e) { setReturnError(e); } finally { setReturnBusy(false); }
  }

  function startExchange(choice: ReturnChoice) {
    setExchange(choice);
    setModal(null);
    setNotice(null);
    focusSearch();
  }

  async function hold() {
    if (!lines.length) return;
    const label = customer?.full_name ?? customer?.phone ?? `Ticket ${new Date().toLocaleTimeString('en-LK', { timeStyle: 'short' })}`;
    try {
      unwrap(await supabase.rpc('pos_hold_sale', { p_shift_id: shift.shift_id, p_lines: toLines(lines) as unknown as Json, p_customer_id: customer?.id ?? null, p_label: label }));
      qc.invalidateQueries({ queryKey: ['held', shift.terminal.id] });
      toast(`Parked: ${label}`);
      newSale();
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Could not park the sale.'); }
  }

  // Keyboard: F2 search, F4 customer, F8 park, F12 pay, Esc closes a dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); focusSearch(); }
      if (e.key === 'F4') { e.preventDefault(); setModal({ kind: 'customer' }); }
      if (e.key === 'F8') { e.preventDefault(); void hold(); }
      if (e.key === 'F12') { e.preventDefault(); startPay(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const held = useQuery({
    queryKey: ['held', shift.terminal.id],
    queryFn: async () => unwrap(await supabase.from('pos_held_sales').select('id, label, lines, customer_id, created_at').eq('terminal_id', shift.terminal.id).order('created_at')),
  });

  async function resume(id: string) {
    if (lines.length) { setNotice('Finish or park the current sale first.'); setModal(null); return; }
    try {
      const r = unwrap(await supabase.rpc('pos_resume_sale', { p_shift_id: shift.shift_id, p_held_id: id })) as unknown as { lines: { variant_id: string; quantity: number; serials?: string[]; discount?: Discount }[]; customer_id: string | null };
      const ids = r.lines.map((l) => l.variant_id);
      const variants = unwrap(await supabase.from('product_variants').select('id, title, sku, price, products(name, tracking_mode, unit_of_measure, allow_fractional)').in('id', ids));
      setLines(r.lines.flatMap((l) => {
        const v = variants.find((x) => x.id === l.variant_id);
        if (!v || !v.products) return [];
        return [{
          key: crypto.randomUUID(), variantId: v.id, name: v.products.name, variant: v.title, sku: v.sku, price: v.price,
          tracking: v.products.tracking_mode, unit: v.products.unit_of_measure, fractional: v.products.allow_fractional,
          quantity: l.quantity, serials: l.serials, discount: l.discount,
        }];
      }));
      if (r.customer_id) {
        const c = unwrap(await supabase.from('customers').select('id, full_name, phone, store_credit_balance, loyalty_points').eq('id', r.customer_id).single());
        setCustomer(c as Customer);
      }
      qc.invalidateQueries({ queryKey: ['held', shift.terminal.id] });
      setModal(null);
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Could not resume.'); setModal(null); }
  }

  const loyalty = org.modules.includes('loyalty');
  const promotions = org.modules.includes('promotions') && !exchange;
  const quoteLine = (l: TicketLine) => q?.lines.find((x) => x.variant_id === l.variantId);
  const shortOf = (l: TicketLine) => {
    const available = q?.stock[l.variantId];
    const wanted = lines.filter((x) => x.variantId === l.variantId).reduce((s, x) => s + x.quantity, 0);
    return available !== undefined && wanted > available ? available : null;
  };

  return (
    <div className="flex h-full flex-col bg-bg">
      {/* Top bar */}
      <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{org.name} · {shift.terminal.name}</div>
          <div className="truncate text-xs text-muted">{shift.cashier} · {shift.number} · since {dateTime(shift.opened_at)}</div>
        </div>
        <nav className="ml-auto flex flex-wrap items-center gap-1">
          <Button variant="ghost" size="sm" icon={<Clock className="size-4" />} onClick={() => setModal({ kind: 'held' })}>
            Parked{held.data?.length ? <Badge tone="accent">{held.data.length}</Badge> : null}
          </Button>
          <Button variant="ghost" size="sm" icon={<Undo2 className="size-4" />} disabled={!!exchange} onClick={() => { setReturnError(null); setModal({ kind: 'return' }); }}>Return / exchange</Button>
          <Button variant="ghost" size="sm" icon={<ArrowDownUp className="size-4" />} onClick={() => setModal({ kind: 'cash' })}>Cash in/out</Button>
          <Button variant="ghost" size="sm" icon={<ReceiptText className="size-4" />} onClick={async () => {
            setShift(unwrap(await supabase.rpc('pos_shift_summary', { p_shift_id: shift.shift_id })) as unknown as ShiftSummary);
            setModal({ kind: 'report' });
          }}>X report</Button>
          <Button variant="ghost" size="sm" onClick={async () => {
            setShift(unwrap(await supabase.rpc('pos_shift_summary', { p_shift_id: shift.shift_id })) as unknown as ShiftSummary);
            setModal({ kind: 'close' });
          }}>Close shift</Button>
          <Button variant="ghost" size="sm" icon={<LogOut className="size-4" />} onClick={() => supabase.auth.signOut()} title="Sign out (the shift stays open)">Sign out</Button>
        </nav>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_26rem]">
        {/* Products */}
        <section className="flex min-h-0 flex-col p-4">
          <form onSubmit={(e) => { e.preventDefault(); void scan(); }} className="relative">
            <Barcode className="pointer-events-none absolute left-3 top-3.5 size-5 text-faint" />
            <Input ref={searchRef} autoFocus className="h-12 pl-11 text-base" placeholder="Scan a barcode, or type a name or SKU (F2)"
              value={search} onChange={(e) => { setSearch(e.target.value); setNotice(null); }} />
          </form>
          {notice && <p role="alert" className="mt-2 text-sm text-danger">{notice}</p>}
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
            {products.data?.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted">{term ? 'No products match.' : 'No products are on sale yet.'}</p>
            ) : (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                {products.data?.map((v) => (
                  <li key={v.variant_id}>
                    <button onClick={() => { addHit(v); focusSearch(); }} disabled={v.available !== null && v.available <= 0}
                      className="flex h-24 w-full flex-col justify-between rounded-lg border border-border bg-surface p-3 text-left enabled:hover:border-accent disabled:opacity-50">
                      <span className="line-clamp-2 text-sm font-medium leading-tight">{v.product_name}{v.variant_title !== 'Default' && <span className="font-normal text-muted"> · {v.variant_title}</span>}</span>
                      <span className="flex items-end justify-between gap-2">
                        <span className="num text-sm font-semibold">{money(v.price, cur)}</span>
                        <span className="num text-xs text-muted">{v.available === null ? '' : v.available > 0 ? qty(v.available, v.unit_of_measure) : 'none'}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Ticket */}
        <section className="flex min-h-0 flex-col border-l border-border bg-surface">
          <button onClick={() => setModal({ kind: 'customer' })} className="flex items-center gap-2 border-b border-border px-4 py-3 text-left text-sm hover:bg-surface-2">
            <User className="size-4 text-muted" />
            {customer ? <span><span className="font-medium">{customer.full_name ?? 'Customer'}</span> <span className="num text-muted">{customer.phone}</span>
              {customer.store_credit_balance > 0 && <span className="ml-2 text-xs text-ok">credit {money(customer.store_credit_balance, cur)}</span>}
              {loyalty && customer.loyalty_points > 0 && <span className="ml-2 text-xs text-accent">{customer.loyalty_points.toLocaleString()} pts</span>}</span>
              : <span className="text-muted">Walk-in customer · add (F4)</span>}
            {customer && <X className="ml-auto size-4 text-muted" onClick={(e) => { e.stopPropagation(); setCustomer(null); }} />}
          </button>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {lines.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center text-sm text-muted">
                <Search className="mb-2 size-6" />Scan or tap a product to start a sale.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {lines.map((l) => {
                  const ql = quoteLine(l);
                  const short = shortOf(l);
                  return (
                    <li key={l.key} className="px-4 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{l.name}</div>
                          <div className="truncate text-xs text-muted">{[l.variant !== 'Default' && l.variant, `${money(l.price, cur)}${l.unit !== 'each' ? `/${l.unit}` : ''}`].filter(Boolean).join(' · ')}</div>
                          {l.serials && <div className="truncate font-mono text-xs text-muted">{l.serials.join(', ')}</div>}
                          {short !== null && <div className="text-xs text-danger">Only {qty(short, l.unit)} on the shelf</div>}
                        </div>
                        <div className="text-right">
                          <div className="num text-sm font-semibold">{money(ql?.line_total ?? l.price * l.quantity, cur)}</div>
                          {(ql?.discount_amount ?? 0) > 0 && <div className="num text-xs text-ok">-{money(ql!.discount_amount, cur)}</div>}
                        </div>
                      </div>
                      <div className="mt-1.5 flex items-center gap-1">
                        {l.tracking === 'serial' ? (
                          <Button size="sm" onClick={() => setModal({ kind: 'serial', hit: { variant_id: l.variantId, product_name: l.name, variant_title: l.variant } as VariantHit, lineKey: l.key })}>
                            {l.quantity} scanned · change</Button>
                        ) : <>
                          <Button size="sm" variant="ghost" aria-label="Less" disabled={l.quantity <= (l.fractional ? 0.001 : 1)} onClick={() => setLine(l.key, { quantity: +(l.quantity - 1).toFixed(3) })}><Minus className="size-4" /></Button>
                          <button className="num min-w-10 rounded px-2 py-1 text-sm hover:bg-surface-2" onClick={() => setModal({ kind: 'qty', lineKey: l.key })}>{qty(l.quantity, l.unit)}</button>
                          <Button size="sm" variant="ghost" aria-label="More" onClick={() => setLine(l.key, { quantity: +(l.quantity + 1).toFixed(3) })}><Plus className="size-4" /></Button>
                        </>}
                        <Button size="sm" variant="ghost" className="ml-auto" icon={<Percent className="size-3.5" />} onClick={() => setModal({ kind: 'discount', lineKey: l.key })}>{l.discount ? `${l.discount.type === 'percent' ? `${l.discount.value}%` : money(l.discount.value, cur)}` : ''}</Button>
                        <Button size="sm" variant="ghost" aria-label="Remove line" onClick={() => removeLine(l.key)}><Trash2 className="size-4" /></Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {exchange && (
            <div className="flex items-center justify-between gap-2 border-t border-border bg-info-soft px-4 py-2 text-sm text-info">
              <span>Exchange: {money(exchange.credit, cur)} credit from {exchange.orderNumber}</span>
              <button className="text-xs underline" onClick={() => setExchange(null)}>cancel exchange</button>
            </div>
          )}
          <div className="border-t border-border p-4">
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between text-muted"><dt>Subtotal</dt><dd className="num">{money(q?.subtotal ?? 0, cur)}</dd></div>
              <div className="flex justify-between text-muted">
                <dt><button className="underline decoration-dotted" onClick={() => setModal({ kind: 'discount', lineKey: null })}>Discount{orderDiscount ? ` (${orderDiscount.type === 'percent' ? `${orderDiscount.value}%` : 'amount'})` : ''}</button></dt>
                <dd className="num">{q?.discount_total ? `-${money(q.discount_total, cur)}` : '-'}</dd>
              </div>
              {q?.promotions.map((p) => (
                <div key={p.name} className="flex justify-between text-xs text-ok"><dt className="truncate pr-2">{p.name}</dt><dd className="num">-{money(p.amount, cur)}</dd></div>
              ))}
              {promotions && (
                <div className="flex justify-between text-muted">
                  <dt><button className="inline-flex items-center gap-1 underline decoration-dotted" onClick={() => setModal({ kind: 'coupon' })}>
                    <Tag className="size-3.5" />{coupon ? `Coupon ${coupon}` : 'Add coupon'}</button></dt>
                  <dd>{coupon && <button className="text-xs underline" onClick={() => setCoupon(null)}>remove</button>}</dd>
                </div>
              )}
              {q && !q.tax_inclusive && <div className="flex justify-between text-muted"><dt>Tax</dt><dd className="num">{money(q.tax_total, cur)}</dd></div>}
              <div className="flex items-baseline justify-between pt-1"><dt className="text-base font-semibold">Total</dt><dd className="num text-2xl font-bold">{money(q?.total ?? 0, cur)}</dd></div>
              {exchange && q && <div className="flex items-baseline justify-between font-semibold">
                <dt>{q.total >= exchange.credit ? 'Customer pays' : 'Give back'}</dt>
                <dd className="num text-lg">{money(Math.abs(q.total - exchange.credit), cur)}</dd></div>}
              {q?.tax_inclusive && q.tax_total > 0 && <div className="text-right text-xs text-muted">incl. {money(q.tax_total, cur)} tax</div>}
            </dl>
            {quote.error && <div className="mt-2"><ErrorNote error={quote.error} /></div>}
            {q?.needs_approval && <p className="mt-2 text-xs text-warn">{q.discount_percent}% off is above your {q.my_discount_limit}% limit{approvalId ? ' - approved.' : ' - a manager will be asked.'}</p>}
            <div className="mt-3 grid grid-cols-[auto_1fr] gap-2">
              <Button className="h-14" icon={<Pause className="size-4" />} disabled={!lines.length} onClick={hold}>Park (F8)</Button>
              <Button variant="primary" className="h-14 text-lg" disabled={!lines.length || !q || quote.isFetching || !!quote.error} onClick={startPay}>{exchange ? 'Complete exchange' : `Pay ${q ? money(q.total, cur) : ''}`} (F12)</Button>
            </div>
          </div>
        </section>
      </div>

      {/* Dialogs */}
      {modal?.kind === 'serial' && (
        <SerialDialog line={{ name: modal.hit.product_name!, variant: modal.hit.variant_title ?? 'Default', variantId: modal.hit.variant_id!, serials: modal.lineKey ? lines.find((l) => l.key === modal.lineKey)?.serials : undefined }}
          locationId={locationId.current ?? ''} onClose={() => { setModal(null); focusSearch(); }}
          onDone={(serials) => {
            if (modal.lineKey) setLine(modal.lineKey, { serials, quantity: serials.length });
            else addHit(modal.hit, serials);
            setModal(null); setSearch(''); focusSearch();
          }} />
      )}
      {modal?.kind === 'customer' && <CustomerDialog orgId={org.id} onClose={() => { setModal(null); focusSearch(); }} onPick={(c) => { setCustomer(c); setModal(null); focusSearch(); }} />}
      {modal?.kind === 'discount' && (
        <DiscountDialog current={modal.lineKey ? lines.find((l) => l.key === modal.lineKey)?.discount ?? null : orderDiscount} currency={cur}
          title={modal.lineKey ? `Discount on ${lines.find((l) => l.key === modal.lineKey)?.name}` : 'Discount on the whole sale'}
          onClose={() => setModal(null)}
          onApply={(d) => { if (modal.lineKey) setLine(modal.lineKey, { discount: d ?? undefined }); else setOrderDiscount(d); setModal(null); }} />
      )}
      {modal?.kind === 'coupon' && <CouponDialog current={coupon} onClose={() => setModal(null)} onApply={(c) => { setCoupon(c); setModal(null); focusSearch(); }} />}
      {modal?.kind === 'qty' && (() => {
        const l = lines.find((x) => x.key === modal.lineKey)!;
        return <QtyDialog line={l} onClose={() => setModal(null)} onApply={(n) => { setLine(l.key, { quantity: n }); setModal(null); }} />;
      })()}
      {modal?.kind === 'approval' && <ApprovalDialog orgId={org.id} percent={modal.percent} onClose={() => setModal(null)}
        onApproved={(id) => { setApprovalId(id); setPayError(null); setModal({ kind: 'pay' }); }} />}
      {modal?.kind === 'pay' && q && (
        <PayDialog orgId={org.id} total={exchange ? Math.max(q.total - exchange.credit, 0) : q.total} currency={cur}
          credit={customer ? customer.store_credit_balance : null} giftCards={loyalty}
          points={loyalty && customer ? { balance: customer.loyalty_points, value: Number(org.settings.loyalty_point_value ?? 1), min: Number(org.settings.loyalty_min_redeem ?? 0) } : null}
          busy={paying} error={payError}
          onClose={() => setModal(null)} onPay={pay} />
      )}
      {modal?.kind === 'done' && (
        <Dialog open onClose={newSale} title="Sale complete" footer={<>
          <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>Print receipt</Button>
          <Button variant="primary" data-autofocus onClick={newSale}>New sale (Enter)</Button></>}>
          <div className="text-center">
            <div className="text-sm text-muted">{modal.receipt.number}</div>
            {modal.change > 0 ? <><div className="mt-2 text-sm">Change due</div><div className="num text-5xl font-bold text-ok">{money(modal.change, cur)}</div></>
              : <div className="mt-2 text-2xl font-semibold">Paid in full</div>}
          </div>
          {modal.receipt.gift_cards.length > 0 && (
            <div className="mt-4 rounded-lg border border-accent/30 bg-accent-soft p-3 text-sm">
              <div className="mb-1 flex items-center gap-1.5 font-medium"><Gift className="size-4" />Gift card{modal.receipt.gift_cards.length > 1 ? 's' : ''} issued</div>
              {modal.receipt.gift_cards.map((g) => (
                <div key={g.code} className="flex justify-between"><span className="font-mono">{g.code}</span><span className="num">{money(g.value, cur)}</span></div>
              ))}
              <p className="mt-1 text-xs text-muted">The codes are printed on the receipt. Hand it to the customer.</p>
            </div>
          )}
          {modal.receipt.points_earned ? (
            <p className="mt-3 text-center text-sm text-muted">{modal.receipt.customer?.name ?? 'The customer'} earned <span className="font-semibold text-text">{modal.receipt.points_earned.toLocaleString()} points</span> · now {modal.receipt.customer?.loyalty_points.toLocaleString()}</p>
          ) : null}
        </Dialog>
      )}
      {modal?.kind === 'done' && <div className="fixed left-[-9999px] top-0"><Receipt r={modal.receipt} /></div>}
      {modal?.kind === 'held' && (
        <Dialog open onClose={() => setModal(null)} title="Parked sales" description="Parked sales keep their items but don't hold stock; prices are checked again when you resume.">
          {!held.data?.length ? <p className="text-sm text-muted">Nothing parked on this till.</p> : (
            <ul className="divide-y divide-border">
              {held.data.map((h) => (
                <li key={h.id}><button className="flex w-full items-center justify-between py-3 text-left text-sm hover:bg-surface-2" onClick={() => resume(h.id)}>
                  <span className="font-medium">{h.label ?? 'Parked sale'}</span>
                  <span className="text-muted">{(h.lines as unknown[]).length} line{(h.lines as unknown[]).length === 1 ? '' : 's'} · {dateTime(h.created_at)}</span>
                </button></li>
              ))}
            </ul>
          )}
        </Dialog>
      )}
      {modal?.kind === 'return' && (
        <ReturnDialog orgId={org.id} currency={cur} busy={returnBusy} error={returnError}
          onClose={() => setModal(null)} onRefund={takeReturn} onExchange={startExchange} />
      )}
      {modal?.kind === 'refunded' && (
        <Dialog open onClose={newSale} title="Return taken" footer={<Button variant="primary" data-autofocus onClick={newSale}>Done</Button>}>
          <div className="text-center">
            <div className="text-sm text-muted">{modal.ret.number} · from {modal.ret.order_number}</div>
            <div className="mt-2 text-sm">{modal.method === 'cash' ? 'Give the customer' : modal.method === 'store_credit' ? 'Added to store credit' : 'Refunded to card'}</div>
            <div className="num text-5xl font-bold text-ok">{money(modal.ret.refund_total, cur)}</div>
            <p className="mt-3 text-sm text-muted">The items wait for inspection before they go back on sale.</p>
          </div>
        </Dialog>
      )}
      {modal?.kind === 'cash' && <CashDialog shiftId={shift.shift_id} currency={cur} onClose={() => setModal(null)} onDone={(s) => { setShift(s); setModal(null); toast('Cash movement recorded'); }} />}
      {modal?.kind === 'report' && (
        <Dialog open onClose={() => setModal(null)} title="X report (shift so far)">
          <ShiftReport s={shift} currency={cur} />
        </Dialog>
      )}
      {modal?.kind === 'close' && (
        lines.length > 0
          ? <Dialog open onClose={() => setModal(null)} title="Finish the current sale first"><p className="text-sm text-muted">Complete or park the sale on screen before closing the shift.</p></Dialog>
          : <CloseShiftDialog shift={shift} currency={cur} onClose={() => setModal(null)} onClosed={(z) => setModal({ kind: 'z', summary: z })} />
      )}
      {modal?.kind === 'z' && (
        <Dialog open onClose={onShiftClosed} title="Shift closed (Z report)" footer={<>
          <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>Print</Button>
          <Button variant="primary" onClick={onShiftClosed}>Done</Button></>}>
          <div className="print-area"><ShiftReport s={modal.summary} currency={cur} /></div>
        </Dialog>
      )}
    </div>
  );
}

const toPayment = (t: Tender) => ({ method: t.method, amount: t.amount, ...(t.reference ? { reference: t.reference } : {}), ...(t.code ? { code: t.code } : {}) });

function CouponDialog({ current, onClose, onApply }: { current: string | null; onClose: () => void; onApply: (code: string | null) => void }) {
  const [value, setValue] = useState(current ?? '');
  const code = value.trim().toUpperCase();
  return (
    <Dialog open onClose={onClose} title="Coupon code" description="The totals update once the code is checked. A code that doesn't apply shows why."
      footer={<>{current && <Button variant="danger" onClick={() => onApply(null)}>Remove</Button>}<Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={code.length < 3} onClick={() => onApply(code)}>Apply</Button></>}>
      <Input autoFocus className="h-12 font-mono text-lg uppercase" value={value} onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && code.length >= 3) onApply(code); }} />
    </Dialog>
  );
}

function DiscountDialog({ current, currency, title, onClose, onApply }: {
  current: Discount | null; currency: string; title: string; onClose: () => void; onApply: (d: Discount | null) => void;
}) {
  const [type, setType] = useState<Discount['type']>(current?.type ?? 'percent');
  const [value, setValue] = useState(current ? String(current.value) : '');
  const [error, setError] = useState<string | null>(null);
  function apply() {
    const v = Number(value);
    if (!(v > 0) || (type === 'percent' && v > 100)) { setError(type === 'percent' ? 'Between 0 and 100%.' : 'More than zero.'); return; }
    onApply({ type, value: v });
  }
  return (
    <Dialog open onClose={onClose} title={title}
      footer={<>{current && <Button variant="danger" onClick={() => onApply(null)}>Remove discount</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={apply}>Apply</Button></>}>
      <div className="grid grid-cols-2 gap-2">
        {(['percent', 'amount'] as const).map((t) => (
          <button key={t} onClick={() => setType(t)} className={`h-11 rounded-md border text-sm ${type === t ? 'border-accent bg-accent-soft font-semibold text-accent' : 'border-border'}`}>{t === 'percent' ? 'Percent' : `Amount (${currency})`}</button>
        ))}
      </div>
      <Field label={type === 'percent' ? 'Percent off' : 'Amount off'} className="mt-4">
        <Input autoFocus className="h-12 text-lg" type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') apply(); }} />
      </Field>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      <p className="mt-3 text-xs text-muted">Discounts above your limit need a manager's PIN at payment.</p>
    </Dialog>
  );
}

function QtyDialog({ line, onClose, onApply }: { line: TicketLine; onClose: () => void; onApply: (n: number) => void }) {
  const [value, setValue] = useState(String(line.quantity));
  const n = Number(value);
  const ok = n > 0 && (line.fractional || Number.isInteger(n));
  return (
    <Dialog open onClose={onClose} title={`Quantity · ${line.name}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ok} onClick={() => onApply(n)}>Set</Button></>}>
      <Field label={line.fractional ? `How many ${line.unit} (e.g. 1.25)` : 'How many'} hint={!ok && value ? (line.fractional ? 'More than zero.' : 'Whole numbers only.') : undefined}>
        <Input autoFocus className="h-12 text-lg" type="number" min="0" step={line.fractional ? '0.001' : '1'} value={value}
          onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && ok) onApply(n); }} />
      </Field>
    </Dialog>
  );
}
