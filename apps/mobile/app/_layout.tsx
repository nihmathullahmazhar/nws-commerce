import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StoreProvider, useStoreState } from '@/lib/store';
import { AuthProvider } from '@/lib/auth';
import { CartProvider } from '@/lib/cart';
import { useTheme } from '@/lib/theme';
import { Button, EmptyState, Loader } from '@/components/ui';

function Gate() {
  const t = useTheme();
  const { store, error, reload } = useStoreState();
  if (!store) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg, justifyContent: 'center' }}>
        {error ? <EmptyState icon="wifi-off" title="The shop didn't open" body={error} action={<Button title="Try again" onPress={reload} />} />
               : <Loader label="Opening the shop" />}
      </SafeAreaView>
    );
  }
  return (
    <Stack screenOptions={{
      headerStyle: { backgroundColor: t.bg }, headerTintColor: t.ink, headerShadowVisible: false,
      headerTitleStyle: { fontWeight: '600' }, headerBackButtonDisplayMode: 'minimal', contentStyle: { backgroundColor: t.bg },
    }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false, title: store.name }} />
      <Stack.Screen name="c/[slug]" options={{ title: '' }} />
      <Stack.Screen name="p/[slug]" options={{ title: '' }} />
      <Stack.Screen name="checkout" options={{ title: 'Checkout' }} />
      <Stack.Screen name="order/[id]" options={{ title: 'Order' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const scheme = useColorScheme();
  const t = useTheme();
  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <StoreProvider>
          <AuthProvider>
            <CartProvider>
              <Gate />
            </CartProvider>
          </AuthProvider>
        </StoreProvider>
      </View>
    </SafeAreaProvider>
  );
}
