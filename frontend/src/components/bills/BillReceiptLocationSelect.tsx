'use client'

import type { BillReceiptLocationPond, BillReceiptLocationStation } from '@/lib/billReceiptLocation'
import { BillLineEntitySelect } from './BillLineEntitySelect'

export function BillReceiptLocationSelect({
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
  stations: BillReceiptLocationStation[]
  ponds: BillReceiptLocationPond[]
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
      companyName={companyName}
      showHeadOffice
      unsetOption={{ label: '— Not set —' }}
      placeholder="Search station, shop hub, or pond…"
    />
  )
}
