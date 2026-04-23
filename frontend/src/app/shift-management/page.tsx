'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Clock, PlayCircle, StopCircle, Edit2, Trash2, Plus, X, History } from 'lucide-react'
import Sidebar from '@/components/Sidebar'
import api from '@/lib/api'
import { useToast } from '@/components/Toast'
import { formatCurrency } from '@/utils/currency'
import { safeLogError, isConnectionError } from '@/utils/connectionError'
import { formatDate } from '@/utils/date'
import { useCompanyLocale } from '@/contexts/CompanyLocaleContext'
import { formatWallClockTime, toHhMmString } from '@/utils/companyLocaleFormats'
import { TimeOfDayInput } from '@/components/TimeOfDayInput'

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

interface Station {
  id: number
  station_number: string
  station_name: string
  is_active: boolean
}

/** Meters list API (station-scoped on the client) */
interface ApiMeter {
  id: number
  station_id: number | null
  meter_name: string
  dispenser_name: string
  current_reading: string
  is_active: boolean
}

interface ApiEmployee {
  id: number
  first_name: string
  last_name: string
  is_active: boolean
}

/** Opening snapshot / schedule stored on the session (matches backend) */
type OpeningMeterSnapshot = {
  meter_id: number
  reading: string
  previous_reading: string
  meter_name: string
  dispenser_name: string
}

type ScheduleSnapshot = {
  employee_id: number
  first_name: string
  last_name: string
  scheduled_start: string
  scheduled_end: string
  notes: string
}

type ScheduleFormRow = {
  rowKey: string
  /** Empty string or employee id as string */
  employee_id: string
  scheduled_start: string
  scheduled_end: string
  notes: string
}

/**
 * Django `ShiftSession` — returned by `GET/POST` session endpoints and `GET /shifts/`
 * (`shifts_list` uses `_session_to_json`; array order is newest `opened_at` first).
 */
interface ShiftSession {
  id: number
  station_id: number | null
  template_id: number | null
  opened_at: string
  closed_at: string | null
  opened_by_user_id?: number | null
  closed_by_user_id?: number | null
  opening_cash_float: string
  expected_cash_total: string
  closing_cash_counted: string | null
  cash_variance: string
  total_sales_amount: string
  sale_transaction_count: number
  opening_meters?: OpeningMeterSnapshot[] | null
  employee_schedule?: ScheduleSnapshot[] | null
}

