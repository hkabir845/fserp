# FSERP Android app (Capacitor)

The Android app is a **WebView shell** that loads your deployed FSERP site. Distribution is **direct APK download** from the login page — **no Google Play Store** required.

All SaaS tenants share the same APK. Users download it once, install (sideload), and sign in with their usual credentials.

## Prerequisites

- Node.js 20+ (Capacitor CLI 8 recommends 22+; Node 20 usually works for `cap sync`)
- [Android Studio](https://developer.android.com/studio) with SDK 34+
- JDK 17

## Setup

```bash
cd mobile
npm install
npx cap add android   # first time only
npx cap sync android
```

## Point at your deployment

Default URL: `https://mahasoftcorporation.com`

```bash
# Linux / macOS
FSERP_APP_URL=https://your-domain.com npm run sync

# Windows PowerShell
$env:FSERP_APP_URL="https://your-domain.com"; npm run sync
```

## Build signed APK (sideload)

You only need an **APK**, not an AAB (Play Store bundle).

```bash
cd mobile
npm run sync
npx cap open android
```

In Android Studio: **Build → Generate Signed Bundle / APK → APK → release**.

Or from CLI (after `local.properties` exists):

```bash
cd mobile/android
./gradlew assembleRelease
# APK: android/app/build/outputs/apk/release/app-release-unsigned.apk
```

Sign the APK before distributing (Android Studio signed build, or `apksigner`).

## Host APK for the login download button

1. Copy the signed APK to `frontend/public/downloads/fserp.apk`
2. Or set `NEXT_PUBLIC_ANDROID_APK_URL=https://your-domain.com/downloads/fserp.apk` in `frontend/.env`
3. Redeploy the frontend

Users tap **Download Android app** on `/login`, install the APK, and open the app.

### Updating the app later

Build a new signed APK, replace `fserp.apk` on the server, and ask users to download and install again (Android will upgrade in place if the signing key matches).

## Mobile / Android compatibility

- **Login page**: scrolls on small screens, 44px+ touch targets, 16px inputs (no zoom on focus), safe-area padding for notched phones.
- **PWA manifest**: PNG icons at `frontend/public/icons/` for optional “install web app” in Chrome (also not Play Store).
- **Capacitor WebView**: `adjustResize` so the keyboard does not cover login fields.
- **In-app ERP**: existing mobile sidebar, `100dvh` shell, and safe-area CSS in `globals.css`.

## App ID

- Package: `com.mahasoft.fserp`
- Change in `capacitor.config.ts` only if you need a different package name for your organization.
