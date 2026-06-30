'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS: { href: string; label: string; exact?: boolean }[] = [
  { href: '/payroll', label: 'Overview', exact: true },
  { href: '/payroll/employees', label: 'Employees' },
  { href: '/payroll/runs', label: 'Payroll runs' },
]

function tabActive(pathname: string | null, href: string, exact?: boolean) {
  if (!pathname) return false
  if (exact) return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function PayrollNav() {
  const pathname = usePathname()

  return (
    <nav
      className="flex gap-1 overflow-x-auto pb-1 -mb-px border-b border-border"
      aria-label="Payroll sections"
    >
      {TABS.map(({ href, label, exact }) => {
        const active = tabActive(pathname, href, exact)
        return (
          <Link
            key={href}
            href={href}
            className={`
              shrink-0 whitespace-nowrap rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors
              ${
                active
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }
            `}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
