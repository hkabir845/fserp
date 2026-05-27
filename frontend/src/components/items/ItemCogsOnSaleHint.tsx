'use client'

import Link from 'next/link'
import { resolveItemCogsOnSaleLabel, type CoaPickForItemDefault } from '@/lib/itemGlDefaults'

type Props = {
  item: {
    id?: number
    cogs_account_id?: number | null
    pos_category?: string
    item_type?: string
    category?: string
    unit?: string
    name?: string
  }
  coaOptions: CoaPickForItemDefault[]
  className?: string
}

/** Read-only hint: which COGS account posts when this inventory SKU is sold (editable on Products). */
export function ItemCogsOnSaleHint({ item, coaOptions, className = '' }: Props) {
  if (String(item.item_type || '').toLowerCase() !== 'inventory') return null
  const { label, fromItem } = resolveItemCogsOnSaleLabel(item, coaOptions)
  const editHref = item.id ? `/items?edit=${item.id}` : '/items'
  return (
    <p className={`text-xs text-slate-600 ${className}`.trim()}>
      COGS on sale: <span className="font-medium text-slate-800">{label}</span>
      {!fromItem && (
        <span className="text-slate-500"> (template default — set on product to override)</span>
      )}
      . Posts on POS / invoice, not on purchase.{' '}
      <Link href={editHref} className="text-blue-600 hover:underline">
        Edit product
      </Link>
    </p>
  )
}
