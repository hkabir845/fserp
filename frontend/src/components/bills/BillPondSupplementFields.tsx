'use client'

import { billLineEntityKind, billLineEntityKey } from '@/lib/billLineEntity'
import { billLinePondCostMode } from '@/lib/billAllocation'
import type { AquacultureBillExpenseCategory } from '@/lib/aquacultureBillLine'
import { ReportingCategorySelectOptions } from '@/lib/reportingCategorySelect'

export type BillPondSupplementLine = {
  item_id?: number
  amount?: number
  aquaculture_pond_id?: number | '' | null
  aquaculture_production_cycle_id?: number | '' | null
  aquaculture_expense_category?: string
  aquaculture_cost_mode?: 'direct' | 'shared_equal' | 'shared_manual'
  shared_equal_pond_ids?: number[]
  pond_shares?: { pond_id: number | ''; amount: number | string }[]
  line_receipt_station_id?: number | '' | null
}

export type PondOption = { id: number; name: string }
export type ProductionCycleOption = { id: number; pond_id: number; name: string }

/**
 * Pond-only extras on bill lines: optional production cycle (direct pond tag)
 * and shared pond cost split (expense lines). Pond + category come from BillLineEntityTagging.
 */
export function BillPondSupplementFields({
  line,
  index,
  ponds,
  productionCycles,
  billExpenseCategories,
  onFieldChange,
  selectClassName = 'w-full min-w-0 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500',
  /** Fish / single-pond inventory lines: cycle only, no shared split UI. */
  directOnly = false,
}: {
  line: BillPondSupplementLine
  index: number
  ponds: PondOption[]
  productionCycles: ProductionCycleOption[]
  billExpenseCategories: AquacultureBillExpenseCategory[]
  onFieldChange: (index: number, field: string, value: unknown) => void
  selectClassName?: string
  directOnly?: boolean
}) {
  if (ponds.length === 0) return null

  const entityKind = billLineEntityKind(billLineEntityKey(line))
  const mode = directOnly ? 'direct' : billLinePondCostMode({ ...line, amount: line.amount ?? 0 })
  const pondSel =
    line.aquaculture_pond_id === '' || line.aquaculture_pond_id == null
      ? ''
      : Number(line.aquaculture_pond_id)
  const hasPondEntity = entityKind === 'pond' && pondSel !== '' && Number.isFinite(pondSel)
  const cyclesForLine =
    hasPondEntity && mode === 'direct'
      ? productionCycles.filter((c) => c.pond_id === pondSel)
      : []
  const sharedIds = line.shared_equal_pond_ids ?? []
  const manualShares = line.pond_shares ?? []
  const showSharedCategory = !line.item_id && mode !== 'direct'

  const toggleSharedPond = (pid: number) => {
    const next = sharedIds.includes(pid) ? sharedIds.filter((x) => x !== pid) : [...sharedIds, pid]
    onFieldChange(index, 'shared_equal_pond_ids', next)
  }

  const showCycle = hasPondEntity && mode === 'direct'
  const showSharedAllocation = !directOnly && !line.item_id

  if (!showCycle && !showSharedAllocation) return null

  return (
    <div className="mt-2 space-y-2 border-t border-dashed border-teal-200 pt-2">
      {showSharedAllocation ? (
        <fieldset className="w-full rounded-lg border border-teal-100 bg-teal-50/30 p-2 space-y-1">
          <legend className="px-1 text-xs font-medium uppercase tracking-wide text-teal-800">
            Pond cost allocation
          </legend>
          <label className="flex items-center gap-2 text-sm text-gray-800">
            <input
              type="radio"
              name={`pond_cost_mode_${index}`}
              checked={mode === 'direct'}
              onChange={() => onFieldChange(index, 'aquaculture_cost_mode', 'direct')}
            />
            Direct to one pond (use Entity above)
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-800">
            <input
              type="radio"
              name={`pond_cost_mode_${index}`}
              checked={mode === 'shared_equal'}
              onChange={() => onFieldChange(index, 'aquaculture_cost_mode', 'shared_equal')}
            />
            Shared — equal split
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-800">
            <input
              type="radio"
              name={`pond_cost_mode_${index}`}
              checked={mode === 'shared_manual'}
              onChange={() => onFieldChange(index, 'aquaculture_cost_mode', 'shared_manual')}
            />
            Shared — manual amounts
          </label>
        </fieldset>
      ) : null}

      {showCycle ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[10rem] flex-1 max-w-md">
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Production batch (optional)
            </label>
            <select
              value={
                line.aquaculture_production_cycle_id === '' ||
                line.aquaculture_production_cycle_id == null
                  ? ''
                  : String(line.aquaculture_production_cycle_id)
              }
              onChange={(e) => {
                const v = e.target.value
                onFieldChange(
                  index,
                  'aquaculture_production_cycle_id',
                  v === '' ? '' : parseInt(v, 10)
                )
              }}
              className={selectClassName}
            >
              <option value="">— Any / not set —</option>
              {cyclesForLine.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Tilapia: pick batch C01/C02/C03 for each fry cohort. Other species: usually leave blank or pick the
              one open batch — FSERP reuses it on new bills to the same pond.
            </p>
          </div>
        </div>
      ) : null}

      {showSharedAllocation && mode === 'shared_equal' ? (
        <div className="rounded-lg border border-teal-100 bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-teal-900">
              Select at least two ponds (equal split of line amount). Use for shared feed, medicine, or utilities
              charged on one bill.
            </p>
            <button
              type="button"
              className="text-xs font-medium text-teal-700 hover:text-teal-900 underline"
              onClick={() =>
                onFieldChange(
                  index,
                  'shared_equal_pond_ids',
                  ponds.map((p) => p.id)
                )
              }
            >
              All active ponds
            </button>
          </div>
          <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto">
            {ponds.map((p) => (
              <li key={p.id}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="rounded border-gray-300"
                    checked={sharedIds.includes(p.id)}
                    onChange={() => toggleSharedPond(p.id)}
                  />
                  {p.name}
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {showSharedAllocation && mode === 'shared_manual' ? (
        <div className="space-y-2 rounded-lg border border-teal-100 bg-white p-3">
          <p className="text-xs text-gray-600">
            Enter amount per pond; must sum to the line amount. On save, expands to one line per pond.
          </p>
          {manualShares.map((row, ri) => (
            <div key={ri} className="flex flex-wrap items-end gap-2">
              <div className="min-w-[8rem] flex-1">
                <label className="block text-xs text-gray-600 mb-0.5">Pond</label>
                <select
                  value={row.pond_id === '' ? '' : String(row.pond_id)}
                  onChange={(e) => {
                    const next = [...manualShares]
                    next[ri] = {
                      ...next[ri],
                      pond_id: e.target.value === '' ? '' : parseInt(e.target.value, 10),
                    }
                    onFieldChange(index, 'pond_shares', next)
                  }}
                  className={selectClassName}
                >
                  <option value="">— Pond —</option>
                  {ponds.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-28">
                <label className="block text-xs text-gray-600 mb-0.5">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={row.amount}
                  onChange={(e) => {
                    const next = [...manualShares]
                    next[ri] = { ...next[ri], amount: e.target.value }
                    onFieldChange(index, 'pond_shares', next)
                  }}
                  className={selectClassName}
                />
              </div>
              <button
                type="button"
                className="text-xs text-red-600 hover:underline pb-1"
                onClick={() => {
                  const next = manualShares.filter((_, i) => i !== ri)
                  onFieldChange(index, 'pond_shares', next)
                }}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-xs font-medium text-teal-700 hover:underline"
            onClick={() =>
              onFieldChange(index, 'pond_shares', [...manualShares, { pond_id: '', amount: 0 }])
            }
          >
            + Add pond row
          </button>
        </div>
      ) : null}

      {showSharedCategory ? (
        <div className="min-w-[11rem] max-w-md">
          <label className="block text-xs font-medium text-teal-900 mb-1">Pond expense category *</label>
          <select
            required
            value={line.aquaculture_expense_category || ''}
            onChange={(e) => onFieldChange(index, 'aquaculture_expense_category', e.target.value)}
            className="w-full min-w-0 px-2 py-1 text-sm border border-teal-300 rounded focus:ring-1 focus:ring-teal-500 bg-teal-50/40"
          >
            <option value="">Select category…</option>
            <ReportingCategorySelectOptions categories={billExpenseCategories} />
          </select>
        </div>
      ) : null}

      {showSharedAllocation ? (
        <p className="text-xs text-gray-500 pb-1">
          {mode === 'direct'
            ? hasPondEntity
              ? 'Optional production cycle tags this line to a crop window when the bill posts.'
              : 'Pick a pond under Entity for direct P&L, or use shared split for costs across ponds.'
            : 'On save, this line expands to one bill line per pond with the split amounts (lease, shared electricity, etc.).'}
        </p>
      ) : null}
    </div>
  )
}
