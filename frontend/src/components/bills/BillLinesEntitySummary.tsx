'use client'

import { useMemo } from 'react'
import { billLineEntityKey } from '@/lib/billLineEntity'
import {
  receiptLocationDisplayLabel,
  type BillReceiptLocationPond,
  type BillReceiptLocationStation,
} from '@/lib/billReceiptLocation'
import { formatHeadOfficeScopeKey } from '@/app/reports/reportSiteScope'

type LineWithEntity = {
  aquaculture_pond_id?: number | '' | null
  line_receipt_station_id?: number | '' | null
}

export function BillLinesEntitySummary({
  lines,
  stations,
  ponds,
  companyName,
}: {
  lines: LineWithEntity[]
  stations: BillReceiptLocationStation[]
  ponds: BillReceiptLocationPond[]
  companyName?: string
}) {
  const labels = useMemo(() => {
    const keys = new Set<string>()
    for (const line of lines) {
      keys.add(billLineEntityKey(line))
    }
    return [...keys].map((key) => {
      if (key === formatHeadOfficeScopeKey()) {
        return (companyName || '').trim() || 'Head office'
      }
      return receiptLocationDisplayLabel(key, stations, ponds) || key
    })
  }, [lines, stations, ponds, companyName])

  if (labels.length === 0) return null

  return (
    <p className="mb-3 text-xs text-muted-foreground">
      <span className="font-medium text-foreground/85">Sites on this bill: </span>
      {labels.join(' · ')}
    </p>
  )
}
