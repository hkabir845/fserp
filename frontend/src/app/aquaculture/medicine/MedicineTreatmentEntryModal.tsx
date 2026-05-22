'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { Loader2, MapPin, Package, Stethoscope, X } from 'lucide-react'
import { useToast } from '@/components/Toast'
import { formatStockUnit } from '@/lib/aquacultureMedicineUnits'
import {
  formatTreatmentWaterVolume,
  pondHasCalculableVolume,
  pondVolumeSetupHint,
  pondVolumeSummaryLine,
} from '@/lib/aquaculturePondVolume'
import {
  APPLICATION_METHODS,
  DOSE_UNITS,
  TREATMENT_PURPOSES,
  type MedicineProductLine,
  type TreatmentFormFields,
} from './medicineUtils'
import { MedicineProductLinesEditor } from './MedicineUi'

const inputCls =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20'
const labelCls = 'block text-xs font-medium text-slate-700'

interface Pond {
  id: number
  name: string
  default_medicine_item_name?: string
  water_area_decimal?: string | null
  pond_depth_ft?: string | null
  water_volume_cu_ft?: string | null
  water_surface_sq_ft?: string | null
}

interface CycleRow {
  id: number
  name: string
}

interface WarehouseStockRow {
  item_id: number
  item_name: string
  quantity: string
  unit: string
}

