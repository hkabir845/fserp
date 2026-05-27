/**
 * Built-in chart-of-accounts template codes (fuel-station + aquaculture).
 * Mirrors backend `api.services.gl_posting` and loan/aquaculture seeds.
 */

export interface CoaPick {
  id: number
  account_code: string
  account_name?: string
}

export const COA_CASH = '1010'
export const COA_BANK_OP = '1030'
export const COA_FUEL_REV = '4100'
export const COA_SHOP_REV = '4200'
export const COA_OFFICE_EXP = '6900'
export const COA_SALARY_EXP = '6400'
export const COA_LENT_PRINCIPAL = '1160'
export const COA_BORROWED_PRINCIPAL = '2410'
export const COA_INTEREST_INCOME = '4410'
export const COA_INTEREST_EXPENSE = '6620'
export const COA_AQ_PROFIT_CLEARING = '3190'
export const COA_AQ_MISC_EXP = '6725'
export const COA_COGS_FUEL = '5100'
export const COA_COGS_SHOP = '5120'

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

/** First matching code from a preference list (e.g. bank 1030 then cash 1010). */
export function coaIdForFirstCode(codes: string[], options: CoaPick[]): string {
  for (const code of codes) {
    const id = coaIdForCode(code, options)
    if (id) return id
  }
  return ''
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
    debit_account_id: coaIdForFirstCode([COA_BANK_OP, COA_CASH], options),
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
  return coaIdForFirstCode([COA_BANK_OP, COA_CASH], options)
}

export function suggestedLoanInterestAccountId(direction: LoanDirection, options: CoaPick[]): string {
  const code = direction === 'lent' ? COA_INTEREST_INCOME : COA_INTEREST_EXPENSE
  return coaIdForCode(code, options)
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

export function suggestedBillLineExpenseAccountId(args: {
  vendorDefaultExpenseId?: number | null
  categoryDefaultExpenseId?: number | null
  itemExpenseId?: number | null
  options: CoaPick[]
}): number | undefined {
  const { vendorDefaultExpenseId, categoryDefaultExpenseId, itemExpenseId, options } = args
  if (itemExpenseId != null && itemExpenseId > 0) return itemExpenseId
  if (categoryDefaultExpenseId != null && categoryDefaultExpenseId > 0) {
    return categoryDefaultExpenseId
  }
  if (vendorDefaultExpenseId != null && vendorDefaultExpenseId > 0) {
    return vendorDefaultExpenseId
  }
  const fallback = coaIdForCode(COA_OFFICE_EXP, options)
  return fallback ? parseInt(fallback, 10) : undefined
}
