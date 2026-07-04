import type { Metadata, Viewport } from 'next'
import { BrainAppProviders } from './BrainAppProviders'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#4f46e5',
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: 'Company Brain',
  description: 'Ask anything about your business — your AI owner advisor.',
  manifest: '/brain-app/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Company Brain',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/brain-app/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/brain-app/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/brain-app/icon-192.png',
  },
}

export default function BrainAppLayout({ children }: { children: React.ReactNode }) {
  return <BrainAppProviders>{children}</BrainAppProviders>
}
