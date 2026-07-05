/**
 * Role-Based Access Control (RBAC) Utilities
 * Helper functions for checking user roles and permissions
 */

import {
  BUILTIN_JOB_TYPE_SEEDS,
  LIMITED_POS_REGISTER_ROLES,
  ROLES_REQUIRING_HOME_STATION,
  TENANT_JOB_TYPE_OPTIONS,
} from '@/constants/tenantJobTypes'
import { PAGE_PERMISSION_PARENT_BY_ID } from '@/navigation/appPagePermissions'

export type UserRole =
  | 'super_admin'
  | 'admin'
  | 'manager'
  | 'accountant'
  | 'auditor'
  | 'forecourt_supervisor'
  | 'supervisor'
  | 'inventory_clerk'
  | 'sales_clerk'
  | 'shopkeeper'
  | 'cashier'
  | 'pump_attendant'
  | 'operator'
  | 'hr_officer'

/** What this login may sell at POS (from login / user API). */
export type PosSaleScope = 'both' | 'general' | 'fuel'

const POS_SALE_SCOPES: ReadonlySet<string> = new Set(['both', 'general', 'fuel'])

/**
 * From localStorage `user` (set at login). Defaults to `both` if missing (legacy session).
 */
export function getPosSaleScope(): PosSaleScope {
  if (typeof window === 'undefined') return 'both'
  const userStr = localStorage.getItem('user')
  if (!userStr || userStr === 'undefined' || userStr === 'null') {
    return 'both'
  }
  try {
    const user = JSON.parse(userStr) as { pos_sale_scope?: string }
    const s = (user?.pos_sale_scope || 'both').toString().trim().toLowerCase()
    if (POS_SALE_SCOPES.has(s)) return s as PosSaleScope
  } catch {
    /* ignore */
  }
  return 'both'
}

/**
 * Cashier / operator logins with a home station: POS must use that site only (server enforces on checkout).
 */
