'use client'

import { useMemo } from 'react'
import { SearchableGroupedCombobox } from '@/components/bills/SearchableGroupedCombobox'
import { customerReferenceGroups, type CustomerReferenceRow } from '@/lib/referenceComboboxOptions'

export function CustomerReferenceCombobox({
  value,
  onChange,
  customers,
  className,
  id,
  emptyValue = 0,
  emptyLabel = 'Select customer…',
  placeholder = 'Search customers…',
}: {
  value: number
  onChange: (customerId: number) => void
  customers: CustomerReferenceRow[]
  className?: string
  id?: string
  emptyValue?: number
  emptyLabel?: string
  placeholder?: string
}) {
  const groups = useMemo(() => customerReferenceGroups(customers), [customers])
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
