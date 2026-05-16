/** Shared helpers for vendor bill lines tagged with fuel-station reporting categories. */

export interface FuelStationBillExpenseCategory {
  id: string
  label: string
  tenant_defined?: boolean
  maps_to_code?: string | null
  tenant_reporting_category_id?: number | null
  bill_create_allowed?: boolean
}

export interface BillLineFuelStationFields {
  fuel_station_expense_category?: string
}

export function billFuelCategoriesFromApi(
  rows: FuelStationBillExpenseCategory[] | undefined
): FuelStationBillExpenseCategory[] {
  if (!rows?.length) return []
  const hasFlag = rows.some((c) => c.bill_create_allowed !== undefined)
  if (!hasFlag) return rows
  return rows.filter((c) => c.bill_create_allowed)
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
  cat: FuelStationBillExpenseCategory | undefined
): T {
  if (!cat) {
    return { ...line, fuel_station_expense_category: undefined }
  }
  return { ...line, fuel_station_expense_category: cat.id }
}
