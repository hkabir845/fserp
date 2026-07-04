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
  Brain,
  Boxes,
  BookOpen,
  Receipt,
  Crown,
  Megaphone,
  CreditCard,
  Database,
  Shield,
  ArrowRightLeft,
  Tags,
} from 'lucide-react'

import { buildAppPageHrefPermissionMap } from '@/navigation/appPagePermissions'
import { getAquacultureMenuItemsFlatWithGroup } from '@/navigation/aquacultureNavConfig'
import { AQUACULTURE_STOCK_SUB_NAV } from '@/navigation/aquacultureStockNavConfig'
import { hasAnyAquacultureModuleInList, menuHrefAllowedForAquaculture } from '@/navigation/aquaculturePermissions'
import {
  aquacultureGroupLabel,
  navLabel,
  navSectionLabel,
  type ErpNavSectionId,
} from '@/lib/erpNavI18n'
import type { AppLanguage } from '@/lib/i18n'
/** Sidebar search hints (unchanged from Sidebar) */
export const MENU_SECTION_SEARCH_HINTS: Record<string, string> = {
  main: 'home apps launcher dashboard pos cashier point of sale register company brain ai advisor',
  station: 'station pump fuel tank island dispenser nozzle meter forecourt',
  operations: 'operations shift dip variance inventory transfer stock station fuel ops',
  accounting:
    'accounting ledger chart coa bank accounts journal fund transfer loan borrow lend receivable payable book undeposited cash petty 1010 1020 1120',
  sales: 'sales customer vendor ar ap invoice bill payment receivable payable',
  inventory: 'inventory product item stock sku shop c-store',
  hr: 'hr human resources employee payroll staff',
  management: 'management company settings subscription user roles access rbac tax admin backup restore reporting categories tenant labels',
  reports: 'reports analytics export print',
  aquaculture:
    'aquaculture dashboard pond cycle crop production fish farm biomass sampling feeding advice tilapia worldfish ration pl profit lease feed fry pos customer cashier inventory nursing transfer grow-out mortality stock ledger pond warehouse supplies medicine snake bird predation site gl fuel shop landlord rent lessor pond fish sales harvest revenue pond costs operating expenses',
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
  | 'aquaculture'
  | 'saas'

export interface ErpAppMenuItem {
  href: string
  label: string
  section: ErpAppSection
  icon: LucideIcon
  /** Light tile background + icon color (Odoo-style) */
  tileClass: string
  count?: number
  /** Optional sub-section grouping inside `section` (currently used by Aquaculture). */
  subGroupId?: string
  subGroupLabel?: string
  /** Indented child link under a parent module (e.g. Pond stock sub-pages). */
  menuDepth?: number
}

function tile(iconBg: string, iconText: string) {
  return `${iconBg} ${iconText}`
}

/** Pastel tiles for aquaculture launcher cards (keys = `href`) */
const AQUACULTURE_TILE_BY_HREF: Record<string, string> = {
  '/aquaculture': tile('bg-cyan-100', 'text-cyan-700'),
  '/aquaculture/ponds': tile('bg-sky-100', 'text-sky-700'),
  '/aquaculture/sales': tile('bg-emerald-100', 'text-emerald-800'),
  '/aquaculture/expenses': tile('bg-stone-100', 'text-stone-800'),
  '/aquaculture/landlords': tile('bg-amber-100', 'text-warning-foreground'),
  '/aquaculture/cycles': tile('bg-sky-100', 'text-sky-800'),
  '/aquaculture/transfers': tile('bg-cyan-100', 'text-cyan-800'),
  '/aquaculture/stock': tile('bg-teal-100', 'text-primary'),
  '/aquaculture/stock/options': tile('bg-accent', 'text-primary'),
  '/aquaculture/sampling': tile('bg-lime-100', 'text-lime-800'),
  '/aquaculture/feeding': tile('bg-amber-100', 'text-warning-foreground'),
  '/aquaculture/medicine': tile('bg-violet-100', 'text-violet-800'),
  '/aquaculture/financing': tile('bg-emerald-100', 'text-emerald-800'),
  '/aquaculture/data-bank': tile('bg-amber-100', 'text-warning-foreground'),
  '/aquaculture/report': tile('bg-accent', 'text-primary'),
  '/reports?report=aquaculture-pl-management&category=aquaculture': tile('bg-accent', 'text-primary'),
}

const PERM_WILDCARD = '*'

/**
 * At least one listed permission is required to show a nav item when using the permission-based path.
 * (Super Admin uses wildcard from the API; legacy logins use role-based menu until they sign in again.)
 */
const APP_PAGE_HREF_PERMISSIONS = buildAppPageHrefPermissionMap()

export const HREF_REQUIRED_PERMISSIONS: Record<string, string[]> = {
  ...APP_PAGE_HREF_PERMISSIONS,
  '/brain': ['app.brain', 'app.launcher'],
  '/aquaculture': ['app.aquaculture', 'app.aquaculture.dashboard'],
  '/aquaculture/ponds': ['app.aquaculture', 'app.aquaculture.ponds'],
  '/aquaculture/expenses': ['app.aquaculture', 'app.aquaculture.expenses'],
  '/aquaculture/sales': ['app.aquaculture', 'app.aquaculture.sales'],
  '/aquaculture/sampling': ['app.aquaculture', 'app.aquaculture.sampling'],
  '/aquaculture/feeding': ['app.aquaculture', 'app.aquaculture.feeding'],
  '/aquaculture/medicine': ['app.aquaculture', 'app.aquaculture.medicine'],
  '/aquaculture/report': ['app.aquaculture', 'app.aquaculture.report_pl'],
  '/reports?report=aquaculture-pl-management&category=aquaculture': [
    'app.aquaculture',
    'app.aquaculture.report_pl',
    'app.reports',
    'app.page.reports',
  ],
  '/aquaculture/cycles': ['app.aquaculture', 'app.aquaculture.cycles'],
  '/aquaculture/transfers': ['app.aquaculture', 'app.aquaculture.transfers'],
  '/aquaculture/stock': ['app.aquaculture', 'app.aquaculture.stock'],
  '/aquaculture/stock/options': ['app.aquaculture', 'app.aquaculture.stock'],
  '/aquaculture/landlords': ['app.aquaculture', 'app.aquaculture.landlords'],
  '/aquaculture/financing': ['app.aquaculture', 'app.aquaculture.financing'],
  '/aquaculture/data-bank': ['app.aquaculture', 'app.aquaculture.data_bank'],
  '/reports/analytics': ['app.reports', 'app.page.reports'],
}

function menuItemAllowedByPermissions(href: string, perms: string[]): boolean {
  if (perms.includes(PERM_WILDCARD)) return true
  const anyOf = HREF_REQUIRED_PERMISSIONS[href]
  if (anyOf?.length) {
    return anyOf.some((k) => perms.includes(k))
  }
  if (href.startsWith('/aquaculture') || href.includes('aquaculture-pl-management')) {
    return menuHrefAllowedForAquaculture(href, perms)
  }
  return false
}

function fsmsNavItem(
  href: string,
  section: ErpAppSection,
  icon: LucideIcon,
  tileClassName: string,
  lang: AppLanguage,
  extra?: Partial<ErpAppMenuItem>
): ErpAppMenuItem {
  return {
    href,
    label: navLabel(href, lang),
    section,
    icon,
    tileClass: tileClassName,
    ...extra,
  }
}

/**
 * Full FSMS ERP menu (icons + pastel tile classes for app launcher).
 * Order matches previous Sidebar `fsmsErpMenuItems`.
 */
export function getFsmsErpMenuItems(lang: AppLanguage = 'en'): ErpAppMenuItem[] {
  return [
    fsmsNavItem('/apps', 'main', LayoutGrid, tile('bg-muted', 'text-muted-foreground'), lang),
    fsmsNavItem('/dashboard', 'main', LayoutDashboard, tile('bg-sky-100', 'text-sky-600'), lang),
    fsmsNavItem('/brain', 'main', Brain, tile('bg-indigo-100', 'text-indigo-700'), lang),
    fsmsNavItem('/cashier', 'main', ShoppingCart, tile('bg-cyan-100', 'text-cyan-600'), lang),

    fsmsNavItem('/stations', 'station', Building2, tile('bg-amber-100', 'text-amber-600'), lang),
    fsmsNavItem('/tanks', 'station', Droplet, tile('bg-orange-100', 'text-orange-600'), lang),
    fsmsNavItem('/islands', 'station', MapPin, tile('bg-yellow-100', 'text-yellow-700'), lang),
    fsmsNavItem('/dispensers', 'station', Zap, tile('bg-lime-100', 'text-lime-700'), lang),
    fsmsNavItem('/meters', 'station', Gauge, tile('bg-emerald-100', 'text-emerald-600'), lang),
    fsmsNavItem('/nozzles', 'station', Fuel, tile('bg-teal-100', 'text-primary'), lang),

    fsmsNavItem('/shift-management', 'operations', Clock, tile('bg-violet-100', 'text-violet-600'), lang),
    fsmsNavItem('/tank-dips', 'operations', Droplet, tile('bg-fuchsia-100', 'text-fuchsia-600'), lang),

    fsmsNavItem('/chart-of-accounts', 'accounting', BookOpen, tile('bg-accent', 'text-primary'), lang),
    fsmsNavItem('/journal-entries', 'accounting', Receipt, tile('bg-purple-100', 'text-purple-600'), lang),
    fsmsNavItem('/fund-transfers', 'accounting', TrendingUp, tile('bg-blue-100', 'text-primary'), lang),
    fsmsNavItem('/loans', 'accounting', Landmark, tile('bg-muted', 'text-foreground/85'), lang),
    fsmsNavItem('/fixed-assets', 'accounting', Boxes, tile('bg-stone-100', 'text-stone-700'), lang),

    fsmsNavItem('/customers', 'sales', Users, tile('bg-success/15', 'text-success'), lang),
    fsmsNavItem('/vendors', 'sales', Users, tile('bg-emerald-100', 'text-emerald-700'), lang),
    fsmsNavItem('/invoices', 'sales', FileText, tile('bg-rose-100', 'text-rose-600'), lang),
    fsmsNavItem('/bills', 'sales', Receipt, tile('bg-pink-100', 'text-pink-600'), lang),
    fsmsNavItem('/payments', 'sales', DollarSign, tile('bg-success/15', 'text-success'), lang),

    fsmsNavItem('/items', 'inventory', Package, tile('bg-cyan-100', 'text-cyan-700'), lang),
    fsmsNavItem('/inventory', 'inventory', ArrowRightLeft, tile('bg-teal-100', 'text-primary'), lang),

    fsmsNavItem('/employees', 'hr', Users, tile('bg-orange-100', 'text-orange-700'), lang),
    fsmsNavItem('/payroll', 'hr', DollarSign, tile('bg-amber-100', 'text-warning-foreground'), lang),

    fsmsNavItem('/company', 'management', Building2, tile('bg-muted', 'text-muted-foreground'), lang),
    fsmsNavItem('/subscriptions', 'management', Crown, tile('bg-amber-100', 'text-amber-600'), lang),
    fsmsNavItem('/users', 'management', Users, tile('bg-zinc-100', 'text-zinc-600'), lang),
    fsmsNavItem('/roles', 'management', Shield, tile('bg-accent', 'text-primary'), lang),
    fsmsNavItem('/tax', 'management', Receipt, tile('bg-stone-100', 'text-stone-600'), lang),
    fsmsNavItem('/reporting-categories', 'management', Tags, tile('bg-sky-100', 'text-sky-800'), lang),
    fsmsNavItem('/backup', 'management', Database, tile('bg-neutral-100', 'text-neutral-600'), lang),

    ...getAquacultureMenuItemsFlatWithGroup().flatMap((item) => {
      const base = fsmsNavItem(
        item.href,
        'aquaculture',
        item.icon,
        AQUACULTURE_TILE_BY_HREF[item.href] ?? tile('bg-muted', 'text-foreground/85'),
        lang,
        {
          subGroupId: item.groupId,
          subGroupLabel: aquacultureGroupLabel(item.groupId, lang, item.groupLabel),
        }
      )
      if (item.href !== '/aquaculture/stock') return [base]
      return [
        base,
        ...AQUACULTURE_STOCK_SUB_NAV.filter((sub) => sub.href !== '/aquaculture/stock').map((sub) =>
          fsmsNavItem(
            sub.href,
            'aquaculture',
            sub.icon,
            AQUACULTURE_TILE_BY_HREF[sub.href] ?? tile('bg-accent', 'text-primary'),
            lang,
            {
              subGroupId: item.groupId,
              subGroupLabel: aquacultureGroupLabel(item.groupId, lang, item.groupLabel),
              menuDepth: 1,
            }
          )
        ),
      ]
    }),

    fsmsNavItem('/reports', 'reports', BarChart3, tile('bg-violet-100', 'text-violet-600'), lang),
  ]
}

export function getSaasMenuItems(
  companiesCount: number,
  usersCount: number,
  lang: AppLanguage = 'en'
): ErpAppMenuItem[] {
  return [
    fsmsNavItem('/admin/overview', 'saas', BarChart3, tile('bg-sky-100', 'text-sky-600'), lang),
    fsmsNavItem('/admin/subscription-billing', 'saas', CreditCard, tile('bg-violet-100', 'text-violet-600'), lang),
    {
      ...fsmsNavItem('/admin/companies', 'saas', Building2, tile('bg-amber-100', 'text-amber-600'), lang),
      label: navLabel('/admin/companies', lang, { count: companiesCount }),
      count: companiesCount,
    },
    {
      ...fsmsNavItem('/admin/users', 'saas', Users, tile('bg-cyan-100', 'text-cyan-600'), lang),
      label: navLabel('/admin/users', lang, { count: usersCount }),
      count: usersCount,
    },
    fsmsNavItem('/admin/contracts', 'saas', FileText, tile('bg-emerald-100', 'text-emerald-600'), lang),
    fsmsNavItem('/admin/subscription-ledger', 'saas', Receipt, tile('bg-fuchsia-100', 'text-fuchsia-600'), lang),
    fsmsNavItem('/admin/broadcasting', 'saas', Megaphone, tile('bg-orange-100', 'text-orange-600'), lang),
    fsmsNavItem('/admin/brain-settings', 'saas', Brain, tile('bg-indigo-100', 'text-indigo-700'), lang),
    fsmsNavItem('/admin/backup', 'saas', Database, tile('bg-muted', 'text-muted-foreground'), lang),
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

  if (role === 'operator' || role === 'pump_attendant') {
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

  if (role === 'shopkeeper') {
    return menuItems.filter(
      (item) =>
        item.href === '/apps' ||
        item.href === '/dashboard' ||
        item.href === '/cashier' ||
        item.href === '/customers' ||
        item.href === '/items' ||
        item.href === '/inventory' ||
        item.href === '/reports'
    )
  }

  if (role === 'inventory_clerk') {
    return menuItems.filter(
      (item) =>
        item.href === '/apps' ||
        item.href === '/dashboard' ||
        item.href === '/items' ||
        item.href === '/inventory' ||
        item.href === '/reports'
    )
  }

  if (role === 'sales_clerk') {
    return menuItems.filter(
      (item) =>
        item.href === '/apps' ||
        item.href === '/dashboard' ||
        item.href === '/customers' ||
        item.href === '/vendors' ||
        item.href === '/invoices' ||
        item.href === '/bills' ||
        item.href === '/payments'
    )
  }

  if (role === 'forecourt_supervisor') {
    return menuItems.filter((item) => {
      const stationItems = ['/stations', '/tanks', '/islands', '/dispensers', '/meters', '/nozzles']
      if (stationItems.includes(item.href)) return true
      if (item.href === '/apps' || item.href === '/dashboard') return true
      if (item.href === '/shift-management' || item.href === '/tank-dips') return true
      if (item.href === '/reports') return true
      return false
    })
  }

  if (role === 'hr_officer') {
    return menuItems.filter(
      (item) =>
        item.href === '/apps' ||
        item.href === '/dashboard' ||
        item.href === '/employees' ||
        item.href === '/payroll'
    )
  }

  if (role === 'auditor') {
    return menuItems.filter((item) => {
      if (item.href === '/users' || item.href === '/roles' || item.href === '/backup') return false
      if (item.href === '/cashier') return false
      const stationItems = ['/stations', '/tanks', '/islands', '/dispensers', '/meters', '/nozzles']
      if (stationItems.includes(item.href)) return false
      return true
    })
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

/** Tenant Admin (built-in ``admin``) or platform super-admin — matches aquaculture API access. */
export function isTenantAdminAquacultureUser(
  userRole: string | null,
  isSuperAdmin: boolean
): boolean {
  return isSuperAdmin || (userRole || '').toLowerCase() === 'admin'
}

function isAquacultureHref(href: string): boolean {
  return href.startsWith('/aquaculture') || href.includes('aquaculture-pl-management')
}

/**
 * Hide Aquaculture when the company flag is off, or when the user has no aquaculture permission.
 */
export function filterAquacultureMenuWhenDisabled(
  items: ErpAppMenuItem[],
  aquacultureEnabled: boolean,
  userRole: string | null,
  isSuperAdmin: boolean,
  effectivePermissions?: string[] | null
): ErpAppMenuItem[] {
  if (!aquacultureEnabled) {
    return items.filter((i) => !isAquacultureHref(i.href))
  }
  if (isTenantAdminAquacultureUser(userRole, isSuperAdmin)) {
    return items
  }
  if (effectivePermissions != null) {
    if (hasAnyAquacultureModuleInList(effectivePermissions)) {
      return items
    }
    return items.filter((i) => !isAquacultureHref(i.href))
  }
  return items.filter((i) => !isAquacultureHref(i.href))
}

/**
 * True when Aquaculture workspace routes may load: module enabled, FSMS ERP mode, and user has access.
 */
export function isAquacultureNavUnlocked(
  userRole: string | null,
  isSuperAdmin: boolean,
  mode: 'fsms_erp' | 'saas_dashboard',
  userPermissions: string[] | null,
  aquacultureEnabled: boolean
): boolean {
  if (!aquacultureEnabled || mode !== 'fsms_erp') return false
  if (isTenantAdminAquacultureUser(userRole, isSuperAdmin)) return true
  if (userPermissions != null && hasAnyAquacultureModuleInList(userPermissions)) return true
  return false
}

function roleAllowsBackupByDefault(role: string): boolean {
  const r = role.toLowerCase()
  return r === 'admin' || r === 'super_admin' || r === 'manager'
}

export function filterTenantBackupMenuItem(
  items: ErpAppMenuItem[],
  role: string,
  effectivePermissions?: string[] | null
): ErpAppMenuItem[] {
  return items.filter((item) => {
    if (item.href !== '/backup') return true
    if (effectivePermissions != null) {
      return effectivePermissions.includes(PERM_WILDCARD) || effectivePermissions.includes('app.backup')
    }
    // Role only — never read localStorage here (SSR/hydration must match first client paint).
    return roleAllowsBackupByDefault(role)
  })
}

const FSMS_SECTION_IDS: ErpAppSection[] = [
  'main',
  'station',
  'operations',
  'accounting',
  'sales',
  'inventory',
  'hr',
  'management',
  'aquaculture',
  'reports',
]

export function getSectionDefinitions(
  isSuperAdmin: boolean,
  mode: 'fsms_erp' | 'saas_dashboard',
  visibleItemSections: Set<ErpAppSection>,
  lang: AppLanguage = 'en'
): { id: ErpAppSection; label: string }[] {
  if (isSuperAdmin && mode === 'saas_dashboard') {
    return [{ id: 'saas', label: navSectionLabel('saas', lang) }]
  }
  const sections = FSMS_SECTION_IDS.map((id) => ({
    id,
    label: navSectionLabel(id as ErpNavSectionId, lang),
  }))
  if (isSuperAdmin && mode === 'fsms_erp') {
    return sections
  }
  return sections.filter((s) => visibleItemSections.has(s.id))
}
