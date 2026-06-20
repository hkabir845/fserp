'use client'

import { useEffect } from 'react'

const RELOAD_KEY = 'fserp-chunk-reload'

function isChunkLoadError(reason: unknown): boolean {
  if (reason == null) return false
  if (reason instanceof Error) {
    return reason.name === 'ChunkLoadError' || /Loading chunk .* failed/i.test(reason.message)
  }
  return /ChunkLoadError|Loading chunk .* failed/i.test(String(reason))
}

/**
 * Dev cold compiles can take long enough that webpack chunk script tags time out.
 * One automatic reload after chunks are emitted usually fixes the session.
 */
export function ChunkLoadRecovery() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return

    const onRejection = (event: PromiseRejectionEvent) => {
      if (!isChunkLoadError(event.reason)) return
      if (sessionStorage.getItem(RELOAD_KEY)) return
      sessionStorage.setItem(RELOAD_KEY, '1')
      event.preventDefault()
      window.location.reload()
    }

    window.addEventListener('unhandledrejection', onRejection)
    return () => window.removeEventListener('unhandledrejection', onRejection)
  }, [])

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    sessionStorage.removeItem(RELOAD_KEY)
  }, [])

  return null
}
