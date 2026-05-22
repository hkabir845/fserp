import type { UserRole } from '@/utils/rbac'

export type DashboardStatKey = 'today_sales' | 'customers' | 'invoices' | 'revenue'

export interface RoleDashboardConfig {
  gradient: string
  tagline: string
  focus: string
  statKeys: DashboardStatKey[]
  maxQuickApps: number
  prioritizeHrefs: string[]
}

const DEFAULT: RoleDashboardConfig = {
  gradient: 'from-slate-600 via-slate-700 to-slate-800',
  tagline: 'Your workspace at a glance',
  focus: 'Open an app below or review today’s numbers.',
  statKeys: ['today_sales', 'customers', 'invoices', 'revenue'],
  maxQuickApps: 8,
  prioritizeHrefs: ['/cashier', '/reports', '/invoices', '/customers'],
}

export const ROLE_DASHBOARD_CONFIG: Record<string, RoleDashboardConfig> = {
  admin: {
    gradient: 'from-blue-600 via-indigo-600 to-violet-700',
    tagline: 'Full control of your company',
    focus: 'Sales, finance, operations, and settings — all in one place.',
    statKeys: ['today_sales', 'customers', 'invoices', 'revenue'],
    maxQuickApps: 10,
    prioritizeHrefs: ['/users', '/company', '/reports', '/invoices', '/cashier'],
  },
  manager: {
    gradient: 'from-indigo-600 via-blue-600 to-cyan-700',
    tagline: 'Run the station and the farm',
    focus: 'Fuel, shop, aquaculture, and daily operations.',
    statKeys: ['today_sales', 'customers', 'invoices', 'revenue'],
    maxQuickApps: 10,
    prioritizeHrefs: ['/shift-management', '/aquaculture', '/cashier', '/reports'],
  },
  accountant: {
    gradient: 'from-emerald-600 via-teal-600 to-cyan-700',
    tagline: 'Books, AR/AP, and reporting',
    focus: 'Invoices, payments, ledger, and financial reports.',
    statKeys: ['today_sales', 'invoices', 'revenue', 'customers'],
    maxQuickApps: 8,
    prioritizeHrefs: [
      '/invoices',
      '/payments',
      '/chart-of-accounts',
      '/journal-entries',
      '/reports',
    ],
  },
  supervisor: {
    gradient: 'from-cyan-600 via-sky-600 to-blue-700',
    tagline: 'Ponds, shifts, and field work',
    focus: 'Aquaculture operations, sampling, feeding, and site reports.',
    statKeys: ['today_sales', 'customers'],
    maxQuickApps: 8,
    prioritizeHrefs: [
      '/aquaculture',
      '/aquaculture/ponds',
      '/aquaculture/feeding',
      '/shift-management',
      '/reports',
    ],
  },
  cashier: {
    gradient: 'from-orange-500 via-amber-500 to-yellow-600',
    tagline: 'Serve customers at the till',
    focus: 'Start a sale, look up customers, or check today’s totals.',
    statKeys: ['today_sales', 'customers'],
    maxQuickApps: 6,
    prioritizeHrefs: ['/cashier', '/customers', '/reports'],
  },
  operator: {
    gradient: 'from-teal-600 via-emerald-600 to-green-700',
    tagline: 'Register — sales and donations',
    focus: 'Quick access to the POS register.',
    statKeys: ['today_sales'],
    maxQuickApps: 4,
    prioritizeHrefs: ['/cashier'],
  },
}

export function getRoleDashboardConfig(role: UserRole | string | null): RoleDashboardConfig {
  const key = (role || '').toLowerCase()
  return ROLE_DASHBOARD_CONFIG[key] ?? DEFAULT
}

export const STAT_LABELS: Record<
  DashboardStatKey,
  { label: string; sub?: (count: number) => string }
> = {
  today_sales: {
    label: 'Sales today',
    sub: (n) => `${n} transaction${n === 1 ? '' : 's'}`,
  },
  customers: { label: 'Customers' },
  invoices: { label: 'Invoices' },
  revenue: { label: 'Revenue (all time)' },
}
