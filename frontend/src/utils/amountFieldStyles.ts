/**
 * Shared Tailwind classes for currency / amount fields so large values stay visible
 * and align consistently (tabular numerals, right-aligned).
 */

/** Read-only line amount (invoices, bills, etc.) */
export const AMOUNT_READ_ONLY_INPUT_CLASS =
  'erp-field min-w-0 bg-muted/40 text-right tabular-nums font-medium'

/** Primary payment amount (full width in grid) */
export const AMOUNT_EDITABLE_FULL_BLUE_CLASS =
  'erp-field min-w-[9rem] rounded-md text-right tabular-nums font-medium focus:ring-ring'

/** Primary payment amount — green focus (received payments) */
export const AMOUNT_EDITABLE_FULL_GREEN_CLASS =
  'erp-field min-w-[9rem] rounded-md text-right tabular-nums font-medium focus:ring-success'

/** Allocate column in payment tables */
export const AMOUNT_ALLOCATE_BLUE_CLASS =
  'erp-field min-w-[9rem] w-36 max-w-[14rem] px-2 py-1 text-right tabular-nums font-medium focus:ring-ring'

export const AMOUNT_ALLOCATE_GREEN_CLASS =
  'erp-field min-w-[9rem] w-36 max-w-[14rem] px-2 py-1 text-right tabular-nums font-medium focus:ring-success'

/** Journal entry line amount */
export const AMOUNT_JE_LINE_CLASS =
  'erp-field min-w-[9rem] w-full px-2 py-1 text-sm text-right tabular-nums font-medium focus:ring-ring'

/** Fund transfer (has leading currency symbol) */
export const AMOUNT_FUND_TRANSFER_INPUT_CLASS =
  'erp-field w-full min-w-[9rem] pl-8 pr-4 py-2 text-right tabular-nums font-medium focus:ring-ring'

/** Modal amount (slate border — e.g. edit payment) */
export const AMOUNT_SLATE_EDITABLE_CLASS =
  'erp-field min-w-[9rem] rounded-lg px-3 py-2 text-sm text-right tabular-nums font-medium'

/** Admin company / generic text amount */
export const AMOUNT_ADMIN_TEXT_CLASS =
  'erp-field w-full min-w-[9rem] rounded-lg text-right tabular-nums font-medium focus:ring-ring'

/** Subscription ledger invoice amount */
export const AMOUNT_SUBSCRIPTION_INPUT_CLASS =
  'erp-field w-full min-w-[9rem] rounded-lg text-right tabular-nums font-medium focus:ring-ring'
