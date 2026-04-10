/**
 * Role-Based Access Control (RBAC) Utilities
 * Helper functions for checking user roles and permissions
 */

export type UserRole = 'super_admin' | 'admin' | 'accountant' | 'cashier' | 'worker'

/**
 * Get current user role from localStorage
 */
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
  // All roles can access POS
  return hasRole(['super_admin', 'admin', 'accountant', 'cashier'])
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
    worker: 'Worker'
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
    worker: 'bg-gray-100 text-gray-800'
  }

  return colorMap[role.toLowerCase()] || 'bg-gray-100 text-gray-800'
}

