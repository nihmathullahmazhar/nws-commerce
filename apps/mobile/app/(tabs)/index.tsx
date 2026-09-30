import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useStore, useStoreState } from '@/lib/store';
import { useTheme, radius } from '@/lib/theme';
import { Listing } from '@/components/Listing';
import { Text } from '@/components/ui';

export default function Shop() {
  const store = useStore();
  const { categories } = useStoreState();
  const t = useTheme();
  const top = categories.filter((c) => !c.parentId && c.count > 0);

  const header = (
    <View style={{ gap: 20 }}>
      <Pressable accessibilityRole="search" accessibilityLabel="Search products" onPress={() => router.push('/search')}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, paddingHorizontal: 14 }}>
        <Feather name="search" size={18} color={t.ink3} />
        <Text tone="ink3">Search {store.name}</Text>
      </Pressable>
      {top.length > 0 && (
        <View style={{ gap: 10 }}>
          <Text size={18} weight="700">Shop by category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }} style={{ marginHorizontal: -16 }}>
            <View style={{ width: 6 }} />
            {top.map((c) => (
              <Pressable key={c.id} accessibilityRole="link" onPress={() => router.push(`/c/${c.slug}`)}
                style={({ pressed }) => ({ width: 132, padding: 14, gap: 4, borderRadius: radius.lg, backgroundColor: t.tile, opacity: pressed ? 0.75 : 1 })}>
                <Text weight="600" numberOfLines={2}>{c.name}</Text>
                <Text size={12} tone="ink3">{c.count} item{c.count === 1 ? '' : 's'}</Text>
              </Pressable>
            ))}
            <View style={{ width: 6 }} />
          </ScrollView>
        </View>
      )}
      <Text size={18} weight="700">New in</Text>
    </View>
  );

  return <Listing sort="newest" header={header} emptyTitle="No products on sale yet" />;
}
