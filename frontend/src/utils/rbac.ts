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
 * Get current user role from localStorage
 */
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

/**
 * Check if current user has one of the required roles
 */
export function hasRole(requiredRoles: UserRole | UserRole[]): boolean {
  const userRole = getCurrentUserRole()
  if (!userRole) return false

  const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles]
  return roles.includes(userRole)
}

/**
 * Check if current user is Super Admin
 */
export function isSuperAdmin(): boolean {
  return hasRole('super_admin')
}

/**
 * Check if current user is Admin (including Super Admin)
 */
export function isAdmin(): boolean {
  return hasRole(['super_admin', 'admin'])
}

/**
 * Check if current user is Accountant (including Admin and Super Admin)
 */
export function isAccountant(): boolean {
  return hasRole(['super_admin', 'admin', 'accountant'])
}

/**
 * Check if current user is Cashier
 */
export function isCashier(): boolean {
  return hasRole('cashier')
}

/** Register staff limited to New sale + Donation on POS (not full cashier tools). */
export function isLimitedPosRegisterUser(): boolean {
  return hasRole('operator')
}

/**
 * Check if user can access management features
 */
export function canManageUsers(): boolean {
  return hasRole(['super_admin', 'admin'])
}

/**
 * Check if user can access accounting features
 */
export function canAccessAccounting(): boolean {
  return hasRole(['super_admin', 'admin', 'accountant'])
}

/**
 * Check if user can manage stations/hardware
 */
export function canManageStations(): boolean {
  return hasRole(['super_admin', 'admin'])
}

/**
 * Check if user can create/edit invoices
 */
export function canManageInvoices(): boolean {
  return hasRole(['super_admin', 'admin', 'accountant'])
}

/**
 * Check if user can access POS
 */
export function canAccessPOS(): boolean {
  return hasRole(['super_admin', 'admin', 'accountant', 'cashier', 'operator'])
}

/**
 * Check if user can view reports
 */
export function canViewReports(): boolean {
  // All roles can view reports (with different permissions)
  return hasRole(['super_admin', 'admin', 'accountant', 'cashier'])
}

/**
 * Get role display name
 */
export function getRoleDisplayName(role: UserRole | string | null): string {
  if (!role) return 'Unknown'

  const roleMap: Record<string, string> = {
    super_admin: 'Super Admin',
    admin: 'Admin',
    accountant: 'Accountant',
    cashier: 'Cashier',
    operator: 'Operator'
  }

  return roleMap[role.toLowerCase()] || role
}

/**
 * Get role badge color class
 */
export function getRoleBadgeColor(role: UserRole | string | null): string {
  if (!role) return 'bg-gray-100 text-gray-800'

  const colorMap: Record<string, string> = {
    super_admin: 'bg-purple-100 text-purple-800',
    admin: 'bg-blue-100 text-blue-800',
    accountant: 'bg-green-100 text-green-800',
    cashier: 'bg-orange-100 text-orange-800',
    operator: 'bg-teal-100 text-teal-800'
  }

  return colorMap[role.toLowerCase()] || 'bg-gray-100 text-gray-800'
}

