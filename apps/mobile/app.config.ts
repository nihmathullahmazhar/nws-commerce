import type { ExpoConfig } from 'expo/config';

// One build per client. Everything that differs between businesses comes from
// the environment (see .env.example), so the code is identical for all of them.
const env = process.env;
const name = env.APP_NAME ?? 'NWS Shop';
const id = env.APP_ID ?? 'com.nwsdigital.shop';
const brand = env.EXPO_PUBLIC_BRAND_COLOR ?? '#2b2a27';

const config: ExpoConfig = {
  name,
  slug: env.APP_SLUG ?? 'nws-shop',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: env.APP_SCHEME ?? 'nwsshop',
  userInterfaceStyle: 'automatic',
  ios: { supportsTablet: false, bundleIdentifier: id, infoPlist: { ITSAppUsesNonExemptEncryption: false } },
  android: { package: id, adaptiveIcon: { backgroundColor: brand, foregroundImage: './assets/adaptive-foreground.png' }, predictiveBackGestureEnabled: false },
  web: { bundler: 'metro' },
  plugins: ['expo-router', ['expo-splash-screen', { image: './assets/splash-icon.png', imageWidth: 120, backgroundColor: '#faf9f6', dark: { backgroundColor: '#141412' } }]],
  experiments: { typedRoutes: false },
};

export default config;
