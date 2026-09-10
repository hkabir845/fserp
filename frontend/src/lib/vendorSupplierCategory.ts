export const VENDOR_SUPPLIER_CATEGORIES = [
  { id: 'general', label: 'General' },
  { id: 'feed', label: 'Feed' },
  { id: 'medicine', label: 'Medicine' },
  { id: 'fish_fry', label: 'Fish fry & fingerling' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'other', label: 'Other' },
] as const

export type VendorSupplierCategory = (typeof VENDOR_SUPPLIER_CATEGORIES)[number]['id']

export function vendorSupplierCategoryLabel(code: string | null | undefined): string {
  const id = (code || 'general').trim().toLowerCase()
  return VENDOR_SUPPLIER_CATEGORIES.find((c) => c.id === id)?.label || 'General'
}

/** Mill dealer schemes (MRP discount, transport, volume rebate, credit limit). */
export function vendorUsesPurchaseTerms(code: string | null | undefined): boolean {
  const id = (code || '').trim().toLowerCase()
  return id === 'feed' || id === 'medicine'
}

export type VendorRateCardPayload = {
  id?: number
  effective_from?: string | null
  effective_to?: string | null
  instant_discount_percent?: string | number
  instant_discount_per_unit?: string | number
  transport_percent?: string | number
  transport_per_truck?: string | number
  transport_per_unit?: string | number
  transport_per_kg?: string | number
  monthly_rebate_percent?: string | number
  yearly_rebate_percent?: string | number
  yearly_target_kg?: string | number
  yearly_target_tons?: string | number
  is_active?: boolean
}

export type VendorPurchaseTerms = {
  supplier_category: string
  supplier_category_label: string
  uses_purchase_terms: boolean
  credit_facility_enabled: boolean
  credit_limit: string
  credit_start_date: string | null
  square_off_date: string | null
  require_zero_on_square_off: boolean
  used: string
  available: string | null
  cash_only: boolean
  square_off_hold: boolean
  cash_required: string
  rate_card: VendorRateCardPayload | null
  scheme: {
    month_mrp: string
    year_mrp: string
    year_kg: string
    year_tons?: string
    yearly_target_kg: string
    yearly_target_tons?: string
    monthly_rebate_percent: string
    yearly_rebate_percent: string
    estimated_monthly_credit: string
    monthly_reserved?: string
    monthly_is_reserve?: boolean
    monthly_credit_posted?: boolean
    can_post_monthly?: boolean
    estimated_yearly_credit: string
    yearly_target_reached: boolean
    yearly_credit_posted?: boolean
    can_post_yearly?: boolean
    year_start: string
    year_end: string
  } | null
  pending_terms?: {
    discount: string
    transport: string
    can_post_discount: boolean
    can_post_transport: boolean
    can_post_monthly: boolean
    can_post_yearly: boolean
    estimated_monthly: string
    estimated_yearly: string
  } | null
  recent_credits?: Array<{
    id: number
    credit_date: string
    amount: string
    credit_kind: string
    period_label: string
    memo: string
  }>
  recent_reserves?: Array<{
    id: number
    credit_kind: string
    period_label: string
    amount: string
    mrp_base_amount: string
    percent_applied: string
  }>
}

export const emptyRateCardForm = () => ({
  effective_from: new Date().toISOString().split('T')[0],
  instant_discount_percent: '0',
  instant_discount_per_unit: '0',
  transport_percent: '0',
  transport_per_truck: '0',
  transport_per_unit: '0',
  transport_per_kg: '0',
  monthly_rebate_percent: '0',
  yearly_rebate_percent: '0',
  yearly_target_tons: '0',
})
