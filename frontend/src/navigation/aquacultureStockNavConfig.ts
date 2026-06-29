import type { LucideIcon } from 'lucide-react'
import { Beaker, BookOpen, Fish, Layers, ListOrdered, Package, Settings2, ArrowRightLeft } from 'lucide-react'

export type AquacultureStockNavItem = {
  href: string
  label: string
  sidebarLabel?: string
  icon: LucideIcon
  /** fish | warehouse | setup — groups items in the workspace menubar */
  group: 'fish' | 'warehouse' | 'setup'
}

export const AQUACULTURE_STOCK_SUB_NAV: AquacultureStockNavItem[] = [
  { href: '/aquaculture/stock', label: 'Stock by pond', icon: Fish, group: 'fish' },
  {
    href: '/aquaculture/stock/adjustments',
    label: 'Mortality & adjustments',
    sidebarLabel: 'Mortality & adj.',
    icon: ListOrdered,
    group: 'fish',
  },
  { href: '/aquaculture/stock/movements', label: 'All movements', icon: ArrowRightLeft, group: 'fish' },
  { href: '/aquaculture/stock/breakdown', label: 'Batch detail', icon: Layers, group: 'fish' },
  {
    href: '/aquaculture/stock/biological-asset',
    label: 'Biological asset',
    sidebarLabel: 'Bio asset',
    icon: BookOpen,
    group: 'fish',
  },
  {
    href: '/aquaculture/stock/supplies',
    label: 'Feed & supplies',
    sidebarLabel: 'Feed & supplies',
    icon: Package,
    group: 'warehouse',
  },
  {
    href: '/aquaculture/stock/supplies/movements',
    label: 'Warehouse movements',
    sidebarLabel: 'WH movements',
    icon: ArrowRightLeft,
    group: 'warehouse',
  },
  {
    href: '/aquaculture/stock/supplies/consumed',
    label: 'Consumed',
    sidebarLabel: 'Consumed',
    icon: Beaker,
    group: 'warehouse',
  },
  {
    href: '/aquaculture/stock/options',
    label: 'Shared warehouse groups',
    sidebarLabel: 'Options',
    icon: Settings2,
    group: 'setup',
  },
]

export function parseAquacultureStockRoute(pathname: string): {
  mainTab: 'fish' | 'warehouse'
  fishSubTab: 'overview' | 'adjustments' | 'history' | 'breakdown' | 'biological_asset'
  whSubTab: 'on_hand' | 'movements' | 'consumed'
  isOptionsPage: boolean
} {
  const path = (pathname || '').replace(/\/$/, '') || '/aquaculture/stock'

  if (path === '/aquaculture/stock/options') {
    return { mainTab: 'warehouse', fishSubTab: 'overview', whSubTab: 'on_hand', isOptionsPage: true }
  }

  if (path.startsWith('/aquaculture/stock/supplies')) {
    const suffix = path.slice('/aquaculture/stock/supplies'.length)
    const whSubTab =
      suffix === '/movements' ? 'movements' : suffix === '/consumed' ? 'consumed' : 'on_hand'
    return { mainTab: 'warehouse', fishSubTab: 'overview', whSubTab, isOptionsPage: false }
  }

  const suffix = path.slice('/aquaculture/stock'.length)
  if (suffix === '/adjustments') {
    return { mainTab: 'fish', fishSubTab: 'adjustments', whSubTab: 'on_hand', isOptionsPage: false }
  }
  if (suffix === '/movements') {
    return { mainTab: 'fish', fishSubTab: 'history', whSubTab: 'on_hand', isOptionsPage: false }
  }
  if (suffix === '/breakdown') {
    return { mainTab: 'fish', fishSubTab: 'breakdown', whSubTab: 'on_hand', isOptionsPage: false }
  }
  if (suffix === '/biological-asset') {
    return { mainTab: 'fish', fishSubTab: 'biological_asset', whSubTab: 'on_hand', isOptionsPage: false }
  }

  return { mainTab: 'fish', fishSubTab: 'overview', whSubTab: 'on_hand', isOptionsPage: false }
}

export function isAquacultureStockNavActive(pathname: string, href: string): boolean {
  const path = (pathname || '').replace(/\/$/, '') || '/'
  const h = href.replace(/\/$/, '') || '/'
  if (h === '/aquaculture/stock') return path === '/aquaculture/stock'
  return path === h || path.startsWith(`${h}/`)
}