export default function ShiftManagementPage() {
  const { timeFormat } = useCompanyLocale()
  const toast = useToast()
  /** Remount template time fields when the modal open payload changes so 12h controls stay in sync. */
  const [templateTimeFieldsKey, setTemplateTimeFieldsKey] = useState(0)
  const [activeSession, setActiveSession] = useState<ShiftSession | null>(null)
  /** All sessions (open + last closed), newest first – from GET /shifts/ */
  const [sessionHistory, setSessionHistory] = useState<ShiftSession[]>([])
  const [templates, setTemplates] = useState<ShiftTemplate[]>([])
  const [stations, setStations] = useState<Station[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<number | null>(null)
  const [selectedStation, setSelectedStation] = useState<number | null>(null)
  const [openingCash, setOpeningCash] = useState('0.00')
  const [allMeters, setAllMeters] = useState<ApiMeter[]>([])
  const [allEmployees, setAllEmployees] = useState<ApiEmployee[]>([])
  /** Editable new reading per meter id when opening a shift (keyed by meter) */
  const [openingMeterReadings, setOpeningMeterReadings] = useState<Record<number, string>>({})
  const [scheduleRows, setScheduleRows] = useState<ScheduleFormRow[]>([])
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
      const [templatesRes, stationsRes, activeRes, sessionsRes, metersRes, employeesRes] = await Promise.all([
        api.get('/shifts/templates/'),
        api.get('/stations/'),
        api.get('/shifts/sessions/active/'),
        api.get('/shifts/', { params: { limit: 100 } }),
        api.get('/meters/'),
        api.get('/employees/'),
      ])

      const list = normalizeTemplates(templatesRes.data)
      setTemplates(list)
      setStations(Array.isArray(stationsRes.data) ? stationsRes.data : [])

      const metersRaw = Array.isArray(metersRes.data) ? metersRes.data : []
      setAllMeters(
        metersRaw.map((m: Record<string, unknown>) => ({
          id: Number(m.id),
          station_id: m.station_id != null ? Number(m.station_id) : null,
          meter_name: String(m.meter_name || m.meter_number || ''),
          dispenser_name: String(m.dispenser_name || ''),
          current_reading: String(m.current_reading ?? '0'),
          is_active: m.is_active !== false,
        })),
      )

      const empRaw = Array.isArray(employeesRes.data) ? employeesRes.data : []
      setAllEmployees(
        empRaw.map((e: Record<string, unknown>) => ({
          id: Number(e.id),
          first_name: String(e.first_name || ''),
          last_name: String(e.last_name || ''),
          is_active: e.is_active !== false,
        })),
      )

      const session = activeRes.data
      setActiveSession(session && typeof session === 'object' ? session : null)

      const historyRaw = sessionsRes.data
      setSessionHistory(Array.isArray(historyRaw) ? (historyRaw as ShiftSession[]) : [])

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
      setAllMeters([])
      setAllEmployees([])
      setActiveSession(null)
      setSessionHistory([])
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadData()
  }, [loadData])

  const stationMeters = useMemo(() => {
    if (selectedStation == null) return []
    return allMeters.filter(
      (m) => m.is_active && m.station_id != null && m.station_id === selectedStation,
    )
  }, [allMeters, selectedStation])

  useEffect(() => {
    if (activeSession) return
    if (selectedStation == null) return
    setOpeningMeterReadings((prev) => {
      const next: Record<number, string> = {}
      for (const m of allMeters) {
        if (!m.is_active) continue
        if (m.station_id == null || m.station_id !== selectedStation) continue
        if (Object.prototype.hasOwnProperty.call(prev, m.id)) {
          next[m.id] = prev[m.id]!
        } else {
          next[m.id] = m.current_reading
        }
      }
      return next
    })
  }, [allMeters, selectedStation, activeSession])

  const canManageTemplates = ['admin', 'super_admin', 'manager'].includes(userRole || '')

  const sessionStationLabel = (id: number | null) => {
    if (id == null) return '—'
    return stations.find((s) => s.id === id)?.station_name ?? `#${id}`
  }
  const sessionTemplateLabel = (id: number | null) => {
    if (id == null) return '—'
    return templates.find((t) => t.id === id)?.name ?? `#${id}`
  }

  const addScheduleRow = () => {
    const tpl = selectedTemplate != null ? templates.find((t) => t.id === selectedTemplate) : null
    const defStart = tpl ? toHhMmString(tpl.start_time) : ''
    const defEnd = tpl ? toHhMmString(tpl.end_time) : ''
    setScheduleRows((rows) => [
      ...rows,
      {
        rowKey: `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        employee_id: '',
        scheduled_start: defStart,
        scheduled_end: defEnd,
        notes: '',
      },
    ])
  }

  const updateScheduleRow = (key: string, patch: Partial<Omit<ScheduleFormRow, 'rowKey'>>) => {
    setScheduleRows((rows) => rows.map((r) => (r.rowKey === key ? { ...r, ...patch } : r)))
  }

  const removeScheduleRow = (key: string) => {
    setScheduleRows((rows) => rows.filter((r) => r.rowKey !== key))
  }

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

    const opening_meters: { meter_id: number; reading: number }[] = []
    for (const m of stationMeters) {
      const raw = (openingMeterReadings[m.id] ?? m.current_reading ?? '0').trim()
      const n = parseFloat(raw)
      if (Number.isNaN(n) || n < 0) {
        toast.error(
          `Enter a valid non-negative meter reading for “${m.meter_name}” (dispenser: ${m.dispenser_name || '—'})`,
        )
        return
      }
      opening_meters.push({ meter_id: m.id, reading: n })
    }

    const schedPayload = scheduleRows
      .filter((r) => r.employee_id.trim() !== '')
      .map((r) => ({
        employee_id: Number(r.employee_id),
        scheduled_start: r.scheduled_start.trim() || null,
        scheduled_end: r.scheduled_end.trim() || null,
        notes: r.notes.trim() || '',
      }))
    const schedIds = schedPayload.map((p) => p.employee_id)
    if (new Set(schedIds).size !== schedIds.length) {
      toast.error('Each employee can only appear once on the schedule for this shift')
      return
    }

    try {
      const response = await api.post('/shifts/sessions/open/', {
        station_id: selectedStation,
        template_id: selectedTemplate,
        opening_cash_float: parseFloat(openingCash),
        opening_meters,
        employee_schedule: schedPayload,
      })
      setActiveSession(response.data)
      toast.success('Shift opened successfully')
      setOpeningCash('0.00')
      setScheduleRows([])
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
    setTemplateTimeFieldsKey((k) => k + 1)
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
    setTemplateTimeFieldsKey((k) => k + 1)
    setTemplateFormData({
      name: template.name,
      start_time: toHhMmString(template.start_time),
      end_time: toHhMmString(template.end_time),
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

            {Array.isArray(activeSession.opening_meters) && activeSession.opening_meters.length > 0 && (
              <div className="bg-white rounded-lg p-4 shadow mb-6">
                <h3 className="text-sm font-bold text-gray-900 mb-2">Opening meter snapshot</h3>
                <div className="overflow-x-auto text-sm">
                  <table className="min-w-full text-left">
                    <thead>
                      <tr className="border-b text-gray-600">
                        <th className="py-1.5 pr-2">Meter</th>
                        <th className="py-1.5 pr-2">Dispenser</th>
                        <th className="py-1.5 pr-2">Previous</th>
                        <th className="py-1.5">At open</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeSession.opening_meters.map((om) => (
                        <tr key={om.meter_id} className="border-b border-gray-100">
                          <td className="py-1.5 pr-2">{om.meter_name}</td>
                          <td className="py-1.5 pr-2 text-gray-600">{om.dispenser_name || '—'}</td>
                          <td className="py-1.5 pr-2">{om.previous_reading}</td>
                          <td className="py-1.5 font-medium text-gray-900">{om.reading}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {Array.isArray(activeSession.employee_schedule) && activeSession.employee_schedule.length > 0 && (
              <div className="bg-white rounded-lg p-4 shadow mb-6">
                <h3 className="text-sm font-bold text-gray-900 mb-2">Planned team (this shift)</h3>
                <div className="overflow-x-auto text-sm">
                  <table className="min-w-full text-left">
                    <thead>
                      <tr className="border-b text-gray-600">
                        <th className="py-1.5 pr-2">Name</th>
                        <th className="py-1.5 pr-2">Start</th>
                        <th className="py-1.5 pr-2">End</th>
                        <th className="py-1.5">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeSession.employee_schedule.map((row) => (
                        <tr
                          key={`${row.employee_id}-${row.scheduled_start}-${row.scheduled_end}`}
                          className="border-b border-gray-100"
                        >
                          <td className="py-1.5 pr-2">
                            {row.first_name} {row.last_name}
                          </td>
                          <td className="py-1.5 pr-2 text-gray-700">
                            {row.scheduled_start
                              ? formatWallClockTime(row.scheduled_start, timeFormat)
                              : '—'}
                          </td>
                          <td className="py-1.5 pr-2 text-gray-700">
                            {row.scheduled_end
                              ? formatWallClockTime(row.scheduled_end, timeFormat)
                              : '—'}
                          </td>
                          <td className="py-1.5 text-gray-600">{row.notes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

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
                          ? ` (${formatWallClockTime(
                              template.start_time,
                              timeFormat,
                            )} – ${formatWallClockTime(template.end_time, timeFormat)})`
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
                {stationMeters.length > 0 && (
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Latest meter readings</label>
                    <p className="text-xs text-gray-500 mb-2">
                      Record the counter at shift start for each pump meter at this station. Values are saved to the
                      system as the new current reading.
                    </p>
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                      {stationMeters.map((m) => (
                        <div
                          key={m.id}
                          className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-center border border-gray-200 rounded-lg p-3 bg-gray-50"
                        >
                          <div>
                            <div className="font-medium text-gray-900">{m.meter_name}</div>
                            <div className="text-xs text-gray-500">
                              Dispenser: {m.dispenser_name || '—'}
                              {m.current_reading != null && m.current_reading !== '' && (
                                <> · Last: {m.current_reading}</>
                              )}
                            </div>
                          </div>
                          <div>
                            <label className="text-xs text-gray-600">Reading *</label>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={openingMeterReadings[m.id] ?? ''}
                              onChange={(e) =>
                                setOpeningMeterReadings((map) => ({
                                  ...map,
                                  [m.id]: e.target.value,
                                }))
                              }
                              className="w-full mt-0.5 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="md:col-span-2">
                  <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
                    <label className="block text-sm font-medium text-gray-700">Employee schedule</label>
                    <button
                      type="button"
                      onClick={addScheduleRow}
                      className="inline-flex items-center gap-1.5 text-sm text-blue-700 font-medium hover:text-blue-900"
                    >
                      <Plus className="h-4 w-4" />
                      Add person
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mb-2">
                    Optional. Who is on this shift. New rows use the selected template’s start/end; change a row only if
                    someone’s planned hours differ (e.g. partial or staggered coverage).
                  </p>
                  {scheduleRows.length === 0 ? (
                    <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg p-3">
                      No rows yet — add team members with “Add person”.
                    </p>
                  ) : (
                    <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                      {scheduleRows.map((row) => (
                        <div
                          key={row.rowKey}
                          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 p-3 border border-gray-200 rounded-lg bg-white"
                        >
                          <div className="sm:col-span-2 lg:col-span-1">
                            <label className="text-xs text-gray-600">Employee *</label>
                            <select
                              value={row.employee_id}
                              onChange={(e) => updateScheduleRow(row.rowKey, { employee_id: e.target.value })}
                              className="w-full mt-0.5 px-2 py-1.5 border rounded-lg text-sm"
                            >
                              <option value="">Select…</option>
                              {allEmployees
                                .filter((e) => e.is_active)
                                .map((e) => {
                                  const taken = scheduleRows.some(
                                    (r) =>
                                      r.rowKey !== row.rowKey && r.employee_id && Number(r.employee_id) === e.id,
                                  )
                                  return (
                                    <option key={e.id} value={e.id} disabled={taken}>
                                      {e.first_name} {e.last_name}
                                    </option>
                                  )
                                })}
                            </select>
                          </div>
                          <div>
                            <label className="text-xs text-gray-600">Start</label>
                            <TimeOfDayInput
                              key={`${row.rowKey}-s-${timeFormat}`}
                              value={row.scheduled_start}
                              onChange={(v) => updateScheduleRow(row.rowKey, { scheduled_start: v })}
                              timeFormat={timeFormat}
                              className="mt-0.5"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-gray-600">End</label>
                            <TimeOfDayInput
                              key={`${row.rowKey}-e-${timeFormat}`}
                              value={row.scheduled_end}
                              onChange={(v) => updateScheduleRow(row.rowKey, { scheduled_end: v })}
                              timeFormat={timeFormat}
                              className="mt-0.5"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-gray-600">Notes</label>
                            <input
                              type="text"
                              value={row.notes}
                              onChange={(e) => updateScheduleRow(row.rowKey, { notes: e.target.value })}
                              className="w-full mt-0.5 px-2 py-1.5 border rounded-lg text-sm"
                            />
                          </div>
                          <div className="flex items-end justify-end">
                            <button
                              type="button"
                              onClick={() => removeScheduleRow(row.rowKey)}
                              className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                              title="Remove"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
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
          <div className="mb-4 flex items-center gap-3">
            <div className="shrink-0 rounded-lg bg-gray-100 p-2 text-gray-700">
              <History className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Shift history</h2>
              <p className="text-sm text-gray-500">Recent sessions, newest first (up to 100).</p>
            </div>
          </div>
          {sessionHistory.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">No shift sessions yet for this company.</p>
          ) : (
            <div className="-mx-1 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-gray-600">
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Opened</th>
                    <th className="py-2 pr-3">Closed</th>
                    <th className="py-2 pr-3">Station</th>
                    <th className="py-2 pr-3">Template</th>
                    <th className="py-2 pr-3 text-right">Sales</th>
                    <th className="py-2 pr-3 text-right">Txns</th>
                    <th className="py-2 text-right">Cash variance</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionHistory.map((s) => {
                    const isOpen = s.closed_at == null
                    return (
                      <tr key={s.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/80">
                        <td className="py-2 pr-3">
                          {isOpen ? (
                            <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">
                              Open
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                              Closed
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap py-2 pr-3">{formatDate(s.opened_at, true)}</td>
                        <td className="whitespace-nowrap py-2 pr-3 text-gray-700">
                          {s.closed_at ? formatDate(s.closed_at, true) : '—'}
                        </td>
                        <td className="py-2 pr-3">{sessionStationLabel(s.station_id)}</td>
                        <td className="py-2 pr-3">{sessionTemplateLabel(s.template_id)}</td>
                        <td className="py-2 pr-3 text-right font-medium text-gray-900">
                          {formatCurrency(Number(s.total_sales_amount || 0))}
                        </td>
                        <td className="py-2 pr-3 text-right text-gray-800">{s.sale_transaction_count ?? 0}</td>
                        <td
                          className={`py-2 text-right font-medium ${
                            isOpen
                              ? 'text-gray-400'
                              : Number(s.cash_variance) >= 0
                                ? 'text-green-600'
                                : 'text-red-600'
                          }`}
                        >
                          {isOpen ? '—' : formatCurrency(Number(s.cash_variance || 0))}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-4 text-xs text-gray-400">Dated summaries: Reports → Shift summary.</p>
        </div>

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
                        {formatWallClockTime(template.start_time, timeFormat)} –{' '}
                        {formatWallClockTime(template.end_time, timeFormat)}
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
                      <TimeOfDayInput
                        key={`tmpl-s-${templateTimeFieldsKey}-${timeFormat}`}
                        value={templateFormData.start_time}
                        onChange={(v) => setTemplateFormData((p) => ({ ...p, start_time: v }))}
                        timeFormat={timeFormat}
                        className="w-full text-sm focus-within:ring-2 focus-within:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">End time</label>
                      <TimeOfDayInput
                        key={`tmpl-e-${templateTimeFieldsKey}-${timeFormat}`}
                        value={templateFormData.end_time}
                        onChange={(v) => setTemplateFormData((p) => ({ ...p, end_time: v }))}
                        timeFormat={timeFormat}
                        className="w-full text-sm focus-within:ring-2 focus-within:ring-blue-500"
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

      </div>
    </div>
  )
}
