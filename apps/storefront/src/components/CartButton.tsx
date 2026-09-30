'use client';

import Link from 'next/link';
import { ShoppingBag } from 'lucide-react';
import { useCart } from '@/lib/cart';

export function CartButton() {
  const { cart, ready } = useCart();
  const count = Math.round(cart.count);
  return (
    <Link href="/cart" className="relative inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-ink hover:bg-tile" aria-label={`Cart, ${count} item${count === 1 ? '' : 's'}`}>
      <ShoppingBag className="size-5" />
      <span className="hidden sm:inline">Cart</span>
      {ready && count > 0 && (
        <span className="num absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-brand px-1 text-[11px] font-semibold text-brand-fg">{count}</span>
      )}
    </Link>
  );
}
