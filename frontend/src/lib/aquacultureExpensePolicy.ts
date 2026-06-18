/**
 * UI policy for AquacultureExpense rows (all ponds).
 * Delete reverses stock/GL via DELETE /aquaculture/expenses/{id}/.
 */

export interface AquacultureExpenseRowLike {
  expense_category: string
  source_station_id?: number | null
  source?: 'expense' | 'bill'
}

export function aquacultureExpenseEditAllowed(row: AquacultureExpenseRowLike): boolean {
  if (row.source === 'bill') return false
  const cat = row.expense_category
  if (cat === 'feed_consumed' || cat === 'medicine_consumed') return false
  if (row.source_station_id != null) return false
  return true
}

export function aquacultureExpenseEditBlockedReason(row: AquacultureExpenseRowLike): string {
  if (row.source === 'bill') {
    return 'Vendor bill line — open the bill to view or edit.'
  }
  const cat = row.expense_category
  if (cat === 'feed_consumed' || cat === 'medicine_consumed') {
    return 'Recorded via pond warehouse consume — edit on Feeding / Medicine, or delete to reverse stock.'
  }
  if (row.source_station_id != null) {
    return 'Shop stock issue — delete and re-issue if needed; does not use pond warehouse.'
  }
  return 'This expense cannot be edited here.'
}

export function aquacultureExpenseDeleteConfirmMessage(row: AquacultureExpenseRowLike): string {
  if (row.source === 'bill') {
    return 'This row is on a vendor bill — delete or void the bill from Accounts payable instead.'
  }
  const cat = row.expense_category
  if (cat === 'feed_consumed') {
    return 'Delete this feed consumption? Pond warehouse stock will be restored, COGS journal reversed, and linked feeding advice reverted to Approved if applicable.'
  }
  if (cat === 'medicine_consumed') {
    return 'Delete this medicine consumption? Pond warehouse stock will be restored and the COGS journal reversed.'
  }
  if (row.source_station_id != null) {
    return 'Delete this shop stock issue? Station stock will be restored and the COGS journal reversed.'
  }
  return 'Delete this expense?'
}
