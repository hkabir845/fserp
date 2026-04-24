'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import api from '@/lib/api'
import { ChevronLeft, Info, Pencil, Plus, Shield, Trash2 } from 'lucide-react'
import { useToast } from '@/components/Toast'
import PermissionMatrix, { type PermItem } from '@/components/users/PermissionMatrix'
import { getRoleDisplayName } from '@/utils/rbac'

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
        toast.error(d?.data?.detail || 'You do not have access to role management.')
        setAllowed(false)
      } else {
        toast.error('Failed to load roles. Try again or re-select a company (super admin).')
      }
    } finally {
      setLoading(false)
    }
  }, [toast])

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
      toast.error('Name is required.')
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
        toast.success('Role updated.')
      } else {
        await api.post('/company-roles/', payload)
        toast.success('Role created.')
      }
      setModalOpen(false)
      void load()
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data
      toast.error((d?.detail as string) || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (r: CompanyRoleRow) => {
    if (!window.confirm(`Delete role "${r.name}"? Users on this role will be unassigned.`)) return
    try {
      await api.delete(`/company-roles/${r.id}/`)
      toast.success('Role removed.')
      void load()
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data
      toast.error((d?.detail as string) || 'Delete failed.')
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
      <div className="page-with-sidebar flex h-screen bg-gray-100">
        <Sidebar />
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 sm:p-8">
          <div className="mb-4 w-full max-w-md text-left sm:text-center">
            <Link
              href="/apps"
              className="inline-flex items-center gap-1 text-sm font-medium text-amber-900/80 hover:text-amber-900 hover:underline"
            >
              <ChevronLeft className="h-4 w-4" />
              Back to app launcher
            </Link>
          </div>
          <div className="max-w-md rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-amber-900">
            <Shield className="mx-auto h-10 w-10" />
            <h1 className="mt-2 text-lg font-semibold">Roles & access</h1>
            <p className="mt-1 text-sm">
              Only tenant administrators can create and manage custom roles. If you are a super admin, select a
              company, then return here.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-with-sidebar flex h-screen min-h-0 w-full min-w-0 max-w-full bg-slate-100">
      <Sidebar />
      <div className="min-w-0 flex-1 overflow-auto p-6 sm:p-8">
        <div className="mx-auto max-w-4xl">
          <Link
            href="/apps"
            className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            <ChevronLeft className="h-4 w-4" />
            App launcher
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-6">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Roles & access</h1>
              <p className="mt-1 text-sm text-slate-600">
                Create named roles and allow or block each module or app. Assign a role on the Users page; unchecked
                items are denied in the app launcher and sidebar.
              </p>
            </div>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow hover:bg-slate-800"
            >
              <Plus className="h-4 w-4" />
              New role
            </button>
          </div>

          {loading ? (
            <p className="mt-8 text-slate-500">Loading…</p>
          ) : (
            <ul className="mt-6 space-y-3">
              {roles.length === 0 && (
                <li className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-slate-500">
                  No custom roles yet. Create one to tailor access beyond the default job titles.
                </li>
              )}
              {roles.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div>
                    <p className="font-semibold text-slate-900">{r.name}</p>
                    {r.description ? (
                      <p className="text-sm text-slate-600">{r.description}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-slate-500">
                      {catalog.length > 0
                        ? `${r.permissions?.length ?? 0} of ${catalog.length} modules allowed`
                        : `${r.permissions?.length ?? 0} module${(r.permissions?.length ?? 0) === 1 ? '' : 's'}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openEdit(r)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(r)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-red-600 hover:bg-red-50"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 p-4 sm:items-center">
            <div
              className="max-h-[min(90vh,720px)] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
              role="dialog"
              aria-modal
            >
              <h2 className="text-lg font-semibold text-slate-900">
                {editing ? 'Edit access profile' : 'New access profile'}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Assign this profile to users on the Users page. Checked items appear in the app launcher and menu.
              </p>
              <div className="mt-4 space-y-3">
                <div>
                  <label className="text-xs font-medium text-slate-600">Name</label>
                  <input
                    className="mt-0.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Shift supervisor"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600">Description (optional)</label>
                  <textarea
                    className="mt-0.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    placeholder="Short note for other admins: who this is for."
                  />
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-600">Modules and apps</p>
                  <p className="mt-0.5 flex items-start gap-1 text-[11px] text-slate-500">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    Search to find an area. Optional: pre-fill from a built-in job type when creating a new profile
                    (you can still adjust every line).
                  </p>
                  {!editing && (
                    <div className="mt-2">
                      <label className="text-xs font-medium text-slate-600" htmlFor="role-seed">
                        Start from job type (optional)
                      </label>
                      <select
                        id="role-seed"
                        className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                        value={seedFromRole}
                        onChange={(e) => applySeedRole(e.target.value)}
                      >
                        <option value="">— From scratch (or add checks below) —</option>
                        {(['admin', 'accountant', 'cashier', 'operator'] as const).map((k) => (
                          <option key={k} value={k}>
                            {`Same as ${getRoleDisplayName(k)} default`}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50/80 p-2 sm:p-3">
                    <PermissionMatrix
                      idPrefix="roles-perm"
                      catalog={catalog as PermItem[]}
                      selected={Array.from(selected)}
                      onChange={(ids) => setSelected(new Set(ids))}
                      listClassName="max-h-64"
                    />
                  </div>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void save()}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
