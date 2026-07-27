'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import PageLayout from '@/components/PageLayout'
import { ErpPageShell } from '@/components/aquaculture/ErpPageShell'
import { AQ_HERO_BTN_PRIMARY } from '@/components/aquaculture/AquacultureUi'
import api from '@/lib/api'
import { Briefcase, ChevronLeft, Info, Pencil, Plus, Shield, Trash2 } from 'lucide-react'
import { useToast } from '@/components/Toast'
import { usePageMeta } from '@/hooks/usePageMeta'
import { useCompanyLocale } from '@/contexts/CompanyLocaleContext'
import { localizePermissionCatalog } from '@/lib/permissionCatalogI18n'
import { useRolesT, rolesT } from '@/lib/moduleI18n/roles'
import PermissionMatrix, { type PermItem } from '@/components/users/PermissionMatrix'
import {
  BUILTIN_JOB_TYPE_SEEDS,
  BUILTIN_JOB_TYPE_VALUES,
  mergeJobTypesFromApi,
  type TenantJobTypeOption,
} from '@/constants/tenantJobTypes'
import { getAccessProfileSeedLabel, getRoleDisplayName } from '@/utils/rbac'

type PermDef = { id: string; label: string; group: string }

type CompanyRoleRow = {
  id: number
  name: string
  description: string
  permissions: string[]
  company_id: number
  created_at?: string | null
  updated_at?: string | null
}

type TabId = 'profiles' | 'jobTypes'

