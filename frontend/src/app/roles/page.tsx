'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import PageLayout from '@/components/PageLayout'
import { ErpPageShell } from '@/components/aquaculture/ErpPageShell'
import { AQ_HERO_BTN_PRIMARY } from '@/components/aquaculture/AquacultureUi'
import api from '@/lib/api'
import { ChevronLeft, Info, Pencil, Plus, Shield, Trash2 } from 'lucide-react'
import { useToast } from '@/components/Toast'
import { usePageMeta } from '@/hooks/usePageMeta'
import { useCompanyLocale } from '@/contexts/CompanyLocaleContext'
import { localizePermissionCatalog } from '@/lib/permissionCatalogI18n'
import { useRolesT, rolesT } from '@/lib/moduleI18n/roles'
import PermissionMatrix, { type PermItem } from '@/components/users/PermissionMatrix'
import { BUILTIN_JOB_TYPE_SEEDS } from '@/constants/tenantJobTypes'
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

export default function RolesPage() {
  const router = useRouter()
  const toast = useToast()
  const pageMeta = usePageMeta()
  const rt = useRolesT()
  const { language } = useCompanyLocale()
  const [allowed, setAllowed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [roles, setRoles] = useState<CompanyRoleRow[]>([])
  const [catalog, setCatalog] = useState<PermDef[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<CompanyRoleRow | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [roleDefaults, setRoleDefaults] = useState<Record<string, string[]>>({})
  const [seedFromRole, setSeedFromRole] = useState<string>('')

  const localizedCatalog = useMemo(
    () => localizePermissionCatalog(catalog, language),
    [catalog, language]
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [catRes, listRes] = await Promise.all([
        api.get('/permission-catalog/'),
        api.get('/company-roles/'),
      ])
      setCatalog(
        Array.isArray(catRes.data?.permissions) ? (catRes.data.permissions as PermDef[]) : []
      )
      const rd = (catRes.data as { role_defaults?: Record<string, string[]> })?.role_defaults
      setRoleDefaults(rd && typeof rd === 'object' ? rd : {})
      setRoles(Array.isArray(listRes.data?.results) ? (listRes.data.results as CompanyRoleRow[]) : [])
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
            <button
              type="button"
              onClick={openCreate}
              className={AQ_HERO_BTN_PRIMARY}
            >
              <Plus className="h-4 w-4" aria-hidden />
              <span>{rt('newRole')}</span>
            </button>
          }
        >
          {loading ? (
            <p className="text-muted-foreground">{rt('loading')}</p>
          ) : (
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
                  <label className="text-xs font-medium text-muted-foreground">{rt('descriptionOptional')}</label>
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
    </PageLayout>
  )
}
