/** Shared helpers for vendor bill lines tagged to aquaculture ponds. */

export interface AquacultureBillExpenseCategory {
  id: string
  label: string
  hint?: string | null
  tenant_defined?: boolean
  maps_to_code?: string | null
  bill_create_allowed?: boolean
  bill_create_disallowed_reason?: string | null
  default_coa_account_code?: string
  default_coa_account_id?: number | null
  default_coa_account_name?: string
  default_cost_bucket?: string
}

export interface BillLineAquacultureFields {
  aquaculture_pond_id?: number | '' | null
  aquaculture_production_cycle_id?: number | '' | null
  aquaculture_expense_category?: string
  aquaculture_cost_bucket?: string
  expense_account_id?: number
  description?: string
  item_id?: number
}

export function billExpenseCategoriesFromApi(
  rows: AquacultureBillExpenseCategory[] | undefined
): AquacultureBillExpenseCategory[] {
  if (!rows?.length) return []
  const hasFlag = rows.some((c) => c.bill_create_allowed !== undefined)
  if (!hasFlag) {
    const excluded = new Set([
      'vendor_bill_pond',
      'lease',
      'worker_salary',
      'feed_consumed',
      'medicine_consumed',
    ])
    return rows.filter((c) => !excluded.has(c.id))
  }
  return rows.filter((c) => c.bill_create_allowed !== false)
}

export function applyAquacultureCategoryToBillLine<
  T extends BillLineAquacultureFields,
>(line: T, cat: AquacultureBillExpenseCategory | undefined): T {
  if (!cat) return line
  const next: T = {
    ...line,
    aquaculture_expense_category: cat.id,
    aquaculture_cost_bucket: cat.default_cost_bucket || line.aquaculture_cost_bucket,
  }
  if (!next.item_id && cat.default_coa_account_id) {
    next.expense_account_id = cat.default_coa_account_id
    if (!next.description?.trim()) {
      next.description = cat.label
    }
  }
  return next
}

export function findBillCategory(
  cats: AquacultureBillExpenseCategory[],
  id: string | undefined
): AquacultureBillExpenseCategory | undefined {
  if (!id) return undefined
  return cats.find((c) => c.id === id)
}

/** COA codes 6711–6726 used for pond operating expenses on bills. */
export function isAquacultureOperatingCoaCode(code: string | undefined): boolean {
  const c = (code || '').trim()
  if (!/^67\d{2}$/.test(c)) return false
  const n = parseInt(c, 10)
  return n >= 6711 && n <= 6726
}
