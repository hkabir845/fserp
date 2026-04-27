import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard,
  LayoutGrid,
  Users,
  Package,
  FileText,
  DollarSign,
  ShoppingCart,
  TrendingUp,
  Building2,
  Droplet,
  MapPin,
  Zap,
  Fuel,
  Gauge,
  Clock,
  BarChart3,
  Landmark,
  BookOpen,
  Receipt,
  Crown,
  Megaphone,
  CreditCard,
  Database,
  Shield,
} from 'lucide-react'

/** Sidebar search hints (unchanged from Sidebar) */
export const MENU_SECTION_SEARCH_HINTS: Record<string, string> = {
  main: 'home apps launcher dashboard pos cashier point of sale register',
  station: 'station pump fuel tank island dispenser nozzle meter forecourt',
  operations: 'operations shift dip variance inventory fuel ops',
  accounting:
    'accounting ledger chart coa bank accounts journal fund transfer loan borrow lend receivable payable book undeposited cash petty 1010 1020 1120',
  sales: 'sales customer vendor ar ap invoice bill payment receivable payable',
  inventory: 'inventory product item stock sku shop c-store',
  hr: 'hr human resources employee payroll staff',
  management: 'management company settings subscription user roles access rbac tax admin backup restore',
  reports: 'reports analytics export print',
  saas: 'saas platform admin tenant companies users contract subscription billing overview ledger backup restore export',
}

export type ErpAppSection =
  | 'main'
  | 'station'
  | 'operations'
  | 'accounting'
  | 'sales'
  | 'inventory'
  | 'hr'
  | 'management'
  | 'reports'
  | 'saas'

export interface ErpAppMenuItem {
  href: string
  label: string
  section: ErpAppSection
  icon: LucideIcon
  /** Light tile background + icon color (Odoo-style) */
  tileClass: string
  count?: number
}

function tile(iconBg: string, iconText: string) {
  return `${iconBg} ${iconText}`
}

const PERM_WILDCARD = '*'

/**
 * At least one listed permission is required to show a nav item when using the permission-based path.
 * (Super Admin uses wildcard from the API; legacy logins use role-based menu until they sign in again.)
 */
export const HREF_REQUIRED_PERMISSIONS: Record<string, string[]> = {
  '/apps': ['app.launcher'],
  '/dashboard': ['app.launcher'],
  '/cashier': ['app.pos'],
  '/stations': ['app.station'],
  '/tanks': ['app.station'],
  '/islands': ['app.station'],
  '/dispensers': ['app.station'],
  '/meters': ['app.station'],
  '/nozzles': ['app.station'],
  '/shift-management': ['app.operations'],
  '/tank-dips': ['app.operations'],
  '/chart-of-accounts': ['app.accounting'],
  '/journal-entries': ['app.accounting'],
  '/fund-transfers': ['app.accounting'],
  '/loans': ['app.accounting'],
  '/customers': ['app.customers', 'app.sales'],
  '/vendors': ['app.sales'],
  '/invoices': ['app.sales'],
  '/bills': ['app.sales'],
  '/payments': ['app.sales'],
  '/items': ['app.inventory'],
  '/employees': ['app.hr'],
  '/payroll': ['app.hr'],
  '/company': ['app.settings'],
  '/subscriptions': ['app.settings'],
  '/users': ['app.users'],
  '/roles': ['app.roles'],
  '/tax': ['app.settings'],
  '/backup': ['app.backup'],
  '/reports': ['app.reports'],
  '/reports/analytics': ['app.reports'],
}

function menuItemAllowedByPermissions(href: string, perms: string[]): boolean {
  if (perms.includes(PERM_WILDCARD)) return true
  const anyOf = HREF_REQUIRED_PERMISSIONS[href]
  if (!anyOf?.length) return false
  return anyOf.some((k) => perms.includes(k))
}

/**
 * Full FSMS ERP menu (icons + pastel tile classes for app launcher).
 * Order matches previous Sidebar `fsmsErpMenuItems`.
 */
