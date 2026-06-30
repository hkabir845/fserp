import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import localFont from 'next/font/local'
import './globals.css'
import { Providers } from '@/components/Providers'
import { ErrorFilter } from '@/components/ErrorFilter'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ChunkLoadRecovery } from '@/components/ChunkLoadRecovery'
import { SuppressWarnings } from '@/components/SuppressWarnings'

const inter = localFont({
  src: '../fonts/inter-latin.woff2',
  display: 'swap',
  preload: true,
  fallback: ['system-ui', 'arial'],
  weight: '100 900',
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  /** Allow pinch-zoom for accessibility (avoid locking maximumScale to 1). */
  maximumScale: 5,
  themeColor: '#0d9488',
  /** Notched Android / iOS — pairs with env(safe-area-inset-*) in CSS */
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: 'Filling Station ERP - QuickBooks Style',
  description: 'Complete ERP solution for filling stations with QuickBooks features',
  manifest: '/manifest.json',
  /** Chrome prefers this alongside the legacy apple-mobile-web-app-capable tag. */
  other: {
    'mobile-web-app-capable': 'yes',
  },
  appleWebApp: {
    capable: true,
    title: 'Fuel Station ERP',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/favicon.svg',
    apple: '/icons/icon-192.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.className} h-dvh max-h-dvh overflow-hidden bg-background antialiased`}
        suppressHydrationWarning
      >
        {/* Hoisted to <head> by Next — suppresses extension onMessage console noise */}
        <Script src="/extension-noise-filter.js" strategy="beforeInteractive" />
        <noscript>
          <div style={{ padding: '2rem', textAlign: 'center', background: '#f3f4f6' }}>
            Please enable JavaScript to run this app.
          </div>
        </noscript>
        <ChunkLoadRecovery />
        <ErrorBoundary>
          <ErrorFilter />
          <SuppressWarnings />
          <Providers>{children}</Providers>
        </ErrorBoundary>
      </body>
    </html>
  )
}
