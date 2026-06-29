/**
 * Shared transaction list filter params — search spans all dates (old + new).
 */

export function hasTransactionTextSearch(opts: {
  q?: string
  filterColumn?: string
  filterValue?: string
}): boolean {
  const qTrim = (opts.q ?? '').trim()
  if (qTrim) return true
  const col = (opts.filterColumn ?? 'all').trim()
  const val = (opts.filterValue ?? '').trim()
  return col !== 'all' && col !== '' && val.length > 0
}

/** Omit date range from API params while text search is active. */
export function transactionDateParams(
  startDate: string,
  endDate: string,
  hasTextSearch: boolean,
): { start_date?: string; end_date?: string } {
  if (hasTextSearch) return {}
  return {
    ...(startDate ? { start_date: startDate } : {}),
    ...(endDate ? { end_date: endDate } : {}),
  }
}

export function transactionAmountParams(
  minAmount: string,
  maxAmount: string,
): { min_amount?: string; max_amount?: string } {
  const min = minAmount.trim()
  const max = maxAmount.trim()
  return {
    ...(min ? { min_amount: min } : {}),
    ...(max ? { max_amount: max } : {}),
  }
}

/** True when any standard list filter is set (search, dates, amounts, or page-specific extras). */
export function hasActiveTransactionFilters(opts: {
  search?: string
  startDate?: string
  endDate?: string
  minAmount?: string
  maxAmount?: string
  extras?: boolean
}): boolean {
  return Boolean(
    opts.search?.trim() ||
      opts.startDate ||
      opts.endDate ||
      opts.minAmount?.trim() ||
      opts.maxAmount?.trim() ||
      opts.extras,
  )
}
