import AsyncStorage from '@react-native-async-storage/async-storage';

// Orders placed without an account are remembered on this phone by their
// private link (id + token), so the shopper can still follow them.
export interface SavedOrder { id: string; token: string; number: string; placedAt: string; total: number }
const KEY = 'nwsc-app-orders-v1';

export async function savedOrders(): Promise<SavedOrder[]> {
  try { return JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]'); } catch { return []; }
}

export async function rememberOrder(o: SavedOrder) {
  const all = (await savedOrders()).filter((x) => x.id !== o.id);
  await AsyncStorage.setItem(KEY, JSON.stringify([o, ...all].slice(0, 50)));
}
