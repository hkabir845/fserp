'use client'

import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

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
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === 'approved'
      ? 'bg-green-50 text-success ring-green-200'
      : status === 'draft'
        ? 'bg-warning/10 text-warning-foreground ring-amber-200'
        : 'bg-muted/40 text-foreground/85 ring-gray-200'

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ring-1 ${cls}`}>
      {status}
    </span>
  )
}

export default function FeedBomsPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState({
    category: '',
    status: '',
    search: ''
  })
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [bomView, setBomView] = useState<'list' | 'cards'>('list')

  const { data: boms, isLoading, isError, error, refetch, isFetching } = useQuery<FeedBom[]>({
    queryKey: ['feed-boms', filters],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filters.status) params.append('status', filters.status)
      const response = await api.get(`/feed/feed-boms?${params.toString()}`)
      return response.data
    },
    // Fail fast so the UI doesn't look "stuck" when the backend is down
    retry: false,
    refetchOnWindowFocus: false,
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (bomId: number) => {
      await api.delete(`/feed/feed-boms/${bomId}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed-boms'] })
      setDeleteConfirm(null)
    },
    onError: (error: any) => {
      alert(error.response?.data?.detail || 'Failed to delete BOM')
    },
  })

  // Archive mutation
  const archiveMutation = useMutation({
    mutationFn: async (bomId: number) => {
      await api.post(`/feed/feed-boms/${bomId}/archive`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed-boms'] })
    },
    onError: (error: any) => {
      alert(error.response?.data?.detail || 'Failed to archive BOM')
    },
  })

  const handleDelete = (bomId: number) => {
    if (confirm('Are you sure you want to delete this BOM? This action cannot be undone.')) {
      deleteMutation.mutate(bomId)
    }
  }

  const handleArchive = (bomId: number) => {
    if (confirm('Are you sure you want to archive this BOM?')) {
      archiveMutation.mutate(bomId)
    }
  }

  const canEdit = (bom: FeedBom) => bom.status === 'draft'
  const canDelete = (bom: FeedBom) => bom.status === 'draft'

  const filteredBoms = useMemo(() => {
    if (!boms) return []
    const search = filters.search.trim().toLowerCase()
    if (!search) return boms
    return boms.filter((bom) => bom.bom_code?.toLowerCase().includes(search))
  }, [boms, filters.search])

  if (isLoading) {
    return (
              <div className="space-y-4">
          <div className="bg-white rounded-xl border border-border p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="h-7 w-64 bg-muted rounded animate-pulse" />
                <div className="h-4 w-[34rem] max-w-full bg-muted rounded animate-pulse" />
              </div>
              <div className="h-10 w-28 bg-muted rounded-md animate-pulse" />
            </div>
          </div>
          <div className="bg-white rounded-xl border border-border p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="h-10 bg-muted rounded-md animate-pulse" />
              <div className="h-10 bg-muted rounded-md animate-pulse" />
              <div className="h-10 bg-muted rounded-md animate-pulse" />
            </div>
            <div className="mt-6 space-y-3">
              <div className="h-10 bg-muted rounded-md animate-pulse" />
              <div className="h-10 bg-muted rounded-md animate-pulse" />
              <div className="h-10 bg-muted rounded-md animate-pulse" />
              <div className="h-10 bg-muted rounded-md animate-pulse" />
            </div>
          </div>
        </div>
    )
  }

  return (
          <div className="space-y-6">
        <ReportingHubBreadcrumb current="Feed BOMs" />
        {/* Header */}
        <div className="bg-white rounded-xl border border-border">
          <div className="p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="text-sm text-muted-foreground">Manufacturing</div>
                <h2 className="mt-1 text-2xl font-semibold text-foreground tracking-tight">
                  Feed BOMs / Formulations
                </h2>
                <p className="mt-2 text-sm text-muted-foreground max-w-3xl">
                  Manage feed formulations, versions, and costing. Approved BOMs can be used for production orders.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="inline-flex items-center justify-center rounded-md border border-border bg-white px-3 py-2 text-sm font-medium text-foreground/85 hover:bg-muted/40"
                  aria-label="Refresh"
                >
                  {isFetching ? 'Refreshing…' : 'Refresh'}
                </button>
                <Link
                  href="/manufacturing/feed-boms/new"
                  className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
                >
                  + New BOM
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl border border-border">
          <div className="p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-foreground">Filters</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {filteredBoms.length} shown{boms ? ` • ${boms.length} total` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFilters({ category: '', status: '', search: '' })}
                className="text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            </div>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground/85 mb-1">
                Status
              </label>
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus:border-ring focus:ring-ring"
              >
                <option value="">All</option>
                <option value="draft">Draft</option>
                <option value="approved">Approved</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground/85 mb-1">
                Search
              </label>
              <input
                type="text"
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                placeholder="Search by BOM code…"
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus:border-ring focus:ring-ring"
              />
            </div>
          </div>
          </div>
        </div>

        {/* Content */}
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          {isError ? (
            <div className="p-6">
              <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-4">
                <div className="text-sm font-semibold text-destructive">Couldn’t load Feed BOMs</div>
                <div className="mt-1 text-sm text-destructive">
                  {(error as any)?.message || 'An unexpected error occurred.'}
                </div>
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => refetch()}
                    className="inline-flex items-center rounded-md bg-destructive px-3 py-2 text-sm font-semibold text-white hover:bg-destructive/90"
                  >
                    Try again
                  </button>
                </div>
              </div>
            </div>
          ) : filteredBoms.length === 0 ? (
            <div className="p-10 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent text-primary">
                <span className="text-xl">📐</span>
              </div>
              <h3 className="mt-4 text-base font-semibold text-foreground">No BOMs found</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Create a new formulation, or adjust your filters.
              </p>
              <div className="mt-6 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setFilters({ category: '', status: '', search: '' })}
                  className="inline-flex items-center rounded-md border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground/85 hover:bg-muted/40"
                >
                  Clear filters
                </button>
                <Link
                  href="/manufacturing/feed-boms/new"
                  className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
                >
                  + New BOM
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-border bg-muted/40/90 px-4 py-2">
                <span className="text-sm font-medium text-foreground">Feed BOMs</span>
                <div className="inline-flex rounded-md border border-border bg-white p-0.5">
                  <button
                    type="button"
                    onClick={() => setBomView('list')}
                    className={`rounded px-3 py-1.5 text-sm font-medium ${
                      bomView === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted/40'
                    }`}
                  >
                    List
                  </button>
                  <button
                    type="button"
                    onClick={() => setBomView('cards')}
                    className={`rounded px-3 py-1.5 text-sm font-medium ${
                      bomView === 'cards' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted/40'
                    }`}
                  >
                    Cards
                  </button>
                </div>
              </div>
              {bomView === 'list' ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      BOM
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Version
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Process
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Batch size
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-border/70">
                  {filteredBoms.map((bom) => (
                    <tr key={bom.id} className="hover:bg-muted/40/70">
                      <td className="px-6 py-4">
                        <div className="text-sm font-semibold text-foreground">{bom.bom_code}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Product #{bom.product_id}{bom.is_floating ? ' • Floating' : ''}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground/85">
                        v{bom.version}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground/85">
                        {bom.process_type}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground/85">
                        {bom.default_batch_size_ton} ton
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <StatusPill status={bom.status} />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="inline-flex items-center gap-2">
                          {/* View Button */}
                          <Link
                            href={`/manufacturing/feed-boms/${bom.id}`}
                            className="inline-flex items-center justify-center rounded-md p-1.5 text-primary hover:bg-accent hover:text-primary"
                            title="View BOM"
                          >
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          </Link>
                          
                          {/* Edit Button - Only for draft BOMs */}
                          {canEdit(bom) && (
                            <Link
                              href={`/manufacturing/feed-boms/${bom.id}`}
                              className="inline-flex items-center justify-center rounded-md p-1.5 text-primary hover:bg-accent hover:text-primary"
                              title="Edit BOM"
                            >
                              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </Link>
                          )}
                          
                          {/* Costing Button */}
                          <Link
                            href={`/manufacturing/feed-boms/${bom.id}/costing`}
                            className="inline-flex items-center justify-center rounded-md p-1.5 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
                            title="View Costing"
                          >
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </Link>
                          
                          {/* Delete/Archive Button */}
                          {canDelete(bom) ? (
                            <button
                              onClick={() => handleDelete(bom.id)}
                              disabled={deleteMutation.isPending}
                              className="inline-flex items-center justify-center rounded-md p-1.5 text-destructive hover:bg-destructive/5 hover:text-destructive disabled:opacity-50"
                              title="Delete BOM"
                            >
                              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          ) : bom.status !== 'archived' && (
                            <button
                              onClick={() => handleArchive(bom.id)}
                              disabled={archiveMutation.isPending}
                              className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-muted/40 hover:text-foreground/85 disabled:opacity-50"
                              title="Archive BOM"
                            >
                              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
              ) : (
                <div className="p-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {filteredBoms.map((bom) => (
                      <div
                        key={bom.id}
                        className="flex flex-col rounded-lg border border-border bg-white p-4"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-base font-semibold text-foreground">{bom.bom_code}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              Product #{bom.product_id}
                              {bom.is_floating ? ' • Floating' : ''}
                            </div>
                          </div>
                          <StatusPill status={bom.status} />
                        </div>
                        <dl className="mt-3 space-y-1 text-sm text-muted-foreground">
                          <div className="flex justify-between gap-2">
                            <dt className="text-muted-foreground">Version</dt>
                            <dd className="font-medium text-foreground">v{bom.version}</dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt className="text-muted-foreground">Process</dt>
                            <dd className="font-medium text-foreground">{bom.process_type}</dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt className="text-muted-foreground">Batch</dt>
                            <dd className="font-medium text-foreground">{bom.default_batch_size_ton} ton</dd>
                          </div>
                        </dl>
                        <div className="mt-4 flex justify-end gap-2 border-t border-border/70 pt-3">
                          <Link
                            href={`/manufacturing/feed-boms/${bom.id}`}
                            className="rounded-md p-2 text-primary hover:bg-accent"
                            title="Open BOM"
                          >
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          </Link>
                          <Link
                            href={`/manufacturing/feed-boms/${bom.id}/costing`}
                            className="rounded-md p-2 text-emerald-600 hover:bg-emerald-50"
                            title="Costing"
                          >
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
  )
}

