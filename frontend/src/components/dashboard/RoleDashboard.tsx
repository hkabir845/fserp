'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  LayoutGrid,
  Megaphone,
  ShoppingCart,
  Sparkles,
  X,
} from 'lucide-react'
import PageLayout from '@/components/PageLayout'
import { useCompany } from '@/contexts/CompanyContext'
import api from '@/lib/api'
import { formatCurrency } from '@/utils/currency'
import { formatDate } from '@/utils/date'
import {
  getCurrentUserPermissions,
  getCurrentUserRole,
  getRoleBadgeColor,
  getRoleDisplayName,
  hasPermission,
  type UserRole,
} from '@/utils/rbac'
import { getRoleLandingLabel } from '@/utils/dashboardLanding'
import {
  getFilteredMenuItems,
  filterAquacultureMenuWhenDisabled,
  filterTenantBackupMenuItem,
  getFsmsErpMenuItems,
  type ErpAppMenuItem,
} from '@/navigation/erpAppMenu'
import { safeLogError } from '@/utils/connectionError'
import {
  getRoleDashboardConfig,
  STAT_LABELS,
  type DashboardStatKey,
} from '@/components/dashboard/roleDashboardConfig'

interface DashboardStats {
  today_sales: number
  today_sales_count: number
  total_customers: number
  total_invoices: number
  total_revenue: number
}

interface StoredUser {
  full_name?: string
  username?: string
  role?: string
}

function pickQuickApps(items: ErpAppMenuItem[], prioritize: string[], max: number): ErpAppMenuItem[] {
  const skip = new Set(['/apps', '/dashboard'])
  const pool = items.filter((i) => !skip.has(i.href))
  const picked: ErpAppMenuItem[] = []
  const seen = new Set<string>()

  for (const href of prioritize) {
    const item = pool.find((i) => i.href === href)
    if (item && !seen.has(item.href)) {
      picked.push(item)
      seen.add(item.href)
    }
    if (picked.length >= max) return picked
  }

  for (const item of pool) {
    if (seen.has(item.href)) continue
    picked.push(item)
    seen.add(item.href)
    if (picked.length >= max) break
  }

  return picked
}

