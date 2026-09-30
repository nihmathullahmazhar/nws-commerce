import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ProductPage } from '@nws-commerce/db';
import { supabase } from '@/lib/supabase';
import { useStore } from '@/lib/store';
import { useCart } from '@/lib/cart';
import { describeError } from '@/lib/errors';
import { money, qty } from '@/lib/format';
import { radius, useTheme } from '@/lib/theme';
import { Button, Chip, Divider, EmptyState, ErrorNote, Loader, Price, ProductImage, Stepper, Text } from '@/components/ui';

export default function Product() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const store = useStore();
  const cart = useCart();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [product, setProduct] = useState<ProductPage | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<Record<string, number>>({});
  const [chosen, setChosen] = useState<string[]>([]);
  const [n, setN] = useState(1);
  const [added, setAdded] = useState(false);
  const [photo, setPhoto] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: e } = await supabase.rpc('storefront_product', { p_organization_id: store.id, p_slug: slug });
    if (e) { setError(describeError(e)); return; }
    const p = (data ?? null) as unknown as ProductPage | null;
    setProduct(p);
    if (!p) return;
    const first = p.variants.find((v) => v.available > 0) ?? p.variants[0];
    setChosen(first?.option_values ?? []);
    setLive(Object.fromEntries(p.variants.map((v) => [v.id, v.available])));
    // Stock moves while the page is open; ask again for the live numbers.
    const a = await supabase.rpc('storefront_availability', { p_organization_id: store.id, p_variant_ids: p.variants.map((v) => v.id) });
    if (a.data) setLive(Object.fromEntries(a.data.map((r) => [r.variant_id!, Number(r.available ?? 0)])));
  }, [store.id, slug]);
  useEffect(() => { void load(); }, [load]);

  const variant = useMemo(() => {
    if (!product) return undefined;
    if (!product.options.length) return product.variants[0];
    return product.variants.find((v) => (v.option_values ?? []).every((x, i) => x === chosen[i]));
  }, [product, chosen]);

  if (error) return <View style={{ padding: 16 }}><ErrorNote message={error} onRetry={load} /></View>;
  if (product === undefined) return <Loader />;
  if (product === null) return <EmptyState icon="search" title="This product isn't available" body="It may have been taken off sale." action={<Button title="Keep shopping" onPress={() => router.back()} />} />;

  const available = variant ? live[variant.id] ?? 0 : 0;
  const inCart = cart.items.find((i) => i.variantId === variant?.id)?.quantity ?? 0;
  const room = Math.max(available - inCart, 0);
  const unlimited = available >= 999999;
  const photos = product.media.filter((m) => !m.variant_id || m.variant_id === variant?.id);
  const cur = store.currency_code;

  function add() {
    if (!variant || !product) return;
    cart.add({
      variantId: variant.id, productSlug: product.slug, name: product.name, variant: variant.title, sku: variant.sku,
      price: variant.price, image: photos[0]?.path ?? null, unit: product.unit_of_measure, fractional: product.allow_fractional,
    }, n);
    setAdded(true);
    setN(1);
  }

  return (
    <>
      <Stack.Screen options={{ title: '' }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>
        <View style={{ padding: 16, gap: 10 }}>
          <ProductImage path={photos[photo]?.path} name={product.name} />
          {photos.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {photos.map((m, i) => (
                <Pressable key={m.path} onPress={() => setPhoto(i)} accessibilityRole="button" accessibilityLabel={`Photo ${i + 1}`}
                  style={{ borderWidth: 2, borderColor: i === photo ? t.ink : 'transparent', borderRadius: radius.md }}>
                  <ProductImage path={m.path} name={product.name} size={64} />
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>

        <View style={{ paddingHorizontal: 16, gap: 18 }}>
          <View style={{ gap: 6 }}>
            {product.brand && <Text tone="ink3" size={13}>{product.brand.name}</Text>}
            <Text size={24} weight="700">{product.name}</Text>
            {variant ? <Price price={variant.price} compareAt={variant.compare_at_price} currency={cur} size={20} />
                     : <Text tone="ink2">This combination isn&apos;t available.</Text>}
            {product.unit_of_measure !== 'each' && <Text size={13} tone="ink3">Price per {product.unit_of_measure}</Text>}
            {product.summary && <Text tone="ink2">{product.summary}</Text>}
          </View>

          {product.options.map((o, oi) => (
            <View key={o.name} style={{ gap: 8 }}>
              <Text weight="600">{o.name}{chosen[oi] ? <Text tone="ink2">{`: ${chosen[oi]}`}</Text> : null}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {o.values.map((val) => {
                  const next = chosen.map((c, i) => (i === oi ? val : c));
                  const v = product.variants.find((x) => (x.option_values ?? []).every((y, i) => y === next[i]));
                  const out = !v || (live[v.id] ?? 0) <= 0;
                  return <Chip key={val} label={out ? `${val} · sold out` : val} active={chosen[oi] === val} onPress={() => { setChosen(next); setAdded(false); }} />;
                })}
              </View>
            </View>
          ))}

          {variant && (
            <Text weight="500" tone={available <= 0 ? 'danger' : available <= 3 ? 'warn' : 'ok'}>
              {available <= 0 ? 'Sold out' : unlimited ? 'Available' : available <= 3 ? `Only ${qty(available, product.unit_of_measure)} left` : 'In stock'}
            </Text>
          )}

          {product.description && (
            <View style={{ gap: 8 }}>
              <Divider />
              <Text size={17} weight="700">About this product</Text>
              <Text tone="ink2" style={{ lineHeight: 22 }}>{product.description}</Text>
            </View>
          )}

          {product.specifications.length > 0 && (
            <View style={{ gap: 10 }}>
              <Divider />
              <Text size={17} weight="700">Specifications</Text>
              {product.specifications.map((s) => (
                <View key={s.label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 16 }}>
                  <Text tone="ink2" style={{ flexShrink: 1 }}>{s.label}</Text>
                  <Text weight="500" style={{ flexShrink: 1, textAlign: 'right' }}>
                    {typeof s.value === 'boolean' ? (s.value ? 'Yes' : 'No') : Array.isArray(s.value) ? s.value.join(', ') : String(s.value)}{s.unit ? ` ${s.unit}` : ''}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {product.related.length > 0 && (
            <View style={{ gap: 10 }}>
              <Divider />
              <Text size={17} weight="700">You may also like</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
                {product.related.map((r) => (
                  <Pressable key={r.slug} onPress={() => router.push(`/p/${r.slug}`)} accessibilityRole="link" style={{ width: 132, gap: 6 }}>
                    <ProductImage path={r.image} name={r.name} size={132} />
                    <Text size={13} numberOfLines={2}>{r.name}</Text>
                    <Text size={13} weight="600">{money(r.min_price, cur)}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      </ScrollView>

      {/* The buy bar stays in reach of the thumb. */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, paddingBottom: Math.max(insets.bottom, 12),
                     backgroundColor: t.surface, borderTopWidth: 1, borderTopColor: t.line, gap: 10 }}>
        {added ? (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Keep shopping" variant="secondary" style={{ flex: 1 }} onPress={() => setAdded(false)} />
            <Button title="View cart" icon="shopping-bag" style={{ flex: 1 }} onPress={() => router.navigate('/cart')} />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            {!product.allow_fractional && room > 1 && <Stepper label="quantity" value={n} min={1} max={unlimited ? 99 : room} onChange={setN} />}
            <Button style={{ flex: 1 }} icon="shopping-bag" disabled={!variant || room < n || n <= 0} onPress={add}
              title={!variant ? 'Choose an option' : available <= 0 ? 'Sold out' : room <= 0 ? 'All in your cart' : 'Add to cart'} />
          </View>
        )}
        {inCart > 0 && !added && <Text size={12} tone="ink3" center>{qty(inCart)} already in your cart</Text>}
      </View>
    </>
  );
}
