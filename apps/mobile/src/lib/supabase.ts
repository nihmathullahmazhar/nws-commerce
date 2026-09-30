import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@nws-commerce/db';

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const STORE_SLUG = process.env.EXPO_PUBLIC_STORE_SLUG ?? '';
export const configured = Boolean(SUPABASE_URL && key && STORE_SLUG);

export const supabase = createClient<Database>(SUPABASE_URL || 'http://invalid.local', key || 'missing', {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${SUPABASE_URL}/storage/v1/object/public/products/${path}`;
}
