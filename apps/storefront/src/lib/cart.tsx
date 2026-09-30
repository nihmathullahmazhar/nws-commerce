'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { describeDbError, type Cart } from '@nws-commerce/db';
import { browserClient } from './supabase';

interface CartState {
  cart: Cart;
  ready: boolean;
  token: string | null;
  setItem: (variantId: string, quantity: number) => Promise<void>;
  clear: () => Promise<void>;
  refresh: () => Promise<void>;
}

const EMPTY: Cart = { items: [], count: 0, subtotal: 0 };
const CartContext = createContext<CartState | null>(null);
const TOKEN_KEY = 'nwsc-cart-token';

/** A long random secret identifies this browser's cart on the server. */
function readOrCreateToken(): string | null {
  try {
    let t = localStorage.getItem(TOKEN_KEY);
    if (!t || t.length < 32) {
      const bytes = crypto.getRandomValues(new Uint8Array(24));
      t = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(TOKEN_KEY, t);
    }
    return t;
  } catch {
    return null;
  }
}

export function CartProvider({ orgId, children }: { orgId: string; children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [cart, setCart] = useState<Cart>(EMPTY);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    const { data } = await browserClient().rpc('cart_get', { p_organization_id: orgId, p_token: token });
    if (data) setCart(data as unknown as Cart);
    setReady(true);
  }, [orgId, token]);

  useEffect(() => { setToken(readOrCreateToken()); }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const setItem = useCallback(async (variantId: string, quantity: number) => {
    if (!token) throw new Error('This browser is blocking storage, so a cart cannot be kept.');
    const { data, error } = await browserClient().rpc('cart_set_item', {
      p_organization_id: orgId, p_token: token, p_variant_id: variantId, p_quantity: quantity,
    });
    if (error) throw new Error(describeDbError(error));
    setCart(data as unknown as Cart);
  }, [orgId, token]);

  const clear = useCallback(async () => {
    if (!token) return;
    await browserClient().rpc('cart_clear', { p_organization_id: orgId, p_token: token });
    setCart(EMPTY);
  }, [orgId, token]);

  const value = useMemo(() => ({ cart, ready, token, setItem, clear, refresh }), [cart, ready, token, setItem, clear, refresh]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart outside CartProvider');
  return ctx;
}
