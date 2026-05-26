'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { Bot, CheckCircle2, ChevronRight, HelpCircle, XCircle, type LucideIcon } from 'lucide-react'
import { formatDateOnly } from '@/utils/date'
import {
  type AdviceStatusFilter,
  type FeedingAdviceRow,
  STATUS_TABS,
  feedingDoseParts,
  kgCellToSackCount,
  statusPill,
  workflowStepIndex,
  bwPercentFromRow,
  feedKgToSackLabel,
  primaryFeedKg,
  rowSackKg,
} from './feedingUtils'

export function AdviceRichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|_[^_]+_)/g)
  return (
    <span className="block whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**')) {
          return (
            <strong key={i} className="font-semibold text-slate-900">
              {p.slice(2, -2)}
            </strong>
          )
        }
        if (p.startsWith('_') && p.endsWith('_') && p.length > 2) {
          return (
            <em key={i} className="text-slate-600">
              {p.slice(1, -1)}
            </em>
          )
        }
        return <span key={i}>{p}</span>
      })}
    </span>
  )
}

export function PipelineStatCard(props: {
  title: string
  value: string | number
  sub: string
  icon: LucideIcon
  tone: 'amber' | 'sky' | 'emerald' | 'slate'
  onClick?: () => void
  active?: boolean
}) {
  const { title, value, sub, icon: Icon, tone, onClick, active } = props
  const ring =
    tone === 'amber'
      ? 'ring-amber-500/20'
      : tone === 'sky'
        ? 'ring-sky-500/20'
        : tone === 'emerald'
          ? 'ring-emerald-500/20'
          : 'ring-slate-200/80'
  const iconBg =
    tone === 'amber'
      ? 'bg-amber-50 text-amber-800'
      : tone === 'sky'
        ? 'bg-sky-50 text-sky-800'
        : tone === 'emerald'
          ? 'bg-emerald-50 text-emerald-800'
          : 'bg-slate-100 text-slate-700'
  const shared =
    'w-full rounded-2xl border border-slate-200/90 bg-white p-4 text-left shadow-sm ring-1 transition hover:shadow-md ' +
    ring +
    (active ? ' border-teal-300 ring-2 ring-teal-500/25' : '')
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={shared}>
        <StatInner title={title} value={value} sub={sub} Icon={Icon} iconBg={iconBg} />
      </button>
    )
  }
  return (
    <div className={shared}>
      <StatInner title={title} value={value} sub={sub} Icon={Icon} iconBg={iconBg} />
    </div>
  )
}

function StatInner(props: {
  title: string
  value: string | number
  sub: string
  Icon: LucideIcon
  iconBg: string
}) {
  const { title, value, sub, Icon, iconBg } = props
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
        <div className={`rounded-lg p-1.5 ${iconBg}`}>
          <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        </div>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">{sub}</p>
    </>
  )
}

