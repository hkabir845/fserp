'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import PageLayout from '@/components/PageLayout'
import { ErpPageShell } from '@/components/aquaculture/ErpPageShell'
import { usePageMeta } from '@/hooks/usePageMeta'
import {
  Loader2,
  Plus,
  Trash2,
  Edit2,
  X,
  MapPin,
  Tag,
  Fish,
  Fuel,
  Info,
  Layers,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react'
import { useToast } from '@/components/Toast'
import { useCompany } from '@/contexts/CompanyContext'
import api, { isSuperAdminRole, isTenantAdminRole } from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { connectionErrorUserMessage, isConnectionError } from '@/utils/connectionError'
import type { ReportStationForSegment } from '@/app/reports/reportBusinessSegment'
import { parseReportSiteScopeKey } from '@/app/reports/reportSiteScope'
import {
  applicationForScope,
  applicationLabel,
  kindLabel,
  scopeContextBlurb,
  scopeDisplayLabel,
  type ReportingApplication,
  type ReportingKind,
  type ReportingMapTarget,
} from './reportingCategoriesScope'
import { entityScopeKeyFromCategoryRow, countBusinessEntities, formatEntityCountSummary, entityScopeParamsFromKey } from '@/lib/billLineEntity'
import { BillLineEntitySelect } from '@/components/bills/BillLineEntitySelect'
import { ReportingMapTargetCombobox } from '@/components/reference/ReportingMapTargetCombobox'

interface CategoryRow {
  id: number
  application: ReportingApplication
  kind: ReportingKind
  code: string
  label: string
  maps_to_code: string
  station_id?: number | null
  station_name?: string | null
  aquaculture_pond_id?: number | null
  pond_name?: string | null
  head_office_only?: boolean | null
  is_active: boolean
  sort_order: number
}

interface TaggingOptionRow {
  id: string
  label: string
  tenant_defined?: boolean
  maps_to_code?: string | null
  bill_create_allowed?: boolean
}

const SCOPE_STORAGE_KEY = 'fserp_reporting_categories_scope'

const SELECT_CLASS =
  'min-w-[16rem] rounded-md border border-border bg-white px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/30'

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
        isFuel ? 'bg-amber-100 text-warning-foreground' : 'bg-cyan-100 text-cyan-900'
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
  const pageMeta = usePageMeta()
  const { selectedCompany, isClientReady } = useCompany()
  const [authReady, setAuthReady] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [stationsLoading, setStationsLoading] = useState(true)
  const [rows, setRows] = useState<CategoryRow[]>([])
  const [taggingOptions, setTaggingOptions] = useState<TaggingOptionRow[]>([])
  const [taggingLoading, setTaggingLoading] = useState(false)
  const [mapTargets, setMapTargets] = useState<ReportingMapTarget[]>([])
  const [stations, setStations] = useState<ReportStationForSegment[]>([])
  const [ponds, setPonds] = useState<{ id: number; name: string }[]>([])
  const [aquacultureEnabled, setAquacultureEnabled] = useState<boolean | null>(null)
  const [scopeKey, setScopeKey] = useState('')
  const [kind, setKind] = useState<ReportingKind>('expense')
  const [form, setForm] = useState({
    label: '',
    maps_to_code: '',
    sort_order: '0',
    is_active: true,
    entity_scope_key: '',
  })
  const [editingRow, setEditingRow] = useState<CategoryRow | null>(null)
  const [formSaving, setFormSaving] = useState(false)

  const needsCompanyPick = isSuperAdmin && isClientReady && !selectedCompany?.id
  const canCallApi = isAdmin && !needsCompanyPick
  const resolvedApplication = useMemo(
    () => applicationForScope(scopeKey, stations),
    [scopeKey, stations]
  )
  const scopeLabel = useMemo(
    () => scopeDisplayLabel(scopeKey, stations, ponds, selectedCompany?.name),
    [scopeKey, stations, ponds, selectedCompany?.name]
  )
  const entityCounts = useMemo(
    () => countBusinessEntities(stations, ponds),
    [stations, ponds]
  )
  const entityCountLabel = useMemo(() => formatEntityCountSummary(entityCounts), [entityCounts])
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
      api.get<
        {
          id: number
          station_name: string
          station_number?: string
          operates_fuel_retail?: boolean
          is_active?: boolean
        }[]
      >('/stations/'),
      api.get<
        { id: number; name: string; pond_role?: string; is_active?: boolean }[]
      >('/aquaculture/ponds/'),
      api.get<{ aquaculture_enabled?: boolean }>('/companies/current'),
    ]).then(([stRes, pondRes, coRes]) => {
      if (cancelled) return
      if (stRes.status === 'fulfilled') {
        const raw = Array.isArray(stRes.value.data) ? stRes.value.data : []
        setStations(
          raw.map((s) => ({
            id: s.id,
            station_name: (s.station_name || `Station ${s.id}`).trim(),
            station_number: s.station_number != null ? String(s.station_number) : undefined,
            operates_fuel_retail: s.operates_fuel_retail === false ? false : true,
            is_active: s.is_active !== false,
          }))
        )
      } else {
        setStations([])
      }
      if (pondRes.status === 'fulfilled') {
        const raw = Array.isArray(pondRes.value.data) ? pondRes.value.data : []
        setPonds(
          raw
            .filter((p) => Number.isFinite(p.id))
            .map((p) => ({
              id: p.id,
              name: p.name || `Pond ${p.id}`,
              pond_role: p.pond_role != null ? String(p.pond_role) : undefined,
              is_active: p.is_active !== false,
            })),
        )
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
    setForm((f) => ({ ...f, label }))
  }

  const formApplication = editingRow?.application ?? resolvedApplication
  const formKind = editingRow?.kind ?? kind
  const formVisible = editingRow != null || resolvedApplication != null

  const resetForm = () => {
    setForm({ label: '', maps_to_code: '', sort_order: '0', is_active: true, entity_scope_key: scopeKey })
  }

  const loadTargets = useCallback(async () => {
    if (!canCallApi || formApplication == null) {
      setMapTargets([])
      return
    }
    try {
      const { data } = await api.get<{ map_targets: ReportingMapTarget[] }>('/reporting-categories/map-targets/', {
        params: { application: formApplication, kind: formKind },
      })
      setMapTargets(Array.isArray(data?.map_targets) ? data.map_targets : [])
    } catch (e) {
      setMapTargets([])
      toast.error(formatReportingCategoriesError(e, 'Could not load rollup options'))
    }
  }, [formApplication, formKind, canCallApi, toast])

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
      Object.assign(params, entityScopeParamsFromKey(scopeKey))
      const { data } = await api.get<CategoryRow[]>('/reporting-categories/', { params })
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      toast.error(formatReportingCategoriesError(e, 'Could not load categories'))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [resolvedApplication, kind, canCallApi, toast])

  const loadTaggingOptions = useCallback(async () => {
    if (!canCallApi || !resolvedApplication) {
      setTaggingOptions([])
      return
    }
    setTaggingLoading(true)
    try {
      const { data } = await api.get<{ options: TaggingOptionRow[] }>(
        '/reporting-categories/tagging-options/',
        { params: { application: resolvedApplication, kind, ...entityScopeParamsFromKey(scopeKey) } },
      )
      setTaggingOptions(Array.isArray(data?.options) ? data.options : [])
    } catch (e) {
      setTaggingOptions([])
      toast.error(formatReportingCategoriesError(e, 'Could not load tagging options'))
    } finally {
      setTaggingLoading(false)
    }
  }, [resolvedApplication, kind, canCallApi, toast])

  useEffect(() => {
    if (!authReady || !canCallApi) return
    void loadTargets()
  }, [authReady, canCallApi, loadTargets])

  useEffect(() => {
    setEditingRow(null)
    resetForm()
  }, [kind, scopeKey])

  useEffect(() => {
    if (editingRow) return
    setForm((f) => ({ ...f, entity_scope_key: scopeKey }))
  }, [scopeKey, editingRow])

  useEffect(() => {
    if (!authReady) return
    void loadRows()
  }, [authReady, loadRows])

  useEffect(() => {
    if (!authReady) return
    void loadTaggingOptions()
  }, [authReady, loadTaggingOptions])

  const groupedTaggingOptions = useMemo(() => {
    const rows =
      resolvedApplication === 'aquaculture' && kind === 'expense'
        ? taggingOptions.filter((o) => o.bill_create_allowed !== false)
        : taggingOptions
    const standard = rows.filter((o) => !o.tenant_defined)
    const custom = rows.filter((o) => o.tenant_defined)
    return { standard, custom }
  }, [taggingOptions, resolvedApplication, kind])

  const entityPayloadFromScopeKey = (key: string) => {
    const scope = parseReportSiteScopeKey(key)
    if (scope.kind === 'station') {
      return { station_id: scope.id, aquaculture_pond_id: null, head_office_only: false }
    }
    if (scope.kind === 'pond') {
      return { station_id: null, aquaculture_pond_id: scope.id, head_office_only: false }
    }
    if (scope.kind === 'head_office') {
      return { station_id: null, aquaculture_pond_id: null, head_office_only: true }
    }
    return { station_id: null, aquaculture_pond_id: null, head_office_only: false }
  }

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
    setFormSaving(true)
    try {
      await api.post('/reporting-categories/', {
        application: resolvedApplication,
        kind,
        label: form.label.trim(),
        maps_to_code: form.maps_to_code,
        sort_order: Number(form.sort_order) || 0,
        is_active: true,
        ...entityPayloadFromScopeKey(form.entity_scope_key),
      })
      toast.success('Category created')
      resetForm()
      await Promise.all([loadRows(), loadTaggingOptions()])
    } catch (e) {
      toast.error(formatReportingCategoriesError(e, 'Create failed'))
    } finally {
      setFormSaving(false)
    }
  }

  const onDelete = async (id: number) => {
    if (!window.confirm('Delete this company-defined category?')) return
    try {
      await api.delete(`/reporting-categories/${id}/`)
      if (editingRow?.id === id) closeEdit()
      toast.success('Deleted')
      await Promise.all([loadRows(), loadTaggingOptions()])
    } catch (e) {
      toast.error(formatReportingCategoriesError(e, 'Delete failed'))
    }
  }

  const openEdit = (row: CategoryRow) => {
    setEditingRow(row)
    setForm({
      label: row.label,
      maps_to_code: row.maps_to_code,
      sort_order: String(row.sort_order),
      is_active: row.is_active,
      entity_scope_key: entityScopeKeyFromCategoryRow(row),
    })
    document.getElementById('rc-category-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const closeEdit = () => {
    setEditingRow(null)
    resetForm()
  }

  const onUpdate = async () => {
    if (!editingRow) return
    if (!form.label.trim() || !form.maps_to_code) {
      toast.error('Display name and rollup are required.')
      return
    }
    setFormSaving(true)
    try {
      const { data } = await api.put(`/reporting-categories/${editingRow.id}/`, {
        label: form.label.trim(),
        maps_to_code: form.maps_to_code,
        sort_order: Number(form.sort_order) || 0,
        is_active: form.is_active,
        ...entityPayloadFromScopeKey(form.entity_scope_key),
      })
      const propagation = data?.propagation as
        | {
            bill_lines_linked?: number
            bill_lines_updated?: number
            bills_resynced?: number
            journal_lines_updated?: number
            aquaculture_expenses_resynced?: number
          }
        | undefined
      if (propagation && Object.values(propagation).some((n) => Number(n) > 0)) {
        const parts: string[] = []
        if (propagation.bill_lines_linked) parts.push(`${propagation.bill_lines_linked} bill line(s) linked`)
        if (propagation.bills_resynced) parts.push(`${propagation.bills_resynced} posted bill journal(s) refreshed`)
        if (propagation.journal_lines_updated) parts.push(`${propagation.journal_lines_updated} journal line(s) updated`)
        if (propagation.aquaculture_expenses_resynced) {
          parts.push(`${propagation.aquaculture_expenses_resynced} pond expense journal(s) refreshed`)
        }
        toast.success(
          parts.length ? `Category updated — ${parts.join('; ')}.` : 'Category updated — linked records refreshed.'
        )
      } else {
        toast.success('Category updated')
      }
      closeEdit()
      await Promise.all([loadRows(), loadTaggingOptions()])
    } catch (e) {
      toast.error(formatReportingCategoriesError(e, 'Update failed'))
    } finally {
      setFormSaving(false)
    }
  }

  const onSubmitForm = async () => {
    if (editingRow) await onUpdate()
    else await onCreate()
  }

  const onToggleActive = async (row: CategoryRow) => {
    try {
      await api.put(`/reporting-categories/${row.id}/`, { is_active: !row.is_active })
      toast.success(row.is_active ? 'Category deactivated' : 'Category activated')
      await Promise.all([loadRows(), loadTaggingOptions()])
    } catch (e) {
      toast.error(formatReportingCategoriesError(e, 'Update failed'))
    }
  }

  const selectedMapTarget = useMemo(
    () => mapTargets.find((m) => m.id === form.maps_to_code),
    [mapTargets, form.maps_to_code]
  )

  const rollupLabel = (code: string) => {
    const hit = mapTargets.find((m) => m.id === code)
    return hit ? hit.label : code.replace(/_/g, ' ')
  }

  const entityLabel = (row: CategoryRow) => {
    if (row.aquaculture_pond_id) return row.pond_name || `Pond #${row.aquaculture_pond_id}`
    if (row.station_id) return row.station_name || `Station #${row.station_id}`
    if (row.head_office_only) return 'Head office'
    return 'All entities'
  }

  const mapsToMissingFromPicker =
    Boolean(form.maps_to_code) && !mapTargets.some((m) => m.id === form.maps_to_code)

  if (!authReady) {
    return (
      <PageLayout>
        <div className="flex min-h-[50vh] items-center justify-center p-6 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </PageLayout>
    )
  }

  if (!isAdmin) {
    return (
      <PageLayout>
        <ErpPageShell
          showBackLink={false}
          title={pageMeta.title}
          titleIcon={Layers}
          description="Only company administrators can manage reporting categories."
          maxWidthClass="max-w-[1600px]"
          contentClassName="mt-4"
        >
          {null}
        </ErpPageShell>
      </PageLayout>
    )
  }

  return (
    <PageLayout>
      <ErpPageShell
        showBackLink={false}
        title={pageMeta.title}
        titleIcon={Layers}
        description={pageMeta.description}
        maxWidthClass="max-w-[1600px]"
        contentClassName="mt-4"
      >
          {needsCompanyPick && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
              Select a <strong>company</strong> in the header switcher before managing categories.
            </div>
          )}

          {/* Business context — same grouped pattern as Reports → Site */}
          <div className="flex flex-col gap-4 rounded-xl border border-border bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div>
                  <p className="font-medium text-foreground">Business context</p>
                  <p className="mt-1 text-muted-foreground">{contextBlurb}</p>
                  {!stationsLoading && canCallApi ? (
                    <p className="mt-2 text-xs font-medium text-muted-foreground">{entityCountLabel}</p>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-foreground/85" htmlFor="rc-business-scope">
                    Entity
                  </label>
                  <div
                    className={
                      !canCallApi || stationsLoading ? 'pointer-events-none opacity-60' : undefined
                    }
                  >
                    <BillLineEntitySelect
                      id="rc-business-scope"
                      value={scopeKey}
                      onChange={onScopeChange}
                      stations={stations}
                      ponds={ponds}
                      companyName={selectedCompany?.name}
                      className={SELECT_CLASS}
                      showHeadOffice
                      showAllEntitiesOption
                      emptyLabel="All entities"
                      placeholder="Search entity…"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {scopeKey ? (
                      <>
                        Managing <span className="font-medium text-foreground/85">{scopeLabel}</span>
                        {resolvedApplication ? (
                          <> · {applicationLabel(resolvedApplication)}</>
                        ) : null}
                      </>
                    ) : (
                      `Showing categories for all entities · ${entityCountLabel}`
                    )}
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-foreground/85">Kind</span>
                  <div className="inline-flex rounded-lg border border-border bg-muted p-0.5">
                    {(['expense', 'income'] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        disabled={!canCallApi}
                        onClick={() => setKind(k)}
                        className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
                          kind === k
                            ? 'bg-primary text-white shadow-sm'
                            : 'bg-transparent text-foreground/85 hover:bg-card/80 hover:text-foreground'
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

          {/* Add / edit — one shared form */}
          <section
            id="rc-category-form"
            className={`rounded-xl border bg-white p-4 shadow-sm sm:p-5 ${
              editingRow ? 'border-primary/25 ring-1 ring-blue-100' : 'border-border'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {editingRow ? <Edit2 className="h-5 w-5 text-primary" /> : <Tag className="h-5 w-5 text-muted-foreground" />}
                <h2 className="text-lg font-semibold text-foreground">
                  {editingRow ? 'Edit category' : 'Add category'}
                </h2>
              </div>
              {editingRow ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={closeEdit}
                  disabled={formSaving}
                >
                  <X className="h-4 w-4" />
                  Cancel edit
                </button>
              ) : null}
            </div>
            {!formVisible ? (
              <p className="mt-3 flex items-start gap-2 rounded-lg bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                Select a <strong>station</strong> or <strong>pond</strong> above to add a new category. Use{' '}
                <strong>All</strong> to review everything across the company, or click <strong>Edit</strong> on a row.
              </p>
            ) : (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  {editingRow ? (
                    <>
                      <ApplicationBadge app={editingRow.application} />
                      <span className="mx-2 text-muted-foreground/40">·</span>
                      {kindLabel(editingRow.kind)}
                      <span className="mx-2 text-muted-foreground/40">·</span>
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                        {editingRow.code}
                      </code>
                    </>
                  ) : (
                    <>
                      New {kindLabel(kind).toLowerCase()} category for{' '}
                      <span className="font-medium text-foreground/85">{applicationLabel(resolvedApplication!)}</span>
                      {' · '}
                      {scopeLabel}
                    </>
                  )}
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground sm:col-span-2">
                    Display name
                    <span className="font-normal text-muted-foreground">
                      What users see in dropdowns — e.g. &quot;Site security&quot; or &quot;Pond aeration&quot;
                    </span>
                    <input
                      className="rounded-md border border-border px-3 py-2 text-sm text-foreground shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-ring/20"
                      value={form.label}
                      onChange={(e) => onLabelChange(e.target.value)}
                      disabled={!canCallApi || formSaving}
                      placeholder="Site security"
                    />
                  </label>
                  {!editingRow ? (
                    <p className="text-xs font-normal text-muted-foreground sm:col-span-2">
                      Category code is assigned automatically (e.g.{' '}
                      <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">
                        {resolvedApplication === 'fuel_station'
                          ? kind === 'income'
                            ? 'fsi001'
                            : 'fse001'
                          : kind === 'income'
                            ? 'aqi001'
                            : 'aqe001'}
                      </code>
                      ). Deleted codes are reused in order.
                    </p>
                  ) : null}
                  <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground sm:col-span-2">
                    Directed to (entity)
                    <span className="font-normal text-muted-foreground">
                      Optional — limit this label to one station or pond. Leave as &quot;All entities&quot; for
                      company-wide use.
                    </span>
                    <BillLineEntitySelect
                      value={form.entity_scope_key}
                      onChange={(key) => setForm((f) => ({ ...f, entity_scope_key: key }))}
                      stations={stations}
                      ponds={ponds}
                      companyName={selectedCompany?.name}
                      className="rounded-md border border-border px-3 py-2 text-sm text-foreground shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-ring/20"
                      showHeadOffice
                      showAllEntitiesOption
                      emptyLabel="All entities (company-wide)"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground sm:col-span-2">
                    Rolls up to
                    <span className="font-normal text-muted-foreground">
                      Which built-in P&amp;L bucket this label counts under — grouped by how reports and GL treat
                      each type. Automatic-only rollups (feed consumed, depreciation, etc.) are not listed.
                    </span>
                    <ReportingMapTargetCombobox
                      value={form.maps_to_code}
                      onChange={(code) => setForm((f) => ({ ...f, maps_to_code: code }))}
                      targets={mapTargets}
                      missingOption={
                        mapsToMissingFromPicker
                          ? {
                              value: form.maps_to_code,
                              label: `${rollupLabel(form.maps_to_code)} (not on vendor bills — change rollup)`,
                            }
                          : undefined
                      }
                      className="rounded-md border border-border px-3 py-2 text-sm text-foreground shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-ring/20"
                    />
                    {selectedMapTarget?.hint ? (
                      <p className="mt-1 flex items-start gap-2 rounded-lg bg-muted/40 px-3 py-2 font-normal text-muted-foreground">
                        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span>{selectedMapTarget.hint}</span>
                      </p>
                    ) : null}
                    {selectedMapTarget?.non_biological_sale ? (
                      <p className="font-normal text-muted-foreground">
                        Non-biological sale — does not reduce implied fish kg/count in stock position reports.
                      </p>
                    ) : null}
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                    Sort order
                    <span className="font-normal text-muted-foreground/70">Optional — lower numbers appear first in lists</span>
                    <input
                      className="rounded-md border border-border px-3 py-2 text-sm text-foreground shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-ring/20"
                      value={form.sort_order}
                      onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
                      disabled={!canCallApi || formSaving}
                      inputMode="numeric"
                    />
                  </label>
                  {editingRow ? (
                    <label className="flex cursor-pointer items-center gap-2 pt-5 text-sm text-foreground/85">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-border text-primary focus:ring-ring/30"
                        checked={form.is_active}
                        onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                        disabled={formSaving}
                      />
                      Active in dropdowns
                    </label>
                  ) : null}
                </div>
                {editingRow ? (
                  <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-900">
                    Saving updates vendor bills, journal lines, and pond expenses that already use this category
                    (display name and rollup bucket).
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void onSubmitForm()}
                    disabled={!canCallApi || formSaving}
                  >
                    {formSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : editingRow ? (
                      <Edit2 className="h-4 w-4" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    {editingRow ? 'Save changes' : 'Create category'}
                  </button>
                  {editingRow ? (
                    <button
                      type="button"
                      className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground/85 hover:bg-muted/40 disabled:opacity-50"
                      onClick={closeEdit}
                      disabled={formSaving}
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              </>
            )}
          </section>

          {/* List */}
          <section className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-3 sm:px-5">
              <h2 className="text-lg font-semibold text-foreground">
                {kindLabel(kind)} categories
                {scopeKey ? ` · ${scopeLabel}` : ' · All sites'}
              </h2>
              {!loading && rows.length > 0 ? (
                <span className="text-sm text-muted-foreground">{rows.length} defined</span>
              ) : null}
            </div>
            {needsCompanyPick ? (
              <p className="p-6 text-sm text-muted-foreground">Choose a company to load categories.</p>
            ) : loading || stationsLoading ? (
              <div className="flex items-center gap-2 p-8 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                Loading categories…
              </div>
            ) : rows.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <Tag className="mx-auto h-10 w-10 text-muted-foreground/40" />
                <p className="mt-3 text-sm font-medium text-foreground/85">No custom categories yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {resolvedApplication
                    ? 'Add one above, or switch kind / context.'
                    : 'Select a station or pond to add categories, or try the other kind.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border/70 text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      {resolvedApplication == null ? (
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground sm:px-5">Application</th>
                      ) : null}
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground sm:px-5">Code</th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground sm:px-5">Label</th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground sm:px-5">Directed to</th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground sm:px-5">Rolls up to</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground sm:px-5">Order</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground sm:px-5">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70 bg-white">
                    {rows.map((r) => (
                      <tr
                        key={r.id}
                        className={`hover:bg-muted/40/60 ${!r.is_active ? 'opacity-60' : ''}`}
                      >
                        {resolvedApplication == null ? (
                          <td className="whitespace-nowrap px-4 py-3 sm:px-5">
                            <ApplicationBadge app={r.application} />
                          </td>
                        ) : null}
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-foreground sm:px-5">
                          {r.code}
                          {!r.is_active ? (
                            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              Inactive
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-foreground sm:px-5">{r.label}</td>
                        <td className="px-4 py-3 text-muted-foreground sm:px-5">{entityLabel(r)}</td>
                        <td className="px-4 py-3 text-muted-foreground sm:px-5">
                          <span className="font-mono text-xs text-muted-foreground">{r.maps_to_code}</span>
                          <span className="mx-1 text-muted-foreground/40">·</span>
                          {rollupLabel(r.maps_to_code)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted-foreground sm:px-5">
                          {r.sort_order}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right sm:px-5">
                          <div className="inline-flex items-center justify-end gap-1">
                            <button
                              type="button"
                              title="Edit category"
                              aria-label="Edit category"
                              className={`rounded-md p-2 hover:bg-muted hover:text-primary ${
                                editingRow?.id === r.id ? 'bg-blue-50 text-primary' : 'text-muted-foreground'
                              }`}
                              onClick={() => openEdit(r)}
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              title={r.is_active ? 'Deactivate category' : 'Activate category'}
                              aria-label={r.is_active ? 'Deactivate category' : 'Activate category'}
                              className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-emerald-700"
                              onClick={() => void onToggleActive(r)}
                            >
                              {r.is_active ? (
                                <ToggleRight className="h-4 w-4 text-emerald-600" />
                              ) : (
                                <ToggleLeft className="h-4 w-4 text-muted-foreground/70" />
                              )}
                            </button>
                            <button
                              type="button"
                              title="Delete category"
                              aria-label="Delete category"
                              className="rounded-md p-2 text-muted-foreground hover:bg-destructive/5 hover:text-destructive"
                              onClick={() => void onDelete(r.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {resolvedApplication ? (
            <section className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
              <div className="border-b border-border/70 px-4 py-3 sm:px-5">
                <h2 className="text-lg font-semibold text-foreground">
                  Labels for tagging {kindLabel(kind).toLowerCase()}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Built-in types and custom labels that can be used on vendor bills and related screens for{' '}
                  {applicationLabel(resolvedApplication)}. Unusable rollups are hidden here and in bill dropdowns.
                </p>
              </div>
              {taggingLoading ? (
                <div className="flex items-center gap-2 p-6 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  Loading tagging options…
                </div>
              ) : taggingOptions.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">No tagging options loaded.</p>
              ) : (
                <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Standard categories
                    </h3>
                    <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-sm text-foreground">
                      {groupedTaggingOptions.standard.map((o) => (
                        <li key={o.id} className="rounded-md bg-muted/40 px-2 py-1 font-mono text-xs">
                          <span className="font-sans font-medium">{o.label}</span>
                          <span className="ml-2 text-muted-foreground/70">{o.id}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Your custom labels
                    </h3>
                    {groupedTaggingOptions.custom.length === 0 ? (
                      <p className="mt-2 text-sm text-muted-foreground">None yet — add one above.</p>
                    ) : (
                      <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-sm text-foreground">
                        {groupedTaggingOptions.custom.map((o) => (
                          <li key={o.id} className="rounded-md border border-blue-100 bg-blue-50/60 px-2 py-1">
                            <span className="font-medium">{o.label}</span>
                            <span className="ml-2 font-mono text-xs text-muted-foreground">{o.id}</span>
                            {o.maps_to_code ? (
                              <span className="ml-2 text-xs text-muted-foreground">→ {rollupLabel(o.maps_to_code)}</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </section>
          ) : null}

          <footer className="rounded-lg border border-border bg-white px-4 py-3 text-xs text-muted-foreground shadow-sm">
            <p className="font-medium text-foreground/85">Where these appear</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>
                <strong>Aquaculture</strong> — pond expenses, fish sales, and vendor bill lines tagged to ponds
              </li>
              <li>
                <strong>Fuel station</strong> — optional tags on{' '}
                <Link href="/journal-entries" className="text-primary hover:underline">
                  manual journal lines
                </Link>{' '}
                and fuel expense rollups on{' '}
                <Link href="/bills" className="text-primary hover:underline">
                  vendor bills
                </Link>
              </li>
            </ul>
          </footer>
      </ErpPageShell>
    </PageLayout>
  )
}
