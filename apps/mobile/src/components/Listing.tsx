import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import type { CatalogItem, CatalogResult } from '@nws-commerce/db';
import { supabase } from '@/lib/supabase';
import { useStore } from '@/lib/store';
import { describeError } from '@/lib/errors';
import { useTheme } from '@/lib/theme';
import { ProductCard } from './ProductCard';
import { EmptyState, ErrorNote, Loader, Text } from './ui';

export const SORTS = [
  { value: 'newest', label: 'Newest' }, { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' }, { value: 'name', label: 'Name' },
] as const;
const PAGE = 20;

/** A two-column, endlessly scrolling product grid over storefront_catalog. */
export function Listing({ category = null, query = null, sort, inStock = false, header, emptyTitle = 'Nothing here yet' }: {
  category?: string | null; query?: string | null; sort: string; inStock?: boolean; header?: ReactElement; emptyTitle?: string;
}) {
  const store = useStore();
  const t = useTheme();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const request = useRef(0);
  const key = JSON.stringify([category, query, sort, inStock]);

  const load = useCallback(async (offset: number) => {
    const id = ++request.current;
    setLoading(true);
    const { data, error: e } = await supabase.rpc('storefront_catalog', {
      p_organization_id: store.id, p_category_slug: category, p_query: query, p_sort: sort,
      p_filters: inStock ? { in_stock: true } : {}, p_limit: PAGE, p_offset: offset,
    });
    if (id !== request.current) return;
    setLoading(false);
    setRefreshing(false);
    if (e) { setError(describeError(e)); return; }
    const r = data as unknown as CatalogResult;
    setError(null);
    setTotal(r.total);
    setItems((xs) => (offset === 0 ? r.items : [...xs, ...r.items]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id, key]);

  useEffect(() => { setItems([]); setTotal(null); void load(0); }, [load]);

  const more = () => { if (!loading && total !== null && items.length < total) void load(items.length); };

  return (
    <FlatList
      data={items}
      keyExtractor={(i) => i.id}
      numColumns={2}
      columnWrapperStyle={{ gap: 14 }}
      contentContainerStyle={{ padding: 16, gap: 22, flexGrow: 1 }}
      renderItem={({ item }) => <View style={{ flex: 1, maxWidth: '50%' }}><ProductCard item={item} currency={store.currency_code} /></View>}
      onEndReached={more}
      onEndReachedThreshold={0.6}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={t.ink2} onRefresh={() => { setRefreshing(true); void load(0); }} />}
      ListHeaderComponent={<View style={{ gap: 16 }}>
        {header}
        <ErrorNote message={error} onRetry={() => void load(0)} />
        {total !== null && total > 0 && <Text size={13} tone="ink3">{total} product{total === 1 ? '' : 's'}</Text>}
      </View>}
      ListEmptyComponent={total === null ? (loading ? <Loader /> : null)
        : <EmptyState icon="package" title={emptyTitle} body={query ? 'Try fewer words, or another spelling.' : undefined} />}
      ListFooterComponent={loading && items.length > 0 ? <Loader /> : null}
    />
  );
}
