# FSERP Android app (Capacitor)

The Android app is a **WebView shell** that loads your deployed FSERP site. Distribution is **direct APK download** from the login page — **no Google Play Store** required.

## Flavors

| Flavor | Command | Package id | Opens | Aquaculture |
|--------|---------|------------|-------|-------------|
| **Adib** (dedicated) | `npm run sync:adib` / `npm run build:android:adib` | `com.mahasoft.fserp.adib` | `https://adib.mahasoftcorporation.com/login` | **Always on** |
| Standard (multi-tenant) | `npm run sync` / `npm run build:android` | `com.mahasoft.fserp` | `https://mahasoftcorporation.com/login` | Per company flag |

Prefer the **Adib** APK for Adib Filling Station so Aquaculture cannot disappear from the menu.

## Prerequisites

- Node.js 20+ (Capacitor 7 — matches the main frontend; Capacitor 8 requires Node 22+)
- [Android Studio](https://developer.android.com/studio) with Android SDK 36 (the version configured in `android/variables.gradle`).
- JDK 21. Capacitor 7 compiles with Java 21; JDK 17 fails with `invalid source release: 21`. Set `JAVA_HOME` to your JDK 21 directory before running Gradle. See the [Capacitor 7 upgrade guide](https://capacitorjs.com/docs/updating/7-0#upgrade-android-studio).

## Setup

```bash
cd mobile
npm install
npx cap add android   # first time only
npm run sync:adib     # Adib dedicated build
```

## Build signed Adib APK

```bash
cd mobile
npm run sync:adib
npx cap open android
```

In Android Studio: **Build → Generate Signed Bundle / APK → APK → release**.

Or:

```bash
cd mobile
npm run build:android:adib
# APK: android/app/build/outputs/apk/release/app-release.apk (or unsigned)
```

### Host Adib APK for download

1. Copy the signed APK to `frontend/public/downloads/fserp-adib.apk`
2. Keep `frontend/public/downloads/android-adib-version.json` in sync (`versionCode` / `versionName`)
3. Deploy the frontend — Adib login (`adib.mahasoftcorporation.com`) shows **Download Adib FS ERP**

## Point at another host

```bash
# Windows PowerShell
$env:FSERP_APP_FLAVOR="adib"
$env:FSERP_APP_URL="https://adib.mahasoftcorporation.com"
npm run sync:adib
```

## How Aquaculture stays available

1. Backend: Adib (`FS-000002`) is a permanent aquaculture company.
2. Dedicated APK package id `com.mahasoft.fserp.adib` forces Aquaculture in the web UI.
3. App opens the Adib tenant subdomain so company context is always Adib.
4. Permanent-tenant users are allowed to call aquaculture APIs.

Redeploy the **website** after frontend/backend changes. Rebuild the APK only when changing the native shell (package id, start URL, splash).

## App IDs

- Standard: `com.mahasoft.fserp`
- Adib: `com.mahasoft.fserp.adib`
