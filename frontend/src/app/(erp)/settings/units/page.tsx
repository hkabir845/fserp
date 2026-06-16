'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface UOM {
  code: string
  name: string
  category: string
  base_unit?: string
  conversion_factor: number
  is_active: boolean
}

export default function SettingsUnitsPage() {
  const queryClient = useQueryClient()

  const { data: uoms = [], isLoading } = useQuery<UOM[]>({
    queryKey: ['tenant-uoms'],
    queryFn: async () => {
      const response = await api.get('/uoms')
      return response.data
    },
  })

  const toggleWOMMutation = useMutation({
    mutationFn: async (uomCode: string) => {
      return api.put(`/uoms/${uomCode}/toggle`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-uoms'] })
    },
  })

  const uomsByCategory = uoms.reduce(
    (acc, uom) => {
      if (!acc[uom.category]) {
        acc[uom.category] = []
      }
      acc[uom.category].push(uom)
      return acc
    },
    {} as Record<string, UOM[]>
  )

  if (isLoading) {
    return <div className="text-sm text-gray-500">Loading units…</div>
  }

  return (
    <div className="space-y-6">
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
                    <tr key={uom.code} className="hover:bg-gray-50">
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
                          onClick={() => toggleWOMMutation.mutate(uom.code)}
                          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                            uom.is_active
                              ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                              : 'bg-green-100 text-green-700 hover:bg-green-200'
                          }`}
                          title={uom.is_active ? 'Disable this unit' : 'Enable this unit'}
                        >
                          {uom.is_active ? 'Disable' : 'Enable'}
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
    </div>
  )
}
