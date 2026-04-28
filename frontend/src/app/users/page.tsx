'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import PageLayout from '@/components/PageLayout'
import PermissionMatrix, { type PermItem } from '@/components/users/PermissionMatrix'
import { PosSaleScopeSelector } from '@/components/pos/PosSaleScopeSelector'
import { Plus, Edit2, Trash2, Shield, User, X, Eye, EyeOff, Grid3x3, List, Ban, UserCheck, Sparkles, Search, ChevronRight, KeyRound, Users, Briefcase, Info } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api, { getApiBaseUrl } from '@/lib/api'
import { formatDate } from '@/utils/date'
import { getRoleDisplayName } from '@/utils/rbac'

interface SystemUser {
  id: number
  username: string
  email: string
  full_name: string
  role: string
  is_active: boolean
  created_at: string
  company_id?: number | null
  company_name?: string
  custom_role_id?: number | null
  custom_role_name?: string | null
  /** General / fuel / both — applies to cashier and operator. */
  pos_sale_scope?: string
}

interface CompanyOption {
  id: number
  name: string
}

const JOB_TITLE_HINT: Record<string, string> = {
  admin: 'Company admin: can manage people, company settings, and all modules (unless a custom access profile below overrides).',
  accountant: 'Full accounting, sales, inventory, and reports. Typical back-office user.',
  cashier:
    'Register, customers, and basic reports. Set POS lane (fuel + shop, shop only, or fuel only) in the box below.',
  operator:
    'POS only: new sale and donation. Set POS lane (fuel + shop, shop only, or fuel only) in the box below.',
}

const CREATE_STEPS = [
  { n: 1, title: 'Account', sub: 'Who is this person?', icon: User },
  { n: 2, title: 'Access', sub: 'Job type & optional profile', icon: Briefcase },
  { n: 3, title: 'Sign-in', sub: 'Set a password', icon: KeyRound },
] as const

type PermDef = { id: string; label: string; group: string }

