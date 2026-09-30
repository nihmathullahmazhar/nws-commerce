import { useColorScheme } from 'react-native';

// Neutral by design - one brand colour per client - so any catalogue looks at
// home. Mirrors the online store's tokens.
const brand = process.env.EXPO_PUBLIC_BRAND_COLOR ?? '#2b2a27';

const light = {
  brand, brandFg: '#ffffff', bg: '#faf9f6', surface: '#ffffff', tile: '#f1efea', line: '#e6e2da',
  ink: '#1c1b18', ink2: '#57534b', ink3: '#8b867b', sale: '#a4401b', ok: '#2f6b3b', warn: '#8a5a00', danger: '#b3261e',
  okSoft: '#e6f1e8', warnSoft: '#f7eedb', dangerSoft: '#f8e5e3',
};
const dark: typeof light = {
  // A dark brand colour disappears on a dark background, so dark mode uses the ink colour.
  brand: process.env.EXPO_PUBLIC_BRAND_COLOR_DARK ?? '#f0ede6', brandFg: '#1a1916', bg: '#141412', surface: '#1b1b18', tile: '#23221f',
  line: '#302f2b', ink: '#f0ede6', ink2: '#b7b2a7', ink3: '#85817a', sale: '#f08a60', ok: '#7ac48a', warn: '#e5b45a', danger: '#f2877f',
  okSoft: '#1d2e21', warnSoft: '#33290f', dangerSoft: '#3a1c19',
};

export type Theme = typeof light;
export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
export const radius = { sm: 6, md: 10, lg: 14 };
