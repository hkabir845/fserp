import type { UserRole } from '@/utils/rbac'
import { aquacultureT, type AdviceLanguage } from '@/lib/aquacultureI18n'

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
    gradient: 'from-[hsl(var(--hero-from))] via-[hsl(var(--hero-via))] to-[hsl(var(--hero-to))]',
    tagline: 'Full control of your company',
    focus: 'Sales, finance, operations, and settings — all in one place.',
    statKeys: ['today_sales', 'customers', 'invoices', 'revenue'],
    maxQuickApps: 10,
    prioritizeHrefs: ['/users', '/company', '/backup', '/reports', '/invoices', '/cashier'],
  },
  manager: {
    gradient: 'from-[hsl(var(--hero-from))] via-blue-600 to-cyan-700',
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
  pump_attendant: {
    gradient: 'from-lime-600 via-green-600 to-emerald-700',
    tagline: 'Forecourt register',
    focus: 'Fuel sales and donations at your assigned site.',
    statKeys: ['today_sales'],
    maxQuickApps: 4,
    prioritizeHrefs: ['/cashier'],
  },
  shopkeeper: {
    gradient: 'from-amber-500 via-yellow-500 to-orange-600',
    tagline: 'Shop floor & till',
    focus: 'Shop POS, customers, and product catalog.',
    statKeys: ['today_sales', 'customers'],
    maxQuickApps: 6,
    prioritizeHrefs: ['/cashier', '/items', '/inventory', '/customers'],
  },
  inventory_clerk: {
    gradient: 'from-teal-600 via-cyan-600 to-sky-700',
    tagline: 'Stock & products',
    focus: 'SKU catalog, transfers, and inventory reports.',
    statKeys: ['today_sales'],
    maxQuickApps: 6,
    prioritizeHrefs: ['/items', '/inventory', '/reports'],
  },
  sales_clerk: {
    gradient: 'from-rose-500 via-pink-500 to-fuchsia-600',
    tagline: 'Sales desk',
    focus: 'Customers, invoices, bills, and payments.',
    statKeys: ['invoices', 'customers', 'revenue'],
    maxQuickApps: 8,
    prioritizeHrefs: ['/invoices', '/payments', '/customers', '/vendors'],
  },
  forecourt_supervisor: {
    gradient: 'from-sky-600 via-blue-600 to-indigo-700',
    tagline: 'Forecourt operations',
    focus: 'Stations, shifts, dips, and operational reports.',
    statKeys: ['today_sales'],
    maxQuickApps: 8,
    prioritizeHrefs: ['/shift-management', '/tank-dips', '/stations', '/reports'],
  },
  hr_officer: {
    gradient: 'from-violet-600 via-purple-600 to-fuchsia-700',
    tagline: 'People & payroll',
    focus: 'Employee records and payroll runs.',
    statKeys: ['customers'],
    maxQuickApps: 4,
    prioritizeHrefs: ['/employees', '/payroll'],
  },
  auditor: {
    gradient: 'from-emerald-600 via-green-700 to-slate-800',
    tagline: 'Review & reconcile',
    focus: 'Ledger, AR/AP, and financial reports (read-only access).',
    statKeys: ['invoices', 'revenue', 'today_sales'],
    maxQuickApps: 8,
    prioritizeHrefs: ['/reports', '/chart-of-accounts', '/journal-entries', '/invoices'],
  },
}

export function getRoleDashboardConfig(role: UserRole | string | null): RoleDashboardConfig {
  const key = (role || '').toLowerCase()
  return ROLE_DASHBOARD_CONFIG[key] ?? DEFAULT
}

type DashboardFocusKey =
  | 'dashboardFocusDefault'
  | 'dashboardFocusAdmin'
  | 'dashboardFocusManager'
  | 'dashboardFocusAccountant'
  | 'dashboardFocusSupervisor'
  | 'dashboardFocusCashier'
  | 'dashboardFocusOperator'
  | 'dashboardFocusPumpAttendant'
  | 'dashboardFocusShopkeeper'
  | 'dashboardFocusInventoryClerk'
  | 'dashboardFocusSalesClerk'
  | 'dashboardFocusForecourtSupervisor'
  | 'dashboardFocusHrOfficer'
  | 'dashboardFocusAuditor'

const DASHBOARD_FOCUS_KEYS: Record<string, DashboardFocusKey> = {
  admin: 'dashboardFocusAdmin',
  manager: 'dashboardFocusManager',
  accountant: 'dashboardFocusAccountant',
  supervisor: 'dashboardFocusSupervisor',
  cashier: 'dashboardFocusCashier',
  operator: 'dashboardFocusOperator',
  pump_attendant: 'dashboardFocusPumpAttendant',
  shopkeeper: 'dashboardFocusShopkeeper',
  inventory_clerk: 'dashboardFocusInventoryClerk',
  sales_clerk: 'dashboardFocusSalesClerk',
  forecourt_supervisor: 'dashboardFocusForecourtSupervisor',
  hr_officer: 'dashboardFocusHrOfficer',
  auditor: 'dashboardFocusAuditor',
}

export function getLocalizedDashboardFocus(role: UserRole | string | null, lang: AdviceLanguage): string {
  const key = (role || '').toLowerCase()
  const i18nKey = DASHBOARD_FOCUS_KEYS[key] ?? 'dashboardFocusDefault'
  return aquacultureT(i18nKey, lang)
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
