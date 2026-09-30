'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Minus, Plus, Trash2 } from 'lucide-react';
import type { Enums } from '@nws-commerce/db';
import type { Store } from '@/lib/store';
import { useCart } from '@/lib/cart';
import { useCoupon, useQuote } from '@/lib/useQuote';
import { money, qty } from '@/lib/format';
import { ProductImage } from './ProductImage';
import { Totals } from './Totals';
import { CouponBox } from './CouponBox';

export function CartView({ store }: { store: Store }) {
  const { cart, ready, setItem } = useCart();
  const [method, setMethod] = useState<Enums['fulfilment_method']>(store.delivery_enabled ? 'delivery' : 'pickup');
  const [error, setError] = useState<string | null>(null);
  const [coupon, setCoupon] = useCoupon();
  const { quote, error: quoteError, couponError } = useQuote(store.id, cart, method, store.coupons_enabled ? coupon : null);

  async function change(variantId: string, quantity: number) {
    setError(null);
    try { await setItem(variantId, quantity); } catch (e) { setError(e instanceof Error ? e.message : 'Could not update the cart.'); }
  }

  if (!ready) return <p className="py-20 text-center text-ink-2">Loading your cart...</p>;
  if (cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <h1 className="text-xl font-semibold">Your cart is empty</h1>
        <Link href="/search" className="mt-6 inline-flex h-11 items-center rounded-md bg-brand px-5 text-sm font-medium text-brand-fg">Start shopping</Link>
      </div>
    );
  }
  const problems = cart.items.filter((i) => !i.for_sale || i.quantity > i.available);

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_22rem]">
      <div>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Cart</h1>
        {error && <p role="alert" className="mb-4 text-sm text-danger">{error}</p>}
        <ul className="divide-y divide-line border-y border-line">
          {cart.items.map((i) => {
            const step = i.allow_fractional ? 0.25 : 1;
            return (
              <li key={i.variant_id} className="flex gap-4 py-4">
                <Link href={`/p/${i.slug}`} className="w-20 shrink-0"><ProductImage path={i.image} name={i.name} sizes="sm" /></Link>
                <div className="min-w-0 flex-1">
                  <Link href={`/p/${i.slug}`} className="font-medium hover:underline">{i.name}</Link>
                  {i.variant !== 'Default' && <div className="text-sm text-ink-2">{i.variant}</div>}
                  <div className="num text-sm text-ink-2">{money(i.unit_price, store.currency_code)}{i.unit_of_measure !== 'each' ? ` / ${i.unit_of_measure}` : ''}</div>
                  {!i.for_sale ? <p className="mt-1 text-sm text-danger">No longer sold - please remove it.</p>
                    : i.quantity > i.available ? <p className="mt-1 text-sm text-danger">Only {qty(i.available, i.unit_of_measure)} available now.</p> : null}
                  <div className="mt-2 flex items-center gap-3">
                    <div className="flex h-9 items-center rounded-md border border-line bg-surface">
                      <button className="grid size-9 place-items-center text-ink-2 disabled:opacity-40" aria-label="Less" disabled={i.quantity <= step}
                        onClick={() => change(i.variant_id, +(i.quantity - step).toFixed(3))}><Minus className="size-3.5" /></button>
                      <span className="num w-12 text-center text-sm">{qty(i.quantity)}</span>
                      <button className="grid size-9 place-items-center text-ink-2" aria-label="More"
                        onClick={() => change(i.variant_id, +(i.quantity + step).toFixed(3))}><Plus className="size-3.5" /></button>
                    </div>
                    <button className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-danger" onClick={() => change(i.variant_id, 0)}>
                      <Trash2 className="size-4" /> Remove
                    </button>
                  </div>
                </div>
                <div className="num text-right text-sm font-semibold">{money(i.line_total, store.currency_code)}</div>
              </li>
            );
          })}
        </ul>
      </div>

      <aside className="h-fit rounded-lg border border-line bg-surface p-5 lg:sticky lg:top-4">
        {store.delivery_enabled && store.pickup_enabled && (
          <div className="mb-5 grid grid-cols-2 gap-2 text-sm" role="radiogroup" aria-label="How you'll get it">
            {(['delivery', 'pickup'] as const).map((m) => (
              <button key={m} role="radio" aria-checked={method === m} onClick={() => setMethod(m)}
                className={`rounded-md border px-3 py-2 ${method === m ? 'border-ink font-medium' : 'border-line text-ink-2'}`}>
                {m === 'delivery' ? 'Delivery' : 'Collect in store'}
              </button>
            ))}
          </div>
        )}
        {quote ? <Totals quote={quote} currency={store.currency_code} /> : quoteError ? <p className="text-sm text-danger">{quoteError}</p> : <p className="text-sm text-ink-2">Working out your total...</p>}
        {store.coupons_enabled && <div className="mt-4"><CouponBox coupon={coupon} applied={!!quote} error={couponError} onChange={setCoupon} /></div>}
        {method === 'delivery' && store.free_delivery_over && quote && quote.shipping_total > 0 && (
          <p className="mt-3 text-xs text-ink-2">Spend {money(store.free_delivery_over - (quote.total - quote.shipping_total), store.currency_code)} more for free delivery.</p>
        )}
        <Link href={problems.length ? '#' : `/checkout?method=${method}`} aria-disabled={problems.length > 0}
          className={`mt-5 flex h-11 items-center justify-center rounded-md bg-brand text-sm font-medium text-brand-fg ${problems.length ? 'pointer-events-none opacity-40' : ''}`}>
          Checkout
        </Link>
        {problems.length > 0 && <p className="mt-2 text-xs text-danger">Fix the items marked above to continue.</p>}
      </aside>
    </div>
  );
}
