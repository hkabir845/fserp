/**
 * Formatting Utilities Index
 * Centralized formatting functions for easy imports across the application
 */

// Re-export currency utilities
export {
  formatAmount,
  formatAmountPlain,
  formatCurrency,
  formatNumber,
  getCurrencySymbol,
  getCurrencyName,
  getAllCurrencies,
  getCurrencyOptions,
  roundToDecimals,
} from './currency'

// Re-export date utilities
export {
  formatDate,
  formatDateShort,
  formatDateLong,
  formatTime,
  formatDateRelative,
  formatDateRange,
  isToday,
  isPast,
  isFuture
} from './date'

/**
 * Format a percentage value
 * @param value Percentage value (0-100 or 0-1)
 * @param decimals Number of decimal places (default: 2)
 * @param isDecimal Whether the value is already in decimal form (0-1) vs percentage (0-100)
 * @returns Formatted percentage string (e.g., "25.50%")
 */
export function formatPercentage(
  value: number | string | null | undefined,
  decimals: number = 2,
  isDecimal: boolean = false
): string {
  if (value === null || value === undefined || value === '') return '0%'
  
  const numValue = typeof value === 'string' ? parseFloat(value) : value
  
  if (isNaN(numValue)) return '0%'
  
  const percentage = isDecimal ? numValue * 100 : numValue
  
  return `${percentage.toFixed(decimals)}%`
}

/**
 * Format a file size in bytes to human-readable format
 * @param bytes File size in bytes
 * @param decimals Number of decimal places (default: 2)
 * @returns Formatted file size string (e.g., "1.5 MB")
 */
export function formatFileSize(
  bytes: number | string | null | undefined,
  decimals: number = 2
): string {
  if (bytes === null || bytes === undefined || bytes === '') return '0 Bytes'
  
  const numBytes = typeof bytes === 'string' ? parseFloat(bytes) : bytes
  
  if (isNaN(numBytes) || numBytes === 0) return '0 Bytes'
  
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
  
  const i = Math.floor(Math.log(numBytes) / Math.log(k))
  
  return `${parseFloat((numBytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

/**
 * Format a phone number
 * @param phone Phone number string
 * @param format Format style ('US', 'international', or 'raw')
 * @returns Formatted phone number string
 */
export function formatPhone(
  phone: string | null | undefined,
  format: 'US' | 'international' | 'raw' = 'raw'
): string {
  if (!phone) return '—'
  
  const cleaned = phone.replace(/\D/g, '')
  
  if (format === 'US' && cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`
  }
  
  if (format === 'international' && cleaned.length > 0) {
    return `+${cleaned}`
  }
  
  return phone
}

/**
 * Truncate text with ellipsis
 * @param text Text to truncate
 * @param maxLength Maximum length before truncation
 * @param suffix Suffix to add when truncated (default: '...')
 * @returns Truncated text string
 */
export function truncateText(
  text: string | null | undefined,
  maxLength: number = 50,
  suffix: string = '...'
): string {
  if (!text) return '—'
  
  if (text.length <= maxLength) return text
  
  return text.slice(0, maxLength - suffix.length) + suffix
}
