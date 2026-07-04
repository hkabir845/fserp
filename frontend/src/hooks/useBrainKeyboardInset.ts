'use client'

import { useEffect } from 'react'

/** Keeps Brain PWA chat input above the on-screen keyboard (iOS/Android). */
export function useBrainKeyboardInset(active: boolean): void {
  useEffect(() => {
    if (!active || typeof window === 'undefined') return

    const vv = window.visualViewport
    if (!vv) return

    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      document.documentElement.style.setProperty('--brain-kb-inset', `${inset}px`)
    }

    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      document.documentElement.style.removeProperty('--brain-kb-inset')
    }
  }, [active])
}
