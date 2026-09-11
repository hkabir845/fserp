'use client'

import { useEffect, useState } from 'react'
import { emptyRateCardForm, toTwoDecimals } from '@/lib/vendorSupplierCategory'
import type { VendorRateCardPayload } from '@/lib/vendorSupplierCategory'

export type BillMillTermsValues = {
  instant_discount_percent: string
  instant_discount_per_unit: string
  transport_percent: string
  transport_per_truck: string
  transport_per_unit: string
  transport_per_kg: string
  transport_per_ton: string
  monthly_rebate_percent: string
  yearly_rebate_percent: string
  yearly_target_tons: string
}

type Props = {
  open: boolean
  currencySymbol?: string
  initial?: VendorRateCardPayload | null
  onClose: () => void
  onApply: (values: BillMillTermsValues) => void
}

function fromCard(card: VendorRateCardPayload | null | undefined): BillMillTermsValues {
  const empty = emptyRateCardForm()
  return {
    instant_discount_percent: toTwoDecimals(
      card?.instant_discount_percent,
      empty.instant_discount_percent
    ),
    instant_discount_per_unit: toTwoDecimals(
      card?.instant_discount_per_unit,
      empty.instant_discount_per_unit
    ),
    transport_percent: toTwoDecimals(card?.transport_percent, empty.transport_percent),
    transport_per_truck: toTwoDecimals(card?.transport_per_truck, empty.transport_per_truck),
    transport_per_unit: toTwoDecimals(card?.transport_per_unit, empty.transport_per_unit),
    transport_per_kg: toTwoDecimals(card?.transport_per_kg, empty.transport_per_kg),
    transport_per_ton: toTwoDecimals(card?.transport_per_ton, empty.transport_per_ton),
    monthly_rebate_percent: toTwoDecimals(
      card?.monthly_rebate_percent,
      empty.monthly_rebate_percent
    ),
    yearly_rebate_percent: toTwoDecimals(card?.yearly_rebate_percent, empty.yearly_rebate_percent),
    yearly_target_tons: toTwoDecimals(
      card?.yearly_target_tons ??
        (Number(card?.yearly_target_kg) ? Number(card?.yearly_target_kg) / 1000 : empty.yearly_target_tons),
      empty.yearly_target_tons
    ),
  }
}

/**
 * Full mill commercial terms for feed/medicine:
 * - This bill: instant % of MRP + transport ৳ per ton
 * - Scheme: monthly % and yearly % @ ton target (credited after mill approval)
 */
export function BillMillTermsDialog({ open, currencySymbol = '৳', initial, onClose, onApply }: Props) {
  const [form, setForm] = useState<BillMillTermsValues>(fromCard(initial))

  useEffect(() => {
    if (open) setForm(fromCard(initial))
  }, [open, initial])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/40">
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-card shadow-xl"
        role="dialog"
        aria-labelledby="bill-mill-terms-title"
      >
        <div className="border-b border-border px-4 py-3">
          <h3 id="bill-mill-terms-title" className="text-base font-semibold text-foreground">
            Mill terms (feed / medicine)
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Instant discount and transport credit (৳ per ton) apply when they send feed. Monthly and
            yearly commissions are credited to your mill account only after their official approval.
          </p>
        </div>
        <div className="px-4 py-3 space-y-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              1. Instant discount — this bill
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Instant discount % of MRP</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="erp-field"
                  placeholder="e.g. 5.5"
                  value={form.instant_discount_percent}
                  onChange={(e) => setForm({ ...form, instant_discount_percent: e.target.value })}
                />
                <p className="mt-0.5 text-[11px] text-muted-foreground">Taken on this bill</p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Instant {currencySymbol} / unit (optional)
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="erp-field"
                  value={form.instant_discount_per_unit}
                  onChange={(e) => setForm({ ...form, instant_discount_per_unit: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              2. Transport credit — per ton (this bill)
            </p>
            <div>
              <label className="mb-1 block text-xs font-medium">
                Transport {currencySymbol} / ton
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                className="erp-field"
                placeholder="e.g. 950"
                value={form.transport_per_ton}
                onChange={(e) => setForm({ ...form, transport_per_ton: e.target.value })}
              />
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Ordered tons × this rate (example: 10 t × 950 = {currencySymbol}9,500). Not a fixed lorry
                fee. Item sack weight (kg) or qty in kg is required.
              </p>
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
                Optional extras (fixed / bill, % / unit / kg)
              </summary>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium">Fixed {currencySymbol} / bill</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="erp-field"
                    value={form.transport_per_truck}
                    onChange={(e) => setForm({ ...form, transport_per_truck: e.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Transport % of MRP</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="erp-field"
                    value={form.transport_percent}
                    onChange={(e) => setForm({ ...form, transport_percent: e.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Transport {currencySymbol} / unit</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="erp-field"
                    value={form.transport_per_unit}
                    onChange={(e) => setForm({ ...form, transport_per_unit: e.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Transport {currencySymbol} / kg</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="erp-field"
                    value={form.transport_per_kg}
                    onChange={(e) => setForm({ ...form, transport_per_kg: e.target.value })}
                  />
                </div>
              </div>
            </details>
          </div>

          <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-3 space-y-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-900/80 mb-1">
                3. Monthly &amp; yearly commission (after mill approval)
              </p>
              <p className="text-[11px] text-muted-foreground">
                Example: <span className="font-medium text-foreground">3% monthly</span> on total month MRP;
                <span className="font-medium text-foreground"> 2.5% yearly</span> when you reach e.g.{' '}
                <span className="font-medium text-foreground">500 tons</span>. Tracked here; credited to your
                mill A/P only after their official approval (Edit Vendor → Mill credit actions).
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Monthly commission % of MRP</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="erp-field"
                  placeholder="e.g. 3"
                  value={form.monthly_rebate_percent}
                  onChange={(e) => setForm({ ...form, monthly_rebate_percent: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Yearly commission % of MRP</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="erp-field"
                  placeholder="e.g. 2.5"
                  value={form.yearly_rebate_percent}
                  onChange={(e) => setForm({ ...form, yearly_rebate_percent: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-xs font-medium">Yearly target (tons)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="erp-field"
                  placeholder="e.g. 500"
                  value={form.yearly_target_tons}
                  onChange={(e) => setForm({ ...form, yearly_target_tons: e.target.value })}
                />
                <p className="mt-0.5 text-[11px] text-muted-foreground">0 = no tonnage gate</p>
              </div>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" className="erp-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="erp-btn-primary"
            onClick={() => {
              onApply(form)
              onClose()
            }}
          >
            Apply to bill &amp; save scheme rates
          </button>
        </div>
      </div>
    </div>
  )
}
