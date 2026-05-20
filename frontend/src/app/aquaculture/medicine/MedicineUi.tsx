'use client'

import { AlertTriangle, HelpCircle, Lock, Pencil, Pill, Plus, Trash2, type LucideIcon } from 'lucide-react'
import type { MedicineProductLine } from './medicineUtils'
import { formatDateOnly } from '@/utils/date'
import { formatNumber, getCurrencySymbol } from '@/utils/currency'
import {
  formatStockUnit,
  productOptionLabel,
  quantityPlaceholderForUnit,
} from '@/lib/aquacultureMedicineUnits'
import { parseTreatmentMemo } from './medicineUtils'

export function MedicineStatCard(props: {
  title: string
  value: string | number
  sub: string
  icon: LucideIcon
  tone?: 'violet' | 'slate' | 'amber'
}) {
  const { title, value, sub, icon: Icon, tone = 'violet' } = props
  const iconBg =
    tone === 'amber'
      ? 'bg-amber-50 text-amber-800'
      : tone === 'slate'
        ? 'bg-slate-100 text-slate-700'
        : 'bg-violet-50 text-violet-800'
  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-violet-500/10">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{value}</p>
          <p className="mt-0.5 text-xs text-slate-600">{sub}</p>
        </div>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
          <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
        </span>
      </div>
    </div>
  )
}

export function MedicineTipsAside() {
  return (
    <aside className="rounded-2xl border border-violet-100 bg-gradient-to-b from-violet-50/90 to-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-semibold text-violet-950">
        <HelpCircle className="h-4 w-4 text-violet-700" aria-hidden />
        Quick guide
      </div>
      <ul className="mt-3 space-y-2 text-xs leading-relaxed text-slate-700">
        <li>
          <strong className="text-slate-900">1.</strong> In Items, set each SKU&apos;s unit (e.g. Lime → kg). Move stock to
          the pond warehouse (Inventory → move to pond).
        </li>
        <li>
          <strong className="text-slate-900">2.</strong> Selecting a pond fills water volume from pond setup (water area
          decimal × depth). Edit the field if you only treat part of the pond.
        </li>
        <li>
          <strong className="text-slate-900">3.</strong> Add one or more products for the same bath or protocol, then
          record once — each product posts stock and COGS separately but shares the same batch reference in history.
        </li>
        <li>
          <strong className="text-slate-900">4.</strong> Use per-line notes only when dose differs by product; otherwise
          set dose once under application details.
        </li>
      </ul>
    </aside>
  )
}

export function TreatmentDetailChips({ memo }: { memo: string }) {
  const p = parseTreatmentMemo(memo)
  const chips: string[] = []
  if (p.batch) chips.push(p.batch)
  if (p.product) chips.push(p.product)
  if (p.purpose) chips.push(p.purpose)
  if (p.method) chips.push(p.method)
  if (p.dose) chips.push(`Dose ${p.dose}`)
  if (p.water) chips.push(p.water)
  if (p.withdrawal) chips.push(`Withdrawal ${p.withdrawal}`)
  if (p.staff) chips.push(p.staff)
  if (chips.length === 0 && !p.notes) return <span className="text-slate-400">—</span>
  return (
    <div className="space-y-1">
      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {chips.map((c) => (
            <span
              key={c}
              className="inline-flex rounded-md bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-900 ring-1 ring-violet-200/80"
            >
              {c}
            </span>
          ))}
        </div>
      ) : null}
      {p.notes ? <p className="text-xs text-slate-600 break-words">{p.notes}</p> : null}
    </div>
  )
}

export interface MedicineHistoryRow {
  id: number
  entry_date: string
  pond_name: string
  production_cycle_id?: number | null
  production_cycle_name?: string
  item_name?: string
  quantity?: string | null
  unit?: string
  amount: string
  memo: string
  source?: string
  journal_entry_number?: string
}

export function canEditMedicineHistoryRow(row: MedicineHistoryRow): boolean {
  return row.source === 'manual_consume' || row.source == null || row.source === ''
}

