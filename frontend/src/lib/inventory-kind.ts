/**
 * Primary ERP classification: how the master record relates to warehouse/inventory.
 * Product category (feed, flour, fuel, etc.) stays on `type`; this is the stock/GL posture.
 */
export const INVENTORY_KIND_OPTIONS: {
  value: string
  label: string
  shortLabel: string
  description: string
}[] = [
  {
    value: 'inventory',
    label: 'Inventory (stocked)',
    shortLabel: 'Inventory',
    description: 'Physical goods with quantity on hand in warehouses.',
  },
  {
    value: 'non_inventory',
    label: 'Non-inventory',
    shortLabel: 'Non-inv.',
    description: 'Sold or bought without quantity tracking (e.g. some pass-through or expense SKUs).',
  },
  {
    value: 'service',
    label: 'Service',
    shortLabel: 'Service',
    description: 'Labour, fees, subscriptions — no stock.',
  },
  {
    value: 'other',
    label: 'Other',
    shortLabel: 'Other',
    description: 'Miscellaneous classification not captured above.',
  },
]

export const INVENTORY_KIND_VALUES = INVENTORY_KIND_OPTIONS.map((o) => o.value)

export function inventoryKindLabel(value: string | undefined): string {
  if (!value) return '—'
  return INVENTORY_KIND_OPTIONS.find((o) => o.value === value)?.shortLabel ?? value
}

export function inferInventoryKindFromItem(item: {
  inventory_kind?: string
  type: string
  is_stock_tracked: boolean
}): string {
  if (item.inventory_kind && INVENTORY_KIND_VALUES.includes(item.inventory_kind)) {
    return item.inventory_kind
  }
  if (item.type === 'service') return 'service'
  return item.is_stock_tracked ? 'inventory' : 'non_inventory'
}
