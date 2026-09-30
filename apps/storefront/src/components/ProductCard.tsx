import Link from 'next/link';
import type { CatalogItem } from '@nws-commerce/db';
import { ProductImage } from './ProductImage';
import { Price } from './Price';

export function ProductCard({ item, currency }: { item: CatalogItem; currency: string }) {
  const onSale = item.compare_at_price && item.compare_at_price > item.min_price && item.min_price === item.max_price;
  return (
    <Link href={`/p/${item.slug}`} className="group block">
      <div className="relative">
        <ProductImage path={item.image} name={item.name} className="transition group-hover:opacity-90" />
        {!item.in_stock && <span className="absolute left-2 top-2 rounded bg-surface/90 px-1.5 py-0.5 text-xs font-medium text-ink-2">Sold out</span>}
        {item.in_stock && onSale && <span className="absolute left-2 top-2 rounded bg-sale px-1.5 py-0.5 text-xs font-medium text-white">Sale</span>}
      </div>
      <div className="mt-2.5 space-y-0.5">
        {item.brand && <div className="text-xs uppercase tracking-wider text-ink-3">{item.brand}</div>}
        <div className="line-clamp-2 text-sm text-ink group-hover:underline">{item.name}</div>
        <Price min={item.min_price} max={item.max_price} compareAt={item.compare_at_price} currency={currency} />
      </div>
    </Link>
  );
}
