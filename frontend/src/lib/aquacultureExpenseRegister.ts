/** Parse GET /aquaculture/expenses/ register payload (object or legacy array). */

export type AquacultureExpenseRegisterRow = {
  source?: 'expense' | 'bill'
  id: number
  bill_id?: number | null
  bill_number?: string
  bill_status?: string
  pond_id: number | null
  pond_name: string
  is_shared?: boolean
  pond_shares?: { pond_id: number; pond_name: string; amount: string }[]
  production_cycle_id?: number | null
  production_cycle_name?: string
  expense_category: string
  expense_category_label: string
  expense_date: string
  amount: string
  memo?: string
  vendor_name: string
  source_station_id?: number | null
  source_station_name?: string
  feed_sack_count?: string | null
  feed_weight_kg?: string | null
}

export function parseAquacultureExpenseRegister(data: unknown): {
  rows: AquacultureExpenseRegisterRow[]
  totalAmount: number
} {
  if (Array.isArray(data)) {
    const rows = data as AquacultureExpenseRegisterRow[]
    const totalAmount = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0)
    return { rows, totalAmount }
  }
  if (data && typeof data === 'object') {
    const o = data as { rows?: unknown; total_amount?: string | number }
    const rows = Array.isArray(o.rows) ? (o.rows as AquacultureExpenseRegisterRow[]) : []
    const totalAmount =
      o.total_amount != null && o.total_amount !== ''
        ? Number(o.total_amount)
        : rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0)
    return { rows, totalAmount: Number.isFinite(totalAmount) ? totalAmount : 0 }
  }
  return { rows: [], totalAmount: 0 }
}

export function aquacultureExpenseRegisterRowKey(r: AquacultureExpenseRegisterRow): string {
  return r.source === 'bill' ? `bill-${r.id}` : `expense-${r.id}`
}
