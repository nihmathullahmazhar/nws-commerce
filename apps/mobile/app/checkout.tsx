import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import type { Enums, OrderSummary } from '@nws-commerce/db';
import { supabase } from '@/lib/supabase';
import { useStore } from '@/lib/store';
import { useCart, cartLines } from '@/lib/cart';
import { useAuth } from '@/lib/auth';
import { useQuote } from '@/lib/quote';
import { rememberOrder } from '@/lib/orders';
import { describeError } from '@/lib/errors';
import { money, normalisePhone } from '@/lib/format';
import { radius, useTheme } from '@/lib/theme';
import { Button, Card, ErrorNote, Field, Loader, Text, Totals } from '@/components/ui';

const PAY_LABEL: Partial<Record<Enums['payment_method'], [string, string]>> = {
  cash_on_delivery: ['Pay on delivery', 'Cash or card when your order arrives.'],
  bank_transfer: ['Bank transfer', 'We hold your items while you transfer.'],
  online_gateway: ['Card or wallet', 'Pay securely online.'],
};

export default function Checkout() {
  const params = useLocalSearchParams<{ method?: string; coupon?: string }>();
  const store = useStore();
  const cart = useCart();
  const { session } = useAuth();
  const t = useTheme();
  const method: Enums['fulfilment_method'] = params.method === 'pickup' || !store.delivery_enabled ? 'pickup' : 'delivery';
  const coupon = params.coupon ?? null;
  const payOptions = ([
    store.allow_cash_on_delivery && 'cash_on_delivery', store.bank_transfer_details && 'bank_transfer',
    store.online_payments_enabled && 'online_gateway',
  ].filter(Boolean)) as Enums['payment_method'][];
  const [pay, setPay] = useState<Enums['payment_method'] | undefined>(payOptions[0]);
  const [form, setForm] = useState({ full_name: '', phone: '', email: '', line1: '', line2: '', city: '', postcode: '', note: '' });
  const [idempotencyKey] = useState(() => `app-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<Record<string, string>>({});
  const { quote, error: quoteError } = useQuote(store.id, cart.items, method, coupon);

  // A signed-in shopper's details fill themselves in.
  useEffect(() => {
    if (!session) return;
    supabase.rpc('my_account', { p_organization_id: store.id }).then(({ data }) => {
      const a = data as { email: string | null; profile: { full_name: string | null; phone: string | null } | null } | null;
      if (!a) return;
      setForm((f) => ({
        ...f, email: f.email || a.email || '', full_name: f.full_name || a.profile?.full_name || '',
        phone: f.phone || (a.profile?.phone?.startsWith('+94') ? '0' + a.profile.phone.slice(3) : a.profile?.phone ?? ''),
      }));
    });
  }, [session, store.id]);

  const set = (k: keyof typeof form) => (v: string) => { setForm((f) => ({ ...f, [k]: v })); setMissing((m) => ({ ...m, [k]: '' })); };

  async function place() {
    const phone = normalisePhone(form.phone);
    const m: Record<string, string> = {};
    if (!form.full_name.trim()) m.full_name = 'Your name, please.';
    if (!phone) m.phone = 'A number we can reach you on, e.g. 077 123 4567.';
    if (method === 'delivery' && !form.line1.trim()) m.line1 = 'The street address, please.';
    if (method === 'delivery' && !form.city.trim()) m.city = 'The town or city, please.';
    setMissing(m);
    if (Object.values(m).some(Boolean)) { setError('Please fill in the highlighted details.'); return; }
    if (!pay) { setError('This shop has no payment method set up yet.'); return; }
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase.rpc('checkout', {
      p_organization_id: store.id, p_lines: cartLines(cart.items), p_idempotency_key: idempotencyKey,
      p_contact: { full_name: form.full_name.trim(), phone, email: form.email.trim() || null },
      p_fulfilment: method === 'delivery'
        ? { method, address: { line1: form.line1.trim(), line2: form.line2.trim() || null, city: form.city.trim(), postcode: form.postcode.trim() || null } }
        : { method },
      p_payment_method: pay, p_channel: 'mobile_app', p_note: form.note.trim() || null, p_coupon: coupon,
    });
    setBusy(false);
    if (e) {
      setError(e.code === 'NC001' ? `${describeError(e)} Someone may have just bought it - please check your cart.` : describeError(e));
      return;
    }
    const o = data as unknown as OrderSummary;
    await rememberOrder({ id: o.order_id, token: o.access_token!, number: o.number, placedAt: o.placed_at, total: o.total });
    cart.clear();
    router.dismissAll();
    router.replace({ pathname: '/order/[id]', params: { id: o.order_id, token: o.access_token!, fresh: '1' } });
  }

  if (!cart.items.length) return <Loader />;
  const cur = store.currency_code;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        {!session && (
          <Pressable onPress={() => router.push('/account')} accessibilityRole="link">
            <Text size={14} tone="ink2">Have an account? <Text size={14} weight="600">Sign in</Text> to collect points and see your orders anywhere.</Text>
          </Pressable>
        )}
        <View style={{ gap: 12 }}>
          <Text size={18} weight="700">Your details</Text>
          <Field label="Full name" value={form.full_name} onChangeText={set('full_name')} autoComplete="name" textContentType="name" error={missing.full_name} />
          <Field label="Mobile number" value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" error={missing.phone} />
          <Field label="Email (optional)" value={form.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" autoComplete="email" hint="For your receipt." />
        </View>

        <View style={{ gap: 12 }}>
          <Text size={18} weight="700">{method === 'delivery' ? 'Delivery address' : 'Collect from'}</Text>
          {method === 'delivery' ? (
            <>
              <Field label="Street address" value={form.line1} onChangeText={set('line1')} autoComplete="street-address" error={missing.line1} />
              <Field label="Apartment, landmark (optional)" value={form.line2} onChangeText={set('line2')} />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 2 }}><Field label="Town or city" value={form.city} onChangeText={set('city')} error={missing.city} /></View>
                <View style={{ flex: 1 }}><Field label="Postcode" value={form.postcode} onChangeText={set('postcode')} keyboardType="number-pad" /></View>
              </View>
            </>
          ) : (
            <Card>
              <Text weight="600">{store.pickup_locations[0]?.name ?? store.name}</Text>
              {store.pickup_locations[0]?.address && <Text tone="ink2" size={14}>{Object.values(store.pickup_locations[0].address).filter(Boolean).join(', ')}</Text>}
              <Text tone="ink3" size={13} style={{ marginTop: 6 }}>We&apos;ll tell you when it&apos;s ready.</Text>
            </Card>
          )}
        </View>

        <View style={{ gap: 10 }}>
          <Text size={18} weight="700">Payment</Text>
          {payOptions.length === 0 ? <ErrorNote message="This shop has no payment method set up yet." /> : payOptions.map((p) => {
            const [label, sub] = PAY_LABEL[p] ?? [p, ''];
            const on = pay === p;
            return (
              <Pressable key={p} onPress={() => setPay(p)} accessibilityRole="radio" accessibilityState={{ checked: on }}
                style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14, borderRadius: radius.md, borderWidth: on ? 2 : 1, borderColor: on ? t.ink : t.line, backgroundColor: t.surface }}>
                <Feather name={on ? 'check-circle' : 'circle'} size={20} color={on ? t.ink : t.ink3} />
                <View style={{ flex: 1 }}>
                  <Text weight="600">{p === 'cash_on_delivery' && method === 'pickup' ? 'Pay when you collect' : label}</Text>
                  <Text size={13} tone="ink2">{sub}</Text>
                </View>
              </Pressable>
            );
          })}
          {pay === 'bank_transfer' && store.bank_transfer_details && <Text size={13} tone="ink2">You&apos;ll see the bank details after placing the order.</Text>}
        </View>

        <Field label="Note for the shop (optional)" value={form.note} onChangeText={set('note')} multiline style={{ minHeight: 80, paddingTop: 12, textAlignVertical: 'top' }} />

        <Card>
          <Text weight="600" style={{ marginBottom: 10 }}>{cart.items.length} item{cart.items.length === 1 ? '' : 's'}</Text>
          {quote ? <Totals quote={quote} currency={cur} /> : <Text tone="ink2">{quoteError ?? 'Working out your total...'}</Text>}
        </Card>

        <ErrorNote message={error} />
        <Button title={busy ? 'Placing your order...' : quote ? `Place order · ${money(quote.total, cur)}` : 'Place order'}
          busy={busy} disabled={!pay || !quote} onPress={place} />
        <Text size={12} tone="ink3" center>Your items are checked against live stock when you place the order.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
