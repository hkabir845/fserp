'use client'

import { useEffect, useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { BillLineSelectItem } from '@/components/bills/BillLineItemSelect'
import { InvoiceLineEntityTagging } from '@/components/invoices/InvoiceLineEntityTagging'
import {
  InvoiceLineTypePicker,
  type InvoiceLineKind,
} from '@/components/invoices/InvoiceLineTypePicker'
import type { AquacultureInvoiceIncomeCategory } from '@/lib/aquacultureInvoiceLine'
import type { BillReceiptLocationPond, BillReceiptLocationStation } from '@/lib/billReceiptLocation'
import type { FuelStationInvoiceIncomeCategory } from '@/lib/fuelStationInvoiceLine'
import { invoiceLineEntityKey, invoiceLineEntityKind } from '@/lib/invoiceLineEntity'
import { entityScopeParamsFromKey } from '@/lib/billLineEntity'
import { formatCoaOptionLabel } from '@/utils/coaOptionLabel'
import { formatNumber } from '@/utils/currency'
import { AMOUNT_READ_ONLY_INPUT_CLASS } from '@/utils/amountFieldStyles'
import api from '@/lib/api'

export interface InvoiceFormLine {
  id?: number
  line_number: number
  line_kind?: InvoiceLineKind
  description?: string
  item_id?: number
  item_name?: string
  revenue_account_id?: number
  quantity: number
  unit_price: number
  amount: number
  tax_amount: number
  line_receipt_station_id?: number | '' | null
  aquaculture_pond_id?: number | '' | null
  fuel_station_income_category?: string
  aquaculture_income_category?: string
}

type ItemRow = BillLineSelectItem & {
  item_type?: string
  unit?: string
  unit_price?: number | null
  quantity_on_hand?: number | string
}

type CoaIncomeRow = {
  id: number
  account_code: string
  account_name: string
  account_type: string
}

type Availability = {
  tracks_per_station?: boolean
  unit?: string
  total_on_hand?: string
  stations?: { station_id: number; station_name?: string; quantity?: string }[]
  pond_warehouses?: { pond_id: number; pond_name?: string; quantity?: string }[]
}

function inferLineKind(line: InvoiceFormLine, items: ItemRow[]): InvoiceLineKind {
  if (line.line_kind === 'item' || line.line_kind === 'service') return line.line_kind
  if (line.item_id) {
    const it = items.find((i) => i.id === line.item_id)
    if ((it?.item_type || '').toLowerCase() === 'service') return 'service'
  }
  return 'item'
}

function resolveAvailableQty(
  availability: Availability | null,
  entityKey: string
): { qty: number | null; label: string } {
  if (!availability) return { qty: null, label: '' }
  const kind = invoiceLineEntityKind(entityKey)
  const params = entityScopeParamsFromKey(entityKey)
  if (kind === 'station' && params.station_id && availability.stations?.length) {
    const row = availability.stations.find((s) => String(s.station_id) === params.station_id)
    const q = row?.quantity != null ? Number(row.quantity) : null
    return {
      qty: q != null && Number.isFinite(q) ? q : null,
      label: row?.station_name || 'Station',
    }
  }
  if (kind === 'pond' && params.pond_id && availability.pond_warehouses?.length) {
    const row = availability.pond_warehouses.find((p) => String(p.pond_id) === params.pond_id)
    const q = row?.quantity != null ? Number(row.quantity) : null
    return {
      qty: q != null && Number.isFinite(q) ? q : null,
      label: row?.pond_name || 'Pond warehouse',
    }
  }
  if (availability.total_on_hand != null) {
    const q = Number(availability.total_on_hand)
    return { qty: Number.isFinite(q) ? q : null, label: 'Company total' }
  }
  return { qty: null, label: '' }
}

export function InvoiceLineFormList({
  lines,
  items,
  stations,
  ponds,
  pondIncomeCategories,
  stationIncomeCategories,
  revenueCoaOptions,
  revenueRecommendLabel,
  currencySymbol,
  loadingItems,
  companyName,
  onApplyItem,
  onLineChange,
  onLineBundle,
  onRemoveLine,
  onChangeLineKind,
}: {
  lines: InvoiceFormLine[]
  items: ItemRow[]
  stations: BillReceiptLocationStation[]
  ponds: BillReceiptLocationPond[]
  pondIncomeCategories: AquacultureInvoiceIncomeCategory[]
  stationIncomeCategories: FuelStationInvoiceIncomeCategory[]
  revenueCoaOptions: CoaIncomeRow[]
  revenueRecommendLabel: string
  currencySymbol: string
  loadingItems: boolean
  companyName?: string
  onApplyItem: (index: number, itemId: number, kind: InvoiceLineKind) => void
  onLineChange: (index: number, field: string, value: unknown) => void
  onLineBundle: (index: number, patch: Partial<InvoiceFormLine>) => void
  onRemoveLine: (index: number) => void
  onChangeLineKind: (index: number, kind: InvoiceLineKind) => void
}) {
  const catalogItems = useMemo(
    () =>
      items
        .filter((i) => (i.item_type || 'inventory').toLowerCase() !== 'service')
        .map(({ id, item_number, name, pos_category, pieces_per_kg }) => ({
          id,
          item_number,
          name,
          pos_category,
          pieces_per_kg,
        })),
    [items]
  )
  const serviceItems = useMemo(
    () =>
      items
        .filter((i) => (i.item_type || '').toLowerCase() === 'service')
        .map(({ id, item_number, name, pos_category, pieces_per_kg }) => ({
          id,
          item_number,
          name,
          pos_category,
          pieces_per_kg,
        })),
    [items]
  )

  const [availabilityByItem, setAvailabilityByItem] = useState<Record<number, Availability>>({})

  useEffect(() => {
    const ids = [...new Set(lines.map((l) => l.item_id).filter((id): id is number => !!id && id > 0))]
    const missing = ids.filter((id) => !availabilityByItem[id])
    if (missing.length === 0) return
    let cancelled = false
    ;(async () => {
      const next: Record<number, Availability> = {}
      await Promise.all(
        missing.map(async (itemId) => {
          try {
            const { data } = await api.get<Availability>('/inventory/availability/', {
              params: { item_id: itemId },
            })
            next[itemId] = data
          } catch {
            next[itemId] = {}
          }
        })
      )
      if (!cancelled) {
        setAvailabilityByItem((prev) => ({ ...prev, ...next }))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [lines, availabilityByItem])

  const selectClass =
    'w-full px-2 py-1 text-sm border border-border rounded focus:ring-1 focus:ring-ring'

  return (
    <div className="space-y-3">
      {lines.map((line, index) => {
        const kind = inferLineKind(line, items)
        const entityKey = invoiceLineEntityKey(line)
        const selectedItem = line.item_id ? items.find((i) => i.id === line.item_id) : undefined
        const avail = line.item_id ? availabilityByItem[line.item_id] : null
        const { qty: availQty, label: availLabel } = resolveAvailableQty(avail, entityKey)
        const unit = selectedItem?.unit || avail?.unit || 'units'
        const showQtyHint =
          kind === 'item' &&
          line.item_id &&
          selectedItem &&
          (selectedItem.item_type || 'inventory').toLowerCase() !== 'service'

        return (
          <div key={index} className="space-y-2 p-3 border border-border rounded-lg">
            <div className="grid grid-cols-12 gap-2">
              <div className="col-span-12 md:col-span-3">
                <InvoiceLineTypePicker
                  kind={kind}
                  catalogItems={catalogItems}
                  serviceItems={serviceItems}
                  itemId={line.item_id}
                  onChangeKind={(k) => onChangeLineKind(index, k)}
                  onSelectItem={(itemId) => onApplyItem(index, itemId, kind)}
                  className={selectClass}
                />
                {loadingItems ? (
                  <p className="mt-1 text-xs text-muted-foreground">Loading catalog…</p>
                ) : null}
                {!loadingItems && catalogItems.length === 0 && serviceItems.length === 0 ? (
                  <p className="mt-1 text-xs text-destructive">No items in catalog. Create items first.</p>
                ) : null}
                {showQtyHint ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {availQty != null ? (
                      <>
                        Available at {availLabel}:{' '}
                        <span className="font-medium tabular-nums">
                          {formatNumber(availQty, 2)} {unit}
                        </span>
                        {line.quantity > availQty ? (
                          <span className="ml-1 text-warning-foreground">(exceeds on-hand)</span>
                        ) : null}
                      </>
                    ) : avail?.tracks_per_station === false ? (
                      <span className="text-muted-foreground">Stock tracked in tanks, not shop bins.</span>
                    ) : (
                      <span className="text-muted-foreground">Select entity to see site quantity.</span>
                    )}
                  </p>
                ) : kind === 'service' ? (
                  <p className="mt-1 text-xs text-muted-foreground">Services do not reduce inventory.</p>
                ) : null}
              </div>
              <div className="col-span-12 md:col-span-2">
                <label className="block text-xs font-medium text-foreground/85 mb-1">Description</label>
                <input
                  type="text"
                  value={line.description || ''}
                  onChange={(e) => onLineChange(index, 'description', e.target.value)}
                  className={selectClass}
                />
              </div>
              <div className="col-span-6 md:col-span-2">
                <label className="block text-xs font-medium text-foreground/85 mb-1">Quantity</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={line.quantity}
                  onChange={(e) => onLineChange(index, 'quantity', parseFloat(e.target.value) || 0)}
                  className={selectClass}
                />
              </div>
              <div className="col-span-6 md:col-span-2">
                <label className="block text-xs font-medium text-foreground/85 mb-1">Unit Price</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={line.unit_price}
                  onChange={(e) => onLineChange(index, 'unit_price', parseFloat(e.target.value) || 0)}
                  className={selectClass}
                />
              </div>
              <div className="col-span-12 md:col-span-2">
                <label className="block text-xs font-medium text-foreground/85 mb-1">Amount</label>
                <input
                  type="text"
                  value={formatNumber(line.amount)}
                  readOnly
                  title={`${currencySymbol}${formatNumber(line.amount)}`}
                  className={AMOUNT_READ_ONLY_INPUT_CLASS}
                />
              </div>
              <div className="col-span-12 md:col-span-1 flex items-end">
                <button
                  type="button"
                  onClick={() => onRemoveLine(index)}
                  className="w-full px-2 py-1 text-sm text-destructive hover:text-destructive hover:bg-destructive/5 rounded"
                >
                  <Trash2 className="h-4 w-4 mx-auto" />
                </button>
              </div>
            </div>

            <InvoiceLineEntityTagging
              line={line}
              index={index}
              stations={stations}
              ponds={ponds}
              pondIncomeCategories={pondIncomeCategories}
              stationIncomeCategories={stationIncomeCategories}
              companyName={companyName}
              onFieldChange={(i, field, value) => {
                if (field === '__entity_bundle__' && value && typeof value === 'object') {
                  onLineBundle(i, value as Partial<InvoiceFormLine>)
                  return
                }
                onLineChange(i, field, value)
              }}
            />

            <div className="grid grid-cols-12 gap-2">
              <div className="col-span-12 md:col-span-10">
                <label className="block text-xs font-medium text-foreground/85 mb-1">
                  Revenue account (optional)
                </label>
                <select
                  value={line.revenue_account_id ? String(line.revenue_account_id) : ''}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === '') {
                      onLineChange(index, 'revenue_account_id', undefined)
                      return
                    }
                    const n = parseInt(v, 10)
                    onLineChange(index, 'revenue_account_id', Number.isFinite(n) && n > 0 ? n : undefined)
                  }}
                  className={`${selectClass} bg-white`}
                >
                  <option value="">{revenueRecommendLabel}</option>
                  {revenueCoaOptions.map((a) => (
                    <option key={a.id} value={String(a.id)}>
                      {formatCoaOptionLabel(a)}
                    </option>
                  ))}
                </select>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Tag entity and income category for P&amp;L; revenue GL auto-fills from item or income tag.
                </p>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
