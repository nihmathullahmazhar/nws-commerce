import type { MetadataRoute } from 'next';
import type { CatalogResult } from '@nws-commerce/db';
import { getCategories, getStore } from '@/lib/store';
import { serverClient } from '@/lib/supabase';
import { siteUrl } from '@/lib/format';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const store = await getStore();
  if (!store) return [];
  const base = siteUrl();
  const categories = await getCategories(store.id);
  const entries: MetadataRoute.Sitemap = [{ url: `${base}/`, changeFrequency: 'daily', priority: 1 }];
  entries.push(...categories.map((c) => ({ url: `${base}/c/${c.slug}`, changeFrequency: 'daily' as const, priority: 0.8 })));
  for (let offset = 0; offset < 5000; offset += 96) {
    const { data } = await serverClient(3600).rpc('storefront_catalog', { p_organization_id: store.id, p_sort: 'name', p_limit: 96, p_offset: offset });
    const page = (data as unknown as CatalogResult | null)?.items ?? [];
    entries.push(...page.map((p) => ({ url: `${base}/p/${p.slug}`, changeFrequency: 'daily' as const, priority: 0.6 })));
    if (page.length < 96) break;
  }
  return entries;
}
