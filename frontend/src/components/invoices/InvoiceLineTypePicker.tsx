'use client'

import { Package, Wrench } from 'lucide-react'
import {
  BillLineItemSelect,
  type BillLineSelectItem,
} from '@/components/bills/BillLineItemSelect'

export type InvoiceLineKind = 'item' | 'service'

type Props = {
  kind: InvoiceLineKind
  catalogItems: BillLineSelectItem[]
  serviceItems: BillLineSelectItem[]
  itemId?: number
  onChangeKind: (kind: InvoiceLineKind) => void
  onSelectItem: (itemId: number) => void
  className?: string
}

export function InvoiceLineTypePicker({
  kind,
  catalogItems,
  serviceItems,
  itemId,
  onChangeKind,
  onSelectItem,
  className = 'w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500',
}: Props) {
  const isItem = kind === 'item'
  const pickerItems = isItem ? catalogItems : serviceItems
  const baseBtn =
    'relative z-10 flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 text-xs font-medium transition-colors'

  return (
    <div className="min-w-0">
      <div
        role="tablist"
        aria-label="Line type"
        className="relative mb-1 flex rounded-md border border-gray-200 bg-gray-50 p-0.5"
      >
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%-0.125rem)] rounded bg-blue-600 shadow-sm transition-transform duration-200 ease-out ${
            isItem ? 'translate-x-0' : 'translate-x-full'
          }`}
        />
        <button
          type="button"
          role="tab"
          aria-selected={isItem}
          onClick={() => !isItem && onChangeKind('item')}
          className={`${baseBtn} rounded ${isItem ? 'text-white' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <Package className="h-3.5 w-3.5" />
          Item
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!isItem}
          onClick={() => isItem && onChangeKind('service')}
          className={`${baseBtn} rounded ${!isItem ? 'text-white' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <Wrench className="h-3.5 w-3.5" />
          Service
        </button>
      </div>
      <BillLineItemSelect
        items={pickerItems}
        expenseAccounts={[]}
        itemId={itemId}
        mode="item"
        className={className}
        placeholder={isItem ? 'Search inventory / products…' : 'Search services…'}
        onSelectItem={onSelectItem}
        onSelectAccount={() => {}}
      />
    </div>
  )
}
