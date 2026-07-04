import { getDefaultLandingHref } from '@/utils/dashboardLanding'

/** Safe post-login redirect from ?next= (internal paths only). */
export function safeLoginNextPath(raw: string | null | undefined): string | null {
  const path = (raw || '').trim()
  if (!path.startsWith('/') || path.startsWith('//')) return null
  if (path.startsWith('/login')) return null
  return path
}

export function loginRedirectAfterAuth(
  role: string | null | undefined,
  permissions: string[] | null | undefined,
  nextRaw: string | null | undefined
): string {
  const next = safeLoginNextPath(nextRaw)
  if (next) return next
  return getDefaultLandingHref(role, permissions)
}
