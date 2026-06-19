'use client'

import { useMemo } from 'react'
import { SearchableGroupedCombobox } from '@/components/bills/SearchableGroupedCombobox'
import { coaAccountReferenceGroups, type CoaReferenceRow } from '@/lib/referenceComboboxOptions'

export function CoaAccountCombobox({
  value,
  onChange,
  accounts,
  className,
  id,
  emptyLabel = '— Select account —',
  placeholder = 'Search chart of accounts…',
  groupByType = true,
}: {
  value: string
  onChange: (accountId: string) => void
  accounts: CoaReferenceRow[]
  className?: string
  id?: string
  emptyLabel?: string
  placeholder?: string
  groupByType?: boolean
}) {
  const groups = useMemo(
    () => coaAccountReferenceGroups(accounts, { groupByType }),
    [accounts, groupByType],
  )

  return (
    <SearchableGroupedCombobox
      id={id}
      value={value}
      onChange={onChange}
      groups={groups}
      emptyOption={{ value: '', label: emptyLabel }}
      className={className}
      placeholder={placeholder}
    />
  )
}
