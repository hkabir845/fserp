'use client'

import { useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatQuantity } from '@/utils/quantity'

interface PreFormulationDetail {
  id: number
  code: string
  title: string
  category: string
  species: string
  stage: string
  process_type: string
  float_type?: string
  pellet_mm?: number
  default_batch_kg: number
  protein_target_min?: number
  protein_target_max?: number
  fat_target_min?: number
  fat_target_max?: number
  fiber_target_max?: number
  moisture_target_max?: number
  energy_target_min?: number
  notes?: string
  lines: Array<{
    id: number
    ingredient_item_id: number
    ingredient_name: string
    inclusion_value: number
    min_percent?: number
    max_percent?: number
    phase?: string
    is_process_aid: boolean
    sort_order: number
  }>
}

interface CalculateResult {
  ingredients: Array<{
    line_id: number
    ingredient_item_id: number
    ingredient_name: string
    percent: number
    required_kg: number
    required_g: number
    is_process_aid: boolean
    phase?: string
  }>
  totals: {
    total_percent: number
    total_kg: number
    target_output_kg: number
  }
  warnings: string[]
}

export default function PreFormulationDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = parseInt(params.id as string)

  const [outputQty, setOutputQty] = useState<string>('1')
  const [outputUom, setOutputUom] = useState<'kg' | 'ton'>('ton')
  const [showCopyModal, setShowCopyModal] = useState(false)
  const [bomCode, setBomCode] = useState<string>('')
  const [productName, setProductName] = useState<string>('')
  const [defaultBatchKg, setDefaultBatchKg] = useState<string>('')

  // Fetch pre-formulation details
  const { data: preform, isLoading } = useQuery<PreFormulationDetail>({
    queryKey: ['preformulation', id],
    queryFn: async () => {
      const response = await api.get(`/preformulations/${id}`)
      return response.data
    }
  })

  // Calculate requirements
  const { data: calculateResult, refetch: recalculate } = useQuery<CalculateResult>({
    queryKey: ['preform-calculate', id, outputQty, outputUom],
    queryFn: async () => {
      const response = await api.post(`/preformulations/${id}/calculate`, {
        output_qty: parseFloat(outputQty),
        output_uom: outputUom
      })
      return response.data
    },
    enabled: !!preform && !!outputQty && parseFloat(outputQty) > 0
  })

  // Copy to BOM mutation
  const copyToBomMutation = useMutation({
    mutationFn: async (data: {
      product_name?: string
      bom_code: string
      default_batch_kg?: number
      route_type?: string
      pellet_mm?: number
      float_type?: string
    }) => {
      const response = await api.post(`/preformulations/${id}/copy-to-bom`, data)
      return response.data
    },
    onSuccess: (data) => {
      router.push(`/manufacturing/feed-boms/${data.bom_id}`)
    }
  })

  const handleCalculate = () => {
    if (outputQty && parseFloat(outputQty) > 0) {
      recalculate()
    }
  }

  const handleCopyToBom = () => {
    if (!bomCode || !productName) {
      alert('Please enter BOM code and product name')
      return
    }

    copyToBomMutation.mutate({
      product_name: productName,
      bom_code: bomCode,
      default_batch_kg: defaultBatchKg ? parseFloat(defaultBatchKg) : undefined,
      route_type: preform?.process_type,
      pellet_mm: preform?.pellet_mm,
      float_type: preform?.float_type
    })
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="text-center text-muted-foreground">Loading...</div>
      </div>
    )
  }

  if (!preform) {
    return (
      <div className="p-6">
        <div className="text-center text-red-500">Pre-formulation not found</div>
      </div>
    )
  }

  // Calculate total percent (excluding process aids)
  const totalPercent = preform.lines
    .filter(line => !line.is_process_aid)
    .reduce((sum, line) => sum + line.inclusion_value, 0)

  return (
    <div className="p-6">
      <div className="mb-6">
        <button
          onClick={() => router.back()}
          className="text-primary hover:text-foreground/85 mb-4"
        >
          ← Back to Library
        </button>
        <h1 className="text-2xl font-bold text-foreground mb-2">{preform.title}</h1>
        <p className="text-muted-foreground">Code: {preform.code}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Header Card */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Template Details</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Category</label>
                <p className="text-foreground">{preform.category}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Species</label>
                <p className="text-foreground">{preform.species}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Stage</label>
                <p className="text-foreground">{preform.stage}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Process Type</label>
                <p className="text-foreground">{preform.process_type}</p>
              </div>
              {preform.pellet_mm && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Pellet Size</label>
                  <p className="text-foreground">{preform.pellet_mm} mm</p>
                </div>
              )}
              {preform.float_type && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Float Type</label>
                  <p className="text-foreground">{preform.float_type}</p>
                </div>
              )}
              {preform.protein_target_min && preform.protein_target_max && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Protein Target</label>
                  <p className="text-foreground">{preform.protein_target_min}-{preform.protein_target_max}%</p>
                </div>
              )}
            </div>
          </div>

          {/* Lines Table */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">Formulation Lines</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Ingredient</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Percent</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Phase</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-border">
                  {preform.lines.map((line) => (
                    <tr key={line.id} className={line.is_process_aid ? 'bg-muted/40' : ''}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                        {line.ingredient_name}
                        {line.is_process_aid && (
                          <span className="ml-2 text-xs text-muted-foreground">(Process Aid)</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                        {line.inclusion_value.toFixed(4)}%
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                        {line.phase || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/40">
                  <tr>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-foreground">
                      Total (excluding process aids)
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-foreground">
                      <span className={Math.abs(totalPercent - 100) > 0.01 ? 'text-destructive' : 'text-success'}>
                        {totalPercent.toFixed(4)}%
                      </span>
                    </td>
                    <td className="px-6 py-4"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        {/* Right Column - Calculate & Copy */}
        <div className="space-y-6">
          {/* Calculate Section */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Calculate Requirements</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground/85 mb-1">Target Output</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={outputQty}
                    onChange={(e) => setOutputQty(e.target.value)}
                    step="0.001"
                    min="0"
                    className="flex-1 px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <select
                    value={outputUom}
                    onChange={(e) => setOutputUom(e.target.value as 'kg' | 'ton')}
                    className="px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="ton">Ton</option>
                    <option value="kg">Kg</option>
                  </select>
                </div>
              </div>

              <button
                onClick={handleCalculate}
                className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring"
              >
                Calculate
              </button>
            </div>

            {/* Calculation Results */}
            {calculateResult && (
              <div className="mt-6 space-y-4">
                <h3 className="text-sm font-semibold text-foreground">Results</h3>
                
                {calculateResult.warnings.length > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
                    {calculateResult.warnings.map((warning, idx) => (
                      <p key={idx} className="text-sm text-yellow-800">{warning}</p>
                    ))}
                  </div>
                )}

                <div className="bg-muted/40 rounded-md p-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total Percent:</span>
                    <span className={`font-semibold ${Math.abs(calculateResult.totals.total_percent - 100) > 0.01 ? 'text-destructive' : 'text-success'}`}>
                      {calculateResult.totals.total_percent.toFixed(4)}%
                    </span>
                  </div>
                  <div className="flex justify-between text-sm mt-2">
                    <span className="text-muted-foreground">Total Weight:</span>
                    <span className="font-semibold text-foreground">
                      {formatQuantity(calculateResult.totals.total_kg)} kg
                    </span>
                  </div>
                </div>

                <div className="max-h-64 overflow-y-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-muted/40 sticky top-0">
                      <tr>
                        <th className="px-2 py-1 text-left text-xs font-medium text-muted-foreground">Ingredient</th>
                        <th className="px-2 py-1 text-right text-xs font-medium text-muted-foreground">%</th>
                        <th className="px-2 py-1 text-right text-xs font-medium text-muted-foreground">Kg</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {calculateResult.ingredients
                        .filter(ing => !ing.is_process_aid)
                        .map((ing) => (
                          <tr key={ing.line_id}>
                            <td className="px-2 py-1 text-foreground">{ing.ingredient_name}</td>
                            <td className="px-2 py-1 text-right text-muted-foreground">{ing.percent.toFixed(4)}%</td>
                            <td className="px-2 py-1 text-right text-foreground">{formatQuantity(ing.required_kg)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Copy to BOM Section */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Copy to Draft BOM</h2>
            <button
              onClick={() => setShowCopyModal(true)}
              className="w-full px-4 py-2 bg-success text-white rounded-md hover:bg-success/90 focus:outline-none focus:ring-2 focus:ring-success"
              disabled={Math.abs(totalPercent - 100) > 0.01}
            >
              Copy to Draft BOM
            </button>
            {Math.abs(totalPercent - 100) > 0.01 && (
              <p className="mt-2 text-xs text-destructive">
                Cannot copy: Total must be 100% ± 0.01%
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Copy to BOM Modal */}
      {showCopyModal && (
        <div className="erp-modal-backdrop">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold text-foreground mb-4">Copy to Draft BOM</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground/85 mb-1">Product Name *</label>
                <input
                  type="text"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="e.g., Tilapia Fry Feed"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground/85 mb-1">BOM Code *</label>
                <input
                  type="text"
                  value={bomCode}
                  onChange={(e) => setBomCode(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="e.g., BOM-2024-001"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground/85 mb-1">Default Batch Size (kg)</label>
                <input
                  type="number"
                  value={defaultBatchKg}
                  onChange={(e) => setDefaultBatchKg(e.target.value)}
                  step="0.001"
                  min="0"
                  className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder={preform.default_batch_kg.toString()}
                />
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setShowCopyModal(false)}
                className="flex-1 px-4 py-2 border border-border text-foreground/85 rounded-md hover:bg-muted/40"
              >
                Cancel
              </button>
              <button
                onClick={handleCopyToBom}
                disabled={!bomCode || !productName || copyToBomMutation.isPending}
                className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
              >
                {copyToBomMutation.isPending ? 'Creating...' : 'Create BOM'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}





