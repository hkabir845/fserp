'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { ensureExtensionNoiseFilter } from '@/lib/extensionNoiseFilterInstallScript'
import { initConsoleErrorFilter } from '@/utils/errorHandler'

/** Install filters as soon as this client chunk loads (before useEffect). */
if (typeof window !== 'undefined') {
  try {
    ensureExtensionNoiseFilter()
    initConsoleErrorFilter()
  } catch {
    /* don't break the app */
  }
}

/**
 * Client component that initializes console error filtering
 * to suppress browser extension errors (like QuillBot)
 */
export function ErrorFilter() {
  const pathname = usePathname()

  useEffect(() => {
    try {
      ensureExtensionNoiseFilter()
      initConsoleErrorFilter()
    } catch {
      /* don't break the app */
    }
  }, [pathname])

  return null
}
