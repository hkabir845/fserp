'use client'

import { useLayoutEffect } from 'react'
import { applyBrainPwaDocumentHead } from '@/lib/pwaDisplay'
import { registerBrainPwaServiceWorker } from '@/lib/pwaServiceWorker'

const BRAIN_ROUTE_CLASS = 'brain-app-route'

/** Register Brain PWA head + service worker before first paint (installability). */
export function BrainPwaBootstrap() {
  useLayoutEffect(() => {
    applyBrainPwaDocumentHead()
    registerBrainPwaServiceWorker()
    document.documentElement.classList.add(BRAIN_ROUTE_CLASS)
    document.body.classList.add(BRAIN_ROUTE_CLASS)
    return () => {
      document.documentElement.classList.remove(BRAIN_ROUTE_CLASS)
      document.body.classList.remove(BRAIN_ROUTE_CLASS)
    }
  }, [])
  return null
}
