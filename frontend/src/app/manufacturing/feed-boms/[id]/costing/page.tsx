'use client'

import { useQuery } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { api } from '@/lib/api'
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
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Calculating costs...</p>
          </div>
        </div>
    )
  }

  if (!costing) {
    return (
              <div className="bg-white rounded-lg shadow p-6">
          <p className="text-red-600">Costing data not available</p>
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
              <p className="text-gray-600 mt-1">
                {bom?.bom_code} v{bom?.version} - {bom?.default_batch_size_ton} ton batch
              </p>
            </div>
            <Link
              href={`/manufacturing/feed-boms/${bomId}`}
              className="text-indigo-600 hover:text-indigo-900"
            >
              ← Back to BOM
            </Link>
          </div>
        </div>

        {/* Cost Summary */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow p-6">
            <label className="text-sm text-gray-500">Total Cost</label>
            <p className="text-2xl font-bold text-gray-900 mt-1">
              ₹{costing.total_cost.toFixed(2)}
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <label className="text-sm text-gray-500">Cost per Ton</label>
            <p className="text-2xl font-bold text-gray-900 mt-1">
              ₹{costing.cost_per_ton.toFixed(2)}
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <label className="text-sm text-gray-500">Cost per kg</label>
            <p className="text-2xl font-bold text-gray-900 mt-1">
              ₹{costing.cost_per_kg.toFixed(4)}
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <label className="text-sm text-gray-500">Batch Size</label>
            <p className="text-2xl font-bold text-gray-900 mt-1">
              {bom?.default_batch_size_ton} ton
            </p>
          </div>
        </div>

        {/* Top Cost Drivers */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Top 5 Cost Drivers</h3>
          <div className="space-y-3">
            {topDrivers.map((ing, idx) => (
              <div key={ing.ingredient_id} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                <div className="flex items-center space-x-3">
                  <span className="text-lg font-bold text-gray-400">#{idx + 1}</span>
                  <div>
                    <p className="font-medium">{ing.ingredient_name}</p>
                    <p className="text-sm text-gray-500">
                      {ing.required_kg.toFixed(3)} kg @ ₹{ing.unit_price.toFixed(2)}/kg
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-lg">₹{ing.total_cost.toFixed(2)}</p>
                  <p className="text-sm text-gray-500">{ing.cost_percent.toFixed(1)}% of total</p>
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
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ingredient</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Required (kg)</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Unit Price</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total Cost</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">% of Total</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {costing.ingredients.map((ing) => (
                    <tr key={ing.ingredient_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium">{ing.ingredient_name}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">{ing.required_kg.toFixed(3)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">₹{ing.unit_price.toFixed(2)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium">₹{ing.total_cost.toFixed(2)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">{ing.cost_percent.toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50">
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

