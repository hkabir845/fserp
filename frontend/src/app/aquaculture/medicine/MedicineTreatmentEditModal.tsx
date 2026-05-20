'use client'

import { useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import {
  APPLICATION_METHODS,
  DOSE_UNITS,
  TREATMENT_PURPOSES,
  rebuildMemoForLedgerRow,
  treatmentFieldsFromMemo,
  type TreatmentFormFields,
} from './medicineUtils'
import type { MedicineHistoryRow } from './MedicineUi'

const inputCls =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20'
const labelCls = 'block text-xs font-medium text-slate-700'

interface CycleRow {
  id: number
  name: string
}

export function MedicineTreatmentEditModal(props: {
  row: MedicineHistoryRow
  cycles: CycleRow[]
  saving: boolean
  onClose: () => void
  onSave: (payload: {
    expense_date: string
    production_cycle_id: number | null
    memo: string
  }) => void
}) {
  const { row, cycles, saving, onClose, onSave } = props
  const [date, setDate] = useState(row.entry_date)
  const [cycleId, setCycleId] = useState(
    row.production_cycle_id != null ? String(row.production_cycle_id) : '',
  )
  const [fields, setFields] = useState<TreatmentFormFields>(() => treatmentFieldsFromMemo(row.memo))

  useEffect(() => {
    setDate(row.entry_date)
    setCycleId(row.production_cycle_id != null ? String(row.production_cycle_id) : '')
    setFields(treatmentFieldsFromMemo(row.memo))
  }, [row])

  const setF = <K extends keyof TreatmentFormFields>(key: K, value: TreatmentFormFields[K]) => {
    setFields((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = () => {
    const memo = rebuildMemoForLedgerRow(row.memo, fields, row)
    let production_cycle_id: number | null = null
    if (cycleId.trim() !== '') {
      const c = Number.parseInt(cycleId, 10)
      if (Number.isFinite(c)) production_cycle_id = c
    }
    onSave({ expense_date: date, production_cycle_id, memo })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-treatment-title"
      onClick={() => !saving && onClose()}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-3">
          <h3 id="edit-treatment-title" className="text-base font-semibold text-slate-900">
            Edit treatment
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
            <span className="font-medium">{row.item_name || 'Product'}</span>
            {row.quantity != null && row.quantity !== '' ? (
              <span className="tabular-nums">
                {' '}
                · {row.quantity} {row.unit || ''}
              </span>
            ) : null}
            <p className="mt-1 text-[11px] text-slate-600">
              Product and quantity cannot be changed here — delete and record again to adjust stock used.
            </p>
          </div>

          <label className={labelCls}>
            Treatment date
            <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>

          <label className={labelCls}>
            Production cycle
            <select className={inputCls} value={cycleId} onChange={(e) => setCycleId(e.target.value)}>
              <option value="">— optional —</option>
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelCls}>
              Purpose
              <select
                className={inputCls}
                value={fields.purpose}
                onChange={(e) => setF('purpose', e.target.value as TreatmentFormFields['purpose'])}
              >
                <option value="">—</option>
                {TREATMENT_PURPOSES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              Method
              <select
                className={inputCls}
                value={fields.method}
                onChange={(e) => setF('method', e.target.value as TreatmentFormFields['method'])}
              >
                <option value="">—</option>
                {APPLICATION_METHODS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={`${labelCls} sm:col-span-2`}>
              Dose rate
              <div className="mt-1 flex gap-2">
                <input
                  type="text"
                  className={`${inputCls} mt-0 flex-1`}
                  value={fields.doseAmount}
                  onChange={(e) => setF('doseAmount', e.target.value)}
                />
                <select
                  className={`${inputCls} mt-0 w-36 shrink-0`}
                  value={fields.doseUnit}
                  onChange={(e) => setF('doseUnit', e.target.value as TreatmentFormFields['doseUnit'])}
                >
                  <option value="">unit</option>
                  {DOSE_UNITS.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </div>
            </label>
            <label className={labelCls}>
              Water / volume
              <input
                type="text"
                className={inputCls}
                value={fields.waterVolume}
                onChange={(e) => setF('waterVolume', e.target.value)}
              />
            </label>
            <label className={labelCls}>
              Withdrawal (days)
              <input
                type="text"
                className={inputCls}
                value={fields.withdrawalDays}
                onChange={(e) => setF('withdrawalDays', e.target.value)}
              />
            </label>
            <label className={`${labelCls} sm:col-span-2`}>
              Applied by
              <input
                type="text"
                className={inputCls}
                value={fields.appliedBy}
                onChange={(e) => setF('appliedBy', e.target.value)}
              />
            </label>
            <label className={`${labelCls} sm:col-span-2`}>
              Notes
              <textarea
                className={`${inputCls} min-h-[3rem] resize-y`}
                rows={2}
                value={fields.notes}
                onChange={(e) => setF('notes', e.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50/80 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Save changes
          </button>
        </div>
      </div>
    </div>
  )
}
