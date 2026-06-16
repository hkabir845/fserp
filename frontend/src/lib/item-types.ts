/**
 * Canonical item types — aligned with backend `app.shared.enums.ItemType`.
 * Use for create/edit forms and filter options; DB may still contain legacy strings.
 */
export const ITEM_TYPES: { value: string; label: string }[] = [
  { value: 'raw_material', label: 'Raw material' },
  { value: 'finished_good', label: 'Finished good' },
  { value: 'feed', label: 'Feed (feed mill)' },
  { value: 'flour', label: 'Flour (flour mill)' },
  { value: 'fuel', label: 'Fuel (filling station)' },
  { value: 'animal', label: 'Animal' },
  { value: 'bird', label: 'Bird' },
  { value: 'service', label: 'Service' },
]

export function itemTypeLabel(value: string): string {
  const hit = ITEM_TYPES.find((t) => t.value === value)
  if (hit) return hit.label
  return value
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export const ITEM_TYPE_VALUES = ITEM_TYPES.map((t) => t.value)
