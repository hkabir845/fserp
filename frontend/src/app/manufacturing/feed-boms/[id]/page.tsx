'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'

interface FeedBom {
  id: number
  bom_code: string
  product_id: number
  version: string
  status: string
  default_batch_size_ton: number
  process_type: string
  pellet_size_mm?: number
  is_floating: boolean
  target_protein_pct?: number
  target_fat_pct?: number
  target_fiber_pct?: number
  target_moisture_pct?: number
  target_ash_pct?: number
  notes?: string
}

interface BomLine {
  id: number
  bom_id: number
  ingredient_id: number
  sequence: number
  inclusion_basis: string
  inclusion_value: number
  computed_kg?: number
  computed_percent?: number
  loss_factor_pct: number
  phase?: string
  min_percent?: number
  max_percent?: number
}

interface Ingredient {
  id: number
  item_id: number
  ingredient_type: string
  is_premix: boolean
}

interface BomTotals {
  total_percent: number
  total_kg: number
  premix_total_g: number
  premix_total_kg: number
  is_valid: boolean
  errors: string[]
}

export default function FeedBomDetailPage() {
  const params = useParams()
  const router = useRouter()
  const bomId = parseInt(params.id as string)
  const queryClient = useQueryClient()

  const [showAddLine, setShowAddLine] = useState(false)
  const [newLine, setNewLine] = useState({
    ingredient_id: 0,
    sequence: 0,
    inclusion_basis: 'percent',
    inclusion_value: 0,
    loss_factor_pct: 0,
    phase: '',
    min_percent: undefined as number | undefined,
    max_percent: undefined as number | undefined,
  })

  // Fetch BOM
  const { data: bom, isLoading: bomLoading } = useQuery<FeedBom>({
    queryKey: ['feed-bom', bomId],
    queryFn: async () => {
      const response = await api.get(`/feed/feed-boms/${bomId}`)
      return response.data
    },
    enabled: !!bomId,
  })

  // Fetch BOM lines
  const { data: lines, isLoading: linesLoading, refetch: refetchLines } = useQuery<BomLine[]>({
    queryKey: ['feed-bom-lines', bomId],
    queryFn: async () => {
      const response = await api.get(`/feed/feed-boms/${bomId}/lines`)
      return response.data
    },
    enabled: !!bomId,
  })

  // Fetch ingredients
  const { data: ingredients } = useQuery<Ingredient[]>({
    queryKey: ['ingredients'],
    queryFn: async () => {
      const response = await api.get('/feed/ingredients')
      return response.data
    },
  })

  // Compute totals
  const { data: totals, refetch: refetchTotals } = useQuery<BomTotals>({
    queryKey: ['feed-bom-totals', bomId],
    queryFn: async () => {
      const response = await api.post(`/feed/feed-boms/${bomId}/compute-totals`, null, {
        params: { batch_size_ton: bom?.default_batch_size_ton || 1.0 }
      })
      return response.data
    },
    enabled: !!bomId && !!bom,
  })

  // Add line mutation
  const addLineMutation = useMutation({
    mutationFn: async (lineData: any) => {
      return api.post(`/feed/feed-boms/${bomId}/lines`, lineData)
    },
    onSuccess: () => {
      refetchLines()
      refetchTotals()
      setShowAddLine(false)
      setNewLine({
        ingredient_id: 0,
        sequence: 0,
        inclusion_basis: 'percent',
        inclusion_value: 0,
        loss_factor_pct: 0,
        phase: '',
        min_percent: undefined,
        max_percent: undefined,
      })
    },
  })

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: async () => {
      return api.post(`/feed/feed-boms/${bomId}/approve`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed-bom', bomId] })
      queryClient.invalidateQueries({ queryKey: ['feed-boms'] })
    },
  })

  // Clone mutation
  const cloneMutation = useMutation({
    mutationFn: async (newVersion: string) => {
      return api.post(`/feed/feed-boms/${bomId}/clone`, null, {
        params: { new_version: newVersion }
      })
    },
    onSuccess: (data) => {
      router.push(`/manufacturing/feed-boms/${data.data.id}`)
    },
  })

  const handleAddLine = () => {
    if (!newLine.ingredient_id || newLine.inclusion_value <= 0) {
      alert('Please fill in ingredient and inclusion value')
      return
    }
    addLineMutation.mutate(newLine)
  }

  const handleApprove = () => {
    if (confirm('Approve this BOM? It will be locked from editing.')) {
      approveMutation.mutate()
    }
  }

  const handleClone = () => {
    const newVersion = prompt('Enter new version (e.g., 1.1, 2.0):')
    if (newVersion) {
      cloneMutation.mutate(newVersion)
    }
  }

  if (bomLoading || linesLoading) {
    return (
              <div className="bg-white rounded-lg shadow p-6 flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading BOM...</p>
          </div>
        </div>
    )
  }

  if (!bom) {
    return (
              <div className="bg-white rounded-lg shadow p-6">
          <p className="text-red-600">BOM not found</p>
        </div>
    )
  }

  return (
          <div className="space-y-6">
        {/* BOM Header */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h2 className="text-2xl font-bold">{bom.bom_code} v{bom.version}</h2>
              <p className="text-gray-600 mt-1">Process: {bom.process_type}</p>
            </div>
            <div className="flex gap-2">
              <span
                className={`px-3 py-1 text-sm font-semibold rounded-full ${
                  bom.status === 'approved'
                    ? 'bg-green-100 text-green-800'
                    : bom.status === 'draft'
                    ? 'bg-yellow-100 text-yellow-800'
                    : 'bg-gray-100 text-gray-800'
                }`}
              >
                {bom.status}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="text-sm text-gray-500">Batch Size</label>
              <p className="font-medium">{bom.default_batch_size_ton} ton</p>
            </div>
            {bom.pellet_size_mm && (
              <div>
                <label className="text-sm text-gray-500">Pellet Size</label>
                <p className="font-medium">{bom.pellet_size_mm} mm</p>
              </div>
            )}
            {bom.is_floating && (
              <div>
                <label className="text-sm text-gray-500">Type</label>
                <p className="font-medium">Floating</p>
              </div>
            )}
          </div>

          {bom.status === 'draft' && (
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleApprove}
                disabled={approveMutation.isPending}
                className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-50"
              >
                {approveMutation.isPending ? 'Approving...' : 'Approve BOM'}
              </button>
              <button
                onClick={handleClone}
                disabled={cloneMutation.isPending}
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                Clone Version
              </button>
            </div>
          )}
        </div>

        {/* Totals Sidebar */}
        {totals && (
          <div className="bg-blue-50 rounded-lg shadow p-6 border-l-4 border-blue-500">
            <h3 className="font-semibold mb-4">Formula Totals</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="text-sm text-gray-600">Total %</label>
                <p className={`text-2xl font-bold ${totals.is_valid ? 'text-green-600' : 'text-red-600'}`}>
                  {totals.total_percent.toFixed(4)}%
                </p>
              </div>
              <div>
                <label className="text-sm text-gray-600">Total kg</label>
                <p className="text-2xl font-bold text-gray-900">
                  {totals.total_kg.toFixed(3)} kg
                </p>
              </div>
              {totals.premix_total_g > 0 && (
                <>
                  <div>
                    <label className="text-sm text-gray-600">Premix (g/ton)</label>
                    <p className="text-2xl font-bold text-gray-900">
                      {totals.premix_total_g.toFixed(1)} g
                    </p>
                  </div>
                  <div>
                    <label className="text-sm text-gray-600">Premix (kg)</label>
                    <p className="text-2xl font-bold text-gray-900">
                      {totals.premix_total_kg.toFixed(3)} kg
                    </p>
                  </div>
                </>
              )}
            </div>
            {!totals.is_valid && (
              <div className="mt-4 p-3 bg-red-100 rounded">
                <p className="text-sm font-semibold text-red-800 mb-2">Validation Errors:</p>
                <ul className="list-disc list-inside text-sm text-red-700">
                  {totals.errors.map((error, idx) => (
                    <li key={idx}>{error}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* BOM Lines */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-4 py-5 sm:p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Ingredient Lines</h3>
              {bom.status === 'draft' && (
                <button
                  onClick={() => setShowAddLine(!showAddLine)}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700"
                >
                  {showAddLine ? 'Cancel' : '+ Add Line'}
                </button>
              )}
            </div>

            {/* Add Line Form */}
            {showAddLine && bom.status === 'draft' && (
              <div className="mb-6 p-4 bg-gray-50 rounded-lg border">
                <h4 className="font-semibold mb-3">Add Ingredient Line</h4>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Ingredient *
                    </label>
                    <select
                      value={newLine.ingredient_id}
                      onChange={(e) => setNewLine({ ...newLine, ingredient_id: parseInt(e.target.value) })}
                      className="w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
                      required
                    >
                      <option value="0">Select ingredient</option>
                      {ingredients?.map((ing) => (
                        <option key={ing.id} value={ing.id}>
                          {ing.id} - {ing.ingredient_type}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Basis *
                    </label>
                    <select
                      value={newLine.inclusion_basis}
                      onChange={(e) => setNewLine({ ...newLine, inclusion_basis: e.target.value })}
                      className="w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
                    >
                      <option value="percent">%</option>
                      <option value="kg_per_ton">kg/ton</option>
                      <option value="g_per_ton">g/ton</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Value *
                    </label>
                    <input
                      type="number"
                      step="0.0001"
                      value={newLine.inclusion_value}
                      onChange={(e) => setNewLine({ ...newLine, inclusion_value: parseFloat(e.target.value) || 0 })}
                      className="w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Loss Factor %
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={newLine.loss_factor_pct}
                      onChange={(e) => setNewLine({ ...newLine, loss_factor_pct: parseFloat(e.target.value) || 0 })}
                      className="w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
                    />
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={handleAddLine}
                    disabled={addLineMutation.isPending}
                    className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {addLineMutation.isPending ? 'Adding...' : 'Add Line'}
                  </button>
                  <button
                    onClick={() => setShowAddLine(false)}
                    className="bg-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-400"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Lines Table */}
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Seq</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ingredient</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Basis</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Value</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Computed %</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Computed kg</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Loss %</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phase</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {lines && lines.length > 0 ? (
                    lines.map((line) => (
                      <tr key={line.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 whitespace-nowrap text-sm">{line.sequence}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm font-medium">{line.ingredient_id}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm">
                          {line.inclusion_basis === 'percent' ? '%' : 
                           line.inclusion_basis === 'kg_per_ton' ? 'kg/ton' : 'g/ton'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm">{line.inclusion_value.toFixed(4)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm">
                          {line.computed_percent ? line.computed_percent.toFixed(4) + '%' : '-'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm">
                          {line.computed_kg ? line.computed_kg.toFixed(3) + ' kg' : '-'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm">{line.loss_factor_pct}%</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm">{line.phase || '-'}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="px-4 py-4 text-center text-sm text-gray-500">
                        No lines added yet. Add ingredients to build the formula.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
  )
}

