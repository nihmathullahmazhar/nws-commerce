import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import type { ProductPage } from '@nws-commerce/db';
import { getStore } from '@/lib/store';
import { serverClient } from '@/lib/supabase';
import { mediaUrl, money, siteUrl } from '@/lib/format';
import { ProductImage } from '@/components/ProductImage';
import { ProductBuy } from '@/components/ProductBuy';

type Props = { params: Promise<{ slug: string }> };

const loadProduct = cache(async (orgId: string, slug: string) => {
  const { data } = await serverClient(30).rpc('storefront_product', { p_organization_id: orgId, p_slug: slug });
  return (data ?? null) as unknown as ProductPage | null;
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const store = await getStore();
  const p = store && await loadProduct(store.id, slug);
  if (!p) return {};
  const description = p.seo?.description ?? p.summary ?? p.description?.slice(0, 160) ?? undefined;
  const image = mediaUrl(p.media[0]?.path);
  return {
    title: p.seo?.title ?? p.name,
    description,
    alternates: { canonical: `/p/${p.slug}` },
    openGraph: { title: p.name, description, images: image ? [image] : undefined },
  };
}

function specValue(s: ProductPage['specifications'][number]) {
  if (s.type === 'boolean') return s.value ? 'Yes' : 'No';
  return `${String(s.value)}${s.unit ? ` ${s.unit}` : ''}`;
}

export default async function ProductPageView({ params }: Props) {
  const { slug } = await params;
  const store = await getStore();
  if (!store) notFound();
  const p = await loadProduct(store.id, slug);
  if (!p) notFound();

  const prices = p.variants.map((v) => v.price);
  const inStock = p.variants.some((v) => v.available > 0);
  // Structured data so search engines show price and stock.
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'Product', name: p.name,
    description: p.summary ?? p.description ?? undefined,
    sku: p.variants[0]?.sku ?? undefined,
    brand: p.brand ? { '@type': 'Brand', name: p.brand.name } : undefined,
    image: p.media.map((m) => mediaUrl(m.path)).filter(Boolean),
    offers: {
      '@type': 'AggregateOffer', priceCurrency: store.currency_code, lowPrice: Math.min(...prices), highPrice: Math.max(...prices),
      offerCount: p.variants.length, url: `${siteUrl()}/p/${p.slug}`,
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <nav className="mb-6 text-sm text-ink-3" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-ink">Home</Link>
        {p.breadcrumbs.map((b) => <span key={b.slug}> / <Link href={`/c/${b.slug}`} className="hover:text-ink">{b.name}</Link></span>)}
      </nav>

      <div className="grid gap-10 lg:grid-cols-2">
        <div className="space-y-3">
          <ProductImage path={p.media[0]?.path} name={p.name} sizes="lg" className="rounded-xl" />
          {p.media.length > 1 && (
            <ul className="grid grid-cols-5 gap-2">
              {p.media.slice(1, 6).map((m) => <li key={m.path}><ProductImage path={m.path} name={m.alt ?? p.name} sizes="sm" /></li>)}
            </ul>
          )}
        </div>

        <div>
          {p.brand && <div className="text-sm uppercase tracking-wider text-ink-3">{p.brand.name}</div>}
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{p.name}</h1>
          {p.summary && <p className="mt-3 text-ink-2">{p.summary}</p>}
          <div className="mt-6"><ProductBuy product={p} orgId={store.id} currency={store.currency_code} /></div>

          <ul className="mt-8 space-y-1.5 border-t border-line pt-6 text-sm text-ink-2">
            {store.delivery_enabled && <li>Delivery{store.delivery_fee ? ` ${money(store.delivery_fee, store.currency_code)}` : ' free'}{store.free_delivery_over ? `, free over ${money(store.free_delivery_over, store.currency_code)}` : ''}</li>}
            {store.pickup_enabled && <li>Collect in store, free</li>}
            {store.allow_cash_on_delivery && <li>Pay on delivery or collection</li>}
          </ul>

          {p.description && (
            <section className="mt-8">
              <h2 className="mb-2 font-semibold">Description</h2>
              <div className="whitespace-pre-line text-sm leading-relaxed text-ink-2">{p.description}</div>
            </section>
          )}
          {p.specifications.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-2 font-semibold">Specifications</h2>
              <dl className="divide-y divide-line border-y border-line text-sm">
                {p.specifications.map((s) => (
                  <div key={s.label} className="grid grid-cols-2 gap-4 py-2"><dt className="text-ink-2">{s.label}</dt><dd className="text-ink">{specValue(s)}</dd></div>
                ))}
              </dl>
            </section>
          )}
        </div>
      </div>

      {p.related.length > 0 && (
        <section className="mt-16">
          <h2 className="mb-4 text-lg font-semibold">You may also like</h2>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {p.related.map((r) => (
              <li key={r.slug}>
                <Link href={`/p/${r.slug}`} className="group block">
                  <ProductImage path={r.image} name={r.name} />
                  <div className="mt-2 text-sm group-hover:underline">{r.name}</div>
                  <div className="num text-sm font-semibold">{money(r.min_price, store.currency_code)}</div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
