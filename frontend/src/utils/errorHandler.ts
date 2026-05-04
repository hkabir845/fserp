/**
 * Normalize JSON error bodies from the Django API (DRF `detail`, field errors, validation lists with `loc`/`msg`).
 * Shared by `extractErrorMessage` (Axios) and `fetch` callers (e.g. login).
 */
export function formatApiErrorJson(data: unknown, fallback: string = 'Request failed'): string {
  if (data == null) return fallback

  if (typeof data === 'string') {
    const t = data.trim()
    return t || fallback
  }

  if (typeof data !== 'object' || Array.isArray(data)) {
    try {
      const s = JSON.stringify(data)
      return s && s !== 'null' ? s : fallback
    } catch {
      return fallback
    }
  }

  const o = data as Record<string, unknown>

  if (typeof o.type === 'string' && o.msg != null && o.loc != null) {
    const loc = o.loc
    const location = Array.isArray(loc) ? loc.join('.') : String(loc)
    return `${location}: ${String(o.msg)}`
  }

  if (Array.isArray(o.detail)) {
    const messages = o.detail.map((err: unknown) => {
      if (typeof err === 'object' && err !== null) {
        const e = err as Record<string, unknown>
        const loc = e.loc
        const location = Array.isArray(loc) ? loc.join('.') : loc != null ? String(loc) : ''
        const msg = e.msg ?? e.message ?? 'Validation error'
        return location ? `${location}: ${String(msg)}` : String(msg)
      }
      return String(err)
    })
    const joined = messages.join('; ').trim()
    return joined || fallback
  }

  if (typeof o.detail === 'string') {
    const t = o.detail.trim()
    if (t) return t
  }

  if (o.detail && typeof o.detail === 'object' && !Array.isArray(o.detail)) {
    const d = o.detail as Record<string, unknown>
    if (typeof d.msg === 'string') {
      const loc = d.loc
      const location = Array.isArray(loc) ? loc.join('.') : loc != null ? String(loc) : ''
      return location ? `${location}: ${d.msg}` : d.msg
    }
    if (typeof d.message === 'string' && d.message.trim()) return d.message.trim()
    try {
      return JSON.stringify(o.detail)
    } catch {
      return fallback
    }
  }

  if (typeof o.message === 'string' && o.message.trim()) return o.message.trim()
  if (typeof o.error === 'string' && o.error.trim()) return o.error.trim()

  const fieldParts: string[] = []
  for (const [k, v] of Object.entries(o)) {
    if (k === 'detail' || k === 'message' || k === 'error') continue
    if (Array.isArray(v)) {
      const msgs = v
        .map((x) => (typeof x === 'string' ? x : JSON.stringify(x)))
        .filter(Boolean)
      if (msgs.length) fieldParts.push(`${k}: ${msgs.join(' ')}`)
    } else if (typeof v === 'string' && v.trim()) {
      fieldParts.push(`${k}: ${v}`)
    }
  }
  if (fieldParts.length) return fieldParts.join('; ')

  if (typeof o.msg === 'string' && o.msg.trim()) return o.msg.trim()

  try {
    const s = JSON.stringify(o)
    if (s && s !== '{}' && s !== 'null') return s
  } catch {
    /* ignore */
  }

  return fallback
}

/**
 * Extract a user-facing message from an API/Axios error or thrown value.
 */
export function extractErrorMessage(error: any, fallback: string = 'An error occurred'): string {
  if (typeof error === 'string') {
    return error
  }

  if (error instanceof Error) {
    return error.message
  }

  if (error?.response?.data != null) {
    return formatApiErrorJson(error.response.data, fallback)
  }

  if (error && typeof error === 'object' && !Array.isArray(error)) {
    if (error.isAxiosError) {
      const m = error.message
      return typeof m === 'string' && m.trim() ? m.trim() : fallback
    }
    return formatApiErrorJson(error, fallback)
  }

  if (error?.message) {
    return String(error.message)
  }

  try {
    if (error && typeof error === 'object') {
      const errorString = JSON.stringify(error)
      if (errorString !== '{}' && errorString !== 'null' && errorString !== 'undefined') {
        if (errorString.length > 200) {
          return `Error: ${errorString.substring(0, 200)}...`
        }
        return errorString
      }
    }
  } catch {
    // Ignore JSON stringify errors
  }

  return fallback
}

/**
 * Chrome bug noise: an extension's onMessage returned true (async) but never called
 * sendResponse — surfaces as an unhandled promise rejection on the page, not app code.
 */
