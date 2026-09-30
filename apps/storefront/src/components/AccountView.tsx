'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { Session } from '@supabase/supabase-js';
import { describeDbError } from '@nws-commerce/db';
import type { Store } from '@/lib/store';
import { browserClient } from '@/lib/supabase';
import { normalisePhone } from '@/lib/phone';
import { money } from '@/lib/format';

const input = 'h-11 w-full rounded-md border border-line bg-surface px-3 text-sm focus:border-ink focus:outline-none';

interface MyOrder { id: string; number: string; status: string; total: number; placed_at: string; access_token: string }

export function AccountView({ store }: { store: Store }) {
  const sb = browserClient();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [form, setForm] = useState({ email: '', password: '', full_name: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<MyOrder[] | null>(null);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [sb]);

  useEffect(() => {
    if (!session) { setOrders(null); return; }
    sb.from('orders').select('id, number, status, total, placed_at, access_token')
      .eq('organization_id', store.id).order('placed_at', { ascending: false }).limit(50)
      .then(({ data }) => setOrders((data ?? []) as MyOrder[]));
  }, [session, sb, store.id]);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (mode === 'signin') {
      const { error } = await sb.auth.signInWithPassword({ email: form.email.trim(), password: form.password });
      if (error) setError(error.message === 'Invalid login credentials' ? 'That email and password do not match.' : error.message);
    } else {
      const phone = form.phone.trim() ? normalisePhone(form.phone) : null;
      if (form.phone.trim() && !phone) { setError('That does not look like a phone number.'); setBusy(false); return; }
      const { data, error } = await sb.auth.signUp({ email: form.email.trim(), password: form.password });
      if (error) setError(error.message);
      else if (data.session) {
        const profile = await sb.rpc('ensure_customer_profile', { p_organization_id: store.id, p_full_name: form.full_name.trim() || null, p_phone: phone });
        if (profile.error) setError(describeDbError(profile.error));
      } else setError('Check your email to confirm your account, then sign in.');
    }
    setBusy(false);
  }

  if (session === undefined) return <p className="py-20 text-center text-ink-2">Loading...</p>;

  if (!session) {
    return (
      <div className="mx-auto max-w-sm py-8">
        <h1 className="text-2xl font-semibold tracking-tight">{mode === 'signin' ? 'Sign in' : 'Create an account'}</h1>
        <p className="mt-1 text-sm text-ink-2">{mode === 'signin' ? 'See your orders and check out faster.' : 'Keep your orders in one place.'} You can also check out as a guest.</p>
        <form onSubmit={submit} className="mt-6 space-y-3">
          {mode === 'signup' && <input className={input} placeholder="Full name" autoComplete="name" value={form.full_name} onChange={set('full_name')} />}
          <input className={input} type="email" required placeholder="Email" autoComplete="email" value={form.email} onChange={set('email')} />
          <input className={input} type="password" required minLength={8} placeholder="Password (8+ characters)" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={form.password} onChange={set('password')} />
          {mode === 'signup' && <input className={input} placeholder="Mobile number (optional)" inputMode="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} />}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <button disabled={busy} className="h-11 w-full rounded-md bg-brand text-sm font-medium text-brand-fg disabled:opacity-40">
            {busy ? 'One moment...' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <button onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); }} className="mt-4 text-sm text-ink-2 underline">
          {mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Your orders</h1>
        <span className="text-sm text-ink-2">{session.user.email} · <button className="underline" onClick={() => sb.auth.signOut()}>Sign out</button></span>
      </div>
      {orders === null ? <p className="mt-8 text-ink-2">Loading...</p> : orders.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-line px-6 py-12 text-center text-ink-2">No orders yet. Orders you place while signed in appear here.</p>
      ) : (
        <ul className="mt-6 divide-y divide-line border-y border-line">
          {orders.map((o) => (
            <li key={o.id}>
              <Link href={`/order/${o.id}?t=${o.access_token}`} className="flex items-center justify-between gap-3 py-3 hover:bg-tile">
                <span><span className="font-medium">{o.number}</span><span className="ml-2 text-sm text-ink-2">{new Date(o.placed_at).toLocaleDateString('en-LK', { dateStyle: 'medium' })}</span></span>
                <span className="text-sm"><span className="mr-3 capitalize text-ink-2">{o.status.replace('_', ' ')}</span><span className="num font-semibold">{money(o.total, store.currency_code)}</span></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
