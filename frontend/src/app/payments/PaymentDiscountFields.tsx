'use client'

import { roundToDecimals } from '@/utils/currency'

export type PaymentDiscounts = {
  feed_discount_type: 'amount' | 'percent'
  feed_discount_value: string
  discount_mrp_base: string
  transport_discount_amount: string
}
export const emptyPaymentDiscounts = (): PaymentDiscounts => ({
  feed_discount_type: 'amount', feed_discount_value: '', discount_mrp_base: '', transport_discount_amount: '',
})
export function paymentDiscountTotal(value: PaymentDiscounts): number {
  const feed = value.feed_discount_type === 'percent'
    ? Number(value.discount_mrp_base) * Number(value.feed_discount_value) / 100
    : Number(value.feed_discount_value)
  return roundToDecimals(roundToDecimals(feed, 2) + Number(value.transport_discount_amount), 2)
}
export default function PaymentDiscountFields({ value, onChange, gross, currency }: {
  value: PaymentDiscounts; onChange: (value: PaymentDiscounts) => void; gross: number; currency: string
}) {
  const field = (key: keyof PaymentDiscounts, label: string, max?: number) => (
    <label className="block text-sm font-medium">
      {label}
      <input type="number" min="0" max={max} step="0.01" value={value[key]}
        onChange={(e) => onChange({ ...value, [key]: e.target.value })}
        className="mt-1 w-full rounded-md border border-border px-3 py-2" />
    </label>
  )
  return <div className="md:col-span-2 rounded-md border border-border p-4 space-y-3">
    <p className="font-medium">Optional payment discounts</p>
    <p className="text-sm text-muted-foreground">Enter additional discounts agreed for this payment. Leave blank for none. Exclude discounts already applied on the bill.</p>
    <div className="grid gap-3 md:grid-cols-2">
      <label className="block text-sm font-medium">Feed discount type
        <select value={value.feed_discount_type} onChange={(e) => onChange({ ...value, feed_discount_type: e.target.value as 'amount' | 'percent' })}
          className="mt-1 w-full rounded-md border border-border px-3 py-2">
          <option value="amount">Fixed amount</option><option value="percent">Percentage of MRP</option>
        </select>
      </label>
      {field('feed_discount_value', value.feed_discount_type === 'percent' ? 'Feed discount (%)' : 'Feed discount amount', value.feed_discount_type === 'percent' ? 100 : undefined)}
      {value.feed_discount_type === 'percent' && field('discount_mrp_base', 'MRP total for this payment')}
      {field('transport_discount_amount', 'Transport discount amount')}
    </div>
    <p className="text-sm">Total discounts: {currency}{paymentDiscountTotal(value).toFixed(2)}</p>
    <p className="font-semibold">Net payment: {currency}{roundToDecimals(gross - paymentDiscountTotal(value), 2).toFixed(2)}</p>
  </div>
}