export function getFsmsErpMenuItems(): ErpAppMenuItem[] {
  return [
    {
      href: '/apps',
      label: 'Apps',
      section: 'main',
      icon: LayoutGrid,
      tileClass: tile('bg-slate-100', 'text-slate-600'),
    },
    {
      href: '/dashboard',
      label: 'Dashboard',
      section: 'main',
      icon: LayoutDashboard,
      tileClass: tile('bg-sky-100', 'text-sky-600'),
    },
    {
      href: '/cashier',
      label: 'POS / Cashier',
      section: 'main',
      icon: ShoppingCart,
      tileClass: tile('bg-cyan-100', 'text-cyan-600'),
    },

    { href: '/stations', label: 'Stations', section: 'station', icon: Building2, tileClass: tile('bg-amber-100', 'text-amber-600') },
    { href: '/tanks', label: 'Tanks', section: 'station', icon: Droplet, tileClass: tile('bg-orange-100', 'text-orange-600') },
    { href: '/islands', label: 'Islands', section: 'station', icon: MapPin, tileClass: tile('bg-yellow-100', 'text-yellow-700') },
    { href: '/dispensers', label: 'Dispensers', section: 'station', icon: Zap, tileClass: tile('bg-lime-100', 'text-lime-700') },
    { href: '/meters', label: 'Meters', section: 'station', icon: Gauge, tileClass: tile('bg-emerald-100', 'text-emerald-600') },
    { href: '/nozzles', label: 'Nozzles', section: 'station', icon: Fuel, tileClass: tile('bg-teal-100', 'text-teal-600') },

    { href: '/shift-management', label: 'Shift Management', section: 'operations', icon: Clock, tileClass: tile('bg-violet-100', 'text-violet-600') },
    { href: '/tank-dips', label: 'Tank Dips', section: 'operations', icon: Droplet, tileClass: tile('bg-fuchsia-100', 'text-fuchsia-600') },

    { href: '/chart-of-accounts', label: 'Chart of Accounts', section: 'accounting', icon: BookOpen, tileClass: tile('bg-indigo-100', 'text-indigo-600') },
    { href: '/journal-entries', label: 'Journal Entries', section: 'accounting', icon: Receipt, tileClass: tile('bg-purple-100', 'text-purple-600') },
    { href: '/fund-transfers', label: 'Fund Transfer', section: 'accounting', icon: TrendingUp, tileClass: tile('bg-blue-100', 'text-blue-600') },
    { href: '/loans', label: 'Loans', section: 'accounting', icon: Landmark, tileClass: tile('bg-slate-100', 'text-slate-700') },

    { href: '/customers', label: 'Customers', section: 'sales', icon: Users, tileClass: tile('bg-green-100', 'text-green-600') },
    { href: '/vendors', label: 'Vendors', section: 'sales', icon: Users, tileClass: tile('bg-emerald-100', 'text-emerald-700') },
    { href: '/invoices', label: 'Invoices', section: 'sales', icon: FileText, tileClass: tile('bg-rose-100', 'text-rose-600') },
    { href: '/bills', label: 'Bills', section: 'sales', icon: Receipt, tileClass: tile('bg-pink-100', 'text-pink-600') },
    { href: '/payments', label: 'Payments', section: 'sales', icon: DollarSign, tileClass: tile('bg-green-100', 'text-green-700') },

    { href: '/items', label: 'Products & services', section: 'inventory', icon: Package, tileClass: tile('bg-cyan-100', 'text-cyan-700') },

    { href: '/employees', label: 'Employees', section: 'hr', icon: Users, tileClass: tile('bg-orange-100', 'text-orange-700') },
    { href: '/payroll', label: 'Payroll', section: 'hr', icon: DollarSign, tileClass: tile('bg-amber-100', 'text-amber-700') },

    { href: '/company', label: 'Company', section: 'management', icon: Building2, tileClass: tile('bg-slate-100', 'text-slate-600') },
    { href: '/subscriptions', label: 'Subscriptions', section: 'management', icon: Crown, tileClass: tile('bg-amber-100', 'text-amber-600') },
    { href: '/users', label: 'Users', section: 'management', icon: Users, tileClass: tile('bg-zinc-100', 'text-zinc-600') },
    { href: '/roles', label: 'Roles & access', section: 'management', icon: Shield, tileClass: tile('bg-indigo-100', 'text-indigo-700') },
    { href: '/tax', label: 'Tax', section: 'management', icon: Receipt, tileClass: tile('bg-stone-100', 'text-stone-600') },
    { href: '/backup', label: 'Backup & Restore', section: 'management', icon: Database, tileClass: tile('bg-neutral-100', 'text-neutral-600') },

    { href: '/reports', label: 'Reports', section: 'reports', icon: BarChart3, tileClass: tile('bg-violet-100', 'text-violet-600') },
    { href: '/reports/analytics', label: 'Financial analytics', section: 'reports', icon: TrendingUp, tileClass: tile('bg-fuchsia-100', 'text-fuchsia-700') },
  ]
}

