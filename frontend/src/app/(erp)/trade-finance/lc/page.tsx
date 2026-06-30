'use client'

import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDateOnly } from '@/utils/date'

type LCRow = {
  id: number
  lc_internal_number: string
  bank_lc_reference: string | null
  direction: string
  deal_type: string
  status: string
  applicant_name: string
  beneficiary_name: string
  currency_code: string
  amount: number
  expiry_date: string | null
  goods_category: string
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  bank_review: 'With bank',
  opened: 'Opened',
  advised: 'Advised',
  amended: 'Amended',
  docs_in_review: 'Docs in review',
  negotiated: 'Negotiated',
  settled: 'Settled',
  closed: 'Closed',
  cancelled: 'Cancelled',
}

function StatusBadge({ status }: { status: string }) {
  const base = 'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1'
  const map: Record<string, string> = {
    draft: 'bg-muted/40 text-foreground/85 ring-border',
    bank_review: 'bg-warning/10 text-warning-foreground ring-amber-200',
    opened: 'bg-sky-50 text-sky-800 ring-sky-200',
    advised: 'bg-accent text-primary ring-indigo-200',
    amended: 'bg-purple-50 text-purple-800 ring-purple-200',
    docs_in_review: 'bg-orange-50 text-orange-800 ring-orange-200',
    negotiated: 'bg-cyan-50 text-cyan-800 ring-cyan-200',
    settled: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    closed: 'bg-muted text-foreground/85 ring-gray-200',
    cancelled: 'bg-destructive/5 text-destructive ring-red-200',
  }
  const label = STATUS_LABEL[status] || status
  return <span className={`${base} ${map[status] || map.draft}`}>{label}</span>
}

export default function LetterOfCreditListPage() {
  const [direction, setDirection] = useState<string>('')
  const [status, setStatus] = useState<string>('')
  const [search, setSearch] = useState('')

  const { data: rows = [], isLoading, isError, error, refetch, isFetching } = useQuery<LCRow[]>({
    queryKey: ['lc-list', direction, status, search],
    queryFn: async () => {
      const params: Record<string, string> = {}
      if (direction) params.direction = direction
      if (status) params.status = status
      if (search.trim()) params.search = search.trim()
      const res = await api.get('/lc', { params })
      return res.data || []
    },
    retry: false,
    refetchOnWindowFocus: false,
  })

  const stats = useMemo(() => {
    const imp = rows.filter((r) => r.direction === 'import').length
    const exp = rows.filter((r) => r.direction === 'export').length
    const open = rows.filter((r) => !['closed', 'cancelled', 'settled'].includes(r.status)).length
    const totalUsdLike = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0)
    return { imp, exp, open, totalUsdLike }
  }, [rows])

  return (
          <div className="space-y-6 max-w-[1400px] mx-auto">
        <ReportingHubBreadcrumb current="Letters of credit" />
        <div className="rounded-xl border border-primary/15 bg-gradient-to-br from-accent/80 via-white to-slate-50 p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">Trade finance · Bangladesh AD banks</p>
              <h1 className="mt-1 text-2xl font-bold text-foreground tracking-tight">Letters of credit</h1>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                Track import LCs for feed ingredients, machinery and spare parts, and export LCs for finished feed and co-products. Capture IRC/ERC, BIN/TIN, bank lodgment
                references, and Bangladesh Bank reporting IDs as provided by your bank. Confirm live rules with your Authorized Dealer and current BB circulars.
              </p>
            </div>
            <Link
              href="/trade-finance/lc/new"
              className="inline-flex shrink-0 items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary/90"
            >
              + New LC
            </Link>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Import LCs', value: stats.imp },
              { label: 'Export LCs', value: stats.exp },
              { label: 'Active pipeline', value: stats.open },
              { label: 'Σ amounts (all ccy)', value: stats.totalUsdLike.toLocaleString(undefined, { maximumFractionDigits: 0 }) },
            ].map((x) => (
              <div key={x.label} className="rounded-lg border border-border/80 bg-white/80 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase text-muted-foreground">{x.label}</div>
                <div className="mt-1 text-xl font-bold tabular-nums text-foreground">{x.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs font-medium text-muted-foreground">Search</label>
              <input
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                placeholder="Reference, beneficiary, applicant…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="w-full sm:w-40">
              <label className="text-xs font-medium text-muted-foreground">Direction</label>
              <select className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm" value={direction} onChange={(e) => setDirection(e.target.value)}>
                <option value="">All</option>
                <option value="import">Import</option>
                <option value="export">Export</option>
              </select>
            </div>
            <div className="w-full sm:w-44">
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <select className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All</option>
                {Object.keys(STATUS_LABEL).map((k) => (
                  <option key={k} value={k}>
                    {STATUS_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => refetch()}
              className="rounded-md border border-border bg-white px-4 py-2 text-sm font-medium text-foreground/85 hover:bg-muted/40"
            >
              Apply
            </button>
          </div>

          {isError && (
            <div className="mt-4 rounded-md border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">
              {(error as Error)?.message || 'Could not load LCs'}
            </div>
          )}

          <div className="mt-4 overflow-x-auto rounded-lg border border-border/70">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Internal #</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Bank ref</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Dir</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Beneficiary</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-muted-foreground">Amount</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Expiry</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Category</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-muted-foreground" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70 bg-white">
                {isLoading || isFetching ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                      No letters of credit yet.{' '}
                      <Link href="/trade-finance/lc/new" className="font-medium text-primary hover:text-primary">
                        Register an LC
                      </Link>
                      .
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/40/80">
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-foreground">{r.lc_internal_number}</td>
                      <td className="px-4 py-3 text-foreground/85">{r.bank_lc_reference || '—'}</td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            r.direction === 'import'
                              ? 'rounded bg-blue-100 px-2 py-0.5 text-xs font-semibold text-primary'
                              : 'rounded bg-teal-100 px-2 py-0.5 text-xs font-semibold text-primary'
                          }
                        >
                          {r.direction}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-[220px] truncate text-foreground" title={r.beneficiary_name}>
                        {r.beneficiary_name}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-foreground">
                        {r.currency_code} {Number(r.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 text-foreground/85">
                        {r.expiry_date ? formatDateOnly(r.expiry_date) : '—'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{r.goods_category?.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/trade-finance/lc/${r.id}`}
                          className="inline-flex rounded-md border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground/85 hover:bg-muted/40"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          FMERP stores operational LC data for your treasury and compliance teams. It does not replace legal review, bank instructions, or filings under Bangladesh Bank Foreign Exchange
          Regulation Act guidelines — use this as your controlled register alongside bank originals.
        </p>
      </div>
  )
}
