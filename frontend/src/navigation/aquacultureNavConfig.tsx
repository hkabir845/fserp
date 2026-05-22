import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard,
  MapPin,
  Landmark,
  Layers,
  ArrowRightLeft,
  Fish,
  Gauge,
  Sparkles,
  Pill,
  DollarSign,
  Wallet,
  Archive,
  Receipt,
} from 'lucide-react'

export type AquacultureNavItem = {
  href: string
  /** Page title / sub-nav */
  label: string
  /** Shorter label for the global sidebar & app tiles when set */
  sidebarLabel?: string
  icon: LucideIcon
}

export type AquacultureNavGroup = {
  id: string
  label: string
  description: string
  items: AquacultureNavItem[]
}

/** Grouped module map: used by workspace sub-nav and kept in sync with the ERP sidebar order. */
export const AQUACULTURE_NAV_GROUPS: AquacultureNavGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'KPIs and pond roll-up for the period',
    items: [
      {
        href: '/aquaculture',
        label: 'Operations dashboard',
        sidebarLabel: 'Dashboard',
        icon: LayoutDashboard,
      },
    ],
  },
  {
    id: 'site',
    label: 'Site & lease',
    description: 'Ponds, water area, and landlord contracts',
    items: [
      { href: '/aquaculture/ponds', label: 'Ponds', icon: MapPin },
      { href: '/aquaculture/landlords', label: 'Landlords', icon: Landmark },
    ],
  },
  {
    id: 'production',
    label: 'Fish production',
    description: 'Cycles, movements, inventory, and biology',
    items: [
      { href: '/aquaculture/cycles', label: 'Production cycles', icon: Layers },
      { href: '/aquaculture/transfers', label: 'Pond transfers', sidebarLabel: 'Fish pond transfers', icon: ArrowRightLeft },
      { href: '/aquaculture/stock', label: 'Pond stock', sidebarLabel: 'Pond stock', icon: Fish },
      { href: '/aquaculture/sampling', label: 'Biomass sampling', icon: Gauge },
      { href: '/aquaculture/feeding', label: 'Feeding advice', icon: Sparkles },
      { href: '/aquaculture/medicine', label: 'Medicine & treatments', icon: Pill },
    ],
  },
  {
    id: 'economics',
    label: 'Economics',
    description: 'Sales, costs, and allocated P&L',
    items: [
      { href: '/aquaculture/sales', label: 'Pond & fish sales', icon: DollarSign },
      {
        href: '/aquaculture/expenses',
        label: 'Pond costs & expenses',
        sidebarLabel: 'Pond costs',
        icon: Receipt,
      },
      {
        href: '/aquaculture/financing',
        label: 'Financing & loan repayment',
        sidebarLabel: 'Financing',
        icon: Wallet,
      },
    ],
  },
  {
    id: 'archive',
    label: 'Archive',
    description: 'Year close: archive operational data, keep pond structure, start next season',
    items: [
      {
        href: '/aquaculture/data-bank',
        label: 'Data Bank',
        sidebarLabel: 'Data Bank',
        icon: Archive,
      },
    ],
  },
]

/** Flat list in group order — for app launcher / sidebar menu assembly. */
export function getAquacultureMenuItemsFlat(): AquacultureNavItem[] {
  return AQUACULTURE_NAV_GROUPS.flatMap((g) => g.items)
}

export type AquacultureNavItemWithGroup = AquacultureNavItem & {
  groupId: string
  groupLabel: string
}

/** Same flat order, but each item carries its group id/label for sub-section rendering. */
export function getAquacultureMenuItemsFlatWithGroup(): AquacultureNavItemWithGroup[] {
  return AQUACULTURE_NAV_GROUPS.flatMap((g) =>
    g.items.map((item) => ({ ...item, groupId: g.id, groupLabel: g.label }))
  )
}

export function isAquacultureNavItemActive(pathname: string, href: string): boolean {
  const path = pathname.replace(/\/$/, '') || '/'
  const h = href.replace(/\/$/, '') || '/'
  if (h === '/aquaculture') return path === '/aquaculture'
  return path === h || path.startsWith(`${h}/`)
}
