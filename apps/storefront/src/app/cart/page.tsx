import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getStore } from '@/lib/store';
import { CartView } from '@/components/CartView';

export const metadata: Metadata = { title: 'Cart', robots: { index: false } };

export default async function CartPage() {
  const store = await getStore();
  if (!store) notFound();
  return <CartView store={store} />;
}
