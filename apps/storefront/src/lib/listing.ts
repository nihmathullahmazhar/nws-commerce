import type { CatalogResult } from '@nws-commerce/db';
import { serverClient } from './supabase';

export type SearchParams = Record<string, string | string[] | undefined>;
export const PAGE_SIZE = 24;
export const SORTS = [
  { value: 'newest', label: 'Newest' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'name', label: 'Name' },
] as const;

const list = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]).filter(Boolean);
const one = (v: string | string[] | undefined) => list(v)[0];

/** URL -> storefront_catalog arguments. Filters live in the URL so every view is linkable and crawlable. */
export function parseListing(sp: SearchParams) {
  const attributes: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(sp)) if (k.startsWith('a.')) attributes[k.slice(2)] = list(v);
  const min = Number(one(sp.min));
  const max = Number(one(sp.max));
  const q = one(sp.q)?.trim() || null;
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const sortParam = one(sp.sort);
  const sort = SORTS.some((s) => s.value === sortParam) ? sortParam! : q ? 'relevance' : 'newest';
  return {
    q, page, sort,
    filters: {
      brands: list(sp.brand),
      ...(Number.isFinite(min) && min > 0 ? { min_price: min } : {}),
      ...(Number.isFinite(max) && max > 0 ? { max_price: max } : {}),
      ...(one(sp.stock) === '1' ? { in_stock: true } : {}),
      attributes,
    },
  };
}

export async function fetchListing(orgId: string, sp: SearchParams, categorySlug: string | null): Promise<CatalogResult & { page: number; sort: string; q: string | null }> {
  const { q, page, sort, filters } = parseListing(sp);
  const { data } = await serverClient(30).rpc('storefront_catalog', {
    p_organization_id: orgId, p_category_slug: categorySlug, p_query: q, p_filters: filters,
    p_sort: sort, p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE,
  });
  const result = (data ?? { total: 0, items: [], facets: { brands: [], price: null, attributes: [] } }) as unknown as CatalogResult;
  return { ...result, page, sort, q };
}

/** A link to the same listing with some parameters changed. */
export function hrefWith(base: string, sp: SearchParams, changes: Record<string, string | null>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) for (const x of list(v)) params.append(k, x);
  for (const [k, v] of Object.entries(changes)) { params.delete(k); if (v !== null) params.set(k, v); }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
