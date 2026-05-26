import { localDateISO } from '@/utils/date'

export type SalesPurchasePeriodPreset = 'today' | '7d' | '15d' | '30d' | '90d' | 'custom'

export const SALES_PURCHASE_PERIOD_STORAGE_KEY = 'fserp_sales_purchase_period'

export const SALES_PURCHASE_PERIOD_PRESETS: {
  id: SalesPurchasePeriodPreset
  label: string
}[] = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '15d', label: '15 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'custom', label: 'Custom' },
]

/** Inclusive calendar-day range ending today (local timezone). */
export function salesPurchaseRangeForPreset(
  preset: SalesPurchasePeriodPreset,
  today: Date = new Date()
): { startDate: string; endDate: string } {
  const endDate = localDateISO(today)
  if (preset === 'today' || preset === 'custom') {
    return { startDate: endDate, endDate }
  }
  const daysBack: Record<Exclude<SalesPurchasePeriodPreset, 'today' | 'custom'>, number> = {
    '7d': 6,
    '15d': 14,
    '30d': 29,
    '90d': 89,
  }
  const offset = daysBack[preset as keyof typeof daysBack] ?? 0
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset)
  return { startDate: localDateISO(start), endDate }
}

export function inferSalesPurchasePreset(
  range: { startDate: string; endDate: string },
  today: Date = new Date()
): SalesPurchasePeriodPreset {
  for (const preset of ['today', '7d', '15d', '30d', '90d'] as const) {
    const expected = salesPurchaseRangeForPreset(preset, today)
    if (range.startDate === expected.startDate && range.endDate === expected.endDate) {
      return preset
    }
  }
  return 'custom'
}

export function loadStoredSalesPurchasePeriod(): {
  preset: SalesPurchasePeriodPreset
  range: { startDate: string; endDate: string }
} {
  const todayRange = salesPurchaseRangeForPreset('today')
  if (typeof window === 'undefined') {
    return { preset: 'today', range: todayRange }
  }
  try {
    const raw = localStorage.getItem(SALES_PURCHASE_PERIOD_STORAGE_KEY)
    if (!raw) return { preset: 'today', range: todayRange }
    const parsed = JSON.parse(raw) as {
      preset?: string
      startDate?: string
      endDate?: string
    }
    const startDate = (parsed.startDate || todayRange.startDate).slice(0, 10)
    const endDate = (parsed.endDate || todayRange.endDate).slice(0, 10)
    const preset = SALES_PURCHASE_PERIOD_PRESETS.some((p) => p.id === parsed.preset)
      ? (parsed.preset as SalesPurchasePeriodPreset)
      : inferSalesPurchasePreset({ startDate, endDate })
    return { preset, range: { startDate, endDate } }
  } catch {
    return { preset: 'today', range: todayRange }
  }
}

export function persistSalesPurchasePeriod(
  preset: SalesPurchasePeriodPreset,
  range: { startDate: string; endDate: string }
) {
  try {
    localStorage.setItem(
      SALES_PURCHASE_PERIOD_STORAGE_KEY,
      JSON.stringify({ preset, startDate: range.startDate, endDate: range.endDate })
    )
  } catch {
    /* ignore */
  }
}
