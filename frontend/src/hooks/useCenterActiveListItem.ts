'use client'

import { useEffect, type RefObject } from 'react'
import { scrollActiveChildToCenterAfterLayout } from '@/utils/scrollListItemToCenter'

/**
 * Scroll the element matching `activeSelector` to the vertical center of `containerRef`
 * (Reports left list + ERP sidebar menubar).
 */
export function useCenterActiveListItem(
  containerRef: RefObject<HTMLElement | null>,
  activeSelector: string,
  enabled: boolean,
  deps: readonly unknown[]
): void {
  useEffect(() => {
    if (!enabled) return
    scrollActiveChildToCenterAfterLayout(containerRef.current, activeSelector)
  }, [containerRef, activeSelector, enabled, ...deps])
}
