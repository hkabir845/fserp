'use client'

import { CalendarRange } from 'lucide-react'
import { localDateISO, toDateInputValue } from '@/utils/date'
import {
  SALES_PURCHASE_PERIOD_PRESETS,
  type SalesPurchasePeriodPreset,
} from './salesPurchasePeriod'

type SalesPurchasePeriodFilterProps = {
  dateRange: { startDate: string; endDate: string }
  preset: SalesPurchasePeriodPreset
  onPresetChange: (preset: SalesPurchasePeriodPreset) => void
  onDateChange: (field: 'startDate' | 'endDate', value: string) => void
  description?: string
  period?: { start_date?: string; end_date?: string }
}

export function SalesPurchasePeriodFilter({
  dateRange,
  preset,
  onPresetChange,
  onDateChange,
  description,
  period,
}: SalesPurchasePeriodFilterProps) {
  const currentStartDate = period?.start_date
    ? toDateInputValue(period.start_date)
    : dateRange.startDate
  const currentEndDate = period?.end_date ? toDateInputValue(period.end_date) : dateRange.endDate
  const showCustomInputs = preset === 'custom'

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/90 p-4 shadow-sm">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <CalendarRange className="h-4 w-4 shrink-0 text-blue-700" aria-hidden />
          <span className="text-sm font-semibold text-blue-900">Report period</span>
          <div className="flex flex-wrap gap-1.5">
            {SALES_PURCHASE_PERIOD_PRESETS.map((item) => {
              const isActive = preset === item.id
              const isCustomBtn = item.id === 'custom'
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onPresetChange(item.id)}
                  className={[
                    'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                    isActive
                      ? 'bg-blue-700 text-white shadow-sm'
                      : 'border border-blue-200 bg-white text-blue-800 hover:bg-blue-100',
                    isCustomBtn && !showCustomInputs && isActive ? 'ring-2 ring-blue-300' : '',
                  ].join(' ')}
                >
                  {item.label}
                </button>
              )
            })}
          </div>
        </div>

        {showCustomInputs ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-blue-100 pt-3">
            <label className="text-sm font-medium text-blue-800">From</label>
            <input
              type="date"
              value={currentStartDate}
              onChange={(e) => onDateChange('startDate', e.target.value)}
              max={currentEndDate}
              className="rounded-md border border-blue-300 bg-white px-3 py-1.5 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
            <span className="text-sm font-medium text-blue-700">to</span>
            <input
              type="date"
              value={currentEndDate}
              onChange={(e) => onDateChange('endDate', e.target.value)}
              min={currentStartDate}
              max={localDateISO()}
              className="rounded-md border border-blue-300 bg-white px-3 py-1.5 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>
        ) : (
          <p className="text-sm text-blue-900">
            <span className="font-medium">{currentStartDate}</span>
            <span className="mx-2 text-blue-600">→</span>
            <span className="font-medium">{currentEndDate}</span>
          </p>
        )}

        {description ? <p className="text-xs text-blue-700/90">{description}</p> : null}
      </div>
    </div>
  )
}
