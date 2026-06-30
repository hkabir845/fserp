'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDateOnly } from '@/utils/date'
import { PlatformLayout } from '@/components/PlatformLayout'

interface Broadcast {
  id: number
  title: string
  message: string
  target_tenants: string[] | null // null = all tenants (tenant domains when targeted)
  priority: 'low' | 'medium' | 'high' | 'urgent'
  status: 'draft' | 'scheduled' | 'sent' | 'cancelled'
  scheduled_at: string | null
  sent_at: string | null
  created_at: string
  created_by: string
}

export default function BroadcastPage() {
  const queryClient = useQueryClient()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingBroadcast, setEditingBroadcast] = useState<Partial<Broadcast> | null>(null)

  const { data: broadcasts = [], isLoading } = useQuery<Broadcast[]>({
    queryKey: ['platform-broadcasts'],
    queryFn: async () => {
      const res = await api.get<Broadcast[]>('/platform/broadcasts')
      return res.data || []
    },
    retry: false,
  })

  const saveBroadcast = useMutation({
    mutationFn: async (payload: {
      id?: number
      title: string
      message: string
      priority: string
      status: string
      target_tenant_domains: string[] | null
      scheduled_at?: string | null
    }) => {
      if (payload.id) {
        const res = await api.patch(`/platform/broadcasts/${payload.id}`, {
          title: payload.title,
          message: payload.message,
          priority: payload.priority,
          status: payload.status,
          target_tenant_domains: payload.target_tenant_domains,
          scheduled_at: payload.scheduled_at || undefined,
        })
        return res.data
      }
      const res = await api.post('/platform/broadcasts', {
        title: payload.title,
        message: payload.message,
        priority: payload.priority,
        status: payload.status,
        target_tenant_domains: payload.target_tenant_domains,
        scheduled_at: payload.scheduled_at || undefined,
      })
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-broadcasts'] })
    },
  })

  const sendBroadcast = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.patch(`/platform/broadcasts/${id}`, { status: 'sent' })
      return res.data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['platform-broadcasts'] }),
  })

  // Fetch tenants for selection
  const { data: tenants = [] } = useQuery({
    queryKey: ['platform-tenants'],
    queryFn: async () => {
      try {
        const response = await api.get('/platform/tenants?limit=100')
        return response.data || []
      } catch (error) {
        console.error('Error fetching tenants:', error)
        return []
      }
    },
  })

  const getPriorityColor = (priority: string) => {
    const colors: Record<string, string> = {
      low: 'bg-muted text-foreground',
      medium: 'bg-blue-100 text-primary',
      high: 'bg-yellow-100 text-yellow-800',
      urgent: 'bg-destructive/10 text-destructive',
    }
    return colors[priority] || 'bg-muted text-foreground'
  }

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      draft: 'bg-muted text-foreground',
      scheduled: 'bg-blue-100 text-primary',
      sent: 'bg-success/15 text-success',
      cancelled: 'bg-destructive/10 text-destructive',
    }
    return colors[status] || 'bg-muted text-foreground'
  }

  return (
    <PlatformLayout>
      <div className="py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Page Header */}
          <div className="mb-8 flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Broadcast Messages</h1>
              <p className="text-muted-foreground mt-2">Send announcements and notifications to tenants</p>
            </div>
            <button
              onClick={() => {
                setEditingBroadcast(null)
                setShowCreateModal(true)
              }}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 flex items-center gap-2"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Broadcast
            </button>
          </div>

          {/* Statistics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-6 border-l-4 border-blue-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Broadcasts</p>
                  <p className="text-3xl font-bold text-foreground mt-2">{broadcasts.length}</p>
                </div>
                <div className="bg-blue-100 rounded-full p-3">
                  <svg className="h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6 border-l-4 border-green-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Sent</p>
                  <p className="text-3xl font-bold text-foreground mt-2">
                    {broadcasts.filter(b => b.status === 'sent').length}
                  </p>
                </div>
                <div className="bg-success/15 rounded-full p-3">
                  <svg className="h-6 w-6 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6 border-l-4 border-yellow-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Scheduled</p>
                  <p className="text-3xl font-bold text-foreground mt-2">
                    {broadcasts.filter(b => b.status === 'scheduled').length}
                  </p>
                </div>
                <div className="bg-yellow-100 rounded-full p-3">
                  <svg className="h-6 w-6 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6 border-l-4 border-border/500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Drafts</p>
                  <p className="text-3xl font-bold text-foreground mt-2">
                    {broadcasts.filter(b => b.status === 'draft').length}
                  </p>
                </div>
                <div className="bg-muted rounded-full p-3">
                  <svg className="h-6 w-6 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </div>
              </div>
            </div>
          </div>

          {/* Broadcasts Table */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            {isLoading ? (
              <div className="p-12 text-center">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                <p className="mt-4 text-muted-foreground">Loading broadcasts...</p>
              </div>
            ) : broadcasts.length === 0 ? (
              <div className="p-12 text-center">
                <svg className="mx-auto h-12 w-12 text-muted-foreground/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <h3 className="mt-4 text-lg font-medium text-foreground">No broadcasts yet</h3>
                <p className="mt-2 text-muted-foreground">Get started by creating a new broadcast message.</p>
                <button
                  onClick={() => {
                    setEditingBroadcast(null)
                    setShowCreateModal(true)
                  }}
                  className="mt-6 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
                >
                  Create Broadcast
                </button>
              </div>
            ) : (
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Title</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Priority</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Target</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Scheduled</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Created</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-border">
                  {broadcasts.map((broadcast) => (
                    <tr key={broadcast.id} className="hover:bg-muted/40">
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-foreground">{broadcast.title}</div>
                        <div className="text-sm text-muted-foreground truncate max-w-md">{broadcast.message}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getPriorityColor(broadcast.priority)}`}>
                          {broadcast.priority.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(broadcast.status)}`}>
                          {broadcast.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                        {broadcast.target_tenants === null ? 'All Tenants' : `${broadcast.target_tenants.length} Tenant(s)`}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                        {broadcast.scheduled_at ? formatDateOnly(broadcast.scheduled_at) : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                        {formatDateOnly(broadcast.created_at)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => {
                            setEditingBroadcast(broadcast)
                            setShowCreateModal(true)
                          }}
                          className="text-primary hover:text-foreground/85 mr-4"
                        >
                          Edit
                        </button>
                        {broadcast.status === 'draft' && (
                          <button
                            type="button"
                            disabled={sendBroadcast.isPending}
                            onClick={() => sendBroadcast.mutate(broadcast.id)}
                            className="text-success hover:text-green-900 disabled:opacity-50"
                          >
                            Send
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {showCreateModal && (
        <BroadcastModal
          broadcast={editingBroadcast}
          tenants={tenants}
          saving={saveBroadcast.isPending}
          onClose={() => {
            setShowCreateModal(false)
            setEditingBroadcast(null)
          }}
          onSave={(broadcast) => {
            const scheduled_at =
              broadcast.scheduled_at && broadcast.scheduled_at.trim() !== ''
                ? new Date(broadcast.scheduled_at).toISOString()
                : undefined
            void saveBroadcast.mutateAsync({
              id: editingBroadcast?.id,
              title: broadcast.title || '',
              message: broadcast.message || '',
              priority: broadcast.priority || 'medium',
              status: broadcast.status || 'draft',
              target_tenant_domains:
                broadcast.target_tenants === null || broadcast.target_tenants === undefined
                  ? null
                  : broadcast.target_tenants,
              scheduled_at,
            })
            setShowCreateModal(false)
            setEditingBroadcast(null)
          }}
        />
      )}
    </PlatformLayout>
  )
}

// Broadcast Modal Component
function BroadcastModal({
  broadcast,
  tenants,
  onClose,
  onSave,
  saving,
}: {
  broadcast: Partial<Broadcast> | null
  tenants: any[]
  onClose: () => void
  onSave: (broadcast: Partial<Broadcast>) => void
  saving?: boolean
}) {
  const [formData, setFormData] = useState({
    title: broadcast?.title || '',
    message: broadcast?.message || '',
    priority: broadcast?.priority || 'medium' as const,
    status: broadcast?.status || 'draft' as const,
    target_tenants: broadcast?.target_tenants || null as string[] | null,
    scheduled_at: broadcast?.scheduled_at || '',
  })

  const [selectedTenants, setSelectedTenants] = useState<Set<string>>(
    new Set(broadcast?.target_tenants || [])
  )
  const [targetType, setTargetType] = useState<'all' | 'selected'>(
    broadcast?.target_tenants === null ? 'all' : 'selected'
  )

  const handleSave = () => {
    if (!formData.title || !formData.message) {
      alert('Please fill in title and message')
      return
    }

    onSave({
      ...formData,
      target_tenants: targetType === 'all' ? null : Array.from(selectedTenants),
    })
  }

  return (
    <div className="fixed inset-0 bg-muted-foreground bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-5 border w-full max-w-2xl shadow-lg rounded-md bg-white">
        <div className="mt-3">
          <h3 className="text-lg font-medium text-foreground mb-4">
            {broadcast?.id ? 'Edit Broadcast' : 'Create Broadcast'}
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground/85">Title *</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-border rounded-md shadow-sm focus:ring-ring focus:border-ring"
                placeholder="System Maintenance Notice"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground/85">Message *</label>
              <textarea
                value={formData.message}
                onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                rows={6}
                className="mt-1 block w-full px-3 py-2 border border-border rounded-md shadow-sm focus:ring-ring focus:border-ring"
                placeholder="Enter your broadcast message..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground/85">Priority</label>
                <select
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: e.target.value as any })}
                  className="mt-1 block w-full px-3 py-2 border border-border rounded-md shadow-sm focus:ring-ring focus:border-ring"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/85">Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                  className="mt-1 block w-full px-3 py-2 border border-border rounded-md shadow-sm focus:ring-ring focus:border-ring"
                >
                  <option value="draft">Draft</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="sent">Sent</option>
                </select>
              </div>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">Target Tenants</label>
              <div className="space-y-2">
                <div className="flex items-center gap-4">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      checked={targetType === 'all'}
                      onChange={() => {
                        setTargetType('all')
                        setSelectedTenants(new Set())
                      }}
                      className="mr-2"
                    />
                    All Tenants
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      checked={targetType === 'selected'}
                      onChange={() => setTargetType('selected')}
                      className="mr-2"
                    />
                    Selected Tenants
                  </label>
                </div>
                {targetType === 'selected' && (
                  <div className="border border-border rounded-md p-3 max-h-48 overflow-y-auto">
                    {tenants.map((tenant) => (
                      <label key={tenant.id} className="flex items-center py-1">
                        <input
                          type="checkbox"
                          checked={selectedTenants.has(tenant.domain)}
                          onChange={(e) => {
                            const newSet = new Set(selectedTenants)
                            if (e.target.checked) {
                              newSet.add(tenant.domain)
                            } else {
                              newSet.delete(tenant.domain)
                            }
                            setSelectedTenants(newSet)
                          }}
                          className="mr-2"
                        />
                        <span className="text-sm">{tenant.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {formData.status === 'scheduled' && (
              <div>
                <label className="block text-sm font-medium text-foreground/85">Scheduled Date & Time</label>
                <input
                  type="datetime-local"
                  value={formData.scheduled_at}
                  onChange={(e) => setFormData({ ...formData, scheduled_at: e.target.value })}
                  className="mt-1 block w-full px-3 py-2 border border-border rounded-md shadow-sm focus:ring-ring focus:border-ring"
                />
              </div>
            )}
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-border rounded-md text-sm font-medium text-foreground/85 hover:bg-muted/40"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : (broadcast?.id ? 'Update' : 'Create')} Broadcast
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

