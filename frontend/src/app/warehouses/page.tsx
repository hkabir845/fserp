'use client'

import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useState } from 'react'

interface Warehouse {
  id: number
  name: string
  address: string | null
  is_active: boolean
}

export default function WarehousesPage() {
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [formData, setFormData] = useState({ name: '', address: '' })

  const { data: warehouses, isLoading, refetch } = useQuery<Warehouse[]>({
    queryKey: ['warehouses'],
    queryFn: async () => {
      const response = await api.get('/warehouses')
      return response.data
    },
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api.post('/warehouses', formData)
      setShowCreateForm(false)
      setFormData({ name: '', address: '' })
      refetch()
    } catch (error) {
      console.error('Error creating warehouse:', error)
      alert('Failed to create warehouse')
    }
  }

  if (isLoading) {
    return (
              <div className="bg-white rounded-lg shadow p-6 flex flex-col items-center justify-center min-h-[400px] gap-4">
          <ReportingHubBreadcrumb current="Warehouses" />
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading warehouses...</p>
          </div>
        </div>
    )
  }

  return (
    <>
      <ReportingHubBreadcrumb current="Warehouses" className="mb-4 px-4 sm:px-6" />
      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold">Warehouses</h2>
                <button
                  onClick={() => setShowCreateForm(!showCreateForm)}
                  className="bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90"
                >
                  {showCreateForm ? 'Cancel' : '+ New Warehouse'}
                </button>
              </div>

              {showCreateForm && (
                <div className="mb-6 p-4 bg-muted/40 rounded-lg">
                  <h3 className="text-lg font-semibold mb-4">Create New Warehouse</h3>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                      <label htmlFor="name" className="block text-sm font-medium text-foreground/85">
                        Name *
                      </label>
                      <input
                        type="text"
                        id="name"
                        required
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="mt-1 block w-full rounded-md border-border shadow-sm focus:border-ring focus:ring-ring sm:text-sm px-3 py-2 border"
                        placeholder="Warehouse name"
                      />
                    </div>
                    <div>
                      <label htmlFor="address" className="block text-sm font-medium text-foreground/85">
                        Address
                      </label>
                      <textarea
                        id="address"
                        value={formData.address}
                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                        className="mt-1 block w-full rounded-md border-border shadow-sm focus:border-ring focus:ring-ring sm:text-sm px-3 py-2 border"
                        placeholder="Warehouse address"
                        rows={3}
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        className="bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90"
                      >
                        Create Warehouse
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowCreateForm(false)
                          setFormData({ name: '', address: '' })
                        }}
                        className="bg-muted text-foreground/85 px-4 py-2 rounded-md hover:bg-muted-foreground/50"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        ID
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Address
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-border">
                    {warehouses && warehouses.length > 0 ? (
                      warehouses.map((warehouse) => (
                        <tr key={warehouse.id}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-foreground">
                            {warehouse.id}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground font-medium">
                            {warehouse.name}
                          </td>
                          <td className="px-6 py-4 text-sm text-muted-foreground">
                            {warehouse.address || '-'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span
                              className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                warehouse.is_active
                                  ? 'bg-success/15 text-success'
                                  : 'bg-destructive/10 text-destructive'
                              }`}
                            >
                              {warehouse.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-6 py-4 text-center text-sm text-muted-foreground">
                          No warehouses found. Create one to get started.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
    </>
    )
  }


