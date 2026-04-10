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
