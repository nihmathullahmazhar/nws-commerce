import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getStore } from '@/lib/store';
import { fetchListing, type SearchParams } from '@/lib/listing';
import { Listing } from '@/components/Listing';

type Props = { searchParams: Promise<SearchParams> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = (await searchParams).q;
  return { title: q ? `Search: ${q}` : 'All products', robots: q ? { index: false } : undefined };
}

export default async function SearchPage({ searchParams }: Props) {
  const store = await getStore();
  if (!store) notFound();
  const sp = await searchParams;
  const result = await fetchListing(store.id, sp, null);
  return (
    <>
      <form action="/search" role="search" className="mb-6 sm:hidden">
        <input name="q" type="search" defaultValue={result.q ?? ''} placeholder="Search products" aria-label="Search products"
          className="h-11 w-full rounded-full border border-line bg-surface px-4 text-sm" />
      </form>
      <h1 className="text-2xl font-semibold tracking-tight">{result.q ? <>Results for &ldquo;{result.q}&rdquo;</> : 'All products'}</h1>
      <div className="mt-8">
        <Listing result={result} basePath="/search" searchParams={sp} currency={store.currency_code}
          empty={<p className="rounded-lg border border-dashed border-line px-6 py-12 text-center text-ink-2">
            {result.q ? 'No products match that search. Check the spelling, or try a shorter word or a SKU.' : 'No products are on sale yet.'}
          </p>} />
      </div>
    </>
  );
}
