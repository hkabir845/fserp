'use client'

import { useState, useEffect, useCallback } from 'react'
import { Clock, PlayCircle, StopCircle, Edit2, Trash2, Plus, X } from 'lucide-react'
import Sidebar from '@/components/Sidebar'
import api from '@/lib/api'
import { useToast } from '@/components/Toast'
import { formatCurrency } from '@/utils/currency'
import { safeLogError, isConnectionError } from '@/utils/connectionError'
import { formatDate } from '@/utils/date'

interface ShiftTemplate {
  id: number
  name: string
  start_time: string | null
  end_time: string | null
  is_cross_midnight: boolean
  is_active: boolean
}

/** API omits is_active — treat as active. Backend has no is_cross_midnight; infer for display only. */
function normalizeTemplates(data: unknown): ShiftTemplate[] {
  if (!Array.isArray(data)) return []
  return data.map((raw: Record<string, unknown>) => {
    const start = raw.start_time != null ? String(raw.start_time) : ''
    const end = raw.end_time != null ? String(raw.end_time) : ''
    return {
      id: Number(raw.id),
      name: String(raw.name || 'Shift'),
      start_time: start || null,
      end_time: end || null,
      is_cross_midnight: Boolean(raw.is_cross_midnight),
      is_active: raw.is_active !== false,
    }
  })
}

function toTimeInputValue(isoOrHhmm: string | null | undefined): string {
  if (!isoOrHhmm) return ''
  const s = String(isoOrHhmm)
  if (s.length >= 5 && s[2] === ':') return s.slice(0, 5)
  return s
}

function formatTemplateTime(t: string | null | undefined): string {
  if (!t) return '—'
  return toTimeInputValue(t)
}

interface Station {
  id: number
  station_number: string
  station_name: string
  is_active: boolean
}

/** Matches Django shift session JSON */
interface ShiftSession {
  id: number
  station_id: number | null
  template_id: number | null
  opened_at: string
  closed_at: string | null
  opening_cash_float: string
  expected_cash_total: string
  closing_cash_counted: string | null
  cash_variance: string
  total_sales_amount: string
  sale_transaction_count: number
}

