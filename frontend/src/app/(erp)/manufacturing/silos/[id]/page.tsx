'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatQuantity } from '@/utils/quantity'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useState } from 'react'

interface Silo {
  id: number
  warehouse_id: number
  item_id: number
  name: string
  code: string | null
  capacity_kg: number | null
  current_qty_kg: number
  reorder_min_kg: number | null
  integration_source: string
  external_device_id: string | null
  is_active: boolean
}

interface Txn {
  id: number
  qty_delta: number
  ref_type: string
  ref_id: number | null
  notes: string | null
  created_at: string | null
}

export default function SiloDetailPage() {
  const params = useParams()
  const siloId = parseInt(params.id as string, 10)
  const queryClient = useQueryClient()
  const [fillKg, setFillKg] = useState('')
  const [adjKg, setAdjKg] = useState('')
  const [sensorKg, setSensorKg] = useState('')

  const { data: silo, isLoading } = useQuery<Silo>({
    queryKey: ['silo', siloId],
    queryFn: async () => {
      const r = await api.get(`/feed/silos/${siloId}`)
      return r.data
    },
    enabled: !!siloId,
  })

  const { data: txns = [] } = useQuery<Txn[]>({
    queryKey: ['silo-txns', siloId],
    queryFn: async () => {
      const r = await api.get(`/feed/silos/${siloId}/transactions`, { params: { limit: 40 } })
      return r.data
    },
    enabled: !!siloId,
  })

  const fillMut = useMutation({
    mutationFn: () => api.post(`/feed/silos/${siloId}/fill`, { qty_kg: Number(fillKg), notes: null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['silo', siloId] })
      queryClient.invalidateQueries({ queryKey: ['silo-txns', siloId] })
      queryClient.invalidateQueries({ queryKey: ['silos'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] })
      setFillKg('')
    },
  })

  const adjMut = useMutation({
    mutationFn: () => api.post(`/feed/silos/${siloId}/adjust`, { new_level_kg: Number(adjKg), notes: null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['silo', siloId] })
      queryClient.invalidateQueries({ queryKey: ['silo-txns', siloId] })
      queryClient.invalidateQueries({ queryKey: ['silos'] })
      setAdjKg('')
    },
  })

  const sensorMut = useMutation({
    mutationFn: () => api.post(`/feed/silos/${siloId}/sensor-read`, { level_kg: Number(sensorKg), notes: null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['silo', siloId] })
      queryClient.invalidateQueries({ queryKey: ['silo-txns', siloId] })
      queryClient.invalidateQueries({ queryKey: ['silos'] })
      setSensorKg('')
    },
  })

  if (isLoading || !silo) {
    return (
              <div className="bg-white rounded-lg border border-border p-6 min-h-[240px] flex items-center justify-center text-muted-foreground">
          Loading…
        </div>
    )
  }

  const pct =
    silo.capacity_kg && silo.capacity_kg > 0
      ? Math.min(100, (Number(silo.current_qty_kg) / Number(silo.capacity_kg)) * 100)
      : null

  return (
          <div className="max-w-4xl space-y-6">
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <Link href="/manufacturing/silos" className="text-primary hover:text-primary">
            ← Silos
          </Link>
        </div>

        <div className="bg-white rounded-lg border border-border p-6">
          <h1 className="text-2xl font-semibold text-foreground">{silo.name}</h1>
          {silo.code ? <p className="text-sm text-muted-foreground mt-1">Code: {silo.code}</p> : null}
          <dl className="mt-4 grid gap-2 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Current level</dt>
              <dd className="font-semibold tabular-nums text-lg text-foreground">
                {formatQuantity(silo.current_qty_kg)} kg
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Capacity</dt>
              <dd className="text-foreground">{silo.capacity_kg != null ? `${Number(silo.capacity_kg).toLocaleString()} kg` : '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Reorder alert</dt>
              <dd className="text-foreground">
                {silo.reorder_min_kg != null ? `${Number(silo.reorder_min_kg).toLocaleString()} kg` : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Integration</dt>
              <dd className="text-foreground">
                {silo.integration_source}
                {silo.external_device_id ? ` · ${silo.external_device_id}` : ''}
              </dd>
            </div>
          </dl>
          {pct != null ? (
            <div className="mt-4">
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-accent0 rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{pct.toFixed(1)}% of capacity</p>
            </div>
          ) : null}
        </div>

        <div className="bg-white rounded-lg border border-border p-6 space-y-6">
          <h2 className="text-lg font-medium text-foreground">Update level</h2>
          <div className="grid gap-6 sm:grid-cols-3">
            <div>
              <h3 className="text-sm font-medium text-foreground/85">Fill (receive)</h3>
              <p className="text-xs text-muted-foreground mb-2">Add kg after truck unload or transfer in.</p>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  step="0.001"
                  value={fillKg}
                  onChange={(e) => setFillKg(e.target.value)}
                  className="flex-1 rounded-md border border-border px-3 py-2 text-sm"
                  placeholder="kg"
                />
                <button
                  type="button"
                  disabled={fillMut.isPending || !fillKg}
                  onClick={() => fillMut.mutate()}
                  className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
                >
                  Fill
                </button>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-medium text-foreground/85">Set absolute level</h3>
              <p className="text-xs text-muted-foreground mb-2">Physical count or full calibration.</p>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  step="0.001"
                  value={adjKg}
                  onChange={(e) => setAdjKg(e.target.value)}
                  className="flex-1 rounded-md border border-border px-3 py-2 text-sm"
                  placeholder="kg"
                />
                <button
                  type="button"
                  disabled={adjMut.isPending || !adjKg}
                  onClick={() => adjMut.mutate()}
                  className="rounded-md border border-border bg-white px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted/40 disabled:opacity-50"
                >
                  Set
                </button>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-medium text-foreground/85">Sensor / PLC read</h3>
              <p className="text-xs text-muted-foreground mb-2">Post load-cell or PLC absolute kg (automation hook).</p>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  step="0.001"
                  value={sensorKg}
                  onChange={(e) => setSensorKg(e.target.value)}
                  className="flex-1 rounded-md border border-border px-3 py-2 text-sm"
                  placeholder="kg"
                />
                <button
                  type="button"
                  disabled={sensorMut.isPending || !sensorKg}
                  onClick={() => sensorMut.mutate()}
                  className="rounded-md border border-border bg-white px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted/40 disabled:opacity-50"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-border p-6">
          <h2 className="text-lg font-medium text-foreground mb-4">Recent movements</h2>
          <div className="overflow-x-auto border border-border/70 rounded-md">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Δ kg</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Ref</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {txns.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                      No transactions yet.
                    </td>
                  </tr>
                ) : (
                  txns.map((t) => (
                    <tr key={t.id}>
                      <td className="px-3 py-2 font-mono tabular-nums">{t.qty_delta}</td>
                      <td className="px-3 py-2 text-foreground/85">
                        {t.ref_type}
                        {t.ref_id != null ? ` #${t.ref_id}` : ''}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{t.created_at || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
  )
}
