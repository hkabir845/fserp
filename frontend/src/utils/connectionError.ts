/**
 * Connection Error Utilities
 * Helper functions to detect and handle connection errors gracefully
 */

const NETWORK_ERROR_LITERAL = /^network\s*error$/i

function messageLooksLikeConnection(message: string): boolean {
  const m = message.toLowerCase()
  return (
    NETWORK_ERROR_LITERAL.test(message.trim()) ||
    m.includes('failed to fetch') ||
    m.includes('connection refused') ||
    m.includes('err_connection_refused') ||
    m.includes('err_network') ||
    m.includes('err_connection_reset') ||
    m.includes('net::err_')
  )
}

/**
 * Check if an error is a connection error (backend not running, CORS preflight blocked, timeout).
 */
export function isConnectionError(error: any): boolean {
  if (!error) return false

  if (
    error.code === 'ERR_NETWORK' ||
    error.code === 'ERR_CONNECTION_REFUSED' ||
    error.code === 'ECONNREFUSED' ||
    error.code === 'ERR_CONNECTION_RESET' ||
    error.code === 'ECONNABORTED'
  ) {
    return true
  }

  if (error.message && messageLooksLikeConnection(String(error.message))) {
    return true
  }

  // Axios: no response usually means network/CORS/timeout (not a 4xx/5xx body)
  if (!error.response && (error.request || error.code)) {
    return true
  }

  return false
}

/**
 * User-facing copy for connection failures — never returns raw "Network Error".
 */
export function connectionErrorUserMessage(
  error?: unknown,
  fallback?: string
): string {
  const isTimeout =
    error != null &&
    typeof error === 'object' &&
    ((error as { code?: string }).code === 'ECONNABORTED' ||
      String((error as { message?: string }).message || '')
        .toLowerCase()
        .includes('timeout'))

  if (isTimeout) {
    return (
      fallback ??
      'The request timed out. Try again with a shorter date range. If this keeps happening, ask your administrator to increase API timeout limits on the server.'
    )
  }

  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') {
    return (
      fallback ??
      'Could not reach the API. For local development, start Django (for example: cd backend && python manage.py runserver 8000) and confirm NEXT_PUBLIC_API_BASE_URL in frontend/.env.development.'
    )
  }

  return (
    fallback ??
    'Could not reach the server. Check your internet connection and try again. If this continues after a deploy, your administrator should verify the API URL, CORS settings, and that database migrations have been run.'
  )
}

/**
 * Safely log error - only logs if it's NOT a connection error
 */
export function safeLogError(message: string, error: any): void {
  if (!isConnectionError(error)) {
    console.error(message, error)
  }
  // Silently ignore connection errors - backend may not be running
}