export function getSaasMenuItems(companiesCount: number, usersCount: number): ErpAppMenuItem[] {
  return [
    { href: '/admin/overview', label: 'Platform Overview', section: 'saas', icon: BarChart3, tileClass: tile('bg-sky-100', 'text-sky-600') },
    { href: '/admin/subscription-billing', label: 'Subscription & Billing', section: 'saas', icon: CreditCard, tileClass: tile('bg-violet-100', 'text-violet-600') },
    { href: '/admin/companies', label: `Companies (${companiesCount})`, section: 'saas', icon: Building2, tileClass: tile('bg-amber-100', 'text-amber-600'), count: companiesCount },
    { href: '/admin/users', label: `All Users (${usersCount})`, section: 'saas', icon: Users, tileClass: tile('bg-cyan-100', 'text-cyan-600'), count: usersCount },
    { href: '/admin/contracts', label: 'Contract Management', section: 'saas', icon: FileText, tileClass: tile('bg-emerald-100', 'text-emerald-600') },
    { href: '/admin/subscription-ledger', label: 'Subscription Ledger', section: 'saas', icon: Receipt, tileClass: tile('bg-fuchsia-100', 'text-fuchsia-600') },
    { href: '/admin/broadcasting', label: 'Broadcasting', section: 'saas', icon: Megaphone, tileClass: tile('bg-orange-100', 'text-orange-600') },
    { href: '/admin/backup', label: 'Backup & Restore', section: 'saas', icon: Database, tileClass: tile('bg-slate-100', 'text-slate-600') },
  ]
}

export function getFilteredMenuItems(
  userRole: string | null,
  isSuperAdmin: boolean,
  mode: 'fsms_erp' | 'saas_dashboard',
  fsmsErpMenuItems: ErpAppMenuItem[],
  saasMenuItems: ErpAppMenuItem[],
  /** When set (e.g. after login with `user.permissions` from the API), drive menu from permission keys. */
  effectivePermissions?: string[] | null
): ErpAppMenuItem[] {
  const menuItems = isSuperAdmin && mode === 'saas_dashboard' ? saasMenuItems : fsmsErpMenuItems

  const role = userRole?.toLowerCase() || ''

  if (isSuperAdmin && mode === 'fsms_erp') {
    return fsmsErpMenuItems
  }

  if (effectivePermissions != null && mode === 'fsms_erp') {
    return fsmsErpMenuItems.filter((item) => menuItemAllowedByPermissions(item.href, effectivePermissions))
  }

  if (role === 'operator') {
    return menuItems.filter((item) => item.href === '/cashier')
  }

  if (role === 'cashier') {
    return menuItems.filter(
      (item) =>
        item.href === '/apps' ||
        item.href === '/dashboard' ||
        item.href === '/cashier' ||
        item.href === '/customers' ||
        item.href === '/reports'
    )
  }

  if (role === 'accountant') {
    return menuItems.filter((item) => {
      const stationItems = ['/stations', '/tanks', '/islands', '/dispensers', '/meters', '/nozzles']
      if (stationItems.includes(item.href)) return false
      if (item.href === '/users') return false
      if (item.href === '/backup') return false
      return true
    })
  }

  if (role === 'admin' || role === 'super_admin') {
    return menuItems
  }

  return menuItems
}

export function filterTenantBackupMenuItem(
  items: ErpAppMenuItem[],
  role: string,
  effectivePermissions?: string[] | null
): ErpAppMenuItem[] {
  const r = role.toLowerCase()
  return items.filter((item) => {
    if (item.href !== '/backup') return true
    if (effectivePermissions != null) {
      return effectivePermissions.includes(PERM_WILDCARD) || effectivePermissions.includes('app.backup')
    }
    return r === 'admin'
  })
}

const FSMS_SECTIONS_ALL: { id: ErpAppSection; label: string }[] = [
  { id: 'main', label: 'Main' },
  { id: 'station', label: 'Station Management' },
  { id: 'operations', label: 'Operations' },
  { id: 'accounting', label: 'Accounting' },
  { id: 'sales', label: 'Sales & Customers' },
  { id: 'inventory', label: 'Products & services' },
  { id: 'hr', label: 'HR & Payroll' },
  { id: 'management', label: 'Management' },
  { id: 'reports', label: 'Reports & Analytics' },
]

export function getSectionDefinitions(
  isSuperAdmin: boolean,
  mode: 'fsms_erp' | 'saas_dashboard',
  visibleItemSections: Set<ErpAppSection>
): { id: ErpAppSection; label: string }[] {
  if (isSuperAdmin && mode === 'saas_dashboard') {
    return [{ id: 'saas', label: 'SaaS Management' }]
  }
  if (isSuperAdmin && mode === 'fsms_erp') {
    return FSMS_SECTIONS_ALL
  }
  return FSMS_SECTIONS_ALL.filter((s) => visibleItemSections.has(s.id))
}
