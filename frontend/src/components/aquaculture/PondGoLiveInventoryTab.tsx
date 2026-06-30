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
      <p className="mb-4 text-sm text-foreground/85">
        <strong>Feed and medicine on hand</strong> at the pond warehouse as of cutover. Transfer from the shop station
        on{' '}
        <Link href="/aquaculture/stock" className="font-medium text-primary underline">
          Aquaculture → Stock
        </Link>
        .
      </p>
      <div className="space-y-4">
        {ponds.map((p) => {
          const inv = p.go_live?.inventory
          return (
            <section key={p.pond_id} className="rounded-xl border border-border bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold text-foreground">{p.pond_name}</h3>
                {inv && inv.total_lines > 0 ? (
                  <span className="text-xs text-muted-foreground">
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
                <ul className="mt-3 divide-y divide-border/70 text-sm">
                  {inv.items.map((it) => (
                    <li key={it.item_id} className="flex items-center gap-2 py-2">
                      <Package className="h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden />
                      <span className="min-w-0 flex-1 font-medium text-foreground">{it.item_name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {it.quantity} {it.unit}
                      </span>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                        {it.pos_category}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-warning-foreground">
                  No pond warehouse stock yet. Use Stock → Add to pond to record feed and medicine on hand.
                </p>
              )}
              <p className="mt-3 text-[11px] text-muted-foreground">
                Feed lines: {inv?.feed_lines ?? 0} · Medicine lines: {inv?.medicine_lines ?? 0}
              </p>
            </section>
          )
        })}
      </div>
    </>
  )
}
