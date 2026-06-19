'use client'

import { useMemo } from 'react'
import { SearchableGroupedCombobox } from '@/components/bills/SearchableGroupedCombobox'
import { vendorReferenceGroups, type VendorReferenceRow } from '@/lib/referenceComboboxOptions'

export function VendorReferenceCombobox({
  value,
  onChange,
  vendors,
  className,
  id,
  emptyValue = 0,
  emptyLabel = 'Select vendor…',
  placeholder = 'Search vendors…',
}: {
  value: number
  onChange: (vendorId: number) => void
  vendors: VendorReferenceRow[]
  className?: string
  id?: string
  emptyValue?: number
  emptyLabel?: string
  placeholder?: string
}) {
  const groups = useMemo(() => vendorReferenceGroups(vendors), [vendors])
  const strValue = value > 0 ? String(value) : String(emptyValue)

  return (
    <SearchableGroupedCombobox
      id={id}
      value={strValue}
      onChange={(v) => onChange(parseInt(v, 10) || emptyValue)}
      groups={groups}
      emptyOption={{ value: String(emptyValue), label: emptyLabel }}
      className={className}
      placeholder={placeholder}
    />
  )
}
