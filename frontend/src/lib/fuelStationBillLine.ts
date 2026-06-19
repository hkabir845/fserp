/** Shared helpers for vendor bill lines tagged with fuel-station reporting categories. */

import { coaPickIdIfValid, type CoaPick } from '@/lib/coaDefaults'

export interface FuelStationBillExpenseCategory {
  id: string
  label: string
  tenant_defined?: boolean
  maps_to_code?: string | null
  tenant_reporting_category_id?: number | null
  bill_create_allowed?: boolean
  default_coa_account_code?: string
  default_coa_account_id?: number | null
  default_coa_account_name?: string
}

export interface BillLineFuelStationFields {
  fuel_station_expense_category?: string
  expense_account_id?: number
  item_id?: number
  description?: string
}

export function billFuelCategoriesFromApi(
  rows: FuelStationBillExpenseCategory[] | undefined
): FuelStationBillExpenseCategory[] {
  if (!rows?.length) return []
  const hasFlag = rows.some((c) => c.bill_create_allowed !== undefined)
  if (!hasFlag) return rows
  return rows.filter((c) => c.bill_create_allowed !== false)
}

export function findFuelBillCategory(
  cats: FuelStationBillExpenseCategory[],
  id: string | undefined
): FuelStationBillExpenseCategory | undefined {
  if (!id) return undefined
  return cats.find((c) => c.id === id)
}

export function applyFuelCategoryToBillLine<T extends BillLineFuelStationFields>(
  line: T,
  cat: FuelStationBillExpenseCategory | undefined,
  coaOptions: CoaPick[] = []
): T {
  if (!cat) {
    return { ...line, fuel_station_expense_category: undefined }
  }
  const next: T = {
    ...line,
    fuel_station_expense_category: cat.id,
  }
  if (!next.item_id) {
    const fromCat = coaPickIdIfValid(cat.default_coa_account_id, coaOptions)
    const fromLine = coaPickIdIfValid(next.expense_account_id, coaOptions)
    const resolved = fromCat ?? fromLine
    if (resolved) {
      next.expense_account_id = resolved
      if (!next.description?.trim()) {
        next.description = cat.label
      }
    } else if (fromLine === undefined && next.expense_account_id) {
      delete next.expense_account_id
    }
  }
  return next
}
