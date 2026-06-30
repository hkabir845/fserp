'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  FileText,
  LayoutGrid,
  Megaphone,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import PageLayout from '@/components/PageLayout'
import { AquaculturePageShell } from '@/components/aquaculture/AquaculturePageShell'
import {
  AQ_HERO_BTN_GHOST,
  AQ_HERO_BTN_PRIMARY,
  PipelineStatCard,
} from '@/components/aquaculture/AquacultureUi'
import { useCompany } from '@/contexts/CompanyContext'
import { useCompanyLocale } from '@/contexts/CompanyLocaleContext'
import { usePageMeta } from '@/hooks/usePageMeta'
import api from '@/lib/api'
import { aquacultureT, aquacultureTFormat } from '@/lib/aquacultureI18n'
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
  getLocalizedDashboardFocus,
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

const STAT_META: Record<
  DashboardStatKey,
  { icon: LucideIcon; tone: 'amber' | 'sky' | 'emerald' | 'slate' }
> = {
  today_sales: { icon: TrendingUp, tone: 'emerald' },
  customers: { icon: Users, tone: 'sky' },
  invoices: { icon: FileText, tone: 'slate' },
  revenue: { icon: Wallet, tone: 'amber' },
}

function statTitle(key: DashboardStatKey, lang: 'en' | 'bn'): string {
  switch (key) {
    case 'today_sales':
      return aquacultureT('dashStatTodaySales', lang)
    case 'customers':
      return aquacultureT('dashStatCustomers', lang)
    case 'invoices':
      return aquacultureT('dashStatInvoices', lang)
    case 'revenue':
      return aquacultureT('dashStatRevenue', lang)
  }
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

function statSub(key: DashboardStatKey, count: number, lang: 'en' | 'bn'): string | undefined {
  if (key !== 'today_sales') return undefined
  if (count === 1) return aquacultureT('dashStatOneTransaction', lang)
  return aquacultureTFormat('dashStatTransactions', lang, { n: String(count) })
}

export default function RoleDashboard() {
  const router = useRouter()
  const pageMeta = usePageMeta()
  const { selectedCompany, mode } = useCompany()
  const { language: lang } = useCompanyLocale()
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
          getFsmsErpMenuItems(lang),
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
  }, [role, permissions, mode, aquacultureEnabled, config, lang])

  const statValues: Record<DashboardStatKey, { value: string; hint?: string }> = useMemo(() => {
    const s = stats
    const count = s?.today_sales_count ?? 0
    return {
      today_sales: {
        value: formatCurrency(s?.today_sales ?? 0, currencyCode),
        hint: statSub('today_sales', count, lang),
      },
      customers: { value: String(s?.total_customers ?? 0) },
      invoices: { value: String(s?.total_invoices ?? 0) },
      revenue: { value: formatCurrency(s?.total_revenue ?? 0, currencyCode) },
    }
  }, [stats, currencyCode, lang])

  const showPosHero = role === 'cashier' || role === 'operator' || hasPermission('app.pos')
  const displayName = user?.full_name || user?.username || 'there'

  const localizedFocus = getLocalizedDashboardFocus(role, lang)

  const heroDescription = useMemo(() => {
    const parts = [companyName, localizedFocus].filter(Boolean)
    return parts.length > 0 ? parts.join(' — ') : pageMeta.description
  }, [companyName, localizedFocus, pageMeta.description])

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
      <PageLayout>
        <div className="flex min-h-[50vh] items-center justify-center px-4">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <div
              className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-primary"
              aria-hidden
            />
            {aquacultureT('dashboardLoading', lang)}
          </div>
        </div>
      </PageLayout>
    )
  }

  return (
    <PageLayout>
      <AquaculturePageShell
        showBackLink={false}
        titleId="dashboard-title"
        eyebrow={pageMeta.eyebrow ?? getRoleLandingLabel(role)}
        eyebrowIcon={Sparkles}
        title={aquacultureTFormat('dashboardWelcome', lang, { name: displayName })}
        titleIcon={Sparkles}
        description={heroDescription ?? undefined}
        maxWidthClass="max-w-[1400px]"
        contentClassName="mt-4 space-y-4"
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${getRoleBadgeColor(role)}`}
            >
              {getRoleDisplayName(role)}
            </span>
            {showPosHero ? (
              <Link href="/cashier" className={AQ_HERO_BTN_PRIMARY}>
                <ShoppingCart className="h-3.5 w-3.5" aria-hidden />
                {aquacultureT('dashboardOpenPos', lang)}
              </Link>
            ) : null}
            {hasPermission('app.launcher') ? (
              <Link href="/apps" className={AQ_HERO_BTN_GHOST}>
                <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
                {aquacultureT('dashboardAllApps', lang)}
              </Link>
            ) : null}
          </div>
        }
        stats={
          config.statKeys.length > 0 ? (
            <div
              className={`grid gap-2 ${
                config.statKeys.length === 1
                  ? 'grid-cols-1'
                  : config.statKeys.length === 2
                    ? 'grid-cols-2'
                    : 'grid-cols-2 lg:grid-cols-4'
              }`}
            >
              {config.statKeys.map((key) => {
                const meta = STAT_META[key]
                return (
                  <PipelineStatCard
                    key={key}
                    title={statTitle(key, lang)}
                    value={statValues[key].value}
                    sub={statValues[key].hint ?? ''}
                    icon={meta.icon}
                    tone={meta.tone}
                  />
                )
              })}
            </div>
          ) : null
        }
      >
        {broadcasts.length > 0 ? (
          <div className="space-y-2">
            {broadcasts.slice(0, 2).map((b) => (
              <div
                key={b.id}
                className="erp-alert-warning flex items-start gap-3 shadow-sm"
              >
                <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{b.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-warning-foreground/90">{b.message}</p>
                  <p className="mt-1 text-xs text-warning-foreground/70">{formatDate(b.created_at, true)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void markBroadcastRead(b.id)}
                  className="shrink-0 rounded-lg p-1 text-warning-foreground/70 hover:bg-warning/15 hover:text-warning-foreground"
                  aria-label="Dismiss"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {showPosHero ? (
          <Link
            href="/cashier"
            className="erp-action-card w-full max-w-none justify-between px-5 py-4"
          >
            <div className="flex items-center gap-4">
              <div className="erp-metric-icon erp-metric-icon--warning flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-cta to-warning text-cta-foreground shadow-sm">
                <ShoppingCart className="h-6 w-6" strokeWidth={1.75} aria-hidden />
              </div>
              <div>
                <p className="font-semibold text-foreground">{aquacultureT('dashboardOpenPos', lang)}</p>
                <p className="text-sm text-muted-foreground">{aquacultureT('dashboardOpenPosSub', lang)}</p>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground/70" aria-hidden />
          </Link>
        ) : null}

        <section
          className="erp-panel"
          aria-labelledby="quick-apps-heading"
        >
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h2
                id="quick-apps-heading"
                className="erp-panel-heading"
              >
                <Sparkles className="h-4 w-4 text-primary" aria-hidden />
                {aquacultureT('dashboardQuickAccess', lang)}
              </h2>
              <p className="erp-panel-subheading">{aquacultureT('dashboardQuickAccessSub', lang)}</p>
            </div>
            {hasPermission('app.launcher') ? (
              <Link
                href="/apps"
                className="erp-btn-secondary inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5"
              >
                <LayoutGrid className="h-4 w-4" aria-hidden />
                {aquacultureT('dashboardAllApps', lang)}
              </Link>
            ) : null}
          </div>

          {quickApps.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {quickApps.map((item) => {
                const Icon = item.icon
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="group erp-quick-app-tile"
                  >
                    <div
                      className={`mb-3 flex h-12 w-12 items-center justify-center rounded-xl ${item.tileClass} transition group-hover:opacity-90 sm:h-14 sm:w-14`}
                    >
                      <Icon className="h-6 w-6 sm:h-7 sm:w-7" strokeWidth={1.75} aria-hidden />
                    </div>
                    <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground/85">
                      {item.label}
                    </span>
                  </Link>
                )
              })}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-border bg-muted/50 px-4 py-10 text-center text-sm text-muted-foreground">
              {aquacultureT('dashboardNoApps', lang)}
            </p>
          )}
        </section>
      </AquaculturePageShell>
    </PageLayout>
  )
}
