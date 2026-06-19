'use client'

import { useMemo } from 'react'
import { SearchableGroupedCombobox } from '@/components/bills/SearchableGroupedCombobox'
import { stringReferenceGroups } from '@/lib/referenceComboboxOptions'

export type CatalogItemRow = {
  id: number
  name: string
  item_number?: string
  description?: string
  item_type?: string
}

function formatCatalogItemLabel(item: CatalogItemRow): string {
  const sku = (item.item_number || '').trim()
  return sku ? `${item.name} (${sku})` : item.name
}

function formatItemTypeLabel(raw: string | undefined): string {
  const t = (raw || '').trim().toLowerCase().replace(/-/g, '_')
  if (!t) return ''
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function CatalogItemCombobox({
  value,
  onChange,
  items,
  className,
  id,
  emptyValue = 0,
  emptyLabel = 'Select product…',
  placeholder = 'Search products & services…',
  includeSelectedWhenFilteredOut,
}: {
  value: number | ''
  onChange: (itemId: number | '') => void
  items: CatalogItemRow[]
  className?: string
  id?: string
  emptyValue?: number
  emptyLabel?: string
  placeholder?: string
  /** Keep current selection visible even if filtered out of the main list. */
  includeSelectedWhenFilteredOut?: boolean
}) {
  const strValue =
    typeof value === 'number' && value > 0 ? String(value) : String(emptyValue)

  const options = useMemo(() => {
    const mapped = items.map((item) => {
      const label = formatCatalogItemLabel(item)
      const typeLabel = formatItemTypeLabel(item.item_type)
      const desc = (item.description || '').trim()
      const meta = [typeLabel, desc].filter(Boolean).join(' · ')
      return {
        value: String(item.id),
        label,
        description: meta || undefined,
        searchText: `${item.name} ${item.item_number || ''} ${desc} ${typeLabel} ${item.item_type || ''}`,
        title: desc ? `${label}\n${desc}` : label,
      }
    })
    if (
      includeSelectedWhenFilteredOut &&
      typeof value === 'number' &&
      value > 0 &&
      !mapped.some((o) => o.value === String(value))
    ) {
      const selected = items.find((i) => i.id === value)
      if (selected) {
        const label = formatCatalogItemLabel(selected)
        return [
          {
            value: String(selected.id),
            label,
            description: (selected.description || '').trim() || undefined,
            searchText: `${selected.name} ${selected.item_number || ''}`,
            title: label,
          },
          ...mapped,
        ]
      }
    }
    return mapped
  }, [items, value, includeSelectedWhenFilteredOut])

  const groups = useMemo(
    () => stringReferenceGroups('Products & services', options),
    [options],
  )

  return (
    <SearchableGroupedCombobox
      id={id}
      value={strValue}
      onChange={(v) => {
        const n = parseInt(v, 10)
        if (!Number.isFinite(n) || n <= 0 || n === emptyValue) {
          onChange('')
          return
        }
        onChange(n)
      }}
      groups={groups}
      emptyOption={{ value: String(emptyValue), label: emptyLabel }}
      className={className}
      placeholder={placeholder}
    />
  )
}
