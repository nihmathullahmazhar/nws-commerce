'use client';

import { useCallback, useEffect, useState } from 'react';
import { describeDbError, type Cart, type Enums, type OrderQuote } from '@nws-commerce/db';
import { browserClient } from './supabase';

const COUPON_KEY = 'nwsc-coupon';

/** The shopper's coupon, kept between the cart and checkout (per browser tab). */
export function useCoupon() {
  const [coupon, setState] = useState<string | null>(null);
  useEffect(() => {
    try { setState(sessionStorage.getItem(COUPON_KEY)); } catch { /* storage unavailable */ }
  }, []);
  const setCoupon = useCallback((code: string | null) => {
    setState(code);
    try { if (code) sessionStorage.setItem(COUPON_KEY, code); else sessionStorage.removeItem(COUPON_KEY); } catch { /* ignore */ }
  }, []);
  return [coupon, setCoupon] as const;
}

/**
 * Prices the cart with the same database code checkout uses. A coupon that
 * doesn't apply is reported separately, and the cart is priced without it.
 */
export function useQuote(orgId: string, cart: Cart, method: Enums['fulfilment_method'], coupon: string | null = null) {
  const [quote, setQuote] = useState<OrderQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const lines = cart.items.filter((i) => i.for_sale).map((i) => ({ variant_id: i.variant_id, quantity: i.quantity }));
  const key = JSON.stringify(lines) + method + (coupon ?? '');

  useEffect(() => {
    if (lines.length === 0) { setQuote(null); return; }
    let cancelled = false;
    const run = (code: string | null) => browserClient()
      .rpc('quote_order', { p_organization_id: orgId, p_lines: lines, p_fulfilment_method: method, p_coupon: code });
    (async () => {
      let res = await run(coupon);
      let badCoupon: string | null = null;
      if (res.error && coupon) {
        badCoupon = describeDbError(res.error);
        res = await run(null);
      }
      if (cancelled) return;
      setCouponError(badCoupon);
      if (res.error) { setError(describeDbError(res.error)); setQuote(null); }
      else { setError(null); setQuote(res.data as unknown as OrderQuote); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, key]);

  return { quote, error, couponError };
}
