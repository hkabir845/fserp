'use client'

import { useEffect } from 'react'
import { isConnectionError } from '@/utils/connectionError'

/**
 * Suppress harmless browser warnings about CSS preloading and connection errors
 * This is a Next.js optimization that preloads CSS, but browsers
 * sometimes warn if it's not used immediately
 */
export function SuppressWarnings() {
  useEffect(() => {
    if (typeof window === 'undefined') return

    // Suppress CSS preload warnings and connection errors
    const originalWarn = console.warn
    const originalError = console.error
    
    console.warn = (...args: any[]) => {
      const message = args.join(' ')
      // Suppress CSS preload warnings (harmless Next.js optimization)
      if (message.includes('was preloaded using link preload but not used')) {
        return // Suppress this warning
      }
      // Suppress resource preload warnings
      if (message.includes('preloaded using link preload but not used within')) {
        return // Suppress this warning
      }
      // Suppress dashboard timeout warnings (backend may not be running)
      if (message.includes('Dashboard loading timeout')) {
        return // Suppress this warning
      }
      // Suppress connection-related warnings
      if (message.includes('ERR_CONNECTION_REFUSED') || 
          message.includes('Failed to load resource') ||
          message.includes('net::ERR_CONNECTION_REFUSED') ||
          message.includes('localhost:8000') ||
          message.includes('api.mahasoftcorporation.com') ||
          /:\d+\/api\/.*ERR_CONNECTION_REFUSED/i.test(message) ||
          /:\d+\/api\/.*Failed to load/i.test(message)) {
        return // Suppress connection error warnings
      }
      originalWarn.apply(console, args)
    }

    // Suppress connection errors in console.error
    console.error = (...args: any[]) => {
      const message = args.join(' ')
      // Check if any argument is a connection error
      const hasConnectionError = args.some(arg => {
        if (typeof arg === 'object' && arg !== null) {
          return isConnectionError(arg)
        }
        if (typeof arg === 'string') {
          return arg.includes('ERR_CONNECTION_REFUSED') ||
                 arg.includes('net::ERR_CONNECTION_REFUSED') ||
                 arg.includes('Failed to load resource') ||
                 arg.includes('localhost:8000') ||
                 arg.includes('127.0.0.1:8000') ||
                 arg.includes('api.mahasoftcorporation.com') ||
                 /https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/api\//i.test(arg) ||
                 /:\d+\/api\/.*ERR_CONNECTION_REFUSED/i.test(arg) ||
                 /:\d+\/api\/.*Failed to load/i.test(arg)
        }
        return false
      })
      
      // Check message for connection error patterns
      if (hasConnectionError || 
          message.includes('ERR_CONNECTION_REFUSED') || 
          message.includes('net::ERR_CONNECTION_REFUSED') ||
          message.includes('Failed to load resource') ||
          message.includes('localhost:8000') ||
          message.includes('api.mahasoftcorporation.com') ||
          /GET\s+http:\/\/localhost:\d+.*ERR_CONNECTION_REFUSED/i.test(message) ||
          /POST\s+http:\/\/localhost:\d+.*ERR_CONNECTION_REFUSED/i.test(message) ||
          /:\d+\/api\/.*ERR_CONNECTION_REFUSED/i.test(message) ||
          /:\d+\/api\/.*Failed to load/i.test(message)) {
        return // Suppress connection errors
      }
      originalError.apply(console, args)
    }

    // Suppress unhandled promise rejections for connection errors
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      
      // Check if it's a connection error
      if (isConnectionError(reason)) {
        event.preventDefault()
        return
      }
      
      // Check error object properties
      if (reason && typeof reason === 'object') {
        const errorCode = reason.code || reason.message || ''
        const errorStr = String(errorCode)
        
        if (reason.code === 'ERR_CONNECTION_REFUSED' ||
            reason.code === 'ERR_NETWORK' ||
            reason.code === 'ECONNREFUSED' ||
            reason.code === 'ERR_CONNECTION_RESET' ||
            errorStr.includes('ERR_CONNECTION_REFUSED') ||
            errorStr.includes('Failed to fetch') ||
            errorStr.includes('localhost:8000') ||
            errorStr.includes('api.mahasoftcorporation.com') ||
            /net::ERR_CONNECTION_REFUSED/i.test(errorStr)) {
          event.preventDefault()
          return
        }
      }
      
      // Check string reasons
      if (typeof reason === 'string') {
        if (reason.includes('ERR_CONNECTION_REFUSED') ||
            reason.includes('net::ERR_CONNECTION_REFUSED') ||
            reason.includes('Failed to fetch') ||
            reason.includes('localhost:8000') ||
            reason.includes('api.mahasoftcorporation.com')) {
          event.preventDefault()
          return
        }
      }
    }

    window.addEventListener('unhandledrejection', handleUnhandledRejection)

    // Cleanup on unmount
    return () => {
      console.warn = originalWarn
      console.error = originalError
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    }
  }, [])

  return null
}
