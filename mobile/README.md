# KEYKARD for Android

The KEYKARD app: the same credit line, card, auto-pay, family backup and merchant till as the web app
(`apps/web`), built with Expo SDK 57 / React Native 0.86. It talks to the same servicer and the same Tempo contracts.

| Web | App |
| --- | --- |
| WebAuthn passkeys on keycard-eight.vercel.app | Android Credential Manager passkeys for the **same** domain (`/.well-known/assetlinks.json` vouches for the app), so a passkey account works in both |
| Password wallet (PBKDF2 600k → AES-GCM) | Same vault format, native crypto (react-native-quick-crypto) |
| Burner card via Web NFC | Burner card via libhalo `execHaloCmdRN` + react-native-nfc-manager |
| Merchant code typed or QR | Camera QR scanner, and App Links: scanning a merchant QR with the phone camera opens the app |

The wallet code (`src/lib/wallet.ts`) mirrors `apps/web/lib/wallet.ts`. Android's passkey output is adapted to the
browser WebAuthn shape so `ox` runs the exact same serialization and signature parsing as the web.

## Run

```sh
. /path/to/android-env.sh                   # ANDROID_HOME, GRADLE_USER_HOME …
npm install
npx expo prebuild --platform android        # generates ./android (not committed)
EXPO_PUBLIC_API_URL=http://10.0.2.2:8787 npx expo start   # local servicer from the emulator
cd android && ./gradlew assembleDebug        # or: npx expo run:android
```

Release APK (signed with the KEYKARD key; the keystore and its passwords are **not** in the repo):

```sh
set -a; . /path/to/keykard-secrets/keystore.env; set +a
cd android && ./gradlew assembleRelease     # → android/app/build/outputs/apk/release/app-release.apk
```

The signing key's SHA-256 must be listed in `apps/web/public/.well-known/assetlinks.json` (passkeys + App Links),
and its `android:apk-key-hash:` origin in the servicer's `ANDROID_APP_ORIGINS` (default already set).
