'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import PageLayout from '@/components/PageLayout'
import { ArrowLeft, ArrowDownToLine, ArrowUpFromLine, Loader2, ScrollText } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { formatNumber } from '@/utils/currency'
import { formatDateOnly, localDateISO } from '@/utils/date'

type LedgerRow = {
  date: string
  type: 'purchase' | 'sale' | 'adjustment' | string
  type_label: string
  reference: string
  counterparty: string
  memo: string
  qty_in: string | null
  qty_out: string | null
  balance: string
}

type LedgerPayload = {
  item_id: number
  item_name: string
  unit: string
  current_quantity_on_hand: string
  opening_balance: string
  period: { start_date: string | null; end_date: string | null }
  summary: {
    movement_count: number
    visible_count: number
    total_in: string
    total_out: string
    net: string
  }
  rows: LedgerRow[]
}

const TYPE_BADGE: Record<string, string> = {
  purchase: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  sale: 'bg-muted text-foreground/85 ring-border',
  adjustment: 'bg-warning/10 text-warning-foreground ring-amber-200',
}

function num(raw: string | null | undefined): number {
  if (raw == null) return 0
  const n = parseFloat(String(raw).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

// Quick date-range presets. `days` is the inclusive window length ending today.
const DATE_PRESETS: { key: string; label: string; days: number }[] = [
  { key: 'today', label: 'Today', days: 1 },
  { key: '3d', label: 'Last 3', days: 3 },
  { key: '7d', label: 'Last 7', days: 7 },
  { key: '15d', label: 'Last 15', days: 15 },
  { key: '30d', label: 'Last 30', days: 30 },
  { key: '90d', label: 'Last 90', days: 90 },
]

function presetRange(days: number): { start: string; end: string } {
  const today = new Date()
  const from = new Date()
  from.setDate(today.getDate() - (days - 1))
  return { start: localDateISO(from), end: localDateISO(today) }
}

export default function ItemStockLedgerPage() {
  const params = useParams<{ itemId: string }>()
  const itemId = params?.itemId
  const toast = useToast()

  const [data, setData] = useState<LedgerPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [activePreset, setActivePreset] = useState<string>('')

  const applyPreset = useCallback((preset: { key: string; days: number }) => {
    const { start: s, end: e } = presetRange(preset.days)
    setStart(s)
    setEnd(e)
    setActivePreset(preset.key)
  }, [])

  const clearDates = useCallback(() => {
    setStart('')
    setEnd('')
    setActivePreset('')
  }, [])

  const load = useCallback(async () => {
    if (!itemId) return
    setLoading(true)
    try {
      const query: Record<string, string> = {}
      if (start) query.start = start
      if (end) query.end = end
      const res = await api.get<LedgerPayload>(`/items/${itemId}/stock-ledger/`, { params: query })
      setData(res.data)
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load product ledger'))
    } finally {
      setLoading(false)
    }
  }, [itemId, start, end, toast])

  useEffect(() => {
    void load()
  }, [load])

  const unit = data?.unit || ''

  return (
    <PageLayout>
      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        <div className="mb-4 flex items-center gap-2 text-sm">
          <Link href="/items" className="inline-flex items-center gap-1 text-primary hover:underline">
            <ArrowLeft className="h-4 w-4" /> Back to products
          </Link>
        </div>

        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
              <ScrollText className="h-5 w-5 text-primary" />
              Stock ledger
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {data?.item_name || 'Product'} — chronological stock in / out with running balance.
            </p>
          </div>
          {data && (
            <div className="rounded-lg border border-primary/25 bg-accent/60 px-4 py-2 text-right">
              <div className="text-xs uppercase tracking-wide text-primary/80">On hand</div>
              <div className="text-lg font-semibold tabular-nums text-primary">
                {formatNumber(num(data.current_quantity_on_hand), 2)} {unit}
              </div>
            </div>
          )}
        </header>

        {data && (
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryCard label="Opening" value={`${formatNumber(num(data.opening_balance), 2)} ${unit}`} />
            <SummaryCard
              label="Total in"
              value={`${formatNumber(num(data.summary.total_in), 2)} ${unit}`}
              tone="emerald"
            />
            <SummaryCard
              label="Total out"
              value={`${formatNumber(num(data.summary.total_out), 2)} ${unit}`}
              tone="rose"
            />
            <SummaryCard label="Movements" value={String(data.summary.movement_count)} />
          </div>
        )}

        <div className="mb-3 rounded-lg border border-border bg-white p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {DATE_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => applyPreset(p)}
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  activePreset === p.key
                    ? 'border-teal-600 bg-primary text-white'
                    : 'border-border text-muted-foreground hover:bg-muted/40'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-xs font-medium text-muted-foreground">
              From
              <input
                type="date"
                value={start}
                onChange={(e) => {
                  setStart(e.target.value)
                  setActivePreset('')
                }}
                className="mt-1 rounded-md border border-border px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col text-xs font-medium text-muted-foreground">
              To
              <input
                type="date"
                value={end}
                onChange={(e) => {
                  setEnd(e.target.value)
                  setActivePreset('')
                }}
                className="mt-1 rounded-md border border-border px-2 py-1.5 text-sm"
              />
            </label>
            {(start || end) && (
              <button
                type="button"
                onClick={clearDates}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted/40"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border bg-white shadow-sm">
          {loading ? (
            <p className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading ledger…
            </p>
          ) : !data || data.rows.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No stock movements{start || end ? ' in this date range' : ' yet'} for this product.
            </p>
          ) : (
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Reference</th>
                  <th className="px-4 py-2.5">Party</th>
                  <th className="px-4 py-2.5 text-right">In</th>
                  <th className="px-4 py-2.5 text-right">Out</th>
                  <th className="px-4 py-2.5 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={`${r.type}-${r.reference}-${r.date}-${i}`} className="border-b border-border/70 hover:bg-muted/40/70">
                    <td className="whitespace-nowrap px-4 py-2 tabular-nums text-foreground/85">
                      {formatDateOnly(r.date)}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                          TYPE_BADGE[r.type] || 'bg-muted text-foreground/85 ring-border'
                        }`}
                      >
                        {r.type_label}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-foreground/85">{r.reference || '—'}</td>
                    <td className="px-4 py-2 text-muted-foreground">{r.counterparty || '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-emerald-700">
                      {r.qty_in ? (
                        <span className="inline-flex items-center gap-1">
                          <ArrowDownToLine className="h-3.5 w-3.5" />
                          {formatNumber(num(r.qty_in), 2)}
                        </span>
                      ) : (
                        ''
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-rose-600">
                      {r.qty_out ? (
                        <span className="inline-flex items-center gap-1">
                          <ArrowUpFromLine className="h-3.5 w-3.5" />
                          {formatNumber(num(r.qty_out), 2)}
                        </span>
                      ) : (
                        ''
                      )}
                    </td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums text-foreground">
                      {formatNumber(num(r.balance), 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          In = posted purchase bills. Out = finalized sales invoices. Adjustments = posted stock counts
          (gain or loss). The opening balance is derived so the running balance reconciles to current on hand.
        </p>
      </div>
    </PageLayout>
  )
}

function SummaryCard({
  label,
  value,
  tone = 'slate',
}: {
  label: string
  value: string
  tone?: 'slate' | 'emerald' | 'rose'
}) {
  const toneClass =
    tone === 'emerald'
      ? 'text-emerald-700'
      : tone === 'rose'
        ? 'text-rose-600'
        : 'text-foreground'
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-base font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  )
}
