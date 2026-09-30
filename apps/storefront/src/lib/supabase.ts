import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@nws-commerce/db';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
if (!url || !key) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set (see apps/storefront/.env.example).');
}

/**
 * Server-side reads for catalogue pages. Anonymous, no session, and responses
 * are cached by Next for a short time so pages are fast and still near-live.
 */
export function serverClient(revalidate = 30): SupabaseClient<Database> {
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, next: { revalidate } }) },
  });
}

let browser: SupabaseClient<Database> | null = null;

/** The shopper's client in the browser: cart, checkout, account. */
export function browserClient(): SupabaseClient<Database> {
  if (!browser) {
    browser = createClient<Database>(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'nwsc-shop-auth' },
    });
  }
  return browser;
}
