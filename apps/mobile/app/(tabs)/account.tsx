import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import type { Enums, MyAccount } from '@nws-commerce/db';
import { supabase } from '@/lib/supabase';
import { useStore } from '@/lib/store';
import { useAuth } from '@/lib/auth';
import { savedOrders, type SavedOrder } from '@/lib/orders';
import { describeError } from '@/lib/errors';
import { money, normalisePhone, shortDate } from '@/lib/format';
import { radius, useTheme } from '@/lib/theme';
import { Badge, Button, Card, Chip, ErrorNote, Field, Loader, Section, Text } from '@/components/ui';

const STATUS: Record<Enums['order_status'], [string, 'neutral' | 'ok' | 'warn' | 'danger']> = {
  pending_payment: ['Awaiting payment', 'warn'], confirmed: ['Confirmed', 'ok'], completed: ['Completed', 'ok'],
  cancelled: ['Cancelled', 'neutral'], expired: ['Expired', 'neutral'], stock_conflict: ['Being checked', 'warn'],
};

interface OrderRow { id: string; token: string; number: string; placedAt: string; total: number; status?: Enums['order_status']; summary?: string; inStore?: boolean }

export default function Account() {
  const { session, ready } = useAuth();
  const store = useStore();
  const [account, setAccount] = useState<MyAccount | null>(null);
  const [local, setLocal] = useState<SavedOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLocal(await savedOrders());
    if (!session) { setAccount(null); setRefreshing(false); return; }
    const { data, error: e } = await supabase.rpc('my_account', { p_organization_id: store.id });
    setRefreshing(false);
    if (e) setError(describeError(e)); else { setError(null); setAccount(data as unknown as MyAccount); }
  }, [session, store.id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (!ready) return <Loader />;

  // Account orders first; then any placed on this phone without signing in.
  const rows: OrderRow[] = [
    ...(account?.orders ?? []).map((o) => ({
      id: o.order_id, token: o.access_token, number: o.number, placedAt: o.placed_at, total: o.total, status: o.status,
      summary: o.first_item ? `${o.first_item}${o.items > 1 ? ` + ${o.items - 1} more` : ''}` : undefined, inStore: o.channel === 'pos',
    })),
    ...local.filter((l) => !account?.orders.some((o) => o.order_id === l.id)).map((l) => ({ ...l })),
  ];

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 24, paddingBottom: 48 }} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}>
      <ErrorNote message={error} onRetry={load} />
      {session ? (account ? <SignedIn account={account} onChanged={load} /> : <Loader />) : <SignIn />}
      <Section title={session ? 'Your orders' : 'Orders on this phone'}>
        {rows.length === 0 ? <Text tone="ink2">{session ? 'Nothing yet. Orders you place, in the app or in store, show here.' : 'Orders you place in the app show here.'}</Text>
          : <Card padded={false}>{rows.map((r, i) => <OrderItem key={r.id} row={r} first={i === 0} currency={store.currency_code} />)}</Card>}
      </Section>
    </ScrollView>
  );
}

function OrderItem({ row, first, currency }: { row: OrderRow; first: boolean; currency: string }) {
  const t = useTheme();
  const st = row.status ? STATUS[row.status] : null;
  return (
    <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/order/[id]', params: { id: row.id, token: row.token } })}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderTopWidth: first ? 0 : 1, borderTopColor: t.line, opacity: pressed ? 0.7 : 1 })}>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Text weight="600">{row.number}</Text>
          {st && <Badge label={st[0]} tone={st[1]} />}
        </View>
        {row.summary && <Text size={13} tone="ink2" numberOfLines={1}>{row.summary}</Text>}
        <Text size={13} tone="ink3">{shortDate(row.placedAt)}{row.inStore ? ' · in store' : ''} · {money(row.total, currency)}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={t.ink3} />
    </Pressable>
  );
}

