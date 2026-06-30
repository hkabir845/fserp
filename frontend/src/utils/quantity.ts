/**
 * Measuring-unit quantities (kg, L, sacks, inventory QOH, pond area, etc.).
 * App standard: half-up rounding to exactly 2 fractional digits for display and API payloads.
 */
import { formatAmountPlain, formatNumber, roundToDecimals } from '@/utils/currency'

export const MEASURED_QUANTITY_DECIMALS = 2

/** Round a measuring quantity to 2 decimal places (half-up). */
export function roundQuantity(
  amount: number | string | null | undefined
): number {
  return roundToDecimals(amount, MEASURED_QUANTITY_DECIMALS)
}

/** Plain decimal string for forms/API (e.g. "12.50"). */
export function formatQuantityPlain(
  amount: number | string | null | undefined
): string {
  return formatAmountPlain(amount, MEASURED_QUANTITY_DECIMALS)
}

/** Display with thousands separators (e.g. "1,234.50"). */
export function formatQuantity(
  amount: number | string | null | undefined
): string {
  return formatNumber(amount, MEASURED_QUANTITY_DECIMALS)
}

/** Optional unit suffix: "12.50 kg" */
export function formatQuantityWithUnit(
  amount: number | string | null | undefined,
  unit: string | null | undefined
): string {
  const qty = formatQuantity(amount)
  const u = (unit || '').trim()
  return u ? `${qty} ${u}` : qty
}
