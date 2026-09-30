import type { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getStore } from '@/lib/store';
import { OrderView } from '@/components/OrderView';

export const metadata: Metadata = { title: 'Your order', robots: { index: false } };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await getStore();
  if (!store) notFound();
  return <Suspense><OrderView store={store} orderId={id} /></Suspense>;
}
