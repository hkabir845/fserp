'use client'

import { useMemo } from 'react'
import type { BillReceiptLocationPond, BillReceiptLocationStation } from '@/lib/billReceiptLocation'
import { buildStandardEntityScopeGroups } from '@/lib/entityScopeGroups'
import {
  SearchableGroupedCombobox,
} from './SearchableGroupedCombobox'

export function BillLineEntitySelect({
  value,
  onChange,
  stations,
  ponds,
  className,
  id,
  showHeadOffice = true,
  showAllEntitiesOption = false,
  unsetOption,
  emptyLabel,
  companyName,
  placeholder = 'Search entity…',
}: {
  value: string
  onChange: (key: string) => void
  stations: BillReceiptLocationStation[]
  ponds: BillReceiptLocationPond[]
  className?: string
  id?: string
  /** Include Head office as an explicit entity (value `ho`). */
  showHeadOffice?: boolean
  /** When true, empty value means company-wide / all entities (reporting categories). */
  showAllEntitiesOption?: boolean
  /** When set (and showAllEntitiesOption is false), empty value is a valid "not chosen" option. */
  unsetOption?: { label: string }
  emptyLabel?: string
  companyName?: string
  placeholder?: string
}) {
  const groups = useMemo(
    () =>
      buildStandardEntityScopeGroups({
        stations,
        ponds,
        value,
        showHeadOffice,
        companyName,
      }),
    [stations, ponds, value, showHeadOffice, companyName],
  )

  return (
    <SearchableGroupedCombobox
      id={id}
      value={value}
      onChange={onChange}
      groups={groups}
      emptyOption={
        showAllEntitiesOption
          ? { value: '', label: emptyLabel ?? 'All entities (company-wide)' }
          : unsetOption
            ? { value: '', label: unsetOption.label }
            : null
      }
      className={className}
      placeholder={placeholder}
    />
  )
}
