'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import PageLayout from '@/components/PageLayout'
import { ErpPageShell } from '@/components/aquaculture/ErpPageShell'
import { CompanyProvider, useCompany } from '@/contexts/CompanyContext'
import Link from 'next/link'
import { Building2, Users, MapPin, TrendingUp, CreditCard, ChevronRight } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { formatCurrency } from '@/utils/currency'
import { safeLogError, isConnectionError } from '@/utils/connectionError'
import { usePageMeta } from '@/hooks/usePageMeta'

interface PlatformStats {
  total_companies: number
  active_companies: number
  inactive_companies: number
  total_users: number
  total_customers: number
  total_vendors: number
  total_stations: number
  total_sales: number
  total_invoices: number
  users_by_role: Record<string, number>
}

function OverviewPageContent() {
  const router = useRouter()
  const toast = useToast()
  const pageMeta = usePageMeta()
  const { mode } = useCompany()
  const [stats, setStats] = useState<PlatformStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }

    const userStr = localStorage.getItem('user')
    if (userStr && userStr !== 'undefined' && userStr !== 'null') {
      try {
        const user = JSON.parse(userStr)
        const role = user.role?.toLowerCase() || null

        if (role !== 'super_admin') {
          toast.error('Access denied. Super Admin access required.')
          router.push('/dashboard')
          return
        }
      } catch (error) {
        safeLogError('Error parsing user data:', error)
      }
    }

    if (mode === 'fsms_erp') {
      setLoading(false)
      return
    }

    if (mode === 'saas_dashboard') {
      fetchPlatformStats()
    } else {
      setLoading(false)
    }
  }, [mode, router])

  const fetchPlatformStats = async () => {
    try {
      setLoading(true)

      const response = await api.get('/admin/stats')

      if (response.data) {
        setStats(response.data)
      } else {
        if (!isConnectionError({ response: response })) {
          toast.error('No statistics data received')
        }
      }
    } catch (error: any) {
      if (!isConnectionError(error)) {
        safeLogError('[Overview] Error fetching platform stats:', error)
      }

      if (error.response?.status === 403) {
        toast.error('Access denied. Super Admin access required.')
        router.push('/dashboard')
      } else if (error.response?.status === 500) {
        if (!isConnectionError(error)) {
          toast.error('Server error. Please check backend logs.')
        }
      } else if (!isConnectionError(error)) {
        if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
          toast.error('Request timed out. The server may be slow or unresponsive.')
        } else {
          toast.error(`Failed to load platform statistics: ${error.message || 'Unknown error'}`)
        }
      }
    } finally {
      setLoading(false)
    }
  }

  if (!mode || mode !== 'saas_dashboard') {
    return (
      <PageLayout>
        <div className="app-scroll-pad">
          <div className="erp-empty-state w-full">
            <Building2 className="mx-auto mb-4 h-12 w-12 text-muted-foreground/60" />
            <h2 className="mb-2 text-xl font-semibold text-foreground">{pageMeta.title}</h2>
            <p className="mb-4 text-muted-foreground">Please switch to SaaS Dashboard mode to view platform overview.</p>
            <p className="text-sm text-muted-foreground/80">Use the mode switcher in the sidebar to switch to SaaS Dashboard mode.</p>
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
          titleIcon={Building2}
          eyebrow={pageMeta.eyebrow}
          description={pageMeta.description}
          maxWidthClass="max-w-[1600px]"
          contentClassName="mt-4"
          actions={
            <Link href="/admin/subscription-billing" className="erp-action-card group">
              <div className="erp-action-card-icon">
                <CreditCard className="h-5 w-5" />
              </div>
              <div className="min-w-0 text-left">
                <p className="erp-action-card-title">Subscription &amp; Billing</p>
                <p className="erp-action-card-desc">
                  Manage tenant cycles, renewals, and SaaS ledger invoices in one place.
                </p>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-primary/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
            </Link>
          }
        >
          {loading ? (
            <div className="erp-surface p-8 text-center">
              <div className="erp-loading-spinner" />
              <p className="text-muted-foreground">Loading platform statistics...</p>
            </div>
          ) : stats ? (
            <>
              <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
                <div className="erp-stat-card">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="erp-stat-label">Total Companies</p>
                      <p className="erp-stat-value">{stats.total_companies}</p>
                      <p className="erp-stat-meta">
                        {stats.active_companies} active, {stats.inactive_companies} inactive
                      </p>
                    </div>
                    <div className="erp-metric-icon erp-metric-icon--primary">
                      <Building2 className="h-6 w-6" />
                    </div>
                  </div>
                </div>

                <div className="erp-stat-card">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="erp-stat-label">Total Users</p>
                      <p className="erp-stat-value">{stats.total_users}</p>
                      <p className="erp-stat-meta">Across all companies</p>
                    </div>
                    <div className="erp-metric-icon erp-metric-icon--success">
                      <Users className="h-6 w-6" />
                    </div>
                  </div>
                </div>

                <div className="erp-stat-card">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="erp-stat-label">Total Stations</p>
                      <p className="erp-stat-value">{stats.total_stations}</p>
                      <p className="erp-stat-meta">Across all companies</p>
                    </div>
                    <div className="erp-metric-icon erp-metric-icon--accent">
                      <MapPin className="h-6 w-6" />
                    </div>
                  </div>
                </div>

                <div className="erp-stat-card">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="erp-stat-label">Total Sales</p>
                      <p className="erp-stat-value">{formatCurrency(stats.total_sales, 'BDT')}</p>
                      <p className="erp-stat-meta">All companies, all time</p>
                    </div>
                    <div className="erp-metric-icon erp-metric-icon--warning">
                      <TrendingUp className="h-6 w-6" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-3">
                <div className="erp-surface p-6">
                  <h3 className="mb-4 text-lg font-semibold text-foreground">Users by Role</h3>
                  <div className="space-y-2">
                    {Object.entries(stats.users_by_role).map(([role, count]) => (
                      <div key={role} className="flex items-center justify-between">
                        <span className="text-sm capitalize text-muted-foreground">{role.replace('_', ' ')}</span>
                        <span className="text-sm font-semibold text-foreground">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="erp-surface p-6">
                  <h3 className="mb-4 text-lg font-semibold text-foreground">Resource Summary</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Customers</span>
                      <span className="text-sm font-semibold text-foreground">{stats.total_customers}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Vendors</span>
                      <span className="text-sm font-semibold text-foreground">{stats.total_vendors}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Invoices</span>
                      <span className="text-sm font-semibold text-foreground">{stats.total_invoices}</span>
                    </div>
                  </div>
                </div>

                <div className="erp-surface p-6">
                  <h3 className="mb-4 text-lg font-semibold text-foreground">Company Status</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Active</span>
                      <span className="text-sm font-semibold text-success">{stats.active_companies}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Inactive</span>
                      <span className="text-sm font-semibold text-destructive">{stats.inactive_companies}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">With Subscription</span>
                      <span className="text-sm font-semibold text-primary">{stats.active_companies}</span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="erp-empty-state">
              <Building2 className="mx-auto mb-4 h-12 w-12 text-muted-foreground/60" />
              <h2 className="mb-2 text-xl font-semibold text-foreground">Platform Overview</h2>
              <p className="mb-2 text-lg text-muted-foreground">No statistics available</p>
              <p className="mb-4 text-sm text-muted-foreground/80">
                Backend server is not running. Please start the backend server to view platform statistics.
              </p>
              <button type="button" onClick={fetchPlatformStats} className="erp-btn-primary">
                Retry
              </button>
            </div>
          )}
        </ErpPageShell>
      </div>
    </PageLayout>
  )
}

export default function OverviewPage() {
  return (
    <CompanyProvider>
      <OverviewPageContent />
    </CompanyProvider>
  )
}
