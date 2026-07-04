'use client'

import type { ReactNode } from 'react'

/** Fixed viewport shell for Brain PWA — avoids body overflow clipping the chat input. */
export function BrainAppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh max-h-dvh min-h-0 w-full flex-col overflow-hidden bg-indigo-50/50">
      {children}
    </div>
  )
}
