/**
 * Connection Error Utilities
 * Helper functions to detect and handle connection errors gracefully
 */

/**
 * Check if an error is a connection error (backend not running)
 */
export function isConnectionError(error: any): boolean {
  if (!error) return false

  // Check error code
  if (error.code === 'ERR_NETWORK' || 
      error.code === 'ERR_CONNECTION_REFUSED' || 
      error.code === 'ECONNREFUSED' ||
      error.code === 'ERR_CONNECTION_RESET') {
    return true
  }

  // Check error message
  if (error.message) {
    const message = String(error.message).toLowerCase()
    if (message.includes('network error') ||
        message.includes('failed to fetch') ||
        message.includes('connection refused') ||
        message.includes('err_connection_refused') ||
        message.includes('err_network')) {
      return true
    }
  }

  // Check response status (no response usually means connection error)
  if (!error.response && (error.request || error.code)) {
    return true
  }

  return false
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
