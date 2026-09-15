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
  pieces_per_kg?: number | string
  /** Feed sack weight — needed for mill transport ৳/ton. */
  content_weight_kg?: number | string
}

export type BillLineCatalogItem = {
  id: number
  name: string
  description?: string
  unit?: string
  category?: string
  unit_price?: number | string
  pieces_per_kg?: number | string | null
  content_weight_kg?: number | string | null
  pos_category?: string
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
  { key: 'content_weight_kg', label: 'Kg / sack', type: 'number', placeholder: '25 if blank for sack' },
  { key: 'category', label: 'Category', type: 'text', placeholder: 'General' },
  { key: 'unit_price', label: 'Sale price', type: 'number' },
  { key: 'description', label: 'Item description', type: 'text', wide: true },
]

const SACK_KG_PRESETS = [25, 20, 10] as const

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
  if (key === 'unit_price' || key === 'pieces_per_kg' || key === 'content_weight_kg') {
    const a = Number(next)
    const b = Number(current)
    if (Number.isFinite(a) && Number.isFinite(b)) return a !== b
    if (String(next) === '' && (current === '' || current == null)) return false
  }
  return String(next) !== current
}

function resolveSackKg(item: BillLineCatalogItem, edits?: BillLineItemCatalogEdits): number {
  const fromEdits = Number(edits?.content_weight_kg)
  if (Number.isFinite(fromEdits) && fromEdits > 0) return fromEdits
  const fromItem = Number(item.content_weight_kg)
  if (Number.isFinite(fromItem) && fromItem > 0) return fromItem
  return 0
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
  millFeedLine = false,
  className,
}: {
  index: number
  itemId?: number
  item?: BillLineCatalogItem
  edits?: BillLineItemCatalogEdits
  onFieldChange: (index: number, field: string, value: unknown) => void
  /** When true, show kg/sack presets for feed mill tonnage (25 / 20 / 10). */
  millFeedLine?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  if (!itemId || !item) return null

  const current = edits || {}
  const changedKeys = FIELDS.filter((f) => isChanged(item, current, f.key)).map((f) => f.key)
  const dirty = changedKeys.length > 0
  const sackKg = resolveSackKg(item, current)
  const unit = String(current.unit !== undefined ? current.unit : item.unit || '')
    .trim()
    .toLowerCase()
  const looksLikeSack =
    millFeedLine ||
    ['sack', 'sacks', 'bag', 'bags', 'bag/sack', 'sack/bag'].includes(unit) ||
    String(item.pos_category || item.category || '')
      .toLowerCase()
      .includes('feed')

  const setField = (key: FieldKey, value: string) => {
    onFieldChange(index, 'item_catalog', { ...current, [key]: value })
  }

  const setSackKg = (kg: number) => {
    onFieldChange(index, 'item_catalog', {
      ...current,
      content_weight_kg: kg,
      ...(unit === '' || unit === 'piece' || unit === 'pcs' ? { unit: 'sack' } : {}),
    })
  }

  return (
    <div className={`mt-2 rounded-md border border-dashed border-border ${className || ''}`}>
      {looksLikeSack ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-dashed border-border px-2 py-1.5">
          <span className="text-[11px] font-medium text-foreground/85">Kg / sack</span>
          <div className="flex items-center gap-1">
            {SACK_KG_PRESETS.map((kg) => {
              const active = sackKg === kg || (sackKg <= 0 && kg === 25)
              return (
                <button
                  key={kg}
                  type="button"
                  onClick={() => setSackKg(kg)}
                  className={`h-7 min-w-[2.75rem] rounded-md border px-2 text-xs font-medium tabular-nums ${
                    active
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
                      : 'border-border bg-background text-foreground/80 hover:bg-muted/50'
                  }`}
                  title={
                    kg === 25 && sackKg <= 0
                      ? 'Default 25 kg when unit is sack/bag'
                      : `${kg} kg per sack`
                  }
                >
                  {kg}
                </button>
              )
            })}
          </div>
          <span className="text-[11px] text-muted-foreground">
            {sackKg > 0
              ? `Using ${sackKg} kg · tons = Qty × ${sackKg} ÷ 1000`
              : 'Default 25 kg for sack/bag if left blank'}
          </span>
        </div>
      ) : null}
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
              <div
                key={f.key}
                className={
                  f.wide
                    ? 'col-span-12 min-w-0'
                    : 'col-span-12 sm:col-span-6 lg:col-span-3 min-w-0'
                }
              >
                <label className="block text-xs font-medium text-foreground/85 mb-0.5">
                  {f.label}
                </label>
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
  if (isChanged(item, edits, 'pieces_per_kg')) {
    const n = Number(edits.pieces_per_kg)
    if (Number.isFinite(n) && n > 0) out.pieces_per_kg = n
  }
  if (isChanged(item, edits, 'content_weight_kg')) {
    const n = Number(edits.content_weight_kg)
    if (Number.isFinite(n) && n > 0) out.content_weight_kg = n
  }
  return Object.keys(out).length ? out : null
}