export function MedicineTreatmentEntryModal(props: {
  open: boolean
  ponds: Pond[]
  pondId: string
  onPondIdChange: (id: string) => void
  cycles: CycleRow[]
  medicineCatalog: { id: number; name: string; unit?: string }[]
  stockByItemId: Map<number, { quantity: string; unit: string }>
  medicineOnHand: WarehouseStockRow[]
  whLoading: boolean
  productLines: MedicineProductLine[]
  treatment: TreatmentFormFields
  medDate: string
  medCycleId: string
  medSaving: boolean
  filledLineCount: number
  doseSuggestionLabel?: string | null
  kgPerDecimalDoseHint?: string | null
  onMedDateChange: (v: string) => void
  onMedCycleIdChange: (v: string) => void
  onTreatmentField: <K extends keyof TreatmentFormFields>(key: K, value: TreatmentFormFields[K]) => void
  onChangeLine: (id: string, patch: Partial<MedicineProductLine>) => void
  onAddLine: () => void
  onRemoveLine: (id: string) => void
  onAssignFromStock: (itemId: number) => void
  onProductItemSelect?: (lineId: string, itemId: string) => void
  onRefillWaterVolume: () => void
  onRecord: () => void
  onClose: () => void
}) {
  const {
    open,
    ponds,
    pondId,
    onPondIdChange,
    cycles,
    medicineCatalog,
    stockByItemId,
    medicineOnHand,
    whLoading,
    productLines,
    treatment,
    medDate,
    medCycleId,
    medSaving,
    filledLineCount,
    doseSuggestionLabel,
    kgPerDecimalDoseHint,
    onMedDateChange,
    onMedCycleIdChange,
    onTreatmentField,
    onChangeLine,
    onAddLine,
    onRemoveLine,
  onAssignFromStock,
  onProductItemSelect,
  onRefillWaterVolume,
  onRecord,
  onClose,
} = props

  const toast = useToast()
  const pondIdNum = pondId.trim() !== '' ? Number.parseInt(pondId, 10) : NaN
  const selectedPond = ponds.find((p) => p.id === pondIdNum) ?? null
  const pondVolumeLine = selectedPond ? pondVolumeSummaryLine(selectedPond) : null
  const pondVolumeHint = selectedPond ? pondVolumeSetupHint(selectedPond) : ''

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !medSaving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, medSaving, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/45 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-treatment-title"
      onClick={() => !medSaving && onClose()}
    >
      <div
        className="flex max-h-[min(92vh,900px)] w-full max-w-3xl flex-col rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
          <div>
            <h2 id="new-treatment-title" className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <Stethoscope className="h-4 w-4 text-teal-700" aria-hidden />
              Record treatment
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              Log one or more medicines for the same bath or protocol. Each product posts stock and COGS separately.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={medSaving}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <div className="grid gap-5 lg:grid-cols-[1fr_minmax(0,11rem)]">
            <div className="space-y-4">
              <label className={labelCls}>
                Pond <span className="text-red-600">*</span>
                <select
                  className={inputCls}
                  value={pondId}
                  onChange={(e) => onPondIdChange(e.target.value)}
                  disabled={medSaving}
                >
                  <option value="">Select pond…</option>
                  {ponds.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>

              {selectedPond ? (
                <p className="-mt-2 text-xs text-slate-500">
                  <Link
                    href={`/aquaculture/ponds/${selectedPond.id}`}
                    className="inline-flex items-center gap-1 font-medium text-teal-800 hover:underline"
                  >
                    <MapPin className="h-3 w-3" aria-hidden />
                    Pond warehouse & setup
                  </Link>
                  {selectedPond.default_medicine_item_name ? (
                    <span className="ml-2 text-slate-700">
                      · Default: {selectedPond.default_medicine_item_name}
                    </span>
                  ) : null}
                </p>
              ) : null}

              {!Number.isFinite(pondIdNum) ? (
                <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
                  Select a pond to enter products and application details.
                </p>
              ) : (
                <>
                  <label className={labelCls}>
                    Treatment date <span className="text-red-600">*</span>
                    <input
                      type="date"
                      className={`${inputCls} max-w-xs`}
                      value={medDate}
                      onChange={(e) => onMedDateChange(e.target.value)}
                      disabled={medSaving}
                    />
                  </label>

                  <MedicineProductLinesEditor
                    lines={productLines}
                    medicineCatalog={medicineCatalog}
                    stockByItemId={stockByItemId}
                    whLoading={whLoading}
                    inputCls={inputCls}
                    labelCls={labelCls}
                    onChangeLine={onChangeLine}
                    onAddLine={onAddLine}
                    onRemoveLine={onRemoveLine}
                    onItemSelect={onProductItemSelect}
                  />

                  {doseSuggestionLabel ? (
                    <p className="rounded-lg border border-violet-200 bg-violet-50/80 px-3 py-2 text-xs text-violet-950">
                      <span className="font-semibold">Auto dose suggestion</span> applied for{' '}
                      <span className="font-medium">{doseSuggestionLabel}</span> — verify label, fish species, and pond
                      volume before recording.
                    </p>
                  ) : null}

                  <fieldset className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 sm:p-4">
                    <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Application details (shared)
                    </legend>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      <label className={labelCls}>
                        Purpose
                        <select
                          className={inputCls}
                          value={treatment.purpose}
                          onChange={(e) =>
                            onTreatmentField('purpose', e.target.value as TreatmentFormFields['purpose'])
                          }
                          disabled={medSaving}
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
                        Application method
                        <select
                          className={inputCls}
                          value={treatment.method}
                          onChange={(e) =>
                            onTreatmentField('method', e.target.value as TreatmentFormFields['method'])
                          }
                          disabled={medSaving}
                        >
                          <option value="">—</option>
                          {APPLICATION_METHODS.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={labelCls}>
                        Dose rate
                        <div className="mt-1 flex gap-2">
                          <input
                            type="text"
                            inputMode="decimal"
                            className={`${inputCls} mt-0 flex-1 tabular-nums`}
                            value={treatment.doseAmount}
                            onChange={(e) => onTreatmentField('doseAmount', e.target.value)}
                            placeholder="e.g. 2"
                            disabled={medSaving}
                          />
                          <select
                            className={`${inputCls} mt-0 w-36 shrink-0`}
                            value={treatment.doseUnit}
                            onChange={(e) =>
                              onTreatmentField('doseUnit', e.target.value as TreatmentFormFields['doseUnit'])
                            }
                            disabled={medSaving}
                          >
                            <option value="">unit</option>
                            {DOSE_UNITS.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        {kgPerDecimalDoseHint ? (
                          <p className="mt-1 text-[11px] leading-relaxed text-teal-900">{kgPerDecimalDoseHint}</p>
                        ) : selectedPond && treatment.doseUnit === 'kg_decimal' ? (
                          <p className="mt-1 text-[11px] text-amber-900">
                            Add water area (decimal) on{' '}
                            <Link
                              href={`/aquaculture/ponds/${selectedPond.id}`}
                              className="font-medium underline"
                            >
                              pond setup
                            </Link>{' '}
                            to calculate total kg from kg/decimal rate.
                          </p>
                        ) : null}
                      </label>
                      <label className={labelCls}>
                        Water / pond volume treated
                        <div className="mt-1 flex flex-wrap gap-2">
                          <input
                            type="text"
                            className={`${inputCls} mt-0 min-w-[12rem] flex-1`}
                            value={treatment.waterVolume}
                            onChange={(e) => onTreatmentField('waterVolume', e.target.value)}
                            placeholder={
                              selectedPond && pondHasCalculableVolume(selectedPond)
                                ? 'Auto from pond — edit if partial'
                                : 'e.g. 500 m³'
                            }
                            disabled={medSaving}
                          />
                          {selectedPond ? (
                            <button
                              type="button"
                              onClick={onRefillWaterVolume}
                              disabled={!pondHasCalculableVolume(selectedPond) || medSaving}
                              className="shrink-0 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-900 hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Use pond volume
                            </button>
                          ) : null}
                        </div>
                        {selectedPond ? (
                          <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                            {pondHasCalculableVolume(selectedPond) ? (
                              <>From pond setup ({pondVolumeLine}). Edit for partial treatments.</>
                            ) : (
                              <>
                                {pondVolumeHint}{' '}
                                <Link
                                  href={`/aquaculture/ponds/${selectedPond.id}`}
                                  className="font-medium text-teal-800 underline"
                                >
                                  Pond setup
                                </Link>
                              </>
                            )}
                          </p>
                        ) : null}
                      </label>
                      <label className={labelCls}>
                        Withdrawal period (days)
                        <input
                          type="text"
                          inputMode="numeric"
                          className={inputCls}
                          value={treatment.withdrawalDays}
                          onChange={(e) => onTreatmentField('withdrawalDays', e.target.value)}
                          placeholder="e.g. 7"
                          disabled={medSaving}
                        />
                      </label>
                      <label className={labelCls}>
                        Applied by
                        <input
                          type="text"
                          className={inputCls}
                          value={treatment.appliedBy}
                          onChange={(e) => onTreatmentField('appliedBy', e.target.value)}
                          placeholder="Staff name"
                          disabled={medSaving}
                        />
                      </label>
                      <label className={`${labelCls} sm:col-span-2`}>
                        Production cycle
                        <select
                          className={inputCls}
                          value={medCycleId}
                          onChange={(e) => onMedCycleIdChange(e.target.value)}
                          disabled={medSaving}
                        >
                          <option value="">— optional —</option>
                          {cycles.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={`${labelCls} sm:col-span-2`}>
                        Notes
                        <textarea
                          className={`${inputCls} min-h-[4rem] resize-y`}
                          value={treatment.notes}
                          onChange={(e) => onTreatmentField('notes', e.target.value)}
                          placeholder="Symptoms, fish batch, follow-up…"
                          rows={2}
                          disabled={medSaving}
                        />
                      </label>
                    </div>
                  </fieldset>
                </>
              )}
            </div>

            <aside className="hidden lg:block">
              <div className="sticky top-0 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <Package className="h-3.5 w-3.5" aria-hidden />
                  Stock at pond
                </h3>
                {!Number.isFinite(pondIdNum) ? (
                  <p className="mt-2 text-[11px] text-slate-500">Select a pond</p>
                ) : whLoading ? (
                  <p className="mt-2 text-[11px] text-slate-500">Loading…</p>
                ) : medicineOnHand.length === 0 ? (
                  <p className="mt-2 text-[11px] leading-relaxed text-amber-900">
                    No medicine on hand. Transfer stock to this pond warehouse first.
                  </p>
                ) : (
                  <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto text-[11px]">
                    {medicineOnHand.map((r) => {
                      const inForm = productLines.some((l) => l.itemId === String(r.item_id))
                      return (
                        <li key={r.item_id}>
                          <button
                            type="button"
                            onClick={() => onAssignFromStock(r.item_id)}
                            disabled={medSaving}
                            className={`w-full rounded-lg border px-2 py-1.5 text-left transition hover:border-teal-300 hover:bg-teal-50/60 disabled:opacity-50 ${
                              inForm
                                ? 'border-teal-400 bg-teal-50 ring-1 ring-teal-300/50'
                                : 'border-slate-200 bg-white'
                            }`}
                          >
                            <span className="font-medium text-slate-900">{r.item_name}</span>
                            <span className="mt-0.5 block tabular-nums text-slate-600">
                              {r.quantity} {formatStockUnit(r.unit)}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
                <p className="mt-2 border-t border-slate-200 pt-2 text-[10px] text-slate-500">
                  Tap a row to fill the next empty product line.
                </p>
              </div>
            </aside>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/90 px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={onClose}
            disabled={medSaving}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={medSaving || !Number.isFinite(pondIdNum)}
            onClick={() => {
              if (!Number.isFinite(pondIdNum)) {
                toast.error('Select a pond')
                return
              }
              onRecord()
            }}
            className="inline-flex min-w-[10rem] items-center justify-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {medSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {medSaving
              ? 'Saving…'
              : filledLineCount > 1
                ? `Record treatment (${filledLineCount} products)`
                : 'Record treatment'}
          </button>
        </div>
      </div>
    </div>
  )
}
