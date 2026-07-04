/** Routes where we should not call authenticated APIs (stale tokens still in localStorage). */

const PREFIXES = ['/login', '/forgot-password', '/reset-password'] as const

const BRAIN_PUBLIC = ['/brain-app/login', '/brain-app/install'] as const

export const BRAIN_LOGIN_PATH = '/brain-app/login'

/** Standalone Brain PWA routes (use BrainAppProviders in layout, not root CompanyProvider). */
export function isBrainAppRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  return pathname === '/brain-app' || pathname.startsWith('/brain-app/')
}

export function isPublicAuthRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  if (BRAIN_PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return true
  return PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}
