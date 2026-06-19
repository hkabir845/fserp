/**
 * Built-in chart-of-accounts template codes (fuel-station + aquaculture + ERP modules).
 * Mirrors backend `api.services.erp_coa_defaults.ErpCoaCode`.
 */

export interface CoaPick {
  id: number
  account_code: string
  account_name?: string
}

// —— Bank & cash ——
export const COA_CASH = '1010'
export const COA_UNDEPOSITED = '1020'
export const COA_BANK_OP = '1030'
export const COA_CARD_CLEARING = '1120'
export const COA_AR = '1100'
export const COA_AP = '2000'
export const COA_VAT = '2100'

// —— Equity ——
export const COA_OWNER_EQUITY = '3000'
export const COA_RETAINED_EARNINGS = '3100'
export const COA_OPENING_BALANCE_EQUITY = '3200'
export const COA_OWNER_DRAW = '3300'
export const COA_AQ_PROFIT_CLEARING = '3190'

// —— Revenue ——
export const COA_FUEL_REV = '4100'
export const COA_DIESEL_REV = '4110'
export const COA_SHOP_REV = '4200'
export const COA_SERVICES_REV = '4220'
export const COA_OTHER_REV = '4230'
export const COA_NON_OPERATING_INCOME = '4400'

// —— COGS & inventory ——
export const COA_COGS_FUEL = '5100'
export const COA_COGS_LUBE = '5110'
export const COA_COGS_SHOP = '5120'
export const COA_SHRINK_FUEL = '5200'
export const COA_SHRINK_SHOP = '5210'
export const COA_INV_FUEL = '1200'
export const COA_INV_SHOP = '1220'
export const COA_INV_BIO = '1581'

// —— Loans ——
export const COA_LENT_PRINCIPAL = '1160'
export const COA_BORROWED_PRINCIPAL = '2410'
export const COA_INTEREST_INCOME = '4410'
export const COA_INTEREST_EXPENSE = '6620'

// —— Payroll ——
export const COA_SALARY_EXP = '6400'
export const COA_SALARY_PAYABLE = '2200'
export const COA_STAT_DED_PAYABLE = '2210'

// —— Fixed assets ——
export const COA_ACCUM_DEPR = '1550'
export const COA_DEPR_EXPENSE = '6320'
export const COA_FIXED_BUILDINGS = '1510'
export const COA_FIXED_EQUIPMENT = '1520'
export const COA_FIXED_VEHICLES = '1540'
export const COA_ASSET_DISPOSAL_LOSS = '7400'

// —— Station / aquaculture expenses ——
export const COA_OFFICE_EXP = '6900'
export const COA_STATION_OPERATING = '6920'
export const COA_STATION_MISC = '6990'
export const COA_DONATION = '6910'
export const COA_UTIL_ELECTRIC = '6100'
export const COA_REPAIR_SITE = '6300'
export const COA_AQ_MISC_EXP = '6725'
export const COA_AQ_LEASE = '6711'
export const COA_AQ_LABOR = '6712'
export const COA_AQ_FEED = '6716'
export const COA_AQ_MEDICINE = '6721'
export const COA_AQ_REV_HARVEST = '4240'
export const COA_REV_AQ_HARVEST = '4240'
export const COA_REV_AQ_FINGERLING = '4241'

/** Default settlement order: operating bank, then cash. */
export const COA_SETTLEMENT_PREFERENCE = [COA_BANK_OP, COA_CASH] as const

export function coaIdForCode(code: string, options: CoaPick[]): string {
  const normalized = String(code || '').trim()
  if (!normalized) return ''
  const match = options.find((a) => String(a.account_code || '').trim() === normalized)
  return match && match.id > 0 ? String(match.id) : ''
}

export function recommendedCoaLabel(code: string, options: CoaPick[]): string {
  const match = options.find((a) => String(a.account_code || '').trim() === String(code || '').trim())
  if (match) {
    const name = String(match.account_name || '').trim()
    return name ? `${match.account_code} — ${name}` : String(match.account_code || code)
  }
  return code
}

/** First dropdown option for optional GL overrides (empty value = use template at post time). */
export function templateCoaOptionLabel(code: string, options: CoaPick[]): string {
  return `— Recommended: ${recommendedCoaLabel(code, options)} —`
}

export function coaIdForFirstCode(codes: readonly string[], options: CoaPick[]): string {
  for (const code of codes) {
    const id = coaIdForCode(code, options)
    if (id) return id
  }
  return ''
}

export function suggestedSettlementAccountId(options: CoaPick[]): string {
  return coaIdForFirstCode(COA_SETTLEMENT_PREFERENCE, options)
}

export function suggestedOwnerEquityContributionAccountIds(options: CoaPick[]): {
  debit_account_id: string
  credit_account_id: string
} {
  return {
    debit_account_id: suggestedSettlementAccountId(options),
    credit_account_id: coaIdForCode(COA_OWNER_EQUITY, options),
  }
}

export function suggestedOwnerDrawAccountIds(options: CoaPick[]): {
  debit_account_id: string
  credit_account_id: string
} {
  return {
    debit_account_id: coaIdForCode(COA_OWNER_DRAW, options),
    credit_account_id: suggestedSettlementAccountId(options),
  }
}

export function suggestedPayrollSalaryExpenseAccountId(options: CoaPick[]): string {
  return coaIdForCode(COA_SALARY_EXP, options)
}

