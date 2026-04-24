import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from '@/components/Providers'
import { ErrorFilter } from '@/components/ErrorFilter'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { SuppressWarnings } from '@/components/SuppressWarnings'

const inter = Inter({ 
  subsets: ['latin'],
  display: 'swap',
  preload: true,
  fallback: ['system-ui', 'arial'],
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  /** Allow pinch-zoom for accessibility (avoid locking maximumScale to 1). */
  maximumScale: 5,
  themeColor: '#1d4ed8',
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
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/icon-192.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} min-h-screen min-h-[100dvh] bg-gray-50 antialiased`} suppressHydrationWarning>
        <noscript>
          <div style={{ padding: '2rem', textAlign: 'center', background: '#f3f4f6' }}>
            Please enable JavaScript to run this app.
          </div>
        </noscript>
        <ErrorBoundary>
          <ErrorFilter />
          <SuppressWarnings />
          <Providers>{children}</Providers>
        </ErrorBoundary>
      </body>
    </html>
  )
}
