'use client'

import { Calendar, ChevronRight, LayoutGrid } from 'lucide-react'
import { aquacultureT, aquacultureTFormat } from '@/lib/aquacultureI18n'
import { useT } from '@/lib/i18n'

type FleetSummary = {
  ready_ponds: number
  total_ponds: number
  ready_percent: number
  message?: string
}

type Props = {
  fleet: FleetSummary | null
  cutoverDate: string | null
  loading?: boolean
  onOpenSetup: () => void
}

export function PondGoLiveFleetBanner({ fleet, cutoverDate, loading, onOpenSetup }: Props) {
  const { lang } = useT()

  if (loading && !fleet) {
    return (
      <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="h-12 animate-pulse rounded-lg bg-slate-100" />
      </div>
    )
  }

  if (!fleet || fleet.total_ponds === 0) return null

  const pct = fleet.ready_percent ?? 0
  const allReady = pct >= 100 && fleet.ready_ponds >= fleet.total_ponds
  const needsWork = fleet.total_ponds - fleet.ready_ponds

  const statusMessage = allReady
    ? aquacultureT('goLiveAllCompleteMessage', lang)
    : needsWork === 1
      ? aquacultureT('goLiveNeedsWorkOne', lang)
      : aquacultureTFormat('goLiveNeedsWorkMany', lang, { count: needsWork })

  return (
    <div
      className={`mt-4 overflow-hidden rounded-xl border shadow-sm ${
        allReady
          ? 'border-emerald-200 bg-gradient-to-r from-emerald-50 via-white to-teal-50/40'
          : 'border-teal-200 bg-gradient-to-r from-teal-50 via-white to-amber-50/30'
      }`}
    >
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <LayoutGrid className={`h-4 w-4 shrink-0 ${allReady ? 'text-emerald-700' : 'text-teal-800'}`} aria-hidden />
            <p className="text-sm font-semibold text-slate-900">
              {allReady ? aquacultureT('goLiveAllPondsReady', lang) : aquacultureT('goLiveSetupInProgress', lang)}
            </p>
            {cutoverDate ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200/80">
                <Calendar className="h-3 w-3" aria-hidden />
                {aquacultureTFormat('goLiveCutoverBadge', lang, { date: cutoverDate })}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            {allReady ? statusMessage : aquacultureT('goLiveFleetMessage', lang)}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <p className="text-xs font-medium text-slate-700">
              <span className="tabular-nums text-base font-bold text-slate-900">{fleet.ready_ponds}</span>
              <span className="text-slate-500">
                / {fleet.total_ponds}
                {aquacultureT('goLivePondsReadySuffix', lang)}
              </span>
            </p>
            <div className="h-2 min-w-[8rem] max-w-xs flex-1 overflow-hidden rounded-full bg-slate-200/80">
              <div
                className={`h-full rounded-full transition-all ${allReady ? 'bg-emerald-500' : 'bg-teal-600'}`}
                style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={aquacultureT('goLiveFleetReadinessAria', lang)}
              />
            </div>
            <span className="text-xs font-semibold tabular-nums text-slate-800">{pct}%</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenSetup}
          className={`inline-flex shrink-0 items-center justify-center gap-1 rounded-lg px-3.5 py-2 text-sm font-medium shadow-sm ${
            allReady
              ? 'border border-emerald-300 bg-white text-emerald-900 hover:bg-emerald-50'
              : 'bg-teal-700 text-white hover:bg-teal-800'
          }`}
        >
          {allReady ? aquacultureT('goLiveReview', lang) : aquacultureT('goLiveContinueSetup', lang)}
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  )
}

export function PondGoLiveReadinessBadge({
  readinessPercent,
  ready,
}: {
  readinessPercent: number
  ready: boolean
}) {
  const { lang } = useT()

  if (ready) {
    return (
      <span className="inline-flex w-fit rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-900">
        {aquacultureT('goLiveReadyBadge', lang)}
      </span>
    )
  }
  return (
    <span className="inline-flex w-fit rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-amber-950">
      {aquacultureTFormat('goLivePercentBadge', lang, { percent: readinessPercent })}
    </span>
  )
}