export default function UsersPage() {
  const router = useRouter()
  const toast = useToast()
  const [users, setUsers] = useState<SystemUser[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [isCompanyOwner, setIsCompanyOwner] = useState(false)
  const [isSuperAdminSession, setIsSuperAdminSession] = useState(false)
  const [currentSessionUserId, setCurrentSessionUserId] = useState<number | null>(null)
  const [companyRoles, setCompanyRoles] = useState<{ id: number; name: string }[]>([])
  const [permCatalog, setPermCatalog] = useState<PermDef[]>([])
  const [selectedProfilePerms, setSelectedProfilePerms] = useState<string[]>([])
  const [rolePermsDirty, setRolePermsDirty] = useState(false)
  const [roleSharedUserCount, setRoleSharedUserCount] = useState<number | null>(null)
  const [showNewRoleModal, setShowNewRoleModal] = useState(false)
  const [newRoleName, setNewRoleName] = useState('')
  const [newRoleDescription, setNewRoleDescription] = useState('')
  const [newRolePerms, setNewRolePerms] = useState<string[]>([])
  const [savingNewRole, setSavingNewRole] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('')
  const [createStep, setCreateStep] = useState(1)
  const [showAdvancedPerms, setShowAdvancedPerms] = useState(false)
  const [roleDefaults, setRoleDefaults] = useState<Record<string, string[]>>({})
  const [newProfileStartFrom, setNewProfileStartFrom] = useState<string>('')
  const [viewMode, setViewMode] = useState<'card' | 'list'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('users_view_mode')
      if (saved === 'card' || saved === 'list') return saved
    }
    return 'card'
  })
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    full_name: '',
    role: 'cashier',
    company_id: '' as string | number,
    custom_role_id: '' as string | number,
    pos_sale_scope: 'both' as string,
    password: '',
    confirmPassword: ''
  })

  const hasAccessContext =
    isCompanyOwner || (isSuperAdminSession && formData.company_id !== '' && formData.company_id != null)

  const loadCompanyRolesList = useCallback(async () => {
    try {
      const res = await api.get('/company-roles/')
      const r = (res.data as { results?: { id: number; name: string }[] })?.results
      if (Array.isArray(r)) {
        setCompanyRoles(r.map((x) => ({ id: x.id, name: x.name })))
      } else {
        setCompanyRoles([])
      }
    } catch {
      setCompanyRoles([])
    }
  }, [])

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    let owner = false
    let superA = false
    try {
      const raw = localStorage.getItem('user')
      if (raw && raw !== 'undefined') {
        const u = JSON.parse(raw)
        const role = (u.role || '').toLowerCase()
        superA = role === 'super_admin'
        owner = role === 'admin' && u.company_id != null
        if (typeof u.id === 'number') {
          setCurrentSessionUserId(u.id)
        } else if (u.id != null) {
          const parsed = parseInt(String(u.id), 10)
          if (!Number.isNaN(parsed)) setCurrentSessionUserId(parsed)
        }
      }
    } catch {
      /* ignore */
    }
    setIsSuperAdminSession(superA)
    setIsCompanyOwner(owner)
    if (owner || superA) {
      void loadCompanyRolesList()
    }
    fetchUsers()
    if (!owner || superA) {
      fetchCompanies()
    }
  }, [router, loadCompanyRolesList])

  useEffect(() => {
    if (!showModal) return
    if (!isCompanyOwner && !isSuperAdminSession) return
    void (async () => {
      try {
        const res = await api.get('/permission-catalog/')
        const d = res.data as { permissions?: PermDef[]; role_defaults?: Record<string, string[]> }
        const p = d?.permissions
        setPermCatalog(Array.isArray(p) ? p : [])
        setRoleDefaults(
          d?.role_defaults && typeof d.role_defaults === 'object' ? d.role_defaults : {}
        )
      } catch {
        setPermCatalog([])
        setRoleDefaults({})
      }
    })()
  }, [showModal, isCompanyOwner, isSuperAdminSession])

  useEffect(() => {
    if (showModal && !editingId) {
      setCreateStep(1)
    }
  }, [showModal, editingId])

  useEffect(() => {
    if (!showModal) return
    if (isCompanyOwner) {
      void loadCompanyRolesList()
    } else if (isSuperAdminSession && formData.company_id) {
      void loadCompanyRolesList()
    }
  }, [showModal, isCompanyOwner, isSuperAdminSession, formData.company_id, loadCompanyRolesList])

  useEffect(() => {
    if (!showModal) {
      return
    }
    if (formData.custom_role_id === '' || formData.custom_role_id == null) {
      setSelectedProfilePerms([])
      setRoleSharedUserCount(null)
      setRolePermsDirty(false)
      return
    }
    const crid =
      typeof formData.custom_role_id === 'string'
        ? parseInt(String(formData.custom_role_id), 10)
        : (formData.custom_role_id as number)
    if (Number.isNaN(crid)) {
      return
    }
    let cancel = false
    void (async () => {
      try {
        const { data } = await api.get<{
          permissions?: string[]
          active_user_count?: number
        }>(`/company-roles/${crid}/`)
        if (cancel) return
        setSelectedProfilePerms(Array.isArray(data.permissions) ? data.permissions : [])
        setRoleSharedUserCount(
          typeof data.active_user_count === 'number' ? data.active_user_count : null
        )
        setRolePermsDirty(false)
      } catch {
        if (!cancel) {
          setSelectedProfilePerms([])
          setRoleSharedUserCount(null)
          toast.error('Could not load the selected access profile.')
        }
      }
    })()
    return () => {
      cancel = true
    }
  }, [showModal, formData.custom_role_id, toast])

  const fetchCompanies = async () => {
    try {
      const token = localStorage.getItem('access_token')
      const res = await fetch(`${getApiBaseUrl()}/admin/companies/`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        credentials: 'omit'
      })
      if (res.ok) {
        const data = await res.json()
        setCompanies(Array.isArray(data) ? data.map((c: { id: number; name: string }) => ({ id: c.id, name: c.name })) : [])
      }
    } catch {
      setCompanies([])
    }
  }

  const fetchUsers = async () => {
    try {
      const { data } = await api.get<SystemUser[]>('/users/')
      if (Array.isArray(data)) {
        setUsers(data)
      }
    } catch (error: unknown) {
      const err = error as { response?: { status?: number } }
      if (err.response?.status === 401) {
        try {
          localStorage.removeItem('access_token')
        } catch {
          /* ignore */
        }
        router.push('/login')
        toast.error('Session expired. Please login again.')
      } else if (err.response?.status === 403) {
        toast.error('You do not have permission to manage users.')
        router.push('/dashboard')
      } else {
        console.error('Error fetching users:', error)
        toast.error('Error loading users')
      }
    } finally {
      setLoading(false)
    }
  }

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase()
    return users.filter((u) => {
      if (roleFilter && (u.role || '').toLowerCase() !== roleFilter.toLowerCase()) {
        return false
      }
      if (!q) return true
      return (
        (u.full_name || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.username || '').toLowerCase().includes(q) ||
        (u.custom_role_name || '').toLowerCase().includes(q)
      )
    })
  }, [users, userSearch, roleFilter])

  const onProfileMatrixChange = (ids: string[]) => {
    setSelectedProfilePerms(ids)
    setRolePermsDirty(true)
  }

  const onNewProfileMatrixChange = (ids: string[]) => {
    setNewRolePerms(ids)
  }

  const persistCustomRoleIfNeeded = async () => {
    if (!hasAccessContext) return
    const crid = formData.custom_role_id
    if (crid === '' || crid == null) return
    if (!rolePermsDirty) return
    const id = typeof crid === 'string' ? parseInt(String(crid), 10) : (crid as number)
    if (Number.isNaN(id)) return
    await api.put(`/company-roles/${id}/`, { permissions: selectedProfilePerms })
  }

  const openNewAccessProfileModal = () => {
    const nameHint = (formData.full_name || '').trim()
    setNewRoleName(
      nameHint ? `Access: ${nameHint.slice(0, 40)}` : 'New access profile'
    )
    setNewRoleDescription('')
    const rk = (formData.role || 'cashier').toLowerCase()
    setNewProfileStartFrom(rk)
    const seed = roleDefaults[rk]
    if (Array.isArray(seed) && seed.length) {
      setNewRolePerms(permCatalog.filter((c) => seed.includes(c.id)).map((c) => c.id))
    } else {
      setNewRolePerms(permCatalog.length ? permCatalog.map((c) => c.id) : [])
    }
    setShowNewRoleModal(true)
  }

  const submitNewAccessProfile = async () => {
    if (!newRoleName.trim()) {
      toast.error('Please enter a name for the access profile.')
      return
    }
    if (!hasAccessContext) {
      toast.error('Select a company (super admin) or try again as tenant admin.')
      return
    }
    setSavingNewRole(true)
    try {
      const { data } = await api.post<{
        id: number
        name: string
        permissions: string[]
      }>('/company-roles/', {
        name: newRoleName.trim(),
        description: newRoleDescription.trim(),
        permissions: newRolePerms,
      })
      await loadCompanyRolesList()
      setFormData((fd) => ({ ...fd, custom_role_id: data.id }))
      setShowNewRoleModal(false)
      setNewRoleName('')
      setNewRoleDescription('')
      toast.success('Access profile created. It is now selected for this user.')
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data
      toast.error((typeof d?.detail === 'string' ? d.detail : null) || 'Could not create access profile.')
    } finally {
      setSavingNewRole(false)
    }
  }

  const resetForm = () => {
    setFormData({
      username: '',
      email: '',
      full_name: '',
      role: 'cashier',
      company_id: '',
      custom_role_id: '',
      pos_sale_scope: 'both',
      password: '',
      confirmPassword: '',
    })
    setEditingId(null)
    setSelectedProfilePerms([])
    setRolePermsDirty(false)
    setRoleSharedUserCount(null)
    setNewRoleName('')
    setNewRoleDescription('')
    setNewRolePerms([])
    setShowNewRoleModal(false)
    setCreateStep(1)
    setShowAdvancedPerms(false)
    setNewProfileStartFrom('')
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    
    const emailUser = isCompanyOwner ? formData.email : formData.username
    if (!emailUser || !formData.email || !formData.full_name || !formData.password) {
      toast.error('Please fill in all required fields')
      return
    }

    if (formData.password !== formData.confirmPassword) {
      toast.error('Passwords do not match')
      return
    }

    if (formData.password.length < 6) {
      toast.error('Password must be at least 6 characters long')
      return
    }

    try {
      await persistCustomRoleIfNeeded()
      const payload: Record<string, unknown> = {
        username: isCompanyOwner ? formData.email : formData.username,
        email: formData.email,
        full_name: formData.full_name,
        role: formData.role,
        password: formData.password
      }
      if (formData.company_id !== '' && formData.company_id != null) {
        payload.company_id = typeof formData.company_id === 'string' ? parseInt(formData.company_id, 10) : formData.company_id
      }
      if (isCompanyOwner || (isSuperAdminSession && formData.company_id)) {
        if (formData.custom_role_id !== '' && formData.custom_role_id != null) {
          payload.custom_role_id =
            typeof formData.custom_role_id === 'string'
              ? parseInt(String(formData.custom_role_id), 10)
              : formData.custom_role_id
        }
      }
      if (formData.role === 'cashier' || formData.role === 'operator') {
        payload.pos_sale_scope = formData.pos_sale_scope || 'both'
      }
      await api.post('/users/', payload)
      toast.success('User created successfully!')
      setShowModal(false)
      resetForm()
      void fetchUsers()
    } catch (error: unknown) {
      const d = (error as { response?: { data?: { detail?: string } } })?.response?.data
      if (d?.detail) {
        toast.error(String(d.detail))
        return
      }
      console.error('Error creating user:', error)
      toast.error('Error creating user. Check the connection and try again.')
    }
  }

  const handleEdit = (user: SystemUser) => {
    setShowAdvancedPerms(false)
    setEditingId(user.id)
    setFormData({
      username: user.username,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      company_id: user.company_id ?? '',
      custom_role_id: user.custom_role_id ?? '',
      pos_sale_scope: user.pos_sale_scope || 'both',
      password: '',
      confirmPassword: ''
    })
    setShowModal(true)
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingId) return

    if (!formData.email || !formData.full_name) {
      toast.error('Please fill in all required fields')
      return
    }

    if (formData.password && formData.password !== formData.confirmPassword) {
      toast.error('Passwords do not match')
      return
    }

    if (formData.password && formData.password.length < 6) {
      toast.error('Password must be at least 6 characters long')
      return
    }

    try {
      await persistCustomRoleIfNeeded()
      const updateData: Record<string, unknown> = {
        email: formData.email,
        full_name: formData.full_name,
        role: formData.role
      }
      if (formData.company_id !== '' && formData.company_id != null) {
        updateData.company_id = typeof formData.company_id === 'string' ? parseInt(formData.company_id, 10) : formData.company_id
      }
      if (formData.password) {
        updateData.password = formData.password
      }
      if (isCompanyOwner || (isSuperAdminSession && formData.company_id)) {
        updateData.custom_role_id =
          formData.custom_role_id === '' || formData.custom_role_id == null
            ? null
            : typeof formData.custom_role_id === 'string'
              ? parseInt(String(formData.custom_role_id), 10)
              : formData.custom_role_id
      }
      if (formData.role === 'cashier' || formData.role === 'operator') {
        updateData.pos_sale_scope = formData.pos_sale_scope || 'both'
      } else {
        updateData.pos_sale_scope = 'both'
      }

      await api.put(`/users/${editingId}/`, updateData)
      toast.success('User updated successfully!')
      setShowModal(false)
      resetForm()
      void fetchUsers()
    } catch (error: unknown) {
      const d = (error as { response?: { data?: { detail?: string } } })?.response?.data
      if (d?.detail) {
        toast.error(String(d.detail))
        return
      }
      console.error('Error updating user:', error)
      toast.error('Error updating user. Check the connection and try again.')
    }
  }

  const handleSetUserActive = async (user: SystemUser, active: boolean) => {
    const action = active ? 'activate' : 'deactivate'
    if (
      !confirm(
        active
          ? `Allow "${user.full_name}" to sign in again?`
          : `Deactivate "${user.full_name}"?\n\nThey will not be able to sign in. The account stays in the database until you delete it.`
      )
    ) {
      return
    }
    try {
      const token = localStorage.getItem('access_token')
      const response = await fetch(`${getApiBaseUrl()}/users/${user.id}/`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        mode: 'cors',
        credentials: 'omit',
        body: JSON.stringify({ is_active: active })
      })
      if (response.ok) {
        toast.success(active ? 'User activated — they can sign in again.' : 'User deactivated — login disabled.')
        fetchUsers()
      } else {
        let msg = `Failed to ${action} user`
        try {
          const error = await response.json()
          msg = typeof error?.detail === 'string' ? error.detail : msg
        } catch {
          if (response.status === 401) msg = 'Session expired or not authorized — try again after login.'
        }
        toast.error(msg)
      }
    } catch (error) {
      console.error(`Error ${action} user:`, error)
      toast.error('Error connecting to server')
    }
  }

  const handleDelete = async (user: SystemUser) => {
    if (
      !confirm(
        `Permanently remove "${user.full_name}" from the database?\n\nThis cannot be undone. Use Deactivate if you only want to block sign-in.`
      )
    ) {
      return
    }

    try {
      const token = localStorage.getItem('access_token')
      const response = await fetch(`${getApiBaseUrl()}/users/${user.id}/`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        mode: 'cors',
        credentials: 'omit'
      })
      if (response.ok) {
        try {
          const data = await response.json()
          toast.success(typeof data?.detail === 'string' ? data.detail : 'User deleted permanently')
        } catch {
          toast.success('User deleted permanently')
        }
        fetchUsers()
      } else {
        let msg = 'Failed to delete user'
        try {
          const error = await response.json()
          msg = typeof error?.detail === 'string' ? error.detail : msg
        } catch {
          if (response.status === 401) msg = 'Session expired or not authorized — try again after login.'
        }
        toast.error(msg)
      }
    } catch (error) {
      console.error('Error deleting user:', error)
      toast.error('Error connecting to server')
    }
  }

  const getRoleBadgeColor = (role: string) => {
    switch (role.toLowerCase()) {
      case 'admin':
        return 'bg-red-100 text-red-800'
      case 'accountant':
        return 'bg-blue-100 text-blue-800'
      case 'cashier':
        return 'bg-green-100 text-green-800'
      case 'operator':
        return 'bg-teal-100 text-teal-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const roleFilterOptions = useMemo(
    () =>
      Array.from(
        new Set(
          users
            .map((u) => (u.role || 'user').toLowerCase())
            .filter((r) => r.length > 0)
        )
      ).sort((a, b) => a.localeCompare(b)),
    [users]
  )

  const isCreateWizard = !editingId
  const showModalAccount = Boolean(editingId || (isCreateWizard && createStep === 1))
  const showModalAccess = Boolean(editingId || (isCreateWizard && createStep === 2))
  const showModalPassword = Boolean(editingId || (isCreateWizard && createStep === 3))

  const canProceedFromStep1 = () => {
    if (!formData.email?.trim() || !formData.full_name?.trim()) return false
    if (!isCompanyOwner && !String(formData.username).trim()) return false
    const ident = isCompanyOwner ? formData.email : formData.username
    return Boolean(String(ident).trim())
  }

  const goNext = () => {
    if (createStep === 1) {
      if (!canProceedFromStep1()) {
        toast.error('Please enter the required name and sign-in address.')
        return
      }
      setCreateStep(2)
      return
    }
    if (createStep === 2) {
      setCreateStep(3)
    }
  }

  const goBack = () => {
    if (createStep > 1) {
      setCreateStep((s) => s - 1)
    }
  }

  if (loading) {
    return (
      <PageLayout>
        <div className="flex min-h-[50vh] items-center justify-center app-scroll-pad">
          <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600" />
        </div>
      </PageLayout>
    )
  }

  const hasListFilters = Boolean(userSearch.trim() || roleFilter)

  return (
    <PageLayout>
      <div className="app-scroll-pad mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 lg:mb-8">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">People &amp; access</p>
              <h1 className="mt-1 text-2xl font-bold text-gray-900 sm:text-3xl">Users</h1>
              <p className="mt-1 max-w-2xl text-sm text-gray-600 sm:text-base">
                {isCompanyOwner
                  ? 'Invite your team. Staff use their work email to sign in. A job type sets a sensible default; optional access profiles fine-tune which apps they see (manage profiles on Roles or below when adding a user).'
                  : 'Create and review accounts, assign a job type and company, and (for tenants) optional custom access profiles.'}
              </p>
            </div>
            <div className="flex flex-shrink-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-3">
              <div className="flex items-center rounded-lg border border-gray-200 bg-white p-0.5 shadow-sm">
                <button
                  type="button"
                  onClick={() => {
                    setViewMode('card')
                    localStorage.setItem('users_view_mode', 'card')
                  }}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    viewMode === 'card'
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                  title="Card view"
                >
                  <Grid3x3 className="h-4 w-4" />
                  Cards
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setViewMode('list')
                    localStorage.setItem('users_view_mode', 'list')
                  }}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    viewMode === 'list'
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                  title="List view"
                >
                  <List className="h-4 w-4" />
                  List
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  resetForm()
                  setShowModal(true)
                }}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700"
              >
                <Users className="h-4 w-4" />
                Add user
              </button>
            </div>
          </div>

          {users.length > 0 && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
                <input
                  type="search"
                  className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="Search by name, email, username, or access profile…"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  aria-label="Filter users by search"
                />
              </div>
              <div className="flex w-full min-w-0 sm:w-48 sm:flex-none">
                <label className="w-full sm:sr-only" htmlFor="users-role-filter">
                  Filter by job type
                </label>
                <select
                  id="users-role-filter"
                  className="w-full rounded-lg border border-gray-200 py-2 pl-2 pr-8 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                >
                  <option value="">All job types</option>
                  {roleFilterOptions.map((r) => (
                    <option key={r} value={r}>
                      {getRoleDisplayName(r)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        {users.length > 0 && hasListFilters && filteredUsers.length === 0 && (
          <div className="mb-6 flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
            <span>No users match your filters.</span>
            <button
              type="button"
              className="shrink-0 text-sm font-medium text-amber-800 underline decoration-amber-400 hover:text-amber-950"
              onClick={() => {
                setUserSearch('')
                setRoleFilter('')
              }}
            >
              Clear search and job filter
            </button>
          </div>
        )}

          {users.length > 0 && viewMode === 'card' && (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {filteredUsers.map((user) => (
                <div key={user.id} className="bg-white rounded-lg shadow p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-3">
                      <div className="p-2 bg-gray-100 rounded-full">
                        <User className="h-6 w-6 text-gray-600" />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">{user.full_name}</h3>
                        <p className="text-sm text-gray-600">@{user.username}</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 mb-4">
                    <p className="text-sm text-gray-600">
                      <span className="font-medium">Email:</span> {user.email}
                    </p>
                    {(user.company_id != null || user.company_name) && !isCompanyOwner && (
                      <p className="text-sm text-gray-600">
                        <span className="font-medium">Company:</span> {user.company_name || '—'} (ID:{' '}
                        {user.company_id ?? '—'})
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <Shield className="h-4 w-4 shrink-0 text-gray-400" />
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${getRoleBadgeColor(user.role)}`}
                        title="Job type"
                      >
                        {getRoleDisplayName(user.role)}
                      </span>
                      {user.custom_role_name ? (
                        <span
                          className="max-w-full truncate rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-900"
                          title="Access profile"
                        >
                          {user.custom_role_name}
                        </span>
                      ) : null}
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      <span
                        className={`px-2 py-1 text-xs rounded-full ${
                          user.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {user.is_active ? 'Active' : 'Inactive'}
                      </span>
                      <span className="text-xs text-gray-500">
                        Joined {user.created_at ? formatDate(user.created_at, true) : 'N/A'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-1 pt-4 border-t">
                    <button
                      type="button"
                      onClick={() => handleEdit(user)}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                      title="Edit User"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    {currentSessionUserId !== null && user.id === currentSessionUserId ? (
                      <span className="px-2 text-xs text-gray-400" title="You cannot change your own account here">
                        —
                      </span>
                    ) : (
                      <>
                        {user.is_active ? (
                          <button
                            type="button"
                            onClick={() => handleSetUserActive(user, false)}
                            className="p-2 text-amber-600 hover:bg-amber-50 rounded"
                            title="Deactivate login (keeps the user record)"
                          >
                            <Ban className="h-4 w-4" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSetUserActive(user, true)}
                            className="p-2 text-green-600 hover:bg-green-50 rounded"
                            title="Activate login"
                          >
                            <UserCheck className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDelete(user)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded"
                          title="Permanently delete user from database"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {users.length > 0 && viewMode === 'list' && (
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th
                        scope="col"
                        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600"
                      >
                        Name
                      </th>
                      <th
                        scope="col"
                        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600"
                      >
                        Username
                      </th>
                      <th
                        scope="col"
                        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600"
                      >
                        Email
                      </th>
                      {!isCompanyOwner && (
                        <th
                          scope="col"
                          className="hidden lg:table-cell px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600"
                        >
                          Company
                        </th>
                      )}
                      <th
                        scope="col"
                        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600"
                      >
                        Job type
                      </th>
                      <th
                        scope="col"
                        className="hidden sm:table-cell px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600"
                      >
                        Access profile
                      </th>
                      <th
                        scope="col"
                        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600"
                      >
                        Status
                      </th>
                      <th
                        scope="col"
                        className="hidden md:table-cell px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600"
                      >
                        Joined
                      </th>
                      <th scope="col" className="relative px-4 py-3">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {filteredUsers.map((user) => (
                      <tr key={user.id} className="hover:bg-gray-50/80">
                        <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                          {user.full_name}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">@{user.username}</td>
                        <td className="max-w-[200px] truncate px-4 py-3 text-sm text-gray-600" title={user.email}>
                          {user.email}
                        </td>
                        {!isCompanyOwner && (
                          <td className="hidden max-w-[180px] truncate px-4 py-3 text-sm text-gray-600 lg:table-cell">
                            {user.company_name || '—'}
                            {user.company_id != null ? (
                              <span className="text-gray-400"> · {user.company_id}</span>
                            ) : null}
                          </td>
                        )}
                        <td className="whitespace-nowrap px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${getRoleBadgeColor(user.role)}`}
                          >
                            <Shield className="h-3 w-3 opacity-70" />
                            {getRoleDisplayName(user.role)}
                          </span>
                        </td>
                        <td className="hidden max-w-[160px] truncate px-4 py-3 text-sm text-gray-600 sm:table-cell">
                          {user.custom_role_name || '—'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                              user.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {user.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="hidden whitespace-nowrap px-4 py-3 text-sm text-gray-500 md:table-cell">
                          {user.created_at ? formatDate(user.created_at, true) : '—'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <div className="flex flex-wrap items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => handleEdit(user)}
                              className="inline-flex rounded p-1.5 text-blue-600 hover:bg-blue-50"
                              title="Edit"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                            {currentSessionUserId !== null && user.id === currentSessionUserId ? (
                              <span className="px-2 text-xs text-gray-400">—</span>
                            ) : (
                              <>
                                {user.is_active ? (
                                  <button
                                    type="button"
                                    onClick={() => handleSetUserActive(user, false)}
                                    className="inline-flex rounded p-1.5 text-amber-600 hover:bg-amber-50"
                                    title="Deactivate login"
                                  >
                                    <Ban className="h-4 w-4" />
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleSetUserActive(user, true)}
                                    className="inline-flex rounded p-1.5 text-green-600 hover:bg-green-50"
                                    title="Activate login"
                                  >
                                    <UserCheck className="h-4 w-4" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleDelete(user)}
                                  className="inline-flex rounded p-1.5 text-red-600 hover:bg-red-50"
                                  title="Permanently delete"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {users.length === 0 && (
            <div className="bg-white rounded-lg shadow p-12 text-center">
              <p className="text-gray-500 mb-4">No users found. Create your first user to get started.</p>
              <button 
                onClick={() => {
                  resetForm()
                  setShowModal(true)
                }}
                className="inline-flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                <Plus className="h-5 w-5" />
                <span>Add User</span>
              </button>
            </div>
          )}
        </div>

      {/* User Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[min(90vh,880px)] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="sticky top-0 z-10 space-y-3 border-b border-white/15 bg-gradient-to-r from-slate-800 to-slate-900 px-5 py-3 sm:px-6 sm:py-4">
              {isCreateWizard && (
                <nav className="flex items-center justify-between gap-0.5 sm:gap-2" aria-label="Add user steps">
                  {CREATE_STEPS.map((s) => {
                    const Icon = s.icon
                    const on = createStep === s.n
                    const done = createStep > s.n
                    return (
                      <div
                        key={s.n}
                        className="flex min-w-0 flex-1 flex-col items-center text-center"
                      >
                        <span
                          className={`mb-0.5 flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold sm:h-8 sm:w-8 sm:text-xs ${
                            on
                              ? 'bg-white text-slate-900'
                              : done
                                ? 'bg-emerald-500/25 text-white ring-1 ring-white/40'
                                : 'bg-white/10 text-white/50'
                          }`}
                        >
                          {done ? '✓' : <Icon className="h-3.5 w-3.5" />}
                        </span>
                        <span
                          className={`hidden w-full max-w-[6.5rem] truncate text-[9px] font-semibold sm:block ${
                            on ? 'text-white' : 'text-slate-400'
                          }`}
                        >
                          {s.title}
                        </span>
                      </div>
                    )
                  })}
                </nav>
              )}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-white sm:text-2xl">
                    {editingId ? 'Edit team member' : 'Add a team member'}
                  </h2>
                  <p className="mt-0.5 text-[11px] text-slate-300 sm:text-sm">
                    {isCreateWizard
                      ? 'Use Next to move through account → access → password.'
                      : 'Update identity, what they can open, and their password.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false)
                    resetForm()
                  }}
                  className="shrink-0 rounded-full p-1.5 text-white/90 hover:bg-white/10"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <form
              noValidate
              className="p-5 sm:p-6"
              onSubmit={(e) => {
                e.preventDefault()
                if (editingId) {
                  void handleUpdate(e)
                } else if (createStep === 3) {
                  void handleCreate(e)
                }
              }}
            >
              <div className="space-y-6">
                {showModalAccount && (
                <div className="border-b border-gray-100 pb-5">
                  <h3 className="mb-3 text-base font-semibold text-gray-900">Account</h3>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {!isCompanyOwner && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Username <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={formData.username}
                          onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                          disabled={!!editingId}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
                          placeholder="johndoe"
                        />
                      </div>
                    )}
                    <div className={isCompanyOwner ? 'md:col-span-2' : ''}>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Email address (username) <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="email"
                        required
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
                        placeholder="staff@company.com"
                      />
                      {isCompanyOwner && (
                        <p className="text-xs text-gray-500 mt-1">Used to log in.</p>
                      )}
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Full Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.full_name}
                        onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="John Doe"
                      />
                    </div>
                    {!isCompanyOwner && (
                      <div className="md:col-span-2">
                        <label className="mb-2 block text-sm font-medium text-gray-700">Company (optional)</label>
                        <select
                          value={formData.company_id === '' || formData.company_id == null ? '' : String(formData.company_id)}
                          onChange={(e) => {
                            const v = e.target.value === '' ? '' : e.target.value
                            setFormData((fd) => ({ ...fd, company_id: v, custom_role_id: '' }))
                            if (isSuperAdminSession && v) {
                              void loadCompanyRolesList()
                            }
                          }}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">— No company —</option>
                          {companies.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} (ID: {c.id})
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 flex items-start gap-1 text-xs text-gray-500">
                          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          Custom access profiles and roles load after you pick a company.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
                )}

                {showModalAccess && (
                <div className="border-b border-gray-100 pb-5">
                  <h3 className="mb-3 text-base font-semibold text-gray-900">What they can do</h3>
                  <p className="mb-3 text-sm text-gray-600">
                    <span className="font-medium">Job type</span> sets defaults. An optional{' '}
                    <span className="font-medium">access profile</span> overrides with a named template.
                  </p>
                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-gray-700">
                        Job type <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={formData.role}
                        onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                        className="w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="admin">Admin</option>
                        <option value="accountant">Accountant</option>
                        <option value="cashier">Cashier</option>
                        {!isCompanyOwner && (
                          <option value="operator">Register operator (limited POS)</option>
                        )}
                      </select>
                      <p className="mt-1.5 flex items-start gap-1 text-xs text-gray-600">
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {JOB_TITLE_HINT[formData.role] || 'Default app areas apply when no custom profile is selected.'}
                      </p>
                      {(formData.role === 'cashier' || formData.role === 'operator') && (
                        <div className="mt-4 max-w-4xl rounded-xl border border-gray-200 bg-gray-50/80 p-4">
                          <PosSaleScopeSelector
                            name="tenant-user-pos-scope"
                            value={formData.pos_sale_scope}
                            onChange={(next) =>
                              setFormData((fd) => ({ ...fd, pos_sale_scope: next }))
                            }
                          />
                        </div>
                      )}
                    </div>
                    {hasAccessContext && (
                      <div className="space-y-3 border-t border-gray-100 pt-3">
                        <h4 className="text-sm font-semibold text-gray-900">Custom access (optional)</h4>
                        <p className="text-xs text-gray-500">
                          If you pick a profile, expand <strong>Advanced</strong> to change which modules that profile
                          includes (saved with the user). Leave empty to use job-type defaults only.
                        </p>
                        {roleSharedUserCount != null && roleSharedUserCount > 1 && rolePermsDirty && formData.custom_role_id ? (
                          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                            This access profile is assigned to <strong>{roleSharedUserCount}</strong> active users.
                            Saving will change the menu and apps for <strong>all of them</strong>. To give only this user
                            different access, use <strong>New access profile</strong> first, then select it.
                          </p>
                        ) : null}
                        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                          <div className="min-w-0 flex-1">
                            <label className="block text-sm font-medium text-gray-700 mb-2">Access profile (optional)</label>
                            <select
                              value={
                                formData.custom_role_id === '' || formData.custom_role_id == null
                                  ? ''
                                  : String(formData.custom_role_id)
                              }
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  custom_role_id: e.target.value === '' ? '' : e.target.value,
                                })
                              }
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            >
                              <option value="">
                                — None: use the job role&apos;s default permissions (above) —
                              </option>
                              {companyRoles.map((cr) => (
                                <option key={cr.id} value={cr.id}>
                                  {cr.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={openNewAccessProfileModal}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-900 hover:bg-indigo-100"
                            >
                              <Sparkles className="h-4 w-4" />
                              New access profile
                            </button>
                            <Link
                              href="/roles"
                              className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                            >
                              Full roles list
                            </Link>
                          </div>
                        </div>
                        {formData.custom_role_id !== '' && formData.custom_role_id != null && permCatalog.length > 0 ? (
                          <div className="overflow-hidden rounded-xl border border-gray-200">
                            <button
                              type="button"
                              className="flex w-full items-center justify-between gap-2 bg-gray-50/90 px-3 py-2.5 text-left text-sm font-medium text-gray-800 hover:bg-gray-100/90"
                              onClick={() => setShowAdvancedPerms((v) => !v)}
                              aria-expanded={showAdvancedPerms}
                            >
                              <span>
                                Advanced: edit modules in this profile ({selectedProfilePerms.length} / {permCatalog.length} allowed)
                              </span>
                              <ChevronRight
                                className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${
                                  showAdvancedPerms ? 'rotate-90' : ''
                                }`}
                              />
                            </button>
                            {showAdvancedPerms && (
                              <div className="border-t border-gray-100 bg-white p-3 sm:p-4">
                                <PermissionMatrix
                                  idPrefix="userform-perm"
                                  catalog={permCatalog as PermItem[]}
                                  selected={selectedProfilePerms}
                                  onChange={onProfileMatrixChange}
                                  listClassName="max-h-56 sm:max-h-64"
                                />
                                <p className="mt-2 text-[11px] text-gray-500">
                                  Unchecked areas stay hidden in the app launcher. Saving the user also updates this profile.
                                </p>
                              </div>
                            )}
                          </div>
                        ) : hasAccessContext && (formData.custom_role_id === '' || formData.custom_role_id == null) ? (
                          <p className="text-xs text-gray-500">
                            No custom profile: staff keep the default permissions for the selected job title. Create a
                            profile to fine-tune modules, or go to the{' '}
                            <Link href="/roles" className="text-indigo-600 hover:underline">
                              Roles
                            </Link>{' '}
                            page to manage all profiles.
                          </p>
                        ) : formData.custom_role_id && permCatalog.length === 0 ? (
                          <p className="text-xs text-amber-700">Loading access catalog… if this persists, reload the page.</p>
                        ) : null}
                      </div>
                    )}
                    {!hasAccessContext && (isSuperAdminSession || isCompanyOwner) && (
                      <p className="text-xs text-gray-600">
                        {isSuperAdminSession
                          ? 'Select a company in the first step to enable company access profiles and role templates.'
                          : 'Access profile options apply to your company’s users.'}
                      </p>
                    )}
                  </div>
                </div>
                )}

                {showModalPassword && (
                <div className="pb-1">
                  <h3 className="mb-3 text-base font-semibold text-gray-900">Sign-in password</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {editingId ? 'New Password (leave blank to keep current)' : 'Password'} <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <input
                          type={showPassword ? "text" : "password"}
                          required={!editingId}
                          value={formData.password}
                          onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                          className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="••••••••"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none"
                          aria-label={showPassword ? "Hide password" : "Show password"}
                        >
                          {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Confirm Password <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <input
                          type={showConfirmPassword ? "text" : "password"}
                          required={!editingId}
                          value={formData.confirmPassword}
                          onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                          className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="••••••••"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none"
                          aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                        >
                          {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="mt-6 flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false)
                    resetForm()
                  }}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                >
                  Cancel
                </button>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {isCreateWizard && createStep > 1 && (
                    <button
                      type="button"
                      onClick={goBack}
                      className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50"
                    >
                      Back
                    </button>
                  )}
                  {isCreateWizard && createStep < 3 && (
                    <button
                      type="button"
                      onClick={goNext}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  )}
                  {(!isCreateWizard || createStep === 3) && (
                    <button
                      type="submit"
                      className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
                    >
                      {editingId ? 'Save changes' : 'Create user'}
                    </button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {showNewRoleModal && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center overflow-y-auto bg-black/50 p-4 sm:items-center">
          <div
            className="max-h-[min(90vh,720px)] w-full max-w-lg overflow-y-auto rounded-xl border border-gray-200 bg-white p-5 shadow-2xl"
            role="dialog"
            aria-modal
            aria-labelledby="new-profile-title"
          >
            <h3 id="new-profile-title" className="text-lg font-semibold text-gray-900">
              New access profile
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              Saved as a company role. It will be selected for the user in this form; you can re-use the same profile
              for other users later.
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Name</label>
                <input
                  className="mt-0.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                  placeholder="e.g. Front desk (limited)"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Description (optional)</label>
                <textarea
                  className="mt-0.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  value={newRoleDescription}
                  onChange={(e) => setNewRoleDescription(e.target.value)}
                  rows={2}
                  placeholder="What is this role for?"
                />
              </div>
              {permCatalog.length > 0 ? (
                <div>
                  <label className="text-xs font-medium text-gray-600" htmlFor="new-profile-seed">
                    Start from a job type (optional)
                  </label>
                  <select
                    id="new-profile-seed"
                    className="mt-0.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                    value={newProfileStartFrom}
                    onChange={(e) => {
                      const v = e.target.value
                      setNewProfileStartFrom(v)
                      const seed = v ? roleDefaults[v] : null
                      if (Array.isArray(seed) && seed.length) {
                        setNewRolePerms(permCatalog.filter((c) => seed.includes(c.id)).map((c) => c.id))
                      } else if (!v) {
                        setNewRolePerms([])
                      }
                    }}
                  >
                    <option value="">— Build from scratch (or deny all) —</option>
                    {(['admin', 'accountant', 'cashier', 'operator'] as const).map((k) => (
                      <option key={k} value={k}>
                        {`Match ${getRoleDisplayName(k)} defaults`}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-gray-500">
                    Same defaults as a built-in job type; you can adjust each module below.
                  </p>
                  <p className="mt-2 text-xs font-medium text-gray-600">Module access</p>
                  <PermissionMatrix
                    idPrefix="newrole"
                    catalog={permCatalog as PermItem[]}
                    selected={newRolePerms}
                    onChange={onNewProfileMatrixChange}
                    listClassName="max-h-48"
                  />
                </div>
              ) : (
                <p className="text-xs text-amber-700">Loading permission list…</p>
              )}
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4">
              <button
                type="button"
                onClick={() => {
                  setShowNewRoleModal(false)
                  setNewRoleName('')
                  setNewRoleDescription('')
                }}
                className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingNewRole || !newRoleName.trim() || permCatalog.length === 0}
                onClick={() => void submitNewAccessProfile()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {savingNewRole ? 'Creating…' : 'Create & select'}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  )
}

