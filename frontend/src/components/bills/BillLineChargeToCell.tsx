'use client'

import { applyBillLineEntityKey, billLineEntityKey } from '@/lib/billLineEntity'
import type { BillReceiptLocationPond, BillReceiptLocationStation } from '@/lib/billReceiptLocation'
import { BillLineEntitySelect } from './BillLineEntitySelect'

export type BillLineChargeToShape = {
  aquaculture_pond_id?: number | '' | null
  line_receipt_station_id?: number | '' | null
}

/** Inline “Class” column — one Charge to per line (QuickBooks / AP line-coding pattern). */
export function BillLineChargeToCell({
  line,
  index,
  stations,
  ponds,
  companyName,
  className,
  onFieldChange,
}: {
  line: BillLineChargeToShape
  index: number
  stations: BillReceiptLocationStation[]
  ponds: BillReceiptLocationPond[]
  companyName?: string
  className?: string
  onFieldChange: (index: number, field: string, value: unknown) => void
}) {
  if (stations.length === 0 && ponds.length === 0) return null

  const entityKey = billLineEntityKey(line)

  return (
    <BillLineEntitySelect
      value={entityKey}
      onChange={(key) => {
        const next = applyBillLineEntityKey(line, key, stations)
        onFieldChange(index, '__entity_bundle__', next)
      }}
      stations={stations}
      ponds={ponds}
      className={className}
      showHeadOffice
      companyName={companyName}
      placeholder="Charge to…"
    />
  )
}