const CHROME_ASYNC_MESSAGE_CHANNEL_NOISE =
  /message channel closed before a response was received|listener indicated an asynchronous response/i

/**
 * Check if an error is from a browser extension
 * Filters out errors from chrome extensions, firefox extensions, etc.
 */
/** True when DevTools-style multi-arg logs are QuillBot / broken extension URL noise. */
function argsLookLikeExtensionNoise(args: any[]): boolean {
  const s = args
    .map((a) => {
      try {
        if (typeof a === 'string') return a
        if (a instanceof Error) return `${a.message} ${a.stack || ''}`
        if (typeof a === 'object' && a !== null) return JSON.stringify(a)
      } catch {
        /* ignore */
      }
      return String(a)
    })
    .join(' ')
  if (/chrome-extension:\/\/invalid\b/i.test(s)) return true
  if (/HEAD\s+chrome-extension:\/\//i.test(s) && /ERR_FAILED/i.test(s)) return true
  if (/quillbot[-_.]content\.js/i.test(s) && (/ERR_FAILED|chrome-extension:\/\//i.test(s))) return true
  return false
}

function isExtensionError(error: any): boolean {
  if (typeof error === 'string') {
    // Check for chrome-extension://, moz-extension://, etc.
    if (CHROME_ASYNC_MESSAGE_CHANNEL_NOISE.test(error)) return true
    return /chrome-extension:\/\/|moz-extension:\/\/|safari-extension:\/\/|ms-browser-extension:\/\/|chrome:\/\/invalid|quillbot|extension/i.test(error)
  }

  if (error?.message) {
    if (CHROME_ASYNC_MESSAGE_CHANNEL_NOISE.test(error.message)) return true
    return /chrome-extension:\/\/|moz-extension:\/\/|safari-extension:\/\/|ms-browser-extension:\/\/|chrome:\/\/invalid|quillbot|extension|net::ERR_FAILED/i.test(error.message)
  }

  if (error?.stack) {
    if (CHROME_ASYNC_MESSAGE_CHANNEL_NOISE.test(error.stack)) return true
    return /chrome-extension:\/\/|moz-extension:\/\/|safari-extension:\/\/|ms-browser-extension:\/\/|chrome:\/\/invalid|quillbot|extension/i.test(error.stack)
  }

  if (error?.source) {
    return /chrome-extension:\/\/|moz-extension:\/\/|safari-extension:\/\/|ms-browser-extension:\/\/|chrome:\/\/invalid|quillbot|extension/i.test(error.source)
  }

  if (error?.filename) {
    if (/quillbot[-_.]content\.js/i.test(error.filename)) return true
    return /chrome-extension:\/\/|moz-extension:\/\/|safari-extension:\/\/|ms-browser-extension:\/\/|chrome:\/\/invalid|quillbot|extension/i.test(error.filename)
  }

  // Check if error is from network failure on extension URLs
  if (error?.target) {
    const target = error.target as any
    if (target?.src || target?.href) {
      return /chrome-extension:\/\/|moz-extension:\/\/|safari-extension:\/\/|ms-browser-extension:\/\/|chrome:\/\/invalid|quillbot|extension/i.test(target.src || target.href)
    }
  }

  return false
}

/**
 * Initialize console error filtering to suppress browser extension errors
 * This should be called once when the app loads
 * 
 * This filters out errors from browser extensions (like QuillBot) that
 * try to make requests to invalid chrome-extension:// URLs
 */
export function initConsoleErrorFilter(): void {
  // Only run in browser environment
  if (typeof window === 'undefined') {
    return
  }

  // Store original console methods
  const originalError = console.error.bind(console)
  const originalWarn = console.warn.bind(console)
  const originalLog = console.log.bind(console)

  // Helper to check if error is from extension or expected connection error
  const checkExtensionError = (arg: any): boolean => {
    if (!arg) return false

    // Check string arguments
    if (typeof arg === 'string') {
      if (CHROME_ASYNC_MESSAGE_CHANNEL_NOISE.test(arg)) return true
      // Filter connection errors (including browser network error messages)
      if (/Cannot connect to server|ERR_CONNECTION_REFUSED|ERR_NETWORK|Failed to load resource|Failed to fetch.*(?:localhost:8000|api\.mahasoftcorporation\.com)|Network Error|Backend server connection error|Please ensure.*server.*running|GET.*(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED|POST.*(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED|PUT.*(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED|DELETE.*(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED|PATCH.*(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED|net::ERR_CONNECTION_REFUSED|GET http:\/\/(?:localhost:8000|api\.mahasoftcorporation\.com)|POST http:\/\/(?:localhost:8000|api\.mahasoftcorporation\.com)|PUT http:\/\/(?:localhost:8000|api\.mahasoftcorporation\.com)|DELETE http:\/\/(?:localhost:8000|api\.mahasoftcorporation\.com)|PATCH http:\/\/(?:localhost:8000|api\.mahasoftcorporation\.com)|https:\/\/api\.mahasoftcorporation\.com\/api\/.*ERR_CONNECTION_REFUSED|https:\/\/api\.mahasoftcorporation\.com\/api\/.*Failed to load|:\d+\/api\/.*ERR_CONNECTION_REFUSED|:\d+\/api\/.*Failed to load/i.test(arg)) {
        return true
      }
      return /chrome-extension:\/\/invalid|moz-extension:\/\/invalid|quillbot.*content\.js|net::ERR_FAILED.*chrome-extension|chrome-extension:\/\/.*net::ERR_FAILED/i.test(arg)
    }

    // Check Error objects
    if (arg instanceof Error) {
      if (CHROME_ASYNC_MESSAGE_CHANNEL_NOISE.test(arg.message)) return true
      const errorStr = arg.message + ' ' + (arg.stack || '')
      // Filter expected connection errors (when backend is down)
      if (/Cannot connect to server|ERR_CONNECTION_REFUSED|ERR_NETWORK|Failed to load resource|Failed to fetch.*(?:localhost:8000|api\.mahasoftcorporation\.com)|Network Error|Backend server connection error|Please ensure.*server.*running|Error fetching.*ERR_NETWORK|AxiosError.*Network Error|GET.*(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED|POST.*(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED|PUT.*(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED|DELETE.*(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED|PATCH.*(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED|net::ERR_CONNECTION_REFUSED|https:\/\/api\.mahasoftcorporation\.com\/api\/.*ERR_CONNECTION_REFUSED|https:\/\/api\.mahasoftcorporation\.com\/api\/.*Failed to load|:\d+\/api\/.*ERR_CONNECTION_REFUSED|:\d+\/api\/.*Failed to load/i.test(errorStr)) {
        return true // Suppress expected connection errors
      }
      return /chrome-extension:\/\/invalid|moz-extension:\/\/invalid|quillbot.*content\.js|net::ERR_FAILED.*chrome-extension|chrome-extension:\/\/.*net::ERR_FAILED/i.test(errorStr)
    }

    // Check object properties (AxiosError, etc.)
    if (typeof arg === 'object') {
      const objStr = JSON.stringify(arg)
      // Filter expected connection errors
      if (/Cannot connect to server|ERR_CONNECTION_REFUSED|ERR_NETWORK|Failed to load resource|Failed to fetch.*(?:localhost:8000|api\.mahasoftcorporation\.com)|Network Error|Backend server connection error|Please ensure.*server.*running|Error fetching.*ERR_NETWORK|AxiosError.*Network Error|code.*ERR_NETWORK|code.*ERR_CONNECTION_REFUSED|GET.*(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED|POST.*(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED|PUT.*(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED|DELETE.*(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED|PATCH.*(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED|https:\/\/api\.mahasoftcorporation\.com\/api\/.*ERR_CONNECTION_REFUSED|https:\/\/api\.mahasoftcorporation\.com\/api\/.*Failed to load|:\d+\/api\/.*ERR_CONNECTION_REFUSED|:\d+\/api\/.*Failed to load/i.test(objStr)) {
        return true // Suppress expected connection errors
      }
      // Check specific error properties
      if (arg.code === 'ERR_NETWORK' || arg.code === 'ERR_CONNECTION_REFUSED' || arg.code === 'ECONNREFUSED') {
        return true
      }
      if (arg.message && /Network Error|ERR_CONNECTION_REFUSED|ERR_NETWORK|Failed to fetch/i.test(arg.message)) {
        return true
      }
      return /chrome-extension:\/\/invalid|moz-extension:\/\/invalid|quillbot.*content\.js|net::ERR_FAILED.*chrome-extension/i.test(objStr)
    }

    // Check stringified version
    try {
      const str = String(arg)
      // Filter expected connection errors
      if (/Cannot connect to server|ERR_CONNECTION_REFUSED|ERR_NETWORK|Failed to load resource|Failed to fetch.*(?:localhost:8000|api\.mahasoftcorporation\.com)|Network Error|Backend server connection error|Please ensure.*server.*running|Error fetching.*ERR_NETWORK|AxiosError.*Network Error|GET.*(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED|POST.*(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED|PUT.*(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED|DELETE.*(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED|PATCH.*(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED|https:\/\/api\.mahasoftcorporation\.com\/api\/.*ERR_CONNECTION_REFUSED|https:\/\/api\.mahasoftcorporation\.com\/api\/.*Failed to load|:\d+\/api\/.*ERR_CONNECTION_REFUSED|:\d+\/api\/.*Failed to load/i.test(str)) {
        return true // Suppress expected connection errors
      }
      return /chrome-extension:\/\/invalid|moz-extension:\/\/invalid|quillbot.*content\.js|net::ERR_FAILED.*chrome-extension|chrome-extension:\/\/.*net::ERR_FAILED/i.test(str)
    } catch {
      return false
    }
  }

  // Filter console.error - suppress extension and connection errors
  console.error = (...args: any[]) => {
    if (args.length > 0 && argsLookLikeExtensionNoise(args)) {
      return
    }
    // Check if any argument is an extension or connection error
    const hasExtensionOrConnectionError = args.length > 0 && args.some(arg => checkExtensionError(arg))
    
    // Suppress if any argument is an extension/connection error
    // This prevents connection error spam when backend is down
    if (!hasExtensionOrConnectionError) {
      originalError(...args)
    }
    // Otherwise, silently ignore extension/connection errors
  }

  // Filter console.warn - same logic
  console.warn = (...args: any[]) => {
    if (args.length > 0 && argsLookLikeExtensionNoise(args)) {
      return
    }
    const allExtensionWarnings = args.length > 0 && args.every(arg => checkExtensionError(arg))
    if (!allExtensionWarnings) {
      originalWarn(...args)
    }
  }

  // QuillBot sometimes uses console.log for failed HEAD chrome-extension://invalid
  console.log = (...args: any[]) => {
    if (args.length > 0 && argsLookLikeExtensionNoise(args)) {
      return
    }
    originalLog(...args)
  }

  // Intercept all error events (scripts, resources, etc.)
  window.addEventListener('error', (event) => {
    // Check if error is from extension
    const target = event.target as HTMLElement
    
    // Check for resource loading errors (scripts, images, links)
    if (target && (target.tagName === 'SCRIPT' || target.tagName === 'LINK' || target.tagName === 'IMG')) {
      const src = (target as HTMLScriptElement).src || (target as HTMLLinkElement).href || (target as HTMLImageElement).src
      if (src && /chrome-extension:\/\/invalid|moz-extension:\/\/invalid|quillbot/i.test(src)) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        return
      }
    }
    
    // Check for network/connection errors (browser-level)
    const errorMessage = event.message || ''
    const errorSource = event.filename || (event.target as any)?.src || ''
    const errorStr = errorMessage + ' ' + errorSource
    
    // Suppress connection refused errors
    if (/ERR_CONNECTION_REFUSED|net::ERR_CONNECTION_REFUSED|Failed to load resource|(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED|GET.*(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED|POST.*(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED|PUT.*(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED|DELETE.*(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED|PATCH.*(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED/i.test(errorStr)) {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }
    
    // Check for JavaScript errors from extensions
    const errorInfo = {
      message: event.message,
      source: event.filename || (event.target as any)?.src,
      error: event.error
    }
    
    if (isExtensionError(errorInfo)) {
      // Suppress extension errors
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
  }, true) // Use capture phase to catch early

  // Intercept unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    
    // Suppress extension errors
    if (isExtensionError(reason)) {
      event.preventDefault()
      return
    }
    
    // Suppress connection errors (backend not running)
    if (checkExtensionError(reason)) {
      event.preventDefault()
      return
    }
    
    // Also check for axios/network errors in the rejection
    if (reason && typeof reason === 'object') {
      const errorCode = reason.code || reason.message || ''
      const errorStr = String(errorCode)
      if (/ERR_NETWORK|ERR_CONNECTION_REFUSED|ECONNREFUSED|Network Error|Failed to fetch|Failed to load resource|GET.*(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED|POST.*(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED|PUT.*(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED|DELETE.*(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED|PATCH.*(?:localhost:8000|api\.mahasoftcorporation\.com).*ERR_CONNECTION_REFUSED|net::ERR_CONNECTION_REFUSED|https:\/\/api\.mahasoftcorporation\.com\/api\/.*ERR_CONNECTION_REFUSED|https:\/\/api\.mahasoftcorporation\.com\/api\/.*Failed to load|:\d+\/api\/.*ERR_CONNECTION_REFUSED|:\d+\/api\/.*Failed to load/i.test(errorStr)) {
        event.preventDefault()
        return
      }
    }
  })
}

