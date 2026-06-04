'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import {
  Loader2,
  Plus,
  Trash2,
  MapPin,
  Tag,
  Fish,
  Fuel,
  Info,
  Layers,
} from 'lucide-react'
import { useToast } from '@/components/Toast'
import { useCompany } from '@/contexts/CompanyContext'
import api, { isSuperAdminRole, isTenantAdminRole } from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { connectionErrorUserMessage, isConnectionError } from '@/utils/connectionError'
import type { ReportStationForSegment } from '@/app/reports/reportBusinessSegment'
import { formatPondScopeKey } from '@/app/reports/reportSiteScope'
import {
  applicationForScope,
  applicationLabel,
  kindLabel,
  scopeContextBlurb,
  scopeDisplayLabel,
  suggestCategoryCodeFromLabel,
  validateCategoryCodeClient,
  groupReportingMapTargets,
  type ReportingApplication,
  type ReportingKind,
  type ReportingMapTarget,
} from './reportingCategoriesScope'

interface CategoryRow {
  id: number
  application: ReportingApplication
  kind: ReportingKind
  code: string
  label: string
  maps_to_code: string
  is_active: boolean
  sort_order: number
}

const SCOPE_STORAGE_KEY = 'fserp_reporting_categories_scope'

const SELECT_CLASS =
  'min-w-[16rem] rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30'

function readIsReportingCategoriesAdmin(): boolean {
  try {
    const raw = localStorage.getItem('user')
    if (!raw) return false
    const u = JSON.parse(raw) as { role?: string; company_id?: number; permissions?: string[] }
    if (isSuperAdminRole(u.role)) return true
    if (isTenantAdminRole(u.role) && u.company_id) return true
    if (Array.isArray(u.permissions) && (u.permissions.includes('*') || u.permissions.includes('app.settings')))
      return true
  } catch {
    /* ignore */
  }
  return false
}

function readUserIsSuperAdmin(): boolean {
  try {
    const raw = localStorage.getItem('user')
    if (!raw) return false
    const u = JSON.parse(raw) as { role?: string }
    return isSuperAdminRole(u.role)
  } catch {
    return false
  }
}

function formatReportingCategoriesError(error: unknown, fallback: string): string {
  if (isConnectionError(error)) {
    return connectionErrorUserMessage(
      error,
      'Could not reach the API. Deploy the latest backend, run `python manage.py migrate`, and confirm the API URL and CORS settings.'
    )
  }
  const status = (error as { response?: { status?: number } })?.response?.status
  if (status === 404) {
    return 'Reporting categories API is not on this server. Deploy the latest backend and restart Django.'
  }
  if (status === 503) {
    return extractErrorMessage(error, 'Database upgrade required — run migrations on the server.')
  }
  if (status === 403) {
    return extractErrorMessage(
      error,
      'Permission denied or company not selected. Choose a company in the header if you are a platform admin.'
    )
  }
  return extractErrorMessage(error, fallback)
}

