'use client'

import { CompanyDateInput } from '@/components/CompanyDateInput'
import {
  emptyRateCardForm,
  vendorUsesPurchaseTerms,
  toTwoDecimals,
  type VendorRateCardPayload,
  type VendorSupplierCategory,
} from '@/lib/vendorSupplierCategory'

export type VendorRateCardForm = ReturnType<typeof emptyRateCardForm>

type FacilityPatch = {
  credit_facility_enabled?: boolean
  credit_limit?: string
  credit_start_date?: string
  square_off_date?: string
  require_zero_on_square_off?: boolean
}

type Props = {
  supplierCategory: string
  creditFacilityEnabled: boolean
  creditLimit: string
  creditStartDate: string
  squareOffDate: string
  requireZeroOnSquareOff: boolean
  /** When false (Add Vendor), only credit facility is shown — mill discounts/transport belong on the bill. */
  showRateCard?: boolean
  rateCard: VendorRateCardForm
  onFacilityChange: (patch: FacilityPatch) => void
  onRateCardChange: (patch: Partial<VendorRateCardForm>) => void
}

export function rateCardFormFromPayload(card: VendorRateCardPayload | null | undefined): VendorRateCardForm {
  const empty = emptyRateCardForm()
  if (!card) return empty
  return {
    effective_from: (card.effective_from || empty.effective_from).slice(0, 10),
    instant_discount_percent: toTwoDecimals(card.instant_discount_percent, '0.00'),
    instant_discount_per_unit: toTwoDecimals(card.instant_discount_per_unit, '0.00'),
    transport_percent: toTwoDecimals(card.transport_percent, '0.00'),
    transport_per_truck: toTwoDecimals(card.transport_per_truck, '0.00'),
    transport_per_unit: toTwoDecimals(card.transport_per_unit, '0.00'),
    transport_per_kg: toTwoDecimals(card.transport_per_kg, '0.00'),
    transport_per_ton: toTwoDecimals(card.transport_per_ton, '0.00'),
    monthly_rebate_percent: toTwoDecimals(card.monthly_rebate_percent, '0.00'),
    yearly_rebate_percent: toTwoDecimals(card.yearly_rebate_percent, '0.00'),
    yearly_target_tons: toTwoDecimals(
      card.yearly_target_tons ??
        (Number(card.yearly_target_kg) ? Number(card.yearly_target_kg) / 1000 : 0),
      '0.00'
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
  showRateCard = true,
  rateCard,
  onFacilityChange,
  onRateCardChange,
}: Props) {
  const mill = vendorUsesPurchaseTerms(supplierCategory as VendorSupplierCategory)
  if (!mill) return null

  return (
    <div className="col-span-2 mt-2 rounded-lg border border-amber-200/80 bg-amber-50/50 p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">
          {showRateCard ? 'Dealer credit & commercial terms' : 'Dealer credit facility'}
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          {showRateCard
            ? 'Set defaults once. On each feed bill the clerk confirms Discount %, Transport ৳/ton, and commission rates. Payables = MRP − discount − transport. Monthly/yearly commissions credit the mill only after approval.'
            : 'Set the credit ceiling here. Commercial terms are applied when you receive a bill or post a mill credit — not when creating the vendor.'}
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
      {showRateCard ? (
        <div className="space-y-3">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              Commercial defaults (five fields)
            </h4>
            <p className="text-[11px] text-muted-foreground mb-2">
              Example: 5.5% discount on MRP; ৳950 / ton transport; 3% monthly and 2.5% yearly
              commissions after mill approval when the yearly target is met.
            </p>
          </div>
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
              <label className="mb-1 block text-xs font-medium">Discount % of MRP</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={rateCard.instant_discount_percent}
                onChange={(e) => onRateCardChange({ instant_discount_percent: e.target.value })}
                className="erp-field"
                placeholder="e.g. 5.5"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Transport ৳ / ton</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={rateCard.transport_per_ton}
                onChange={(e) => onRateCardChange({ transport_per_ton: e.target.value })}
                className="erp-field"
                placeholder="e.g. 950"
              />
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Ordered tons × this rate. Tons come from Qty × kg/sack on the bill.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Monthly commission % of MRP</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={rateCard.monthly_rebate_percent}
                onChange={(e) => onRateCardChange({ monthly_rebate_percent: e.target.value })}
                className="erp-field"
                placeholder="e.g. 3"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Yearly commission % of MRP</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={rateCard.yearly_rebate_percent}
                onChange={(e) => onRateCardChange({ yearly_rebate_percent: e.target.value })}
                className="erp-field"
                placeholder="e.g. 2.5"
              />
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
                placeholder="e.g. 500"
              />
              <p className="text-[11px] text-muted-foreground mt-0.5">
                0 = no tonnage gate. Post via Vendors → mill credits after approval.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground rounded-md border border-dashed border-amber-300/80 bg-white/60 px-3 py-2">
          After creating this feed/medicine vendor, open <strong>Edit</strong> to save commercial term
          defaults. Mill commissions post via <strong>Record mill credit</strong> /{' '}
          <strong>Post monthly / yearly scheme</strong>.
        </p>
      )}
    </div>
  )
}