export default function ShiftManagementPage() {
  const toast = useToast()
  const [activeSession, setActiveSession] = useState<ShiftSession | null>(null)
  const [templates, setTemplates] = useState<ShiftTemplate[]>([])
  const [stations, setStations] = useState<Station[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<number | null>(null)
  const [selectedStation, setSelectedStation] = useState<number | null>(null)
  const [openingCash, setOpeningCash] = useState('0.00')
  const [closingCash, setClosingCash] = useState('0.00')
  const [closingNotes, setClosingNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(null)
  const [templateFormData, setTemplateFormData] = useState({
    name: '',
    start_time: '',
    end_time: '',
    is_cross_midnight: false,
  })

  useEffect(() => {
    const userStr = localStorage.getItem('user')
    if (userStr && userStr !== 'undefined' && userStr !== 'null') {
      try {
        const user = JSON.parse(userStr)
        setUserRole(user.role?.toLowerCase() || null)
      } catch (error) {
        safeLogError('shift-management parse user', error)
      }
    }
  }, [])

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const [templatesRes, stationsRes, activeRes] = await Promise.all([
        api.get('/shifts/templates/'),
        api.get('/stations/'),
        api.get('/shifts/sessions/active/'),
      ])

      const list = normalizeTemplates(templatesRes.data)
      setTemplates(list)
      setStations(Array.isArray(stationsRes.data) ? stationsRes.data : [])

      const session = activeRes.data
      setActiveSession(session && typeof session === 'object' ? session : null)

      setSelectedTemplate((prev) => {
        if (prev != null && list.some((t) => t.id === prev)) return prev
        return list.length > 0 ? list[0].id : null
      })
      setSelectedStation((prev) => {
        const arr = Array.isArray(stationsRes.data) ? stationsRes.data : []
        if (prev != null && arr.some((s: Station) => s.id === prev)) return prev
        if (arr.length === 0) return null
        const activeStation = arr.find((s: Station) => s.is_active) || arr[0]
        return activeStation.id
      })
    } catch (error) {
      if (!isConnectionError(error)) {
        safeLogError('shift-management load', error)
        toast.error('Could not load shift data. Check company context and try again.')
      }
      setTemplates([])
      setStations([])
      setActiveSession(null)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadData()
  }, [loadData])

  const canManageTemplates = ['admin', 'super_admin', 'manager'].includes(userRole || '')

  const handleOpenShift = async () => {
    if (!selectedTemplate) {
      toast.error('Please select a shift template')
      return
    }
    if (!selectedStation) {
      toast.error('Please select a station')
      return
    }
    if (!openingCash || parseFloat(openingCash) < 0) {
      toast.error('Please enter a valid opening cash amount')
      return
    }

    try {
      const response = await api.post('/shifts/sessions/open/', {
        station_id: selectedStation,
        template_id: selectedTemplate,
        opening_cash_float: parseFloat(openingCash),
      })
      setActiveSession(response.data)
      toast.success('Shift opened successfully')
      setOpeningCash('0.00')
      await loadData()
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } }
      toast.error(err.response?.data?.detail || 'Error opening shift')
    }
  }

  const handleCloseShift = async () => {
    if (!activeSession) return
    if (!confirm('Are you sure you want to close this shift?')) return

    try {
      await api.post(`/shifts/sessions/${activeSession.id}/close/`, {
        closing_cash_counted: parseFloat(closingCash || '0'),
      })
      toast.success('Shift closed successfully')
      setActiveSession(null)
      setClosingCash('0.00')
      setClosingNotes('')
      await loadData()
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } }
      toast.error(err.response?.data?.detail || 'Error closing shift')
    }
  }

  const resetTemplateForm = () => {
    setTemplateFormData({
      name: '',
      start_time: '',
      end_time: '',
      is_cross_midnight: false,
    })
    setEditingTemplateId(null)
  }

  const handleEditTemplate = (template: ShiftTemplate) => {
    setEditingTemplateId(template.id)
    setTemplateFormData({
      name: template.name,
      start_time: toTimeInputValue(template.start_time),
      end_time: toTimeInputValue(template.end_time),
      is_cross_midnight: template.is_cross_midnight,
    })
    setShowTemplateModal(true)
  }

  const handleCreateTemplate = () => {
    resetTemplateForm()
    setShowTemplateModal(true)
  }

  const handleDeleteTemplate = async (template: ShiftTemplate) => {
    if (!confirm(`Delete shift template "${template.name}"?`)) return
    try {
      await api.delete(`/shifts/templates/${template.id}/`)
      toast.success('Shift template deleted')
      if (selectedTemplate === template.id) setSelectedTemplate(null)
      loadData()
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } }
      toast.error(err.response?.data?.detail || 'Failed to delete template')
    }
  }

  const handleSubmitTemplate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!templateFormData.name.trim()) {
      toast.error('Template name is required')
      return
    }

    const body = {
      name: templateFormData.name.trim(),
      start_time: templateFormData.start_time || null,
      end_time: templateFormData.end_time || null,
    }

    try {
      if (editingTemplateId) {
        await api.put(`/shifts/templates/${editingTemplateId}/`, body)
        toast.success('Template updated')
      } else {
        await api.post('/shifts/templates/', body)
        toast.success('Template created')
      }
      setShowTemplateModal(false)
      resetTemplateForm()
      loadData()
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } }
      toast.error(err.response?.data?.detail || 'Failed to save template')
    }
  }

  const openingFloat = activeSession ? Number(activeSession.opening_cash_float || 0) : 0
  const expectedCashTotal = activeSession ? Number(activeSession.expected_cash_total || 0) : 0
  const expectedInDrawer = openingFloat + expectedCashTotal
  const closingCounted = parseFloat(closingCash || '0')
  const variancePreview = closingCounted - expectedInDrawer

  if (loading) {
    return (
      <div className="flex h-screen bg-gray-100 page-with-sidebar">
        <Sidebar />
        <div className="flex-1 overflow-auto p-8">
          <div className="text-center text-gray-600">Loading shift management…</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-100 page-with-sidebar">
      <Sidebar />
      <div className="flex-1 overflow-auto p-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Shift Management</h1>
          <p className="text-gray-600">Open and close cashier shifts by template and station</p>
        </div>

        {activeSession ? (
          <div className="bg-green-50 border-2 border-green-500 rounded-lg p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="bg-green-500 text-white p-3 rounded-full">
                  <Clock className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-green-900">Shift active</h2>
                  <p className="text-green-700 text-sm">
                    Opened {formatDate(activeSession.opened_at, true)}
                    {activeSession.template_id != null && (
                      <>
                        {' '}
                        · Template #
                        {activeSession.template_id}
                      </>
                    )}
                    {activeSession.station_id != null && (
                      <>
                        {' '}
                        · Station #
                        {activeSession.station_id}
                      </>
                    )}
                  </p>
                </div>
              </div>
              <div className="bg-green-500 text-white px-4 py-2 rounded-full font-bold animate-pulse">OPEN</div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-white rounded-lg p-4 shadow">
                <div className="text-sm text-gray-600 mb-1">Total sales</div>
                <div className="text-2xl font-bold text-gray-900">
                  {formatCurrency(Number(activeSession.total_sales_amount || 0))}
                </div>
              </div>
              <div className="bg-white rounded-lg p-4 shadow">
                <div className="text-sm text-gray-600 mb-1">Transactions</div>
                <div className="text-2xl font-bold text-indigo-600">{activeSession.sale_transaction_count ?? 0}</div>
              </div>
              <div className="bg-white rounded-lg p-4 shadow">
                <div className="text-sm text-gray-600 mb-1">Opening float</div>
                <div className="text-2xl font-bold text-gray-900">{formatCurrency(openingFloat)}</div>
              </div>
              <div className="bg-white rounded-lg p-4 shadow">
                <div className="text-sm text-gray-600 mb-1">Expected cash in drawer</div>
                <div className="text-2xl font-bold text-blue-600">{formatCurrency(expectedInDrawer)}</div>
              </div>
            </div>

            <div className="bg-white rounded-lg p-6 shadow">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Close shift</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Closing cash (counted) *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={closingCash}
                    onChange={(e) => setClosingCash(e.target.value)}
                    className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Cash variance (preview)</label>
                  <div
                    className={`text-2xl font-bold ${variancePreview >= 0 ? 'text-green-600' : 'text-red-600'}`}
                  >
                    {formatCurrency(variancePreview)}
                  </div>
                </div>
              </div>
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Notes (optional)</label>
                <textarea
                  value={closingNotes}
                  onChange={(e) => setClosingNotes(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Optional notes for your records (not saved to the server yet)"
                />
              </div>
              <button
                type="button"
                onClick={handleCloseShift}
                className="mt-4 w-full bg-red-600 text-white px-6 py-3 rounded-lg hover:bg-red-700 flex items-center justify-center space-x-2"
              >
                <StopCircle className="h-5 w-5" />
                <span>Close shift</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-blue-50 border-2 border-blue-500 rounded-lg p-6 mb-6">
            <div className="flex items-center space-x-3 mb-4">
              <div className="bg-blue-500 text-white p-3 rounded-full">
                <PlayCircle className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-blue-900">Open shift</h2>
                <p className="text-blue-700 text-sm">Choose a template and station, then enter opening float</p>
              </div>
            </div>

            <div className="bg-white rounded-lg p-6 shadow">
              {templates.length === 0 && (
                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  No shift templates yet. Create one below (or ask an admin) so this dropdown can be used.
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Shift template *</label>
                  <select
                    value={selectedTemplate ?? ''}
                    onChange={(e) =>
                      setSelectedTemplate(e.target.value === '' ? null : Number(e.target.value))
                    }
                    className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  >
                    <option value="">Select shift template…</option>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                        {template.start_time || template.end_time
                          ? ` (${formatTemplateTime(template.start_time)} – ${formatTemplateTime(template.end_time)})`
                          : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Station *</label>
                  <select
                    value={selectedStation ?? ''}
                    onChange={(e) =>
                      setSelectedStation(e.target.value === '' ? null : Number(e.target.value))
                    }
                    className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  >
                    <option value="">Select station…</option>
                    {stations
                      .filter((s) => s.is_active)
                      .map((station) => (
                        <option key={station.id} value={station.id}>
                          {station.station_name}
                          {station.station_number ? ` (${station.station_number})` : ''}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Opening cash float *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={openingCash}
                    onChange={(e) => setOpeningCash(e.target.value)}
                    className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={handleOpenShift}
                disabled={
                  !selectedTemplate ||
                  !selectedStation ||
                  openingCash === '' ||
                  parseFloat(openingCash) < 0 ||
                  templates.length === 0
                }
                className="w-full bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center space-x-2 transition-colors"
              >
                <PlayCircle className="h-5 w-5" />
                <span>Open shift</span>
              </button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">Shift templates</h2>
            {canManageTemplates && (
              <button
                type="button"
                onClick={handleCreateTemplate}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="h-5 w-5" />
                <span>New template</span>
              </button>
            )}
          </div>
          {templates.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              No templates defined for this company.{' '}
              {canManageTemplates ? 'Click “New template” to add Morning / Evening shifts.' : 'Ask an administrator to add templates.'}
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {templates.map((template) => (
                <div key={template.id} className="border rounded-lg p-4 relative">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-bold text-gray-900">{template.name}</h3>
                    {canManageTemplates && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleEditTemplate(template)}
                          className="p-1 text-green-600 hover:text-green-900 rounded"
                          title="Edit"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTemplate(template)}
                          className="p-1 text-red-600 hover:text-red-900 rounded"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="text-sm text-gray-600">
                    <div className="flex items-center space-x-2 mb-1">
                      <Clock className="h-4 w-4 shrink-0" />
                      <span>
                        {formatTemplateTime(template.start_time)} – {formatTemplateTime(template.end_time)}
                      </span>
                    </div>
                    {template.is_cross_midnight && (
                      <div className="text-xs text-orange-600 mt-2">Cross-midnight (local flag)</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {showTemplateModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 sticky top-0 z-10 flex items-center justify-between rounded-t-xl">
                <div className="flex items-center space-x-3">
                  <Clock className="h-6 w-6 text-white" />
                  <h2 className="text-2xl font-bold text-white">
                    {editingTemplateId ? 'Edit shift template' : 'New shift template'}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowTemplateModal(false)
                    resetTemplateForm()
                  }}
                  className="p-2 hover:bg-white/20 rounded-full transition-colors"
                >
                  <X className="h-5 w-5 text-white" />
                </button>
              </div>

              <form onSubmit={handleSubmitTemplate} className="p-6">
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Template name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={templateFormData.name}
                        onChange={(e) => setTemplateFormData({ ...templateFormData, name: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="e.g. Morning shift"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Start time</label>
                      <input
                        type="time"
                        value={templateFormData.start_time}
                        onChange={(e) => setTemplateFormData({ ...templateFormData, start_time: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">End time</label>
                      <input
                        type="time"
                        value={templateFormData.end_time}
                        onChange={(e) => setTemplateFormData({ ...templateFormData, end_time: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={templateFormData.is_cross_midnight}
                          onChange={(e) =>
                            setTemplateFormData({ ...templateFormData, is_cross_midnight: e.target.checked })
                          }
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700">Crosses midnight (reference only; not stored on server)</span>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end space-x-3 pt-6 border-t mt-6">
                  <button
                    type="button"
                    onClick={() => {
                      setShowTemplateModal(false)
                      resetTemplateForm()
                    }}
                    className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    {editingTemplateId ? 'Update' : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-2">Today&apos;s overview</h2>
          <p className="text-gray-500 text-sm">
            Use Reports → Shift summary for history. This page focuses on the active session and templates.
          </p>
        </div>
      </div>
    </div>
  )
}
