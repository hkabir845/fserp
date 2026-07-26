# Android APK download (sideload)

Place the **signed release APK** here as **`fserp.apk`**.

Also keep **`android-version.json`** in sync with the APK (`versionCode` / `versionName` from
`mobile/android/app/build.gradle`). The login page and in-app banner use it to offer updates.

This is distributed **directly from your login page** — not via Google Play Store.

## Dedicated tenant build (optional)

`fserp-adib.apk` + `android-adib-version.json` serve the Adib portal (`adib.mahasoftcorporation.com`).
Until that APK is uploaded here, the Adib login page automatically offers the shared `fserp.apk`
instead, so the download link never 404s.

Build instructions: `mobile/README.md`

Override URL (optional): `NEXT_PUBLIC_ANDROID_APK_URL` in `frontend/.env`
