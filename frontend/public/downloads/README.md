# Android APK download (sideload)

Place the **signed release APK** here as **`fserp.apk`**.

Also keep **`android-version.json`** in sync with the APK (`versionCode` / `versionName` from
`mobile/android/app/build.gradle`). The login page and in-app banner use it to offer updates.

This is distributed **directly from your login page** — not via Google Play Store.

Build instructions: `mobile/README.md`

Override URL (optional): `NEXT_PUBLIC_ANDROID_APK_URL` in `frontend/.env`
