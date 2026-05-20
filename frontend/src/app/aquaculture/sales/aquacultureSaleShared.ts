export interface Pond {
  id: number
  name: string
}

export interface IncomeTypeOpt {
  id: string
  label: string
  tenant_defined?: boolean
  maps_to_code?: string | null
  non_biological_sale?: boolean
}

export interface FishSpeciesOpt {
  id: string
  label: string
}

export interface CycleRow {
  id: number
  name: string
}

export interface SaleRow {
  id: number
  pond_id: number
  pond_name: string
  production_cycle_id?: number | null
  production_cycle_name?: string
  income_type?: string
  income_type_label?: string
  fish_species?: string
  fish_species_other?: string
  fish_species_label?: string
  sale_date: string
  weight_kg: string
  fish_count: number | null
  total_amount: string
  buyer_name: string
  memo: string
  invoice_id?: number | null
  invoice_number?: string | null
  accounting_posted?: boolean
}

export interface CustomerSuggestion {
  id: number
  display_name?: string | null
  company_name?: string | null
  first_name?: string | null
  is_active?: boolean
}

export type SaleLineDraft = {
  localId: string
  production_cycle_id: string
  income_type: string
  fish_species: string
  fish_species_other: string
  weight_kg: string
  fish_per_kg: string
  fish_count: string
  sale_price_per_kg: string
  total_amount: string
}

export type SaleHeaderDraft = {
  pond_id: string
  sale_date: string
  buyer_name: string
  memo: string
}

const NON_BIOLOGICAL_INCOME_TYPES = new Set([
  'empty_feed_sack_sale',
  'used_material_sale',
  'rejected_material_sale',
  'used_equipment_sale',
])

export function isNonFishSaleIncome(incomeType: string | undefined, types: IncomeTypeOpt[]): boolean {
  if (!incomeType) return false
  const row = types.find((t) => t.id === incomeType)
  if (row && typeof row.non_biological_sale === 'boolean') return row.non_biological_sale
  return NON_BIOLOGICAL_INCOME_TYPES.has(incomeType)
}

export function fishPerKg(weightKg: number, fishCount: number | null | undefined): number | null {
  if (fishCount == null || fishCount <= 0 || !Number.isFinite(weightKg) || weightKg <= 0) return null
  return fishCount / weightKg
}

export function customerPickLabel(c: CustomerSuggestion): string {
  const d = (c.display_name || '').trim()
  if (d) return d
  const co = (c.company_name || '').trim()
  if (co) return co
  const f = (c.first_name || '').trim()
  if (f) return f
  return `Customer #${c.id}`
}

export function normalizeCustomersFromApi(data: unknown): CustomerSuggestion[] {
  let rows: unknown[] = []
  if (Array.isArray(data)) rows = data
  else if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>
    if (Array.isArray(o.results)) rows = o.results
  }
  return rows
    .filter((row): row is Record<string, unknown> => row != null && typeof row === 'object')
    .flatMap((r) => {
      const id = typeof r.id === 'number' ? r.id : Number(r.id)
      if (!Number.isFinite(id)) return []
      if (r.is_active === false) return []
      return [
        {
          id,
          display_name: r.display_name != null ? String(r.display_name) : null,
          company_name: r.company_name != null ? String(r.company_name) : null,
          first_name: r.first_name != null ? String(r.first_name) : null,
          is_active: r.is_active !== false,
        },
      ]
    })
}

export function newLineLocalId(): string {
  return `line-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function emptyFishHarvestLine(): SaleLineDraft {
  return {
    localId: newLineLocalId(),
    production_cycle_id: '',
    income_type: 'fish_harvest_sale',
    fish_species: 'tilapia',
    fish_species_other: '',
    weight_kg: '',
    fish_per_kg: '',
    fish_count: '',
    sale_price_per_kg: '',
    total_amount: '',
  }
}

export function emptyNonFishLine(incomeType = 'empty_feed_sack_sale'): SaleLineDraft {
  return {
    localId: newLineLocalId(),
    production_cycle_id: '',
    income_type: incomeType,
    fish_species: 'not_applicable',
    fish_species_other: '',
    weight_kg: '',
    fish_per_kg: '',
    fish_count: '',
    sale_price_per_kg: '',
    total_amount: '',
  }
}

export function saleRowToLineDraft(r: SaleRow): SaleLineDraft {
  const wk = Number(r.weight_kg)
  const taNum = Number(r.total_amount)
  const derivedSalePrice =
    Number.isFinite(wk) && wk > 0 && Number.isFinite(taNum) && taNum >= 0 ? String(taNum / wk) : ''
  const derivedPerKg =
    r.fish_count != null && r.fish_count > 0 && Number.isFinite(wk) && wk > 0
      ? fishPerKg(wk, r.fish_count)
      : null
  return {
    localId: newLineLocalId(),
    production_cycle_id: r.production_cycle_id != null ? String(r.production_cycle_id) : '',
    income_type: r.income_type || 'fish_harvest_sale',
    fish_species: r.fish_species || 'tilapia',
    fish_species_other: r.fish_species_other || '',
    weight_kg: r.weight_kg,
    fish_per_kg: derivedPerKg != null ? String(derivedPerKg) : '',
    fish_count: r.fish_count != null ? String(r.fish_count) : '',
    sale_price_per_kg: derivedSalePrice,
    total_amount: r.total_amount,
  }
}
