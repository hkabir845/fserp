'use client'

import { formatCoaOptionLabel } from '@/utils/coaOptionLabel'
import { billLineStationCostMode } from '@/lib/billAllocation'
import type { FuelStationBillExpenseCategory } from '@/lib/fuelStationBillLine'

export interface StationLineShape {
  item_id?: number
  expense_account_id?: number
  amount: number
  fuel_station_expense_category?: string
  station_cost_mode?: 'direct' | 'shared_equal' | 'shared_manual'
  shared_equal_station_ids?: number[]
  station_shares?: { station_id: number | ''; amount: number | string }[]
  line_receipt_station_id?: number | '' | null
}

interface StationOption {
  id: number
  station_name: string
  operates_fuel_retail?: boolean
}

interface ExpenseAccount {
  id: number
  account_code: string
  account_name: string
  account_type: string
}

export function BillStationAllocationFields({
  line,
  index,
  stations,
  billFuelCategories,
  expenseAccounts,
  onFieldChange,
  selectClassName = 'w-full min-w-0 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500',
  showCategoryBlock = true,
}: {
  line: StationLineShape
  index: number
  stations: StationOption[]
  billFuelCategories: FuelStationBillExpenseCategory[]
  expenseAccounts: ExpenseAccount[]
  onFieldChange: (index: number, field: string, value: unknown) => void
  selectClassName?: string
  /** Hide for fuel/tank lines that use header station only */
  showCategoryBlock?: boolean
}) {
  const mode = billLineStationCostMode(line)
  const sharedIds = line.shared_equal_station_ids ?? []
  const manualShares = line.station_shares ?? []
  const lineSt =
    line.line_receipt_station_id === '' || line.line_receipt_station_id == null
      ? ''
      : Number(line.line_receipt_station_id)

  const toggleShared = (sid: number) => {
    const next = sharedIds.includes(sid) ? sharedIds.filter((x) => x !== sid) : [...sharedIds, sid]
    onFieldChange(index, 'shared_equal_station_ids', next)
  }

  return (
    <div className="mt-2 space-y-2 border-t border-dashed border-indigo-200 pt-2">
      <fieldset className="w-full rounded-lg border border-indigo-100 bg-indigo-50/30 p-2 space-y-1">
        <legend className="px-1 text-xs font-medium uppercase tracking-wide text-indigo-900">
          Station cost allocation
        </legend>
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input
            type="radio"
            name={`station_cost_mode_${index}`}
            checked={mode === 'direct'}
            onChange={() => onFieldChange(index, 'station_cost_mode', 'direct')}
          />
          One station (or use bill header)
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input
            type="radio"
            name={`station_cost_mode_${index}`}
            checked={mode === 'shared_equal'}
            onChange={() => onFieldChange(index, 'station_cost_mode', 'shared_equal')}
          />
          Shared — equal split
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input
            type="radio"
            name={`station_cost_mode_${index}`}
            checked={mode === 'shared_manual'}
            onChange={() => onFieldChange(index, 'station_cost_mode', 'shared_manual')}
          />
          Shared — manual amounts
        </label>
      </fieldset>

      {mode === 'direct' ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[10rem] flex-1">
            <label className="block text-xs font-medium text-gray-700 mb-1">Line station (optional)</label>
            <select
              value={lineSt === '' ? '' : String(lineSt)}
              onChange={(e) => {
                const v = e.target.value
                onFieldChange(index, 'line_receipt_station_id', v === '' ? '' : parseInt(v, 10))
              }}
              className={selectClassName}
            >
              <option value="">— Use bill header station —</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.station_name}
                  {s.operates_fuel_retail === false ? ' (shop)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : mode === 'shared_equal' ? (
        <div className="rounded-lg border border-indigo-100 bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-indigo-900">
              Select at least two stations (equal split of line amount)
            </p>
            <button
              type="button"
              className="text-xs font-medium text-indigo-700 hover:text-indigo-900 underline"
              onClick={() =>
                onFieldChange(
                  index,
                  'shared_equal_station_ids',
                  stations.map((s) => s.id)
                )
              }
            >
              All stations
            </button>
          </div>
          <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto">
            {stations.map((s) => (
              <li key={s.id}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="rounded border-gray-300"
                    checked={sharedIds.includes(s.id)}
                    onChange={() => toggleShared(s.id)}
                  />
                  {s.station_name}
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="space-y-2 rounded-lg border border-indigo-100 bg-white p-3">
          <p className="text-xs text-gray-600">
            Each row: station and amount (≥2 rows; amounts must sum to the line amount)
          </p>
          {manualShares.map((row, sidx) => (
            <div key={sidx} className="flex flex-wrap gap-2 items-center">
              <select
                className="min-w-[8rem] flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                value={row.station_id === '' ? '' : String(row.station_id)}
                onChange={(e) => {
                  const next = [...manualShares]
                  next[sidx] = {
                    ...next[sidx],
                    station_id: e.target.value === '' ? '' : parseInt(e.target.value, 10),
                  }
                  onFieldChange(index, 'station_shares', next)
                }}
              >
                <option value="">Station</option>
                {stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.station_name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Amount"
                className="w-28 rounded border border-gray-300 px-2 py-1 text-sm tabular-nums"
                value={row.amount === 0 ? '' : row.amount}
                onChange={(e) => {
                  const next = [...manualShares]
                  next[sidx] = { ...next[sidx], amount: parseFloat(e.target.value) || 0 }
                  onFieldChange(index, 'station_shares', next)
                }}
              />
              {manualShares.length > 2 ? (
                <button
                  type="button"
                  className="text-xs text-red-600 hover:underline"
                  onClick={() => {
                    const next = manualShares.filter((_, i) => i !== sidx)
                    onFieldChange(index, 'station_shares', next)
                  }}
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            className="text-xs font-medium text-indigo-700 hover:underline"
            onClick={() =>
              onFieldChange(index, 'station_shares', [...manualShares, { station_id: '', amount: 0 }])
            }
          >
            + Add station row
          </button>
        </div>
      )}

      {showCategoryBlock && !line.item_id ? (
        <div className="min-w-[11rem] max-w-md">
          <label className="block text-xs font-medium text-indigo-900 mb-1">Station cost type *</label>
          <select
            required
            value={line.fuel_station_expense_category || ''}
            onChange={(e) => onFieldChange(index, 'fuel_station_expense_category', e.target.value)}
            className="w-full min-w-0 px-2 py-1 text-sm border border-indigo-300 rounded focus:ring-1 focus:ring-indigo-500 bg-indigo-50/40"
          >
            <option value="">Select category…</option>
            {billFuelCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
                {c.tenant_defined ? '' : ' (rollup)'}
              </option>
            ))}
          </select>
          {line.expense_account_id ? (
            <p className="mt-0.5 text-[11px] text-indigo-800">
              GL:{' '}
              {formatCoaOptionLabel(
                expenseAccounts.find((a) => a.id === line.expense_account_id) || {
                  id: 0,
                  account_code: '',
                  account_name: '—',
                  account_type: 'expense',
                }
              )}
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="text-xs text-gray-500 pb-1">
        {mode === 'direct'
          ? 'Tags station P&L when the bill posts. Shop-only sites work the same as fuel stations.'
          : 'On save, expands to one line per station with split amounts (shared rent, generator, etc.).'}
      </p>
    </div>
  )
}