export default function RolesPage() {
  const router = useRouter()
  const toast = useToast()
  const pageMeta = usePageMeta()
  const rt = useRolesT()
  const { language } = useCompanyLocale()
  const [allowed, setAllowed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabId>('profiles')
  const [roles, setRoles] = useState<CompanyRoleRow[]>([])
  const [jobTypes, setJobTypes] = useState<TenantJobTypeOption[]>([])
  const [catalog, setCatalog] = useState<PermDef[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<CompanyRoleRow | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [roleDefaults, setRoleDefaults] = useState<Record<string, string[]>>({})
  const [seedFromRole, setSeedFromRole] = useState<string>('')

  const [jtModalOpen, setJtModalOpen] = useState(false)
  const [jtEditingId, setJtEditingId] = useState<number | null>(null)
  const [jtIsCustom, setJtIsCustom] = useState(true)
  const [jtKey, setJtKey] = useState('')
  const [jtLabel, setJtLabel] = useState('')
  const [jtHint, setJtHint] = useState('')
  const [jtInheritsFrom, setJtInheritsFrom] = useState('cashier')
  const [jtAccessEnabled, setJtAccessEnabled] = useState(false)
  const [jtAllowedIds, setJtAllowedIds] = useState<Set<number>>(new Set())
  const [jtSaving, setJtSaving] = useState(false)

  const localizedCatalog = useMemo(
    () => localizePermissionCatalog(catalog, language),
    [catalog, language]
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [catRes, listRes, jtRes] = await Promise.all([
        api.get('/permission-catalog/'),
        api.get('/company-roles/'),
        api.get('/company-job-types/'),
      ])
      setCatalog(
        Array.isArray(catRes.data?.permissions) ? (catRes.data.permissions as PermDef[]) : []
      )
      const rd = (catRes.data as { role_defaults?: Record<string, string[]> })?.role_defaults
      setRoleDefaults(rd && typeof rd === 'object' ? rd : {})
      setRoles(Array.isArray(listRes.data?.results) ? (listRes.data.results as CompanyRoleRow[]) : [])
      const fromJt = (jtRes.data as { job_types?: TenantJobTypeOption[] })?.job_types
      const fromCat = (catRes.data as { job_types?: TenantJobTypeOption[] })?.job_types
      setJobTypes(mergeJobTypesFromApi(fromJt?.length ? fromJt : fromCat))
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string }; status?: number } })?.response
      if (d?.status === 403) {
        toast.error(d?.data?.detail || rolesT('noAccess', language))
        setAllowed(false)
      } else {
        toast.error(rolesT('loadFailed', language))
      }
    } finally {
      setLoading(false)
    }
  }, [toast, language])

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    let ok = false
    try {
      const raw = localStorage.getItem('user')
      if (raw && raw !== 'undefined') {
        const u = JSON.parse(raw) as { role?: string; permissions?: string[] }
        const r = (u.role || '').toLowerCase()
        if (r === 'super_admin' || (r === 'admin' && u && (u as { company_id?: number }).company_id)) {
          ok = true
        }
        if (Array.isArray(u.permissions) && u.permissions.length > 0) {
          if (u.permissions.includes('*') || u.permissions.includes('app.roles')) {
            ok = true
          }
        }
      }
    } catch {
      /* ignore */
    }
    setAllowed(ok)
    if (!ok) {
      setLoading(false)
      return
    }
    void load()
  }, [router, load])

  const openCreate = () => {
    setEditing(null)
    setName('')
    setDescription('')
    setSelected(new Set())
    setSeedFromRole('')
    setModalOpen(true)
  }

  const openEdit = (r: CompanyRoleRow) => {
    setEditing(r)
    setName(r.name)
    setDescription(r.description || '')
    setSelected(new Set(r.permissions || []))
    setSeedFromRole('')
    setModalOpen(true)
  }

  const save = async () => {
    if (!name.trim()) {
      toast.error(rt('nameRequired'))
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        permissions: Array.from(selected),
      }
      if (editing) {
        await api.put(`/company-roles/${editing.id}/`, payload)
        toast.success(rt('roleUpdated'))
      } else {
        await api.post('/company-roles/', payload)
        toast.success(rt('roleCreated'))
      }
      setModalOpen(false)
      void load()
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data
      toast.error((d?.detail as string) || rt('saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (r: CompanyRoleRow) => {
    if (!window.confirm(rt('deleteConfirm', { name: r.name }))) return
    try {
      await api.delete(`/company-roles/${r.id}/`)
      toast.success(rt('roleRemoved'))
      void load()
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data
      toast.error((d?.detail as string) || rt('deleteFailed'))
    }
  }

  const applySeedRole = (key: string) => {
    setSeedFromRole(key)
    const seed = key ? roleDefaults[key] : null
    if (Array.isArray(seed) && seed.length) {
      setSelected(new Set(catalog.filter((c) => seed.includes(c.id)).map((c) => c.id)))
    } else if (!key) {
      setSelected(new Set())
    }
  }

  const openCreateJobType = () => {
    setJtEditingId(null)
    setJtIsCustom(true)
    setJtKey('')
    setJtLabel('')
    setJtHint('')
    setJtInheritsFrom('cashier')
    setJtAccessEnabled(false)
    setJtAllowedIds(new Set())
    setJtModalOpen(true)
  }

  const openConfigureJobType = (jt: TenantJobTypeOption) => {
    setJtEditingId(jt.company_job_type_id ?? null)
    setJtIsCustom(Boolean(jt.is_custom))
    setJtKey(jt.value)
    setJtLabel(jt.label)
    setJtHint(jt.hint || '')
    setJtInheritsFrom(jt.inherits_from || (jt.is_custom ? 'cashier' : jt.value))
    setJtAccessEnabled(Boolean(jt.access_profile_enabled))
    setJtAllowedIds(new Set((jt.allowed_role_ids || []).map((id) => Number(id))))
    setJtModalOpen(true)
  }

  const saveJobType = async () => {
    if (!jtLabel.trim()) {
      toast.error(rt('jobTypeLabelRequired'))
      return
    }
    setJtSaving(true)
    try {
      const payload: Record<string, unknown> = {
        label: jtLabel.trim(),
        hint: jtHint.trim(),
        access_profile_enabled: jtAccessEnabled,
        allowed_role_ids: Array.from(jtAllowedIds),
      }
      if (jtIsCustom) {
        payload.is_custom = true
        payload.inherits_from = jtInheritsFrom
        if (!jtEditingId && jtKey.trim()) payload.key = jtKey.trim()
      } else {
        payload.key = jtKey
        payload.is_custom = false
      }

      if (jtEditingId) {
        await api.put(`/company-job-types/${jtEditingId}/`, payload)
        toast.success(rt('jobTypeUpdated'))
      } else {
        await api.post('/company-job-types/', payload)
        toast.success(rt('jobTypeCreated'))
      }
      setJtModalOpen(false)
      void load()
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data
      toast.error((d?.detail as string) || rt('saveFailed'))
    } finally {
      setJtSaving(false)
    }
  }

  const removeJobType = async (jt: TenantJobTypeOption) => {
    if (!jt.company_job_type_id) return
    if (!window.confirm(rt('jobTypeDeleteConfirm', { name: jt.label }))) return
    try {
      await api.delete(`/company-job-types/${jt.company_job_type_id}/`)
      toast.success(rt('jobTypeRemoved'))
      void load()
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data
      toast.error((d?.detail as string) || rt('deleteFailed'))
    }
  }

  const toggleAllowedRole = (id: number) => {
    setJtAllowedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!allowed && !loading) {
    return (
      <PageLayout>
        <div className="flex min-h-[50vh] flex-col items-center justify-center px-4 py-8 sm:p-8">
          <div className="mb-4 w-full max-w-md text-left sm:text-center">
            <Link
              href="/apps"
              className="inline-flex items-center gap-1 text-sm font-medium text-warning-foreground/80 hover:text-warning-foreground hover:underline"
            >
              <ChevronLeft className="h-4 w-4" />
              {rt('backToLauncher')}
            </Link>
          </div>
          <div className="max-w-md rounded-lg border border-warning/30 bg-warning/10 p-6 text-center text-warning-foreground">
            <Shield className="mx-auto h-10 w-10" />
            <h1 className="mt-2 text-lg font-semibold">{rt('accessDeniedTitle')}</h1>
            <p className="mt-1 text-sm">{rt('accessDeniedBody')}</p>
          </div>
        </div>
      </PageLayout>
    )
  }

  return (
    <PageLayout>
      <div className="app-scroll-pad">
        <ErpPageShell
          flush
          showBackLink={false}
          title={pageMeta.title}
          titleIcon={Shield}
          description={pageMeta.description ?? rt('pageDescription')}
          maxWidthClass="max-w-[1600px]"
          contentClassName="mt-4"
          actions={
            tab === 'profiles' ? (
              <button type="button" onClick={openCreate} className={AQ_HERO_BTN_PRIMARY}>
                <Plus className="h-4 w-4" aria-hidden />
                <span>{rt('newRole')}</span>
              </button>
            ) : (
              <button type="button" onClick={openCreateJobType} className={AQ_HERO_BTN_PRIMARY}>
                <Plus className="h-4 w-4" aria-hidden />
                <span>{rt('newJobType')}</span>
              </button>
            )
          }
        >
          <div className="mb-4 flex gap-1 border-b border-border">
            <button
              type="button"
              onClick={() => setTab('profiles')}
              className={`border-b-2 px-3 py-2 text-sm font-medium ${
                tab === 'profiles'
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {rt('tabAccessProfiles')}
            </button>
            <button
              type="button"
              onClick={() => setTab('jobTypes')}
              className={`border-b-2 px-3 py-2 text-sm font-medium ${
                tab === 'jobTypes'
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {rt('tabJobTypes')}
            </button>
          </div>

          {loading ? (
            <p className="text-muted-foreground">{rt('loading')}</p>
          ) : tab === 'profiles' ? (
            <ul className="space-y-3">
              {roles.length === 0 && (
                <li className="rounded-xl border border-dashed border-border bg-white px-4 py-10 text-center text-muted-foreground">
                  {rt('noRolesYet')}
                </li>
              )}
              {roles.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-white p-4 shadow-sm"
                >
                  <div>
                    <p className="font-semibold text-foreground">{r.name}</p>
                    {r.description ? (
                      <p className="text-sm text-muted-foreground">{r.description}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {catalog.length > 0
                        ? rt('modulesAllowed', {
                            count: r.permissions?.length ?? 0,
                            total: catalog.length,
                          })
                        : (r.permissions?.length ?? 0) === 1
                          ? rt('moduleCount', { count: r.permissions?.length ?? 0 })
                          : rt('modulesCount', { count: r.permissions?.length ?? 0 })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openEdit(r)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
                      title={rt('edit')}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(r)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-destructive hover:bg-destructive/5"
                      title={rt('delete')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="space-y-4">
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {rt('jobTypesHint')}
              </p>
              <ul className="space-y-3">
                {jobTypes.length === 0 && (
                  <li className="rounded-xl border border-dashed border-border bg-white px-4 py-10 text-center text-muted-foreground">
                    {rt('noJobTypesManaged')}
                  </li>
                )}
                {jobTypes.map((jt) => {
                  const restricted =
                    jt.access_profile_enabled && (jt.allowed_role_ids?.length ?? 0) > 0
                  return (
                    <li
                      key={jt.value}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-white p-4 shadow-sm"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Briefcase className="h-4 w-4 text-muted-foreground" aria-hidden />
                          <p className="font-semibold text-foreground">{jt.label}</p>
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            {jt.is_custom ? rt('customBadge') : rt('builtinBadge')}
                          </span>
                        </div>
                        {jt.hint ? (
                          <p className="mt-1 text-sm text-muted-foreground">{jt.hint}</p>
                        ) : null}
                        <p className="mt-1 text-xs text-muted-foreground">
                          {restricted
                            ? rt('profilesRestricted', { count: jt.allowed_role_ids!.length })
                            : rt('profilesUnrestricted')}
                          {jt.access_profile_enabled && !restricted
                            ? ` · ${rt('accessProfileEnabled')}`
                            : null}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openConfigureJobType(jt)}
                          className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground hover:bg-muted"
                          title={rt('configureBuiltin')}
                        >
                          <Pencil className="h-4 w-4" />
                          <span className="hidden sm:inline">{rt('configureBuiltin')}</span>
                        </button>
                        {jt.company_job_type_id ? (
                          <button
                            type="button"
                            onClick={() => void removeJobType(jt)}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-destructive hover:bg-destructive/5"
                            title={rt('delete')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </ErpPageShell>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 p-4 sm:items-center">
          <div
            className="max-h-[min(90vh,720px)] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-white p-5 shadow-xl"
            role="dialog"
            aria-modal
          >
            <h2 className="text-lg font-semibold text-foreground">
              {editing ? rt('editAccessProfile') : rt('newAccessProfile')}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">{rt('modalHint')}</p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">{rt('name')}</label>
                <input
                  className="mt-0.5 w-full rounded-lg border border-border px-3 py-2 text-sm"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={rt('namePlaceholder')}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  {rt('descriptionOptional')}
                </label>
                <textarea
                  className="mt-0.5 w-full rounded-lg border border-border px-3 py-2 text-sm"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder={rt('descriptionPlaceholder')}
                />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">{rt('appsModulesReports')}</p>
                <p className="mt-0.5 flex items-start gap-1 text-[11px] text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  {rt('matrixHelp')}
                </p>
                {!editing && (
                  <div className="mt-2">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="role-seed">
                      {rt('startFromJobType')}
                    </label>
                    <select
                      id="role-seed"
                      className="mt-0.5 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
                      value={seedFromRole}
                      onChange={(e) => applySeedRole(e.target.value)}
                    >
                      <option value="">{rt('fromScratch')}</option>
                      {BUILTIN_JOB_TYPE_SEEDS.map((k) => (
                        <option key={k} value={k}>
                          {getAccessProfileSeedLabel(k)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="mt-2 rounded-lg border border-border/70 bg-muted/50 p-2 sm:p-3">
                  <PermissionMatrix
                    idPrefix="roles-perm"
                    catalog={localizedCatalog as PermItem[]}
                    selected={Array.from(selected)}
                    onChange={(ids) => setSelected(new Set(ids))}
                    listClassName="max-h-64"
                  />
                </div>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-border/70 pt-4">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-muted"
              >
                {rt('cancel')}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-white hover:bg-foreground/90 disabled:opacity-50"
              >
                {saving ? rt('saving') : rt('save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {jtModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 p-4 sm:items-center">
          <div
            className="max-h-[min(90vh,720px)] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-white p-5 shadow-xl"
            role="dialog"
            aria-modal
          >
            <h2 className="text-lg font-semibold text-foreground">
              {jtEditingId
                ? rt('editJobType')
                : jtIsCustom
                  ? rt('newJobTypeTitle')
                  : rt('configureBuiltinTitle')}
            </h2>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">{rt('jobTypeLabel')}</label>
                <input
                  className="mt-0.5 w-full rounded-lg border border-border px-3 py-2 text-sm"
                  value={jtLabel}
                  onChange={(e) => setJtLabel(e.target.value)}
                />
              </div>
              {jtIsCustom && !jtEditingId ? (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">{rt('jobTypeKey')}</label>
                  <input
                    className="mt-0.5 w-full rounded-lg border border-border px-3 py-2 text-sm font-mono text-sm"
                    value={jtKey}
                    onChange={(e) => setJtKey(e.target.value)}
                    placeholder="e.g. night_shift_lead"
                  />
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{rt('jobTypeKeyHelp')}</p>
                </div>
              ) : null}
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  {rt('jobTypeHintField')}
                </label>
                <textarea
                  className="mt-0.5 w-full rounded-lg border border-border px-3 py-2 text-sm"
                  value={jtHint}
                  onChange={(e) => setJtHint(e.target.value)}
                  rows={2}
                />
              </div>
              {jtIsCustom ? (
                <div>
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="jt-inherits">
                    {rt('inheritsFrom')}
                  </label>
                  <select
                    id="jt-inherits"
                    className="mt-0.5 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
                    value={jtInheritsFrom}
                    onChange={(e) => setJtInheritsFrom(e.target.value)}
                  >
                    {Array.from(BUILTIN_JOB_TYPE_VALUES).map((k) => (
                      <option key={k} value={k}>
                        {getRoleDisplayName(k)}
                      </option>
                    ))}
                  </select>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{rt('inheritsFromHelp')}</p>
                </div>
              ) : null}
              <label className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={jtAccessEnabled}
                  onChange={(e) => setJtAccessEnabled(e.target.checked)}
                />
                <span>
                  <span className="block text-sm font-medium text-foreground">
                    {rt('accessProfileEnabled')}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {rt('accessProfileEnabledHelp')}
                  </span>
                </span>
              </label>
              {jtAccessEnabled ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{rt('approvedProfiles')}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{rt('approvedProfilesHelp')}</p>
                  {roles.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">{rt('noProfilesToApprove')}</p>
                  ) : (
                    <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                      {roles.map((r) => (
                        <li key={r.id}>
                          <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/60">
                            <input
                              type="checkbox"
                              checked={jtAllowedIds.has(r.id)}
                              onChange={() => toggleAllowedRole(r.id)}
                            />
                            <span>{r.name}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-border/70 pt-4">
              <button
                type="button"
                onClick={() => setJtModalOpen(false)}
                className="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-muted"
              >
                {rt('cancel')}
              </button>
              <button
                type="button"
                disabled={jtSaving}
                onClick={() => void saveJobType()}
                className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-white hover:bg-foreground/90 disabled:opacity-50"
              >
                {jtSaving ? rt('saving') : rt('save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  )
}
