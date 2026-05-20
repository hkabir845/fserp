'use client'

import { useEffect } from 'react'
import { initConsoleErrorFilter } from '@/utils/errorHandler'

/**
 * Ensures console / rejection filters are installed (idempotent).
 * CSS preload and connection-error suppression live in initConsoleErrorFilter.
 */
export function SuppressWarnings() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      initConsoleErrorFilter()
    } catch {
      /* ignore */
    }
  }, [])

  return null
}
