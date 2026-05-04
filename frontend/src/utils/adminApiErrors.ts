/**
 * Messages for SaaS admin list endpoints after deploy/upgrade.
 * Distinguishes wrong API host, permissions, and auth so operators are not shown a misleading empty list.
 */
export function messageForAdminListError(
  error: unknown,
  resource: 'companies' | 'users' | 'stats'
): string {
  const ax = error as {
    response?: { status?: number; data?: { detail?: string } }
    code?: string
    message?: string
  }
  const status = ax?.response?.status
  const detail = ax?.response?.data?.detail
  if (status === 403) {
    return typeof detail === 'string'
      ? detail
      : 'Super Admin access is required. If you use a tenant admin account, sign in with a platform super admin user to load the full company list from your database.'
  }
  if (status === 401) {
    return typeof detail === 'string' ? detail : 'Session expired. Sign in again.'
  }
  if (ax?.code === 'ERR_NETWORK' || ax?.message?.includes('Network Error')) {
    return (
      'Cannot reach the API. After a deploy or upgrade, set NEXT_PUBLIC_API_BASE_URL to your backend URL ' +
      '(the same Django instance that uses your existing database), rebuild the frontend, and hard-refresh. ' +
      'If the browser calls the wrong API host, your existing tenants will not appear here.'
    )
  }
  return typeof detail === 'string' ? detail : `Failed to load ${resource}.`
}
