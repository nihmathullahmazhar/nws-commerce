import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { useCart } from '@/lib/cart';
import { useStore } from '@/lib/store';

export default function TabsLayout() {
  const t = useTheme();
  const { count } = useCart();
  const store = useStore();
  const icon = (name: keyof typeof Feather.glyphMap) => ({ color, size }: { color: ColorValue; size: number }) => <Feather name={name} color={color as string} size={size - 2} />;
  return (
    <Tabs screenOptions={{
      headerStyle: { backgroundColor: t.bg }, headerTintColor: t.ink, headerShadowVisible: false, headerTitleStyle: { fontWeight: '700' },
      tabBarActiveTintColor: t.ink, tabBarInactiveTintColor: t.ink3,
      tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.line }, sceneStyle: { backgroundColor: t.bg },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Shop', headerTitle: store.name, tabBarIcon: icon('home') }} />
      <Tabs.Screen name="search" options={{ title: 'Search', tabBarIcon: icon('search') }} />
      <Tabs.Screen name="cart" options={{
        title: 'Cart', tabBarIcon: icon('shopping-bag'),
        tabBarBadge: count > 0 ? (count > 99 ? '99+' : count) : undefined,
        tabBarBadgeStyle: { backgroundColor: t.brand, color: t.brandFg, fontSize: 11 },
      }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: icon('user') }} />
    </Tabs>
  );
}
