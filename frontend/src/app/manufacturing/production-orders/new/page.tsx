'use client'

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'

interface FeedBom {
  id: number
  bom_code: string
  version: string
  status: string
  default_batch_size_ton: number
  process_type: string
}

interface Warehouse {
  id: number
  name: string
}

export default function NewProductionOrderPage() {
  const router = useRouter()
  const [formData, setFormData] = useState({
    bom_id: 0,
    batch_size_ton: 1.0,
    warehouse_id: 0,
    planned_date: '',
    notes: ''
  })

  // Fetch approved BOMs
  const { data: boms } = useQuery<FeedBom[]>({
    queryKey: ['feed-boms-approved'],
    queryFn: async () => {
      const response = await api.get('/feed/feed-boms?status=approved')
      return response.data
    },
  })

  // Fetch warehouses
  const { data: warehouses } = useQuery<Warehouse[]>({
    queryKey: ['warehouses'],
    queryFn: async () => {
      const response = await api.get('/warehouses')
      return response.data
    },
  })

  // Create order mutation
  const createMutation = useMutation({
    mutationFn: async (orderData: any) => {
      return api.post('/feed/production-orders', orderData)
    },
    onSuccess: (data) => {
      router.push(`/manufacturing/production-orders/${data.data.id}`)
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.bom_id || !formData.warehouse_id) {
      alert('Please select BOM and warehouse')
      return
    }
    createMutation.mutate(formData)
  }

  const selectedBom = boms?.find(b => b.id === formData.bom_id)

  return (
          <div className="bg-white rounded-lg shadow p-6">
        <h2 className="mb-6 text-2xl font-bold text-foreground">Create Production Order</h2>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-foreground/85 mb-1">
                BOM * (Approved only)
              </label>
              <select
                value={formData.bom_id}
                onChange={(e) => {
                  const bomId = parseInt(e.target.value)
                  const bom = boms?.find(b => b.id === bomId)
                  setFormData({
                    ...formData,
                    bom_id: bomId,
                    batch_size_ton: bom?.default_batch_size_ton || 1.0
                  })
                }}
                className="w-full rounded-md border-border shadow-sm focus:border-ring focus:ring-ring sm:text-sm px-3 py-2 border"
                required
              >
                <option value="0">Select BOM</option>
                {boms?.map((bom) => (
                  <option key={bom.id} value={bom.id}>
                    {bom.bom_code} v{bom.version} - {bom.process_type}
                  </option>
                ))}
              </select>
              {selectedBom && (
                <p className="mt-1 text-sm text-muted-foreground">
                  Default batch: {selectedBom.default_batch_size_ton} ton
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground/85 mb-1">
                Batch Size (ton) *
              </label>
              <input
                type="number"
                step="0.001"
                value={formData.batch_size_ton}
                onChange={(e) => setFormData({ ...formData, batch_size_ton: parseFloat(e.target.value) || 0 })}
                className="w-full rounded-md border-border shadow-sm focus:border-ring focus:ring-ring sm:text-sm px-3 py-2 border"
                required
              />
              <p className="mt-1 text-sm text-muted-foreground">
                Output: {(formData.batch_size_ton * 1000).toFixed(2)} kg
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground/85 mb-1">
                Warehouse *
              </label>
              <select
                value={formData.warehouse_id}
                onChange={(e) => setFormData({ ...formData, warehouse_id: parseInt(e.target.value) })}
                className="w-full rounded-md border-border shadow-sm focus:border-ring focus:ring-ring sm:text-sm px-3 py-2 border"
                required
              >
                <option value="0">Select warehouse</option>
                {warehouses?.map((wh) => (
                  <option key={wh.id} value={wh.id}>
                    {wh.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground/85 mb-1">
                Planned Date
              </label>
              <input
                type="datetime-local"
                value={formData.planned_date}
                onChange={(e) => setFormData({ ...formData, planned_date: e.target.value })}
                className="w-full rounded-md border-border shadow-sm focus:border-ring focus:ring-ring sm:text-sm px-3 py-2 border"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground/85 mb-1">
              Notes
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="w-full rounded-md border-border shadow-sm focus:border-ring focus:ring-ring sm:text-sm px-3 py-2 border"
            />
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="bg-primary text-primary-foreground px-6 py-2 rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              {createMutation.isPending ? 'Creating...' : 'Create Order'}
            </button>
            <button
              type="button"
              onClick={() => router.back()}
              className="bg-muted text-foreground/85 px-6 py-2 rounded-md hover:bg-muted-foreground/50"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
  )
}

