/** Aquaculture income types on invoice lines. */

export interface AquacultureInvoiceIncomeCategory {
  id: string
  label: string
  tenant_defined?: boolean
  maps_to_code?: string | null
  non_biological_sale?: boolean
}

export interface InvoiceLineAquacultureFields {
  aquaculture_pond_id?: number | '' | null
  aquaculture_income_category?: string
  revenue_account_id?: number
  item_id?: number
  description?: string
}

export function invoiceAquacultureIncomeFromApi(
  rows: AquacultureInvoiceIncomeCategory[] | undefined
): AquacultureInvoiceIncomeCategory[] {
  return rows ?? []
}

export function findAquacultureInvoiceCategory(
  cats: AquacultureInvoiceIncomeCategory[],
  id: string | undefined
): AquacultureInvoiceIncomeCategory | undefined {
  if (!id) return undefined
  return cats.find((c) => c.id === id)
}

export function applyAquacultureIncomeToInvoiceLine<T extends InvoiceLineAquacultureFields>(
  line: T,
  cat: AquacultureInvoiceIncomeCategory | undefined
): T {
  if (!cat) {
    return { ...line, aquaculture_income_category: undefined }
  }
  return {
    ...line,
    aquaculture_income_category: cat.id,
    description: line.description?.trim() ? line.description : cat.label,
  }
}
