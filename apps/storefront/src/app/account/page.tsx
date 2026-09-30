import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getStore } from '@/lib/store';
import { AccountView } from '@/components/AccountView';

export const metadata: Metadata = { title: 'Account', robots: { index: false } };

export default async function AccountPage() {
  const store = await getStore();
  if (!store) notFound();
  return <AccountView store={store} />;
}
