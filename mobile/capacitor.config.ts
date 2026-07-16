import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Remote WebView shell — the APK opens your deployed Next.js site (all SaaS tenants use the same login URL).
 *
 * Override at build time:
 *   FSERP_APP_URL=https://mahasoftcorporation.com npm run sync
 */
const appUrl = (process.env.FSERP_APP_URL || 'https://mahasoftcorporation.com').replace(/\/+$/, '')

const config: CapacitorConfig = {
  appId: 'com.mahasoft.fserp',
  appName: 'FS ERP',
  webDir: 'www',
  server: {
    /** Open login directly — remote WebView shell for all SaaS tenants. */
    url: `${appUrl}/login`,
    androidScheme: 'https',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
  },
  plugins: {
    /** Native HTTP for API calls — avoids WebView CORS blocking login on Android. */
    CapacitorHttp: {
      enabled: true,
    },
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#1d4ed8',
      showSpinner: true,
      spinnerColor: '#ffffff',
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#1d4ed8',
    },
  },
}

export default config
