/** Routes where we should not call authenticated APIs (stale tokens still in localStorage). */

const PREFIXES = ['/login', '/forgot-password', '/reset-password'] as const

export function isPublicAuthRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  return PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}
