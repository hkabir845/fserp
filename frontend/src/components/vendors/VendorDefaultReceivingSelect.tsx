'use client'

import { useMemo } from 'react'
import {
  SearchableGroupedCombobox,
} from '@/components/bills/SearchableGroupedCombobox'
import type { EntityScopePond, EntityScopeStation } from '@/lib/entityScopeGroups'
import { buildStandardEntityScopeGroups } from '@/lib/entityScopeGroups'

export function VendorDefaultReceivingSelect({
  value,
  onChange,
  stations,
  ponds,
  className,
  id,
}: {
  value: string
  onChange: (key: string) => void
  stations: EntityScopeStation[]
  ponds: EntityScopePond[]
  className?: string
  id?: string
}) {
  const groups = useMemo(
    () =>
      buildStandardEntityScopeGroups({
        stations,
        ponds,
        value,
        showHeadOffice: false,
        stationValue: (s) => `s:${s.id}`,
        pondValue: (p) => `p:${p.id}`,
      }),
    [stations, ponds, value],
  )

  return (
    <SearchableGroupedCombobox
      id={id}
      value={value}
      onChange={onChange}
      groups={groups}
      emptyOption={{ value: '', label: '— Any site or pond (choose on each bill) —' }}
      className={className}
      placeholder="Search station, shop hub, or pond…"
    />
  )
}
