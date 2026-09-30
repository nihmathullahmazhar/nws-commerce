import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import type { CatalogItem } from '@nws-commerce/db';
import { money } from '@/lib/format';
import { Badge, Price, ProductImage, Text } from './ui';

export function ProductCard({ item, currency }: { item: CatalogItem; currency: string }) {
  const range = item.max_price > item.min_price;
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`${item.name}, ${range ? 'from ' : ''}${money(item.min_price, currency)}${item.in_stock ? '' : ', sold out'}`}
      onPress={() => router.push(`/p/${item.slug}`)}
      style={({ pressed }) => ({ flex: 1, gap: 8, opacity: pressed ? 0.75 : 1 })}>
      <View>
        <ProductImage path={item.image} name={item.name} />
        {!item.in_stock && <View style={{ position: 'absolute', top: 8, left: 8 }}><Badge label="Sold out" /></View>}
      </View>
      <View style={{ gap: 2 }}>
        {item.brand && <Text size={12} tone="ink3" numberOfLines={1}>{item.brand}</Text>}
        <Text size={14} weight="500" numberOfLines={2}>{item.name}</Text>
        {range ? <Text size={14} weight="600">From {money(item.min_price, currency)}</Text>
               : <Price price={item.min_price} compareAt={item.compare_at_price} currency={currency} size={14} />}
      </View>
    </Pressable>
  );
}
