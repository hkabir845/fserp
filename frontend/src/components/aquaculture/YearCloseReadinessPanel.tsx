'use client'

import Link from 'next/link'
import { ArrowRight, ExternalLink, Package, Info } from 'lucide-react'

export type YearCloseReadinessAction = {
  id: string
  kind: 'link' | 'return_warehouse' | 'info'
  label: string
  detail?: string
  href?: string
}

type Props = {
  pondId: number
  pondName?: string
  isReady?: boolean
  blockers?: string[]
  actions?: YearCloseReadinessAction[]
  openProductionCycleCount?: number
  leaseContinuesNote?: string
  settlementFishCount?: number | null
  settlementWeightKg?: string | null
  settlementBioassetValue?: string | null
  compact?: boolean
  returningWarehouse?: boolean
  onReturnWarehouse?: (pondId: number) => void
}

function actionTone(kind: YearCloseReadinessAction['kind']): string {
  if (kind === 'info') return 'border-border bg-muted/40 text-foreground'
  if (kind === 'return_warehouse') return 'border-amber-200 bg-amber-50 text-amber-950'
  return 'border-primary/20 bg-accent/40 text-foreground hover:bg-accent/70'
}

export function YearCloseReadinessPanel({
  pondId,
  pondName,
  isReady,
  blockers = [],
  actions = [],
  openProductionCycleCount,
  leaseContinuesNote,
  settlementFishCount,
  settlementWeightKg,
  settlementBioassetValue,
  compact = false,
  returningWarehouse = false,
  onReturnWarehouse,
}: Props) {
  const showPosition =
    settlementFishCount != null ||
    settlementBioassetValue != null ||
    (openProductionCycleCount != null && openProductionCycleCount > 0)

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {isReady === false && blockers.length > 0 ? (
        <div
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-destructive"
          role="alert"
        >
          <p className="text-sm font-medium">Not ready for year close</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs leading-relaxed">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : isReady ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          {pondName ? `${pondName} is` : 'Pond is'} empty and ready for renovation / next cycle.
        </p>
      ) : null}

      {actions.length > 0 && isReady === false ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Prepare for close
          </p>
          <ul className="space-y-2">
            {actions.map((action) => {
              if (action.kind === 'return_warehouse' && onReturnWarehouse) {
                return (
                  <li key={action.id}>
                    <button
                      type="button"
                      disabled={returningWarehouse}
                      onClick={() => onReturnWarehouse(pondId)}
                      className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2.5 text-left text-xs transition-colors disabled:opacity-60 ${actionTone(action.kind)}`}
                    >
                      <Package className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{action.label}</span>
                        {action.detail ? (
                          <span className="mt-0.5 block opacity-90">{action.detail}</span>
                        ) : null}
                      </span>
                      <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                    </button>
                  </li>
                )
              }
              if (action.href) {
                return (
                  <li key={action.id}>
                    <Link
                      href={action.href}
                      className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs transition-colors ${actionTone(action.kind)}`}
                    >
                      {action.kind === 'info' ? (
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      ) : (
                        <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{action.label}</span>
                        {action.detail ? (
                          <span className="mt-0.5 block opacity-90">{action.detail}</span>
                        ) : null}
                      </span>
                    </Link>
                  </li>
                )
              }
              return null
            })}
          </ul>
        </div>
      ) : null}

      {leaseContinuesNote && !compact ? (
        <p className="text-xs text-muted-foreground">{leaseContinuesNote}</p>
      ) : null}

      {showPosition && !compact ? (
        <p className="text-xs text-muted-foreground">
          Position at close:{' '}
          {settlementFishCount != null
            ? `${settlementFishCount.toLocaleString()} fish`
            : '—'}
          {settlementWeightKg != null
            ? ` · ${Number(settlementWeightKg).toLocaleString()} kg`
            : ''}
          {settlementBioassetValue != null
            ? ` · bio-asset ${Number(settlementBioassetValue).toLocaleString()}`
            : ''}
          {openProductionCycleCount != null && openProductionCycleCount > 0
            ? ` · ${openProductionCycleCount} open cycle(s) will end on close`
            : ''}
        </p>
      ) : null}
    </div>
  )
}