export function getPosHomeStationId(): number | null {
  if (typeof window === 'undefined') return null
  const role = getCurrentUserRole()
  if (!role || !ROLES_REQUIRING_HOME_STATION.has(role)) return null
  const userStr = localStorage.getItem('user')
  if (!userStr || userStr === 'undefined' || userStr === 'null') return null
  try {
    const user = JSON.parse(userStr) as { home_station_id?: unknown }
    const raw = user?.home_station_id
    if (raw == null || raw === '') return null
    const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

/** Effective permission keys from login (optional). When absent, UI falls back to role-based rules. */
export function getCurrentUserPermissions(): string[] | null {
  if (typeof window === 'undefined') return null
  const userStr = localStorage.getItem('user')
  if (!userStr || userStr === 'undefined' || userStr === 'null') {
    return null
  }
  try {
    const user = JSON.parse(userStr) as { permissions?: unknown }
    if (user && Array.isArray(user.permissions)) {
      return user.permissions as string[]
    }
  } catch {
    /* ignore */
  }
  return null
}

/**
 * When `user.permissions` is present from the API, checks the list. When absent (legacy session), returns true so existing role-based UI still works.
 * ``app.aquaculture`` grants every ``app.aquaculture.*`` module key.
 */
export function hasPermission(key: string): boolean {
  const p = getCurrentUserPermissions()
  if (p == null) return true
  if (p.includes('*')) return true
  if (p.includes(key)) return true
  if (key.startsWith('app.page.')) {
    const parent = PAGE_PERMISSION_PARENT_BY_ID[key]
    if (parent && p.includes(parent)) return true
    if (key === 'app.page.customers' && p.includes('app.sales')) return true
  }
  if (key.startsWith('app.aquaculture.') && (p.includes('app.aquaculture') || p.includes(key))) {
    return true
  }
  return false
}

/** Tenant Backup & Restore (Management → Backup & Restore). Matches backend ``app.backup`` enforcement. */
export function canAccessBackup(userRole?: string | null): boolean {
  const p = getCurrentUserPermissions()
  if (p != null) {
    return p.includes('*') || p.includes('app.backup')
  }
  const r = (userRole ?? getCurrentUserRole() ?? '').toLowerCase()
  return r === 'admin' || r === 'super_admin' || r === 'manager'
}

/** Any aquaculture module or the all-modules parent key. */
export function hasAnyAquaculturePermission(): boolean {
  const p = getCurrentUserPermissions()
  if (p == null) return true
  if (p.includes('*') || p.includes('app.aquaculture')) return true
  return p.some((k) => k.startsWith('app.aquaculture.'))
}

const INVENTORY_REPORT_IDS = new Set([
  'inventory-sku-valuation',
  'item-master-by-category',
  'item-sales-by-category',
  'item-purchases-by-category',
  'item-sales-custom',
  'item-purchases-custom',
  'item-stock-movement',
  'item-velocity-analysis',
  'item-purchase-velocity-analysis',
])

const AQUACULTURE_REPORT_IDS = new Set([
  'aquaculture-pl-management',
  'aquaculture-pond-pl',
  'aquaculture-fish-sales',
  'aquaculture-pond-sales-comprehensive',
  'aquaculture-expenses',
  'aquaculture-feed-medicine-consumption',
  'aquaculture-sampling',
  'aquaculture-production-cycles',
  'aquaculture-profit-transfers',
  'aquaculture-fish-transfers',
  'aquaculture-fingerling-transfers',
  'aquaculture-pond-feed-stock',
  'aquaculture-pond-medicine-stock',
  'aquaculture-pond-supplies-stock',
  'aquaculture-fish-stock-position',
  'aquaculture-fcr-biomass',
  'aquaculture-fish-growth',
  'aquaculture-pond-performance',
  'aquaculture-shop-station-stock',
  'aquaculture-equipment-assets',
  'aquaculture-pond-total-inventory',
])

/** Permission key for a report slug (matches backend ``report_permission_key``). */
export function reportPermissionKey(reportId: string): string {
  return `report.${(reportId || '').trim().replace(/-/g, '_')}`
}

/**
 * Whether the current user may open a report (hub card + API). When ``user.permissions`` is absent, returns true
 * (legacy role-based filters on the Reports page still apply).
 */
export function canAccessReport(reportId: string): boolean {
  const p = getCurrentUserPermissions()
  if (p == null) return true
  if (p.includes('*')) return true
  const rid = (reportId || '').trim()
  if (!rid) return false
  if (p.includes(reportPermissionKey(rid))) return true
  if (INVENTORY_REPORT_IDS.has(rid)) {
    return p.includes('report.inventory_sku')
  }
  if (rid === 'aquaculture-pl-management') {
    return p.includes('app.aquaculture') || p.includes('app.aquaculture.report_pl')
  }
  if (AQUACULTURE_REPORT_IDS.has(rid)) {
    return p.includes('app.aquaculture')
  }
  return p.includes('app.reports')
}

/** Inventory valuation & velocity report: extra key `report.inventory_sku` when permissions are in use. */
export function canViewInventorySkuReport(userRole: string | null): boolean {
  const p = getCurrentUserPermissions()
  const r = (userRole || '').toLowerCase()
  if (p != null) {
    if (p.includes('*')) return true
    if (p.includes('report.inventory_sku')) return true
    return [...INVENTORY_REPORT_IDS].some((id) => p.includes(reportPermissionKey(id)))
  }
  return ['super_admin', 'admin', 'accountant', 'manager', 'auditor', 'inventory_clerk'].includes(r)
}

export function getCurrentUserRole(): UserRole | null {
  if (typeof window === 'undefined') return null

  const userStr = localStorage.getItem('user')
  if (!userStr || userStr === 'undefined' || userStr === 'null') {
    return null
  }

  try {
    const user = JSON.parse(userStr)
    return (user.role?.toLowerCase() || null) as UserRole | null
  } catch (error) {
    console.error('Error parsing user data:', error)
    return null
  }
}

/** Register staff limited to New sale + Donation on POS (not full cashier tools). */
export function isLimitedPosRegisterUser(): boolean {
  const role = getCurrentUserRole()
  return role != null && LIMITED_POS_REGISTER_ROLES.has(role)
}

export function getRoleDisplayName(role: UserRole | string | null): string {
  if (!role) return 'Unknown'

  const fromCatalog = TENANT_JOB_TYPE_OPTIONS.find((o) => o.value === role.toLowerCase())?.label
  if (fromCatalog) return fromCatalog

  const roleMap: Record<string, string> = {
    super_admin: 'Super Admin',
    user: 'User',
  }

  return roleMap[role.toLowerCase()] || role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Labels for optional access-profile seeds from ``/permission-catalog/`` (includes ``aquaculture_only``). */
export function getAccessProfileSeedLabel(seedKey: string): string {
  if (seedKey === 'aquaculture_only') {
    return 'Aquaculture only (ponds & fish — no fuel station or shop POS)'
  }
  if ((BUILTIN_JOB_TYPE_SEEDS as readonly string[]).includes(seedKey)) {
    return `Same as ${getRoleDisplayName(seedKey)} default`
  }
  return seedKey
}

/** Same seeds as {@link getAccessProfileSeedLabel}, for the Users “new access profile” dropdown. */
export function getAccessProfileSeedOptionLabel(seedKey: string): string {
  if (seedKey === 'aquaculture_only') {
    return getAccessProfileSeedLabel(seedKey)
  }
  if ((BUILTIN_JOB_TYPE_SEEDS as readonly string[]).includes(seedKey)) {
    return `Match ${getRoleDisplayName(seedKey)} defaults`
  }
  return seedKey
}

export function isPosStaffRole(role: string | null | undefined): boolean {
  return !!role && ROLES_REQUIRING_HOME_STATION.has(role.toLowerCase())
}

export function getRoleBadgeColor(role: UserRole | string | null): string {
  if (!role) return 'bg-muted text-foreground/85'

  const colorMap: Record<string, string> = {
    super_admin: 'bg-purple-100 text-purple-800',
    admin: 'bg-blue-100 text-primary',
    manager: 'bg-accent text-primary',
    accountant: 'bg-success/15 text-success',
    auditor: 'bg-emerald-100 text-emerald-900',
    forecourt_supervisor: 'bg-sky-100 text-sky-800',
    supervisor: 'bg-cyan-100 text-cyan-800',
    inventory_clerk: 'bg-teal-100 text-primary',
    sales_clerk: 'bg-rose-100 text-rose-800',
    shopkeeper: 'bg-amber-100 text-warning-foreground',
    cashier: 'bg-orange-100 text-orange-800',
    pump_attendant: 'bg-lime-100 text-lime-900',
    operator: 'bg-teal-100 text-primary',
    hr_officer: 'bg-violet-100 text-violet-800',
  }

  return colorMap[role.toLowerCase()] || 'bg-muted text-foreground/85'
}
