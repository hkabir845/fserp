'use client'

import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { format } from 'date-fns'

interface Species {
  id: number
  name: string
  category: string
  description?: string | null
}

interface Herd {
  id: number
  name: string
  species_id: number
  species_name?: string | null
  purpose: string
  start_date: string
  initial_qty: number
  current_qty: number
}

export default function LivestockPage() {
  const {
    data: species = [],
    isLoading: loadingSpecies,
    isError: errSpecies,
    error: speciesError,
  } = useQuery<Species[]>({
    queryKey: ['livestock-species'],
    queryFn: async () => {
      const res = await api.get('/livestock/species')
      return res.data
    },
    retry: false,
  })

  const {
    data: herds = [],
    isLoading: loadingHerds,
    isError: errHerds,
    error: herdsError,
  } = useQuery<Herd[]>({
    queryKey: ['livestock-herds'],
    queryFn: async () => {
      const res = await api.get('/livestock/herds')
      return res.data
    },
    retry: false,
  })

  const loading = loadingSpecies || loadingHerds
  const errMsg =
    apiDetail(speciesError) ||
    apiDetail(herdsError) ||
    (speciesError as Error)?.message ||
    (herdsError as Error)?.message

  if (loading) {
    return (
              <div className="bg-white rounded-lg shadow p-6 flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4" />
            <p className="text-gray-600">Loading livestock…</p>
          </div>
        </div>
    )
  }

  return (
          <div className="space-y-8">
        <ReportingHubBreadcrumb current="Livestock" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Livestock</h1>
          <p className="mt-1 text-gray-600">Species and herd / flock groups for your tenant.</p>
        </div>

        {(errSpecies || errHerds) && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {errMsg || 'Could not load livestock data. Ensure you are logged in and the backend is running.'}
          </div>
        )}

        <section className="bg-white rounded-lg shadow">
          <div className="px-4 py-5 sm:p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Species</h2>
            {species.length === 0 ? (
              <p className="text-gray-500 text-sm">No species defined yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead>
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {species.map((s) => (
                      <tr key={s.id}>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{s.name}</td>
                        <td className="px-4 py-3 text-sm text-gray-700 capitalize">{s.category}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{s.description || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <section className="bg-white rounded-lg shadow">
          <div className="px-4 py-5 sm:p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Herds &amp; flocks</h2>
            {herds.length === 0 ? (
              <p className="text-gray-500 text-sm">No herds or flocks defined yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead>
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Species</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Purpose</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Start</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Current qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {herds.map((h) => (
                      <tr key={h.id}>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{h.name}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{h.species_name || `#${h.species_id}`}</td>
                        <td className="px-4 py-3 text-sm text-gray-600 capitalize">{h.purpose}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {tryFormatDate(h.start_date)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900 text-right tabular-nums">
                          {h.current_qty.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
  )
}

function apiDetail(e: unknown) {
  const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof d === 'string' ? d : undefined
}

function tryFormatDate(iso: string) {
  try {
    return format(new Date(iso), 'yyyy-MM-dd')
  } catch {
    return iso
  }
}
