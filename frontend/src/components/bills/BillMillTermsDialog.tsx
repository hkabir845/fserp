'use client'

import { useEffect, useState } from 'react'
import type { VendorRateCardPayload } from '@/lib/vendorSupplierCategory'
import { emptyRateCardForm } from '@/lib/vendorSupplierCategory'

export type BillMillTermsValues = {
  instant_discount_percent: string
  instant_discount_per_unit: string
  transport_percent: string
  transport_per_truck: string
  transport_per_unit: string
  transport_per_kg: string
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
    instant_discount_percent: String(card?.instant_discount_percent ?? empty.instant_discount_percent),
    instant_discount_per_unit: String(card?.instant_discount_per_unit ?? empty.instant_discount_per_unit),
    transport_percent: String(card?.transport_percent ?? empty.transport_percent),
    transport_per_truck: String(card?.transport_per_truck ?? empty.transport_per_truck),
    transport_per_unit: String(card?.transport_per_unit ?? empty.transport_per_unit),
    transport_per_kg: String(card?.transport_per_kg ?? empty.transport_per_kg),
  }
}

/**
 * Per-bill mill pricing for feed/medicine suppliers.
 * Instant % of MRP + variable transport (% and/or ৳). Scheme commissions post on the vendor.
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
        className="w-full max-w-lg rounded-lg border border-border bg-card shadow-xl"
        role="dialog"
        aria-labelledby="bill-mill-terms-title"
      >
        <div className="border-b border-border px-4 py-3">
          <h3 id="bill-mill-terms-title" className="text-base font-semibold text-foreground">
            Apply mill terms on this bill
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Example: <span className="font-medium text-foreground">5.5% instant</span> of MRP (cash or within
            credit limit) plus transport as <span className="font-medium text-foreground">% of MRP</span> and/or
            fixed ৳. Leave unused fields at 0. Monthly/yearly commissions post on the vendor (Post monthly /
            yearly scheme), not here.
          </p>
        </div>
        <div className="px-4 py-3 space-y-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Instant discount (this receipt)
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
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Instant discount {currencySymbol} / unit (optional)
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
              Transport (variable — use % and/or fixed ৳)
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Transport % of MRP</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="erp-field"
                  placeholder="e.g. 1.5"
                  value={form.transport_percent}
                  onChange={(e) => setForm({ ...form, transport_percent: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Transport {currencySymbol} / truck (once)
                </label>
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
            Apply to bill lines
          </button>
        </div>
      </div>
    </div>
  )
}
