/** True when `pathname` matches a sidebar / app-tile href (longest-prefix wins at call site). */
export function isPathActiveForNavItem(pathname: string, href: string): boolean {
  if (pathname === href) return true
  if (href === '/') return pathname === '/'
  return pathname.startsWith(`${href}/`)
}

/** Pick the most specific menu href for the current path (avoids parent routes stealing highlight). */
export function resolveActiveNavHref(
  pathname: string | null,
  items: readonly { href: string }[]
): string | null {
  if (!pathname) return null
  const matches = items.filter((item) => isPathActiveForNavItem(pathname, item.href))
  if (!matches.length) return null
  return matches.reduce((a, b) => (a.href.length >= b.href.length ? a : b)).href
}
