import Link from 'next/link';
import type { CatalogResult } from '@nws-commerce/db';
import { PAGE_SIZE, SORTS, hrefWith, type SearchParams } from '@/lib/listing';
import { money } from '@/lib/format';
import { ProductCard } from './ProductCard';
import { SubmitOnChangeSelect } from './SubmitOnChange';

const has = (sp: SearchParams, key: string, value: string) => {
  const v = sp[key];
  return Array.isArray(v) ? v.includes(value) : v === value;
};

export function Listing({ result, basePath, searchParams, currency, empty }: {
  result: CatalogResult & { page: number; sort: string; q: string | null };
  basePath: string; searchParams: SearchParams; currency: string; empty: React.ReactNode;
}) {
  const { facets } = result;
  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const hasFacets = facets.brands.length > 0 || facets.attributes.length > 0 || (facets.price?.min ?? null) !== null;
  const filtered = Object.keys(searchParams).some((k) => k === 'brand' || k.startsWith('a.') || k === 'min' || k === 'max' || k === 'stock');

  return (
    <form action={basePath} method="get" className="grid gap-8 lg:grid-cols-[15rem_1fr]">
      {result.q && <input type="hidden" name="q" value={result.q} />}

      {hasFacets && (
        <aside className="space-y-6 text-sm lg:sticky lg:top-4 lg:self-start">
          <details open className="group lg:open">
            <summary className="mb-4 cursor-pointer list-none font-semibold text-ink lg:hidden">Filters</summary>
            <div className="space-y-6">
              <fieldset>
                <label className="flex items-center gap-2 text-ink">
                  <input type="checkbox" name="stock" value="1" defaultChecked={has(searchParams, 'stock', '1')} className="size-4 accent-[var(--brand)]" />
                  In stock only
                </label>
              </fieldset>
              {facets.brands.length > 0 && (
                <fieldset>
                  <legend className="mb-2 font-semibold text-ink">Brand</legend>
                  <div className="space-y-1.5">
                    {facets.brands.map((b) => (
                      <label key={b.slug} className="flex items-center gap-2 text-ink-2">
                        <input type="checkbox" name="brand" value={b.slug} defaultChecked={has(searchParams, 'brand', b.slug)} className="size-4 accent-[var(--brand)]" />
                        <span className="flex-1">{b.name}</span><span className="num text-xs text-ink-3">{b.count}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              {facets.attributes.map((a) => (
                <fieldset key={a.id}>
                  <legend className="mb-2 font-semibold text-ink">{a.label}</legend>
                  <div className="space-y-1.5">
                    {a.values.map((v) => (
                      <label key={v.value} className="flex items-center gap-2 text-ink-2">
                        <input type="checkbox" name={`a.${a.id}`} value={v.value} defaultChecked={has(searchParams, `a.${a.id}`, v.value)} className="size-4 accent-[var(--brand)]" />
                        <span className="flex-1">{v.value}{a.unit ? ` ${a.unit}` : ''}</span><span className="num text-xs text-ink-3">{v.count}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
              {facets.price?.min !== null && facets.price?.min !== undefined && (
                <fieldset>
                  <legend className="mb-2 font-semibold text-ink">Price</legend>
                  <div className="flex items-center gap-2">
                    <input name="min" inputMode="numeric" placeholder={String(Math.floor(facets.price.min))} defaultValue={String(searchParams.min ?? '')}
                      aria-label="Minimum price" className="h-9 w-full rounded-md border border-line bg-surface px-2 text-sm" />
                    <span className="text-ink-3">-</span>
                    <input name="max" inputMode="numeric" placeholder={String(Math.ceil(facets.price.max ?? 0))} defaultValue={String(searchParams.max ?? '')}
                      aria-label="Maximum price" className="h-9 w-full rounded-md border border-line bg-surface px-2 text-sm" />
                  </div>
                </fieldset>
              )}
              <div className="flex items-center gap-3">
                <button type="submit" className="h-9 rounded-md bg-brand px-4 text-sm font-medium text-brand-fg">Apply</button>
                {filtered && <Link href={result.q ? `${basePath}?q=${encodeURIComponent(result.q)}` : basePath} className="text-sm text-ink-2 underline">Clear</Link>}
              </div>
            </div>
          </details>
        </aside>
      )}

      <div className={hasFacets ? '' : 'lg:col-span-2'}>
        <div className="mb-5 flex items-center justify-between gap-3 text-sm">
          <span className="text-ink-2">{result.total} product{result.total === 1 ? '' : 's'}</span>
          <label className="flex items-center gap-2 text-ink-2">
            Sort
            <SubmitOnChangeSelect name="sort" defaultValue={result.sort === 'relevance' ? '' : result.sort}
              className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink">
              {result.q && <option value="">Best match</option>}
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </SubmitOnChangeSelect>
          </label>
        </div>

        {result.items.length === 0 ? empty : (
          <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 xl:grid-cols-4">
            {result.items.map((item) => <li key={item.id}><ProductCard item={item} currency={currency} /></li>)}
          </ul>
        )}

        {pages > 1 && (
          <nav className="mt-10 flex items-center justify-center gap-2 text-sm" aria-label="Pages">
            {result.page > 1 && <Link className="rounded-md border border-line px-3 py-1.5" href={hrefWith(basePath, searchParams, { page: String(result.page - 1) })}>Previous</Link>}
            <span className="px-2 text-ink-2">Page {result.page} of {pages}</span>
            {result.page < pages && <Link className="rounded-md border border-line px-3 py-1.5" href={hrefWith(basePath, searchParams, { page: String(result.page + 1) })}>Next</Link>}
          </nav>
        )}
      </div>
    </form>
  );
}

export function priceNote(min: number | null | undefined, currency: string) {
  return min ? `from ${money(min, currency)}` : '';
}
