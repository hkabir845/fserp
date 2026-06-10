'use client'

import { DrillAmount } from '@/components/reports/ReportDrillContext'
import { resolveDrillFromRow, type ReportDrillScope } from '@/components/reports/reportDrillResolver'
import { formatCurrency } from '@/utils/formatting'

type Props = {
  amount: number | string
  row?: Record<string, unknown> | null
  field?: string
  scope?: ReportDrillScope
  className?: string
  disabled?: boolean
  /** When true, always show plain text (e.g. zero totals). */
  plain?: boolean
  /** Optional currency code (e.g. BDT for aquaculture reports). */
  currency?: string
}

/** Report amount cell — clickable when drill source can be resolved from row metadata or IDs. */
export function ReportAmountCell({
  amount,
  row,
  field,
  scope = {},
  className = '',
  disabled = false,
  plain = false,
  currency,
}: Props) {
  const n = Number(amount ?? 0)
  const drill = plain || disabled ? null : resolveDrillFromRow(row ?? undefined, field, scope)
  const formatted = formatCurrency(n, currency)
  if (plain || disabled || (!drill && n === 0)) {
    return <span className={`tabular-nums ${className}`}>{formatted}</span>
  }
  return <DrillAmount amount={n} drill={drill} className={className} disabled={!drill} currency={currency} />
}
