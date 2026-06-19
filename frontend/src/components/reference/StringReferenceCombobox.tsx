'use client'

import { useMemo } from 'react'
import { SearchableGroupedCombobox } from '@/components/bills/SearchableGroupedCombobox'
import { stringReferenceGroups } from '@/lib/referenceComboboxOptions'

export type StringReferenceOption = {
  value: string
  label: string
  description?: string
  searchText?: string
}

export function StringReferenceCombobox({
  value,
  onChange,
  options,
  className,
  id,
  groupLabel = 'Options',
  emptyOption,
  placeholder = 'Search…',
}: {
  value: string
  onChange: (value: string) => void
  options: StringReferenceOption[]
  className?: string
  id?: string
  groupLabel?: string
  emptyOption?: { value: string; label: string } | null
  placeholder?: string
}) {
  const groups = useMemo(
    () => stringReferenceGroups(groupLabel, options),
    [groupLabel, options],
  )

  return (
    <SearchableGroupedCombobox
      id={id}
      value={value}
      onChange={onChange}
      groups={groups}
      emptyOption={emptyOption ?? null}
      className={className}
      placeholder={placeholder}
    />
  )
}