function SignedIn({ account, onChanged }: { account: MyAccount; onChanged: () => void }) {
  const store = useStore();
  const t = useTheme();
  const [editing, setEditing] = useState(!account.profile);
  const [name, setName] = useState(account.profile?.full_name ?? '');
  const [phone, setPhone] = useState(account.profile?.phone?.startsWith('+94') ? '0' + account.profile.phone.slice(3) : account.profile?.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPoints, setShowPoints] = useState(false);
  const cur = store.currency_code;
  const l = account.loyalty;

  async function save() {
    const p = phone.trim() ? normalisePhone(phone) : null;
    if (phone.trim() && !p) { setError('That phone number doesn\'t look right.'); return; }
    setBusy(true);
    const { error: e } = await supabase.rpc('ensure_customer_profile', { p_organization_id: store.id, p_full_name: name.trim() || null, p_phone: p });
    setBusy(false);
    if (e) { setError(describeError(e)); return; }
    setError(null); setEditing(false); onChanged();
  }

  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 2 }}>
        <Text size={24} weight="700">{account.profile?.full_name ? `Hi, ${account.profile.full_name.split(' ')[0]}` : 'Your account'}</Text>
        <Text tone="ink2">{account.email}</Text>
      </View>

      {l && (
        <View style={{ backgroundColor: t.brand, borderRadius: radius.lg, padding: 18, gap: 4 }}>
          <Text tone="brandFg" size={13} style={{ opacity: 0.8 }}>Loyalty points</Text>
          <Text tone="brandFg" size={34} weight="700">{l.points.toLocaleString()}</Text>
          <Text tone="brandFg" size={13} style={{ opacity: 0.85 }}>
            Worth {money(l.points * l.point_value, cur)} at the counter · you earn {l.points_per_100} per {money(100, cur)} spent{l.min_redeem > 0 ? ` · use ${l.min_redeem}+ at a time` : ''}
          </Text>
          {l.history.length > 0 && (
            <Pressable onPress={() => setShowPoints((v) => !v)} accessibilityRole="button" style={{ marginTop: 6 }}>
              <Text tone="brandFg" size={13} weight="600">{showPoints ? 'Hide history' : 'Show history'}</Text>
            </Pressable>
          )}
          {showPoints && l.history.map((h, i) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Text tone="brandFg" size={13} style={{ flex: 1, opacity: 0.85 }} numberOfLines={1}>{h.reason} · {shortDate(h.at)}</Text>
              <Text tone="brandFg" size={13} weight="600">{h.points > 0 ? '+' : ''}{h.points}</Text>
            </View>
          ))}
        </View>
      )}
      {account.store_credit > 0 && (
        <Card><Text tone="ink2" size={13}>Store credit</Text><Text size={20} weight="700">{money(account.store_credit, cur)}</Text>
          <Text size={13} tone="ink3">Spend it at the counter.</Text></Card>
      )}

      {editing ? (
        <Card style={{ gap: 12 }}>
          <Text weight="600">{account.profile ? 'Your details' : 'Finish your account'}</Text>
          {!account.profile && <Text size={13} tone="ink2">Add your mobile number and the shop can find your account at the counter, so in-store buys earn points too.</Text>}
          <Field label="Full name" value={name} onChangeText={setName} autoComplete="name" />
          <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" />
          <ErrorNote message={error} />
          <Button title="Save" busy={busy} onPress={save} />
        </Card>
      ) : (
        <Card style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text weight="600">Your details</Text>
            <Pressable onPress={() => setEditing(true)} accessibilityRole="button"><Text tone="ink2" size={14}>Edit</Text></Pressable>
          </View>
          <Text tone="ink2">{account.profile?.full_name || 'No name yet'}</Text>
          <Text tone="ink2">{account.profile?.phone || 'No phone number yet'}</Text>
        </Card>
      )}
      <Button title="Sign out" variant="secondary" onPress={() => supabase.auth.signOut()} />
    </View>
  );
}

function SignIn() {
  const store = useStore();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    setError(null); setNotice(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setError('Enter your email address.'); return; }
    if (password.length < 8) { setError('Passwords are at least 8 characters.'); return; }
    setBusy(true);
    if (mode === 'in') {
      const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (e) setError(/invalid/i.test(e.message) ? 'That email and password don\'t match.' : describeError(e));
    } else {
      const { data, error: e } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { full_name: name.trim() } } });
      if (e) setError(describeError(e));
      else if (data.session) await supabase.rpc('ensure_customer_profile', { p_organization_id: store.id, p_full_name: name.trim() || null });
      else setNotice('Check your email to confirm your account, then sign in.');
    }
    setBusy(false);
  }

  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 4 }}>
        <Text size={24} weight="700">{mode === 'in' ? 'Sign in' : 'Create an account'}</Text>
        <Text tone="ink2">Collect points, see every order - in the app or in store - and check out faster.</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Chip label="Sign in" active={mode === 'in'} onPress={() => setMode('in')} />
        <Chip label="New here" active={mode === 'up'} onPress={() => setMode('up')} />
      </View>
      {mode === 'up' && <Field label="Full name" value={name} onChangeText={setName} autoComplete="name" />}
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
        textContentType={mode === 'in' ? 'password' : 'newPassword'} hint={mode === 'up' ? 'At least 8 characters.' : undefined} onSubmitEditing={submit} />
      <ErrorNote message={error} />
      {notice && <Text tone="ok">{notice}</Text>}
      <Button title={mode === 'in' ? 'Sign in' : 'Create account'} busy={busy} onPress={submit} />
    </View>
  );
}
