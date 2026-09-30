import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <h1 className="text-xl font-semibold">We couldn&apos;t find that page</h1>
      <p className="mt-2 text-ink-2">It may have been renamed or is no longer sold.</p>
      <Link href="/search" className="mt-6 inline-flex h-10 items-center rounded-md bg-brand px-4 text-sm font-medium text-brand-fg">Browse products</Link>
    </div>
  );
}
