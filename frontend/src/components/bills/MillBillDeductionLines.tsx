'use client'

import { formatNumber } from '@/utils/formatting'

export type MillDeductionLineRow = {
  key: string
  kind: 'gross' | 'discount' | 'transport' | 'driver' | 'net' | 'note'
  label: string
  detail?: string
  amount: number | null
}

/**
 * Visible settlement lines under bill Line Items: MRP → discount → transport → net.
 * Display-only (not separate GL bill lines); amounts match mill terms math.
 */
export function MillBillDeductionLines({
  currencySymbol,
  rows,
}: {
  currencySymbol: string
  rows: MillDeductionLineRow[]
}) {
  if (!rows.length) return null
  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/40 overflow-hidden">
      <div className="border-b border-amber-200/80 bg-amber-50 px-3 py-2">
        <p className="text-sm font-semibold text-foreground">How this bill is calculated</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Product lines above keep the net amount. These rows show MRP and each deduction.
        </p>
      </div>
      <div className="divide-y divide-amber-100/80 bg-white">
        {rows.map((row) => {
          if (row.kind === 'note') {
            return (
              <p key={row.key} className="px-3 py-2 text-[11px] text-amber-900/90 bg-amber-50/50">
                {row.label}
              </p>
            )
          }
          const isDeduction = row.kind === 'discount' || row.kind === 'transport'
          const isNet = row.kind === 'net'
          const isDriver = row.kind === 'driver'
          return (
            <div
              key={row.key}
              className={`flex items-start justify-between gap-3 px-3 py-2.5 ${
                isNet ? 'bg-muted/40' : ''
              }`}
            >
              <div className="min-w-0">
                <p
                  className={`text-sm ${
                    isNet ? 'font-semibold text-foreground' : 'font-medium text-foreground'
                  }`}
                >
                  {row.label}
                </p>
                {row.detail ? (
                  <p className="text-[11px] text-muted-foreground mt-0.5">{row.detail}</p>
                ) : null}
              </div>
              {row.amount != null ? (
                <p
                  className={`shrink-0 text-sm tabular-nums font-semibold ${
                    isDeduction
                      ? 'text-emerald-800'
                      : isDriver
                        ? 'text-muted-foreground'
                        : isNet
                          ? 'text-foreground'
                          : 'text-foreground'
                  }`}
                >
                  {isDeduction && row.amount > 0 ? '−' : ''}
                  {currencySymbol}
                  {formatNumber(Math.abs(row.amount))}
                </p>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
