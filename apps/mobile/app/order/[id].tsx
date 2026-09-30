import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import type { Enums, OrderSummary } from '@nws-commerce/db';
import { supabase } from '@/lib/supabase';
import { useStore } from '@/lib/store';
import { describeError } from '@/lib/errors';
import { dateTime, money, qty } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { Badge, Button, Card, Divider, ErrorNote, Loader, Text, Totals } from '@/components/ui';

type Order = OrderSummary & { gift_cards: { code: string; value: number; balance: number }[]; points_earned: number | null };

const STATUS: Record<Enums['order_status'], { label: string; tone: 'neutral' | 'ok' | 'warn' | 'danger' }> = {
  pending_payment: { label: 'Waiting for payment', tone: 'warn' }, confirmed: { label: 'Confirmed', tone: 'ok' },
  completed: { label: 'Completed', tone: 'ok' }, cancelled: { label: 'Cancelled', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'neutral' }, stock_conflict: { label: 'Being checked', tone: 'warn' },
};
const CHANNEL: Record<Enums['sales_channel'], string> = {
  online: 'Online', pos: 'In store', mobile_app: 'In the app', phone_order: 'By phone', admin_order: 'By the shop',
};

export default function OrderScreen() {
  const { id, token, fresh } = useLocalSearchParams<{ id: string; token: string; fresh?: string }>();
  const store = useStore();
  const t = useTheme();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('get_order_by_token', { p_order_id: id, p_token: token ?? '' });
    setRefreshing(false);
    if (e) setError(describeError(e)); else { setError(null); setOrder(data as unknown as Order); }
  }, [id, token]);
  useEffect(() => { void load(); }, [load]);

  if (error) return <View style={{ padding: 16 }}><ErrorNote message={error} onRetry={load} /></View>;
  if (!order) return <Loader />;
  const cur = order.currency_code;
  const st = STATUS[order.status];
  const due = order.balance_due > 0 && ['pending_payment', 'confirmed'].includes(order.status);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={t.ink2} onRefresh={() => { setRefreshing(true); void load(); }} />}>
      {fresh === '1' && (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 12 }}>
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: t.okSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="check" size={28} color={t.ok} />
          </View>
          <Text size={22} weight="700" center>Thank you!</Text>
          <Text tone="ink2" center>Your order {order.number} is placed. We&apos;ll contact you on {order.contact.phone}.</Text>
        </View>
      )}

      <Card style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text size={18} weight="700">{order.number}</Text>
          <Badge label={st.label} tone={st.tone} />
        </View>
        <Text tone="ink2" size={14}>{CHANNEL[order.channel]} · {dateTime(order.placed_at)}</Text>
        {order.channel !== 'pos' && (
          <Text tone="ink2" size={14}>
            {order.fulfilment_method === 'pickup' ? `Collect from ${store.pickup_locations[0]?.name ?? store.name}`
              : `Delivering to ${[order.shipping_address?.line1, order.shipping_address?.city].filter(Boolean).join(', ')}`}
          </Text>
        )}
      </Card>

      {due && order.intended_payment_method === 'bank_transfer' && store.bank_transfer_details && (
        <Card style={{ gap: 6 }}>
          <Text weight="600">Pay by bank transfer</Text>
          <Text tone="ink2">{store.bank_transfer_details}</Text>
          <Text tone="ink2">Amount: <Text weight="600">{money(order.balance_due, cur)}</Text> · Reference: <Text weight="600">{order.number}</Text></Text>
          {order.reservation_expires_at && <Text size={13} tone="warn">We hold your items until {dateTime(order.reservation_expires_at)}.</Text>}
        </Card>
      )}

      <Card style={{ gap: 12 }}>
        {order.lines.map((l) => (
          <View key={l.line_id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
            <Text style={{ flex: 1 }}>{qty(l.quantity)} × {l.name}{l.variant !== 'Default' ? ` (${l.variant})` : ''}</Text>
            <Text weight="500">{money(l.line_total, cur)}</Text>
          </View>
        ))}
        <Divider />
        <Totals quote={order} currency={cur} />
        {order.amount_paid > 0 && <Text size={13} tone="ink2">Paid {money(order.amount_paid, cur)}{order.amount_refunded > 0 ? ` · refunded ${money(order.amount_refunded, cur)}` : ''}</Text>}
      </Card>

      {order.gift_cards.length > 0 && (
        <Card style={{ gap: 8 }}>
          <Text weight="600">Your gift card{order.gift_cards.length > 1 ? 's' : ''}</Text>
          <Text size={13} tone="ink2">Give the code to whoever will use it. Keep it private: the code is the card.</Text>
          {order.gift_cards.map((g) => (
            <View key={g.code} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text weight="600" style={{ fontFamily: 'monospace' }} >{g.code}</Text>
              <Text>{money(g.balance, cur)}</Text>
            </View>
          ))}
        </Card>
      )}
      {order.points_earned ? <Text tone="ink2" center>This order earned you {order.points_earned.toLocaleString()} points.</Text> : null}

      {fresh === '1' && <Button title="Keep shopping" variant="secondary" onPress={() => router.navigate('/')} />}
    </ScrollView>
  );
}
