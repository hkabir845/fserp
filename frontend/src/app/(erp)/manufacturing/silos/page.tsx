'use client'

import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useState } from 'react'
import Link from 'next/link'

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

interface Warehouse {
  id: number
  name: string
}

interface ItemRow {
  id: number
  name: string
}

export default function SilosPage() {
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({
    warehouse_id: '',
    item_id: '',
    name: '',
    code: '',
    capacity_kg: '',
    current_qty_kg: '0',
    reorder_min_kg: '',
    integration_source: 'manual',
    external_device_id: '',
    notes: '',
  })

  const { data: silos = [], isLoading } = useQuery<Silo[]>({
    queryKey: ['silos'],
    queryFn: async () => {
      const r = await api.get('/feed/silos')
      return r.data
    },
  })

  const { data: warehouses = [] } = useQuery<Warehouse[]>({
    queryKey: ['warehouses'],
    queryFn: async () => {
      const r = await api.get('/warehouses')
      return r.data
    },
  })

  const { data: items = [] } = useQuery<ItemRow[]>({
    queryKey: ['items-silos'],
    queryFn: async () => {
      const r = await api.get('/items?limit=2000&include_inactive=false')
      return r.data
    },
  })

  const { data: reorder } = useQuery<{ count: number; silos: Silo[] }>({
    queryKey: ['silo-reorder-alerts'],
    queryFn: async () => {
      const r = await api.get('/feed/silos/reorder-alerts')
      return r.data
    },
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      return api.post('/feed/silos', {
        warehouse_id: Number(form.warehouse_id),
        item_id: Number(form.item_id),
        name: form.name.trim(),
        code: form.code.trim() || null,
        capacity_kg: form.capacity_kg ? Number(form.capacity_kg) : null,
        current_qty_kg: Number(form.current_qty_kg || 0),
        reorder_min_kg: form.reorder_min_kg ? Number(form.reorder_min_kg) : null,
        integration_source: form.integration_source,
        external_device_id: form.external_device_id.trim() || null,
        notes: form.notes.trim() || null,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['silos'] })
      queryClient.invalidateQueries({ queryKey: ['silo-reorder-alerts'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] })
      setShowCreate(false)
      setForm({
        warehouse_id: '',
        item_id: '',
        name: '',
        code: '',
        capacity_kg: '',
        current_qty_kg: '0',
        reorder_min_kg: '',
        integration_source: 'manual',
        external_device_id: '',
        notes: '',
      })
    },
  })

  const itemName = (id: number) => items.find((i) => i.id === id)?.name || `#${id}`
  const whName = (id: number) => warehouses.find((w) => w.id === id)?.name || `#${id}`

  if (isLoading) {
    return (
              <div className="bg-white rounded-lg border border-gray-200 p-6 min-h-[320px] flex items-center justify-center text-gray-600">
          Loading silos…
        </div>
    )
  }

  return (
          <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-4 py-5 sm:p-6">
          <ReportingHubBreadcrumb current="Silos" className="mb-4" />
          <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
            <div>
              <h2 className="text-2xl font-semibold text-gray-900">Silos</h2>
              <p className="mt-1 text-sm text-gray-600 max-w-2xl">
                Bulk ingredient storage (corn, meals, micros). Track levels, reorder points, and optional PLC / load-cell
                hooks. Consumption ties to production orders when a silo is assigned on a line.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreate(!showCreate)}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              {showCreate ? 'Cancel' : '+ New silo'}
            </button>
          </div>

          {reorder && reorder.count > 0 ? (
            <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span className="font-semibold">{reorder.count}</span> silo(s) at or below reorder minimum — review levels or
              schedule intake.
            </div>
          ) : null}

          {showCreate && (
            <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-4">
              <h3 className="text-lg font-medium text-gray-900">Register silo</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-gray-700">Warehouse *</span>
                  <select
                    required
                    value={form.warehouse_id}
                    onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="">Select…</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="text-gray-700">Item (bulk material) *</span>
                  <select
                    required
                    value={form.item_id}
                    onChange={(e) => setForm({ ...form, item_id: e.target.value })}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="">Select…</option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm sm:col-span-2">
                  <span className="text-gray-700">Name *</span>
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    placeholder="e.g. Corn silo A"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-gray-700">Code</span>
                  <input
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-gray-700">Capacity (kg)</span>
                  <input
                    type="number"
                    min={0}
                    step="0.001"
                    value={form.capacity_kg}
                    onChange={(e) => setForm({ ...form, capacity_kg: e.target.value })}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-gray-700">Current level (kg)</span>
                  <input
                    type="number"
                    min={0}
                    step="0.001"
                    value={form.current_qty_kg}
                    onChange={(e) => setForm({ ...form, current_qty_kg: e.target.value })}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-gray-700">Reorder alert below (kg)</span>
                  <input
                    type="number"
                    min={0}
                    step="0.001"
                    value={form.reorder_min_kg}
                    onChange={(e) => setForm({ ...form, reorder_min_kg: e.target.value })}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-gray-700">Integration</span>
                  <select
                    value={form.integration_source}
                    onChange={(e) => setForm({ ...form, integration_source: e.target.value })}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="manual">manual</option>
                    <option value="plc">plc</option>
                    <option value="sensor">sensor</option>
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="text-gray-700">External device / tag ID</span>
                  <input
                    value={form.external_device_id}
                    onChange={(e) => setForm({ ...form, external_device_id: e.target.value })}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    placeholder="PLC tag or API id"
                  />
                </label>
                <label className="block text-sm sm:col-span-2">
                  <span className="text-gray-700">Notes</span>
                  <textarea
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    rows={2}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
              </div>
              <button
                type="button"
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate()}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {createMutation.isPending ? 'Saving…' : 'Create silo'}
              </button>
              {createMutation.isError ? (
                <p className="text-sm text-red-700">Could not create silo. Check fields and try again.</p>
              ) : null}
            </div>
          )}

          <div className="overflow-x-auto border border-gray-200 rounded-md">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Warehouse</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Level (kg)</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Capacity</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Integration</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {silos.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">
                      No silos yet. Create one for each bulk storage bin tied to a warehouse and catalog item.
                    </td>
                  </tr>
                ) : (
                  silos.map((s) => (
                    <tr key={s.id} className={s.is_active ? '' : 'opacity-60'}>
                      <td className="px-4 py-2 text-sm font-medium text-gray-900">{s.name}</td>
                      <td className="px-4 py-2 text-sm text-gray-700">{whName(s.warehouse_id)}</td>
                      <td className="px-4 py-2 text-sm text-gray-700">{itemName(s.item_id)}</td>
                      <td className="px-4 py-2 text-sm text-right tabular-nums">
                        {Number(s.current_qty_kg).toLocaleString(undefined, { maximumFractionDigits: 3 })}
                      </td>
                      <td className="px-4 py-2 text-sm text-right tabular-nums text-gray-600">
                        {s.capacity_kg != null ? Number(s.capacity_kg).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-600">{s.integration_source}</td>
                      <td className="px-4 py-2 text-sm">
                        <Link
                          href={`/manufacturing/silos/${s.id}`}
                          className="font-medium text-indigo-600 hover:text-indigo-800"
                        >
                          Manage
                        </Link>
                      </td>
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
