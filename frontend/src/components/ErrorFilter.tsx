'use client'

import { useEffect } from 'react'

/**
 * Client component that initializes console error filtering
 * to suppress browser extension errors (like QuillBot)
 */
export function ErrorFilter() {
  useEffect(() => {
    // Safely initialize error filter - don't break if it fails
    try {
      // Only import and run on client side
      if (typeof window !== 'undefined') {
        import('@/utils/errorHandler').then((module) => {
          try {
            module.initConsoleErrorFilter()
          } catch (e) {
            // Silently fail - don't break the app
          }
        }).catch(() => {
          // Import failed - ignore
        })
      }
    } catch (error) {
      // Don't break the app if error filter fails
    }
  }, [])

  return null
}

