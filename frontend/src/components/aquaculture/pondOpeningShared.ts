/** Types and helpers for pond opening balance (P&L + balance sheet). */

export interface PlCategoryRow {
  category_code: string
  category_label: string
  amount: string
  as_of_date: string | null
  memo?: string
  signed_contribution: string
  side: string
}

export type BalanceSheetKind = 'customer' | 'vendor' | 'employee' | 'loan'

export interface BalanceSheetLine {
  kind: BalanceSheetKind
  track: 'balance_sheet' | 'advanced'
  party_id: number
  name: string
  code: string
  opening_balance: string
  opening_balance_date: string | null
  signed_contribution: string
  side: 'receivable' | 'payable' | 'clear'
  locked: boolean
  label?: string
  opening_balance_type?: string
  opening_balance_journal_id?: number | null
  opening_balance_journal_number?: string
  opening_balance_locked?: boolean
}

export interface GoLiveCheck {
  id: string
  label: string
  status: 'complete' | 'warning' | 'missing' | 'optional' | 'na'
  detail: string
  tab?: string | null
  href?: string | null
}

export interface GoLiveSpecies {
  code: string
  label: string
  fish_count: number
  weight_kg: string
}

export interface PondGoLive {
  readiness_percent: number
  ready: boolean
  checks: GoLiveCheck[]
  biology: {
    species: GoLiveSpecies[]
    total_fish_count: number
    total_weight_kg: string
    has_biomass: boolean
  }
  inventory: {
    feed_lines: number
    medicine_lines: number
    total_lines: number
    estimated_value: string
    items: { item_id: number; item_name: string; quantity: string; unit: string; pos_category: string }[]
  }
  bioasset: {
    estimated_value: string
    cost_per_kg: string | null
    biomass_kg: string
    prior_expense_signed: string
    prior_income_signed: string
    method: string
    note: string
  }
  lease: {
    has_contract: boolean
    contract_total: string | null
    paid_to_landlord: string
    balance_due: string | null
    remaining_years: number | null
    remaining_months: number | null
  }
}

export interface PondOpeningSummary {
  pond_id: number
  pond_name: string
  pond_code: string
  is_active: boolean
  pos_customer_id: number | null
  pos_customer_display?: string | null
  lease_paid_to_landlord: string
  balance_sheet_lines: BalanceSheetLine[]
  pl_openings: {
    income: PlCategoryRow[]
    expense: PlCategoryRow[]
    totals: {
      income_signed: string
      expense_signed: string
      net_pl_signed: string
    }
    pl_opening_gl_locked?: boolean
    pl_opening_journal_id?: number | null
    pl_opening_journal_number?: string
  }
  totals: {
    balance_sheet_receivable_signed: string
    balance_sheet_payable_signed: string
    net_balance_sheet_signed: string
    pl_income_signed: string
    pl_expense_signed: string
    net_pl_signed: string
  }
  landlord_note: string
  go_live?: PondGoLive
}

export interface OpeningBalancesResponse {
  cutover_date?: string
  go_live?: {
    ready_ponds: number
    total_ponds: number
    ready_percent: number
    message?: string
  }
  ponds: PondOpeningSummary[]
  catalog: CategoryCatalog
  conventions?: Record<string, string>
  saved?: number
  errors?: { detail: string }[]
}

export interface CategoryCatalog {
  income_types: { code: string; label: string }[]
  expense_categories: { code: string; label: string }[]
  expense_excluded: { code: string; label: string; note: string }[]
}

export function checkStatusTone(status: GoLiveCheck['status']): string {
  switch (status) {
    case 'complete':
      return 'text-emerald-800 bg-emerald-50 border-emerald-200'
    case 'warning':
      return 'text-amber-900 bg-amber-50 border-amber-200'
    case 'missing':
      return 'text-rose-900 bg-rose-50 border-rose-200'
    case 'optional':
      return 'text-slate-600 bg-slate-50 border-slate-200'
    default:
      return 'text-slate-500 bg-slate-50 border-slate-100'
  }
}

export function checkStatusLabel(status: GoLiveCheck['status']): string {
  switch (status) {
    case 'complete':
      return 'Done'
    case 'warning':
      return 'Review'
    case 'missing':
      return 'Needed'
    case 'optional':
      return 'Optional'
    case 'na':
      return 'N/A'
    default:
      return status
  }
}

export function parseMoney(s: string | null | undefined): number {
  const n = Number(String(s ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

export function formatSigned(n: number, sym: string): string {
  if (n === 0) return '—'
  const formatted = Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return n > 0 ? `+${sym}${formatted}` : `−${sym}${formatted}`
}

export function signedTone(n: number): string {
  if (n > 0) return 'text-emerald-800'
  if (n < 0) return 'text-amber-900'
  return 'text-slate-600'
}

export function bsLinesOfKind(lines: BalanceSheetLine[], kind: BalanceSheetKind): BalanceSheetLine[] {
  return lines.filter((l) => l.kind === kind)
}

export function advancedLines(lines: BalanceSheetLine[]): BalanceSheetLine[] {
  return lines.filter((l) => l.track === 'advanced')
}

export function partyEditHref(kind: BalanceSheetKind, partyId: number): string {
  switch (kind) {
    case 'customer':
      return `/customers/${partyId}/ledger`
    case 'vendor':
      return '/vendors'
    case 'employee':
      return '/employees'
    case 'loan':
      return '/loans'
    default:
      return '/'
  }
}

/** Balance-sheet party line (customer, vendor, employee, loan). */
export type OpeningPartyLine = BalanceSheetLine
export type OpeningPartyKind = BalanceSheetKind

export function pondLines(p: PondOpeningSummary): BalanceSheetLine[] {
  return p.balance_sheet_lines ?? []
}

export function linesOfKind(
  source: PondOpeningSummary | BalanceSheetLine[],
  kind: OpeningPartyKind,
): BalanceSheetLine[] {
  const lines = Array.isArray(source) ? source : pondLines(source)
  return lines.filter((l) => l.kind === kind)
}

/** Sum signed contributions for balance-sheet party lines of one kind. */
export function signedByKind(
  source: PondOpeningSummary | BalanceSheetLine[],
  kind: OpeningPartyKind,
): number {
  return linesOfKind(source, kind).reduce((sum, ln) => sum + parseMoney(ln.signed_contribution), 0)
}

export type PlKind = 'income' | 'expense'

export function plRows(p: PondOpeningSummary, kind: PlKind): PlCategoryRow[] {
  return kind === 'income' ? p.pl_openings?.income ?? [] : p.pl_openings?.expense ?? []
}

/** P&L rows from API, or zero-filled rows from catalog when API omits pl_openings. */
export function plRowsForPond(
  p: PondOpeningSummary,
  kind: PlKind,
  catalog: CategoryCatalog | null,
): PlCategoryRow[] {
  const rows = plRows(p, kind)
  if (rows.length > 0) return rows
  const list = kind === 'income' ? catalog?.income_types : catalog?.expense_categories
  if (!list?.length) return []
  return list.map((c) => ({
    category_code: c.code,
    category_label: c.label,
    amount: '0',
    as_of_date: null,
    signed_contribution: '0',
    side: kind === 'income' ? 'income' : 'expense',
  }))
}
