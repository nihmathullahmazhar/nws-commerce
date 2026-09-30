'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, Minus, Plus } from 'lucide-react';
import type { ProductPage } from '@nws-commerce/db';
import { useCart } from '@/lib/cart';
import { browserClient } from '@/lib/supabase';
import { money, qty } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Price } from './Price';

type Variant = ProductPage['variants'][number];

export function ProductBuy({ product, orgId, currency }: { product: ProductPage; orgId: string; currency: string }) {
  const { cart, setItem } = useCart();
  const [live, setLive] = useState<Record<string, number>>(() => Object.fromEntries(product.variants.map((v) => [v.id, v.available])));
  const firstInStock = product.variants.find((v) => v.available > 0) ?? product.variants[0];
  const [selected, setSelected] = useState<string[]>(firstInStock?.option_values ?? []);
  const [amount, setAmount] = useState(product.allow_fractional ? '1' : '1');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // The page may be cached for a few seconds; ask for stock again now.
  useEffect(() => {
    browserClient().rpc('storefront_availability', { p_organization_id: orgId, p_variant_ids: product.variants.map((v) => v.id) })
      .then(({ data }) => { if (data) setLive(Object.fromEntries(data.map((r) => [r.variant_id!, Number(r.available ?? 0)]))); });
  }, [orgId, product.variants]);

  const variant: Variant | undefined = useMemo(() => {
    if (product.options.length === 0) return product.variants[0];
    return product.variants.find((v) => (v.option_values ?? []).every((x, i) => x === selected[i]));
  }, [product, selected]);

  const available = variant ? live[variant.id] ?? 0 : 0;
  const inCart = variant ? cart.items.find((i) => i.variant_id === variant.id)?.quantity ?? 0 : 0;
  const step = product.allow_fractional ? 0.25 : 1;
  const n = Number(amount);

  function valueAvailable(optionIndex: number, value: string) {
    return product.variants.some((v) => {
      const vals = v.option_values ?? [];
      return vals[optionIndex] === value && vals.every((x, i) => i === optionIndex || x === selected[i]) && (live[v.id] ?? 0) > 0;
    });
  }

  async function add() {
    if (!variant) return;
    setBusy(true);
    setMessage(null);
    try {
      await setItem(variant.id, inCart + n);
      setMessage({ ok: true, text: 'Added to your cart.' });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'Could not add to cart.' });
    } finally {
      setBusy(false);
    }
  }

  const canAdd = !!variant && available > 0 && n > 0 && inCart + n <= available;

  return (
    <div className="space-y-6">
      {variant ? <Price min={variant.price} compareAt={variant.compare_at_price} currency={currency} size="lg" />
        : <span className="text-ink-2">This combination isn&apos;t available.</span>}

      {product.options.map((o, i) => (
        <fieldset key={o.name}>
          <legend className="mb-2 text-sm font-medium text-ink">{o.name}{selected[i] && <span className="font-normal text-ink-2">: {selected[i]}</span>}</legend>
          <div className="flex flex-wrap gap-2">
            {o.values.map((value) => {
              const active = selected[i] === value;
              const stocked = valueAvailable(i, value);
              return (
                <button key={value} type="button" aria-pressed={active}
                  onClick={() => { setSelected((s) => s.map((x, j) => (j === i ? value : x))); setMessage(null); }}
                  className={cn('min-w-11 rounded-md border px-3 py-2 text-sm',
                    active ? 'border-ink bg-ink text-bg' : 'border-line bg-surface text-ink hover:border-ink',
                    !stocked && !active && 'text-ink-3 line-through decoration-ink-3')}>
                  {value}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}

      <div className="text-sm">
        {!variant ? null : available <= 0 ? <span className="font-medium text-danger">Sold out</span>
          : available <= 3 ? <span className="font-medium text-warn">Only {qty(available, product.unit_of_measure)} left</span>
          : <span className="inline-flex items-center gap-1 font-medium text-ok"><Check className="size-4" /> In stock</span>}
        {variant?.sku && <span className="ml-3 text-ink-3">SKU {variant.sku}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-11 items-center rounded-md border border-line bg-surface">
          <button type="button" className="grid size-11 place-items-center text-ink-2 disabled:opacity-40" aria-label="Less"
            disabled={n <= step} onClick={() => setAmount(String(Math.max(step, +(n - step).toFixed(3))))}><Minus className="size-4" /></button>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-label="Quantity"
            className="num h-full w-14 bg-transparent text-center text-sm focus:outline-none" />
          <button type="button" className="grid size-11 place-items-center text-ink-2" aria-label="More"
            onClick={() => setAmount(String(+(n + step).toFixed(3)))}><Plus className="size-4" /></button>
        </div>
        {product.unit_of_measure !== 'each' && <span className="text-sm text-ink-2">{product.unit_of_measure}</span>}
        <button type="button" onClick={add} disabled={!canAdd || busy}
          className="h-11 flex-1 rounded-md bg-brand px-6 text-sm font-medium text-brand-fg disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none">
          {busy ? 'Adding...' : available <= 0 ? 'Sold out' : 'Add to cart'}
        </button>
      </div>
      {variant && inCart > 0 && inCart + n > available && available > 0 && (
        <p className="text-sm text-warn">You already have {qty(inCart, product.unit_of_measure)} in your cart - that&apos;s all we have.</p>
      )}
      {message && (
        <p role="status" className={cn('text-sm', message.ok ? 'text-ok' : 'text-danger')}>
          {message.text} {message.ok && <Link href="/cart" className="font-medium underline">View cart ({money(cart.subtotal, currency)})</Link>}
        </p>
      )}
    </div>
  );
}
