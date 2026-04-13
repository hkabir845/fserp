'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { CompanyProvider, useCompany } from '@/contexts/CompanyContext'
import { Megaphone, Plus, Trash2, X, Eye, Edit2, CheckCircle, XCircle } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { safeLogError, isConnectionError } from '@/utils/connectionError'
import { formatDate } from '@/utils/date'
import { useRequireSaasDashboardMode } from '@/hooks/useRequireSaasDashboardMode'

interface Company {
  id: number
  name: string
}

interface Broadcast {
  id: number
  title: string
  message: string
  broadcast_type: string
  priority: string
  target_company_id: number | null
  target_company_name: string | null
  target_role: string | null
  scheduled_at: string | null
  expires_at: string | null
  created_by_user_id: number
  created_by_name: string | null
  created_at: string
  is_active: boolean
}

function BroadcastingPageContent() {
  const router = useRouter()
  const toast = useToast()
  useRequireSaasDashboardMode()
  const { mode } = useCompany()
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [showBroadcastModal, setShowBroadcastModal] = useState(false)
  const [showViewModal, setShowViewModal] = useState(false)
  const [editingBroadcast, setEditingBroadcast] = useState<Broadcast | null>(null)
  const [viewingBroadcast, setViewingBroadcast] = useState<Broadcast | null>(null)
  const [broadcastFormData, setBroadcastFormData] = useState({
    title: '',
    message: '',
    broadcast_type: 'general',
    priority: 'medium',
    target_company_id: '',
    target_role: '',
    scheduled_at: '',
    expires_at: ''
  })

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }

    // Get user role
    const userStr = localStorage.getItem('user')
    if (userStr && userStr !== 'undefined' && userStr !== 'null') {
      try {
        const user = JSON.parse(userStr)
        const role = user.role?.toLowerCase() || null
        
        // Only allow SUPER_ADMIN to access this page
        if (role !== 'super_admin') {
          toast.error('Access denied. Super Admin access required.')
          router.push('/dashboard')
          return
        }
      } catch (error) {
        safeLogError('Error parsing user data:', error)
      }
    }

    // Only fetch if in SaaS Dashboard mode
    if (mode === 'saas_dashboard') {
      fetchBroadcasts()
      fetchCompanies()
    } else {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, router])

  const fetchBroadcasts = async () => {
    try {
      setLoading(true)
      const response = await api.get('/broadcasts/')
      if (response.data) {
        setBroadcasts(response.data)
      }
    } catch (error: any) {
      safeLogError('Error fetching broadcasts:', error)
      if (!isConnectionError(error)) {
        toast.error('Failed to load broadcasts')
      }
    } finally {
      setLoading(false)
    }
  }

  const fetchCompanies = async () => {
    try {
      const response = await api.get('/admin/companies')
      if (response.data) {
        setCompanies(response.data)
      }
    } catch (error: any) {
      safeLogError('Error fetching companies:', error)
    }
  }

  const handleCreateBroadcast = () => {
    setEditingBroadcast(null)
    setBroadcastFormData({
      title: '',
      message: '',
      broadcast_type: 'general',
      priority: 'medium',
      target_company_id: '',
      target_role: '',
      scheduled_at: '',
      expires_at: ''
    })
    setShowBroadcastModal(true)
  }

  const handleViewBroadcast = (broadcast: Broadcast) => {
    setViewingBroadcast(broadcast)
    setShowViewModal(true)
  }

  const handleEditBroadcast = (broadcast: Broadcast) => {
    setEditingBroadcast(broadcast)
    // Format dates for datetime-local input (YYYY-MM-DDTHH:mm)
    const formatDateTimeLocal = (dateString: string | null) => {
      if (!dateString) return ''
      try {
        const date = new Date(dateString)
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        const hours = String(date.getHours()).padStart(2, '0')
        const minutes = String(date.getMinutes()).padStart(2, '0')
        return `${year}-${month}-${day}T${hours}:${minutes}`
      } catch {
        return ''
      }
    }
    
    setBroadcastFormData({
      title: broadcast.title,
      message: broadcast.message,
      broadcast_type: broadcast.broadcast_type,
      priority: broadcast.priority,
      target_company_id: broadcast.target_company_id?.toString() || '',
      target_role: broadcast.target_role || '',
      scheduled_at: formatDateTimeLocal(broadcast.scheduled_at),
      expires_at: formatDateTimeLocal(broadcast.expires_at)
    })
    setShowBroadcastModal(true)
  }

  const handleSubmitBroadcast = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!broadcastFormData.title || !broadcastFormData.message) {
      toast.error('Please fill in title and message')
      return
    }

    try {
      const broadcastData: any = {
        title: broadcastFormData.title,
        message: broadcastFormData.message,
        broadcast_type: broadcastFormData.broadcast_type,
        priority: broadcastFormData.priority,
        target_company_id: broadcastFormData.target_company_id ? parseInt(broadcastFormData.target_company_id) : null,
        target_role: broadcastFormData.target_role || null,
        scheduled_at: broadcastFormData.scheduled_at ? new Date(broadcastFormData.scheduled_at).toISOString() : null,
        expires_at: broadcastFormData.expires_at ? new Date(broadcastFormData.expires_at).toISOString() : null
      }

      if (editingBroadcast) {
        // Update existing broadcast
        await api.put(`/broadcasts/${editingBroadcast.id}`, broadcastData)
        toast.success('Broadcast updated successfully!')
      } else {
        // Create new broadcast
        await api.post('/broadcasts/', broadcastData)
        toast.success('Broadcast created successfully!')
      }
      
      setShowBroadcastModal(false)
      setEditingBroadcast(null)
      await fetchBroadcasts()
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.response?.data?.message || (editingBroadcast ? 'Failed to update broadcast' : 'Failed to create broadcast')
      toast.error(errorMsg)
      safeLogError('Broadcast error:', error)
    }
  }

  const handleDeleteBroadcast = async (broadcastId: number) => {
    if (!confirm('Are you sure you want to delete this broadcast?')) {
      return
    }

    try {
      await api.delete(`/broadcasts/${broadcastId}`)
      toast.success('Broadcast deleted successfully!')
      await fetchBroadcasts()
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.response?.data?.message || 'Failed to delete broadcast'
      toast.error(errorMsg)
      safeLogError('Delete broadcast error:', error)
    }
  }

  const handleMarkAsApplied = async (broadcastId: number) => {
    if (!confirm('Mark this broadcast as applied? It will be hidden from tenants but remain in the list.')) {
      return
    }

    try {
      await api.post(`/broadcasts/${broadcastId}/mark-applied`)
      toast.success('Broadcast marked as applied! It will no longer be visible to tenants.')
      await fetchBroadcasts()
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.response?.data?.message || 'Failed to mark broadcast as applied'
      toast.error(errorMsg)
      safeLogError('Mark as applied error:', error)
    }
  }

  const handleMarkAsActive = async (broadcastId: number) => {
    try {
      await api.post(`/broadcasts/${broadcastId}/mark-active`)
      toast.success('Broadcast marked as active! It will now be visible to tenants.')
      await fetchBroadcasts()
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.response?.data?.message || 'Failed to mark broadcast as active'
      toast.error(errorMsg)
      safeLogError('Mark as active error:', error)
    }
  }

  const handleMarkAllAsApplied = async () => {
    const activeCount = broadcasts.filter(b => b.is_active).length
    if (activeCount === 0) {
      toast.info('No active broadcasts to mark as applied.')
      return
    }

    if (!confirm(`Mark all ${activeCount} active broadcast(s) as applied? They will be hidden from tenants but remain in the list.`)) {
      return
    }

    try {
      await api.post('/broadcasts/mark-all-applied')
      toast.success(`All ${activeCount} broadcast(s) marked as applied! They will no longer be visible to tenants.`)
      await fetchBroadcasts()
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.response?.data?.message || 'Failed to mark all broadcasts as applied'
      toast.error(errorMsg)
      safeLogError('Mark all as applied error:', error)
    }
  }

  if (loading) {
    return (
      <div className="page-with-sidebar flex h-screen">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading broadcasts...</p>
          </div>
        </div>
      </div>
    )
  }

  const priorityColors: Record<string, string> = {
    urgent: 'bg-red-100 text-red-800 border-red-200',
    high: 'bg-orange-100 text-orange-800 border-orange-200',
    medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    low: 'bg-blue-100 text-blue-800 border-blue-200'
  }

  const typeLabels: Record<string, string> = {
    payment_due: 'Payment Due',
    upgrade_request: 'Upgrade Request',
    service_expiry: 'Service Expiry',
    maintenance: 'Maintenance',
    announcement: 'Announcement',
    system_update: 'System Update',
    general: 'General'
  }

  return (
    <div className="page-with-sidebar flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900 flex items-center space-x-2">
              <Megaphone className="h-6 w-6 text-blue-600" />
              <span>Broadcasting</span>
            </h2>
            <div className="flex items-center space-x-2">
              {broadcasts.filter(b => b.is_active).length > 0 && (
                <button
                  onClick={handleMarkAllAsApplied}
                  className="flex items-center space-x-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
                  title="Mark all active broadcasts as applied"
                >
                  <span>Mark All as Applied</span>
                </button>
              )}
              <button
                onClick={handleCreateBroadcast}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="h-5 w-5" />
                <span>New Broadcast</span>
              </button>
            </div>
          </div>

          {/* Info Banner */}
          <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <Megaphone className="h-5 w-5 text-blue-600 mt-0.5" />
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-blue-900">Broadcast Messages to All Tenants</h3>
                <div className="mt-2 text-sm text-blue-700">
                  <p>
                    Send important messages to all tenants about payment due, upgrade requests, service expiry dates, maintenance, and more.
                    Messages can be targeted to specific companies or roles, or sent to everyone.
                  </p>
                  <p className="mt-2 font-semibold">
                    💡 Tip: Mark broadcasts as "Applied" to hide them from tenants while keeping them in your list for records.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Broadcasts List */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            {broadcasts.length === 0 ? (
              <div className="p-12 text-center">
                <Megaphone className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">No Broadcasts Yet</h3>
                <p className="text-gray-600 mb-6">Create your first broadcast message to send to all tenants</p>
                <button
                  onClick={handleCreateBroadcast}
                  className="inline-flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Plus className="h-5 w-5" />
                  <span>Create Broadcast</span>
                </button>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {broadcasts.map((broadcast) => (
                  <div key={broadcast.id} className="p-6 hover:bg-gray-50 transition-colors">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3 mb-2">
                          <h3 className="text-lg font-semibold text-gray-900">{broadcast.title}</h3>
                          <span className={`px-2 py-1 text-xs font-semibold rounded border ${priorityColors[broadcast.priority] || priorityColors.medium}`}>
                            {broadcast.priority.toUpperCase()}
                          </span>
                          <span className="px-2 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded">
                            {typeLabels[broadcast.broadcast_type] || broadcast.broadcast_type}
                          </span>
                          <span className={`px-2 py-1 text-xs font-semibold rounded ${
                            broadcast.is_active 
                              ? 'bg-green-100 text-green-800 border border-green-200' 
                              : 'bg-gray-200 text-gray-700 border border-gray-300'
                          }`}>
                            {broadcast.is_active ? 'ACTIVE' : 'APPLIED'}
                          </span>
                        </div>
                        <p className="text-gray-700 mb-3 whitespace-pre-wrap">{broadcast.message}</p>
                        <div className="flex items-center space-x-4 text-sm text-gray-500">
                          <span>Created by: {broadcast.created_by_name || 'System'}</span>
                          <span>•</span>
                          <span>{formatDate(broadcast.created_at, true)}</span>
                          {broadcast.target_company_name && (
                            <>
                              <span>•</span>
                              <span>Target: {broadcast.target_company_name}</span>
                            </>
                          )}
                          {broadcast.target_role && (
                            <>
                              <span>•</span>
                              <span>Role: {broadcast.target_role}</span>
                            </>
                          )}
                          {broadcast.expires_at && (
                            <>
                              <span>•</span>
                              <span>Expires: {formatDate(broadcast.expires_at, true)}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center space-x-2 ml-4">
                        <button
                          onClick={() => handleViewBroadcast(broadcast)}
                          className="p-2 text-blue-600 hover:text-blue-900 hover:bg-blue-50 rounded transition-colors"
                          title="View Broadcast"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleEditBroadcast(broadcast)}
                          className="p-2 text-green-600 hover:text-green-900 hover:bg-green-50 rounded transition-colors"
                          title="Edit Broadcast"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        {broadcast.is_active ? (
                          <button
                            onClick={() => handleMarkAsApplied(broadcast.id)}
                            className="p-2 text-orange-600 hover:text-orange-900 hover:bg-orange-50 rounded transition-colors"
                            title="Mark as Applied (Hide from tenants)"
                          >
                            <CheckCircle className="h-4 w-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleMarkAsActive(broadcast.id)}
                            className="p-2 text-green-600 hover:text-green-900 hover:bg-green-50 rounded transition-colors"
                            title="Mark as Active (Show to tenants)"
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteBroadcast(broadcast.id)}
                          className="p-2 text-red-600 hover:text-red-900 hover:bg-red-50 rounded transition-colors"
                          title="Delete Broadcast"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Broadcast Modal */}
      {showBroadcastModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 sticky top-0 z-10 flex items-center justify-between rounded-t-xl">
              <h2 className="text-2xl font-bold text-white flex items-center space-x-2">
                <Megaphone className="h-6 w-6" />
                <span>{editingBroadcast ? 'Edit Broadcast' : 'Create Broadcast'}</span>
              </h2>
              <button
                onClick={() => {
                  setShowBroadcastModal(false)
                  setEditingBroadcast(null)
                }}
                className="p-2 hover:bg-white/20 rounded-full transition-colors"
              >
                <X className="h-5 w-5 text-white" />
              </button>
            </div>

            <form onSubmit={handleSubmitBroadcast} className="p-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Title <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={broadcastFormData.title}
                    onChange={(e) => setBroadcastFormData({ ...broadcastFormData, title: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="e.g., Payment Due Reminder"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Message <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    required
                    rows={6}
                    value={broadcastFormData.message}
                    onChange={(e) => setBroadcastFormData({ ...broadcastFormData, message: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Enter your message to all tenants..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Type
                    </label>
                    <select
                      value={broadcastFormData.broadcast_type}
                      onChange={(e) => setBroadcastFormData({ ...broadcastFormData, broadcast_type: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="general">General</option>
                      <option value="payment_due">Payment Due</option>
                      <option value="upgrade_request">Upgrade Request</option>
                      <option value="service_expiry">Service Expiry</option>
                      <option value="maintenance">Maintenance</option>
                      <option value="announcement">Announcement</option>
                      <option value="system_update">System Update</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Priority
                    </label>
                    <select
                      value={broadcastFormData.priority}
                      onChange={(e) => setBroadcastFormData({ ...broadcastFormData, priority: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Target Company (Optional)
                    </label>
                    <select
                      value={broadcastFormData.target_company_id}
                      onChange={(e) => setBroadcastFormData({ ...broadcastFormData, target_company_id: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="">All Companies</option>
                      {companies.map((company) => (
                        <option key={company.id} value={company.id.toString()}>
                          {company.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Target Role (Optional)
                    </label>
                    <select
                      value={broadcastFormData.target_role}
                      onChange={(e) => setBroadcastFormData({ ...broadcastFormData, target_role: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="">All Roles</option>
                      <option value="admin">Admin</option>
                      <option value="accountant">Accountant</option>
                      <option value="cashier">Cashier</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Schedule At (Optional)
                    </label>
                    <input
                      type="datetime-local"
                      value={broadcastFormData.scheduled_at}
                      onChange={(e) => setBroadcastFormData({ ...broadcastFormData, scheduled_at: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Expires At (Optional)
                    </label>
                    <input
                      type="datetime-local"
                      value={broadcastFormData.expires_at}
                      onChange={(e) => setBroadcastFormData({ ...broadcastFormData, expires_at: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-6 border-t mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setShowBroadcastModal(false)
                    setEditingBroadcast(null)
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  {editingBroadcast ? 'Update Broadcast' : 'Create Broadcast'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Broadcast Modal */}
      {showViewModal && viewingBroadcast && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 sticky top-0 z-10 flex items-center justify-between rounded-t-xl">
              <h2 className="text-2xl font-bold text-white flex items-center space-x-2">
                <Eye className="h-6 w-6" />
                <span>View Broadcast</span>
              </h2>
              <button
                onClick={() => {
                  setShowViewModal(false)
                  setViewingBroadcast(null)
                }}
                className="p-2 hover:bg-white/20 rounded-full transition-colors"
              >
                <X className="h-5 w-5 text-white" />
              </button>
            </div>

            <div className="p-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Title
                  </label>
                  <p className="text-lg font-semibold text-gray-900">{viewingBroadcast.title}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Message
                  </label>
                  <p className="text-gray-700 whitespace-pre-wrap bg-gray-50 p-3 rounded-lg">{viewingBroadcast.message}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Type
                    </label>
                    <p className="text-gray-900">{typeLabels[viewingBroadcast.broadcast_type] || viewingBroadcast.broadcast_type}</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Priority
                    </label>
                    <span className={`px-3 py-1 text-sm font-semibold rounded border ${priorityColors[viewingBroadcast.priority] || priorityColors.medium}`}>
                      {viewingBroadcast.priority.toUpperCase()}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Target Company
                    </label>
                    <p className="text-gray-900">{viewingBroadcast.target_company_name || 'All Companies'}</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Target Role
                    </label>
                    <p className="text-gray-900">{viewingBroadcast.target_role || 'All Roles'}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Scheduled At
                    </label>
                    <p className="text-gray-900">
                      {viewingBroadcast.scheduled_at 
                        ? formatDate(viewingBroadcast.scheduled_at, true) 
                        : 'Not scheduled'}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Expires At
                    </label>
                    <p className="text-gray-900">
                      {viewingBroadcast.expires_at 
                        ? formatDate(viewingBroadcast.expires_at, true) 
                        : 'Never expires'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Created By
                    </label>
                    <p className="text-gray-900">{viewingBroadcast.created_by_name || 'System'}</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Created At
                    </label>
                    <p className="text-gray-900">{formatDate(viewingBroadcast.created_at, true)}</p>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Status
                  </label>
                  <span className={`px-3 py-1 text-sm font-semibold rounded ${
                    viewingBroadcast.is_active 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-gray-100 text-gray-800'
                  }`}>
                    {viewingBroadcast.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-6 border-t mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setShowViewModal(false)
                    setViewingBroadcast(null)
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowViewModal(false)
                    handleEditBroadcast(viewingBroadcast)
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Edit2 className="h-4 w-4 inline mr-2" />
                  Edit
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function BroadcastingPage() {
  return (
    <CompanyProvider>
      <BroadcastingPageContent />
    </CompanyProvider>
  )
}
