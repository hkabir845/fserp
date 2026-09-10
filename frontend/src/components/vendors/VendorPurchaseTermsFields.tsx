'use client'

import { CompanyDateInput } from '@/components/CompanyDateInput'
import {
  emptyRateCardForm,
  vendorUsesPurchaseTerms,
  type VendorRateCardPayload,
  type VendorSupplierCategory,
} from '@/lib/vendorSupplierCategory'

export type VendorRateCardForm = ReturnType<typeof emptyRateCardForm>

type Props = {
  supplierCategory: string
  creditFacilityEnabled: boolean
  creditLimit: string
  creditStartDate: string
  squareOffDate: string
  requireZeroOnSquareOff: boolean
  rateCard: VendorRateCardForm
  onFacilityChange: (patch: {
    credit_facility_enabled?: boolean
    credit_limit?: string
    credit_start_date?: string
    square_off_date?: string
    require_zero_on_square_off?: boolean
  }) => void
  onRateCardChange: (patch: Partial<VendorRateCardForm>) => void
}

export function rateCardFormFromPayload(card: VendorRateCardPayload | null | undefined): VendorRateCardForm {
  const empty = emptyRateCardForm()
  if (!card) return empty
  return {
    effective_from: (card.effective_from || empty.effective_from).slice(0, 10),
    instant_discount_percent: String(card.instant_discount_percent ?? '0'),
    instant_discount_per_unit: String(card.instant_discount_per_unit ?? '0'),
    transport_per_truck: String(card.transport_per_truck ?? '0'),
    transport_per_unit: String(card.transport_per_unit ?? '0'),
    transport_per_kg: String(card.transport_per_kg ?? '0'),
    monthly_rebate_percent: String(card.monthly_rebate_percent ?? '0'),
    yearly_rebate_percent: String(card.yearly_rebate_percent ?? '0'),
    yearly_target_tons: String(
      card.yearly_target_tons ??
        (Number(card.yearly_target_kg) ? Number(card.yearly_target_kg) / 1000 : 0)
    ),
  }
}

export function VendorPurchaseTermsFields({
  supplierCategory,
  creditFacilityEnabled,
  creditLimit,
  creditStartDate,
  squareOffDate,
  requireZeroOnSquareOff,
  rateCard,
  onFacilityChange,
  onRateCardChange,
}: Props) {
  const mill = vendorUsesPurchaseTerms(supplierCategory as VendorSupplierCategory)
  if (!mill) return null

  return (
    <div className="col-span-2 mt-2 rounded-lg border border-amber-200/80 bg-amber-50/50 p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Dealer credit & mill terms</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Fill only what this mill uses. Leave a field at 0 to skip that term — the bill
          continues with the values you did provide. Nothing is hardcoded.
          When used credit reaches the limit, further feed/medicine is cash-only until you pay down
          or raise the limit.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={creditFacilityEnabled}
          onChange={(e) => onFacilityChange({ credit_facility_enabled: e.target.checked })}
        />
        Credit facility (buy on account up to the limit)
      </label>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Credit limit</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={creditLimit}
            onChange={(e) => onFacilityChange({ credit_limit: e.target.value })}
            className="erp-field"
            placeholder="e.g. mill promised ceiling"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Credit start date</label>
          <CompanyDateInput
            value={creditStartDate}
            onChange={(iso) => onFacilityChange({ credit_start_date: iso })}
            className="erp-field"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">
            Square-off date (optional)
          </label>
          <CompanyDateInput
            value={squareOffDate}
            onChange={(iso) => onFacilityChange({ square_off_date: iso })}
            className="erp-field"
          />
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Blank = same date next year as credit start. Balance must be zero by then.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm mt-6">
          <input
            type="checkbox"
            checked={requireZeroOnSquareOff}
            onChange={(e) => onFacilityChange({ require_zero_on_square_off: e.target.checked })}
          />
          Cash-only after square-off until paid to zero
        </label>
      </div>
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Rate card (from date)
        </h4>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 sm:col-span-1">
            <label className="mb-1 block text-xs font-medium">Effective from</label>
            <CompanyDateInput
              value={rateCard.effective_from}
              onChange={(iso) => onRateCardChange({ effective_from: iso })}
              className="erp-field"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Instant discount % of MRP</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={rateCard.instant_discount_percent}
              onChange={(e) => onRateCardChange({ instant_discount_percent: e.target.value })}
              className="erp-field"
              placeholder="0 = skip"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Instant discount Tk / unit</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={rateCard.instant_discount_per_unit}
              onChange={(e) => onRateCardChange({ instant_discount_per_unit: e.target.value })}
              className="erp-field"
              placeholder="0 = skip"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Transport Tk / truck (once per bill)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={rateCard.transport_per_truck}
              onChange={(e) => onRateCardChange({ transport_per_truck: e.target.value })}
              className="erp-field"
              placeholder="0 = skip"
            />
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Deducted once on the bill, not per sack. Leave 0 if this mill has no truck rebate.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Transport Tk / unit (optional)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={rateCard.transport_per_unit}
              onChange={(e) => onRateCardChange({ transport_per_unit: e.target.value })}
              className="erp-field"
              placeholder="0 = skip"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Transport Tk / kg (optional)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={rateCard.transport_per_kg}
              onChange={(e) => onRateCardChange({ transport_per_kg: e.target.value })}
              className="erp-field"
              placeholder="0 = skip"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Monthly scheme % of MRP (reserve)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={rateCard.monthly_rebate_percent}
              onChange={(e) => onRateCardChange({ monthly_rebate_percent: e.target.value })}
              className="erp-field"
              placeholder="0 = skip"
            />
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Tracked in the mill&apos;s favour. Does not reduce what you owe unless you post a mill credit.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Yearly scheme % of MRP</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={rateCard.yearly_rebate_percent}
              onChange={(e) => onRateCardChange({ yearly_rebate_percent: e.target.value })}
              className="erp-field"
              placeholder="0 = skip"
            />
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Credited to the dealer account at square-off if the target (if any) is met.
            </p>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="mb-1 block text-xs font-medium">Yearly target (tons)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={rateCard.yearly_target_tons}
              onChange={(e) => onRateCardChange({ yearly_target_tons: e.target.value })}
              className="erp-field"
              placeholder="0 = no tonnage gate"
            />
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Leave 0 if this mill has no volume target. 1 ton = 1,000 kg.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
