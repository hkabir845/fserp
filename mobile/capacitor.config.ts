/**
 * Capacitor config — shared FS ERP shell or Adib Filling Station dedicated APK.
 *
 * Standard (all tenants):
 *   npm run sync
 *
 * Adib-only (Aquaculture always available, opens adib tenant portal):
 *   npm run sync:adib
 */
import type { CapacitorConfig } from '@capacitor/cli'

const flavor = (process.env.FSERP_APP_FLAVOR || 'standard').trim().toLowerCase()
const isAdib = flavor === 'adib'

const defaultUrl = isAdib
  ? 'https://adib.mahasoftcorporation.com'
  : 'https://mahasoftcorporation.com'

const appUrl = (process.env.FSERP_APP_URL || defaultUrl).replace(/\/+$/, '')

const config: CapacitorConfig = {
  appId: isAdib ? 'com.mahasoft.fserp.adib' : 'com.mahasoft.fserp',
  appName: isAdib ? 'Adib FS ERP' : 'FS ERP',
  webDir: 'www',
  server: {
    /** Adib build opens the tenant subdomain so company context is always Adib. */
    url: `${appUrl}/login`,
    androidScheme: 'https',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: isAdib ? '#0b5cab' : '#1d4ed8',
      showSpinner: true,
      spinnerColor: '#ffffff',
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: isAdib ? '#0b5cab' : '#1d4ed8',
    },
  },
}

export default config
