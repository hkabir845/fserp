'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { CompanyProvider, useCompany } from '@/contexts/CompanyContext'
import {
  Users,
  Plus,
  Edit2,
  Trash2,
  UserCheck,
  OctagonAlert,
  X,
  Eye,
  EyeOff,
  MapPin,
} from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { safeLogError, isConnectionError } from '@/utils/connectionError'
import { messageForAdminListError } from '@/utils/adminApiErrors'
import { formatDate } from '@/utils/date'
import { useRequireSaasDashboardMode } from '@/hooks/useRequireSaasDashboardMode'
import {
  PosSaleScopeSelector,
  formatPosSaleScopeShort,
} from '@/components/pos/PosSaleScopeSelector'

interface AdminUser {
  id: number
  username: string
  email: string
  full_name: string
  role: string
  pos_sale_scope?: string
  company_id: number | null
  company_name: string | null
  is_active: boolean
  created_at: string
  home_station_id?: number | null
  home_station_name?: string | null
}

type TenantStationOption = {
  id: number
  station_name: string
  station_number?: string
  is_active?: boolean
}

function UsersPageContent() {
  const router = useRouter()
  const toast = useToast()
  useRequireSaasDashboardMode()
  const { mode } = useCompany()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [showUserModal, setShowUserModal] = useState(false)
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [showEditPassword, setShowEditPassword] = useState(false)
  const [companies, setCompanies] = useState<{ id: number; name: string }[]>([])
  const [userFormData, setUserFormData] = useState({
    email: '',
    full_name: '',
    role: 'admin',
    pos_sale_scope: 'both',
    home_station_id: '' as string | number,
    password: '',
    confirmPassword: '',
    company_id: ''
  })
  const [tenantStationsForForm, setTenantStationsForForm] = useState<TenantStationOption[]>([])
  const [showInactiveUsers, setShowInactiveUsers] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)

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
        if (typeof user?.id === 'number') {
          setCurrentUserId(user.id)
        }
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
      fetchUsers()
      fetchCompanies()
    } else {
      setLoading(false)
    }
  }, [mode, router]) // Only depend on mode to avoid infinite loops

  useEffect(() => {
    const cid = userFormData.company_id
    const role = userFormData.role
    if (!cid || (role !== 'cashier' && role !== 'operator')) {
      setTenantStationsForForm([])
      return
    }
    let cancelled = false
    const companyIdNum = parseInt(String(cid), 10)
    if (!Number.isFinite(companyIdNum)) {
      setTenantStationsForForm([])
      return
    }
    void api
      .get<{ stations?: TenantStationOption[] }>(`/admin/companies/${companyIdNum}/stations/`)
      .then(res => {
        if (cancelled) return
        const rows = res.data?.stations
        const list = Array.isArray(rows) ? rows : []
        setTenantStationsForForm(
          list.filter(s => s && s.is_active !== false && Number.isFinite(Number(s.id)))
        )
      })
      .catch(() => {
        if (!cancelled) setTenantStationsForForm([])
      })
    return () => {
      cancelled = true
    }
  }, [userFormData.company_id, userFormData.role])

  const fetchCompanies = async () => {
    try {
      const response = await api.get('/admin/companies')
      if (response.data && Array.isArray(response.data)) {
        setCompanies(response.data.map((c: { id: number; name: string }) => ({ id: c.id, name: c.name })))
      }
    } catch (error: any) {
      if (!isConnectionError(error)) safeLogError('[Users] Error fetching companies:', error)
    }
  }

  const fetchUsers = async () => {
    try {
      setLoading(true)
      
      const response = await api.get('/admin/users/', { params: { limit: 500 } })
      
      if (response.data) {
        // Handle both array and object responses
        const usersList = Array.isArray(response.data) ? response.data : (response.data.users || [])
        setUsers(usersList)
        // Notify sidebar to update counts
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('adminCountsUpdated'))
        }
      } else {
        console.warn('[Users] No users data in response')
        setUsers([])
      }
    } catch (error: any) {
      if (!isConnectionError(error)) {
        safeLogError('[Users] Error fetching users:', error)
        safeLogError('[Users] Error details:', {
          message: error.message,
          code: error.code,
          status: error.response?.status,
          data: error.response?.data
        })
        toast.error(messageForAdminListError(error, 'users'))
      }
      setUsers([])
    } finally {
      setLoading(false)
    }
  }

  const handleCreateUser = () => {
    setEditingUser(null)
    setUserFormData({
      email: '',
      full_name: '',
      role: 'admin',
      pos_sale_scope: 'both',
      home_station_id: '',
      password: '',
      confirmPassword: '',
      company_id: ''
    })
    setShowUserModal(true)
  }

  const handleEditUser = (user: AdminUser) => {
    setEditingUser(user)
    setUserFormData({
      email: user.email || user.username,
      full_name: user.full_name,
      role: user.role,
      pos_sale_scope: user.pos_sale_scope || 'both',
      home_station_id:
        user.home_station_id != null && user.home_station_id > 0 ? user.home_station_id : '',
      password: '',
      confirmPassword: '',
      company_id: user.company_id?.toString() || ''
    })
    setShowUserModal(true)
  }

  const needsCompany =
    userFormData.role === 'admin' ||
    userFormData.role === 'accountant' ||
    userFormData.role === 'cashier' ||
    userFormData.role === 'operator'

  const handleSubmitUser = async (e: React.FormEvent) => {
    e.preventDefault()

    if (userFormData.role === 'super_admin') {
      if (!userFormData.email || !userFormData.full_name) {
        toast.error('Email address and full name are required')
        return
      }
    } else {
      if (!userFormData.company_id) {
        toast.error('Select a company for this user')
        return
      }
      if (!userFormData.email || !userFormData.full_name) {
        toast.error('Email address and full name are required')
        return
      }
    }

    if (!editingUser && !userFormData.password) {
      toast.error('Password is required for new users')
      return
    }

    if (userFormData.password && userFormData.password !== userFormData.confirmPassword) {
      toast.error('Passwords do not match')
      return
    }

    try {
      const companyId =
        userFormData.role === 'super_admin'
          ? null
          : userFormData.company_id
            ? parseInt(userFormData.company_id, 10)
            : null

      const userData: any = {
        username: userFormData.email,
        email: userFormData.email,
        full_name: userFormData.full_name,
        role: userFormData.role,
        company_id: companyId
      }

      if (userFormData.password) {
        userData.password = userFormData.password
      }
      if (userFormData.role === 'cashier' || userFormData.role === 'operator') {
        userData.pos_sale_scope = userFormData.pos_sale_scope || 'both'
        if (userFormData.home_station_id === '' || userFormData.home_station_id == null) {
          userData.home_station_id = null
        } else {
          userData.home_station_id =
            typeof userFormData.home_station_id === 'string'
              ? parseInt(String(userFormData.home_station_id), 10)
              : userFormData.home_station_id
        }
      } else {
        userData.pos_sale_scope = 'both'
        if (
          editingUser &&
          (editingUser.role === 'cashier' || editingUser.role === 'operator')
        ) {
          userData.home_station_id = null
        }
      }

      if (editingUser) {
        await api.put(`/users/${editingUser.id}/`, userData)
        toast.success('User updated successfully!')
      } else {
        await api.post('/users/', userData)
        toast.success(
          userFormData.role === 'admin'
            ? 'Company admin created. They sign in with this email and password.'
            : 'User created successfully!'
        )
      }
      setShowUserModal(false)
      await fetchUsers()
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.response?.data?.message || 'Failed to save user'
      toast.error(errorMsg)
      safeLogError('User error:', error)
    }
  }

  const handleDeactivateUser = async (user: AdminUser) => {
    if (
      !confirm(
        `Deactivate login for "${user.full_name}"?\n\nThey will not be able to sign in. The account stays in the database (turn on "Show inactive users" below if you hide inactive rows).`
      )
    ) {
      return
    }

    try {
      await api.put(`/users/${user.id}/`, { is_active: false })
      toast.success('User deactivated — login disabled. Status column shows Inactive.')
      await fetchUsers()
    } catch (error: any) {
      const data = error.response?.data
      let errorMsg = data?.detail || data?.message || 'Failed to deactivate user'
      if (data?.error && typeof data.error === 'string') {
        errorMsg += ` (${data.error})`
      }
      toast.error(errorMsg)
      safeLogError('Deactivate user error:', error)
    }
  }

  const handleActivateUser = async (user: AdminUser) => {
    try {
      await api.put(`/users/${user.id}/`, { is_active: true })
      toast.success(`"${user.full_name}" can sign in again.`)
      await fetchUsers()
    } catch (error: any) {
      const data = error.response?.data
      const errorMsg = data?.detail || data?.message || 'Failed to activate user'
      toast.error(errorMsg)
      safeLogError('Activate user error:', error)
    }
  }

  const handlePermanentDeleteUser = async (user: AdminUser) => {
    if (
      !confirm(
        `Permanently DELETE "${user.full_name}" from the database?\n\nThis cannot be undone. The login username can be reused later for a new user.`
      )
    ) {
      return
    }
    const word = 'DELETE'
    const typed =
      typeof window !== 'undefined' ? window.prompt(`Type ${word} to confirm permanent deletion:`) : null
    if (typed !== word) {
      if (typed !== null) {
        toast.error('Confirmation did not match — nothing was deleted.')
      }
      return
    }
    try {
      await api.delete(`/users/${user.id}/`)
      toast.success('User permanently removed from the database.')
      await fetchUsers()
    } catch (error: any) {
      const data = error.response?.data
      let errorMsg = data?.detail || data?.message || 'Failed to permanently delete user'
      if (data?.error && typeof data.error === 'string') {
        errorMsg += ` (${data.error})`
      }
      toast.error(errorMsg)
      safeLogError('Permanent delete user error:', error)
    }
  }

  const visibleUsers = users.filter((u) => showInactiveUsers || u.is_active)
  const inactiveCount = users.filter((u) => !u.is_active).length

  if (mode !== 'saas_dashboard') {
    return (
      <div className="flex h-screen page-with-sidebar">
        <Sidebar />
        <div className="flex-1 overflow-y-auto app-scroll-pad">
          <div className="bg-white rounded-lg shadow app-modal-pad text-center">
            <p className="text-muted-foreground">Please switch to SaaS Dashboard mode to manage users.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen page-with-sidebar">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="app-scroll-pad">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-bold text-foreground">All Users</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                <strong>Status</strong> is <span className="text-success">Active</span> or{' '}
                <span className="text-destructive">Inactive</span>. The trash icon{' '}
                <strong>deactivates</strong> login (the row stays). Use <strong>Activate</strong> to
                allow sign-in again. The <span className="inline-flex items-center gap-0.5 align-middle">
                  <OctagonAlert className="inline h-3.5 w-3.5 text-rose-700" aria-hidden />
                </span>{' '}
                <strong className="text-rose-800">permanently deletes</strong> the user from the database
                (you must type DELETE to confirm). You cannot remove or deactivate your own account
                here. You cannot delete the last active Super Admin.
              </p>
              <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-foreground/85">
                <input
                  type="checkbox"
                  className="rounded border-input text-primary focus:ring-ring"
                  checked={showInactiveUsers}
                  onChange={(e) => setShowInactiveUsers(e.target.checked)}
                />
                Show inactive users
                {inactiveCount > 0 && (
                  <span className="text-muted-foreground">({inactiveCount} inactive)</span>
                )}
              </label>
            </div>
            <button
              onClick={handleCreateUser}
              className="flex shrink-0 items-center space-x-2 self-start rounded-lg bg-primary px-4 py-2 text-white transition-colors hover:bg-primary"
            >
              <Plus className="h-5 w-5" />
              <span>New User</span>
            </button>
          </div>

          {loading ? (
            <div className="bg-white rounded-lg shadow app-modal-pad text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-muted-foreground">Loading users...</p>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">User</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Role</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Company</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Joined</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-border">
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center">
                        <Users className="h-12 w-12 text-muted-foreground/70 mx-auto mb-4" />
                        <p className="text-muted-foreground text-lg mb-2">No users found</p>
                        <p className="text-muted-foreground text-sm mb-4">Users will appear here once companies are created</p>
                        <button
                          onClick={handleCreateUser}
                          className="erp-btn-primary transition-colors"
                        >
                          Create User
                        </button>
                      </td>
                    </tr>
                  ) : visibleUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                        <p className="mb-2">All users are inactive and hidden.</p>
                        <button
                          type="button"
                          onClick={() => setShowInactiveUsers(true)}
                          className="text-sm font-medium text-primary hover:text-primary/80"
                        >
                          Show inactive users
                        </button>
                      </td>
                    </tr>
                  ) : (
                    visibleUsers.map((user) => (
                      <tr key={user.id} className="hover:bg-muted/40">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div>
                            <div className="text-sm font-medium text-foreground">{user.full_name}</div>
                            <div className="text-xs text-muted-foreground">{user.email || user.username}</div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            user.role === 'super_admin' ? 'bg-purple-100 text-purple-800' :
                            user.role === 'admin' ? 'bg-blue-100 text-primary' :
                            user.role === 'accountant' ? 'bg-success/15 text-success' :
                            user.role === 'cashier' ? 'bg-yellow-100 text-yellow-800' :
                            user.role === 'operator' ? 'bg-teal-100 text-primary' :
                            'bg-muted text-foreground'
                          }`}>
                            {user.role.replace('_', ' ').toUpperCase()}
                          </span>
                          {(user.role === 'cashier' || user.role === 'operator') && (
                            <div className="mt-1 text-[11px] font-medium tabular-nums text-muted-foreground">
                              Lane: {formatPosSaleScopeShort(user.pos_sale_scope)}
                              {user.home_station_id ? (
                                <span className="mt-0.5 block text-muted-foreground">
                                  Site: {(user.home_station_name || '').trim() || `#${user.home_station_id}`}
                                </span>
                              ) : null}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-foreground">
                            {user.company_name
                              ? `${user.company_name} (ID: ${user.company_id})`
                              : (user.role === 'super_admin' ? 'ERP superuser (platform owner)' : 'No company')}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            user.is_active
                              ? 'bg-success/15 text-success'
                              : 'bg-destructive/10 text-destructive'
                          }`}>
                            {user.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                          {user.created_at ? formatDate(user.created_at, true) : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <button
                              onClick={() => handleEditUser(user)}
                              className="rounded p-1.5 text-primary transition-colors hover:bg-accent hover:text-blue-900"
                              title="Edit user"
                              type="button"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                            {currentUserId !== null && user.id === currentUserId ? (
                              <span
                                className="px-2 text-xs text-muted-foreground/70"
                                title="You cannot deactivate, activate, or permanently delete your own account from this screen"
                              >
                                —
                              </span>
                            ) : (
                              <>
                                {user.is_active ? (
                                  <button
                                    type="button"
                                    onClick={() => handleDeactivateUser(user)}
                                    className="rounded p-1.5 text-destructive transition-colors hover:bg-destructive/5 hover:text-red-900"
                                    title="Deactivate login (keeps the user record)"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleActivateUser(user)}
                                    className="rounded p-1.5 text-success transition-colors hover:bg-green-50 hover:text-green-900"
                                    title="Activate login"
                                  >
                                    <UserCheck className="h-4 w-4" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handlePermanentDeleteUser(user)}
                                  className="rounded p-1.5 text-rose-800 transition-colors hover:bg-rose-50 hover:text-rose-950"
                                  title="Permanently delete user (cannot undo)"
                                >
                                  <OctagonAlert className="h-4 w-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* User Modal */}
          {showUserModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="erp-hero-strip">
                  <h2 className="text-2xl font-bold text-white">
                    {editingUser ? 'Edit User' : 'New User'}
                  </h2>
                  <button
                    onClick={() => setShowUserModal(false)}
                    className="p-2 hover:bg-white/20 rounded-full transition-colors"
                  >
                    <X className="h-5 w-5 text-white" />
                  </button>
                </div>

                <form onSubmit={handleSubmitUser} className="p-6">
                  <div className="space-y-4">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-foreground">User type</label>
                      <select
                        value={userFormData.role}
                        onChange={(e) => {
                          const role = e.target.value
                          const keepHome = role === 'cashier' || role === 'operator'
                          setUserFormData({
                            ...userFormData,
                            role,
                            company_id: role === 'super_admin' ? '' : userFormData.company_id,
                            home_station_id: keepHome ? userFormData.home_station_id : '',
                          })
                        }}
                        className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring"
                      >
                        <option value="super_admin">Super Admin (ERP owner – full access)</option>
                        <option value="admin">Company Admin — email + password for one company</option>
                        <option value="accountant">Accountant (select company)</option>
                        <option value="cashier">Cashier (select company)</option>
                        <option value="operator">Operator — POS: New sale and Donation only (select company)</option>
                      </select>
                    </div>

                    {(userFormData.role === 'cashier' || userFormData.role === 'operator') && (
                      <div className="space-y-4">
                        <div className="rounded-xl border border-border bg-muted/40/80 p-4">
                          <PosSaleScopeSelector
                            name="admin-user-pos-scope"
                            value={userFormData.pos_sale_scope}
                            onChange={(next) =>
                              setUserFormData((fd) => ({ ...fd, pos_sale_scope: next }))
                            }
                          />
                        </div>
                        {userFormData.company_id ? (
                          <div className="rounded-xl border border-amber-100 bg-warning/10/50 p-4">
                            <label className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                              <MapPin className="h-4 w-4 shrink-0 text-warning-foreground" />
                              POS home station
                            </label>
                            <select
                              value={
                                userFormData.home_station_id === '' ||
                                userFormData.home_station_id == null
                                  ? ''
                                  : String(userFormData.home_station_id)
                              }
                              onChange={(e) => {
                                const v = e.target.value
                                setUserFormData((fd) => ({
                                  ...fd,
                                  home_station_id: v === '' ? '' : v,
                                }))
                              }}
                              className="w-full rounded-lg border border-border bg-white px-3 py-2 focus:border-ring focus:ring-2 focus:ring-ring"
                            >
                              <option value="">All sites (not limited — can switch station in POS)</option>
                              {tenantStationsForForm.map((s) => (
                                <option key={s.id} value={String(s.id)}>
                                  {s.station_name}
                                  {s.station_number ? ` (${s.station_number})` : ''}
                                </option>
                              ))}
                            </select>
                            <p className="mt-2 text-xs text-muted-foreground">
                              When set, this cashier or operator only sees catalog and pumps for that site and
                              cannot change selling location after sign-in.
                            </p>
                          </div>
                        ) : (
                          <p className="text-xs text-warning-foreground">
                            Select a company above to choose a station for this POS user.
                          </p>
                        )}
                      </div>
                    )}

                    {userFormData.role === 'super_admin' ? (
                      <div className="rounded-lg border border-border bg-muted/40 p-3">
                        <p className="text-sm text-foreground/85">
                          <strong>Platform owner:</strong> no company selected. Full access to all companies.
                        </p>
                      </div>
                    ) : (
                      <div
                        className={`rounded-lg border-2 p-4 space-y-2 ${
                          userFormData.role === 'admin'
                            ? 'border-primary/25 bg-blue-50/90'
                            : 'border-border bg-muted/40'
                        }`}
                      >
                        <label className="block text-sm font-semibold text-foreground">
                          {userFormData.role === 'admin'
                            ? 'Company — who this administrator manages'
                            : 'Company'}
                          <span className="text-red-500"> *</span>
                        </label>
                        <select
                          required={needsCompany}
                          value={userFormData.company_id}
                          onChange={(e) =>
                            setUserFormData({
                              ...userFormData,
                              company_id: e.target.value,
                              home_station_id: '',
                            })
                          }
                          className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring bg-white"
                        >
                          <option value="">— Select company —</option>
                          {companies.map((c) => (
                            <option key={c.id} value={String(c.id)}>
                              {c.name} (ID: {c.id})
                            </option>
                          ))}
                        </select>
                        {userFormData.role === 'admin' && (
                          <p className="text-sm text-blue-900">
                            Creates a <strong>company admin</strong> login: use their <strong>email</strong> and{' '}
                            <strong>password</strong> below. They can then add Cashiers, Accountants, and change
                            passwords for their company.
                          </p>
                        )}
                        {userFormData.company_id ? (
                          <p className="text-xs text-muted-foreground">
                            Company ID <span className="font-mono font-medium">{userFormData.company_id}</span> is
                            used by the system; you only need to pick the company name.
                          </p>
                        ) : (
                          <p className="text-xs text-warning-foreground">Choose a company from the list.</p>
                        )}
                      </div>
                    )}

                    <div>
                      <label className="mb-2 block text-sm font-medium text-foreground">
                        Email address (login username) <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="email"
                        required
                        value={userFormData.email}
                        onChange={(e) => setUserFormData({ ...userFormData, email: e.target.value })}
                        className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring"
                        placeholder="admin@theircompany.com"
                      />
                      <p className="text-xs text-muted-foreground mt-1">Used to sign in.</p>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-foreground">
                        Full name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={userFormData.full_name}
                        onChange={(e) => setUserFormData({ ...userFormData, full_name: e.target.value })}
                        className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring"
                        placeholder="Display name"
                      />
                    </div>

                    {!editingUser && (
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="mb-2 block text-sm font-medium text-foreground">
                            Password <span className="text-red-500">*</span>
                          </label>
                          <div className="relative">
                            <input
                              type={showPassword ? 'text' : 'password'}
                              required={!editingUser}
                              value={userFormData.password}
                              onChange={(e) => setUserFormData({ ...userFormData, password: e.target.value })}
                              className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring pr-10"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword(!showPassword)}
                              className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground/85"
                            >
                              {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="mb-2 block text-sm font-medium text-foreground">
                            Confirm Password <span className="text-red-500">*</span>
                          </label>
                          <div className="relative">
                            <input
                              type={showConfirmPassword ? 'text' : 'password'}
                              required={!editingUser}
                              value={userFormData.confirmPassword}
                              onChange={(e) => setUserFormData({ ...userFormData, confirmPassword: e.target.value })}
                              className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring pr-10"
                            />
                            <button
                              type="button"
                              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                              className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground/85"
                            >
                              {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {editingUser && (
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="mb-2 block text-sm font-medium text-foreground">
                            New Password (leave blank to keep current)
                          </label>
                          <div className="relative">
                            <input
                              type={showEditPassword ? 'text' : 'password'}
                              value={userFormData.password}
                              onChange={(e) => setUserFormData({ ...userFormData, password: e.target.value })}
                              className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring pr-10"
                              placeholder="Enter new password"
                            />
                            <button
                              type="button"
                              onClick={() => setShowEditPassword(!showEditPassword)}
                              className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground/85"
                              aria-label={showEditPassword ? 'Hide password' : 'Show password'}
                            >
                              {showEditPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="mb-2 block text-sm font-medium text-foreground">
                            Confirm New Password
                            {userFormData.password ? <span className="text-red-500"> *</span> : null}
                          </label>
                          <div className="relative">
                            <input
                              type={showConfirmPassword ? 'text' : 'password'}
                              value={userFormData.confirmPassword}
                              onChange={(e) =>
                                setUserFormData({ ...userFormData, confirmPassword: e.target.value })
                              }
                              className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring pr-10"
                              placeholder="Confirm new password"
                              aria-required={!!userFormData.password}
                            />
                            <button
                              type="button"
                              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                              className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground/85"
                              aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                            >
                              {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                            </button>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            Required when setting a new password.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-end space-x-3 pt-6 border-t mt-6">
                    <button
                      type="button"
                      onClick={() => setShowUserModal(false)}
                      className="px-4 py-2 text-foreground/85 bg-muted rounded-lg hover:bg-muted transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="erp-btn-primary transition-colors"
                    >
                      {editingUser ? 'Update User' : 'Create User'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function UsersPage() {
  return (
    <CompanyProvider>
      <UsersPageContent />
    </CompanyProvider>
  )
}

