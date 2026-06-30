'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Package } from 'lucide-react'
import { AquaculturePageShell } from '@/components/aquaculture/AquaculturePageShell'
import { useCompanyLocale } from '@/contexts/CompanyLocaleContext'
import { aquacultureT } from '@/lib/aquacultureI18n'
import { navLabel } from '@/lib/erpNavI18n'
import { pageMetaForPath } from '@/lib/pageMetaI18n'
import {
  AQUACULTURE_STOCK_SUB_NAV,
  isAquacultureStockNavActive,
  parseAquacultureStockRoute,
} from '@/navigation/aquacultureStockNavConfig'

const menubarTabClass = (active: boolean) =>
  `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
    active ? 'bg-primary text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'
  }`

export default function AquacultureStockLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { language: lang } = useCompanyLocale()
  const route = parseAquacultureStockRoute(pathname || '')
  const meta = pageMetaForPath(
    route.isOptionsPage ? '/aquaculture/stock/options' : '/aquaculture/stock',
    lang,
  )
  const fishItems = AQUACULTURE_STOCK_SUB_NAV.filter((i) => i.group === 'fish')
  const warehouseItems = AQUACULTURE_STOCK_SUB_NAV.filter((i) => i.group === 'warehouse')
  const setupItems = AQUACULTURE_STOCK_SUB_NAV.filter((i) => i.group === 'setup')

  const stockDescription = route.isOptionsPage
    ? pageMetaForPath('/aquaculture/stock/options', lang).description
    : route.mainTab === 'fish'
      ? meta.description
      : aquacultureT('warehouseStockHint', lang)

  return (
    <AquaculturePageShell
      titleId="aq-stock-title"
      title={meta.title}
      titleIcon={Package}
      description={stockDescription}
      maxWidthClass="max-w-[1440px]"
      contentClassName="mt-4"
    >
      <nav className="space-y-2" aria-label={aquacultureT('pondStockSections', lang)}>
        <div
          className="inline-flex max-w-full flex-wrap gap-1 rounded-lg border border-border bg-muted/40 p-1 shadow-inner"
          role="tablist"
          aria-label={aquacultureT('fishStockViews', lang)}
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
                  {navLabel(item.href, lang)}
                </span>
              </Link>
            )
          })}
        </div>

        <div
          className="inline-flex max-w-full flex-wrap gap-1 rounded-lg border border-border bg-muted/40 p-1 shadow-inner"
          role="tablist"
          aria-label={aquacultureT('pondWarehouseViews', lang)}
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
                  {navLabel(item.href, lang)}
                </span>
              </Link>
            )
          })}
        </div>

        <div
          className="inline-flex max-w-full flex-wrap gap-1 rounded-lg border border-border bg-muted/40 p-1 shadow-inner"
          role="tablist"
          aria-label={aquacultureT('stockOptions', lang)}
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
                  {navLabel(item.href, lang)}
                </span>
              </Link>
            )
          })}
        </div>
      </nav>

      {children}
    </AquaculturePageShell>
  )
}