export function suggestedInvoiceRevenueAccountId(options: CoaPick[]): string {
  return coaIdForFirstCode([COA_FUEL_REV, COA_SHOP_REV], options)
}

export function suggestedAquacultureProfitTransferAccountIds(options: CoaPick[]): {
  debit_account_id: string
  credit_account_id: string
} {
  return {
    debit_account_id: suggestedSettlementAccountId(options),
    credit_account_id: coaIdForCode(COA_AQ_PROFIT_CLEARING, options),
  }
}

export type LoanDirection = 'borrowed' | 'lent'

export function suggestedLoanPrincipalAccountId(
  direction: LoanDirection,
  options: CoaPick[],
  counterpartyPrincipalId?: number | null
): string {
  if (counterpartyPrincipalId != null && counterpartyPrincipalId > 0) {
    return String(counterpartyPrincipalId)
  }
  const code = direction === 'lent' ? COA_LENT_PRINCIPAL : COA_BORROWED_PRINCIPAL
  return coaIdForCode(code, options)
}

export function suggestedLoanSettlementAccountId(options: CoaPick[]): string {
  return suggestedSettlementAccountId(options)
}

export function suggestedLoanInterestAccountId(direction: LoanDirection, options: CoaPick[]): string {
  const code = direction === 'lent' ? COA_INTEREST_INCOME : COA_INTEREST_EXPENSE
  return coaIdForCode(code, options)
}

export function suggestedFixedAssetAccountIds(options: CoaPick[]): {
  asset_account_id: string
  accumulated_depreciation_account_id: string
  depreciation_expense_account_id: string
  settlement_account_id: string
} {
  return {
    asset_account_id: coaIdForFirstCode([COA_FIXED_EQUIPMENT, COA_FIXED_BUILDINGS, COA_FIXED_VEHICLES], options),
    accumulated_depreciation_account_id: coaIdForCode(COA_ACCUM_DEPR, options),
    depreciation_expense_account_id: coaIdForCode(COA_DEPR_EXPENSE, options),
    settlement_account_id: suggestedSettlementAccountId(options),
  }
}

export function suggestedFixedAssetDisposalAccountIds(options: CoaPick[]): {
  gain_account_id: string
  loss_account_id: string
} {
  return {
    gain_account_id: coaIdForCode(COA_INTEREST_INCOME, options),
    loss_account_id: coaIdForCode(COA_ASSET_DISPOSAL_LOSS, options),
  }
}

/** Pick a template code present in `subset`, else first row in subset. */
export function pickCoaIdInSubset(
  subset: CoaPick[],
  allOptions: CoaPick[],
  preferredCodes: string[]
): number {
  for (const code of preferredCodes) {
    const id = parseInt(coaIdForCode(code, allOptions), 10)
    if (id > 0 && subset.some((a) => a.id === id)) return id
  }
  const first = subset[0]
  return first && first.id > 0 ? first.id : 0
}

/** Return id only when it exists in the loaded COA list (avoids stale vendor/category defaults). */
export function coaPickIdIfValid(
  id: number | null | undefined,
  options: CoaPick[]
): number | undefined {
  if (id == null || id <= 0) return undefined
  return options.some((a) => a.id === id) ? id : undefined
}

export function suggestedBillLineExpenseAccountId(args: {
  vendorDefaultExpenseId?: number | null
  categoryDefaultExpenseId?: number | null
  itemExpenseId?: number | null
  options: CoaPick[]
}): number | undefined {
  const { vendorDefaultExpenseId, categoryDefaultExpenseId, itemExpenseId, options } = args
  const item = coaPickIdIfValid(itemExpenseId, options)
  if (item) return item
  const category = coaPickIdIfValid(categoryDefaultExpenseId, options)
  if (category) return category
  const vendor = coaPickIdIfValid(vendorDefaultExpenseId, options)
  if (vendor) return vendor
  const fallback = coaIdForCode(COA_STATION_OPERATING, options) || coaIdForCode(COA_OFFICE_EXP, options)
  return fallback ? parseInt(fallback, 10) : undefined
}

export interface ErpCoaPurposeRow {
  key: string
  module: string
  label: string
  account_code: string
  hint: string
  account_id: number | null
  account_name: string | null
  account_type: string | null
  resolved: boolean
}

export interface ErpCoaDefaultsResponse {
  purposes: ErpCoaPurposeRow[]
  by_module: Record<string, ErpCoaPurposeRow[]>
  by_account_type: Record<string, ErpCoaPurposeRow[]>
  codes: Record<string, string>
  settlement_preference: string[]
  fuel_station_expense_rollup_coa: Record<string, string>
  fuel_station_income_rollup_coa: Record<string, string>
  aquaculture_expense_category_coa: Record<string, string>
  aquaculture_income_type_coa: Record<string, string>
  note: string
}

/** Load resolved built-in defaults for this company (GET /chart-of-accounts/erp-defaults/). */
export async function fetchErpCoaDefaults(
  apiGet: (url: string) => Promise<{ data: ErpCoaDefaultsResponse }>
): Promise<ErpCoaDefaultsResponse> {
  const { data } = await apiGet('/chart-of-accounts/erp-defaults/')
  return data
}

export function purposeAccountId(
  defaults: ErpCoaDefaultsResponse | null | undefined,
  purposeKey: string
): number | null {
  const row = defaults?.purposes?.find((p) => p.key === purposeKey)
  return row?.account_id ?? null
}
