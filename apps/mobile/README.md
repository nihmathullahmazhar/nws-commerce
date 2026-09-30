# NWS Commerce - customer app

The shop in an app (Expo / React Native, Android and iOS), on the same API as the
online store. Catalogue, search, cart, checkout, order tracking, and an account
with loyalty points and every order - app, website or counter - in one place.

App orders are tagged `mobile_app`, so reports can tell the channels apart and
promotions can be limited to the app. The business needs the **mobile_app**
module (Enterprise plan, or switched on by NWS).

## One build per client

Nothing in the code is client-specific. Copy `.env.example` to `.env.local` (for
development) or set the same variables in the build environment:

| Variable | What it is |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | The client's Supabase project |
| `EXPO_PUBLIC_STORE_SLUG` | `organizations.slug` of the business |
| `EXPO_PUBLIC_BRAND_COLOR` (+ optional `_DARK`) | The one brand colour; everything else is neutral |
| `APP_NAME`, `APP_ID`, `APP_SLUG`, `APP_SCHEME` | Store listing name, bundle / package id, deep-link scheme |

Icons and splash art go in `assets/` per client (not included yet: the default
Expo icon is used until a client's artwork is added).

## Running

```bash
npm install            # this app has its own node_modules (React Native pins React exactly)
npx expo start         # Expo Go / dev build; press w for the web preview
```

On a phone, `EXPO_PUBLIC_SUPABASE_URL` must be reachable from the phone - the
local stand-in at `localhost:54321` is not. Use the hosted Supabase project or
the Mac's LAN address.

## Android release build (local, no Expo account)

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=~/Library/Android/sdk
npx expo prebuild --platform android --clean
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a
# -> android/app/build/outputs/apk/release/app-release.apk
```

`react-native-reanimated` 4.5.1 and `react-native-worklets` 0.10.1 are pinned on
purpose: newer worklets break the Expo 57 native build. Release builds use the
debug signing key; set up a real keystore before a Play Store upload. iOS builds
need Xcode and the client's Apple developer account.