export function MedicineTreatmentDeleteDialog(props: {
  row: MedicineHistoryRow
  currency: string
  deleting: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const { row, currency, deleting, onCancel, onConfirm } = props
  const sym = getCurrencySymbol(currency)
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-treatment-title"
      onClick={() => !deleting && onCancel()}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="delete-treatment-title" className="text-base font-semibold text-slate-900">
          Delete treatment record?
        </h3>
        <p className="mt-2 text-sm text-slate-600">
          This removes the consumption entry for{' '}
          <span className="font-medium text-slate-900">{row.item_name || 'this product'}</span>
          {row.quantity ? (
            <>
              {' '}
              (<span className="tabular-nums">{row.quantity}</span> {row.unit || ''})
            </>
          ) : null}{' '}
          on {formatDateOnly(row.entry_date)} ({sym}
          {formatNumber(Number(row.amount), 2)} COGS).
        </p>
        <p className="mt-2 text-xs text-amber-900">
          Pond warehouse stock will be restored and the linked COGS journal entry will be reversed. This cannot be
          undone.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete treatment'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function MedicineProductLinesEditor(props: {
  lines: MedicineProductLine[]
  medicineCatalog: { id: number; name: string; unit?: string }[]
  stockByItemId: Map<number, { quantity: string; unit: string }>
  whLoading: boolean
  inputCls: string
  labelCls: string
  onChangeLine: (id: string, patch: Partial<MedicineProductLine>) => void
  onAddLine: () => void
  onRemoveLine: (id: string) => void
}) {
  const {
    lines,
    medicineCatalog,
    stockByItemId,
    whLoading,
    inputCls,
    labelCls,
    onChangeLine,
    onAddLine,
    onRemoveLine,
  } = props

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Medicines used</p>
        <button
          type="button"
          onClick={onAddLine}
          className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs font-medium text-violet-900 hover:bg-violet-100"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add another medicine
        </button>
      </div>

      {lines.map((line, index) => {
        const iid = line.itemId ? Number.parseInt(line.itemId, 10) : NaN
        const catalogItem = Number.isFinite(iid)
          ? medicineCatalog.find((c) => c.id === iid)
          : undefined
        const stock = Number.isFinite(iid) ? stockByItemId.get(iid) : undefined
        const stockUnit = formatStockUnit(catalogItem?.unit || stock?.unit)
        const showStockWarn = line.itemId && !whLoading && !stock
        return (
          <div
            key={line.id}
            className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm ring-1 ring-slate-100/80"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500">Product {index + 1}</span>
              {lines.length > 1 ? (
                <button
                  type="button"
                  onClick={() => onRemoveLine(line.id)}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-slate-500 hover:bg-red-50 hover:text-red-700"
                  aria-label={`Remove product ${index + 1}`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  Remove
                </button>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={`${labelCls} sm:col-span-2`}>
                Medicine product <span className="text-red-600">*</span>
                <select
                  className={inputCls}
                  value={line.itemId}
                  onChange={(e) => onChangeLine(line.id, { itemId: e.target.value })}
                >
                  <option value="">Select product…</option>
                  {medicineCatalog.map((it) => (
                    <option key={it.id} value={it.id}>
                      {productOptionLabel(it.name, it.unit)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelCls}>
                Quantity used
                {line.itemId ? (
                  <span className="font-normal text-violet-800">
                    {' '}
                    ({stockUnit}) <span className="text-red-600">*</span>
                  </span>
                ) : (
                  <span className="text-red-600"> *</span>
                )}
                <div className="mt-1 flex rounded-lg border border-slate-300 bg-white shadow-sm focus-within:border-violet-500 focus-within:ring-2 focus-within:ring-violet-500/20">
                  <input
                    type="text"
                    inputMode="decimal"
                    className="min-w-0 flex-1 rounded-l-lg border-0 bg-transparent px-3 py-2 text-sm tabular-nums text-slate-900 focus:outline-none focus:ring-0"
                    value={line.quantity}
                    onChange={(e) => onChangeLine(line.id, { quantity: e.target.value })}
                    placeholder={line.itemId ? quantityPlaceholderForUnit(stockUnit) : 'Select product first'}
                  />
                  {line.itemId ? (
                    <span className="flex items-center rounded-r-lg border-l border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-600">
                      {stockUnit}
                    </span>
                  ) : null}
                </div>
                {stock ? (
                  <p className="mt-1 text-[11px] text-emerald-800">
                    On hand: {stock.quantity} {formatStockUnit(stock.unit)}
                  </p>
                ) : showStockWarn ? (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-800">
                    <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                    Not at pond — transfer stock first
                  </p>
                ) : null}
              </label>
              <label className={labelCls}>
                Per-product note <span className="font-normal text-slate-500">(optional)</span>
                <input
                  type="text"
                  className={inputCls}
                  value={line.lineNote}
                  onChange={(e) => onChangeLine(line.id, { lineNote: e.target.value })}
                  placeholder="e.g. 1 ppm for this chemical only"
                />
              </label>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function MedicineHistoryTable(props: {
  rows: MedicineHistoryRow[]
  currency: string
  loading: boolean
  formHidden?: boolean
  busyRowId?: number | null
  onEdit?: (row: MedicineHistoryRow) => void
  onDelete?: (row: MedicineHistoryRow) => void
}) {
  const { rows, currency, loading, formHidden, busyRowId, onEdit, onDelete } = props
  const sym = getCurrencySymbol(currency)
  const showActions = Boolean(onEdit || onDelete)

  if (loading) {
    return (
      <div className="mt-4 space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-12 text-center">
        <Pill className="h-8 w-8 text-slate-300" aria-hidden />
        <p className="mt-3 text-sm font-medium text-slate-700">No treatments recorded yet</p>
        <p className="mt-1 max-w-sm text-xs text-slate-500">
          {formHidden
            ? 'Use “Record new treatment” to log the first medicine application for this pond.'
            : 'Use the form below to log the first medicine application for this pond.'}
        </p>
      </div>
    )
  }

  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2.5">Date</th>
            <th className="px-3 py-2.5">Product</th>
            <th className="px-3 py-2.5 text-right">Qty used</th>
            <th className="min-w-[11rem] px-3 py-2.5">Treatment</th>
            <th className="px-3 py-2.5">Cycle</th>
            <th className="px-3 py-2.5 text-right">COGS</th>
            {showActions ? <th className="w-[5.5rem] px-2 py-2.5 text-center">Actions</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const editable = canEditMedicineHistoryRow(r)
            const busy = busyRowId === r.id
            return (
            <tr key={r.id} className="border-t border-slate-100 hover:bg-violet-50/30">
              <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-slate-800">
                {formatDateOnly(r.entry_date)}
              </td>
              <td className="max-w-[10rem] px-3 py-2.5 font-medium text-slate-900 break-words">
                {r.item_name?.trim() || '—'}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-800">
                {r.quantity != null && r.quantity !== '' ? (
                  <>
                    {formatNumber(Number(r.quantity), 2)}
                    {r.unit ? <span className="ml-0.5 text-xs text-slate-500">{r.unit}</span> : null}
                  </>
                ) : (
                  '—'
                )}
              </td>
              <td className="px-3 py-2.5">
                <TreatmentDetailChips memo={r.memo} />
              </td>
              <td className="max-w-[8rem] px-3 py-2.5 text-xs text-slate-600 break-words">
                {r.production_cycle_name?.trim() || '—'}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums font-medium text-slate-900">
                {sym}
                {formatNumber(Number(r.amount), 2)}
              </td>
              {showActions ? (
                <td className="px-2 py-2">
                  {editable ? (
                    <div className="flex items-center justify-center gap-0.5">
                      {onEdit ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onEdit(r)}
                          title="Edit treatment details"
                          aria-label={`Edit treatment on ${formatDateOnly(r.entry_date)}`}
                          className="rounded-lg p-2 text-slate-500 transition hover:bg-violet-100 hover:text-violet-800 disabled:opacity-40"
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                        </button>
                      ) : null}
                      {onDelete ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onDelete(r)}
                          title="Delete treatment and restore stock"
                          aria-label={`Delete treatment on ${formatDateOnly(r.entry_date)}`}
                          className="rounded-lg p-2 text-slate-500 transition hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <div
                      className="flex justify-center text-slate-400"
                      title="Created from feeding advice — edit in feeding module"
                    >
                      <Lock className="h-4 w-4" aria-hidden />
                    </div>
                  )}
                </td>
              ) : null}
            </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
