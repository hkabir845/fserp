'use client'

import type { LucideIcon } from 'lucide-react'

export const AQ_HERO_LINK =
  'inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur hover:bg-white/20'

export const AQ_HERO_BTN_PRIMARY =
  'inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-teal-900 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50'

export const AQ_HERO_BTN_GHOST =
  'inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur hover:bg-white/20 disabled:opacity-50'

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
