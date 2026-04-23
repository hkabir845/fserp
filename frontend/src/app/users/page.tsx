'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { Plus, Edit2, Trash2, Shield, User, X, Eye, EyeOff, Grid3x3, List, Ban, UserCheck } from 'lucide-react'
import { useToast } from '@/components/Toast'
import { getApiBaseUrl } from '@/lib/api'
import { formatDate } from '@/utils/date'

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
}

interface CompanyOption {
  id: number
  name: string
}

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
    password: '',
    confirmPassword: ''
  })

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
    fetchUsers()
    if (!owner || superA) {
      fetchCompanies()
    }
  }, [router])

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
      const token = localStorage.getItem('access_token')
      const response = await fetch(`${getApiBaseUrl()}/users/`, {
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        mode: 'cors',
        credentials: 'omit'
      })
      if (response.ok) {
        const data = await response.json()
        setUsers(data)
      } else if (response.status === 401) {
        localStorage.removeItem('access_token')
        router.push('/login')
        toast.error('Session expired. Please login again.')
      } else if (response.status === 403) {
        toast.error('You do not have permission to manage users.')
        router.push('/dashboard')
      }
    } catch (error) {
      console.error('Error fetching users:', error)
      toast.error('Error loading users')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setFormData({
      username: '',
      email: '',
      full_name: '',
      role: 'cashier',
      company_id: '',
      password: '',
      confirmPassword: ''
    })
    setEditingId(null)
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
      const token = localStorage.getItem('access_token')
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
      const response = await fetch(`${getApiBaseUrl()}/users/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        mode: 'cors',
        credentials: 'omit',
        body: JSON.stringify(payload)
      })

      if (response.ok) {
        toast.success('User created successfully!')
        setShowModal(false)
        resetForm()
        fetchUsers()
      } else {
        const error = await response.json()
        toast.error(error.detail || 'Failed to create user')
      }
    } catch (error) {
      console.error('Error creating user:', error)
      toast.error('Error connecting to server')
    }
  }

  const handleEdit = (user: SystemUser) => {
    setEditingId(user.id)
    setFormData({
      username: user.username,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      company_id: user.company_id ?? '',
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
      const token = localStorage.getItem('access_token')
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

      const response = await fetch(`${getApiBaseUrl()}/users/${editingId}/`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        mode: 'cors',
        credentials: 'omit',
        body: JSON.stringify(updateData)
      })

      if (response.ok) {
        toast.success('User updated successfully!')
        setShowModal(false)
        resetForm()
        fetchUsers()
      } else {
        const error = await response.json()
        toast.error(error.detail || 'Failed to update user')
      }
    } catch (error) {
      console.error('Error updating user:', error)
      toast.error('Error connecting to server')
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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-100 page-with-sidebar">
      <Sidebar />
      <div className="flex-1 overflow-auto">
        <div className="p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">User Management</h1>
              <p className="text-gray-600 mt-1">
                {isCompanyOwner
                  ? 'Add Cashiers and Accountants for your company. Staff log in with their email. Deactivate blocks sign-in but keeps the record; trash permanently deletes the user.'
                  : 'Manage system users and permissions. Deactivate blocks sign-in; delete removes the row from the database.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
                <button
                  type="button"
                  onClick={() => {
                    setViewMode('card')
                    localStorage.setItem('users_view_mode', 'card')
                  }}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    viewMode === 'card'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
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
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
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
                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="h-5 w-5" />
                <span>New User</span>
              </button>
            </div>
          </div>

          {users.length > 0 && viewMode === 'card' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {users.map((user) => (
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
                    <div className="flex items-center space-x-2">
                      <Shield className="h-4 w-4 text-gray-400" />
                      <span className={`px-2 py-1 text-xs rounded-full font-medium ${getRoleBadgeColor(user.role)}`}>
                        {user.role}
                      </span>
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
                        Role
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
                    {users.map((user) => (
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
                            {user.role}
                          </span>
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
      </div>

      {/* User Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 sticky top-0 z-10 flex items-center justify-between rounded-t-xl">
              <div className="flex items-center space-x-3">
                <User className="h-6 w-6 text-white" />
                <h2 className="text-2xl font-bold text-white">
                  {editingId ? 'Edit User' : 'New User'}
                </h2>
              </div>
              <button
                onClick={() => {
                  setShowModal(false)
                  resetForm()
                }}
                className="p-2 hover:bg-white/20 rounded-full transition-colors"
              >
                <X className="h-5 w-5 text-white" />
              </button>
            </div>

            {/* Modal Content */}
            <form onSubmit={editingId ? handleUpdate : handleCreate} className="p-6">
              <div className="space-y-6">
                {/* Basic Information */}
                <div className="border-b pb-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">User Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Role <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={formData.role}
                        onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="admin">Admin</option>
                        <option value="accountant">Accountant</option>
                        <option value="cashier">Cashier</option>
                        {!isCompanyOwner && (
                          <option value="operator">Operator (POS: New sale and Donation)</option>
                        )}
                      </select>
                    </div>
                    {!isCompanyOwner && (
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Company (optional)
                        </label>
                        <select
                          value={formData.company_id === '' || formData.company_id == null ? '' : String(formData.company_id)}
                          onChange={(e) => setFormData({ ...formData, company_id: e.target.value === '' ? '' : e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="">— No company —</option>
                          {companies.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} (ID: {c.id})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>

                {/* Password Section */}
                <div className="pb-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Password</h3>
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
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end space-x-3 pt-6 border-t mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false)
                    resetForm()
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  {editingId ? 'Update User' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

