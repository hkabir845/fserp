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
      <head>
        {/* Suppress CSS preload warning - CSS is loaded synchronously */}
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className={`${inter.className} min-h-screen bg-gray-50`} suppressHydrationWarning>
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
