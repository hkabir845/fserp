'use client'

import { useEffect } from 'react'
import { CompactCompanyAlert } from './CompactCompanyAlert'

/**
 * Fixed Banner Component
 * Now displays a compact alert in free space (top-right) instead of full banner
 */
export function FixedBanner() {
  // Set banner height to 0 since we're using compact alert now
  useEffect(() => {
    document.documentElement.style.setProperty('--banner-height', '0px')
  }, [])

  return <CompactCompanyAlert />
}
