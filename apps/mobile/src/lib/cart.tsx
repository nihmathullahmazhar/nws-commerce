import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// The app's cart lives on the phone. Prices and stock are never trusted from
// it: every screen that shows a total asks the database (quote_order), and
// checkout re-checks stock under lock.

export interface CartItem {
  variantId: string; productSlug: string; name: string; variant: string; sku: string | null;
  price: number; image: string | null; unit: string; fractional: boolean; quantity: number;
}

interface CartState {
  items: CartItem[]; count: number; ready: boolean;
  add: (item: Omit<CartItem, 'quantity'>, quantity: number) => void;
  setQuantity: (variantId: string, quantity: number) => void;
  clear: () => void;
}

const KEY = 'nwsc-app-cart-v1';
const CartContext = createContext<CartState | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((raw) => {
      try { if (raw) setItems(JSON.parse(raw)); } catch { /* a damaged cart starts empty */ }
    }).finally(() => setReady(true));
  }, []);
  useEffect(() => { if (ready) void AsyncStorage.setItem(KEY, JSON.stringify(items)); }, [items, ready]);

  const add = useCallback((item: Omit<CartItem, 'quantity'>, quantity: number) => {
    setItems((xs) => {
      const hit = xs.find((x) => x.variantId === item.variantId);
      if (hit) return xs.map((x) => (x === hit ? { ...x, ...item, quantity: +(x.quantity + quantity).toFixed(3) } : x));
      return [...xs, { ...item, quantity }];
    });
  }, []);
  const setQuantity = useCallback((variantId: string, quantity: number) => {
    setItems((xs) => (quantity <= 0 ? xs.filter((x) => x.variantId !== variantId) : xs.map((x) => (x.variantId === variantId ? { ...x, quantity } : x))));
  }, []);
  const clear = useCallback(() => setItems([]), []);

  const value = useMemo(() => ({
    items, ready, add, setQuantity, clear,
    count: items.reduce((s, x) => s + (x.fractional ? 1 : x.quantity), 0),
  }), [items, ready, add, setQuantity, clear]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartState {
  const c = useContext(CartContext);
  if (!c) throw new Error('CartProvider missing');
  return c;
}

export const cartLines = (items: CartItem[]) => items.map((i) => ({ variant_id: i.variantId, quantity: i.quantity }));
