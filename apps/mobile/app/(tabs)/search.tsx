import { useEffect, useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';
import { useTheme } from '@/lib/theme';
import { Listing, SORTS } from '@/components/Listing';
import { Chip, Field, Text } from '@/components/ui';

export default function Search() {
  const t = useTheme();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<string | null>(null);
  const [inStock, setInStock] = useState(false);
  useEffect(() => { const h = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(h); }, [text]);

  const header = (
    <View style={{ gap: 14 }}>
      <Field label="Search" value={text} onChangeText={setText} placeholder="What are you looking for?" autoFocus
        returnKeyType="search" autoCorrect={false} clearButtonMode="while-editing" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {SORTS.map((s) => <Chip key={s.value} label={s.label} active={(sort ?? (q ? '' : 'newest')) === s.value} onPress={() => setSort(sort === s.value ? null : s.value)} />)}
      </ScrollView>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text tone="ink2">In stock only</Text>
        <Switch value={inStock} onValueChange={setInStock} trackColor={{ true: t.brand, false: t.line }} accessibilityLabel="In stock only" />
      </View>
    </View>
  );
  // With words and no chosen order, the best matches come first.
  return <Listing query={q || null} sort={sort ?? (q ? 'relevance' : 'newest')} inStock={inStock} header={header} emptyTitle={q ? `Nothing matches "${q}"` : 'No products yet'} />;
}
