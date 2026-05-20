/**
 * Role-Based Access Control (RBAC) Utilities
 * Helper functions for checking user roles and permissions
 */

export type UserRole =
  | 'super_admin'
  | 'admin'
  | 'accountant'
  | 'cashier'
  | 'operator'

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
  if (role !== 'cashier' && role !== 'operator') return null
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
 */
export function hasPermission(key: string): boolean {
  const p = getCurrentUserPermissions()
  if (p == null) return true
  if (p.includes('*')) return true
  return p.includes(key)
}

/** Inventory valuation & velocity report: extra key `report.inventory_sku` when permissions are in use. */
export function canViewInventorySkuReport(userRole: string | null): boolean {
  const p = getCurrentUserPermissions()
  const r = (userRole || '').toLowerCase()
  if (p != null) {
    return p.includes('*') || p.includes('report.inventory_sku')
  }
  return ['super_admin', 'admin', 'accountant', 'manager'].includes(r)
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
  return role === 'operator'
}

export function getRoleDisplayName(role: UserRole | string | null): string {
  if (!role) return 'Unknown'

  const roleMap: Record<string, string> = {
    super_admin: 'Super Admin',
    admin: 'Admin',
    accountant: 'Accountant',
    cashier: 'Cashier',
    operator: 'Operator',
  }

  return roleMap[role.toLowerCase()] || role
}

export function getRoleBadgeColor(role: UserRole | string | null): string {
  if (!role) return 'bg-gray-100 text-gray-800'

  const colorMap: Record<string, string> = {
    super_admin: 'bg-purple-100 text-purple-800',
    admin: 'bg-blue-100 text-blue-800',
    accountant: 'bg-green-100 text-green-800',
    cashier: 'bg-orange-100 text-orange-800',
    operator: 'bg-teal-100 text-teal-800',
  }

  return colorMap[role.toLowerCase()] || 'bg-gray-100 text-gray-800'
}
