export const MAX_ANNUAL_APR = 9999.9999

function normalizeRoleKey(role: string): string {
  return role.trim().toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_')
}

/** True for bank / finance-company roles after normalizing case and separators. */
export function isBankOrFinanceCompanyRole(role: string): boolean {
  const rt = normalizeRoleKey(role || 'other')
  return (
    rt === 'bank' ||
    rt === 'finance_company' ||
    rt === 'financial_company' ||
    rt === 'financecompany' ||
    rt === 'financing_company'
  )
}

function formatLoanRateInput(n: number): string {
  if (!Number.isFinite(n)) return '0'
  let s = n.toFixed(4).replace(/0+$/, '')
  if (s.endsWith('.')) s = s.slice(0, -1)
  if (s === '' || s === '-') return '0'
  return s
}

/** Stored annual APR → form display (up to 4 dp); monthly mode shows annual÷12. */
export function formatInterestInputFromStoredAnnual(annual: number, monthlyDisplay: boolean): string {
  if (!Number.isFinite(annual) || annual <= 0) return '0'
  const shown = monthlyDisplay ? annual / 12 : annual
  return formatLoanRateInput(shown)
}

/**
 * Interpret the trimmed form value as stored annual % for the API.
 * Bank/finance: value is annual; otherwise value is nominal monthly and annual = value×12.
 * Returns null if empty, invalid, negative, or annual would exceed {@link MAX_ANNUAL_APR}.
 */
export function annualAprFromInterestFormInput(displayTrimmed: string, bankFinanceMode: boolean): string | null {
  const s = displayTrimmed.trim()
  if (s === '') return null
  const v = Number(s)
  if (!Number.isFinite(v) || v < 0) return null
  const annual = bankFinanceMode ? v : v * 12
  if (annual > MAX_ANNUAL_APR) return null
  const q = Math.round(Math.min(annual, MAX_ANNUAL_APR) * 10000) / 10000
  return formatLoanRateInput(q)
}

/** When counterparty type toggles bank/finance vs other, rescale the visible rate. */
export function convertInterestFieldOnCounterpartyChange(
  currentDisplay: string,
  fromBankFinance: boolean,
  toBankFinance: boolean
): string {
  if (fromBankFinance === toBankFinance) return currentDisplay
  const trim = currentDisplay.trim()
  if (trim === '') return currentDisplay
  const v = Number(trim)
  if (!Number.isFinite(v)) return currentDisplay
  if (!fromBankFinance && toBankFinance) return formatLoanRateInput(v * 12)
  if (fromBankFinance && !toBankFinance) return formatLoanRateInput(v / 12)
  return currentDisplay
}
