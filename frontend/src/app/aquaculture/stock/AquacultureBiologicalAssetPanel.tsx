'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { BookOpen, ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { formatNumber, getCurrencySymbol } from '@/utils/currency'
import { formatDateOnly } from '@/utils/date'

interface Pond {
  id: number
  name: string
}

interface CycleRow {
  id: number
  name: string
}

interface BioAssetSummary {
  pond_id?: number
  production_cycle_id?: number | null
  as_of_date: string
  period_start: string
  period_end: string
  total_biological_asset_value: string
  direct_cost_accumulated: string
  transfer_cost_in: string
  transfer_cost_out: string
  harvest_bio_relief: string
  mortality_book_writeoff: string
  mortality_fish_count: number
  live_fish_count: number
  live_weight_kg: string
  avg_weight_per_fish_kg?: string | null
  cost_per_fish: string | null
  cost_per_kg: string | null
  gl_1581_balance: string
  cost_redistribution_note?: string | null
  gl_reconciliation_note?: string | null
  cost_buckets: { cost_bucket: string; label: string; amount: string }[]
}

interface BioAssetLedgerRow {
  entry_date: string
  entry_type: string
  entry_type_label: string
  source_doc: string
  source_id?: number
  fish_count_delta: number
  weight_kg_delta: string
  cost_amount?: string | null
  cost_note?: string
  implied_harvest_cost?: string
  fish_species_label?: string
  memo?: string
}

interface PortfolioPayload {
  as_of_date: string
  pond_count: number
  total_biological_asset_value: string
  total_live_fish_count: number
  ponds: {
    pond_id: number
    pond_name: string
    pond_role: string
    total_biological_asset_value: string
    live_fish_count: number
    live_weight_kg: string
    cost_per_fish: string | null
    cost_per_kg: string | null
    gl_1581_balance: string
  }[]
}

type Props = {
  ponds: Pond[]
  posPond: string
  posCycle: string
  posCycles: CycleRow[]
  currency: string
}

