'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
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
              <div className="bg-white rounded-lg border border-gray-200 p-6 min-h-[240px] flex items-center justify-center text-gray-600">
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
        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
          <Link href="/manufacturing/silos" className="text-indigo-600 hover:text-indigo-800">
            ← Silos
          </Link>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h1 className="text-2xl font-semibold text-gray-900">{silo.name}</h1>
          {silo.code ? <p className="text-sm text-gray-500 mt-1">Code: {silo.code}</p> : null}
          <dl className="mt-4 grid gap-2 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-gray-500">Current level</dt>
              <dd className="font-semibold tabular-nums text-lg text-gray-900">
                {Number(silo.current_qty_kg).toLocaleString(undefined, { maximumFractionDigits: 3 })} kg
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Capacity</dt>
              <dd className="text-gray-900">{silo.capacity_kg != null ? `${Number(silo.capacity_kg).toLocaleString()} kg` : '—'}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Reorder alert</dt>
              <dd className="text-gray-900">
                {silo.reorder_min_kg != null ? `${Number(silo.reorder_min_kg).toLocaleString()} kg` : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Integration</dt>
              <dd className="text-gray-900">
                {silo.integration_source}
                {silo.external_device_id ? ` · ${silo.external_device_id}` : ''}
              </dd>
            </div>
          </dl>
          {pct != null ? (
            <div className="mt-4">
              <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1 text-xs text-gray-500">{pct.toFixed(1)}% of capacity</p>
            </div>
          ) : null}
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
          <h2 className="text-lg font-medium text-gray-900">Update level</h2>
          <div className="grid gap-6 sm:grid-cols-3">
            <div>
              <h3 className="text-sm font-medium text-gray-700">Fill (receive)</h3>
              <p className="text-xs text-gray-500 mb-2">Add kg after truck unload or transfer in.</p>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  step="0.001"
                  value={fillKg}
                  onChange={(e) => setFillKg(e.target.value)}
                  className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
                  placeholder="kg"
                />
                <button
                  type="button"
                  disabled={fillMut.isPending || !fillKg}
                  onClick={() => fillMut.mutate()}
                  className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  Fill
                </button>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-700">Set absolute level</h3>
              <p className="text-xs text-gray-500 mb-2">Physical count or full calibration.</p>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  step="0.001"
                  value={adjKg}
                  onChange={(e) => setAdjKg(e.target.value)}
                  className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
                  placeholder="kg"
                />
                <button
                  type="button"
                  disabled={adjMut.isPending || !adjKg}
                  onClick={() => adjMut.mutate()}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                >
                  Set
                </button>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-700">Sensor / PLC read</h3>
              <p className="text-xs text-gray-500 mb-2">Post load-cell or PLC absolute kg (automation hook).</p>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  step="0.001"
                  value={sensorKg}
                  onChange={(e) => setSensorKg(e.target.value)}
                  className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
                  placeholder="kg"
                />
                <button
                  type="button"
                  disabled={sensorMut.isPending || !sensorKg}
                  onClick={() => sensorMut.mutate()}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Recent movements</h2>
          <div className="overflow-x-auto border border-gray-100 rounded-md">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Δ kg</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Ref</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {txns.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-gray-500">
                      No transactions yet.
                    </td>
                  </tr>
                ) : (
                  txns.map((t) => (
                    <tr key={t.id}>
                      <td className="px-3 py-2 font-mono tabular-nums">{t.qty_delta}</td>
                      <td className="px-3 py-2 text-gray-700">
                        {t.ref_type}
                        {t.ref_id != null ? ` #${t.ref_id}` : ''}
                      </td>
                      <td className="px-3 py-2 text-gray-500">{t.created_at || '—'}</td>
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
