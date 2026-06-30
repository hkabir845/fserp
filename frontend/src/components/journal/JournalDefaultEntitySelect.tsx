'use client'

import { BillLineEntitySelect } from '@/components/bills/BillLineEntitySelect'
import type { EntityScopePond, EntityScopeStation } from '@/lib/entityScopeGroups'

export function JournalDefaultEntitySelect({
  value,
  onChange,
  stations,
  ponds,
  className,
  id,
  companyName,
}: {
  value: string
  onChange: (key: string) => void
  stations: EntityScopeStation[]
  ponds: EntityScopePond[]
  className?: string
  id?: string
  companyName?: string
}) {
  return (
    <BillLineEntitySelect
      id={id}
      value={value}
      onChange={onChange}
      stations={stations}
      ponds={ponds}
      className={className}
      showHeadOffice
      companyName={companyName}
      unsetOption={{ label: '— Not set —' }}
      placeholder="Search fuel station, shop hub, head office, or pond…"
    />
  )
}
