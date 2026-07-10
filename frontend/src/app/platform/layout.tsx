'use client'

import { PlatformLayout } from '@/components/PlatformLayout'

export default function PlatformRootLayout({ children }: { children: React.ReactNode }) {
  return <PlatformLayout>{children}</PlatformLayout>
}