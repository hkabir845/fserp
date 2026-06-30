'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { formatQuantity } from '@/utils/quantity'

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
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading BOM...</p>
          </div>
        </div>
    )
  }

  if (!bom) {
    return (
              <div className="bg-white rounded-lg shadow p-6">
          <p className="text-destructive">BOM not found</p>
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
              <p className="text-muted-foreground mt-1">Process: {bom.process_type}</p>
            </div>
            <div className="flex gap-2">
              <span
                className={`px-3 py-1 text-sm font-semibold rounded-full ${
                  bom.status === 'approved'
                    ? 'bg-success/15 text-success'
                    : bom.status === 'draft'
                    ? 'bg-yellow-100 text-yellow-800'
                    : 'bg-muted text-foreground'
                }`}
              >
                {bom.status}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="text-sm text-muted-foreground">Batch Size</label>
              <p className="font-medium">{bom.default_batch_size_ton} ton</p>
            </div>
            {bom.pellet_size_mm && (
              <div>
                <label className="text-sm text-muted-foreground">Pellet Size</label>
                <p className="font-medium">{bom.pellet_size_mm} mm</p>
              </div>
            )}
            {bom.is_floating && (
              <div>
                <label className="text-sm text-muted-foreground">Type</label>
                <p className="font-medium">Floating</p>
              </div>
            )}
          </div>

          {bom.status === 'draft' && (
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleApprove}
                disabled={approveMutation.isPending}
                className="bg-success text-white px-4 py-2 rounded-md hover:bg-success/90 disabled:opacity-50"
              >
                {approveMutation.isPending ? 'Approving...' : 'Approve BOM'}
              </button>
              <button
                onClick={handleClone}
                disabled={cloneMutation.isPending}
                className="bg-primary text-white px-4 py-2 rounded-md hover:bg-primary disabled:opacity-50"
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
                <label className="text-sm text-muted-foreground">Total %</label>
                <p className={`text-2xl font-bold ${totals.is_valid ? 'text-success' : 'text-destructive'}`}>
                  {totals.total_percent.toFixed(4)}%
                </p>
              </div>
              <div>
                <label className="text-sm text-muted-foreground">Total kg</label>
                <p className="text-2xl font-bold text-foreground">
                  {formatQuantity(totals.total_kg)} kg
                </p>
              </div>
              {totals.premix_total_g > 0 && (
                <>
                  <div>
                    <label className="text-sm text-muted-foreground">Premix (g/ton)</label>
                    <p className="text-2xl font-bold text-foreground">
                      {totals.premix_total_g.toFixed(1)} g
                    </p>
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground">Premix (kg)</label>
                    <p className="text-2xl font-bold text-foreground">
                      {formatQuantity(totals.premix_total_kg)} kg
                    </p>
                  </div>
                </>
              )}
            </div>
            {!totals.is_valid && (
              <div className="mt-4 p-3 bg-destructive/10 rounded">
                <p className="text-sm font-semibold text-destructive mb-2">Validation Errors:</p>
                <ul className="list-disc list-inside text-sm text-destructive">
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
                  className="bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90"
                >
                  {showAddLine ? 'Cancel' : '+ Add Line'}
                </button>
              )}
            </div>

            {/* Add Line Form */}
            {showAddLine && bom.status === 'draft' && (
              <div className="mb-6 p-4 bg-muted/40 rounded-lg border">
                <h4 className="font-semibold mb-3">Add Ingredient Line</h4>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground/85 mb-1">
                      Ingredient *
                    </label>
                    <select
                      value={newLine.ingredient_id}
                      onChange={(e) => setNewLine({ ...newLine, ingredient_id: parseInt(e.target.value) })}
                      className="w-full rounded-md border-border shadow-sm focus:border-ring focus:ring-ring sm:text-sm px-3 py-2 border"
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
                    <label className="block text-sm font-medium text-foreground/85 mb-1">
                      Basis *
                    </label>
                    <select
                      value={newLine.inclusion_basis}
                      onChange={(e) => setNewLine({ ...newLine, inclusion_basis: e.target.value })}
                      className="w-full rounded-md border-border shadow-sm focus:border-ring focus:ring-ring sm:text-sm px-3 py-2 border"
                    >
                      <option value="percent">%</option>
                      <option value="kg_per_ton">kg/ton</option>
                      <option value="g_per_ton">g/ton</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground/85 mb-1">
                      Value *
                    </label>
                    <input
                      type="number"
                      step="0.0001"
                      value={newLine.inclusion_value}
                      onChange={(e) => setNewLine({ ...newLine, inclusion_value: parseFloat(e.target.value) || 0 })}
                      className="w-full rounded-md border-border shadow-sm focus:border-ring focus:ring-ring sm:text-sm px-3 py-2 border"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground/85 mb-1">
                      Loss Factor %
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={newLine.loss_factor_pct}
                      onChange={(e) => setNewLine({ ...newLine, loss_factor_pct: parseFloat(e.target.value) || 0 })}
                      className="w-full rounded-md border-border shadow-sm focus:border-ring focus:ring-ring sm:text-sm px-3 py-2 border"
                    />
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={handleAddLine}
                    disabled={addLineMutation.isPending}
                    className="bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 disabled:opacity-50"
                  >
                    {addLineMutation.isPending ? 'Adding...' : 'Add Line'}
                  </button>
                  <button
                    onClick={() => setShowAddLine(false)}
                    className="bg-muted text-foreground/85 px-4 py-2 rounded-md hover:bg-muted-foreground/50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Lines Table */}
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Seq</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Ingredient</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Basis</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Value</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Computed %</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Computed kg</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Loss %</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Phase</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-border">
                  {lines && lines.length > 0 ? (
                    lines.map((line) => (
                      <tr key={line.id} className="hover:bg-muted/40">
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
                          {line.computed_kg ? `${formatQuantity(line.computed_kg)} kg` : '-'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm">{line.loss_factor_pct}%</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm">{line.phase || '-'}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="px-4 py-4 text-center text-sm text-muted-foreground">
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

