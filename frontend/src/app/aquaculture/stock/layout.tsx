'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import {
  AQUACULTURE_STOCK_SUB_NAV,
  isAquacultureStockNavActive,
  parseAquacultureStockRoute,
} from '@/navigation/aquacultureStockNavConfig'

const menubarTabClass = (active: boolean) =>
  `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
    active ? 'bg-teal-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
  }`

export default function AquacultureStockLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const route = parseAquacultureStockRoute(pathname || '')
  const fishItems = AQUACULTURE_STOCK_SUB_NAV.filter((i) => i.group === 'fish')
  const warehouseItems = AQUACULTURE_STOCK_SUB_NAV.filter((i) => i.group === 'warehouse')
  const setupItems = AQUACULTURE_STOCK_SUB_NAV.filter((i) => i.group === 'setup')

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Link
            href="/aquaculture"
            className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-teal-800 hover:text-teal-950"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Dashboard
          </Link>
          <h1 id="aq-stock-title" className="text-2xl font-bold tracking-tight text-slate-900">
            Pond stock
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">
            {route.isOptionsPage
              ? 'Configure shared feed and medicine stores used by multiple ponds.'
              : route.mainTab === 'fish'
                ? 'See how many fish you have in each pond. Record mortality, theft, and corrections under Adjustments.'
                : 'Feed, medicine, and supplies stored at each pond — separate from live fish in the water.'}
          </p>

          <nav
            className="mt-4 space-y-2"
            aria-label="Pond stock sections"
          >
            <div
              className="inline-flex max-w-full flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 shadow-inner"
              role="tablist"
              aria-label="Fish stock views"
            >
              {fishItems.map((item) => {
                const Icon = item.icon
                const active = isAquacultureStockNavActive(pathname || '', item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    role="tab"
                    aria-selected={active}
                    className={menubarTabClass(active)}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Icon className="h-4 w-4 text-current opacity-90" aria-hidden />
                      {item.label}
                    </span>
                  </Link>
                )
              })}
            </div>

            <div
              className="inline-flex max-w-full flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 shadow-inner"
              role="tablist"
              aria-label="Pond warehouse views"
            >
              {warehouseItems.map((item) => {
                const Icon = item.icon
                const active = isAquacultureStockNavActive(pathname || '', item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    role="tab"
                    aria-selected={active}
                    className={menubarTabClass(active)}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Icon className="h-4 w-4 text-current opacity-90" aria-hidden />
                      {item.label}
                    </span>
                  </Link>
                )
              })}
            </div>

            <div
              className="inline-flex max-w-full flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 shadow-inner"
              role="tablist"
              aria-label="Stock options"
            >
              {setupItems.map((item) => {
                const Icon = item.icon
                const active = isAquacultureStockNavActive(pathname || '', item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    role="tab"
                    aria-selected={active}
                    className={menubarTabClass(active)}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Icon className="h-4 w-4 text-current opacity-90" aria-hidden />
                      {item.label}
                    </span>
                  </Link>
                )
              })}
            </div>
          </nav>
        </div>
      </div>

      {children}
    </div>
  )
}