function ApplicationBadge({ app }: { app: ReportingApplication }) {
  const isFuel = app === 'fuel_station'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        isFuel ? 'bg-amber-100 text-amber-900' : 'bg-cyan-100 text-cyan-900'
      }`}
    >
      {isFuel ? <Fuel className="h-3 w-3" /> : <Fish className="h-3 w-3" />}
      {applicationLabel(app)}
    </span>
  )
}

export default function ReportingCategoriesPage() {
  const router = useRouter()
  const toast = useToast()
  const { selectedCompany, isClientReady } = useCompany()
  const [authReady, setAuthReady] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [stationsLoading, setStationsLoading] = useState(true)
  const [rows, setRows] = useState<CategoryRow[]>([])
  const [mapTargets, setMapTargets] = useState<ReportingMapTarget[]>([])
  const [stations, setStations] = useState<ReportStationForSegment[]>([])
  const [ponds, setPonds] = useState<{ id: number; name: string }[]>([])
  const [aquacultureEnabled, setAquacultureEnabled] = useState<boolean | null>(null)
  const [scopeKey, setScopeKey] = useState('')
  const [kind, setKind] = useState<ReportingKind>('expense')
  const [form, setForm] = useState({
    code: '',
    label: '',
    maps_to_code: '',
    sort_order: '0',
  })
  const [codeManuallyEdited, setCodeManuallyEdited] = useState(false)

  const needsCompanyPick = isSuperAdmin && isClientReady && !selectedCompany?.id
  const canCallApi = isAdmin && !needsCompanyPick
  const resolvedApplication = useMemo(
    () => applicationForScope(scopeKey, stations),
    [scopeKey, stations]
  )
  const scopeLabel = useMemo(
    () => scopeDisplayLabel(scopeKey, stations, ponds),
    [scopeKey, stations, ponds]
  )
  const contextBlurb = useMemo(() => scopeContextBlurb(scopeKey, stations), [scopeKey, stations])
  const showPonds = aquacultureEnabled !== false && ponds.length > 0

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    setIsAdmin(readIsReportingCategoriesAdmin())
    setIsSuperAdmin(readUserIsSuperAdmin())
    try {
      const saved = localStorage.getItem(SCOPE_STORAGE_KEY)?.trim()
      if (saved != null) setScopeKey(saved)
    } catch {
      /* ignore */
    }
    setAuthReady(true)
  }, [router])

  useEffect(() => {
    if (!canCallApi) {
      setStationsLoading(false)
      return
    }
    let cancelled = false
    setStationsLoading(true)
    Promise.allSettled([
      api.get<{ id: number; station_name: string; operates_fuel_retail?: boolean }[]>('/stations/'),
      api.get<{ id: number; name: string }[]>('/aquaculture/ponds/'),
      api.get<{ aquaculture_enabled?: boolean }>('/companies/current'),
    ]).then(([stRes, pondRes, coRes]) => {
      if (cancelled) return
      if (stRes.status === 'fulfilled') {
        const raw = Array.isArray(stRes.value.data) ? stRes.value.data : []
        setStations(
          raw.map((s) => ({
            id: s.id,
            station_name: (s.station_name || `Station ${s.id}`).trim(),
            operates_fuel_retail: s.operates_fuel_retail !== false,
          }))
        )
      } else {
        setStations([])
      }
      if (pondRes.status === 'fulfilled') {
        const raw = Array.isArray(pondRes.value.data) ? pondRes.value.data : []
        setPonds(raw.filter((p) => Number.isFinite(p.id)).map((p) => ({ id: p.id, name: p.name || `Pond ${p.id}` })))
      } else {
        setPonds([])
      }
      if (coRes.status === 'fulfilled') {
        setAquacultureEnabled(coRes.value.data?.aquaculture_enabled !== false)
      } else {
        setAquacultureEnabled(null)
      }
      setStationsLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [canCallApi, selectedCompany?.id])

  const onScopeChange = (value: string) => {
    setScopeKey(value)
    try {
      if (value) localStorage.setItem(SCOPE_STORAGE_KEY, value)
      else localStorage.removeItem(SCOPE_STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }

  const onLabelChange = (label: string) => {
    setForm((f) => {
      const next = { ...f, label }
      if (!codeManuallyEdited) {
        next.code = suggestCategoryCodeFromLabel(label)
      }
      return next
    })
  }

  const onCodeChange = (code: string) => {
    setCodeManuallyEdited(true)
    setForm((f) => ({ ...f, code }))
  }

  const resetCreateForm = () => {
    setCodeManuallyEdited(false)
    setForm({ code: '', label: '', maps_to_code: '', sort_order: '0' })
  }

  const codePreview = useMemo(
    () => suggestCategoryCodeFromLabel(form.label),
    [form.label]
  )
  const codeValidation = useMemo(
    () => validateCategoryCodeClient(form.code.trim() || codePreview),
    [form.code, codePreview]
  )

  const loadTargets = useCallback(async () => {
    if (!canCallApi || resolvedApplication == null) {
      setMapTargets([])
      return
    }
    try {
      const { data } = await api.get<{ map_targets: ReportingMapTarget[] }>('/reporting-categories/map-targets/', {
        params: { application: resolvedApplication, kind },
      })
      setMapTargets(Array.isArray(data?.map_targets) ? data.map_targets : [])
    } catch (e) {
      setMapTargets([])
      toast.error(formatReportingCategoriesError(e, 'Could not load rollup options'))
    }
  }, [resolvedApplication, kind, canCallApi, toast])

  const loadRows = useCallback(async () => {
    if (!canCallApi) {
      setLoading(false)
      setRows([])
      return
    }
    setLoading(true)
    try {
      const params: Record<string, string> = { kind }
      if (resolvedApplication) params.application = resolvedApplication
      const { data } = await api.get<CategoryRow[]>('/reporting-categories/', { params })
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      toast.error(formatReportingCategoriesError(e, 'Could not load categories'))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [resolvedApplication, kind, canCallApi, toast])

  useEffect(() => {
    if (!authReady || !canCallApi) return
    void loadTargets()
  }, [authReady, canCallApi, loadTargets])

  useEffect(() => {
    if (!authReady) return
    void loadRows()
  }, [authReady, loadRows])

  const onCreate = async () => {
    if (!canCallApi) {
      toast.error('Select a company in the header before creating categories.')
      return
    }
    if (resolvedApplication == null) {
      toast.error('Choose a station or pond (not All) before adding a category.')
      return
    }
    if (!form.label.trim() || !form.maps_to_code) {
      toast.error('Display name and rollup are required.')
      return
    }
    const finalCode = (form.code.trim() || codePreview).trim()
    const codeErr = validateCategoryCodeClient(finalCode)
    if (codeErr) {
      toast.error(codeErr)
      return
    }
    try {
      await api.post('/reporting-categories/', {
        application: resolvedApplication,
        kind,
        code: finalCode,
        label: form.label.trim(),
        maps_to_code: form.maps_to_code,
        sort_order: Number(form.sort_order) || 0,
        is_active: true,
      })
      toast.success('Category created')
      resetCreateForm()
      await loadRows()
    } catch (e) {
      toast.error(formatReportingCategoriesError(e, 'Create failed'))
    }
  }

  const onDelete = async (id: number) => {
    if (!window.confirm('Delete this company-defined category?')) return
    try {
      await api.delete(`/reporting-categories/${id}/`)
      toast.success('Deleted')
      await loadRows()
    } catch (e) {
      toast.error(formatReportingCategoriesError(e, 'Delete failed'))
    }
  }

  const groupedMapTargets = useMemo(() => groupReportingMapTargets(mapTargets), [mapTargets])
  const selectedMapTarget = useMemo(
    () => mapTargets.find((m) => m.id === form.maps_to_code),
    [mapTargets, form.maps_to_code]
  )

  const rollupLabel = (code: string) => {
    const hit = mapTargets.find((m) => m.id === code)
    return hit ? hit.label : code.replace(/_/g, ' ')
  }

  if (!authReady) {
    return (
      <div className="flex min-h-screen bg-slate-50">
        <Sidebar />
        <main className="flex flex-1 items-center justify-center p-6 text-slate-600">
          <Loader2 className="h-6 w-6 animate-spin" />
        </main>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen bg-slate-50">
        <Sidebar />
        <main className="flex-1 p-6">
          <h1 className="text-xl font-semibold text-slate-800">Reporting categories</h1>
          <p className="mt-2 text-slate-600">Only company administrators can manage reporting categories.</p>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          <header>
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-slate-900 p-2.5 text-white shadow-sm">
                <Layers className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Reporting categories</h1>
                <p className="text-sm text-slate-600">
                  Custom income and expense labels that roll up to built-in P&amp;L types
                </p>
              </div>
            </div>
          </header>

          {needsCompanyPick && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              Select a <strong>company</strong> in the header switcher before managing categories.
            </div>
          )}

          {/* Business context — same grouped pattern as Reports → Site */}
          <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-start gap-2 text-sm text-slate-600">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div>
                  <p className="font-medium text-slate-800">Business context</p>
                  <p className="mt-1 text-slate-500">{contextBlurb}</p>
                </div>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-slate-700" htmlFor="rc-business-scope">
                    Application
                  </label>
                  <select
                    id="rc-business-scope"
                    aria-label="Filter categories by station, pond, or all sites"
                    value={scopeKey}
                    onChange={(e) => onScopeChange(e.target.value)}
                    disabled={!canCallApi || stationsLoading}
                    className={SELECT_CLASS}
                  >
                    <option value="">All</option>
                    {stations.length > 0 ? (
                      <optgroup label="Stations">
                        {stations.map((s) => (
                          <option key={s.id} value={String(s.id)}>
                            {s.station_name}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    {showPonds ? (
                      <optgroup label="Ponds">
                        {ponds.map((p) => (
                          <option key={`pond-${p.id}`} value={formatPondScopeKey(p.id)}>
                            {p.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                  </select>
                  <p className="text-xs text-slate-500">
                    {scopeKey ? (
                      <>
                        Managing <span className="font-medium text-slate-700">{scopeLabel}</span>
                        {resolvedApplication ? (
                          <> · {applicationLabel(resolvedApplication)}</>
                        ) : null}
                      </>
                    ) : (
                      'Showing categories for all applications'
                    )}
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-slate-700">Kind</span>
                  <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
                    {(['expense', 'income'] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        disabled={!canCallApi}
                        onClick={() => setKind(k)}
                        className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
                          kind === k
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'bg-transparent text-slate-700 hover:bg-white/80 hover:text-slate-900'
                        } disabled:opacity-50`}
                      >
                        {kindLabel(k)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Add form — only when a specific application is resolved */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex items-center gap-2">
              <Tag className="h-5 w-5 text-slate-600" />
              <h2 className="text-lg font-semibold text-slate-900">Add category</h2>
            </div>
            {resolvedApplication == null ? (
              <p className="mt-3 flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                Select a <strong>station</strong> or <strong>pond</strong> above to add a new category. Use{' '}
                <strong>All</strong> to review everything across the company.
              </p>
            ) : (
              <>
                <p className="mt-2 text-sm text-slate-500">
                  New {kindLabel(kind).toLowerCase()} category for{' '}
                  <span className="font-medium text-slate-700">{applicationLabel(resolvedApplication)}</span>
                  {' · '}
                  {scopeLabel}
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 sm:col-span-2">
                    Display name
                    <span className="font-normal text-slate-500">
                      What users see in dropdowns — e.g. &quot;Site security&quot; or &quot;Pond aeration&quot;
                    </span>
                    <input
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      value={form.label}
                      onChange={(e) => onLabelChange(e.target.value)}
                      disabled={!canCallApi}
                      placeholder="Site security"
                    />
                  </label>
                  <div className="flex flex-col gap-1 text-xs font-medium text-slate-600 sm:col-span-2">
                    <span>Internal code</span>
                    <span className="font-normal text-slate-500">
                      A short machine ID saved in the database (like a SKU). We fill this from the display name —
                      you only need to change it if you want a specific ID.
                    </span>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <input
                        className="min-w-[12rem] flex-1 rounded-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        value={form.code}
                        onChange={(e) => onCodeChange(e.target.value)}
                        disabled={!canCallApi}
                        placeholder={codePreview || 'site_security'}
                        aria-describedby="rc-code-hint"
                      />
                      {!codeManuallyEdited && form.label.trim() && codePreview ? (
                        <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800">
                          Auto
                        </span>
                      ) : null}
                      {codeManuallyEdited && form.label.trim() && codePreview !== form.code ? (
                        <button
                          type="button"
                          className="shrink-0 text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline"
                          onClick={() => {
                            setCodeManuallyEdited(false)
                            setForm((f) => ({ ...f, code: suggestCategoryCodeFromLabel(f.label) }))
                          }}
                        >
                          Reset to suggested
                        </button>
                      ) : null}
                    </div>
                    <p id="rc-code-hint" className="mt-1 font-normal text-slate-500">
                      {form.label.trim() ? (
                        <>
                          Example: &quot;{form.label.trim()}&quot; →{' '}
                          <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-slate-800">
                            {codePreview || '…'}
                          </code>
                        </>
                      ) : (
                        <>Type a display name first — the code will be suggested automatically.</>
                      )}
                    </p>
                    {codeValidation && form.label.trim() ? (
                      <p className="font-normal text-amber-700">{codeValidation}</p>
                    ) : null}
                  </div>
                  <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 sm:col-span-2">
                    Rolls up to
                    <span className="font-normal text-slate-500">
                      Which built-in P&amp;L bucket this label counts under — grouped by how reports and GL treat
                      each type
                    </span>
                    <select
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      value={form.maps_to_code}
                      onChange={(e) => setForm((f) => ({ ...f, maps_to_code: e.target.value }))}
                      disabled={!canCallApi}
                    >
                      <option value="">— select rollup —</option>
                      {groupedMapTargets.map(({ group, items }) => (
                        <optgroup key={group || 'default'} label={group}>
                          {items.map((m) => (
                            <option key={m.id} value={m.id} title={m.hint || undefined}>
                              {m.label}
                              {m.coa_code ? ` (${m.coa_code})` : ''}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    {selectedMapTarget?.hint ? (
                      <p className="mt-1 flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 font-normal text-slate-600">
                        <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                        <span>{selectedMapTarget.hint}</span>
                      </p>
                    ) : null}
                    {selectedMapTarget?.non_biological_sale ? (
                      <p className="font-normal text-slate-500">
                        Non-biological sale — does not reduce implied fish kg/count in stock position reports.
                      </p>
                    ) : null}
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                    Sort order
                    <span className="font-normal text-slate-400">Optional — lower numbers appear first in lists</span>
                    <input
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      value={form.sort_order}
                      onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
                      disabled={!canCallApi}
                      inputMode="numeric"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => void onCreate()}
                  disabled={!canCallApi}
                >
                  <Plus className="h-4 w-4" />
                  Create category
                </button>
              </>
            )}
          </section>

          {/* List */}
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
              <h2 className="text-lg font-semibold text-slate-900">
                {kindLabel(kind)} categories
                {scopeKey ? ` · ${scopeLabel}` : ' · All sites'}
              </h2>
              {!loading && rows.length > 0 ? (
                <span className="text-sm text-slate-500">{rows.length} defined</span>
              ) : null}
            </div>
            {needsCompanyPick ? (
              <p className="p-6 text-sm text-slate-600">Choose a company to load categories.</p>
            ) : loading || stationsLoading ? (
              <div className="flex items-center gap-2 p-8 text-slate-600">
                <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                Loading categories…
              </div>
            ) : rows.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <Tag className="mx-auto h-10 w-10 text-slate-300" />
                <p className="mt-3 text-sm font-medium text-slate-700">No custom categories yet</p>
                <p className="mt-1 text-sm text-slate-500">
                  {resolvedApplication
                    ? 'Add one above, or switch kind / context.'
                    : 'Select a station or pond to add categories, or try the other kind.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead className="bg-slate-50/80">
                    <tr>
                      {resolvedApplication == null ? (
                        <th className="px-4 py-3 text-left font-medium text-slate-600 sm:px-5">Application</th>
                      ) : null}
                      <th className="px-4 py-3 text-left font-medium text-slate-600 sm:px-5">Code</th>
                      <th className="px-4 py-3 text-left font-medium text-slate-600 sm:px-5">Label</th>
                      <th className="px-4 py-3 text-left font-medium text-slate-600 sm:px-5">Rolls up to</th>
                      <th className="px-4 py-3 text-right font-medium text-slate-600 sm:px-5">Order</th>
                      <th className="px-4 py-3 text-right font-medium text-slate-600 sm:px-5">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {rows.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50/60">
                        {resolvedApplication == null ? (
                          <td className="whitespace-nowrap px-4 py-3 sm:px-5">
                            <ApplicationBadge app={r.application} />
                          </td>
                        ) : null}
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-slate-900 sm:px-5">{r.code}</td>
                        <td className="px-4 py-3 text-slate-800 sm:px-5">{r.label}</td>
                        <td className="px-4 py-3 text-slate-600 sm:px-5">
                          <span className="font-mono text-xs text-slate-500">{r.maps_to_code}</span>
                          <span className="mx-1 text-slate-300">·</span>
                          {rollupLabel(r.maps_to_code)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600 sm:px-5">
                          {r.sort_order}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right sm:px-5">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                            onClick={() => void onDelete(r.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <footer className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500 shadow-sm">
            <p className="font-medium text-slate-700">Where these appear</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>
                <strong>Aquaculture</strong> — pond expenses, fish sales, and vendor bill lines tagged to ponds
              </li>
              <li>
                <strong>Fuel station</strong> — optional tags on{' '}
                <Link href="/journal-entries" className="text-blue-600 hover:underline">
                  manual journal lines
                </Link>{' '}
                and fuel expense rollups on{' '}
                <Link href="/bills" className="text-blue-600 hover:underline">
                  vendor bills
                </Link>
              </li>
            </ul>
          </footer>
        </div>
      </main>
    </div>
  )
}
