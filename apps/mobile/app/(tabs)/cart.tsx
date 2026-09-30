import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import type { Enums } from '@nws-commerce/db';
import { useStore } from '@/lib/store';
import { useCart } from '@/lib/cart';
import { useQuote } from '@/lib/quote';
import { money, qty } from '@/lib/format';
import { radius, useTheme } from '@/lib/theme';
import { Button, Card, Chip, EmptyState, ErrorNote, Field, Loader, ProductImage, Stepper, Text, Totals } from '@/components/ui';

export default function Cart() {
  const store = useStore();
  const cart = useCart();
  const t = useTheme();
  const [method, setMethod] = useState<Enums['fulfilment_method']>(store.delivery_enabled ? 'delivery' : 'pickup');
  const [coupon, setCoupon] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const { quote, error, couponError, loading } = useQuote(store.id, cart.items, method, store.coupons_enabled ? coupon : null);
  const cur = store.currency_code;

  if (!cart.ready) return <Loader />;
  if (!cart.items.length) {
    return <EmptyState icon="shopping-bag" title="Your cart is empty" body="Things you add show up here." action={<Button title="Start shopping" onPress={() => router.navigate('/')} />} />;
  }
  // The database's price per line, when the quote has it (it can differ from what was on screen earlier).
  const lineTotal = (variantId: string) => quote?.lines.find((l) => l.variant_id === variantId)?.line_total;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
      <Card padded={false}>
        {cart.items.map((i, idx) => (
          <View key={i.variantId} style={{ flexDirection: 'row', gap: 12, padding: 14, borderTopWidth: idx ? 1 : 0, borderTopColor: t.line }}>
            <Pressable onPress={() => router.push(`/p/${i.productSlug}`)} accessibilityRole="link" accessibilityLabel={i.name}>
              <ProductImage path={i.image} name={i.name} size={72} />
            </Pressable>
            <View style={{ flex: 1, gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text weight="500" numberOfLines={2}>{i.name}</Text>
                  {i.variant !== 'Default' && <Text size={13} tone="ink3">{i.variant}</Text>}
                </View>
                <Text weight="600">{money(lineTotal(i.variantId) ?? i.price * i.quantity, cur)}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                {i.fractional ? <Text tone="ink2">{qty(i.quantity, i.unit)}</Text>
                  : <Stepper label={i.name} value={i.quantity} min={0} onChange={(v) => cart.setQuantity(i.variantId, v)} />}
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${i.name}`} hitSlop={8} onPress={() => cart.setQuantity(i.variantId, 0)}>
                  <Feather name="trash-2" size={18} color={t.ink3} />
                </Pressable>
              </View>
            </View>
          </View>
        ))}
      </Card>

      {store.delivery_enabled && store.pickup_enabled && (
        <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup">
          <Chip label="Delivery" active={method === 'delivery'} onPress={() => setMethod('delivery')} />
          <Chip label="Collect in store" active={method === 'pickup'} onPress={() => setMethod('pickup')} />
        </View>
      )}

      {store.coupons_enabled && (
        coupon && !couponError ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: t.line, borderRadius: radius.md, padding: 12 }}>
            <Text>Code <Text weight="600">{coupon}</Text></Text>
            <Pressable onPress={() => setCoupon(null)} accessibilityRole="button"><Text tone="ink2" size={14}>Remove</Text></Pressable>
          </View>
        ) : (
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
              <View style={{ flex: 1 }}>
                <Field label="Coupon code" value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false}
                  onSubmitEditing={() => { if (code.trim()) { setCoupon(code.trim().toUpperCase()); setCode(''); } }} returnKeyType="done" />
              </View>
              <Button title="Apply" variant="secondary" disabled={!code.trim()} onPress={() => { setCoupon(code.trim().toUpperCase()); setCode(''); }} />
            </View>
            {couponError && coupon && <Text size={13} tone="danger">{coupon}: {couponError}</Text>}
          </View>
        )
      )}

      <Card>
        <ErrorNote message={error} />
        {quote ? <Totals quote={quote} currency={cur} /> : !error && <Loader label="Working out your total" />}
        {method === 'delivery' && store.free_delivery_over && quote && quote.shipping_total > 0 && (
          <Text size={13} tone="ink2" style={{ marginTop: 10 }}>
            Spend {money(store.free_delivery_over - (quote.total - quote.shipping_total), cur)} more for free delivery.
          </Text>
        )}
      </Card>

      <Button title="Checkout" disabled={!quote || loading || !!error}
        onPress={() => router.push({ pathname: '/checkout', params: { method, ...(coupon && !couponError ? { coupon } : {}) } })} />
    </ScrollView>
  );
}
