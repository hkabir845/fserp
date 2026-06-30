'use client'

import type { BillPurpose } from '@/lib/billAllocation'

export function BillPurposeSection({
  value,
  onChange,
  showPondOption,
}: {
  value: BillPurpose
  onChange: (p: BillPurpose) => void
  showPondOption: boolean
}) {
  return (
    <fieldset className="mb-4 rounded-lg border border-border bg-muted/50 p-3">
      <legend className="px-1 text-sm font-semibold text-foreground">What is this bill mainly for?</legend>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-4">
        <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
          <input
            type="radio"
            name="bill_purpose"
            checked={value === 'station'}
            onChange={() => onChange('station')}
          />
          Station / shop (fuel, stock, site costs)
        </label>
        {showPondOption ? (
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input
              type="radio"
              name="bill_purpose"
              checked={value === 'pond'}
              onChange={() => onChange('pond')}
            />
            Ponds / aquaculture
          </label>
        ) : null}
        <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
          <input
            type="radio"
            name="bill_purpose"
            checked={value === 'office'}
            onChange={() => onChange('office')}
          />
          Head office / general
        </label>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {value === 'station'
          ? 'Use tanks for fuel, header station for shop stock, and station cost type for utilities and maintenance. Each line can also pick its own entity below.'
          : value === 'pond'
            ? 'Tag pond costs or split lease and shared electricity across ponds. Each line can pick its own pond entity below.'
            : 'Expense accounts only — no pond or station tags on lines unless you set an entity per line.'}
      </p>
    </fieldset>
  )
}
