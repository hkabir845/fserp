'use client'

import {
  checkStatusLabel,
  checkStatusTone,
  formatSigned,
  parseMoney,
  signedByKind,
  signedTone,
  type GoLiveCheck,
  type PondOpeningSummary,
} from './pondOpeningShared'
import { aquacultureT } from '@/lib/aquacultureI18n'
import { useT } from '@/lib/i18n'

type Props = {
  ponds: PondOpeningSummary[]
  sym: string
  cutoverDate: string
  readyPonds: number
  totalPonds: number
  onGoToTab: (tab: string, pondId?: number) => void
}

function fmtMoney(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function CheckRow({ check, onGo }: { check: GoLiveCheck; onGo: () => void }) {
  const clickable = Boolean(check.tab || check.href)
  return (
    <button
      type="button"
      onClick={clickable ? onGo : undefined}
      disabled={!clickable}
      className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left text-xs ${
        checkStatusTone(check.status)
      } ${clickable ? 'cursor-pointer hover:opacity-90' : 'cursor-default'}`}
    >
      <span className="shrink-0 font-semibold uppercase tracking-wide">{checkStatusLabel(check.status)}</span>
      <span className="min-w-0 flex-1">
        <span className="font-medium">{check.label}</span>
        <span className="mt-0.5 block text-[11px] opacity-90">{check.detail}</span>
      </span>
    </button>
  )
}

export function PondGoLiveOverview({ ponds, sym, cutoverDate, readyPonds, totalPonds, onGoToTab }: Props) {
  const { lang } = useT()
  const pct = totalPonds > 0 ? Math.round((100 * readyPonds) / totalPonds) : 0

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-primary/25 bg-gradient-to-br from-teal-50 to-card p-4">
        <p className="text-sm font-semibold text-teal-950">
          {aquacultureT('goLiveCutoverDateLabel', lang)} {cutoverDate}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-foreground/85">
          {aquacultureT('goLiveOverviewMessage', lang)}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {aquacultureT('goLivePondsReadyLabel', lang)}
            </p>
            <p className="text-2xl font-bold tabular-nums text-primary">
              {readyPonds}
              <span className="text-base font-medium text-muted-foreground"> / {totalPonds}</span>
            </p>
          </div>
          <div className="h-10 w-px bg-teal-200" aria-hidden />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {aquacultureT('goLiveFleetReadinessLabel', lang)}
            </p>
            <p className="text-2xl font-bold tabular-nums text-foreground">{pct}%</p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {ponds.map((p) => {
          const gl = p.go_live
          const plNet = parseMoney(p.totals.net_pl_signed)
          const bsNet = parseMoney(p.totals.net_balance_sheet_signed)
          const bio = gl?.bioasset
          return (
            <section
              key={p.pond_id}
              className={`rounded-xl border bg-white p-4 shadow-sm ${
                gl?.ready ? 'border-emerald-200' : 'border-border'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 pb-3">
                <div>
                  <h3 className="font-semibold text-foreground">
                    {p.pond_name}
                    {p.pond_code ? (
                      <span className="ml-2 text-sm font-normal text-muted-foreground">{p.pond_code}</span>
                    ) : null}
                  </h3>
                  {gl?.ready ? (
                    <span className="mt-1 inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-900">
                      Ready for go-live
                    </span>
                  ) : (
                    <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-warning-foreground">
                      {gl?.readiness_percent ?? 0}% complete
                    </span>
                  )}
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-right text-xs sm:grid-cols-4">
                  <div>
                    <dt className="text-muted-foreground">P&amp;L net</dt>
                    <dd className={`font-semibold tabular-nums ${signedTone(plNet)}`}>{formatSigned(plNet, sym)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">A/R net</dt>
                    <dd className={`font-semibold tabular-nums ${signedTone(signedByKind(p, 'customer'))}`}>
                      {formatSigned(signedByKind(p, 'customer'), sym)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Biomass</dt>
                    <dd className="font-semibold tabular-nums text-foreground">
                      {gl?.biology?.has_biomass
                        ? `${gl.biology.total_weight_kg} kg`
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Bioasset est.</dt>
                    <dd className="font-semibold tabular-nums text-foreground">
                      {bio && parseMoney(bio.estimated_value) > 0
                        ? `${sym}${fmtMoney(parseMoney(bio.estimated_value))}`
                        : '—'}
                    </dd>
                  </div>
                </dl>
              </div>

              {gl?.checks?.length ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {gl.checks.map((c) => (
                    <CheckRow
                      key={c.id}
                      check={c}
                      onGo={() => {
                        if (c.href) {
                          window.location.href = c.href
                          return
                        }
                        if (c.tab) onGoToTab(c.tab, p.pond_id)
                      }}
                    />
                  ))}
                </div>
              ) : null}

              {gl?.lease?.has_contract ? (
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Lease remaining:{' '}
                  <strong className="text-foreground">
                    {gl.lease.balance_due != null ? `${sym}${fmtMoney(parseMoney(gl.lease.balance_due))}` : '—'}
                  </strong>
                  {' · '}
                  Prepaid: {sym}
                  {fmtMoney(parseMoney(gl.lease.paid_to_landlord))}
                </p>
              ) : null}
            </section>
          )
        })}
      </div>
    </div>
  )
}
