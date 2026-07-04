/** Routes where we should not call authenticated APIs (stale tokens still in localStorage). */

const PREFIXES = ['/login', '/forgot-password', '/reset-password'] as const

const BRAIN_PREFIX = '/brain-app'

export function isPublicAuthRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  if (pathname === BRAIN_PREFIX || pathname.startsWith(`${BRAIN_PREFIX}/`)) return true
  return PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}
