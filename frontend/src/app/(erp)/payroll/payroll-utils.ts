import { format } from 'date-fns'

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function fmtBdt(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return '—'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'BDT',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n)
  } catch {
    return String(n)
  }
}

export function statusBadge(status: string) {
  const s = status.toLowerCase()
  if (s === 'posted')
    return 'bg-emerald-100 text-emerald-800 border border-emerald-200'
  if (s === 'draft') return 'bg-amber-100 text-amber-900 border border-amber-200'
  if (s === 'cancelled') return 'bg-slate-200 text-slate-700 border border-slate-300'
  return 'bg-gray-100 text-gray-800 border border-gray-200'
}

export function apiDetail(e: unknown) {
  const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof d === 'string' ? d : undefined
}

export function formatDateSafe(iso: string) {
  try {
    return format(new Date(iso), 'yyyy-MM-dd')
  } catch {
    return iso
  }
}
