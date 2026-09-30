import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useStoreState } from '@/lib/store';
import { Listing, SORTS } from '@/components/Listing';
import { Chip } from '@/components/ui';

export default function Category() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { categories } = useStoreState();
  const [sort, setSort] = useState('newest');
  const cat = categories.find((c) => c.slug === slug);
  const children = categories.filter((c) => c.parentId === cat?.id && c.count > 0);

  const header = (
    <View style={{ gap: 12 }}>
      {children.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {children.map((c) => <Chip key={c.id} label={c.name} onPress={() => router.push(`/c/${c.slug}`)} />)}
        </ScrollView>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {SORTS.map((s) => <Chip key={s.value} label={s.label} active={sort === s.value} onPress={() => setSort(s.value)} />)}
      </ScrollView>
    </View>
  );
  return (
    <>
      <Stack.Screen options={{ title: cat?.name ?? '' }} />
      <Listing category={slug} sort={sort} header={header} emptyTitle="Nothing in this category yet" />
    </>
  );
}
