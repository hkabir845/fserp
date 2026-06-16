/**
 * Date Formatting Utilities
 * Centralized date formatting functions for consistent display across the application.
 * When the user is logged in, CompanyLocaleProvider loads date_format / time_format from
 * the company record; formatDate uses those patterns.
 */
import { formatCompanyDate, formatCompanyTime } from '@/utils/companyLocaleFormats'
import { getTenantLocaleConfig } from '@/utils/tenantLocale'

/**
 * YYYY-MM-DD in the user's local calendar (not UTC). Use for API query params that represent a business day.
 */
export function localDateISO(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Value for `<input type="date">` without shifting calendar day through UTC (avoids `toISOString()` bugs).
 */
/**
 * Format a calendar day from API (YYYY-MM-DD or ISO datetime) using company date_format.
 * Does not use Date parsing for the date part, so no UTC day-shift on YYYY-MM-DD.
 */
export function formatDateOnly(isoYmdOrIso: string | null | undefined): string {
  if (!isoYmdOrIso) return '—'
  const raw = String(isoYmdOrIso).trim()
  const dayPart = raw.split('T')[0]
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayPart)) {
    return formatDate(raw)
  }
  const cfg = getTenantLocaleConfig()
  const s = formatCompanyDate(dayPart, cfg.dateFormat)
  return s || '—'
}

export function toDateInputValue(isoOrDate: string | Date | null | undefined): string {
  if (!isoOrDate) return ''
  if (typeof isoOrDate === 'string') {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(isoOrDate.trim())
    if (m) return m[1]
  }
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate
  if (isNaN(d.getTime())) return ''
  return localDateISO(d)
}

/**
 * Format a date using the tenant company date_format (and optional time_format).
 * Pass `locale` to force legacy browser locale formatting instead of company patterns.
 */
export function formatDate(
  date: string | Date | null | undefined,
  includeTime: boolean = false,
  locale?: string
): string {
  if (!date) return '—'

  const dateObj = typeof date === 'string' ? new Date(date) : date

  if (isNaN(dateObj.getTime())) return '—'

  if (locale) {
    if (includeTime) {
      return dateObj.toLocaleString(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    }
    return dateObj.toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const cfg = getTenantLocaleConfig()
  const ymd = localDateISO(dateObj)
  const dateStr = formatCompanyDate(ymd, cfg.dateFormat)
  if (!includeTime) return dateStr
  const timeStr = formatCompanyTime(dateObj, cfg.timeFormat)
  return `${dateStr} ${timeStr}`.trim()
}

/** Date + time using company date_format and time_format. */
export function formatDateTime(date: string | Date | null | undefined): string {
  return formatDate(date, true)
}

/**
 * Format a date as a long date string (Month Day, Year)
 * @param date Date string, Date object, or null/undefined
 * @returns Formatted date string or '—' if date is invalid
 */
export function formatDateLong(
  date: string | Date | null | undefined
): string {
  if (!date) return '—'

  const dateObj = typeof date === 'string' ? new Date(date) : date

  if (isNaN(dateObj.getTime())) return '—'

  const pattern = getTenantLocaleConfig().dateFormat
  const loc = pattern === 'MM/DD/YYYY' ? 'en-US' : 'en-GB'
  return dateObj.toLocaleDateString(loc, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/**
 * Get date range string (e.g., "Jan 1 - Jan 31, 2024")
 * @param startDate Start date
 * @param endDate End date
 * @returns Formatted date range string
 */
export function formatDateRange(
  startDate: string | Date | null | undefined,
  endDate: string | Date | null | undefined
): string {
  if (!startDate || !endDate) return '—'
  
  const start = formatDate(startDate)
  const end = formatDate(endDate)
  
  if (start === '—' || end === '—') return '—'
  
  return `${start} - ${end}`
}
