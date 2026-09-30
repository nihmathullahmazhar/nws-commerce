'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { describeDbError, type Enums, type OrderSummary } from '@nws-commerce/db';
import type { Store } from '@/lib/store';
import { useCart } from '@/lib/cart';
import { useCoupon, useQuote } from '@/lib/useQuote';
import { browserClient } from '@/lib/supabase';
import { normalisePhone } from '@/lib/phone';
import { money, qty } from '@/lib/format';
import { Totals } from './Totals';
import { CouponBox } from './CouponBox';

const input = 'h-11 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink focus:border-ink focus:outline-none';

export function CheckoutView({ store }: { store: Store }) {
  const router = useRouter();
  const params = useSearchParams();
  const { cart, ready, clear } = useCart();
  const initialMethod = params.get('method') === 'pickup' || !store.delivery_enabled ? 'pickup' : 'delivery';
  const [method, setMethod] = useState<Enums['fulfilment_method']>(initialMethod);
  const payOptions = ([
    store.allow_cash_on_delivery && 'cash_on_delivery',
    store.bank_transfer_details && 'bank_transfer',
    store.online_payments_enabled && 'online_gateway',
  ].filter(Boolean)) as Enums['payment_method'][];
  const [pay, setPay] = useState<Enums['payment_method'] | undefined>(payOptions[0]);
  const [form, setForm] = useState({ full_name: '', phone: '', email: '', line1: '', line2: '', city: '', postcode: '', note: '' });
  // One key per checkout attempt: a double click or a retry cannot create two orders.
  const [idempotencyKey] = useState(() => `web-${crypto.randomUUID()}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coupon, setCoupon] = useCoupon();
  const { quote, error: quoteError, couponError } = useQuote(store.id, cart, method, store.coupons_enabled ? coupon : null);

  useEffect(() => {
    browserClient().auth.getSession().then(({ data }) => {
      const email = data.session?.user.email;
      if (email) setForm((f) => ({ ...f, email: f.email || email }));
    });
  }, []);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const phone = normalisePhone(form.phone);
    if (!phone) { setError('Please give a phone number we can reach you on, e.g. 077 123 4567.'); return; }
    if (!pay) { setError('This store has no payment method set up yet.'); return; }
    setBusy(true);
    setError(null);
    const { data, error } = await browserClient().rpc('checkout', {
      p_organization_id: store.id,
      p_lines: cart.items.filter((i) => i.for_sale).map((i) => ({ variant_id: i.variant_id, quantity: i.quantity })),
      p_idempotency_key: idempotencyKey,
      p_contact: { full_name: form.full_name.trim(), phone, email: form.email.trim() || null },
      p_fulfilment: method === 'delivery'
        ? { method, address: { line1: form.line1.trim(), line2: form.line2.trim() || null, city: form.city.trim(), postcode: form.postcode.trim() || null } }
        : { method },
      p_payment_method: pay,
      p_note: form.note.trim() || null,
      p_coupon: store.coupons_enabled && coupon && !couponError ? coupon : null,
    });
    if (error) {
      setBusy(false);
      setError(error.code === 'NC001' ? `${describeDbError(error)} Someone may have just bought it - please check your cart.` : describeDbError(error));
      return;
    }
    const order = data as unknown as OrderSummary;
    setCoupon(null);
    try {
      const mine = JSON.parse(localStorage.getItem('nwsc-orders') ?? '[]') as { id: string; token: string; number: string }[];
      localStorage.setItem('nwsc-orders', JSON.stringify([{ id: order.order_id, token: order.access_token, number: order.number }, ...mine].slice(0, 20)));
    } catch { /* storage blocked: the confirmation link still works */ }
    await clear();
    router.push(`/order/${order.order_id}?t=${order.access_token}`);
  }

  if (!ready) return <p className="py-20 text-center text-ink-2">Loading...</p>;
  if (cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <h1 className="text-xl font-semibold">Nothing to check out</h1>
        <Link href="/search" className="mt-6 inline-flex h-11 items-center rounded-md bg-brand px-5 text-sm font-medium text-brand-fg">Browse products</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-10 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-8">
        <h1 className="text-2xl font-semibold tracking-tight">Checkout</h1>

        <section className="space-y-3">
          <h2 className="font-semibold">Your details</h2>
          <input required className={input} placeholder="Full name" autoComplete="name" value={form.full_name} onChange={set('full_name')} />
          <div className="grid gap-3 sm:grid-cols-2">
            <input required className={input} placeholder="Mobile number" inputMode="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} />
            <input className={input} type="email" placeholder="Email (for your receipt)" autoComplete="email" value={form.email} onChange={set('email')} />
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold">How you&apos;ll get it</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {store.delivery_enabled && (
              <label className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${method === 'delivery' ? 'border-ink' : 'border-line'}`}>
                <input type="radio" name="method" checked={method === 'delivery'} onChange={() => setMethod('delivery')} className="mt-1 accent-[var(--brand)]" />
                <span><span className="block text-sm font-medium">Delivery</span><span className="text-xs text-ink-2">{store.delivery_fee ? money(store.delivery_fee, store.currency_code) : 'Free'}{store.free_delivery_over ? `, free over ${money(store.free_delivery_over, store.currency_code)}` : ''}</span></span>
              </label>
            )}
            {store.pickup_enabled && (
              <label className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${method === 'pickup' ? 'border-ink' : 'border-line'}`}>
                <input type="radio" name="method" checked={method === 'pickup'} onChange={() => setMethod('pickup')} className="mt-1 accent-[var(--brand)]" />
                <span><span className="block text-sm font-medium">Collect in store</span><span className="text-xs text-ink-2">Free{store.pickup_locations[0] ? ` - ${store.pickup_locations[0].name}` : ''}</span></span>
              </label>
            )}
          </div>
          {method === 'delivery' && (
            <div className="space-y-3">
              <input required className={input} placeholder="Street address" autoComplete="address-line1" value={form.line1} onChange={set('line1')} />
              <input className={input} placeholder="Apartment, landmark (optional)" autoComplete="address-line2" value={form.line2} onChange={set('line2')} />
              <div className="grid gap-3 sm:grid-cols-2">
                <input required className={input} placeholder="City" autoComplete="address-level2" value={form.city} onChange={set('city')} />
                <input className={input} placeholder="Postcode (optional)" autoComplete="postal-code" value={form.postcode} onChange={set('postcode')} />
              </div>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold">Payment</h2>
          {payOptions.length === 0 ? <p className="text-sm text-danger">This store has not set up a way to pay yet.</p> : (
            <div className="space-y-2">
              {payOptions.map((p) => (
                <label key={p} className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${pay === p ? 'border-ink' : 'border-line'}`}>
                  <input type="radio" name="pay" checked={pay === p} onChange={() => setPay(p)} className="mt-1 accent-[var(--brand)]" />
                  <span className="text-sm">
                    <span className="block font-medium">{p === 'cash_on_delivery' ? (method === 'pickup' ? 'Pay when you collect' : 'Pay on delivery') : p === 'bank_transfer' ? 'Bank transfer' : 'Pay online by card'}</span>
                    <span className="text-xs text-ink-2">
                      {p === 'cash_on_delivery' && 'Cash or card when your order arrives.'}
                      {p === 'bank_transfer' && 'We hold your items while you transfer; the details come on the next page.'}
                      {p === 'online_gateway' && 'You will be sent to our secure payment page.'}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <textarea className={`${input} h-20 py-2`} placeholder="Note for the shop (optional)" value={form.note} onChange={set('note')} />
        </section>
      </div>

      <aside className="h-fit space-y-4 rounded-lg border border-line bg-surface p-5 lg:sticky lg:top-4">
        <h2 className="font-semibold">Order summary</h2>
        <ul className="space-y-2 text-sm">
          {cart.items.filter((i) => i.for_sale).map((i) => (
            <li key={i.variant_id} className="flex justify-between gap-3">
              <span className="text-ink-2">{qty(i.quantity, i.unit_of_measure)} x {i.name}{i.variant !== 'Default' ? ` (${i.variant})` : ''}</span>
              <span className="num">{money(i.line_total, store.currency_code)}</span>
            </li>
          ))}
        </ul>
        <div className="border-t border-line pt-4">
          {quote ? <Totals quote={quote} currency={store.currency_code} /> : <p className="text-sm text-ink-2">{quoteError ?? 'Working out your total...'}</p>}
          {store.coupons_enabled && <div className="mt-4"><CouponBox coupon={coupon} applied={!!quote} error={couponError} onChange={setCoupon} /></div>}
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button type="submit" disabled={busy || !pay || !quote}
          className="h-11 w-full rounded-md bg-brand text-sm font-medium text-brand-fg disabled:opacity-40">
          {busy ? 'Placing your order...' : quote ? `Place order - ${money(quote.total, store.currency_code)}` : 'Place order'}
        </button>
        <p className="text-xs text-ink-3">Your items are checked against live stock when you place the order.</p>
      </aside>
    </form>
  );
}
