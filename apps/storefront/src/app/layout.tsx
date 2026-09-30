import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getCategories, getStore } from '@/lib/store';
import { siteUrl } from '@/lib/format';
import { CartProvider } from '@/lib/cart';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const store = await getStore();
  const name = store?.name ?? 'Store';
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: name, template: `%s | ${name}` },
    description: `Shop ${name} online. Live stock, delivery or collect in store.`,
    openGraph: { siteName: name, type: 'website' },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const store = await getStore();
  if (!store) {
    return (
      <html lang="en"><body>
        <main className="mx-auto max-w-lg px-6 py-24 text-center">
          <h1 className="text-xl font-semibold">This store isn&apos;t open yet</h1>
          <p className="mt-2 text-ink-2">No business with the online store switched on matches this site&apos;s configuration.</p>
        </main>
      </body></html>
    );
  }
  const categories = await getCategories(store.id);
  return (
    <html lang="en">
      <body className="min-h-screen">
        <CartProvider orgId={store.id}>
          <Header store={store} categories={categories} />
          <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
          <Footer store={store} />
        </CartProvider>
      </body>
    </html>
  );
}
