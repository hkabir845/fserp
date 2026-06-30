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
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
            <p className="text-muted-foreground">Loading livestock…</p>
          </div>
        </div>
    )
  }

  return (
          <div className="space-y-8">
        <ReportingHubBreadcrumb current="Livestock" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Livestock</h1>
          <p className="mt-1 text-muted-foreground">Species and herd / flock groups for your tenant.</p>
        </div>

        {(errSpecies || errHerds) && (
          <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {errMsg || 'Could not load livestock data. Ensure you are logged in and the backend is running.'}
          </div>
        )}

        <section className="bg-white rounded-lg shadow">
          <div className="px-4 py-5 sm:p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Species</h2>
            {species.length === 0 ? (
              <p className="text-muted-foreground text-sm">No species defined yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border">
                  <thead>
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Name</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Category</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {species.map((s) => (
                      <tr key={s.id}>
                        <td className="px-4 py-3 text-sm font-medium text-foreground">{s.name}</td>
                        <td className="px-4 py-3 text-sm text-foreground/85 capitalize">{s.category}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">{s.description || '—'}</td>
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
            <h2 className="text-lg font-semibold text-foreground mb-4">Herds &amp; flocks</h2>
            {herds.length === 0 ? (
              <p className="text-muted-foreground text-sm">No herds or flocks defined yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border">
                  <thead>
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Name</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Species</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Purpose</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Start</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground uppercase">Current qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {herds.map((h) => (
                      <tr key={h.id}>
                        <td className="px-4 py-3 text-sm font-medium text-foreground">{h.name}</td>
                        <td className="px-4 py-3 text-sm text-foreground/85">{h.species_name || `#${h.species_id}`}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground capitalize">{h.purpose}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {tryFormatDate(h.start_date)}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground text-right tabular-nums">
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
