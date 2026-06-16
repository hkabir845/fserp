'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { UOMModal, type PlatformUOM } from '../modals'

export default function PlatformSettingsUnitsPage() {
  const queryClient = useQueryClient()
  const [editingUOM, setEditingUOM] = useState<PlatformUOM | null>(null)
  const [showUOMModal, setShowUOMModal] = useState(false)

  const { data: uoms = [], isLoading } = useQuery<PlatformUOM[]>({
    queryKey: ['platform-uoms'],
    queryFn: async () => {
      const response = await api.get('/platform/uoms')
      return response.data
    },
  })

  const createWOMMutation = useMutation({
    mutationFn: async (data: Partial<PlatformUOM>) => {
      return api.post('/platform/uoms', data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-uoms'] })
      setShowUOMModal(false)
      setEditingUOM(null)
    },
  })

  const updateWOMMutation = useMutation({
    mutationFn: async ({ id, ...data }: Partial<PlatformUOM> & { id: number }) => {
      return api.put(`/platform/uoms/${id}`, data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-uoms'] })
      setEditingUOM(null)
    },
  })

  const handleSaveUOM = (uom: Partial<PlatformUOM>) => {
    if (editingUOM?.id) {
      updateWOMMutation.mutate({ ...uom, id: editingUOM.id })
    } else {
      createWOMMutation.mutate(uom)
    }
  }

  const uomsByCategory = uoms.reduce(
    (acc, uom) => {
      if (!acc[uom.category]) {
        acc[uom.category] = []
      }
      acc[uom.category].push(uom)
      return acc
    },
    {} as Record<string, PlatformUOM[]>
  )

  if (isLoading) {
    return <div className="text-sm text-gray-500">Loading units…</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Units of Measure</h2>
        <button
          type="button"
          onClick={() => {
            setEditingUOM({} as PlatformUOM)
            setShowUOMModal(true)
          }}
          className="flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Unit
        </button>
      </div>

      {Object.entries(uomsByCategory).map(([category, categoryUOMs]) => (
        <div key={category} className="rounded-lg bg-white shadow">
          <div className="border-b border-gray-200 px-6 py-4">
            <h3 className="text-lg font-semibold capitalize text-gray-900">
              {category.replace('_', ' ')}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Code
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Base Unit
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Conversion
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Example
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Status
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {categoryUOMs.map((uom) => {
                  let exampleText = '-'
                  if (uom.base_unit && uom.conversion_factor !== 1.0) {
                    if (uom.conversion_factor > 1) {
                      exampleText = `1 ${uom.code} = ${uom.conversion_factor} ${uom.base_unit}`
                    } else if (uom.conversion_factor < 1) {
                      const inverse = 1 / uom.conversion_factor
                      exampleText = `${inverse.toFixed(2)} ${uom.code} = 1 ${uom.base_unit}`
                    }
                  } else if (uom.conversion_factor === 1.0 && uom.base_unit) {
                    exampleText = `Base unit`
                  }

                  return (
                    <tr key={uom.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-6 py-4">
                        <span className="font-mono text-sm font-medium text-gray-900">{uom.code}</span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">{uom.name}</td>
                      <td className="whitespace-nowrap px-6 py-4 font-mono text-sm text-gray-500">
                        {uom.base_unit || 'N/A'}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">
                        {uom.conversion_factor !== 1.0
                          ? uom.conversion_factor.toFixed(6).replace(/\.?0+$/, '')
                          : '1.0'}
                      </td>
                      <td className="max-w-xs truncate px-6 py-4 text-sm text-gray-500" title={exampleText}>
                        {exampleText}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <span
                          className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold leading-5 ${
                            uom.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {uom.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-medium">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingUOM(uom)
                            setShowUOMModal(true)
                          }}
                          className="text-indigo-600 hover:text-indigo-900"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {showUOMModal && (
        <UOMModal
          uom={editingUOM}
          onClose={() => {
            setShowUOMModal(false)
            setEditingUOM(null)
          }}
          onSave={handleSaveUOM}
        />
      )}
    </div>
  )
}
