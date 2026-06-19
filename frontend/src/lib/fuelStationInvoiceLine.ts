/** Fuel-station income reporting categories on invoice lines. */

export interface FuelStationInvoiceIncomeCategory {
  id: string
  label: string
  tenant_defined?: boolean
  maps_to_code?: string | null
  tenant_reporting_category_id?: number | null
  tagging_allowed?: boolean
  default_coa_account_code?: string
  default_coa_account_id?: number | null
  default_coa_account_name?: string
}

export interface InvoiceLineFuelStationFields {
  fuel_station_income_category?: string
  revenue_account_id?: number
  item_id?: number
  description?: string
}

export function invoiceFuelCategoriesFromApi(
  rows: FuelStationInvoiceIncomeCategory[] | undefined
): FuelStationInvoiceIncomeCategory[] {
  if (!rows?.length) return []
  return rows.filter((c) => c.tagging_allowed !== false)
}

export function findFuelInvoiceCategory(
  cats: FuelStationInvoiceIncomeCategory[],
  id: string | undefined
): FuelStationInvoiceIncomeCategory | undefined {
  if (!id) return undefined
  return cats.find((c) => c.id === id)
}

export function applyFuelCategoryToInvoiceLine<T extends InvoiceLineFuelStationFields>(
  line: T,
  cat: FuelStationInvoiceIncomeCategory | undefined
): T {
  if (!cat) {
    return { ...line, fuel_station_income_category: undefined }
  }
  const next: T = {
    ...line,
    fuel_station_income_category: cat.id,
  }
  if (!next.item_id && cat.default_coa_account_id) {
    next.revenue_account_id = cat.default_coa_account_id
    if (!next.description?.trim()) {
      next.description = cat.label
    }
  }
  return next
}
