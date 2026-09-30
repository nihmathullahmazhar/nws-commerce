import type { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getStore } from '@/lib/store';
import { CheckoutView } from '@/components/CheckoutView';

export const metadata: Metadata = { title: 'Checkout', robots: { index: false } };

export default async function CheckoutPage() {
  const store = await getStore();
  if (!store) notFound();
  return <Suspense><CheckoutView store={store} /></Suspense>;
}
