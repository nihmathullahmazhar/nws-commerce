import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { CatalogResult } from '@nws-commerce/db';
import { getCategories, getStore } from '@/lib/store';
import { serverClient } from '@/lib/supabase';
import { ProductCard } from '@/components/ProductCard';

export const revalidate = 60;

export default async function Home() {
  const store = await getStore();
  if (!store) notFound();
  const [categories, latest] = await Promise.all([
    getCategories(store.id),
    serverClient(60).rpc('storefront_catalog', { p_organization_id: store.id, p_sort: 'newest', p_limit: 8 }),
  ]);
  const items = ((latest.data ?? { items: [] }) as unknown as CatalogResult).items;
  const top = categories.filter((c) => !c.parentId);

  return (
    <div className="space-y-14">
      <section className="rounded-xl bg-tile px-6 py-12 sm:px-12 sm:py-16">
        <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{store.name}</h1>
        <p className="mt-3 max-w-xl text-ink-2">
          {[store.delivery_enabled && 'Delivered to your door', store.pickup_enabled && 'or collected in store'].filter(Boolean).join(' ')}.
          {' '}What you see here is what&apos;s on our shelves right now.
        </p>
        <Link href="/search" className="mt-6 inline-flex h-11 items-center rounded-md bg-brand px-5 text-sm font-medium text-brand-fg">Shop everything</Link>
      </section>

      {top.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold">Shop by category</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {top.map((c) => (
              <li key={c.id}>
                <Link href={`/c/${c.slug}`} className="flex h-24 items-end rounded-lg border border-line bg-surface p-4 text-sm font-medium text-ink hover:border-ink">{c.name}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">New in</h2>
          {items.length > 0 && <Link href="/search?sort=newest" className="text-sm text-ink-2 underline">See all</Link>}
        </div>
        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-6 py-12 text-center text-ink-2">Products will appear here as soon as the shop adds them.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((item) => <li key={item.id}><ProductCard item={item} currency={store.currency_code} /></li>)}
          </ul>
        )}
      </section>
    </div>
  );
}