export function WorkflowRail({ status }: { status: string }) {
  if (status === 'cancelled') {
    return (
      <div
        className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-100/80 px-3 py-2.5"
        aria-label="Advice cancelled"
      >
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-600 px-2.5 py-1 text-xs font-semibold text-white">
          <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Cancelled
        </span>
      </div>
    )
  }
  const idx = workflowStepIndex(status)
  const labels = ['Review & edit', 'Approve', 'Apply in field'] as const
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-100 bg-gradient-to-r from-slate-50 to-teal-50/40 px-3 py-2.5"
      role="list"
      aria-label="Advice workflow"
    >
      {labels.map((label, i) => {
        const done = idx > i
        const current = idx === i
        return (
          <div key={label} className="flex items-center gap-1.5" role="listitem">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                done
                  ? 'bg-emerald-100 text-emerald-900'
                  : current
                    ? 'bg-teal-600 text-white shadow-sm'
                    : 'bg-white text-slate-500 ring-1 ring-slate-200'
              }`}
            >
              {done ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
              {label}
            </span>
            {i < labels.length - 1 ? <ChevronRight className="h-3.5 w-3.5 text-slate-300" aria-hidden /> : null}
          </div>
        )
      })}
    </div>
  )
}

export function FeedingInsightHero({
  row,
  weatherLabel,
  mealsLabel,
  feedKgOverride,
}: {
  row: FeedingAdviceRow
  weatherLabel?: string | null
  mealsLabel?: string | null
  /** When set (e.g. apply-in-field kg), shown instead of suggested/applied on the hero. */
  feedKgOverride?: string | null
}) {
  const sackKg = rowSackKg(row)
  const override = feedKgOverride?.trim()
  const kg = override || primaryFeedKg(row)
  const pct = bwPercentFromRow(row)
  const sackLabel = kg ? feedKgToSackLabel(kg, sackKg) : null

  return (
    <div className="overflow-hidden rounded-2xl border border-teal-200/70 bg-gradient-to-br from-teal-600 via-teal-700 to-emerald-800 p-5 text-white shadow-lg">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
            <Bot className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-teal-100">AI daily plan</p>
            <p className="text-sm font-semibold text-white/95">
              {row.pond_name} · {formatDateOnly(row.target_date)}
            </p>
          </div>
        </div>
        <span className={`${statusPill(row.status)} !bg-white/20 !text-white ring-1 ring-white/30`}>
          {row.status_label}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-white/10 px-3 py-2.5 backdrop-blur-sm">
          <p className="text-[10px] font-medium uppercase tracking-wide text-teal-100">Feed today</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums">
            {kg ? `${kg} kg` : '—'}
          </p>
          {sackLabel ? <p className="mt-0.5 text-xs text-teal-100">{sackLabel}</p> : null}
        </div>
        <div className="rounded-xl bg-white/10 px-3 py-2.5 backdrop-blur-sm">
          <p className="text-[10px] font-medium uppercase tracking-wide text-teal-100">Rate</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums">{pct ? `${pct}%` : '—'}</p>
          <p className="mt-0.5 text-xs text-teal-100">body weight / day</p>
        </div>
        <div className="rounded-xl bg-white/10 px-3 py-2.5 backdrop-blur-sm">
          <p className="text-[10px] font-medium uppercase tracking-wide text-teal-100">Meals</p>
          <p className="mt-0.5 text-sm font-semibold leading-snug">{mealsLabel?.trim() || '—'}</p>
          {weatherLabel ? (
            <p className="mt-1 text-xs text-teal-100">{weatherLabel}</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function StatusFilterTabs(props: {
  filterStatus: AdviceStatusFilter
  statusTabCounts: Record<AdviceStatusFilter, number>
  onChange: (id: AdviceStatusFilter) => void
}) {
  const { filterStatus, statusTabCounts, onChange } = props
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter by status">
      {STATUS_TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={filterStatus === t.id}
          onClick={() => onChange(t.id)}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 ${
            filterStatus === t.id
              ? 'bg-teal-700 text-white shadow-sm'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          {t.label}
          <span className={`ml-1 tabular-nums ${filterStatus === t.id ? 'text-white/85' : 'text-slate-500'}`}>
            {statusTabCounts[t.id]}
          </span>
        </button>
      ))}
    </div>
  )
}

/** Multi-line dose block — every field visible, no ellipsis. */
export function DoseSummary({ row, compact }: { row: FeedingAdviceRow; compact?: boolean }) {
  const { kgLine, sackLine, rateLine, mealsLine } = feedingDoseParts(row)
  const hasAny = kgLine || sackLine || rateLine || mealsLine
  if (!hasAny) {
    return <p className="text-xs text-slate-500">No dose data — add sampling or regenerate.</p>
  }
  return (
    <div
      className={`space-y-1 rounded-lg border border-slate-200/80 bg-slate-50/90 ${
        compact ? 'px-2.5 py-2' : 'px-3 py-2.5'
      }`}
    >
      {kgLine ? (
        <p className={`font-semibold tabular-nums text-slate-900 ${compact ? 'text-sm' : 'text-base'}`}>
          {kgLine}
        </p>
      ) : null}
      {sackLine ? <p className="text-xs leading-snug text-slate-700">{sackLine}</p> : null}
      {rateLine ? <p className="text-xs leading-snug text-teal-900/90">{rateLine}</p> : null}
      {mealsLine ? <p className="text-xs leading-relaxed text-slate-600 break-words">{mealsLine}</p> : null}
    </div>
  )
}

/** Full-width plan card for the list panel (replaces cramped table rows). */
export function AdvicePlanCard(props: {
  row: FeedingAdviceRow
  selected: boolean
  onSelect: () => void
}) {
  const { row, selected, onSelect } = props
  const isToday = row.target_date === new Date().toISOString().slice(0, 10)
  const cycle = row.production_cycle_name?.trim()

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`group w-full rounded-xl border p-3.5 text-left shadow-sm transition outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 sm:p-4 ${
        selected
          ? 'border-teal-400 bg-gradient-to-br from-teal-50 to-white ring-2 ring-teal-500/25'
          : 'border-slate-200/90 bg-white hover:border-teal-200/80 hover:shadow-md'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium tabular-nums text-slate-800">
            {formatDateOnly(row.target_date)}
          </span>
          {isToday ? (
            <span className="rounded-full bg-teal-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              Today
            </span>
          ) : null}
        </div>
        <span className={statusPill(row.status)}>{row.status_label}</span>
      </div>

      <p className="mt-2.5 text-base font-semibold tracking-tight text-slate-900 break-words">{row.pond_name}</p>

      {cycle ? (
        <p className="mt-1 text-xs leading-relaxed text-slate-600 break-words">
          <span className="font-medium text-slate-500">Cycle · </span>
          {cycle}
        </p>
      ) : null}

      <div className="mt-3">
        <DoseSummary row={row} />
      </div>

      <p className="mt-2.5 text-[11px] font-medium text-teal-800 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
        Open full plan →
      </p>
    </button>
  )
}

export function FeedingDoseEditor(props: {
  kg: string
  sacks: string
  sackKg: number
  suggestedKg: string | null
  onKgChange: (v: string) => void
  onSacksChange: (v: string) => void
  onUseSuggested: () => void
  sackSelect: ReactNode
  hint?: string
  footer?: ReactNode
}) {
  const { kg, sacks, sackKg, suggestedKg, onKgChange, onSacksChange, onUseSuggested, sackSelect, hint, footer } =
    props
  const suggested = suggestedKg?.trim() ?? ''
  const showReset =
    suggested !== '' &&
    kg.trim() !== '' &&
    (Math.abs((Number.parseFloat(kg) || 0) - (Number.parseFloat(suggested) || 0)) >= 0.005 ||
      sacks.trim() !== '')

  return (
    <section className="rounded-xl border border-teal-200/80 bg-teal-50/40 p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-teal-950">Daily feed amount</h3>
      <p className="mt-1 text-xs leading-relaxed text-teal-900/90">
        {hint ??
          'Accept the AI suggested total or enter your own kg (or sacks). Per-meal amounts below keep the same split ratio.'}
      </p>
      <div className="mt-3">{sackSelect}</div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-slate-700">
          Total kg / day
          <input
            type="text"
            inputMode="decimal"
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            value={kg}
            onChange={(e) => onKgChange(e.target.value)}
          />
        </label>
        <label className="block text-xs font-medium text-slate-700">
          Sacks ({sackKg} kg/sack)
          <input
            type="text"
            inputMode="numeric"
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            value={sacks}
            onChange={(e) => onSacksChange(e.target.value)}
          />
        </label>
      </div>
      {suggested ? (
        <p className="mt-2 text-xs text-slate-600">
          AI suggested: <strong className="tabular-nums text-slate-900">{suggested} kg</strong>
          {feedKgToSackLabel(suggested, sackKg) ? ` (${feedKgToSackLabel(suggested, sackKg)})` : ''}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {showReset ? (
          <button
            type="button"
            onClick={onUseSuggested}
            className="rounded-lg border border-teal-300 bg-white px-3 py-1.5 text-xs font-medium text-teal-900 hover:bg-teal-50"
          >
            Use suggested dose
          </button>
        ) : null}
        {footer}
      </div>
    </section>
  )
}

export function MealPlanTable(props: {
  rows: { mealIndex: number; timePlain: string; kg: string }[]
  totalKg: string | null
  sackKg: number
  appliedKg?: string | null
}) {
  const { rows, totalKg, sackKg, appliedKg } = props
  if (rows.length === 0) return null
  return (
    <div className="overflow-x-auto rounded-xl border border-teal-200/80 bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
          <tr>
            <th className="px-3 py-2">#</th>
            <th className="px-3 py-2">Time</th>
            <th className="px-3 py-2 text-right">kg</th>
            <th className="px-3 py-2 text-right">Sacks</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.mealIndex} className="border-b border-slate-100">
              <td className="px-3 py-2 font-medium text-slate-900">{r.mealIndex}</td>
              <td className="px-3 py-2 text-xs leading-relaxed text-slate-700 break-words sm:text-sm">{r.timePlain}</td>
              <td className="px-3 py-2 text-right font-medium tabular-nums text-slate-900">{r.kg}</td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-800">
                {kgCellToSackCount(r.kg, sackKg)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-slate-200 bg-teal-50/50">
          <tr>
            <td colSpan={2} className="px-3 py-2 text-right text-xs font-semibold text-slate-700">
              Total
            </td>
            <td className="px-3 py-2 text-right text-sm font-bold tabular-nums text-teal-950">
              {totalKg != null ? `${totalKg} kg` : '—'}
            </td>
            <td className="px-3 py-2 text-right text-sm font-bold tabular-nums text-teal-950">
              {totalKg != null ? kgCellToSackCount(totalKg, sackKg) : '—'}
            </td>
          </tr>
          {appliedKg ? (
            <tr>
              <td colSpan={2} className="px-3 py-2 text-right text-xs font-medium text-slate-600">
                Applied
              </td>
              <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums text-emerald-800">
                {appliedKg} kg
              </td>
              <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums text-emerald-800">
                {kgCellToSackCount(String(appliedKg), sackKg)}
              </td>
            </tr>
          ) : null}
        </tfoot>
      </table>
    </div>
  )
}

export function PageTipsAside() {
  return (
    <aside className="rounded-2xl border border-slate-200/90 bg-slate-50/80 p-4 text-sm text-slate-700">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <HelpCircle className="h-3.5 w-3.5" aria-hidden />
        Quick tips
      </h3>
      <ul className="mt-2 space-y-2 text-xs leading-relaxed text-slate-600">
        <li>
          <Link href="/aquaculture/sampling" className="font-medium text-teal-800 underline">
            Biomass sampling
          </Link>{' '}
          improves kg/day accuracy.
        </li>
        <li>Optional water °C adjusts meal timing for hot or cold ponds.</li>
        <li>Sacks are for crews; kilograms stay in the system.</li>
      </ul>
      <details className="mt-3 rounded-lg border border-slate-200 bg-white/90 p-2.5 text-xs">
        <summary className="cursor-pointer font-semibold text-slate-800">WorldFish reference</summary>
        <p className="mt-2 leading-relaxed text-slate-600">
          Rations follow Nile tilapia grow-out tables (~28&nbsp;°C).{' '}
          <a
            href="https://digitalarchive.worldfishcenter.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-teal-800 underline"
          >
            WorldFish archive
          </a>
        </p>
      </details>
    </aside>
  )
}
