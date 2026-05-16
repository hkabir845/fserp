/** Default expense COA codes when setting a vendor's default receiving location. */

/** Fuel / shop site bills without line-level GL (matches backend CODE_OFFICE_EXP). */
export const VENDOR_DEFAULT_EXPENSE_COA_STATION = '6900'

/** Pond-tagged vendor bills without category (aquaculture "other", matches backend 6725). */
export const VENDOR_DEFAULT_EXPENSE_COA_POND = '6725'

export interface CoaPickForVendorDefault {
  id: number
  account_code: string
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
  const normalized = code.trim()
  const match = coaOptions.find((a) => String(a.account_code || '').trim() === normalized)
  return match && match.id > 0 ? String(match.id) : ''
}
