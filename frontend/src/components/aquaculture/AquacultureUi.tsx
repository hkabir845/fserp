'use client'

import type { LucideIcon } from 'lucide-react'

export const AQ_HERO_LINK =
  'inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur hover:bg-white/20'

export const AQ_HERO_BTN_PRIMARY = 'erp-hero-btn-primary'

export const AQ_HERO_BTN_GHOST = 'erp-hero-btn-ghost'

/** Teal page-header filter dropdowns (pond, period, etc.). */
export const AQ_HERO_SELECT = 'erp-hero-select'
export const AQ_HERO_SELECT_BLOCK = 'erp-hero-select--block'
export const AQ_HERO_SELECT_SM = 'erp-hero-select erp-hero-select--sm'

/** Standard form selects on cards/modals. */
export const AQ_SELECT = 'erp-select'

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
          : 'ring-border/80'
  const iconBg =
    tone === 'amber'
      ? 'bg-warning/10 text-warning-foreground'
      : tone === 'sky'
        ? 'bg-sky-50 text-sky-800'
        : tone === 'emerald'
          ? 'bg-emerald-50 text-emerald-800'
          : 'bg-muted text-foreground/85'
  const shared =
    'erp-surface-interactive w-full p-4 text-left ring-1 transition ' +
    ring +
    (active ? ' border-primary/35 ring-2 ring-primary/20' : '')
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
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
        <div className={`rounded-lg p-1.5 ${iconBg}`}>
          <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        </div>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-foreground">{value}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{sub}</p>
    </>
  )
}
