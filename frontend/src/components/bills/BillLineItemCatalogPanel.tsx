'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Package } from 'lucide-react'

/** Catalog fields a bill line may edit — must match CATALOG_PANEL_FIELDS on the API. */
export type BillLineItemCatalogEdits = {
  name?: string
  description?: string
  unit?: string
  category?: string
  unit_price?: number | string
}

export type BillLineCatalogItem = {
  id: number
  name: string
  description?: string
  unit?: string
  category?: string
  unit_price?: number | string
}

type FieldKey = keyof BillLineItemCatalogEdits

const FIELDS: {
  key: FieldKey
  label: string
  type: 'text' | 'number'
  placeholder?: string
  wide?: boolean
}[] = [
  { key: 'name', label: 'Item name', type: 'text' },
  { key: 'unit', label: 'Unit', type: 'text', placeholder: 'piece, kg, sack…' },
  { key: 'category', label: 'Category', type: 'text', placeholder: 'General' },
  { key: 'unit_price', label: 'Sale price', type: 'number' },
  { key: 'description', label: 'Item description', type: 'text', wide: true },
]

const CTL =
  'w-full min-w-0 h-9 px-2 text-sm border border-border rounded-md focus:ring-1 focus:ring-ring focus:border-blue-500'

function catalogValue(item: BillLineCatalogItem, key: FieldKey): string {
  const raw = item[key as keyof BillLineCatalogItem]
  return raw === undefined || raw === null ? '' : String(raw)
}

function isChanged(item: BillLineCatalogItem, edits: BillLineItemCatalogEdits, key: FieldKey): boolean {
  if (!(key in edits)) return false
  const next = edits[key]
  if (next === undefined) return false
  const current = catalogValue(item, key)
  if (key === 'unit_price') {
    const a = Number(next)
    const b = Number(current)
    if (Number.isFinite(a) && Number.isFinite(b)) return a !== b
  }
  return String(next) !== current
}

/**
 * Item-level fields on a bill line. Editing here changes the Item catalog — saving the bill
 * writes the values onto the Item, so the next bill that picks the item sees them.
 * Line memo, Qty, Rate and the fish dimensions stay on the bill and are not part of this panel.
 */
export function BillLineItemCatalogPanel({
  index,
  itemId,
  item,
  edits,
  onFieldChange,
  className,
}: {
  index: number
  itemId?: number
  item?: BillLineCatalogItem
  edits?: BillLineItemCatalogEdits
  onFieldChange: (index: number, field: string, value: unknown) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  if (!itemId || !item) return null

  const current = edits || {}
  const changedKeys = FIELDS.filter((f) => isChanged(item, current, f.key)).map((f) => f.key)
  const dirty = changedKeys.length > 0

  const setField = (key: FieldKey, value: string) => {
    onFieldChange(index, 'item_catalog', { ...current, [key]: value })
  }

  return (
    <div className={`mt-2 rounded-md border border-dashed border-border ${className || ''}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-foreground/85 hover:bg-muted/40 rounded-md"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Package className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium">Edit item</span>
        <span className="truncate text-muted-foreground">— {item.name}</span>
        {dirty ? (
          <span className="ml-auto shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
            Item updates on save
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="border-t border-dashed border-border px-2 py-2">
          <div className="grid grid-cols-12 gap-x-2 gap-y-2 items-end">
            {FIELDS.map((f) => (
              <div key={f.key} className={f.wide ? 'col-span-12 min-w-0' : 'col-span-12 sm:col-span-6 lg:col-span-3 min-w-0'}>
                <label className="block text-xs font-medium text-foreground/85 mb-0.5">{f.label}</label>
                <input
                  type={f.type}
                  {...(f.type === 'number' ? { step: '0.01', min: 0 } : {})}
                  value={
                    current[f.key] !== undefined ? String(current[f.key]) : catalogValue(item, f.key)
                  }
                  placeholder={f.placeholder}
                  onChange={(e) => setField(f.key, e.target.value)}
                  className={f.type === 'number' ? `${CTL} text-right tabular-nums` : CTL}
                />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex items-start justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              These belong to the item, not this bill. Saving the bill updates the item catalog for
              every future bill, invoice and POS sale.
            </p>
            {dirty ? (
              <button
                type="button"
                onClick={() => onFieldChange(index, 'item_catalog', undefined)}
                className="shrink-0 text-[11px] font-medium text-primary hover:underline"
              >
                Undo item changes
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Only the fields the owner actually changed, ready for the line's `item_catalog` payload.
 * Returns null when nothing on the item was touched, so unedited lines leave the catalog alone.
 */
export function billLineItemCatalogPayload(
  item: BillLineCatalogItem | undefined,
  edits: BillLineItemCatalogEdits | undefined
): BillLineItemCatalogEdits | null {
  if (!item || !edits) return null
  const out: BillLineItemCatalogEdits = {}
  if (isChanged(item, edits, 'name')) out.name = String(edits.name ?? '')
  if (isChanged(item, edits, 'description')) out.description = String(edits.description ?? '')
  if (isChanged(item, edits, 'unit')) out.unit = String(edits.unit ?? '')
  if (isChanged(item, edits, 'category')) out.category = String(edits.category ?? '')
  if (isChanged(item, edits, 'unit_price')) {
    const n = Number(edits.unit_price)
    if (Number.isFinite(n)) out.unit_price = n
  }
  return Object.keys(out).length ? out : null
}
