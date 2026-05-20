/**
 * Formatting utilities — re-exports used by reports and analytics panels.
 */

export {
  formatAmountPlain,
  formatCurrency,
  formatNumber,
  getCurrencySymbol,
  getCurrencyName,
  roundToDecimals,
} from './currency'

export { formatDate, formatDateLong, formatDateRange } from './date'

/**
 * Format a percentage value
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
