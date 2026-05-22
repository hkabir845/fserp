/** Shared types and helpers for aquaculture landlords UI. */

export interface PondOpt {
  id: number
  name: string
  lease_price_per_decimal_per_year?: string | null
}

export type ShareDraft = { pond_id: string; land_area_decimal: string; notes: string }

export function emptyShareDraft(): ShareDraft {
  return { pond_id: '', land_area_decimal: '', notes: '' }
}

export function impliedAnnualFromPondRow(landDec: string, pond: PondOpt | undefined): string | null {
  const a = Number(String(landDec).replace(/,/g, ''))
  const raw = pond?.lease_price_per_decimal_per_year
  const p = raw != null && raw !== '' ? Number(String(raw).replace(/,/g, '')) : NaN
  if (!Number.isFinite(a) || !Number.isFinite(p) || a <= 0 || p < 0) return null
  return (a * p).toFixed(2)
}

export function parseMoney(s: string): number {
  const n = Number(String(s).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

export function statusLabel(s: string): string {
  if (s === 'payable') return 'We owe'
  if (s === 'credit') return 'Credit / prepaid'
  return 'Clear'
}

export function statusClass(s: string): string {
  if (s === 'payable') return 'bg-amber-100 text-amber-900'
  if (s === 'credit') return 'bg-sky-100 text-sky-900'
  return 'bg-emerald-100 text-emerald-800'
}

export function kindLabel(k: string): string {
  if (k === 'rent_charge') return 'Rent charge'
  if (k === 'payment') return 'Payment'
  if (k === 'adjustment') return 'Adjustment'
  return k
}

export interface LandlordDetail {
  id: number
  name: string
  code: string
  phone: string
  email: string
  notes: string
  is_active: boolean
  balance_signed: string
  balance_status: string
  opening_balance?: string
  opening_balance_date?: string | null
  opening_balance_locked?: boolean
  opening_balance_journal_id?: number | null
  opening_balance_journal_number?: string
  pond_shares: {
    id?: number
    pond_id: number
    pond_name: string
    land_area_decimal: string
    notes: string
  }[]
  ledger?: {
    id: number
    entry_date: string
    kind: string
    amount_signed: string
    running_balance: string
    memo: string
    reference: string
    pond_id: number | null
    pond_name: string
    applies_to_lease_paid: boolean
    charge_display?: string | null
    payment_display?: string | null
    journal_entry_number?: string
  }[]
}

export type LandlordFormValues = {
  name: string
  code: string
  phone: string
  email: string
  notes: string
  isActive: boolean
  shareDrafts: ShareDraft[]
  openingBalance: string
  openingBalanceDate: string
  openingLocked: boolean
}

export function defaultFormValues(): LandlordFormValues {
  return {
    name: '',
    code: '',
    phone: '',
    email: '',
    notes: '',
    isActive: true,
    shareDrafts: [],
    openingBalance: '',
    openingBalanceDate: new Date().toISOString().slice(0, 10),
    openingLocked: false,
  }
}

export function formValuesFromDetail(d: LandlordDetail): LandlordFormValues {
  return {
    name: d.name || '',
    code: d.code || '',
    phone: d.phone || '',
    email: d.email || '',
    notes: d.notes || '',
    isActive: d.is_active !== false,
    shareDrafts: (d.pond_shares || []).map((s) => ({
      pond_id: String(s.pond_id),
      land_area_decimal: String(s.land_area_decimal || ''),
      notes: s.notes || '',
    })),
    openingBalance: d.opening_balance != null ? String(d.opening_balance) : '0',
    openingBalanceDate: d.opening_balance_date
      ? d.opening_balance_date.slice(0, 10)
      : new Date().toISOString().slice(0, 10),
    openingLocked: !!d.opening_balance_locked,
  }
}

export function buildLandlordPayload(
  values: LandlordFormValues,
  mode: 'create' | 'edit',
): { payload: Record<string, unknown> | null; error: string | null } {
  const n = values.name.trim()
  if (!n) return { payload: null, error: 'Name is required' }

  const seenPonds = new Set<number>()
  const pond_shares: { pond_id: number; land_area_decimal: string; notes: string }[] = []
  for (const row of values.shareDrafts) {
    const hasPond = !!row.pond_id
    const hasArea = !!row.land_area_decimal.trim()
    if (!hasPond && !hasArea) continue
    if (!hasPond || !hasArea) {
      return { payload: null, error: 'Each pond share needs both a pond and land decimals greater than zero' }
    }
    const pid = parseInt(row.pond_id, 10)
    const area = Number(row.land_area_decimal.trim().replace(/,/g, ''))
    if (!Number.isFinite(pid) || !Number.isFinite(area) || area <= 0) {
      return { payload: null, error: 'Each pond share needs a valid pond and land decimals greater than zero' }
    }
    if (seenPonds.has(pid)) {
      return { payload: null, error: 'Each pond can only appear once in land shares' }
    }
    seenPonds.add(pid)
    pond_shares.push({
      pond_id: pid,
      land_area_decimal: row.land_area_decimal.trim(),
      notes: row.notes.trim(),
    })
  }

  const payload: Record<string, unknown> = {
    name: n,
    code: values.code.trim(),
    phone: values.phone.trim(),
    email: values.email.trim(),
    notes: values.notes.trim(),
    is_active: values.isActive,
    pond_shares,
  }

  if (!values.openingLocked) {
    const obRaw = values.openingBalance.trim().replace(/,/g, '')
    const obNum = obRaw === '' ? 0 : Number(obRaw)
    if (!Number.isFinite(obNum)) {
      return { payload: null, error: 'Enter a valid opening balance amount' }
    }
    if (obNum !== 0 && !values.openingBalanceDate.trim()) {
      return { payload: null, error: 'As-of date is required when opening balance is not zero' }
    }
    if (obNum !== 0) {
      payload.opening_balance = obNum
      payload.opening_balance_date = values.openingBalanceDate
    } else if (mode === 'edit') {
      payload.opening_balance = 0
      payload.opening_balance_date = null
    }
  }

  return { payload, error: null }
}
