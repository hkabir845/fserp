'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { CompanyProvider, useCompany } from '@/contexts/CompanyContext'
import { Users, Plus, Edit2, Trash2, UserCheck, OctagonAlert, X, Eye, EyeOff } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { safeLogError, isConnectionError } from '@/utils/connectionError'
import { formatDate } from '@/utils/date'
import { useRequireSaasDashboardMode } from '@/hooks/useRequireSaasDashboardMode'

interface AdminUser {
  id: number
  username: string
  email: string
  full_name: string
  role: string
  company_id: number | null
  company_name: string | null
  is_active: boolean
  created_at: string
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
    password: '',
    confirmPassword: '',
    company_id: ''
  })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, router]) // Only depend on mode to avoid infinite loops

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
        toast.error(`Failed to load users: ${error.message || 'Unknown error'}`)
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
      password: '',
      confirmPassword: '',
      company_id: user.company_id?.toString() || ''
    })
    setShowUserModal(true)
  }

  const needsCompany =
    userFormData.role === 'admin' ||
    userFormData.role === 'accountant' ||
    userFormData.role === 'cashier'

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
      await api.delete(`/users/${user.id}/`)
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
      await api.delete(`/users/${user.id}/`, { params: { permanent: true } })
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
      <div className="flex h-screen bg-gray-100 page-with-sidebar">
        <Sidebar />
        <div className="flex-1 overflow-y-auto p-8">
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <p className="text-gray-600">Please switch to SaaS Dashboard mode to manage users.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-100 page-with-sidebar">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-8">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">All Users</h2>
              <p className="mt-1 max-w-2xl text-sm text-gray-600">
                <strong>Status</strong> is <span className="text-green-700">Active</span> or{' '}
                <span className="text-red-700">Inactive</span>. The trash icon{' '}
                <strong>deactivates</strong> login (the row stays). Use <strong>Activate</strong> to
                allow sign-in again. The <span className="inline-flex items-center gap-0.5 align-middle">
                  <OctagonAlert className="inline h-3.5 w-3.5 text-rose-700" aria-hidden />
                </span>{' '}
                <strong className="text-rose-800">permanently deletes</strong> the user (Super Admin
                only; you must type DELETE to confirm). You cannot remove or deactivate your own
                account here. You cannot delete the last active Super Admin.
              </p>
              <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  checked={showInactiveUsers}
                  onChange={(e) => setShowInactiveUsers(e.target.checked)}
                />
                Show inactive users
                {inactiveCount > 0 && (
                  <span className="text-gray-500">({inactiveCount} inactive)</span>
                )}
              </label>
            </div>
            <button
              onClick={handleCreateUser}
              className="flex shrink-0 items-center space-x-2 self-start rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700"
            >
              <Plus className="h-5 w-5" />
              <span>New User</span>
            </button>
          </div>

          {loading ? (
            <div className="bg-white rounded-lg shadow p-8 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading users...</p>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Company</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Joined</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center">
                        <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                        <p className="text-gray-600 text-lg mb-2">No users found</p>
                        <p className="text-gray-500 text-sm mb-4">Users will appear here once companies are created</p>
                        <button
                          onClick={handleCreateUser}
                          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                        >
                          Create User
                        </button>
                      </td>
                    </tr>
                  ) : visibleUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-600">
                        <p className="mb-2">All users are inactive and hidden.</p>
                        <button
                          type="button"
                          onClick={() => setShowInactiveUsers(true)}
                          className="text-sm font-medium text-blue-600 hover:text-blue-800"
                        >
                          Show inactive users
                        </button>
                      </td>
                    </tr>
                  ) : (
                    visibleUsers.map((user) => (
                      <tr key={user.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div>
                            <div className="text-sm font-medium text-gray-900">{user.full_name}</div>
                            <div className="text-xs text-gray-500">{user.email || user.username}</div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            user.role === 'super_admin' ? 'bg-purple-100 text-purple-800' :
                            user.role === 'admin' ? 'bg-blue-100 text-blue-800' :
                            user.role === 'accountant' ? 'bg-green-100 text-green-800' :
                            user.role === 'cashier' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {user.role.replace('_', ' ').toUpperCase()}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">
                            {user.company_name
                              ? `${user.company_name} (ID: ${user.company_id})`
                              : (user.role === 'super_admin' ? 'ERP superuser (platform owner)' : 'No company')}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            user.is_active
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {user.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {user.created_at ? formatDate(user.created_at, true) : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <button
                              onClick={() => handleEditUser(user)}
                              className="rounded p-1.5 text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-900"
                              title="Edit user"
                              type="button"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                            {currentUserId !== null && user.id === currentUserId ? (
                              <span
                                className="px-2 text-xs text-gray-400"
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
                                    className="rounded p-1.5 text-red-600 transition-colors hover:bg-red-50 hover:text-red-900"
                                    title="Deactivate login (soft delete)"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleActivateUser(user)}
                                    className="rounded p-1.5 text-green-600 transition-colors hover:bg-green-50 hover:text-green-900"
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
                <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 sticky top-0 z-10 flex items-center justify-between rounded-t-xl">
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
                      <label className="block text-sm font-medium text-gray-700 mb-2">User type</label>
                      <select
                        value={userFormData.role}
                        onChange={(e) => {
                          const role = e.target.value
                          setUserFormData({
                            ...userFormData,
                            role,
                            company_id: role === 'super_admin' ? '' : userFormData.company_id
                          })
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="super_admin">Super Admin (ERP owner – full access)</option>
                        <option value="admin">Company Admin — email + password for one company</option>
                        <option value="accountant">Accountant (select company)</option>
                        <option value="cashier">Cashier (select company)</option>
                      </select>
                    </div>

                    {userFormData.role === 'super_admin' ? (
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <p className="text-sm text-gray-700">
                          <strong>Platform owner:</strong> no company selected. Full access to all companies.
                        </p>
                      </div>
                    ) : (
                      <div
                        className={`rounded-lg border-2 p-4 space-y-2 ${
                          userFormData.role === 'admin'
                            ? 'border-blue-200 bg-blue-50/90'
                            : 'border-gray-200 bg-gray-50'
                        }`}
                      >
                        <label className="block text-sm font-semibold text-gray-800">
                          {userFormData.role === 'admin'
                            ? 'Company — who this administrator manages'
                            : 'Company'}
                          <span className="text-red-500"> *</span>
                        </label>
                        <select
                          required={needsCompany}
                          value={userFormData.company_id}
                          onChange={(e) => setUserFormData({ ...userFormData, company_id: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
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
                          <p className="text-xs text-gray-600">
                            Company ID <span className="font-mono font-medium">{userFormData.company_id}</span> is
                            used by the system; you only need to pick the company name.
                          </p>
                        ) : (
                          <p className="text-xs text-amber-700">Choose a company from the list.</p>
                        )}
                      </div>
                    )}

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Email address (login username) <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="email"
                        required
                        value={userFormData.email}
                        onChange={(e) => setUserFormData({ ...userFormData, email: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="admin@theircompany.com"
                      />
                      <p className="text-xs text-gray-500 mt-1">Used to sign in.</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Full name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={userFormData.full_name}
                        onChange={(e) => setUserFormData({ ...userFormData, full_name: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Display name"
                      />
                    </div>

                    {!editingUser && (
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Password <span className="text-red-500">*</span>
                          </label>
                          <div className="relative">
                            <input
                              type={showPassword ? 'text' : 'password'}
                              required={!editingUser}
                              value={userFormData.password}
                              onChange={(e) => setUserFormData({ ...userFormData, password: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-10"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword(!showPassword)}
                              className="absolute right-2 top-2.5 text-gray-500 hover:text-gray-700"
                            >
                              {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Confirm Password <span className="text-red-500">*</span>
                          </label>
                          <div className="relative">
                            <input
                              type={showConfirmPassword ? 'text' : 'password'}
                              required={!editingUser}
                              value={userFormData.confirmPassword}
                              onChange={(e) => setUserFormData({ ...userFormData, confirmPassword: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-10"
                            />
                            <button
                              type="button"
                              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                              className="absolute right-2 top-2.5 text-gray-500 hover:text-gray-700"
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
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            New Password (leave blank to keep current)
                          </label>
                          <div className="relative">
                            <input
                              type={showEditPassword ? 'text' : 'password'}
                              value={userFormData.password}
                              onChange={(e) => setUserFormData({ ...userFormData, password: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-10"
                              placeholder="Enter new password"
                            />
                            <button
                              type="button"
                              onClick={() => setShowEditPassword(!showEditPassword)}
                              className="absolute right-2 top-2.5 text-gray-500 hover:text-gray-700"
                              aria-label={showEditPassword ? 'Hide password' : 'Show password'}
                            >
                              {showEditPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
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
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-10"
                              placeholder="Confirm new password"
                              aria-required={!!userFormData.password}
                            />
                            <button
                              type="button"
                              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                              className="absolute right-2 top-2.5 text-gray-500 hover:text-gray-700"
                              aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                            >
                              {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                            </button>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
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
                      className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
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

