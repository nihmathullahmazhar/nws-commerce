import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCategories, getStore } from '@/lib/store';
import { fetchListing, type SearchParams } from '@/lib/listing';
import { Listing } from '@/components/Listing';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<SearchParams> };

async function load(slug: string) {
  const store = await getStore();
  if (!store) return null;
  const categories = await getCategories(store.id);
  const category = categories.find((c) => c.slug === slug);
  if (!category) return null;
  const trail: typeof categories = [];
  for (let c: typeof category | undefined = category; c; c = categories.find((x) => x.id === c!.parentId)) trail.unshift(c);
  return { store, category, trail, children: categories.filter((c) => c.parentId === category.id) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) return {};
  return { title: data.category.name, alternates: { canonical: `/c/${slug}` } };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const data = await load(slug);
  if (!data) notFound();
  const result = await fetchListing(data.store.id, sp, slug);

  return (
    <>
      <nav className="mb-3 text-sm text-ink-3" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-ink">Home</Link>
        {data.trail.map((c) => <span key={c.id}> / <Link href={`/c/${c.slug}`} className="hover:text-ink">{c.name}</Link></span>)}
      </nav>
      <h1 className="text-2xl font-semibold tracking-tight">{data.category.name}</h1>
      {data.children.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2">
          {data.children.map((c) => <li key={c.id}><Link href={`/c/${c.slug}`} className="inline-block rounded-full border border-line bg-surface px-3 py-1 text-sm hover:border-ink">{c.name}</Link></li>)}
        </ul>
      )}
      <div className="mt-8">
        <Listing result={result} basePath={`/c/${slug}`} searchParams={sp} currency={data.store.currency_code}
          empty={<p className="rounded-lg border border-dashed border-line px-6 py-12 text-center text-ink-2">Nothing here matches. Try removing a filter.</p>} />
      </div>
    </>
  );
}
