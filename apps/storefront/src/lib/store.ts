import { cache } from 'react';
import type { StoreSettings } from '@nws-commerce/db';
import { serverClient } from './supabase';

export interface Store extends StoreSettings { id: string; slug: string }

export const STORE_SLUG = process.env.NEXT_PUBLIC_STORE_SLUG ?? '';

/** The business this deployment sells for, once per request. */
export const getStore = cache(async (): Promise<Store | null> => {
  const sb = serverClient(60);
  const { data } = await sb.rpc('storefront_organization', { p_slug: STORE_SLUG });
  const org = data?.[0];
  if (!org?.id) return null;
  const settings = await sb.rpc('storefront_settings', { p_organization_id: org.id });
  if (!settings.data) return null;
  return { ...(settings.data as unknown as StoreSettings), id: org.id, slug: org.slug ?? STORE_SLUG };
});

export const getCategories = cache(async (orgId: string) => {
  const { data } = await serverClient(60).rpc('storefront_categories', { p_organization_id: orgId });
  return (data ?? []).map((c) => ({
    id: c.id!, parentId: c.parent_id, name: c.name!, slug: c.slug!, count: Number(c.product_count ?? 0),
  }));
});
