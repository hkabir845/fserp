/** Must match backend api.views.companies_views allowlists. */

export const COMPANY_DATE_FORMAT_OPTIONS: { value: string; label: string; example: string }[] = [
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (ISO)', example: '2026-04-06' },
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY', example: '06/04/2026' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY', example: '04/06/2026' },
  { value: 'DD-MM-YYYY', label: 'DD-MM-YYYY', example: '06-04-2026' },
]

export const COMPANY_TIME_FORMAT_OPTIONS: { value: string; label: string; example: string }[] = [
  { value: 'HH:mm', label: '24-hour', example: '14:30' },
  { value: 'hh:mm A', label: '12-hour with AM/PM', example: '2:30 PM' },
]

export const DEFAULT_COMPANY_DATE_FORMAT = 'YYYY-MM-DD'
export const DEFAULT_COMPANY_TIME_FORMAT = 'HH:mm'

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Format a calendar date (YYYY-MM-DD or ISO) for display using the company pattern. */
export function formatCompanyDate(isoOrYmd: string, pattern: string): string {
  const raw = String(isoOrYmd || '').trim()
  if (!raw) return ''
  const d = new Date(raw.includes('T') ? raw : `${raw.split('T')[0]}T12:00:00`)
  if (Number.isNaN(d.getTime())) return raw
  const y = d.getFullYear()
  const m = pad2(d.getMonth() + 1)
  const day = pad2(d.getDate())
  switch (pattern) {
    case 'DD/MM/YYYY':
      return `${day}/${m}/${y}`
    case 'MM/DD/YYYY':
      return `${m}/${day}/${y}`
    case 'DD-MM-YYYY':
      return `${day}-${m}-${y}`
    case 'YYYY-MM-DD':
    default:
      return `${y}-${m}-${day}`
  }
}

/** Format a Date (or parseable string) for time-only display using the company pattern. */
export function formatCompanyTime(input: Date | string, pattern: string): string {
  const d = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(d.getTime())) return ''
  const mins = pad2(d.getMinutes())
  if (pattern === 'hh:mm A') {
    const h24 = d.getHours()
    const h12 = h24 % 12 || 12
    const ampm = h24 >= 12 ? 'PM' : 'AM'
    return `${h12}:${mins} ${ampm}`
  }
  return `${pad2(d.getHours())}:${mins}`
}

/** True when company time is 12-hour with AM/PM (matches `COMPANY_TIME_FORMAT_OPTIONS`). */
export function is12HourTimeFormat(pattern: string): boolean {
  return String(pattern || '').trim() === 'hh:mm A'
}

/**
 * Normalize API time strings (HH:MM, H:MM:SS, or ISO datetime) to `HH:MM` for inputs and APIs.
 */
export function toHhMmString(isoOrHhmm: string | null | undefined): string {
  if (isoOrHhmm == null) return ''
  const s = String(isoOrHhmm).trim()
  if (!s) return ''
  if (s.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s)
    if (!Number.isNaN(d.getTime())) {
      return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
    }
  }
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?(?:\.\d+)?$/.exec(s)
  if (m) {
    const h = Number(m[1])
    const min = Number(m[2])
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return `${pad2(h)}:${pad2(min)}`
    }
  }
  return ''
}

export function formatWallClockTime(
  isoOrHhmm: string | null | undefined,
  timeFormat: string
): string {
  if (isoOrHhmm == null || String(isoOrHhmm).trim() === '') return '—'
  const hh = toHhMmString(isoOrHhmm)
  if (!hh) return '—'
  const [h, m] = hh.split(':').map(Number)
  const d = new Date(2000, 0, 1, h, m, 0, 0)
  return formatCompanyTime(d, timeFormat) || '—'
}

export function split24hTo12(
  hhmm: string
): { hour12: number; minute: number; ap: 'AM' | 'PM' } | null {
  const t = toHhMmString(hhmm)
  if (!t) return null
  const [hs, ms] = t.split(':')
  const h = Number(hs)
  const min = Number(ms)
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  const ap: 'AM' | 'PM' = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 || 12
  return { hour12, minute: min, ap }
}

export function merge12hTo24(hour12: number, minute: number, ap: 'AM' | 'PM'): string {
  if (hour12 < 1 || hour12 > 12 || minute < 0 || minute > 59) {
    return '00:00'
  }
  let h = 0
  if (ap === 'AM') {
    h = hour12 === 12 ? 0 : hour12
  } else {
    h = hour12 === 12 ? 12 : hour12 + 12
  }
  return `${pad2(h)}:${pad2(minute)}`
}
