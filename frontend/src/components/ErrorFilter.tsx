'use client'

import { initConsoleErrorFilter } from '@/utils/errorHandler'

/** Install filters as soon as this client chunk loads (before useEffect). */
if (typeof window !== 'undefined') {
  try {
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
  return null
}
