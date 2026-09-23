'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Layers } from 'lucide-react'
import api from '@/lib/api'
import { formatNumber } from '@/utils/currency'
import { displayBiomassKg, type StockMetricsRow } from '@/app/aquaculture/aquacultureFishMetrics'

type BreakdownRow = StockMetricsRow & {
  fish_species?: string
  fish_species_label?: string
  production_cycle_id?: number | null
  production_cycle_name?: string
  current_fish_per_kg?: string | null
  latest_sample_avg_weight_kg?: string | null
  latest_sample_date?: string | null
}

type SpeciesAgg = {
  code: string
  label: string
  fish: number
  kg: number
  batches: number
  pcsPerKg: number | null
  sampleDate: string | null
}

const POLYCULTURE_MIX_HINT =
  'Classic BD polyculture often combines tilapia (main feed) with Indian major carps (rui / catla / mrigal) and a small Deshi share (puti / kalibaush). Feed demand is summed per species using WorldFish-style % body-weight tables (carp rates are lower than tilapia).'

const FEEDING_PROFILE_LABEL: Record<string, string> = {
  tilapia: 'Tilapia %BW table',
  carp: 'Carp / Deshi %BW table',
  pangas: 'Pangas %BW table',
}

function profileForSpecies(code: string): string {
  const c = (code || '').toLowerCase()
  if (c === 'tilapia' || c === 'not_applicable') return 'tilapia'
  if (c === 'pangas') return 'pangas'
  return 'carp'
}

function pcsPerKgFromRow(r: BreakdownRow): number | null {
  const direct = Number(r.current_fish_per_kg)
  if (Number.isFinite(direct) && direct > 0) return direct
  const avg = Number(r.latest_sample_avg_weight_kg)
  if (Number.isFinite(avg) && avg > 0) return 1 / avg
  return null
}

type Props = {
  pondId: number
  className?: string
}

/** Per-species live stock for polyculture ponds (from cycle × species breakdown). */
export function PolycultureSpeciesPanel({ pondId, className = '' }: Props) {
  const [rows, setRows] = useState<BreakdownRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const { data } = await api.get<{ breakdown_rows?: BreakdownRow[] }>(
          '/aquaculture/fish-stock-position/',
          { params: { pond_id: pondId, breakdown: '1' } },
        )
        if (cancelled) return
        setRows(Array.isArray(data?.breakdown_rows) ? data.breakdown_rows : [])
      } catch {
        if (!cancelled) {
          setRows([])
          setError('Could not load species breakdown')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pondId])

  const species = useMemo(() => {
    const map = new Map<string, SpeciesAgg>()
    for (const r of rows) {
      const code = (r.fish_species || 'tilapia').trim() || 'tilapia'
      const kg = displayBiomassKg(r)
      const fish = Math.max(0, Number(r.implied_net_fish_count) || 0)
      if (kg <= 0 && fish <= 0) continue
      const prev = map.get(code)
      const pcs = pcsPerKgFromRow(r)
      if (!prev) {
        map.set(code, {
          code,
          label: (r.fish_species_label || code).trim() || code,
          fish,
          kg,
          batches: 1,
          pcsPerKg: pcs,
          sampleDate: r.latest_sample_date || null,
        })
        continue
      }
      prev.fish += fish
      prev.kg += kg
      prev.batches += 1
      if (pcs != null && (prev.pcsPerKg == null || (r.latest_sample_date || '') > (prev.sampleDate || ''))) {
        prev.pcsPerKg = pcs
        prev.sampleDate = r.latest_sample_date || prev.sampleDate
      }
    }
    return [...map.values()].sort((a, b) => b.kg - a.kg || b.fish - a.fish)
  }, [rows])

  const totalKg = species.reduce((s, x) => s + x.kg, 0)

  if (loading) {
    return (
      <section className={`rounded-xl border border-border bg-white p-5 shadow-sm ${className}`}>
        <h2 className="text-sm font-semibold text-foreground">Polyculture by species</h2>
        <p className="mt-2 text-sm text-muted-foreground">Loading species mix…</p>
      </section>
    )
  }

  if (error) {
    return (
      <section className={`rounded-xl border border-border bg-white p-5 shadow-sm ${className}`}>
        <h2 className="text-sm font-semibold text-foreground">Polyculture by species</h2>
        <p className="mt-2 text-sm text-rose-700">{error}</p>
      </section>
    )
  }

  if (species.length === 0) {
    return null
  }

  const multi = species.length > 1

  return (
    <section className={`rounded-xl border border-border bg-white p-5 shadow-sm ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Layers className="h-4 w-4 text-muted-foreground" aria-hidden />
            {multi ? 'Polyculture by species' : 'Species stock'}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Live heads and biomass from cycle × species breakdown.{' '}
            <Link href="/aquaculture/stock" className="font-medium text-primary hover:underline">
              Full stock tools
            </Link>
          </p>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[28rem] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="pb-2 pr-3 font-medium">Species</th>
              <th className="pb-2 pr-3 font-medium tabular-nums">Fish</th>
              <th className="pb-2 pr-3 font-medium tabular-nums">Biomass</th>
              <th className="pb-2 pr-3 font-medium tabular-nums">Share</th>
              <th className="pb-2 pr-3 font-medium">Size</th>
              <th className="pb-2 font-medium">Feed table</th>
            </tr>
          </thead>
          <tbody>
            {species.map((s) => {
              const share = totalKg > 0 ? (100 * s.kg) / totalKg : 0
              const profile = profileForSpecies(s.code)
              return (
                <tr key={s.code} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-3">
                    <span className="font-medium text-foreground">{s.label}</span>
                    {s.batches > 1 ? (
                      <span className="ml-1 text-xs text-muted-foreground">({s.batches} batches)</span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-foreground">{formatNumber(s.fish, 0)}</td>
                  <td className="py-2 pr-3 tabular-nums text-foreground">{formatNumber(s.kg, 2)} kg</td>
                  <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                    {totalKg > 0 ? `${formatNumber(share, 0)}%` : '—'}
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                    {s.pcsPerKg != null ? `${formatNumber(s.pcsPerKg, 1)} pcs/kg` : '—'}
                  </td>
                  <td className="py-2 text-xs text-muted-foreground">
                    {FEEDING_PROFILE_LABEL[profile] || profile}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {multi ? (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{POLYCULTURE_MIX_HINT}</p>
      ) : null}
    </section>
  )
}