function parseNum(s: string | null | undefined): number {
  if (s == null || s === '') return 0
  const n = Number(String(s).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

export function AquacultureBiologicalAssetPanel({
  ponds,
  posPond,
  posCycle,
  posCycles,
  currency,
}: Props) {
  const toast = useToast()
  const sym = getCurrencySymbol(currency)
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState<BioAssetSummary | null>(null)
  const [portfolio, setPortfolio] = useState<PortfolioPayload | null>(null)
  const [ledgerRows, setLedgerRows] = useState<BioAssetLedgerRow[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (!posPond) {
        const { data } = await api.get<PortfolioPayload>('/aquaculture/biological-asset-summary/', {
          params: { as_of: asOf },
        })
        setPortfolio(data)
        setSummary(null)
        setLedgerRows([])
        return
      }
      const pondId = parseInt(posPond, 10)
      const params: Record<string, string> = { pond_id: String(pondId), as_of: asOf }
      if (posCycle) params.production_cycle_id = posCycle
      const [sumRes, ledRes] = await Promise.all([
        api.get<BioAssetSummary>('/aquaculture/biological-asset-summary/', { params }),
        api.get<{ summary: BioAssetSummary; rows: BioAssetLedgerRow[] }>(
          '/aquaculture/biological-asset-ledger/',
          { params: { ...params, limit: '300' } },
        ),
      ])
      setSummary(sumRes.data)
      setLedgerRows(Array.isArray(ledRes.data?.rows) ? ledRes.data.rows : [])
      setPortfolio(null)
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load biological asset data'))
      setSummary(null)
      setPortfolio(null)
      setLedgerRows([])
    } finally {
      setLoading(false)
    }
  }, [asOf, posCycle, posPond, toast])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-teal-200 bg-teal-50/30 p-4 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <BookOpen className="h-4 w-4 text-teal-700" aria-hidden />
              Biological asset ledger
            </h2>
            <p className="mt-1 max-w-3xl text-xs text-slate-600">
              Accumulated fry, feed, medicine, labour, and direct pond costs. Mortality reduces live fish count but
              retains cost on survivors. Transfers and harvest relief adjust pond value.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-medium text-slate-600">
              As of
              <input
                type="date"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
                className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
              Refresh
            </button>
          </div>
        </div>
        {!posPond ? (
          <p className="mt-3 text-xs text-amber-900">
            Select a pond above for the full ledger and batch scope. Showing all-pond snapshot below.
          </p>
        ) : posCycle ? (
          <p className="mt-3 text-xs text-slate-600">
            Scoped to batch{' '}
            <span className="font-medium">{posCycles.find((c) => String(c.id) === posCycle)?.name ?? posCycle}</span>
            . Shared costs and payroll are excluded in batch-only scope.
          </p>
        ) : null}
      </section>

      {loading ? (
        <p className="py-10 text-center text-sm text-slate-500">Loading biological asset data…</p>
      ) : portfolio ? (
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">All ponds — {formatDateOnly(portfolio.as_of_date)}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {portfolio.pond_count} ponds · {formatNumber(portfolio.total_live_fish_count, 0)} live fish ·{' '}
              {sym}
              {formatNumber(parseNum(portfolio.total_biological_asset_value), 2)} total biological asset value
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <th className="px-4 py-2">Pond</th>
                  <th className="px-4 py-2 text-right">Bio asset value</th>
                  <th className="px-4 py-2 text-right">Live fish</th>
                  <th className="px-4 py-2 text-right">Cost/fish</th>
                  <th className="px-4 py-2 text-right">Cost/kg</th>
                  <th className="px-4 py-2 text-right">GL 1581</th>
                </tr>
              </thead>
              <tbody>
                {portfolio.ponds.map((p) => (
                  <tr key={p.pond_id} className="border-b border-slate-100 hover:bg-slate-50/80">
                    <td className="px-4 py-2 font-medium">
                      <Link
                        href={`/aquaculture/stock/biological-asset?pond_id=${p.pond_id}`}
                        className="inline-flex items-center gap-1 text-teal-800 hover:underline"
                      >
                        {p.pond_name}
                        <ExternalLink className="h-3 w-3 opacity-60" aria-hidden />
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {sym}
                      {formatNumber(parseNum(p.total_biological_asset_value), 2)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatNumber(p.live_fish_count, 0)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {p.cost_per_fish ? `${sym}${formatNumber(parseNum(p.cost_per_fish), 2)}` : '—'}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {p.cost_per_kg ? `${sym}${formatNumber(parseNum(p.cost_per_kg), 2)}` : '—'}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                      {sym}
                      {formatNumber(parseNum(p.gl_1581_balance), 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : summary ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-teal-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-teal-800">Biological asset value</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">
                {sym}
                {formatNumber(parseNum(summary.total_biological_asset_value), 2)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Period {summary.period_start} → {summary.period_end}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cost per fish</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">
                {summary.cost_per_fish ? `${sym}${formatNumber(parseNum(summary.cost_per_fish), 2)}` : '—'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {formatNumber(summary.live_fish_count, 0)} live fish · {formatNumber(parseNum(summary.live_weight_kg), 2)} kg
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cost per kg</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">
                {summary.cost_per_kg ? `${sym}${formatNumber(parseNum(summary.cost_per_kg), 2)}` : '—'}
              </p>
              {summary.avg_weight_per_fish_kg ? (
                <p className="mt-1 text-xs text-slate-500">
                  Avg {formatNumber(parseNum(summary.avg_weight_per_fish_kg) * 1000, 1)} g/fish (implied)
                </p>
              ) : null}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">GL 1581 balance</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">
                {sym}
                {formatNumber(parseNum(summary.gl_1581_balance), 2)}
              </p>
              {summary.gl_reconciliation_note ? (
                <p className="mt-1 text-[11px] leading-snug text-slate-500">{summary.gl_reconciliation_note}</p>
              ) : null}
            </div>
          </div>

          {(summary.cost_redistribution_note || summary.mortality_fish_count > 0) && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
              {summary.cost_redistribution_note ||
                `${formatNumber(summary.mortality_fish_count, 0)} mortality in scope — accumulated cost retained on survivors.`}
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Cost accumulation</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <tbody>
                    {summary.cost_buckets.map((b) => (
                      <tr key={b.cost_bucket} className="border-b border-slate-50">
                        <td className="px-4 py-2 text-slate-700">{b.label}</td>
                        <td className="px-4 py-2 text-right tabular-nums font-medium text-slate-900">
                          {sym}
                          {formatNumber(parseNum(b.amount), 2)}
                        </td>
                      </tr>
                    ))}
                    {parseNum(summary.transfer_cost_out) > 0 ? (
                      <tr className="border-b border-slate-50 text-rose-800">
                        <td className="px-4 py-2">Inter-pond transfer out</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          −{sym}
                          {formatNumber(parseNum(summary.transfer_cost_out), 2)}
                        </td>
                      </tr>
                    ) : null}
                    {parseNum(summary.harvest_bio_relief) > 0 ? (
                      <tr className="border-b border-slate-50 text-rose-800">
                        <td className="px-4 py-2">Harvest bio relief</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          −{sym}
                          {formatNumber(parseNum(summary.harvest_bio_relief), 2)}
                        </td>
                      </tr>
                    ) : null}
                    <tr className="bg-slate-50 font-semibold">
                      <td className="px-4 py-2">Net biological asset value</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {sym}
                        {formatNumber(parseNum(summary.total_biological_asset_value), 2)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">
                Movement ledger
                <span className="ml-2 font-normal text-slate-500">({ledgerRows.length} rows)</span>
              </h3>
              <div className="max-h-[28rem] overflow-y-auto overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">Event</th>
                      <th className="px-3 py-2 text-right">Fish Δ</th>
                      <th className="px-3 py-2 text-right">Kg Δ</th>
                      <th className="px-3 py-2 text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerRows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                          No movements in this scope yet.
                        </td>
                      </tr>
                    ) : (
                      ledgerRows.map((r, i) => (
                        <tr key={`${r.entry_date}-${r.source_doc}-${i}`} className="border-b border-slate-50">
                          <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                            {formatDateOnly(r.entry_date)}
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-medium text-slate-800">{r.entry_type_label || r.entry_type}</div>
                            <div className="text-xs text-slate-500">{r.source_doc}</div>
                            {r.cost_note ? <div className="text-[11px] text-teal-800">{r.cost_note}</div> : null}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {r.fish_count_delta !== 0 ? formatNumber(r.fish_count_delta, 0) : '—'}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {parseNum(r.weight_kg_delta) !== 0
                              ? formatNumber(parseNum(r.weight_kg_delta), 2)
                              : '—'}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {r.cost_amount
                              ? `${sym}${formatNumber(parseNum(r.cost_amount), 2)}`
                              : r.implied_harvest_cost
                                ? `~${sym}${formatNumber(parseNum(r.implied_harvest_cost), 2)}`
                                : '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      ) : (
        <p className="text-sm text-slate-500">No biological asset data for this filter.</p>
      )}
    </div>
  )
}
