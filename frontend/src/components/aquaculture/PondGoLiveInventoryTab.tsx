'use client'

import Link from 'next/link'
import { Package } from 'lucide-react'
import { parseMoney } from './pondOpeningShared'
import type { PondOpeningSummary } from './pondOpeningShared'

type Props = {
  ponds: PondOpeningSummary[]
  sym: string
}

export function PondGoLiveInventoryTab({ ponds, sym }: Props) {
  return (
    <>
      <p className="mb-4 text-sm text-slate-700">
        <strong>Feed and medicine on hand</strong> at the pond warehouse as of cutover. Transfer from the shop station
        on{' '}
        <Link href="/aquaculture/stock" className="font-medium text-teal-800 underline">
          Aquaculture → Stock
        </Link>
        .
      </p>
      <div className="space-y-4">
        {ponds.map((p) => {
          const inv = p.go_live?.inventory
          return (
            <section key={p.pond_id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold text-slate-900">{p.pond_name}</h3>
                {inv && inv.total_lines > 0 ? (
                  <span className="text-xs text-slate-600">
                    ~{sym}
                    {parseMoney(inv.estimated_value).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    on hand
                  </span>
                ) : null}
              </div>
              {inv && inv.total_lines > 0 ? (
                <ul className="mt-3 divide-y divide-slate-100 text-sm">
                  {inv.items.map((it) => (
                    <li key={it.item_id} className="flex items-center gap-2 py-2">
                      <Package className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                      <span className="min-w-0 flex-1 font-medium text-slate-800">{it.item_name}</span>
                      <span className="shrink-0 tabular-nums text-slate-600">
                        {it.quantity} {it.unit}
                      </span>
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-600">
                        {it.pos_category}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-amber-800">
                  No pond warehouse stock yet. Use Stock → Add to pond to record feed and medicine on hand.
                </p>
              )}
              <p className="mt-3 text-[11px] text-slate-500">
                Feed lines: {inv?.feed_lines ?? 0} · Medicine lines: {inv?.medicine_lines ?? 0}
              </p>
            </section>
          )
        })}
      </div>
    </>
  )
}
