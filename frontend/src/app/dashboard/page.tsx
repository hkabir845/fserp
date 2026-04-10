'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import CompanySwitcher from '@/components/CompanySwitcher'
import { useCompany } from '@/contexts/CompanyContext'
import { formatNumber, formatCurrency } from '@/utils/currency'
import api from '@/lib/api'
import { Megaphone, X, Crown, Building2 } from 'lucide-react'
import { safeLogError, isConnectionError } from '@/utils/connectionError'
import { formatDate } from '@/utils/date'

function DashboardPageContent() {
  const router = useRouter()
  const { selectedCompany, isSaaSDashboard, isMasterCompany } = useCompany()
  const [user, setUser] = useState<any>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [stats, setStats] = useState({
    totalSales: 0,
    totalSalesCount: 0,
    totalCustomers: 0,
    totalInvoices: 0,
    totalRevenue: 0
  })
  const [currencyCode, setCurrencyCode] = useState('BDT')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [broadcasts, setBroadcasts] = useState<any[]>([])
  const [unreadBroadcasts, setUnreadBroadcasts] = useState<any[]>([])

  useEffect(() => {
    // Check authentication
    const token = localStorage.getItem('access_token')
    const userStr = localStorage.getItem('user')

    // Only redirect if there's truly no token AND we're not loading/showing error
    // This prevents redirect loops when errors occur
    if (!token) {
      // If we're loading or showing an error, don't redirect - let the error display
      if (loading || error) {
        return
      }
      // Only redirect if we're sure there's no token and no active state
      router.push('/login')
      return
    }

    if (userStr && userStr !== 'undefined' && userStr !== 'null') {
      try {
        const parsedUser = JSON.parse(userStr)
        if (parsedUser && typeof parsedUser === 'object') {
          setUser(parsedUser)
          setUserRole(parsedUser.role?.toLowerCase() || null)
        }
      } catch (error) {
        console.error('Error parsing user data:', error)
        localStorage.removeItem('user')
      }
    }

    // For superadmin, wait a bit longer to ensure company context is ready
    // This prevents race conditions when switching from SaaS Dashboard to FSMS ERP
    const isSuperAdmin = userStr && userStr !== 'undefined' && userStr !== 'null' 
      ? (() => {
          try {
            const parsed = JSON.parse(userStr)
            return parsed?.role?.toLowerCase() === 'super_admin'
          } catch {
            return false
          }
        })()
      : false

    // Reduced delay for faster loading - only wait if superadmin needs company context
    const delay = isSuperAdmin ? 100 : 0

    // Wait a bit to ensure token and company context are fully available, then fetch data
    const timer = setTimeout(() => {
      // Verify token is still available before making API calls
      const currentToken = localStorage.getItem('access_token')
      if (currentToken) {
        // For superadmin, also check if company is selected (if in FSMS ERP mode)
        if (isSuperAdmin) {
          const savedMode = localStorage.getItem('sidebar_mode')
          if (savedMode === 'fsms_erp') {
            const savedCompany = localStorage.getItem('superadmin_selected_company')
            if (!savedCompany) {
              console.warn('Superadmin in FSMS ERP mode but no company selected - waiting...')
              // Wait a bit more for company to be selected, but set a max timeout
              setTimeout(() => {
                fetchCompanyCurrency().catch(() => {})
                fetchDashboardStats().catch(() => {
                  setLoading(false)
                })
              }, 50) // Reduced from 200ms to 50ms
              return
            }
          }
        }
        
        // Fetch company currency symbol (non-blocking - defaults to BDT if fails)
        fetchCompanyCurrency().catch(() => {
          // Silently fail - already handled in function
        })
        
        // Fetch dashboard stats - this is the critical one
        fetchDashboardStats().catch(() => {
          // If it fails, ensure loading is stopped
          setLoading(false)
        })
        
        // Fetch broadcasts (non-blocking)
        fetchBroadcasts().catch(() => {
          // Silently fail
        })
      } else {
        // No token - only redirect if not loading/error
        if (!loading && !error) {
          router.push('/login')
        }
      }
    }, delay)

    // Safety timeout - ensure loading state doesn't get stuck
    // But don't show error if we're still trying - just stop loading
    const safetyTimer = setTimeout(() => {
      if (loading) {
        // Dashboard loading timeout - silently handle (backend may not be running)
        setLoading(false)
        // Don't set error on timeout - let the API calls finish or show their own errors
        // The dashboard can still display with default/zero values
      }
    }, 8000) // 8 second timeout - reduced from 15s for faster feedback

    return () => {
      clearTimeout(timer)
      clearTimeout(safetyTimer)
    }
  }, [router, selectedCompany])

  const fetchCompanyCurrency = async () => {
    try {
      // Verify token exists before making request
      const token = localStorage.getItem('access_token')
      if (!token) {
        return
      }

      const response = await api.get('/companies/current')
      if (response.data && response.data.currency) {
        setCurrencyCode(response.data.currency.toUpperCase())
      }
    } catch (error: any) {
      // Silently handle currency fetch errors - it's non-critical
      // Dashboard can work perfectly fine with default currency
      // Only log if it's NOT a connection error (backend may not be running)
      if (!isConnectionError(error)) {
        // Only log non-connection errors in development mode
        if (process.env.NODE_ENV === 'development') {
          console.warn('Could not fetch company currency, using default BDT:', error.message || error)
        }
      }
      // Default to Bangladeshi Taka if error - don't show error to user
      setCurrencyCode('BDT')
      // Don't set main error - currency fetch failure is not critical
    }
  }

  const fetchDashboardStats = async (retryCount = 0) => {
    try {
      setError(null) // Clear any previous errors
      
      // Verify token exists before making request
      const token = localStorage.getItem('access_token')
      if (!token) {
        // Don't redirect immediately - set error instead
        setError('No authentication token found. Please login again.')
        setLoading(false)
        return
      }

      // Set a timeout for the API call
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 second timeout per request

      const response = await api.get('/dashboard/stats', {
        signal: controller.signal
      })
      
      clearTimeout(timeoutId)

      if (response.data) {
        const data = response.data
        setStats({
          totalSales: data.today_sales || 0,
          totalSalesCount: data.today_sales_count || 0,
          totalCustomers: data.total_customers || 0,
          totalInvoices: data.total_invoices || 0,
          totalRevenue: data.total_revenue || 0
        })
        setError(null) // Clear error on success
        setLoading(false) // Stop loading on success
      } else {
        // No data but successful response - use defaults
        setStats({
          totalSales: 0,
          totalSalesCount: 0,
          totalCustomers: 0,
          totalInvoices: 0,
          totalRevenue: 0
        })
        setLoading(false)
      }
    } catch (error: any) {
      // Silently handle connection errors - backend may not be running
      safeLogError('Error fetching dashboard stats:', error)
      
      // If request was aborted (timeout), show timeout message
      if (error.name === 'AbortError' || error.code === 'ECONNABORTED') {
        setError('Request timed out. The server may be slow. Stats will show as zero.')
        // Keep default stats (all zeros) - dashboard can still display
        // Loading will be stopped in finally block
      }
      
      // Set user-friendly error message
      if (error.response) {
        // Server responded with error
        if (error.response.status === 401 || error.response.status === 403) {
          // After refresh attempt, _retry is set on the original request (see api.ts interceptor)
          if (error.config?._retry) {
            setError('Your session has expired or is invalid. Please log in again.')
            setTimeout(() => {
              localStorage.removeItem('access_token')
              localStorage.removeItem('refresh_token')
              localStorage.removeItem('user')
            }, 2000)
          } else {
            setError('Authentication error. Try Retry or log in again.')
          }
        } else if (error.response.status === 404) {
          setError('Dashboard endpoint not found. Please check backend server.')
        } else if (error.response.status >= 500) {
          setError('Server error. Please try again later.')
        } else {
          setError(`Error loading dashboard: ${error.response.statusText || 'Unknown error'}`)
        }
      } else if (error.request || error.code === 'ERR_CONNECTION_RESET' || error.code === 'ERR_NETWORK' || isConnectionError(error)) {
        // Request made but no response - backend might be down or crashed
        // Silently handle connection errors - don't show error message if backend is just not running
        // User can see the dashboard with zero values
        if (error.code === 'ERR_CONNECTION_RESET') {
          // Only show error for connection reset (server crashed), not for server not running
          setError('Backend server connection was reset. The server may have crashed. Please restart the backend server.')
        } else {
          // For connection refused/network errors, don't show error - just use zero values
          // This prevents error spam when backend is intentionally not running
          setError(null)
        }
      } else {
        // Something else happened
        setError(`Error: ${error.message || 'Unknown error occurred'}`)
      }
      
      // Don't block dashboard display - show with zero/default values
      // User can still see the dashboard structure and retry if needed
      setStats({
        totalSales: 0,
        totalSalesCount: 0,
        totalCustomers: 0,
        totalInvoices: 0,
        totalRevenue: 0
      })
      
      // For superadmin in FSMS ERP mode, if we get 401/403 and no company is selected yet, retry once
      if ((error.response?.status === 401 || error.response?.status === 403) && retryCount === 0) {
        const userStr = localStorage.getItem('user')
        const isSuperAdmin = userStr && userStr !== 'undefined' && userStr !== 'null' 
          ? (() => {
              try {
                const parsed = JSON.parse(userStr)
                return parsed?.role?.toLowerCase() === 'super_admin'
              } catch {
                return false
              }
            })()
          : false
        
        if (isSuperAdmin) {
          const savedMode = localStorage.getItem('sidebar_mode')
          if (savedMode === 'fsms_erp') {
            const savedCompany = localStorage.getItem('superadmin_selected_company')
            if (!savedCompany) {
              // Wait a bit more and retry once, but don't block loading
              setTimeout(() => {
                fetchDashboardStats(1).catch(() => {
                  setLoading(false)
                })
              }, 500)
              // Still stop loading so dashboard can display
              setLoading(false)
              return
            }
          }
        }
      }
      
      // For 401/403 errors, show error message but don't redirect immediately
      // Let user see the error and decide what to do
      // Only redirect if it's a clear authentication failure after retries
      if ((error.response?.status === 401 || error.response?.status === 403) && retryCount > 0) {
        // After retry, if still failing, it's a real auth issue
        // But still show error first, don't auto-redirect
        console.warn('Authentication failed after retry. User should login again.')
      }
    } finally {
      // Always stop loading after first attempt (retryCount === 0)
      // This ensures dashboard displays even if there are errors
      if (retryCount === 0) {
        setLoading(false)
      }
    }
  }

  const fetchBroadcasts = async () => {
    try {
      const response = await api.get('/broadcasts/my?unread_only=true')
      if (response.data) {
        setUnreadBroadcasts(response.data)
        setBroadcasts(response.data)
      }
    } catch (error: any) {
      // Silently handle connection errors - backend may not be running
      safeLogError('Error fetching broadcasts:', error)
    }
  }

  const markBroadcastAsRead = async (broadcastId: number) => {
    try {
      await api.post(`/broadcasts/${broadcastId}/read`)
      // Remove from unread list
      setUnreadBroadcasts(prev => prev.filter((b: any) => b.id !== broadcastId))
      setBroadcasts(prev => prev.map((b: any) => 
        b.id === broadcastId ? { ...b, is_read: true } : b
      ))
    } catch (error: any) {
      console.error('Error marking broadcast as read:', error)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    localStorage.removeItem('user')
    router.push('/login')
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-100 page-with-sidebar">
      <Sidebar />
      
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-auto">
          <div className="p-4 sm:p-6 lg:p-8">
          {/* Broadcast Notifications */}
          {unreadBroadcasts.length > 0 && (
            <div className="mb-6 space-y-3">
              {unreadBroadcasts.map((broadcast: any) => {
                const priorityColors: Record<string, string> = {
                  urgent: 'bg-red-50 border-red-200',
                  high: 'bg-orange-50 border-orange-200',
                  medium: 'bg-yellow-50 border-yellow-200',
                  low: 'bg-blue-50 border-blue-200'
                }
                
                const priorityIcons: Record<string, string> = {
                  urgent: 'text-red-600',
                  high: 'text-orange-600',
                  medium: 'text-yellow-600',
                  low: 'text-blue-600'
                }

                return (
                  <div
                    key={broadcast.id}
                    className={`border-l-4 rounded-lg p-4 ${priorityColors[broadcast.priority] || priorityColors.medium}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start space-x-3 flex-1">
                        <Megaphone className={`h-5 w-5 mt-0.5 ${priorityIcons[broadcast.priority] || priorityIcons.medium}`} />
                        <div className="flex-1">
                          <h3 className="font-semibold text-gray-900 mb-1">{broadcast.title}</h3>
                          <p className="text-sm text-gray-700 whitespace-pre-wrap">{broadcast.message}</p>
                          <p className="text-xs text-gray-500 mt-2">
                            {formatDate(broadcast.created_at, true)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2 ml-4">
                        <button
                          onClick={() => markBroadcastAsRead(broadcast.id)}
                          className="text-gray-400 hover:text-gray-600 transition-colors"
                          title="Mark as read"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Header */}
          <div className="mb-6 flex flex-col gap-4 sm:mb-8 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 pr-0 lg:pr-4">
              <h1 className="text-xl font-bold leading-tight text-gray-900 sm:text-2xl lg:text-3xl">
                {selectedCompany ? `${selectedCompany.name} - Dashboard` : 'Dashboard'}
              </h1>
              <p className="mt-1 text-sm text-gray-600 sm:text-base">
                Welcome back, {user?.full_name || user?.username || 'User'}!
                {selectedCompany && userRole === 'super_admin' && (
                  <span className="mt-1 block text-xs text-blue-600 sm:ml-2 sm:mt-0 sm:inline sm:text-sm">
                    (Super Admin View)
                  </span>
                )}
              </p>
            </div>
            <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3 lg:w-auto lg:shrink-0">
              {userRole === 'super_admin' && (
                <div className="w-full sm:min-w-[12rem] sm:max-w-xs lg:w-64">
                  <CompanySwitcher />
                </div>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="w-full shrink-0 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 sm:w-auto"
              >
                Logout
              </button>
            </div>
          </div>

          {/* R&D master vs tenant context (super admin + company selected) */}
          {userRole === 'super_admin' && selectedCompany && !isSaaSDashboard && (
            <div
              className={`mb-6 rounded-xl border p-4 sm:p-5 ${
                isMasterCompany
                  ? 'border-amber-200 bg-amber-50/90 text-amber-950'
                  : 'border-slate-200 bg-slate-50 text-slate-900'
              }`}
            >
              <div className="flex gap-3">
                {isMasterCompany ? (
                  <Crown className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden />
                ) : (
                  <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-slate-600" aria-hidden />
                )}
                <div className="min-w-0 text-sm leading-relaxed">
                  {isMasterCompany ? (
                    <>
                      <p className="font-semibold text-amber-900">
                        R&amp;D / development: {selectedCompany.name}
                      </p>
                      <p className="mt-1 text-amber-900/90">
                        This is your <strong>master</strong> tenant — the usual place to build, test, and refine the
                        ERP before rolling changes to live-style tenants. Stats and menus here apply only to{' '}
                        <strong>{selectedCompany.name}</strong>.
                      </p>
                      <p className="mt-2 text-amber-900/85">
                        Other companies (for example <strong>Adib Filling Station</strong>) are separate tenants: switch
                        them in the sidebar company picker to see their own isolated data.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold text-slate-800">
                        Tenant: {selectedCompany.name}
                      </p>
                      <p className="mt-1 text-slate-700">
                        Figures on this dashboard are scoped to <strong>{selectedCompany.name}</strong> only — not to
                        your master development company.
                      </p>
                      <p className="mt-2 text-slate-600">
                        For R&amp;D and upgrades, switch to <strong>Master Filling Station</strong> (master tenant) in
                        the sidebar; use tenants such as <strong>Adib Filling Station</strong> to validate real
                        multi-company behaviour.
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <svg className="h-5 w-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <p className="font-semibold">{error}</p>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => {
                      setError(null)
                      setLoading(true)
                      fetchDashboardStats()
                    }}
                    className="text-sm bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700 transition-colors"
                  >
                    Retry
                  </button>
                  {(error.includes('Authentication') || error.includes('session has expired') || error.includes('No authentication token')) && (
                    <button
                      onClick={() => {
                        localStorage.removeItem('access_token')
                        localStorage.removeItem('refresh_token')
                        localStorage.removeItem('user')
                        router.push('/login')
                      }}
                      className="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 transition-colors"
                    >
                      Login Again
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Sales (Today)</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">
                    {formatCurrency(stats.totalSales, currencyCode)}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {stats.totalSalesCount || 0} transaction{stats.totalSalesCount !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="p-3 bg-blue-100 rounded-full">
                  <svg className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Customers</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">
                    {stats.totalCustomers || 0}
                  </p>
                </div>
                <div className="p-3 bg-green-100 rounded-full">
                  <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Invoices</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">
                    {stats.totalInvoices || 0}
                  </p>
                </div>
                <div className="p-3 bg-yellow-100 rounded-full">
                  <svg className="h-6 w-6 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Revenue (All-Time)</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">
                    {formatCurrency(stats.totalRevenue, currencyCode)}
                  </p>
                </div>
                <div className="p-3 bg-purple-100 rounded-full">
                  <svg className="h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-white rounded-lg shadow p-6 mb-8">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Quick Actions</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <button
                onClick={() => router.push('/invoices')}
                className="p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-all"
              >
                <div className="text-center">
                  <div className="text-2xl mb-2">📄</div>
                  <p className="text-sm font-medium">New Invoice</p>
                </div>
              </button>
              <button
                onClick={() => router.push('/customers')}
                className="p-4 border-2 border-gray-200 rounded-lg hover:border-green-500 hover:bg-green-50 transition-all"
              >
                <div className="text-center">
                  <div className="text-2xl mb-2">👥</div>
                  <p className="text-sm font-medium">Add Customer</p>
                </div>
              </button>
              <button
                onClick={() => router.push('/shift-management')}
                className="p-4 border-2 border-gray-200 rounded-lg hover:border-yellow-500 hover:bg-yellow-50 transition-all"
              >
                <div className="text-center">
                  <div className="text-2xl mb-2">⏰</div>
                  <p className="text-sm font-medium">Shift Management</p>
                </div>
              </button>
              <button
                onClick={() => router.push('/reports')}
                className="p-4 border-2 border-gray-200 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition-all"
              >
                <div className="text-center">
                  <div className="text-2xl mb-2">📊</div>
                  <p className="text-sm font-medium">View Reports</p>
                </div>
              </button>
            </div>
          </div>

          {/* Recent Activity Placeholder */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Recent Activity</h2>
            <p className="text-gray-600 text-center py-8">
              No recent activity to display
            </p>
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  return <DashboardPageContent />
}
