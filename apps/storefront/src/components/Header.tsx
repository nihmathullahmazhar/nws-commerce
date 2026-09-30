import Link from 'next/link';
import { Search, User } from 'lucide-react';
import type { Store } from '@/lib/store';
import { CartButton } from './CartButton';

export function Header({ store, categories }: {
  store: Store; categories: { id: string; parentId: string | null; name: string; slug: string }[];
}) {
  const top = categories.filter((c) => !c.parentId);
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="shrink-0 text-lg font-semibold tracking-tight text-ink">{store.name}</Link>
        <form action="/search" className="relative ml-auto hidden max-w-md flex-1 sm:block" role="search">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-ink-3" />
          <input name="q" type="search" placeholder="Search products" aria-label="Search products"
            className="h-9 w-full rounded-full border border-line bg-bg pl-9 pr-4 text-sm text-ink placeholder:text-ink-3 focus:border-ink focus:outline-none" />
        </form>
        <nav className="ml-auto flex items-center gap-1 sm:ml-0">
          <Link href="/search" className="rounded-md p-1.5 text-ink hover:bg-tile sm:hidden" aria-label="Search"><Search className="size-5" /></Link>
          <Link href="/account" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-ink hover:bg-tile" aria-label="Account">
            <User className="size-5" /><span className="hidden sm:inline">Account</span>
          </Link>
          <CartButton />
        </nav>
      </div>
      {top.length > 0 && (
        <nav className="mx-auto max-w-7xl overflow-x-auto px-4 sm:px-6" aria-label="Categories">
          <ul className="flex gap-5 whitespace-nowrap pb-2.5 text-sm">
            <li><Link href="/search" className="text-ink-2 hover:text-ink">All products</Link></li>
            {top.map((c) => <li key={c.id}><Link href={`/c/${c.slug}`} className="text-ink-2 hover:text-ink">{c.name}</Link></li>)}
          </ul>
        </nav>
      )}
    </header>
  );
}
