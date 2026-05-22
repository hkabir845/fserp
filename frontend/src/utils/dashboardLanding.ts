import type { UserRole } from '@/utils/rbac'

function permissionsAllow(permissions: string[], key: string): boolean {
  if (permissions.includes('*')) return true
  if (permissions.includes(key)) return true
  if (key.startsWith('app.aquaculture.') && permissions.includes('app.aquaculture')) return true
  return false
}

/**
 * Default route after login (or when an authenticated user opens `/login`).
 */
export function getDefaultLandingHref(
  role: string | null | undefined,
  permissions?: string[] | null
): string {
  const r = (role || '').toLowerCase()

  if (r === 'super_admin') return '/admin'
  if (r === 'operator') return '/cashier'
  if (r === 'cashier') return '/cashier'

  if (permissions != null) {
    const hasAquaculture =
      permissionsAllow(permissions, 'app.aquaculture') ||
      permissions.some((p) => p.startsWith('app.aquaculture.'))
    const hasFuelOrShop =
      permissionsAllow(permissions, 'app.pos') ||
      permissionsAllow(permissions, 'app.operations') ||
      permissionsAllow(permissions, 'app.accounting') ||
      permissionsAllow(permissions, 'app.sales') ||
      permissionsAllow(permissions, 'app.inventory')
    if (hasAquaculture && !hasFuelOrShop) return '/aquaculture'
    if (permissionsAllow(permissions, 'app.launcher')) return '/dashboard'
    if (permissionsAllow(permissions, 'app.pos')) return '/cashier'
    if (hasAquaculture) return '/aquaculture'
    return '/login'
  }

  return '/dashboard'
}

export function getRoleLandingLabel(role: UserRole | string | null): string {
  const r = (role || '').toLowerCase()
  const labels: Record<string, string> = {
    super_admin: 'Platform',
    admin: 'Administration',
    manager: 'Operations',
    accountant: 'Finance',
    supervisor: 'Field operations',
    cashier: 'Point of sale',
    operator: 'Register',
  }
  return labels[r] || 'Workspace'
}
