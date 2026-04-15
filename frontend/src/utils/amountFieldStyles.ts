/**
 * Shared Tailwind classes for currency / amount fields so large values stay visible
 * and align consistently (tabular numerals, right-aligned).
 */

/** Read-only line amount (invoices, bills, etc.) */
export const AMOUNT_READ_ONLY_INPUT_CLASS =
  'w-full min-w-0 px-2 py-1 text-sm border border-gray-300 rounded bg-gray-50 text-right tabular-nums font-medium'

/** Flex row wrapper for a read-only Amount column */
export const AMOUNT_LINE_COL_CLASS = 'min-w-[9rem] w-[min(100%,11rem)] sm:w-44 shrink-0'

/** Primary payment amount (full width in grid) — blue focus */
export const AMOUNT_EDITABLE_FULL_BLUE_CLASS =
  'w-full min-w-[9rem] px-3 py-2 border border-gray-300 rounded-md text-right tabular-nums font-medium focus:outline-none focus:ring-2 focus:ring-blue-500'

/** Primary payment amount — green focus (received payments) */
export const AMOUNT_EDITABLE_FULL_GREEN_CLASS =
  'w-full min-w-[9rem] px-3 py-2 border border-gray-300 rounded-md text-right tabular-nums font-medium focus:outline-none focus:ring-2 focus:ring-green-500'

/** Allocate column in payment tables */
export const AMOUNT_ALLOCATE_BLUE_CLASS =
  'min-w-[9rem] w-36 max-w-[14rem] px-2 py-1 border border-gray-300 rounded text-right tabular-nums font-medium focus:outline-none focus:ring-2 focus:ring-blue-500'

export const AMOUNT_ALLOCATE_GREEN_CLASS =
  'min-w-[9rem] w-36 max-w-[14rem] px-2 py-1 border border-gray-300 rounded text-right tabular-nums font-medium focus:outline-none focus:ring-2 focus:ring-green-500'

/** Journal entry line amount */
export const AMOUNT_JE_LINE_CLASS =
  'min-w-[9rem] w-full px-2 py-1 text-sm border border-gray-300 rounded text-right tabular-nums font-medium focus:ring-2 focus:ring-blue-500'

/** Fund transfer (has leading currency symbol) */
export const AMOUNT_FUND_TRANSFER_INPUT_CLASS =
  'w-full min-w-[9rem] pl-8 pr-4 py-2 border border-gray-300 rounded-lg text-right tabular-nums font-medium focus:ring-2 focus:ring-blue-500 focus:border-transparent'

/** Modal amount (slate border — e.g. edit payment) */
export const AMOUNT_SLATE_EDITABLE_CLASS =
  'w-full min-w-[9rem] rounded-lg border border-slate-300 px-3 py-2 text-sm text-right tabular-nums font-medium'

/** Admin company / generic text amount */
export const AMOUNT_ADMIN_TEXT_CLASS =
  'w-full min-w-[9rem] px-3 py-2 border border-gray-300 rounded-lg text-right tabular-nums font-medium focus:ring-2 focus:ring-blue-500 focus:border-transparent'

/** Subscription ledger invoice amount */
export const AMOUNT_SUBSCRIPTION_INPUT_CLASS =
  'w-full min-w-[9rem] px-3 py-2 border border-gray-300 rounded-lg text-right tabular-nums font-medium focus:outline-none focus:ring-2 focus:ring-blue-500'
