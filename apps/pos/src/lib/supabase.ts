import { createClient } from '@supabase/supabase-js';
import type { Database } from '@nws-commerce/db';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !key) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set (see apps/admin/.env.development).');
}

export const supabase = createClient<Database>(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'nwsc-pos-auth' },
});
