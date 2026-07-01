'use client'

import { formatNumber } from '@/utils/currency'
import { X } from 'lucide-react'

export type BillEntityAllocationLine = {
  line_id?: number
  line_number?: number | null
  description?: string
  amount: string
  entity_scope_key?: string
}

export type BillEntityAllocationRow = {
  entity_scope_key: string
  entity_label: string
  amount: string
  line_count: number
  lines: BillEntityAllocationLine[]
  matches_list_filter?: boolean
}

export function BillEntityAllocationDrilldown({
  open,
  onClose,
  billNumber,
  billTotal,
  filteredAmount,
  filterLabel,
  allocations,
  currencySymbol,
}: {
  open: boolean
  onClose: () => void
  billNumber: string
  billTotal: number
  filteredAmount?: number | null
  filterLabel?: string
  allocations: BillEntityAllocationRow[]
  currencySymbol: string
}) {
  if (!open) return null

  const showFiltered = filteredAmount != null && filterLabel
  const multi = allocations.length > 1

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        role="dialog"
        aria-labelledby="bill-allocation-title"
      >
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 id="bill-allocation-title" className="text-lg font-semibold text-foreground">
              Bill {billNumber} — by site
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {showFiltered ? (
                <>
                  <strong className="font-medium text-foreground">
                    {currencySymbol}
                    {formatNumber(filteredAmount)}
                  </strong>{' '}
                  for {filterLabel}
                  {billTotal > filteredAmount + 0.005 ? (
                    <>
                      {' '}
                      · bill total {currencySymbol}
                      {formatNumber(billTotal)}
                    </>
                  ) : null}
                </>
              ) : multi ? (
                <>Split across {allocations.length} sites — verify Charge to tags.</>
              ) : (
                <>All lines on one site.</>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted/40"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {allocations.map((group) => (
            <div
              key={group.entity_scope_key}
              className={`rounded-lg border p-3 ${
                group.matches_list_filter
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border bg-muted/20'
              }`}
            >
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="font-medium text-foreground">{group.entity_label}</p>
                  {group.matches_list_filter ? (
                    <p className="text-xs text-primary">Matches current site filter</p>
                  ) : null}
                </div>
                <p className="text-sm font-semibold tabular-nums text-foreground">
                  {currencySymbol}
                  {formatNumber(group.amount)}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    ({group.line_count} line{group.line_count === 1 ? '' : 's'})
                  </span>
                </p>
              </div>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="pb-1 pr-2 font-medium">#</th>
                    <th className="pb-1 pr-2 font-medium">Description</th>
                    <th className="pb-1 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {group.lines.map((ln) => (
                    <tr key={ln.line_id ?? `${group.entity_scope_key}-${ln.line_number}`} className="border-t border-border/60">
                      <td className="py-1.5 pr-2 tabular-nums text-muted-foreground">
                        {ln.line_number ?? '—'}
                      </td>
                      <td className="py-1.5 pr-2 text-foreground">{ln.description || '—'}</td>
                      <td className="py-1.5 text-right tabular-nums text-foreground">
                        {currencySymbol}
                        {formatNumber(ln.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        <div className="border-t border-border px-5 py-3 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm text-foreground/85 hover:bg-muted/40"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
