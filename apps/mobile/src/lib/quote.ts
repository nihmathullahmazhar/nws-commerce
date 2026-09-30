import { useEffect, useState } from 'react';
import type { Enums, OrderQuote } from '@nws-commerce/db';
import { supabase } from './supabase';
import { describeError } from './errors';
import { cartLines, type CartItem } from './cart';

/**
 * Prices the cart with the same database code checkout uses, as an app sale
 * (so app-only promotions show). A coupon that doesn't apply is reported on
 * its own and the cart is priced without it.
 */
export function useQuote(orgId: string, items: CartItem[], method: Enums['fulfilment_method'], coupon: string | null) {
  const [quote, setQuote] = useState<OrderQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const lines = cartLines(items);
  const key = JSON.stringify(lines) + method + (coupon ?? '');

  useEffect(() => {
    if (!lines.length) { setQuote(null); setError(null); return; }
    let cancelled = false;
    setLoading(true);
    const run = (code: string | null) => supabase.rpc('quote_order', {
      p_organization_id: orgId, p_lines: lines, p_fulfilment_method: method, p_coupon: code, p_channel: 'mobile_app',
    });
    (async () => {
      let res = await run(coupon);
      let bad: string | null = null;
      if (res.error && coupon) { bad = describeError(res.error); res = await run(null); }
      if (cancelled) return;
      setCouponError(bad);
      if (res.error) { setError(describeError(res.error)); setQuote(null); }
      else { setError(null); setQuote(res.data as unknown as OrderQuote); }
      setLoading(false);
    })().catch((e) => { if (!cancelled) { setError(describeError(e)); setLoading(false); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, key]);

  return { quote, error, couponError, loading };
}
