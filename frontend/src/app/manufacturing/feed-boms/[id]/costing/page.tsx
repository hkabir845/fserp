'use client'

import { useQuery } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { api } from '@/lib/api'
import { formatQuantity } from '@/utils/quantity'
import Link from 'next/link'

interface BomCost {
  total_cost: number
  cost_per_ton: number
  cost_per_kg: number
  ingredients: Array<{
    ingredient_id: number
    ingredient_name: string
    required_kg: number
    unit_price: number
    total_cost: number
    cost_percent: number
  }>
}

export default function BomCostingPage() {
  const params = useParams()
  const bomId = parseInt(params.id as string)

  const { data: bom } = useQuery({
    queryKey: ['feed-bom', bomId],
    queryFn: async () => {
      const response = await api.get(`/feed/feed-boms/${bomId}`)
      return response.data
    },
  })

  const { data: costing, isLoading } = useQuery<BomCost>({
    queryKey: ['feed-bom-costing', bomId],
    queryFn: async () => {
      const response = await api.get(`/feed/feed-boms/${bomId}/costing`, {
        params: { batch_size_ton: bom?.default_batch_size_ton || 1.0 }
      })
      return response.data
    },
    enabled: !!bom,
  })

  if (isLoading) {
    return (
              <div className="bg-white rounded-lg shadow p-6 flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Calculating costs...</p>
          </div>
        </div>
    )
  }

  if (!costing) {
    return (
              <div className="bg-white rounded-lg shadow p-6">
          <p className="text-destructive">Costing data not available</p>
        </div>
    )
  }

  // Top 5 cost drivers
  const topDrivers = [...costing.ingredients]
    .sort((a, b) => b.total_cost - a.total_cost)
    .slice(0, 5)

  return (
          <div className="space-y-6">
        {/* Header */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-2xl font-bold">BOM Costing</h2>
              <p className="text-muted-foreground mt-1">
                {bom?.bom_code} v{bom?.version} - {bom?.default_batch_size_ton} ton batch
              </p>
            </div>
            <Link
              href={`/manufacturing/feed-boms/${bomId}`}
              className="text-primary hover:text-foreground/85"
            >
              ← Back to BOM
            </Link>
          </div>
        </div>

        {/* Cost Summary */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow p-6">
            <label className="text-sm text-muted-foreground">Total Cost</label>
            <p className="text-2xl font-bold text-foreground mt-1">
              ₹{costing.total_cost.toFixed(2)}
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <label className="text-sm text-muted-foreground">Cost per Ton</label>
            <p className="text-2xl font-bold text-foreground mt-1">
              ₹{costing.cost_per_ton.toFixed(2)}
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <label className="text-sm text-muted-foreground">Cost per kg</label>
            <p className="text-2xl font-bold text-foreground mt-1">
              ₹{costing.cost_per_kg.toFixed(4)}
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <label className="text-sm text-muted-foreground">Batch Size</label>
            <p className="text-2xl font-bold text-foreground mt-1">
              {bom?.default_batch_size_ton} ton
            </p>
          </div>
        </div>

        {/* Top Cost Drivers */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Top 5 Cost Drivers</h3>
          <div className="space-y-3">
            {topDrivers.map((ing, idx) => (
              <div key={ing.ingredient_id} className="flex items-center justify-between p-3 bg-muted/40 rounded">
                <div className="flex items-center space-x-3">
                  <span className="text-lg font-bold text-muted-foreground/70">#{idx + 1}</span>
                  <div>
                    <p className="font-medium">{ing.ingredient_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatQuantity(ing.required_kg)} kg @ ₹{ing.unit_price.toFixed(2)}/kg
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-lg">₹{ing.total_cost.toFixed(2)}</p>
                  <p className="text-sm text-muted-foreground">{ing.cost_percent.toFixed(1)}% of total</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Full Cost Breakdown */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg font-semibold mb-4">Complete Cost Breakdown</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Ingredient</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Required (kg)</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Unit Price</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Total Cost</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">% of Total</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-border">
                  {costing.ingredients.map((ing) => (
                    <tr key={ing.ingredient_id} className="hover:bg-muted/40">
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium">{ing.ingredient_name}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">{formatQuantity(ing.required_kg)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">₹{ing.unit_price.toFixed(2)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium">₹{ing.total_cost.toFixed(2)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">{ing.cost_percent.toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/40">
                  <tr>
                    <td colSpan={3} className="px-4 py-3 text-sm font-bold text-right">Total:</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-bold">₹{costing.total_cost.toFixed(2)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-bold">100.00%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      </div>
  )
}