export default function RoleDashboard() {
  const router = useRouter()
  const { selectedCompany, mode } = useCompany()
  const [user, setUser] = useState<StoredUser | null>(null)
  const [role, setRole] = useState<UserRole | null>(null)
  const [permissions, setPermissions] = useState<string[] | null>(null)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [currencyCode, setCurrencyCode] = useState('BDT')
  const [loading, setLoading] = useState(true)
  const [aquacultureEnabled, setAquacultureEnabled] = useState(false)
  const [broadcasts, setBroadcasts] = useState<
    { id: number; title: string; message: string; priority: string; created_at: string }[]
  >([])

  const config = getRoleDashboardConfig(role)
  const companyName = selectedCompany?.name

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token?.trim()) {
      router.replace('/login')
      return
    }

    const userStr = localStorage.getItem('user')
    if (userStr && userStr !== 'undefined' && userStr !== 'null') {
      try {
        const parsed = JSON.parse(userStr) as StoredUser
        setUser(parsed)
        setRole(getCurrentUserRole())
        setPermissions(getCurrentUserPermissions())
      } catch {
        /* ignore */
      }
    }

    let cancelled = false
    const load = async () => {
      try {
        const [statsRes, companyRes, broadcastRes] = await Promise.all([
          api.get<DashboardStats>('/dashboard/stats'),
          api.get<{ currency?: string; aquaculture_enabled?: boolean }>('/companies/current/'),
          api.get('/broadcasts/my?unread_only=true').catch(() => ({ data: [] })),
        ])
        if (cancelled) return
        if (statsRes.data) setStats(statsRes.data)
        if (companyRes.data?.currency) {
          setCurrencyCode(String(companyRes.data.currency).toUpperCase())
        }
        setAquacultureEnabled(Boolean(companyRes.data?.aquaculture_enabled))
        if (Array.isArray(broadcastRes.data)) setBroadcasts(broadcastRes.data)
      } catch (err) {
        safeLogError('Dashboard load:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [router, selectedCompany?.id])

  const quickApps = useMemo(() => {
    const isSuperAdmin = role === 'super_admin'
    const items = filterAquacultureMenuWhenDisabled(
      filterTenantBackupMenuItem(
        getFilteredMenuItems(
          role,
          isSuperAdmin,
          mode,
          getFsmsErpMenuItems(),
          [],
          permissions
        ),
        role || '',
        permissions
      ),
      aquacultureEnabled,
      role,
      isSuperAdmin,
      permissions
    )
    return pickQuickApps(items, config.prioritizeHrefs, config.maxQuickApps)
  }, [role, permissions, mode, aquacultureEnabled, config])

  const statValues: Record<DashboardStatKey, { value: string; hint?: string }> = useMemo(() => {
    const s = stats
    return {
      today_sales: {
        value: formatCurrency(s?.today_sales ?? 0, currencyCode),
        hint: STAT_LABELS.today_sales.sub?.(s?.today_sales_count ?? 0),
      },
      customers: { value: String(s?.total_customers ?? 0) },
      invoices: { value: String(s?.total_invoices ?? 0) },
      revenue: { value: formatCurrency(s?.total_revenue ?? 0, currencyCode) },
    }
  }, [stats, currencyCode])

  const showPosHero = role === 'cashier' || role === 'operator' || hasPermission('app.pos')
  const displayName = user?.full_name || user?.username || 'there'

  const markBroadcastRead = async (id: number) => {
    try {
      await api.post(`/broadcasts/${id}/read`)
      setBroadcasts((prev) => prev.filter((b) => b.id !== id))
    } catch {
      /* ignore */
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eceff2]">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
          <p className="mt-4 text-sm text-slate-600">Loading your dashboard…</p>
        </div>
      </div>
    )
  }

  return (
    <PageLayout>
      <div className="min-h-full bg-[#eceff2]">
        <div className="mx-auto max-w-5xl px-4 py-6 pb-12 sm:px-6 sm:py-8">
          {broadcasts.length > 0 && (
            <div className="mb-5 space-y-2">
              {broadcasts.slice(0, 2).map((b) => (
                <div
                  key={b.id}
                  className="flex items-start gap-3 rounded-xl border border-amber-200/80 bg-amber-50/90 px-4 py-3 text-sm text-amber-950"
                >
                  <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{b.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-amber-900/90">{b.message}</p>
                    <p className="mt-1 text-xs text-amber-800/70">{formatDate(b.created_at, true)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void markBroadcastRead(b.id)}
                    className="shrink-0 rounded-lg p-1 text-amber-700/70 hover:bg-amber-100 hover:text-amber-900"
                    aria-label="Dismiss"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <header
            className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${config.gradient} px-5 py-6 text-white shadow-lg sm:px-7 sm:py-8`}
          >
            <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-10 left-1/3 h-24 w-24 rounded-full bg-white/5 blur-xl" />
            <div className="relative">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getRoleBadgeColor(role)}`}
                >
                  {getRoleDisplayName(role)}
                </span>
                <span className="text-xs font-medium uppercase tracking-wider text-white/70">
                  {getRoleLandingLabel(role)}
                </span>
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
                Welcome, {displayName}
              </h1>
              {companyName && (
                <p className="mt-1 text-sm text-white/85 sm:text-base">{companyName}</p>
              )}
              <p className="mt-2 text-sm font-medium text-white/90 sm:text-base">{config.tagline}</p>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-white/75">{config.focus}</p>
            </div>
          </header>

          {showPosHero && (
            <Link
              href="/cashier"
              className="mt-5 flex items-center justify-between gap-4 rounded-2xl border border-orange-200/60 bg-white px-5 py-4 shadow-sm transition hover:border-orange-300 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-amber-500 text-white shadow-sm">
                  <ShoppingCart className="h-6 w-6" strokeWidth={1.75} aria-hidden />
                </div>
                <div>
                  <p className="font-semibold text-slate-900">Open POS / Cashier</p>
                  <p className="text-sm text-slate-600">Start a new sale or donation</p>
                </div>
              </div>
              <ArrowRight className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
            </Link>
          )}

          {config.statKeys.length > 0 && (
            <section className="mt-6" aria-labelledby="dashboard-stats-heading">
              <h2 id="dashboard-stats-heading" className="sr-only">
                Key figures
              </h2>
              <div
                className={`grid gap-3 ${
                  config.statKeys.length === 1
                    ? 'grid-cols-1'
                    : config.statKeys.length === 2
                      ? 'grid-cols-2'
                      : 'grid-cols-2 lg:grid-cols-4'
                }`}
              >
                {config.statKeys.map((key) => (
                  <div
                    key={key}
                    className="rounded-2xl border border-white/80 bg-white px-4 py-4 shadow-sm"
                  >
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      {STAT_LABELS[key].label}
                    </p>
                    <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900 sm:text-2xl">
                      {statValues[key].value}
                    </p>
                    {statValues[key].hint && (
                      <p className="mt-0.5 text-xs text-slate-500">{statValues[key].hint}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="mt-8" aria-labelledby="quick-apps-heading">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <h2
                  id="quick-apps-heading"
                  className="flex items-center gap-2 text-base font-semibold text-slate-800"
                >
                  <Sparkles className="h-4 w-4 text-slate-500" aria-hidden />
                  Quick access
                </h2>
                <p className="mt-0.5 text-sm text-slate-500">Shortcuts matched to your role</p>
              </div>
              {hasPermission('app.launcher') && (
                <Link
                  href="/apps"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-white hover:text-slate-900"
                >
                  <LayoutGrid className="h-4 w-4" aria-hidden />
                  All apps
                </Link>
              )}
            </div>

            {quickApps.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {quickApps.map((item) => {
                  const Icon = item.icon
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="group flex flex-col items-center rounded-2xl border border-gray-200/80 bg-white/95 p-4 text-center shadow-sm transition hover:border-gray-300 hover:bg-white hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
                    >
                      <div
                        className={`mb-3 flex h-12 w-12 items-center justify-center rounded-xl ${item.tileClass} transition group-hover:opacity-90 sm:h-14 sm:w-14`}
                      >
                        <Icon className="h-6 w-6 sm:h-7 sm:w-7" strokeWidth={1.75} aria-hidden />
                      </div>
                      <span className="line-clamp-2 text-sm font-medium leading-snug text-slate-700">
                        {item.label}
                      </span>
                    </Link>
                  )
                })}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-slate-200 bg-white/60 px-4 py-10 text-center text-sm text-slate-500">
                No applications available for your account. Contact your administrator.
              </p>
            )}
          </section>
        </div>
      </div>
    </PageLayout>
  )
}
