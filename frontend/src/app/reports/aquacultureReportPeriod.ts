import { fiscalPeriodForEndDate, localDateISO, parseFiscalYearStart } from '@/utils/date'
import {
  inferSalesPurchasePreset,
  salesPurchaseRangeForPreset,
  type SalesPurchasePeriodPreset,
} from './salesPurchasePeriod'

export type AquaculturePeriodPreset = SalesPurchasePeriodPreset | 'crop_year' | 'season_to_date'

export const AQUACULTURE_PERIOD_PRESETS: { id: AquaculturePeriodPreset; label: string }[] = [
  { id: 'crop_year', label: 'Crop year' },
  { id: 'season_to_date', label: 'Season to date' },
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'custom', label: 'Custom' },
]

export function defaultAquacultureReportRange(
  fiscalYearStart: string,
  today: Date = new Date()
): { startDate: string; endDate: string } {
  const { month, day } = parseFiscalYearStart(fiscalYearStart)
  const endLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  let endYear = today.getFullYear()
  let anniversary = new Date(endYear, month - 1, day)
  if (anniversary > endLocal) {
    endYear -= 1
    anniversary = new Date(endYear, month - 1, day)
  }
  return fiscalPeriodForEndDate(fiscalYearStart, anniversary)
}

/** Current in-progress crop year: fiscal start through today. */
export function aquacultureSeasonToDateRange(
  fiscalYearStart: string,
  today: Date = new Date()
): { startDate: string; endDate: string } {
  return fiscalPeriodForEndDate(fiscalYearStart, today)
}

export function aquacultureRangeForPreset(
  preset: AquaculturePeriodPreset,
  fiscalYearStart: string,
  today: Date = new Date()
): { startDate: string; endDate: string } {
  if (preset === 'crop_year') {
    return defaultAquacultureReportRange(fiscalYearStart, today)
  }
  if (preset === 'season_to_date') {
    return aquacultureSeasonToDateRange(fiscalYearStart, today)
  }
  if (preset === 'custom') {
    const endDate = localDateISO(today)
    return { startDate: endDate, endDate }
  }
  return salesPurchaseRangeForPreset(preset, today)
}

export function inferAquaculturePeriodPreset(
  range: { startDate: string; endDate: string },
  fiscalYearStart: string,
  today: Date = new Date()
): AquaculturePeriodPreset {
  const cropYear = defaultAquacultureReportRange(fiscalYearStart, today)
  if (range.startDate === cropYear.startDate && range.endDate === cropYear.endDate) {
    return 'crop_year'
  }
  const season = aquacultureSeasonToDateRange(fiscalYearStart, today)
  if (range.startDate === season.startDate && range.endDate === season.endDate) {
    return 'season_to_date'
  }
  const short = inferSalesPurchasePreset(range, today)
  if (short === 'custom') return 'custom'
  return short
}

export function isAquaculturePeriodReport(reportId: string | null | undefined): boolean {
  if (!reportId) return false
  return reportId.startsWith('aquaculture-') || reportId === 'ponds-pl-summary'
}
