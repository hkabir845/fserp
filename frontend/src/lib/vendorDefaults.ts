/** Default expense COA codes when setting a vendor's default receiving location. */

import { COA_AQ_MISC_EXP, COA_STATION_OPERATING, coaIdForCode, templateCoaOptionLabel } from '@/lib/coaDefaults'

/** Fuel / shop site bills without line-level GL (matches backend station operating default 6920). */
export const VENDOR_DEFAULT_EXPENSE_COA_STATION = COA_STATION_OPERATING

/** Pond-tagged vendor bills without category (aquaculture "other", matches backend 6725). */
export const VENDOR_DEFAULT_EXPENSE_COA_POND = COA_AQ_MISC_EXP

export interface CoaPickForVendorDefault {
  id: number
  account_code: string
  account_name?: string
}

export function coaAccountCodeForVendorDefaultReceiving(
  defaultReceiving: string
): string | null {
  const dr = String(defaultReceiving || '').trim()
  if (dr.startsWith('s:')) return VENDOR_DEFAULT_EXPENSE_COA_STATION
  if (dr.startsWith('p:')) return VENDOR_DEFAULT_EXPENSE_COA_POND
  return null
}

export function suggestVendorDefaultExpenseAccountId(
  defaultReceiving: string,
  coaOptions: CoaPickForVendorDefault[]
): string {
  const code = coaAccountCodeForVendorDefaultReceiving(defaultReceiving)
  if (!code) return ''
  return coaIdForCode(code, coaOptions)
}

/** Placeholder for the expense dropdown when a location is chosen but no override is saved yet. */
export function templateVendorDefaultExpenseOptionLabel(
  defaultReceiving: string,
  coaOptions: CoaPickForVendorDefault[]
): string {
  const code = coaAccountCodeForVendorDefaultReceiving(defaultReceiving)
  if (!code) return '— No vendor override (bill uses line item or system default) —'
  return templateCoaOptionLabel(code, coaOptions)
}
