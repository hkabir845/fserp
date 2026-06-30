'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/settings/general', label: 'General Settings' },
  { href: '/settings/currencies', label: 'Currencies' },
  { href: '/settings/units', label: 'Units of Measure' },
] as const

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="py-8">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Company Settings</h1>
          <p className="mt-2 text-muted-foreground">Manage your company settings, currencies, and units of measure</p>
        </div>

        <div className="mb-6 border-b border-border">
          <nav className="-mb-px flex space-x-8" aria-label="Settings sections">
            {TABS.map((tab) => {
              const active = pathname === tab.href || pathname?.startsWith(`${tab.href}/`)
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`border-b-2 py-4 px-1 text-sm font-medium transition-colors ${
                    active
                      ? 'border-indigo-500 text-primary'
                      : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground/85'
                  }`}
                >
                  {tab.label}
                </Link>
              )
            })}
          </nav>
        </div>

        {children}
      </div>
    </div>
  )
}
