import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { StoreSettings } from '@nws-commerce/db';
import { configured, STORE_SLUG, supabase } from './supabase';
import { describeError } from './errors';

export interface Store extends StoreSettings { id: string; slug: string }
export interface Category { id: string; parentId: string | null; name: string; slug: string; count: number }

interface StoreState { store: Store | null; categories: Category[]; error: string | null; reload: () => void }
const StoreContext = createContext<StoreState>({ store: null, categories: [], error: null, reload: () => {} });

/** The business this app sells for, loaded once at start. */
export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<StoreState, 'reload'>>({ store: null, categories: [], error: null });

  const load = useCallback(async () => {
    if (!configured) { setState({ store: null, categories: [], error: 'This app build has no shop set. Set EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY and EXPO_PUBLIC_STORE_SLUG.' }); return; }
    setState((s) => ({ ...s, error: null }));
    try {
      const org = await supabase.rpc('storefront_organization', { p_slug: STORE_SLUG });
      if (org.error) throw org.error;
      const row = org.data?.[0];
      if (!row?.id) throw new Error('This shop is not open in the app right now.');
      const [settings, cats] = await Promise.all([
        supabase.rpc('storefront_settings', { p_organization_id: row.id }),
        supabase.rpc('storefront_categories', { p_organization_id: row.id }),
      ]);
      if (settings.error) throw settings.error;
      const s = settings.data as unknown as StoreSettings;
      if (!s?.app_enabled) throw new Error('This shop is not open in the app right now.');
      setState({
        store: { ...s, id: row.id, slug: row.slug ?? STORE_SLUG },
        categories: (cats.data ?? []).map((c) => ({ id: c.id!, parentId: c.parent_id, name: c.name!, slug: c.slug!, count: Number(c.product_count ?? 0) })),
        error: null,
      });
    } catch (e) {
      setState({ store: null, categories: [], error: describeError(e) });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  return <StoreContext.Provider value={{ ...state, reload: load }}>{children}</StoreContext.Provider>;
}

export const useStoreState = () => useContext(StoreContext);
/** Only inside screens rendered after the store has loaded. */
export function useStore(): Store {
  const s = useContext(StoreContext).store;
  if (!s) throw new Error('store not loaded');
  return s;
}
