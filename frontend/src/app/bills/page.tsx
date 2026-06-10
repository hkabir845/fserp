'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { Plus, Trash2, Search, X, PlusCircle, Eye, Edit2, FileText, Ban } from 'lucide-react'
import { DocumentExportButtons } from '@/components/DocumentExportButtons'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { isOffsetPagedPayload, offsetListParams, REFERENCE_FETCH_LIMIT } from '@/lib/pagination'
import { OffsetPaginationControls } from '@/components/ui/OffsetPaginationControls'
import { formatCoaOptionLabel } from '@/utils/coaOptionLabel'
import { getCurrencySymbol, formatNumber } from '@/utils/currency'
import { formatDate, formatDateOnly } from '@/utils/date'
import {
  buildBillDetailCsv,
  buildBillListCsv,
  buildBillPrintHtml,
  downloadCsvFile,
  downloadJsonFile,
  printHtmlDocument,
  type BillExport,
  type BillLineExport,
} from '@/utils/businessDocumentExport'
import { escapeHtml } from '@/utils/printDocument'
import { loadPrintBranding } from '@/utils/printBranding'
import { printListView } from '@/utils/printListView'
import { AMOUNT_READ_ONLY_INPUT_CLASS } from '@/utils/amountFieldStyles'
import { extractErrorMessage } from '@/utils/errorHandler'
import {
  applyAquacultureCategoryToBillLine,
  billExpenseCategoriesFromApi,
  findBillCategory,
  isAquacultureOperatingCoaCode,
  type AquacultureBillExpenseCategory,
} from '@/lib/aquacultureBillLine'
import {
  applyFuelCategoryToBillLine,
  billFuelCategoriesFromApi,
  findFuelBillCategory,
  type FuelStationBillExpenseCategory,
} from '@/lib/fuelStationBillLine'
import {
  resolveReceiptLocationKeyForVendor,
  vendorUsualReceivingSummary,
} from '@/lib/vendorReceivingDefaults'
import {
  applyHeaderPondToBillLines,
  clearPondTagsFromNonFishLines,
  formatPondScopeKey,
  headerPondIdFromLocationKey,
  inferReceiptLocationKeyFromBill,
  resolveBillReceiptLocation,
} from '@/lib/billReceiptLocation'
import { BillReceiptLocationSelect } from '@/components/bills/BillReceiptLocationSelect'
import {
  type BillPurpose,
  billLinePondCostMode,
  inferBillPurposeFromLines,
  pondSharePayload,
  stationSharePayload,
  validateBillLinePondAllocation,
  validateBillLineStationAllocation,
} from '@/lib/billAllocation'
import { BillPurposeSection } from '@/components/bills/BillPurposeSection'
import { BillLineTypePicker, type BillLineKind } from '@/components/bills/BillLineItemSelect'
import { BillStationAllocationFields } from '@/components/bills/BillStationAllocationFields'
import { COA_OFFICE_EXP, suggestedBillLineExpenseAccountId, templateCoaOptionLabel } from '@/lib/coaDefaults'
import { syncLineTouchedForAccount } from '@/lib/coaSuggestForm'
import { ItemCogsOnSaleHint } from '@/components/items/ItemCogsOnSaleHint'
import type { CoaPickForItemDefault } from '@/lib/itemGlDefaults'

/** Bill line inputs: fixed height so grid rows align across columns */
const BILL_LINE_CTL =
  'w-full min-w-0 h-9 px-2 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500'
const BILL_LINE_NUM = `${BILL_LINE_CTL} text-right tabular-nums`

interface BillLineItem {
  id?: number
  line_number: number
  description?: string
  /** Explicit QuickBooks-style line kind. Falls back to item_id presence when absent (legacy rows). */
  line_kind?: BillLineKind
  item_id?: number
  expense_account_id?: number
  tank_id?: number  // For fuel items - specifies which tank to receive fuel into
  tank_name?: string | null
  quantity: number
  unit_cost?: number
  unit_price?: number
  amount: number
  tax_amount: number
  /** Fish-type items (Item.pos_category === 'fish'): required kg and headcount on the vendor line */
  aquaculture_fish_weight_kg?: number | string | null
  aquaculture_fish_count?: number | string | null
  /** Fish-type items: required species (fry/fingerling) stocked on this line. */
  aquaculture_fish_species?: string
  aquaculture_fish_species_other?: string
  /** Optional: tag line to a pond/cycle for aquaculture P&L when the bill posts (GL). */
  aquaculture_pond_id?: number | '' | null
  aquaculture_production_cycle_id?: number | '' | null
  /** Pond operating expense category (maps to 671x COA + cost bucket on post). */
  aquaculture_expense_category?: string
  aquaculture_cost_bucket?: string
  /** Fuel-station P&L reporting category (built-in rollup or tenant-defined). */
  fuel_station_expense_category?: string
  /** Pond P&L: one pond, or split across ponds (expanded to multiple lines on save). */
  aquaculture_cost_mode?: 'direct' | 'shared_equal' | 'shared_manual'
  shared_equal_pond_ids?: number[]
  pond_shares?: { pond_id: number | ''; amount: number | string }[]
  station_cost_mode?: 'direct' | 'shared_equal' | 'shared_manual'
  shared_equal_station_ids?: number[]
  station_shares?: { station_id: number | ''; amount: number | string }[]
  line_receipt_station_id?: number | '' | null
}

interface AquaculturePondOption {
  id: number
  name: string
  pond_role?: string
  is_active?: boolean
}

interface FishSpeciesOption {
  id: string
  label: string
}

interface ProductionCycleOption {
  id: number
  pond_id: number
  name: string
}

interface Station {
  id: number
  station_name: string
  station_number?: string
  default_aquaculture_pond_id?: number | null
  operates_fuel_retail?: boolean
  is_active?: boolean
}

interface Bill {
  id: number
  bill_number: string
  vendor_id: number
  vendor_name?: string
  vendor_number?: string
  receipt_station_id?: number | null
  receipt_station_name?: string | null
  bill_date: string
  due_date?: string
  vendor_reference?: string
  memo?: string
  status: string
  subtotal?: number | string
  tax_amount?: number | string
  tax_total?: number | string
  total_amount?: number | string
  total?: number | string
  amount_paid?: number | string
  balance_due?: number | string
  created_at?: string
  updated_at?: string
  lines: BillLineItem[]
}

type BillAmountSource = Pick<
  Bill,
  'total_amount' | 'total' | 'tax_amount' | 'tax_total' | 'amount_paid' | 'balance_due' | 'subtotal'
>

function parseMoney(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function billTotal(b: BillAmountSource): number {
  return parseMoney(b.total_amount ?? b.total)
}

function billTax(b: BillAmountSource): number {
  return parseMoney(b.tax_amount ?? b.tax_total)
}

function billPaid(b: BillAmountSource): number {
  return parseMoney(b.amount_paid)
}

function billBalance(b: BillAmountSource): number {
  if (b.balance_due !== undefined && b.balance_due !== null && b.balance_due !== '') {
    return parseMoney(b.balance_due)
  }
  return Math.max(0, billTotal(b) - billPaid(b))
}

function billSubtotal(b: BillAmountSource): number {
  return parseMoney(b.subtotal)
}

/** Collapse spaces so "Diesel Tank 1" matches "Diesel  Tank  1". */
function normalizeStockLabel(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Default receiving tank: name match (e.g. Diesel → Diesel Tank 1), else first by tank_name. */
function defaultTankIdForProduct(itemId: number, itemList: Item[], tankList: Tank[]): number | undefined {
  const productTanks = tankList
    .filter((t) => t.product_id === itemId)
    .slice()
    .sort((a, b) =>
      a.tank_name.localeCompare(b.tank_name, undefined, { sensitivity: 'base', numeric: true })
    )
  if (productTanks.length === 0) return undefined
  const item = itemList.find((i) => i.id === itemId)
  const name = normalizeStockLabel(item?.name || '')
  if (name) {
    const byPrefix = productTanks.find((t) => normalizeStockLabel(t.tank_name).startsWith(name))
    if (byPrefix) return byPrefix.id
    const byContains = productTanks.find((t) => normalizeStockLabel(t.tank_name).includes(name))
    if (byContains) return byContains.id
    const words = name.replace(/-/g, ' ').split(/\s+/).filter((w) => w.length > 1)
    for (const w of words) {
      const hit = productTanks.find((t) => normalizeStockLabel(t.tank_name).includes(w))
      if (hit) return hit.id
    }
  }
  return productTanks[0].id
}

function formatBillStatusLabel(status: string): string {
  const s = (status || '').toLowerCase()
  const map: Record<string, string> = {
    partial: 'Partially paid',
    partially_paid: 'Partially paid',
    open: 'Open',
    draft: 'Draft',
    paid: 'Paid',
    overdue: 'Overdue',
    void: 'Void',
  }
  return (map[s] || s.replace(/_/g, ' ') || '—').toUpperCase()
}

interface Vendor {
  id: number
  vendor_number: string
  display_name: string
  is_active: boolean
  default_expense_account_id?: number | null
  default_station_id?: number | null
  default_station_name?: string | null
  default_aquaculture_pond_id?: number | null
  default_aquaculture_pond_name?: string | null
}

interface Item {
  id: number
  item_number: string
  name: string
  cost: number
  unit: string
  item_type: string  // 'inventory', 'non_inventory', 'service'
  pos_category?: string  // 'fuel', 'general', 'fish' (Fish Type), etc.
  quantity_on_hand?: number | string
  expense_account_id?: number | null
  cogs_account_id?: number | null
  category?: string
  /** Fish / fry: pieces (heads) per 1 kg — Line on item form */
  pieces_per_kg?: number | string | null
}

function isFishTypeItem(item: Item | undefined): boolean {
  return (item?.pos_category || '').toLowerCase() === 'fish'
}

/** Returns an error message if any fish-type line is missing positive kg or headcount. */
function validateFishTypeBillLines(lines: BillLineItem[], itemList: Item[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.item_id) continue
    const item = itemList.find((it) => it.id === line.item_id)
    if (!isFishTypeItem(item)) continue
    const species = (line.aquaculture_fish_species || '').trim()
    if (species === '' || species === 'not_applicable') {
      return `Line ${i + 1} (${item?.name || 'Fish item'}): choose a fish species.`
    }
    if (species === 'other' && (line.aquaculture_fish_species_other || '').trim() === '') {
      return `Line ${i + 1} (${item?.name || 'Fish item'}): enter the species name for "Other".`
    }
    const pondId = line.aquaculture_pond_id
    if (pondId === '' || pondId == null || !Number.isFinite(Number(pondId))) {
      return `Line ${i + 1} (${item?.name || 'Fish item'}): choose a destination pond (nursing pond suggested).`
    }
    if (itemPiecesPerKg(item)) {
      const heads = parseFishHeadCount(line)
      if (heads <= 0) {
        return `Line ${i + 1} (${item?.name || 'Fish item'}): enter total fish (heads) greater than zero.`
      }
      const amt = Number(line.amount ?? 0)
      if (!Number.isFinite(amt) || amt < 0) {
        return `Line ${i + 1} (${item?.name || 'Fish item'}): enter a valid line Amount.`
      }
      continue
    }
    const w = line.aquaculture_fish_weight_kg
    const c = line.aquaculture_fish_count
    const wn = w === undefined || w === '' || w === null ? NaN : Number(w)
    const cn =
      c === undefined || c === '' || c === null ? NaN : parseInt(String(c), 10)
    if (!Number.isFinite(wn) || wn <= 0) {
      return `Line ${i + 1} (${item?.name || 'Fish item'}): enter total weight (kg) greater than zero.`
    }
    if (!Number.isInteger(cn) || cn <= 0) {
      return `Line ${i + 1} (${item?.name || 'Fish item'}): enter total fish count (heads) as a positive whole number.`
    }
  }
  return null
}

function roundBillMoney(n: number): number {
  return Math.round(n * 100) / 100
}

function roundFishWeightKg(n: number): number {
  return Math.round(n * 10000) / 10000
}

function billLineRowAmount(quantity: number, unitCost: number): number {
  const qty = Number(quantity)
  const uc = Number(unitCost)
  if (!Number.isFinite(qty) || !Number.isFinite(uc)) return 0
  return roundBillMoney(qty * uc)
}

/** Fish fry lines with pcs/kg: amount comes from vendor total + heads, not qty × rate. */
function isFishBillLineAutoMode(line: BillLineItem, itemList: Item[]): boolean {
  if (!line.item_id) return false
  const item = itemList.find((i) => i.id === line.item_id)
  return isFishTypeItem(item) && itemPiecesPerKg(item) != null
}

/** Recompute line amount from qty × unit cost (standard item/expense lines). */
function syncStandardBillLineAmount(line: BillLineItem): BillLineItem {
  const qty = Number(line.quantity ?? 0)
  const uc = Number(line.unit_cost ?? 0)
  return { ...line, amount: billLineRowAmount(qty, uc) }
}

function finalizeBillLinesForSave(lines: BillLineItem[], itemList: Item[]): BillLineItem[] {
  return lines.map((line) =>
    isFishBillLineAutoMode(line, itemList) ? line : syncStandardBillLineAmount(line)
  )
}

function itemPiecesPerKg(item: Item | undefined): number | null {
  if (!item) return null
  const raw = item.pieces_per_kg
  if (raw === undefined || raw === null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

function formatFishLinePcsPerKg(item: Item | undefined): string {
  const pcs = itemPiecesPerKg(item)
  return pcs != null ? formatNumber(pcs) : '—'
}

/** Per-head (per fry/fingerling) cost = line amount ÷ headcount. Empty when count is missing. */
function fishCostPerHead(line: BillLineItem): number | null {
  const heads = parseFishHeadCount(line)
  if (heads <= 0) return null
  const amt = Number(line.amount ?? 0)
  if (!Number.isFinite(amt) || amt <= 0) return null
  return amt / heads
}

function FishBillLineDimensionRow({
  line,
  index,
  lineItem,
  fishLineAuto,
  speciesOptions,
  currencySymbol,
  onFieldChange,
}: {
  line: BillLineItem
  index: number
  lineItem: Item | undefined
  fishLineAuto: boolean
  speciesOptions: FishSpeciesOption[]
  currencySymbol: string
  onFieldChange: (index: number, field: string, value: unknown) => void
}) {
  const speciesValue = (line.aquaculture_fish_species || '').trim()
  const costPerHead = fishCostPerHead(line)
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-dashed border-gray-200 pt-2">
      <div className="w-[9rem] shrink-0">
        <label className="block text-xs font-medium text-gray-700 mb-1">Species *</label>
        <select
          value={speciesValue}
          onChange={(e) => onFieldChange(index, 'aquaculture_fish_species', e.target.value)}
          className="w-full px-2 py-1 text-sm border border-sky-300 rounded focus:ring-1 focus:ring-sky-500 bg-white"
          title="Fish species stocked on this line (fry/fingerling)"
        >
          <option value="">Select species…</option>
          {speciesOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
          {speciesValue !== '' && !speciesOptions.some((s) => s.id === speciesValue) ? (
            <option value={speciesValue}>{speciesValue}</option>
          ) : null}
        </select>
      </div>
      {speciesValue === 'other' ? (
        <div className="w-[10rem] shrink-0">
          <label className="block text-xs font-medium text-gray-700 mb-1">Species name *</label>
          <input
            type="text"
            value={line.aquaculture_fish_species_other || ''}
            onChange={(e) => onFieldChange(index, 'aquaculture_fish_species_other', e.target.value)}
            className="w-full px-2 py-1 text-sm border border-sky-300 rounded focus:ring-1 focus:ring-sky-500 bg-white"
            placeholder="e.g. Koi carp"
          />
        </div>
      ) : null}
      <div className="w-[7.5rem] shrink-0">
        <label className="block text-xs font-medium text-gray-700 mb-1">Line (pcs/kg)</label>
        <input
          type="text"
          readOnly
          value={formatFishLinePcsPerKg(lineItem)}
          title="From item catalog — Line (pieces per 1 kg)"
          className="w-full px-2 py-1 text-sm border border-gray-200 rounded bg-gray-50 text-gray-800 tabular-nums"
        />
      </div>
      <div className="w-[7.5rem] shrink-0">
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Total fish (heads){fishLineAuto ? ' *' : ''}
        </label>
        <input
          type="number"
          min={1}
          step={1}
          value={
            line.aquaculture_fish_count === undefined ||
            line.aquaculture_fish_count === null ||
            line.aquaculture_fish_count === ''
              ? ''
              : line.aquaculture_fish_count
          }
          onChange={(e) =>
            onFieldChange(index, 'aquaculture_fish_count', e.target.value === '' ? '' : e.target.value)
          }
          className={
            fishLineAuto
              ? 'w-full px-2 py-1 text-sm border border-sky-300 rounded focus:ring-1 focus:ring-sky-500 bg-white tabular-nums'
              : 'w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 bg-white'
          }
          placeholder="—"
          title={fishLineAuto ? 'Fry/fingerling count from the vendor invoice' : undefined}
        />
      </div>
      <div className="w-[7.5rem] shrink-0">
        <label className="block text-xs font-medium text-gray-700 mb-1">Weight (kg)</label>
        <input
          type={fishLineAuto ? 'text' : 'number'}
          readOnly={fishLineAuto}
          tabIndex={fishLineAuto ? -1 : undefined}
          min={fishLineAuto ? undefined : 0}
          step={fishLineAuto ? undefined : '0.0001'}
          value={
            line.aquaculture_fish_weight_kg === undefined ||
            line.aquaculture_fish_weight_kg === null ||
            line.aquaculture_fish_weight_kg === ''
              ? ''
              : line.aquaculture_fish_weight_kg
          }
          onChange={
            fishLineAuto
              ? undefined
              : (e) =>
                  onFieldChange(index, 'aquaculture_fish_weight_kg', e.target.value === '' ? '' : e.target.value)
          }
          className={
            fishLineAuto
              ? 'w-full px-2 py-1 text-sm border border-gray-200 rounded bg-gray-50 text-gray-800 tabular-nums cursor-default'
              : 'w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 bg-white'
          }
          placeholder="—"
          title={fishLineAuto ? 'Heads ÷ Line (pcs/kg); also used as billing Qty (kg)' : undefined}
        />
      </div>
      <div className="w-[8rem] shrink-0">
        <label className="block text-xs font-medium text-gray-700 mb-1">Cost / head</label>
        <input
          type="text"
          readOnly
          tabIndex={-1}
          value={costPerHead == null ? '—' : `${currencySymbol}${formatNumber(costPerHead, 4)}`}
          title="Auto: line Amount ÷ total fish (heads) — cost per fry/fingerling"
          className="w-full px-2 py-1 text-sm border border-gray-200 rounded bg-gray-50 text-gray-800 tabular-nums cursor-default"
        />
      </div>
      <p className="text-xs text-gray-500 flex-1 min-w-[12rem] pb-1">
        {fishLineAuto ? (
          <>
            Enter <strong>total fish (heads)</strong> and line <strong>Amount</strong> (vendor total).{' '}
            <strong>Qty (kg)</strong>, weight, and rate per kg fill from the item <strong>Line (pcs/kg)</strong>.
          </>
        ) : (
          <>
            Required for fish-type items: total weight (kg) and headcount. Set <strong>Line (pcs/kg)</strong> on the item
            catalog to enable auto-fill from heads and Amount.
          </>
        )}
      </p>
    </div>
  )
}

function parseFishHeadCount(line: BillLineItem): number {
  const c = line.aquaculture_fish_count
  if (c === undefined || c === '' || c === null) return 0
  const n = parseInt(String(c), 10)
  return Number.isInteger(n) && n > 0 ? n : 0
}

/** Fish fry lines with Line on item: user enters heads + Amount; kg and rate derive from pcs/kg. */
function applyFishBillLineAutoCalc(
  line: BillLineItem,
  item: Item | undefined,
  source: 'heads' | 'amount' | 'unit_cost'
): BillLineItem {
  const pcs = itemPiecesPerKg(item)
  if (!pcs) return line
  const next = { ...line }
  const heads = parseFishHeadCount(next)
  const amt = Number(next.amount ?? 0)

  if (source === 'heads' || source === 'amount') {
    if (heads > 0) {
      const w = roundFishWeightKg(heads / pcs)
      next.aquaculture_fish_weight_kg = w
      next.quantity = w
      next.aquaculture_fish_count = heads
      if (w > 0 && amt >= 0) {
        next.unit_cost = roundBillMoney(amt / w)
      }
    }
    return next
  }

  if (source === 'unit_cost') {
    const w = Number(next.quantity ?? 0)
    const uc = Number(next.unit_cost ?? 0)
    if (w > 0 && uc >= 0) {
      next.amount = billLineRowAmount(w, uc)
    }
    return next
  }

  return next
}

function applyItemSelectionToBillLine(
  line: BillLineItem,
  itemId: number,
  itemList: Item[],
  tankList: Tank[],
  vendorDefaultExpenseAccountId?: number | null,
  templateFallbackExpenseId?: number | null,
  defaultNursingPondId?: number | null
): BillLineItem {
  const item = itemList.find((i) => i.id === itemId)
  if (!item) return line
  const uc = Number(item.cost ?? 0) || 0
  const qty = Number(line.quantity ?? 0) || 1
  const itype = (item.item_type || '').toLowerCase()
  const receivesInventory = itype === 'inventory'
  let defaultExpense: number | undefined
  if (!receivesInventory) {
    if (item.expense_account_id != null && item.expense_account_id > 0) {
      defaultExpense = item.expense_account_id
    } else if (
      vendorDefaultExpenseAccountId != null &&
      vendorDefaultExpenseAccountId > 0
    ) {
      defaultExpense = vendorDefaultExpenseAccountId
    } else if (templateFallbackExpenseId != null && templateFallbackExpenseId > 0) {
      defaultExpense = templateFallbackExpenseId
    }
  }
  const next: BillLineItem = {
    ...line,
    item_id: itemId,
    expense_account_id: defaultExpense,
    tank_id: defaultTankIdForProduct(itemId, itemList, tankList),
    unit_cost: uc,
    description: item.name,
    amount: billLineRowAmount(qty, uc),
  }
  if (!isFishTypeItem(item)) {
    next.aquaculture_fish_weight_kg = undefined
    next.aquaculture_fish_count = undefined
    next.aquaculture_fish_species = undefined
    next.aquaculture_fish_species_other = undefined
    return next
  }
  // Fish items: default species to tilapia and suggest a nursing pond when none chosen yet.
  if (!(line.aquaculture_fish_species || '').trim()) {
    next.aquaculture_fish_species = 'tilapia'
  }
  if (
    (line.aquaculture_pond_id === '' || line.aquaculture_pond_id == null) &&
    defaultNursingPondId != null &&
    Number.isFinite(defaultNursingPondId)
  ) {
    next.aquaculture_pond_id = defaultNursingPondId
  }
  if (itemPiecesPerKg(item) && parseFishHeadCount(next) > 0) {
    return applyFishBillLineAutoCalc(next, item, 'heads')
  }
  return next
}

/** Effective line kind: explicit flag, else inferred from whether an inventory/catalog item is set. */
function billLineKind(line: BillLineItem): BillLineKind {
  if (line.line_kind === 'item' || line.line_kind === 'expense') return line.line_kind
  return line.item_id ? 'item' : 'expense'
}

function serializeBillLineForApi(line: BillLineItem, itemList: Item[]): Record<string, unknown> {
  const item = line.item_id ? itemList.find((i) => i.id === line.item_id) : undefined
  const fish = isFishTypeItem(item)
  const normalized = isFishBillLineAutoMode(line, itemList) ? line : syncStandardBillLineAmount(line)
  const w = normalized.aquaculture_fish_weight_kg
  const c = normalized.aquaculture_fish_count
  const weightPayload =
    !fish || w === undefined || w === '' || w === null
      ? null
      : Number(w)
  const countPayload =
    !fish || c === undefined || c === '' || c === null
      ? null
      : parseInt(String(c), 10)
  return {
    description: normalized.description || null,
    item_id: normalized.item_id || null,
    expense_account_id: normalized.expense_account_id || null,
    tank_id: normalized.tank_id || null,
    quantity: normalized.quantity,
    unit_cost: normalized.unit_cost,
    amount: normalized.amount,
    tax_amount: normalized.tax_amount || 0,
    ...(fish
      ? {
          aquaculture_fish_weight_kg:
            weightPayload != null && Number.isFinite(weightPayload) ? weightPayload : null,
          aquaculture_fish_count:
            countPayload != null && Number.isInteger(countPayload) ? countPayload : null,
          aquaculture_fish_species: (line.aquaculture_fish_species || '').trim() || null,
          aquaculture_fish_species_other:
            (line.aquaculture_fish_species || '').trim() === 'other'
              ? (line.aquaculture_fish_species_other || '').trim() || null
              : null,
        }
      : {}),
    aquaculture_pond_id: (() => {
      const r = line.aquaculture_pond_id
      if (r === '' || r == null) return null
      const n = Number(r)
      return Number.isFinite(n) ? n : null
    })(),
    aquaculture_production_cycle_id: (() => {
      const r = line.aquaculture_production_cycle_id
      if (r === '' || r == null) return null
      const n = Number(r)
      return Number.isFinite(n) ? n : null
    })(),
    aquaculture_cost_bucket: (line.aquaculture_cost_bucket || '').trim() || null,
    aquaculture_expense_category: (line.aquaculture_expense_category || '').trim() || null,
    fuel_station_expense_category: (line.fuel_station_expense_category || '').trim() || null,
    ...pondSharePayload(line),
    ...stationSharePayload(line),
  }
}

function BillPondAllocationFields({
  line,
  index,
  ponds,
  cycles,
  billExpenseCategories,
  expenseAccounts,
  onFieldChange,
  selectClassName = 'w-full min-w-0 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500',
  directOnly = false,
}: {
  line: BillLineItem
  index: number
  ponds: AquaculturePondOption[]
  cycles: ProductionCycleOption[]
  billExpenseCategories: AquacultureBillExpenseCategory[]
  expenseAccounts: ExpenseAccount[]
  onFieldChange: (index: number, field: string, value: unknown) => void
  selectClassName?: string
  /** Fish lines: one pond only (no shared split UI). */
  directOnly?: boolean
}) {
  const mode = directOnly ? 'direct' : billLinePondCostMode(line)
  const pondSel =
    line.aquaculture_pond_id === '' || line.aquaculture_pond_id == null
      ? ''
      : Number(line.aquaculture_pond_id)
  const cyclesForLine =
    pondSel === '' || !Number.isFinite(pondSel) ? [] : cycles.filter((c) => c.pond_id === pondSel)
  const sharedIds = line.shared_equal_pond_ids ?? []
  const manualShares = line.pond_shares ?? []
  const showCategory =
    !line.item_id &&
    (mode === 'direct' ? pondSel !== '' && Number.isFinite(pondSel) : true)

  const toggleSharedPond = (pid: number) => {
    const next = sharedIds.includes(pid) ? sharedIds.filter((x) => x !== pid) : [...sharedIds, pid]
    onFieldChange(index, 'shared_equal_pond_ids', next)
  }

  return (
    <div className="mt-2 space-y-2 border-t border-dashed border-teal-200 pt-2">
      {!directOnly ? (
      <fieldset className="w-full rounded-lg border border-teal-100 bg-teal-50/30 p-2 space-y-1">
        <legend className="px-1 text-xs font-medium uppercase tracking-wide text-teal-800">
          Pond cost allocation
        </legend>
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input
            type="radio"
            name={`pond_cost_mode_${index}`}
            checked={mode === 'direct'}
            onChange={() => onFieldChange(index, 'aquaculture_cost_mode', 'direct')}
          />
          Direct to one pond
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input
            type="radio"
            name={`pond_cost_mode_${index}`}
            checked={mode === 'shared_equal'}
            onChange={() => onFieldChange(index, 'aquaculture_cost_mode', 'shared_equal')}
          />
          Shared — equal split
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input
            type="radio"
            name={`pond_cost_mode_${index}`}
            checked={mode === 'shared_manual'}
            onChange={() => onFieldChange(index, 'aquaculture_cost_mode', 'shared_manual')}
          />
          Shared — manual amounts
        </label>
      </fieldset>
      ) : null}

      {mode === 'direct' ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[10rem] flex-1">
            <label className="block text-xs font-medium text-gray-700 mb-1">Pond (P&amp;L tag)</label>
            <select
              value={pondSel === '' ? '' : String(pondSel)}
              onChange={(e) => {
                const v = e.target.value
                onFieldChange(index, 'aquaculture_pond_id', v === '' ? '' : parseInt(v, 10))
              }}
              className={selectClassName}
            >
              <option value="">— Not tagged —</option>
              {ponds.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              {pondSel !== '' &&
                Number.isFinite(pondSel) &&
                !ponds.some((p) => p.id === pondSel) && (
                  <option value={String(pondSel)}>Pond #{pondSel}</option>
                )}
            </select>
          </div>
          {showCategory ? (
            <div className="min-w-[11rem] flex-1">
              <label className="block text-xs font-medium text-teal-900 mb-1">Pond expense category *</label>
              <select
                required
                value={line.aquaculture_expense_category || ''}
                onChange={(e) => onFieldChange(index, 'aquaculture_expense_category', e.target.value)}
                className="w-full min-w-0 px-2 py-1 text-sm border border-teal-300 rounded focus:ring-1 focus:ring-teal-500 bg-teal-50/40"
              >
                <option value="">Select category…</option>
                {billExpenseCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              {line.expense_account_id ? (
                <p className="mt-0.5 text-[11px] text-teal-800">
                  GL:{' '}
                  {formatCoaOptionLabel(
                    expenseAccounts.find((a) => a.id === line.expense_account_id) || {
                      id: 0,
                      account_code: '',
                      account_name: '—',
                      account_type: 'expense',
                    }
                  )}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="min-w-[10rem] flex-1">
            <label className="block text-xs font-medium text-gray-700 mb-1">Production cycle (optional)</label>
            <select
              disabled={pondSel === '' || !Number.isFinite(pondSel)}
              value={
                line.aquaculture_production_cycle_id === '' ||
                line.aquaculture_production_cycle_id == null
                  ? ''
                  : String(line.aquaculture_production_cycle_id)
              }
              onChange={(e) => {
                const v = e.target.value
                onFieldChange(
                  index,
                  'aquaculture_production_cycle_id',
                  v === '' ? '' : parseInt(v, 10)
                )
              }}
              className={`${selectClassName} disabled:bg-gray-100 disabled:text-gray-500`}
            >
              <option value="">— Any / not set —</option>
              {cyclesForLine.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : mode === 'shared_equal' ? (
        <div className="rounded-lg border border-teal-100 bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-teal-900">
              Select at least two ponds (equal split of line amount). Use for shared feed, medicine, or utilities
              charged on one bill.
            </p>
            <button
              type="button"
              className="text-xs font-medium text-teal-700 hover:text-teal-900 underline"
              onClick={() =>
                onFieldChange(
                  index,
                  'shared_equal_pond_ids',
                  ponds.map((p) => p.id)
                )
              }
            >
              All active ponds
            </button>
          </div>
          <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto">
            {ponds.map((p) => (
              <li key={p.id}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="rounded border-gray-300"
                    checked={sharedIds.includes(p.id)}
                    onChange={() => toggleSharedPond(p.id)}
                  />
                  {p.name}
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="space-y-2 rounded-lg border border-teal-100 bg-white p-3">
          <p className="text-xs text-gray-600">
            Each row: pond and amount (≥2 rows; amounts must sum to the line amount)
          </p>
          {manualShares.map((row, sidx) => (
            <div key={sidx} className="flex flex-wrap gap-2 items-center">
              <select
                className="min-w-[8rem] flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                value={row.pond_id === '' ? '' : String(row.pond_id)}
                onChange={(e) => {
                  const next = [...manualShares]
                  next[sidx] = {
                    ...next[sidx],
                    pond_id: e.target.value === '' ? '' : parseInt(e.target.value, 10),
                  }
                  onFieldChange(index, 'pond_shares', next)
                }}
              >
                <option value="">Pond</option>
                {ponds.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Amount"
                className="w-28 rounded border border-gray-300 px-2 py-1 text-sm tabular-nums"
                value={row.amount === 0 ? '' : row.amount}
                onChange={(e) => {
                  const next = [...manualShares]
                  next[sidx] = { ...next[sidx], amount: parseFloat(e.target.value) || 0 }
                  onFieldChange(index, 'pond_shares', next)
                }}
              />
              {manualShares.length > 2 ? (
                <button
                  type="button"
                  className="text-xs text-red-600 hover:underline"
                  onClick={() => {
                    const next = manualShares.filter((_, i) => i !== sidx)
                    onFieldChange(index, 'pond_shares', next)
                  }}
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            className="text-xs font-medium text-teal-700 hover:underline"
            onClick={() =>
              onFieldChange(index, 'pond_shares', [...manualShares, { pond_id: '', amount: 0 }])
            }
          >
            + Add pond row
          </button>
        </div>
      )}

      {showCategory && mode !== 'direct' ? (
        <div className="min-w-[11rem] max-w-md">
          <label className="block text-xs font-medium text-teal-900 mb-1">Pond expense category *</label>
          <select
            required
            value={line.aquaculture_expense_category || ''}
            onChange={(e) => onFieldChange(index, 'aquaculture_expense_category', e.target.value)}
            className="w-full min-w-0 px-2 py-1 text-sm border border-teal-300 rounded focus:ring-1 focus:ring-teal-500 bg-teal-50/40"
          >
            <option value="">Select category…</option>
            {billExpenseCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <p className="text-xs text-gray-500 pb-1">
        {mode === 'direct'
          ? 'Tags P&L to one pond when the bill posts. For fish-type SKUs use kg and headcount on one pond.'
          : 'On save, this line expands to one bill line per pond with the split amounts (lease, shared electricity, etc.).'}
      </p>
    </div>
  )
}

interface Tank {
  id: number
  tank_number: string
  tank_name: string
  product_id: number
  capacity: number
  current_stock: number
  station_name?: string
  unit_of_measure?: string
}

function parseQtyLoose(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

interface TankIssueRow {
  tankId: number
  tankName: string
  unit: string
  capacity: number
  currentStock: number
  remainingUllage: number
  receiptQty: number
  projected: number
  overBy: number
}

interface CatalogLineRow {
  itemName: string
  billQty: number
  quantityOnHand: number | null
  unit: string
}

/** Resolve receiving tank for a bill line (matches backend routing). */
function resolveLineTank(
  line: BillLineItem,
  itemList: Item[],
  tankList: Tank[]
): Tank | undefined {
  if (!line.item_id) return undefined
  const itemTanks = tankList.filter(t => t.product_id === line.item_id)
  if (itemTanks.length === 0) return undefined
  if (line.tank_id) {
    const byId = itemTanks.find(t => t.id === line.tank_id)
    if (byId) return byId
  }
  const defId = defaultTankIdForProduct(line.item_id, itemList, tankList)
  if (defId) {
    const t = itemTanks.find(x => x.id === defId)
    if (t) return t
  }
  return itemTanks.slice().sort((a, b) => a.tank_name.localeCompare(b.tank_name))[0]
}

/**
 * When fuel receipt would exceed tank capacity, return rows for the warning modal.
 * Only lines that map to a tank with capacity > 0 are considered.
 */
function buildTankOverfillReview(
  lines: BillLineItem[],
  itemList: Item[],
  tankList: Tank[]
): { tankIssues: TankIssueRow[]; catalogLines: CatalogLineRow[] } | null {
  const totals = new Map<number, number>()
  for (const line of lines) {
    const tank = resolveLineTank(line, itemList, tankList)
    if (!tank) continue
    const cap = parseQtyLoose(tank.capacity)
    if (!(cap > 0)) continue
    const q = parseQtyLoose(line.quantity)
    if (q <= 0) continue
    totals.set(tank.id, (totals.get(tank.id) || 0) + q)
  }
  const tankIssues: TankIssueRow[] = []
  for (const [tankId, receiptQty] of totals) {
    const t = tankList.find(x => x.id === tankId)
    if (!t) continue
    const cap = parseQtyLoose(t.capacity)
    const cur = parseQtyLoose(t.current_stock)
    const projected = cur + receiptQty
    if (projected <= cap) continue
    const u = (t.unit_of_measure || 'L').trim() || 'L'
    const rem = Math.max(0, cap - cur)
    tankIssues.push({
      tankId,
      tankName: t.tank_name || t.tank_number || `Tank #${tankId}`,
      unit: u,
      capacity: cap,
      currentStock: cur,
      remainingUllage: rem,
      receiptQty,
      projected,
      overBy: projected - cap,
    })
  }
  if (tankIssues.length === 0) return null
  const catalogLines: CatalogLineRow[] = []
  for (const line of lines) {
    if (!line.item_id) continue
    const it = itemList.find(i => i.id === line.item_id)
    if (!it) continue
    const qohRaw = it.quantity_on_hand
    const qoh =
      qohRaw === undefined || qohRaw === null || qohRaw === ''
        ? null
        : parseQtyLoose(qohRaw)
    catalogLines.push({
      itemName: it.name,
      billQty: parseQtyLoose(line.quantity),
      quantityOnHand: qoh,
      unit: (it.unit || 'units').trim() || 'units',
    })
  }
  return { tankIssues, catalogLines }
}

interface ExpenseAccount {
  id: number
  account_code: string
  account_name: string
  account_type: string
  account_sub_type?: string
}

function newAquacultureBillLine(
  pondId: number | '',
  categoryId: string,
  billCats: AquacultureBillExpenseCategory[]
): BillLineItem {
  const base: BillLineItem = {
    line_number: 1,
    description: '',
    quantity: 1,
    unit_cost: 0,
    amount: 0,
    tax_amount: 0,
    aquaculture_pond_id: pondId,
    aquaculture_production_cycle_id: '',
    aquaculture_expense_category: categoryId,
  }
  return applyAquacultureCategoryToBillLine(base, findBillCategory(billCats, categoryId))
}

export default function BillsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const [bills, setBills] = useState<Bill[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [expenseAccounts, setExpenseAccounts] = useState<ExpenseAccount[]>([])
  const [coaForItemHints, setCoaForItemHints] = useState<CoaPickForItemDefault[]>([])
  const [tanks, setTanks] = useState<Tank[]>([])  // All tanks for the company
  const [loading, setLoading] = useState(true)
  const [referenceLoading, setReferenceLoading] = useState(false)
  const referenceReadyRef = useRef(false)
  const [listPage, setListPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [billsTotal, setBillsTotal] = useState(0)
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [showModal, setShowModal] = useState(false)
  const [approveBill, setApproveBill] = useState(false)
  const [postDraftBillOnUpdate, setPostDraftBillOnUpdate] = useState(false)
  const [showViewModal, setShowViewModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingBill, setEditingBill] = useState<Bill | null>(null)
  const [viewingBill, setViewingBill] = useState<Bill | null>(null)
  /** Tank capacity / stock review before save (warning only; posting may send acknowledge_tank_overfill). */
  const [stockReviewOpen, setStockReviewOpen] = useState(false)
  const [stockReviewPayload, setStockReviewPayload] = useState<{
    mode: 'create' | 'edit'
    tankIssues: TankIssueRow[]
    catalogLines: CatalogLineRow[]
    needsServerAck: boolean
    draftNote: boolean
  } | null>(null)
  const [currencySymbol, setCurrencySymbol] = useState<string>('৳') // Default to BDT
  const [stations, setStations] = useState<Station[]>([])
  const [aquaculturePonds, setAquaculturePonds] = useState<AquaculturePondOption[]>([])
  const [fishSpeciesOptions, setFishSpeciesOptions] = useState<FishSpeciesOption[]>([])
  // First nursing pond — suggested as the default destination for fry/fingerling purchases.
  const firstNursingPondId = useMemo<number | null>(() => {
    const np = aquaculturePonds.find((p) => (p.pond_role || '').toLowerCase() === 'nursing')
    return np ? np.id : null
  }, [aquaculturePonds])
  // Pond options with a "(nursing)" hint so fish purchases can be steered to nursing ponds.
  const pondOptionsForFish = useMemo<AquaculturePondOption[]>(
    () =>
      aquaculturePonds.map((p) =>
        (p.pond_role || '').toLowerCase() === 'nursing'
          ? { ...p, name: `${p.name} (nursing)` }
          : p,
      ),
    [aquaculturePonds],
  )
  const [productionCycles, setProductionCycles] = useState<ProductionCycleOption[]>([])
  const [aquacultureBillCategories, setAquacultureBillCategories] = useState<
    AquacultureBillExpenseCategory[]
  >([])
  const [fuelStationBillCategories, setFuelStationBillCategories] = useState<
    FuelStationBillExpenseCategory[]
  >([])
  const [formData, setFormData] = useState(() => {
    const billDate = new Date().toISOString().split('T')[0]
    const due = new Date(`${billDate}T12:00:00`)
    due.setDate(due.getDate() + 30)
    return {
      vendor_id: 0,
      bill_date: billDate,
      due_date: due.toISOString().split('T')[0],
      vendor_reference: '',
      memo: '',
      receipt_location_key: '' as string,
      bill_purpose: 'station' as BillPurpose,
      lines: [] as BillLineItem[],
    }
  })

  const resolvedVendorDefaultExpenseId = useMemo(() => {
    const vid = formData.vendor_id
    if (!vid) return undefined
    const x = vendors.find((v) => v.id === vid)?.default_expense_account_id
    return x != null && x > 0 ? x : undefined
  }, [formData.vendor_id, vendors])

  const templateBillExpenseAccountId = useMemo(() => {
    return suggestedBillLineExpenseAccountId({
      vendorDefaultExpenseId: resolvedVendorDefaultExpenseId,
      options: expenseAccounts.map((a) => ({
        id: a.id,
        account_code: a.account_code,
      })),
    })
  }, [resolvedVendorDefaultExpenseId, expenseAccounts])

  const billLineExpenseTouchedRef = useRef(new Set<number>())

  const selectedVendorReceivingHint = useMemo(() => {
    if (!formData.vendor_id) return null
    const v = vendors.find((x) => x.id === formData.vendor_id)
    return v ? vendorUsualReceivingSummary(v) : null
  }, [formData.vendor_id, vendors])

  const handleFormVendorChange = (rawVendorId: string) => {
    const vendor_id = parseInt(rawVendorId, 10) || 0
    if (!vendor_id) {
      setFormData((prev) => ({ ...prev, vendor_id: 0, receipt_location_key: '' }))
      return
    }
    const vendor = vendors.find((v) => v.id === vendor_id)
    const receipt_location_key = resolveReceiptLocationKeyForVendor(vendor, stations, aquaculturePonds)
    const resolved = resolveBillReceiptLocation(receipt_location_key, stations, aquaculturePonds)
    const coaOpts = expenseAccounts.map((a) => ({ id: a.id, account_code: a.account_code }))
    const vendorExpense = suggestedBillLineExpenseAccountId({
      vendorDefaultExpenseId: vendor?.default_expense_account_id,
      options: coaOpts,
    })
    setFormData((prev) => {
      const isFishLine = (line: BillLineItem) => {
        if (!line.item_id) return false
        return (items.find((i) => i.id === line.item_id)?.pos_category || '').toLowerCase() === 'fish'
      }
      let lines = prev.lines.map((line) => {
        if (billLineExpenseTouchedRef.current.has(line.line_number)) return line
        if (line.expense_account_id || line.item_id || billLineKind(line) === 'item') return line
        if (!vendorExpense) return line
        return { ...line, expense_account_id: vendorExpense }
      })
      if (resolved.headerPondId) {
        lines = applyHeaderPondToBillLines(lines, resolved.headerPondId, isFishLine)
      }
      return {
        ...prev,
        vendor_id,
        receipt_location_key,
        bill_purpose: receipt_location_key ? resolved.billPurpose : prev.bill_purpose,
        lines,
      }
    })
  }

  const handleReceiptLocationChange = (key: string) => {
    const resolved = resolveBillReceiptLocation(key, stations, aquaculturePonds)
    setFormData((prev) => {
      const isFishLine = (line: BillLineItem) => {
        if (!line.item_id) return false
        return (items.find((i) => i.id === line.item_id)?.pos_category || '').toLowerCase() === 'fish'
      }
      let lines = prev.lines
      if (resolved.headerPondId) {
        lines = applyHeaderPondToBillLines(lines, resolved.headerPondId, isFishLine)
      } else if (resolved.billPurpose === 'station' && key) {
        lines = clearPondTagsFromNonFishLines(lines, isFishLine)
      }
      return {
        ...prev,
        receipt_location_key: key,
        bill_purpose: key ? resolved.billPurpose : prev.bill_purpose,
        lines,
      }
    })
  }

  const handleBillPurposeChange = (bill_purpose: BillPurpose) => {
    setFormData((prev) => ({
      ...prev,
      bill_purpose,
      receipt_location_key: bill_purpose === 'office' ? '' : prev.receipt_location_key,
    }))
  }

  const resolveFormReceiptPayload = () => {
    if (formData.bill_purpose === 'office') {
      return { receiptStationId: null as number | null, billPurpose: 'office' as BillPurpose }
    }
    const resolved = resolveBillReceiptLocation(formData.receipt_location_key, stations, aquaculturePonds)
    return {
      receiptStationId: resolved.receiptStationId,
      billPurpose: formData.receipt_location_key ? resolved.billPurpose : formData.bill_purpose,
    }
  }

  const billExpenseCategories = useMemo(
    () => billExpenseCategoriesFromApi(aquacultureBillCategories),
    [aquacultureBillCategories]
  )

  const billFuelCategories = useMemo(
    () => billFuelCategoriesFromApi(fuelStationBillCategories),
    [fuelStationBillCategories]
  )

  const aquacultureCoaAccounts = useMemo(
    () => expenseAccounts.filter((a) => isAquacultureOperatingCoaCode(a.account_code)),
    [expenseAccounts]
  )

  const billLineExpenseRecommendLabel = useMemo(() => {
    const code =
      expenseAccounts.find((a) => a.id === templateBillExpenseAccountId)?.account_code || COA_OFFICE_EXP
    return templateCoaOptionLabel(code, expenseAccounts)
  }, [expenseAccounts, templateBillExpenseAccountId])

  /** Active suggest: pre-fill expense on empty bill lines (create + edit). */
  useEffect(() => {
    if ((!showModal && !showEditModal) || expenseAccounts.length === 0) return
    const fallback = templateBillExpenseAccountId
    if (!fallback) return
    setFormData((prev) => {
      let changed = false
      const lines = prev.lines.map((line) => {
        if (billLineExpenseTouchedRef.current.has(line.line_number)) return line
        if (line.expense_account_id || line.item_id || billLineKind(line) === 'item') return line
        changed = true
        return { ...line, expense_account_id: fallback }
      })
      return changed ? { ...prev, lines } : prev
    })
  }, [
    showModal,
    showEditModal,
    expenseAccounts.length,
    templateBillExpenseAccountId,
    formData.lines.length,
  ])

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
  }, [router])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm), 350)
    return () => clearTimeout(t)
  }, [searchTerm])

  useEffect(() => {
    setListPage(1)
  }, [debouncedSearch, pageSize, statusFilter])

  const loadBills = useCallback(async () => {
    setLoading(true)
    try {
      const params = offsetListParams({
        page: listPage,
        pageSize,
        q: debouncedSearch,
        extra: statusFilter ? { status_filter: statusFilter } : {},
      })
      const billsRes = await api.get('/bills/', { params })
      const data = billsRes.data
      if (isOffsetPagedPayload(data)) {
        setBills(data.results as Bill[])
        setBillsTotal(data.count)
        const totalPages = Math.max(1, Math.ceil(data.count / pageSize))
        if (listPage > totalPages) {
          setListPage(totalPages)
        }
      } else {
        console.error('Failed to load bills: unexpected format', data)
        toast.error('Failed to load bills')
        setBills([])
        setBillsTotal(0)
      }
    } catch (e) {
      console.error('Failed to load bills:', e)
      toast.error('Failed to load bills')
      setBills([])
      setBillsTotal(0)
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, listPage, pageSize, statusFilter, toast])

  const loadCompanyCurrency = useCallback(async () => {
    try {
      const companyRes = await api.get('/companies/current', { timeout: 8000 })
      if (companyRes.data?.currency) {
        setCurrencySymbol(getCurrencySymbol(companyRes.data.currency))
      }
    } catch (error) {
      console.error('Error fetching company currency:', error)
    }
  }, [])

  const loadBillReferenceData = useCallback(async () => {
    try {
      const [vendorsRes, itemsRes, accountsRes, tanksRes, stationsRes] = await Promise.allSettled([
        api.get('/vendors/', { params: { skip: 0, limit: REFERENCE_FETCH_LIMIT } }),
        api.get('/items/', { params: { skip: 0, limit: REFERENCE_FETCH_LIMIT } }),
        api.get('/chart-of-accounts/'),
        api.get('/tanks/'),
        api.get('/stations/'),
      ])

      if (vendorsRes.status === 'fulfilled') {
        const vendorsData = vendorsRes.value.data
        const raw = Array.isArray(vendorsData) ? vendorsData : []
        const activeVendors = raw.filter((v: Vendor) => v.is_active)
        setVendors(activeVendors)
      } else {
        console.error('❌ Failed to load vendors:', vendorsRes)
        toast.error('Failed to load vendors')
      }

      if (itemsRes.status === 'fulfilled') {
        try {
          const itemsData = itemsRes.value?.data || []
          if (Array.isArray(itemsData)) {
            setItems(itemsData)
          } else {
            console.error('❌ Items data is not an array:', itemsData)
            toast.error('Items data format error')
          }
        } catch (err: unknown) {
          console.error('❌ Error processing items:', err)
          console.error('❌ Items response:', itemsRes.value)
          toast.error('Failed to process items data')
        }
      } else {
        console.error('❌ Failed to load items:', itemsRes.reason)
        const reason = itemsRes.reason as { response?: { data?: { detail?: string } }; message?: string }
        const errorMsg = reason?.response?.data?.detail || reason?.message || 'Unknown error'
        console.error('❌ Items API error details:', errorMsg)
        toast.error(`Failed to load items: ${errorMsg}`)
      }

      if (accountsRes.status === 'fulfilled') {
        const accountsData = Array.isArray(accountsRes.value.data) ? accountsRes.value.data : []
        const active = accountsData.filter(
          (acc: { is_active?: boolean }) => acc.is_active !== false
        )
        setCoaForItemHints(
          active.map(
            (acc: {
              id: number
              account_code?: string
              account_name?: string
            }): CoaPickForItemDefault => ({
              id: acc.id,
              account_code: String(acc.account_code || ''),
              account_name: String(acc.account_name || ''),
            })
          )
        )
        setExpenseAccounts(
          active.filter((acc: ExpenseAccount) => acc.account_type.toLowerCase() === 'expense'),
        )
      }

      if (tanksRes.status === 'fulfilled') {
        const tanksData = tanksRes.value.data
        setTanks(Array.isArray(tanksData) ? tanksData : [])
      } else {
        console.error('❌ Failed to load tanks:', tanksRes)
        setTanks([])
        toast.error(
          'Could not load tanks. Fuel bills need tanks to receive stock — refresh the page or check the Tanks API.',
        )
      }

      if (stationsRes.status === 'fulfilled') {
        const raw = Array.isArray(stationsRes.value.data) ? stationsRes.value.data : []
        setStations(
          raw
            .map(
              (s: {
                id?: unknown
                station_name?: string
                station_number?: string
                default_aquaculture_pond_id?: unknown
                operates_fuel_retail?: unknown
                is_active?: unknown
              }) => ({
                id: typeof s.id === 'number' ? s.id : Number(s.id),
                station_name: String(s.station_name || '').trim() || 'Station',
                station_number: s.station_number != null ? String(s.station_number) : undefined,
                default_aquaculture_pond_id:
                  s.default_aquaculture_pond_id != null && s.default_aquaculture_pond_id !== ''
                    ? Number(s.default_aquaculture_pond_id)
                    : null,
                operates_fuel_retail: s.operates_fuel_retail !== false,
                is_active: s.is_active !== false,
              }),
            )
            .filter((s: Station) => Number.isFinite(s.id)),
        )
      } else {
        setStations([])
      }

      const [pondsRes, cyclesRes, aqCatRes, fsCatRes, speciesRes] = await Promise.allSettled([
        api.get('/aquaculture/ponds/'),
        api.get('/aquaculture/production-cycles/'),
        api.get('/aquaculture/expense-categories/'),
        api.get('/fuel-station/expense-categories/'),
        api.get('/aquaculture/fish-species/'),
      ])
      if (pondsRes.status === 'fulfilled' && Array.isArray(pondsRes.value.data)) {
        setAquaculturePonds(
          pondsRes.value.data
            .map((p: { id?: unknown; name?: unknown; pond_role?: unknown; is_active?: unknown }) => ({
              id: typeof p.id === 'number' ? p.id : Number(p.id),
              name: String(p.name || '').trim() || `Pond ${p.id}`,
              pond_role: String(p.pond_role || '').trim(),
              is_active: p.is_active !== false,
            }))
            .filter((p: AquaculturePondOption) => Number.isFinite(p.id)),
        )
      } else {
        setAquaculturePonds([])
      }
      if (speciesRes.status === 'fulfilled' && Array.isArray(speciesRes.value.data)) {
        setFishSpeciesOptions(
          speciesRes.value.data
            .map((s: { id?: unknown; label?: unknown }) => ({
              id: String(s.id || '').trim(),
              label: String(s.label || '').trim() || String(s.id || '').trim(),
            }))
            .filter((s: FishSpeciesOption) => s.id !== '' && s.id !== 'not_applicable'),
        )
      } else {
        setFishSpeciesOptions([])
      }
      if (cyclesRes.status === 'fulfilled' && Array.isArray(cyclesRes.value.data)) {
        setProductionCycles(
          cyclesRes.value.data
            .map((c: { id?: unknown; pond_id?: unknown; name?: unknown }) => ({
              id: typeof c.id === 'number' ? c.id : Number(c.id),
              pond_id: typeof c.pond_id === 'number' ? c.pond_id : Number(c.pond_id),
              name: String(c.name || '').trim() || `Cycle ${c.id}`,
            }))
            .filter((c: ProductionCycleOption) => Number.isFinite(c.id) && Number.isFinite(c.pond_id)),
        )
      } else {
        setProductionCycles([])
      }
      if (aqCatRes.status === 'fulfilled' && Array.isArray(aqCatRes.value.data)) {
        setAquacultureBillCategories(aqCatRes.value.data as AquacultureBillExpenseCategory[])
      } else {
        setAquacultureBillCategories([])
      }
      if (fsCatRes.status === 'fulfilled' && Array.isArray(fsCatRes.value.data)) {
        setFuelStationBillCategories(fsCatRes.value.data as FuelStationBillExpenseCategory[])
      } else {
        setFuelStationBillCategories([])
      }
      referenceReadyRef.current = true
    } catch (error) {
      console.error('Error fetching reference data:', error)
      toast.error('Error connecting to server')
    }
  }, [toast])

  const ensureBillReferenceData = useCallback(async () => {
    if (referenceReadyRef.current) return
    setReferenceLoading(true)
    try {
      await loadBillReferenceData()
    } finally {
      setReferenceLoading(false)
    }
  }, [loadBillReferenceData])

  const refreshAll = useCallback(async () => {
    setLoading(true)
    referenceReadyRef.current = false
    try {
      await Promise.all([loadCompanyCurrency(), loadBillReferenceData()])
      await loadBills()
    } finally {
      setLoading(false)
    }
  }, [loadCompanyCurrency, loadBillReferenceData, loadBills])

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) return
    void loadCompanyCurrency()
  }, [router, loadCompanyCurrency])

  useEffect(() => {
    if (!showModal && !showEditModal) return
    void ensureBillReferenceData()
  }, [showModal, showEditModal, ensureBillReferenceData])

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) return
    void loadBills()
  }, [loadBills])

  const openedBillFromUrl = useRef(false)
  useEffect(() => {
    if (openedBillFromUrl.current) return
    const wantNew = searchParams.get('new')
    const pondRaw = searchParams.get('pond_id')
    if (wantNew !== '1' && wantNew !== 'true' && !pondRaw) return

    void (async () => {
      await ensureBillReferenceData()
      if (openedBillFromUrl.current) return
      openedBillFromUrl.current = true
      const pondId = pondRaw && /^\d+$/.test(pondRaw.trim()) ? parseInt(pondRaw.trim(), 10) : ''
      const catRaw = searchParams.get('expense_category') || 'other'
      const catId = findBillCategory(billExpenseCategories, catRaw)?.id || ''
      const billDate = new Date().toISOString().split('T')[0]
      const due = new Date(`${billDate}T12:00:00`)
      due.setDate(due.getDate() + 30)
      setFormData({
        vendor_id: 0,
        bill_date: billDate,
        due_date: due.toISOString().split('T')[0],
        vendor_reference: '',
        memo: pondId !== '' ? 'Pond operating expense' : '',
        receipt_location_key: pondId !== '' ? formatPondScopeKey(pondId) : '',
        bill_purpose: pondId !== '' ? ('pond' as BillPurpose) : ('station' as BillPurpose),
        lines:
          pondId !== '' && catId
            ? [{ ...newAquacultureBillLine(pondId, catId, billExpenseCategories), line_number: 1 }]
            : [],
      })
      setApproveBill(false)
      setShowModal(true)
    })()
  }, [searchParams, billExpenseCategories, ensureBillReferenceData])

  const calculateTotals = (lines: BillLineItem[] = formData.lines) => {
    const subtotal = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0)
    const taxAmount = lines.reduce((sum, line) => sum + (Number(line.tax_amount) || 0), 0)
    const total = subtotal + taxAmount
    return { subtotal, taxAmount, total }
  }

  const addBillLine = (kind: BillLineKind) => {
    setFormData((prev) => {
      const lineNumber = prev.lines.length + 1
      let newLine: BillLineItem
      if (kind === 'expense') {
        const headerPond = headerPondIdFromLocationKey(prev.receipt_location_key)
        const rawPond = searchParams.get('pond_id')
        const rawCat = searchParams.get('expense_category') || 'other'
        const pondPrefill: number | '' =
          headerPond != null && headerPond > 0
            ? headerPond
            : rawPond && /^\d+$/.test(rawPond.trim())
              ? parseInt(rawPond.trim(), 10)
              : ''
        const catPrefill = findBillCategory(billExpenseCategories, rawCat)?.id || ''
        if (pondPrefill !== '' && catPrefill) {
          newLine = {
            ...newAquacultureBillLine(pondPrefill, catPrefill, billExpenseCategories),
            line_number: lineNumber,
            line_kind: 'expense',
          }
        } else {
          newLine = {
            line_number: lineNumber,
            line_kind: 'expense',
            description: '',
            item_id: undefined,
            expense_account_id: templateBillExpenseAccountId || undefined,
            tank_id: undefined,
            quantity: 1,
            unit_cost: 0,
            amount: 0,
            tax_amount: 0,
            aquaculture_fish_weight_kg: undefined,
            aquaculture_fish_count: undefined,
            aquaculture_pond_id: pondPrefill,
            aquaculture_production_cycle_id: '',
            aquaculture_expense_category: catPrefill || undefined,
          }
        }
      } else {
        const headerPond = headerPondIdFromLocationKey(prev.receipt_location_key)
        newLine = {
          line_number: lineNumber,
          line_kind: 'item',
          description: '',
          item_id: undefined,
          expense_account_id: undefined,
          tank_id: undefined,
          quantity: 1,
          unit_cost: 0,
          amount: 0,
          tax_amount: 0,
          aquaculture_fish_weight_kg: undefined,
          aquaculture_fish_count: undefined,
          aquaculture_pond_id: headerPond ?? '',
          aquaculture_production_cycle_id: '',
        }
      }
      return { ...prev, lines: [...prev.lines, newLine] }
    })
  }

  const handleRemoveLine = (index: number) => {
    const newLines = formData.lines.filter((_, i) => i !== index)
      .map((line, i) => ({ ...line, line_number: i + 1 }))
    setFormData({ ...formData, lines: newLines })
  }

  const applyBillLinePickerSelection = (
    index: number,
    pick: { kind: 'item'; id: number } | { kind: 'account'; id: number }
  ) => {
    setFormData((prev) => {
      const newLines = [...prev.lines]
      if (pick.kind === 'item') {
        newLines[index] = {
          ...applyItemSelectionToBillLine(
            newLines[index],
            pick.id,
            items,
            tanks,
            resolvedVendorDefaultExpenseId,
            templateBillExpenseAccountId || undefined,
            firstNursingPondId
          ),
          line_kind: 'item',
        }
        if (!isFishBillLineAutoMode(newLines[index], items)) {
          newLines[index] = syncStandardBillLineAmount(newLines[index])
        }
      } else {
        billLineExpenseTouchedRef.current.add(newLines[index].line_number)
        const account = expenseAccounts.find((a) => a.id === pick.id)
        newLines[index] = {
          ...newLines[index],
          line_kind: 'expense',
          expense_account_id: pick.id,
          item_id: undefined,
          tank_id: undefined,
          aquaculture_fish_weight_kg: undefined,
          aquaculture_fish_count: undefined,
          aquaculture_fish_species: undefined,
          aquaculture_fish_species_other: undefined,
          description: account?.account_name || '',
        }
      }
      return { ...prev, lines: newLines }
    })
  }

  const setBillLineKind = (index: number, kind: BillLineKind) => {
    setFormData((prev) => {
      const newLines = [...prev.lines]
      const cur = newLines[index]
      if (billLineKind(cur) === kind) return prev
      if (kind === 'expense') {
        newLines[index] = {
          ...cur,
          line_kind: 'expense',
          item_id: undefined,
          tank_id: undefined,
          tank_name: null,
          aquaculture_fish_weight_kg: undefined,
          aquaculture_fish_count: undefined,
          aquaculture_fish_species: undefined,
          aquaculture_fish_species_other: undefined,
        }
      } else {
        newLines[index] = {
          ...cur,
          line_kind: 'item',
          expense_account_id: undefined,
        }
      }
      return { ...prev, lines: newLines }
    })
  }

  const handleLineChange = (index: number, field: string, value: any) => {
    setFormData((prev) => {
      const newLines = [...prev.lines]

      if (field === 'aquaculture_cost_mode') {
        const mode = value as 'direct' | 'shared_equal' | 'shared_manual'
        const cur = newLines[index]
        newLines[index] = {
          ...cur,
          aquaculture_cost_mode: mode,
          aquaculture_pond_id: mode === 'direct' ? cur.aquaculture_pond_id ?? '' : '',
          aquaculture_production_cycle_id:
            mode === 'direct' ? cur.aquaculture_production_cycle_id ?? '' : '',
          shared_equal_pond_ids: mode === 'shared_equal' ? cur.shared_equal_pond_ids ?? [] : undefined,
          pond_shares:
            mode === 'shared_manual'
              ? cur.pond_shares?.length
                ? cur.pond_shares
                : [
                    { pond_id: '', amount: 0 },
                    { pond_id: '', amount: 0 },
                  ]
              : undefined,
        }
        return { ...prev, lines: newLines }
      }

      if (field === 'station_cost_mode') {
        const mode = value as 'direct' | 'shared_equal' | 'shared_manual'
        const cur = newLines[index]
        newLines[index] = {
          ...cur,
          station_cost_mode: mode,
          line_receipt_station_id: mode === 'direct' ? cur.line_receipt_station_id ?? '' : '',
          shared_equal_station_ids: mode === 'shared_equal' ? cur.shared_equal_station_ids ?? [] : undefined,
          station_shares:
            mode === 'shared_manual'
              ? cur.station_shares?.length
                ? cur.station_shares
                : [
                    { station_id: '', amount: 0 },
                    { station_id: '', amount: 0 },
                  ]
              : undefined,
        }
        return { ...prev, lines: newLines }
      }

      if (field === 'aquaculture_pond_id') {
        const pid = value === '' || value === undefined ? '' : parseInt(String(value), 10)
        const cleanPond = pid === '' || !Number.isFinite(pid) ? '' : pid
        newLines[index] = { ...newLines[index], aquaculture_pond_id: cleanPond }
        if (cleanPond === '') {
          newLines[index].aquaculture_expense_category = undefined
          newLines[index].aquaculture_cost_bucket = undefined
        } else {
          newLines[index].fuel_station_expense_category = undefined
        }
        const cycRaw = newLines[index].aquaculture_production_cycle_id
        if (cycRaw !== '' && cycRaw != null) {
          const cid = parseInt(String(cycRaw), 10)
          if (Number.isFinite(cid)) {
            const cRow = productionCycles.find((c) => c.id === cid)
            if (!cRow || cleanPond === '' || cRow.pond_id !== Number(cleanPond)) {
              newLines[index].aquaculture_production_cycle_id = ''
            }
          }
        }
        return { ...prev, lines: newLines }
      }

      if (field === 'aquaculture_expense_category') {
        const cat = findBillCategory(billExpenseCategories, String(value))
        newLines[index] = applyAquacultureCategoryToBillLine(newLines[index], cat)
        return { ...prev, lines: newLines }
      }

      if (field === 'fuel_station_expense_category') {
        const cat = findFuelBillCategory(billFuelCategories, String(value))
        newLines[index] = applyFuelCategoryToBillLine(newLines[index], cat)
        return { ...prev, lines: newLines }
      }

      newLines[index] = { ...newLines[index], [field]: value }

      if (field === 'item_id' && value) {
        newLines[index] = applyItemSelectionToBillLine(
          newLines[index],
          value,
          items,
          tanks,
          resolvedVendorDefaultExpenseId,
          templateBillExpenseAccountId || undefined,
          firstNursingPondId
        )
      }

      if (field === 'expense_account_id') {
        syncLineTouchedForAccount(
          billLineExpenseTouchedRef.current,
          newLines[index].line_number,
          value as number | undefined
        )
      }
      if (field === 'expense_account_id' && value) {
        newLines[index].item_id = undefined
        newLines[index].tank_id = undefined
        newLines[index].aquaculture_fish_weight_kg = undefined
        newLines[index].aquaculture_fish_count = undefined
        const account = expenseAccounts.find((a) => a.id === value)
        if (account) {
          newLines[index].description = account.account_name
        }
      }

      const lineItem = newLines[index].item_id
        ? items.find((it) => it.id === newLines[index].item_id)
        : undefined
      const fishLine = isFishTypeItem(lineItem)
      const fishLineAuto = fishLine && itemPiecesPerKg(lineItem) != null

      if (field === 'aquaculture_fish_weight_kg' && fishLineAuto) {
        return { ...prev, lines: newLines }
      }
      if (field === 'aquaculture_fish_count') {
        if (fishLineAuto) {
          newLines[index] = applyFishBillLineAutoCalc(newLines[index], lineItem, 'heads')
        } else if (fishLine) {
          const cRaw = newLines[index].aquaculture_fish_count
          const c =
            cRaw === undefined || cRaw === '' || cRaw === null
              ? NaN
              : parseInt(String(cRaw), 10)
          const pcs = itemPiecesPerKg(lineItem)
          if (pcs != null && Number.isInteger(c) && c > 0) {
            newLines[index].aquaculture_fish_weight_kg = roundFishWeightKg(c / pcs)
          }
        }
      } else if (field === 'aquaculture_fish_weight_kg' && fishLine) {
        const wRaw = newLines[index].aquaculture_fish_weight_kg
        const w = wRaw === undefined || wRaw === '' || wRaw === null ? NaN : Number(wRaw)
        if (Number.isFinite(w) && w > 0) {
          const pcs = itemPiecesPerKg(lineItem)
          newLines[index].aquaculture_fish_count =
            pcs != null ? Math.max(1, Math.round(w * pcs)) : newLines[index].aquaculture_fish_count
        }
      } else if (field === 'amount') {
        if (fishLineAuto) {
          newLines[index] = applyFishBillLineAutoCalc(newLines[index], lineItem, 'amount')
        } else {
          const quantity = Number(newLines[index].quantity ?? 0)
          const amount = parseFloat(value) || 0
          newLines[index].amount = amount
          if (quantity > 0) {
            newLines[index].unit_cost = roundBillMoney(amount / quantity)
          }
        }
      } else if (field === 'quantity' || field === 'unit_cost') {
        if (fishLineAuto) {
          if (field === 'quantity') {
            return { ...prev, lines: newLines }
          }
          newLines[index] = applyFishBillLineAutoCalc(newLines[index], lineItem, 'unit_cost')
        } else {
          newLines[index] = syncStandardBillLineAmount(newLines[index])
        }
      } else if (
        field === 'item_id' &&
        value &&
        !isFishBillLineAutoMode(newLines[index], items)
      ) {
        newLines[index] = syncStandardBillLineAmount(newLines[index])
      }

      return { ...prev, lines: newLines }
    })
  }
  
  // Get tanks for a specific item (fuel items)
  // An item is considered a fuel item if it has associated tanks
  const getTanksForItem = (itemId?: number): Tank[] => {
    if (!itemId) return []
    
    // Return tanks that use this product
    // If an item has tanks, it's a fuel item and needs tank selection
    const itemTanks = tanks.filter(tank => tank.product_id === itemId)
    
    return itemTanks
  }

  const performCreate = async (confirm?: { acknowledgeTankOverfill: boolean }) => {
    const linesToSave = finalizeBillLinesForSave(formData.lines, items)
    const { subtotal, taxAmount, total } = calculateTotals(linesToSave)

    const over = buildTankOverfillReview(linesToSave, items, tanks)
    if (over && confirm === undefined) {
      setStockReviewPayload({
        mode: 'create',
        tankIssues: over.tankIssues,
        catalogLines: over.catalogLines,
        needsServerAck: approveBill,
        draftNote: !approveBill,
      })
      setStockReviewOpen(true)
      return
    }

    const sendAck = !!(confirm && confirm.acknowledgeTankOverfill)
    const { receiptStationId, billPurpose } = resolveFormReceiptPayload()
    await api.post('/bills/', {
      vendor_id: formData.vendor_id,
      bill_date: formData.bill_date,
      due_date: formData.due_date || null,
      vendor_reference: formData.vendor_reference || null,
      memo: formData.memo || null,
      receipt_station_id: receiptStationId,
      bill_purpose: billPurpose,
      subtotal: subtotal,
      tax_amount: taxAmount,
      total_amount: total,
      status: approveBill ? 'open' : 'draft',
      acknowledge_tank_overfill: sendAck ? true : undefined,
      lines: linesToSave.map((line, idx) => ({
        line_number: idx + 1,
        ...serializeBillLineForApi(line, items),
      })),
    })

    toast.success(approveBill ? 'Bill approved and posted (Open).' : 'Bill saved as draft.')
    setShowModal(false)
    setStockReviewOpen(false)
    setStockReviewPayload(null)
    resetForm()
    void refreshAll()
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.vendor_id) {
      toast.error('Please select a vendor')
      return
    }

    if (formData.lines.length === 0) {
      toast.error('Please add at least one line item')
      return
    }

    for (let i = 0; i < formData.lines.length; i++) {
      const line = formData.lines[i]
      if (line.item_id) {
        const item = items.find(it => it.id === line.item_id)
        const availableTanks = getTanksForItem(line.item_id)
        if (availableTanks.length > 0 && !line.tank_id) {
          toast.error(`Please select a tank for fuel item "${item?.name || 'Unknown'}" in line ${i + 1}`)
          return
        }
      }
    }
    const fishErr = validateFishTypeBillLines(formData.lines, items)
    if (fishErr) {
      toast.error(fishErr)
      return
    }
    for (let i = 0; i < formData.lines.length; i++) {
      const line = formData.lines[i]
      const lineItem = line.item_id ? items.find((it) => it.id === line.item_id) : undefined
      const fishLine = (lineItem?.pos_category || '').toLowerCase() === 'fish'
      const pondErr = validateBillLinePondAllocation(line, i, fishLine)
      if (pondErr) {
        toast.error(pondErr)
        return
      }
      const stErr = validateBillLineStationAllocation(line, i, formData.bill_purpose)
      if (stErr) {
        toast.error(stErr)
        return
      }
    }

    try {
      await performCreate()
    } catch (error: unknown) {
      console.error('Error creating bill:', error)
      toast.error(extractErrorMessage(error, 'Could not save the bill. Check your connection and try again.'))
    }
  }

  const handleEdit = async (bill: Bill) => {
    try {
      // Fetch full bill details with line items
      const response = await api.get(`/bills/${bill.id}`)
      if (response.status === 200) {
        const fullBill = response.data
        setEditingBill(fullBill)
        setPostDraftBillOnUpdate(false)
        billLineExpenseTouchedRef.current.clear()
        for (const line of fullBill.lines || []) {
          const ln = line.line_number ?? 0
          const exp = line.expense_account_id != null ? Number(line.expense_account_id) : 0
          if (ln > 0 && exp > 0) billLineExpenseTouchedRef.current.add(ln)
        }
        const inferredPurpose = inferBillPurposeFromLines(
            fullBill.lines?.map((line: BillLineItem) => ({
              ...line,
              amount: Number(line.amount),
            })) || [],
            fullBill.receipt_station_id,
            aquaculturePonds.length > 0
          )
        setFormData({
          vendor_id: fullBill.vendor_id,
          bill_date: fullBill.bill_date.split('T')[0],
          due_date: fullBill.due_date ? fullBill.due_date.split('T')[0] : '',
          vendor_reference: fullBill.vendor_reference || '',
          memo: fullBill.memo || '',
          receipt_location_key: inferReceiptLocationKeyFromBill({
            billPurpose: inferredPurpose,
            receiptStationId: fullBill.receipt_station_id,
            lines: fullBill.lines || [],
            stations,
            ponds: aquaculturePonds,
          }),
          lines: fullBill.lines?.map((line: BillLineItem) => ({
            id: line.id,
            line_number: line.line_number,
            description: line.description || '',
            item_id: line.item_id || undefined,
            expense_account_id: line.expense_account_id || undefined,
            tank_id: line.tank_id || undefined,
            quantity: Number(line.quantity),
            unit_cost: Number(line.unit_cost ?? line.unit_price ?? 0),
            amount: Number(line.amount),
            tax_amount: Number(line.tax_amount || 0),
            aquaculture_fish_weight_kg:
              line.aquaculture_fish_weight_kg != null && String(line.aquaculture_fish_weight_kg) !== ''
                ? line.aquaculture_fish_weight_kg
                : '',
            aquaculture_fish_count:
              line.aquaculture_fish_count != null && String(line.aquaculture_fish_count) !== ''
                ? line.aquaculture_fish_count
                : '',
            aquaculture_fish_species:
              (line as BillLineItem & { aquaculture_fish_species?: string })
                .aquaculture_fish_species || '',
            aquaculture_fish_species_other:
              (line as BillLineItem & { aquaculture_fish_species_other?: string })
                .aquaculture_fish_species_other || '',
            aquaculture_pond_id:
              line.aquaculture_pond_id != null && String(line.aquaculture_pond_id) !== ''
                ? Number(line.aquaculture_pond_id)
                : '',
            aquaculture_production_cycle_id:
              line.aquaculture_production_cycle_id != null &&
              String(line.aquaculture_production_cycle_id) !== ''
                ? Number(line.aquaculture_production_cycle_id)
                : '',
            aquaculture_expense_category: line.aquaculture_expense_category || '',
            aquaculture_cost_bucket: line.aquaculture_cost_bucket || '',
            fuel_station_expense_category:
              (line as BillLineItem & { fuel_station_expense_category?: string })
                .fuel_station_expense_category || '',
            line_receipt_station_id:
              (line as BillLineItem & { line_receipt_station_id?: number }).line_receipt_station_id !=
              null
                ? Number((line as BillLineItem & { line_receipt_station_id?: number }).line_receipt_station_id)
                : '',
            station_cost_mode: 'direct',
          })) || [],
          bill_purpose: inferredPurpose,
        })
        setShowEditModal(true)
      } else {
        toast.error('Failed to load bill details')
      }
    } catch (error: any) {
      console.error('Error loading bill for edit:', error)
      toast.error(error.response?.data?.detail || 'Error loading bill')
    }
  }

  const performUpdate = async (confirm?: { acknowledgeTankOverfill: boolean }) => {
    if (!editingBill) return

    const linesToSave = finalizeBillLinesForSave(formData.lines, items)
    const { subtotal, taxAmount, total } = calculateTotals(linesToSave)
    const nextStatus =
      editingBill.status === 'draft' && postDraftBillOnUpdate ? 'open' : editingBill.status

    const willPostReceipt = ['open', 'paid', 'partial', 'overdue'].includes(
      (nextStatus || '').toLowerCase()
    )

    const over = buildTankOverfillReview(linesToSave, items, tanks)
    if (over && confirm === undefined) {
      setStockReviewPayload({
        mode: 'edit',
        tankIssues: over.tankIssues,
        catalogLines: over.catalogLines,
        needsServerAck: willPostReceipt,
        draftNote: !willPostReceipt,
      })
      setStockReviewOpen(true)
      return
    }

    const sendAck = !!(confirm && confirm.acknowledgeTankOverfill)
    const { receiptStationId: rsIdUpdate, billPurpose: billPurposeUpdate } = resolveFormReceiptPayload()
    await api.put(`/bills/${editingBill.id}`, {
      vendor_id: formData.vendor_id,
      bill_date: formData.bill_date,
      due_date: formData.due_date || null,
      vendor_reference: formData.vendor_reference || null,
      memo: formData.memo || null,
      receipt_station_id: rsIdUpdate,
      bill_purpose: billPurposeUpdate,
      subtotal: subtotal,
      tax_amount: taxAmount,
      total_amount: total,
      status: nextStatus,
      acknowledge_tank_overfill: sendAck ? true : undefined,
      lines: linesToSave.map((line, idx) => ({
        line_number: idx + 1,
        ...serializeBillLineForApi(line, items),
      })),
    })

    toast.success(
      postDraftBillOnUpdate && editingBill.status === 'draft'
        ? 'Bill approved and posted (Open).'
        : 'Bill updated successfully!'
    )
    setShowEditModal(false)
    setEditingBill(null)
    setStockReviewOpen(false)
    setStockReviewPayload(null)
    resetForm()
    void refreshAll()
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingBill) return

    for (let i = 0; i < formData.lines.length; i++) {
      const line = formData.lines[i]
      if (line.item_id) {
        const item = items.find(it => it.id === line.item_id)
        const availableTanks = getTanksForItem(line.item_id)
        if (availableTanks.length > 0 && !line.tank_id) {
          toast.error(`Please select a tank for fuel item "${item?.name || 'Unknown'}" in line ${i + 1}`)
          return
        }
      }
    }
    const fishErrUpd = validateFishTypeBillLines(formData.lines, items)
    if (fishErrUpd) {
      toast.error(fishErrUpd)
      return
    }
    for (let i = 0; i < formData.lines.length; i++) {
      const line = formData.lines[i]
      const lineItem = line.item_id ? items.find((it) => it.id === line.item_id) : undefined
      const fishLine = (lineItem?.pos_category || '').toLowerCase() === 'fish'
      const pondErr = validateBillLinePondAllocation(line, i, fishLine)
      if (pondErr) {
        toast.error(pondErr)
        return
      }
      const stErr = validateBillLineStationAllocation(line, i, formData.bill_purpose)
      if (stErr) {
        toast.error(stErr)
        return
      }
    }

    try {
      await performUpdate()
    } catch (error: unknown) {
      console.error('Error updating bill:', error)
      toast.error(extractErrorMessage(error, 'Could not update the bill. Check your connection and try again.'))
    }
  }

  const confirmStockReview = async () => {
    const p = stockReviewPayload
    if (!p) return
    const ack = p.needsServerAck
    try {
      if (p.mode === 'create') {
        await performCreate({ acknowledgeTankOverfill: ack })
      } else {
        await performUpdate({ acknowledgeTankOverfill: ack })
      }
    } catch (error: unknown) {
      console.error('Bill save after stock review:', error)
      toast.error(extractErrorMessage(error, 'Could not save the bill. Check your connection and try again.'))
      setStockReviewOpen(false)
      setStockReviewPayload(null)
    }
  }

  const handleVoidBill = async (billId: number, billNumber: string) => {
    if (
      !confirm(
        `Void bill ${billNumber}? This reverses posted journal entries, vendor A/P, and stock receipts. The bill stays on file as Void (it is not deleted).`,
      )
    ) {
      return
    }
    try {
      await api.put(`/bills/${billId}`, { status: 'void' })
      toast.success(`Bill ${billNumber} voided.`)
      setShowViewModal(false)
      setViewingBill(null)
      void refreshAll()
    } catch (error: unknown) {
      console.error('Error voiding bill:', error)
      toast.error(extractErrorMessage(error, 'Could not void the bill.'))
    }
  }

  const handleDelete = async (billId: number, billNumber: string) => {
    if (
      !confirm(
        `Delete bill ${billNumber}? This removes the bill and reverses inventory and journal effects. Vendor payments allocated to this bill must be removed first.`,
      )
    ) {
      return
    }

    try {
      const response = await api.delete(`/bills/${billId}`, {
        validateStatus: (status) =>
          (status >= 200 && status < 300) || status === 409,
      })

      if (response.status === 409) {
        const detail = response.data?.detail
        toast.error(
          typeof detail === 'string'
            ? detail
            : 'Cannot delete a bill that has vendor payments allocated. Remove or reallocate those payments first.',
        )
        return
      }

      toast.success(`Bill ${billNumber} deleted successfully!`)
      void refreshAll()
    } catch (error: unknown) {
      console.error('Error deleting bill:', error)
      toast.error(extractErrorMessage(error, 'Error deleting bill'))
    }
  }

  const handleViewBill = async (billId: number) => {
    try {
      const response = await api.get(`/bills/${billId}`)
      if (response.status === 200) {
        setViewingBill(response.data)
        setShowViewModal(true)
      } else {
        toast.error('Failed to load bill details')
      }
    } catch (error: any) {
      console.error('Error viewing bill:', error)
      toast.error(error.response?.data?.detail || 'Error loading bill')
    }
  }

  const handleCloseViewModal = () => {
    setShowViewModal(false)
    setViewingBill(null)
  }

  const billReceivingLocationLabel = (bill: Bill): string => {
    const pondIds = new Set<number>()
    for (const line of bill.lines || []) {
      const pid = line.aquaculture_pond_id
      if (pid != null && Number(pid) > 0) pondIds.add(Number(pid))
    }
    if (pondIds.size === 1) {
      const pid = [...pondIds][0]
      const pond = aquaculturePonds.find((p) => p.id === pid)
      const shop =
        bill.receipt_station_name ||
        (bill.receipt_station_id ? `Station #${bill.receipt_station_id}` : '')
      return shop ? `Pond: ${pond?.name || `Pond #${pid}`} · Shop hub: ${shop}` : `Pond: ${pond?.name || `Pond #${pid}`}`
    }
    return (
      bill.receipt_station_name ||
      (bill.receipt_station_id ? `Station #${bill.receipt_station_id}` : '')
    )
  }

  const billExportLine = (line: BillLineItem): BillLineExport => {
    const item = line.item_id ? items.find((i) => i.id === line.item_id) : undefined
    const pondId =
      line.aquaculture_pond_id != null && line.aquaculture_pond_id !== ''
        ? Number(line.aquaculture_pond_id)
        : null
    const pond =
      pondId != null && pondId > 0
        ? aquaculturePonds.find((p) => p.id === pondId)?.name
        : undefined
    return {
      description: line.description,
      item_id: line.item_id,
      item_name: item?.name,
      tank_name: line.tank_name,
      aquaculture_pond_id: pondId != null && pondId > 0 ? pondId : null,
      pond_name: pond,
      quantity: line.quantity,
      unit_cost: line.unit_cost,
      unit_price: line.unit_price,
      amount: line.amount,
    }
  }

  const billAsExport = (bill: Bill): BillExport => ({
    ...bill,
    lines: (bill.lines || []).map((line) => billExportLine(line)),
  })

  const billPrintOpts = () => ({
    currencySymbol,
    formatDateOnly,
    formatDateTime: (d: Date) => formatDate(d, true),
    formatNumber,
    resolveItemLabel: (line: BillLineExport) => {
      if (line.item_id) {
        return items.find((i) => i.id === line.item_id)?.name || line.item_name || `Item #${line.item_id}`
      }
      return line.description || 'Expense'
    },
    resolvePondLabel: (line: BillLineExport) => {
      if (!line.aquaculture_pond_id) return '—'
      return (
        line.pond_name ||
        aquaculturePonds.find((p) => p.id === line.aquaculture_pond_id)?.name ||
        `Pond #${line.aquaculture_pond_id}`
      )
    },
    totalOf: billTotal,
    taxOf: billTax,
    paidOf: billPaid,
    balanceOf: billBalance,
    subtotalOf: billSubtotal,
  })

  const handlePrintBillList = async () => {
    if (bills.length === 0) {
      toast.error('No bills to print for the current filter.')
      return
    }
    const sub = [
      statusFilter && `Status: ${statusFilter}`,
      debouncedSearch && `Search: ${debouncedSearch}`,
      `Generated ${formatDate(new Date(), true)}`,
    ]
      .filter(Boolean)
      .join(' · ')
    const rows = bills
      .map(
        (b) => `<tr>
        <td>${escapeHtml(b.bill_number)}</td>
        <td>${escapeHtml(b.vendor_name || '—')}</td>
        <td>${escapeHtml(formatDateOnly(b.bill_date))}</td>
        <td>${escapeHtml(b.due_date ? formatDateOnly(b.due_date) : '—')}</td>
        <td class="right">${escapeHtml(currencySymbol)}${escapeHtml(formatNumber(billTotal(b)))}</td>
        <td class="right">${escapeHtml(currencySymbol)}${escapeHtml(formatNumber(billBalance(b)))}</td>
        <td>${escapeHtml(formatBillStatusLabel(b.status))}</td>
      </tr>`,
      )
      .join('')
    const ok = await printListView({
      title: 'Vendor bills (list)',
      subtitle: sub,
      tableHtml: `<table><thead><tr><th>Bill #</th><th>Vendor</th><th>Date</th><th>Due</th><th class="right">Total</th><th class="right">Balance</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`,
    })
    if (!ok) toast.error('Allow pop-ups to print, or check your browser settings.')
  }

  const handleDownloadBillListCsv = () => {
    if (bills.length === 0) {
      toast.error('No bills to export.')
      return
    }
    downloadCsvFile(
      `bills_${new Date().toISOString().slice(0, 10)}.csv`,
      buildBillListCsv(bills.map(billAsExport), {
        formatDate: formatDateOnly,
        totalOf: billTotal,
        balanceOf: billBalance,
      }),
    )
  }

  const handleDownloadBillListJson = () => {
    if (bills.length === 0) {
      toast.error('No bills to export.')
      return
    }
    downloadJsonFile(`bills_${new Date().toISOString().slice(0, 10)}.json`, bills.map(billAsExport))
  }

  const handlePrintViewingBill = async () => {
    if (!viewingBill) return
    const branding = await loadPrintBranding(api)
    const bodyHtml = buildBillPrintHtml(billAsExport(viewingBill), {
      ...billPrintOpts(),
      receivingLocation: billReceivingLocationLabel(viewingBill) || undefined,
    })
    const ok = await printHtmlDocument(`Bill ${viewingBill.bill_number}`, bodyHtml, branding)
    if (!ok) toast.error('Allow pop-ups to print, or check your browser settings.')
  }

  const handleDownloadViewingBillCsv = () => {
    if (!viewingBill) return
    downloadCsvFile(`bill_${viewingBill.bill_number}.csv`, buildBillDetailCsv(billAsExport(viewingBill)))
  }

  const handleDownloadViewingBillJson = () => {
    if (!viewingBill) return
    downloadJsonFile(`bill_${viewingBill.bill_number}.json`, billAsExport(viewingBill))
  }

  const handleCloseEditModal = () => {
    setShowEditModal(false)
    setEditingBill(null)
    setPostDraftBillOnUpdate(false)
    resetForm()
  }

  const resetForm = () => {
    billLineExpenseTouchedRef.current.clear()
    const billDate = new Date().toISOString().split('T')[0]
    const due = new Date(`${billDate}T12:00:00`)
    due.setDate(due.getDate() + 30)
    setFormData({
      vendor_id: 0,
      bill_date: billDate,
      due_date: due.toISOString().split('T')[0],
      vendor_reference: '',
      memo: '',
      receipt_location_key: '',
      bill_purpose: 'station' as BillPurpose,
      lines: [],
    })
    setEditingBill(null)
    setApproveBill(false)
  }

  const handleCloseModal = () => {
    setShowModal(false)
    resetForm()
  }

  /** Normalize API/UI status variants (e.g. partially_paid, Partially paid). */
  const billStatusNorm = (status: string | undefined) =>
    (status || '').toLowerCase().replace(/\s+/g, '_')

  /** Same pattern as Invoices: show actions unless void; backend enforces delete rules. */
  const canShowBillActions = (bill: Bill) => billStatusNorm(bill.status) !== 'void'

  /** Edit disabled for paid / partial — aligns with invoice paid / partially_paid. */
  const isBillEditDisabled = (bill: Bill) => {
    const s = billStatusNorm(bill.status)
    return s === 'paid' || s === 'partial'
  }

  /** Delete blocked when payments are allocated (backend returns 409). */
  const isBillDeleteDisabled = (bill: Bill) => billPaid(bill) > 0

  const isBillVoidDisabled = (bill: Bill) => {
    const s = billStatusNorm(bill.status)
    if (s === 'void' || s === 'draft') return true
    return billPaid(bill) > 0
  }

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'open':
        return 'bg-blue-100 text-blue-800'
      case 'paid':
        return 'bg-green-100 text-green-800'
      case 'partial':
      case 'partially_paid':
        return 'bg-yellow-100 text-yellow-800'
      case 'overdue':
        return 'bg-red-100 text-red-800'
      case 'draft':
        return 'bg-gray-100 text-gray-800'
      case 'void':
        return 'bg-gray-100 text-gray-600'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const { subtotal, taxAmount, total } = calculateTotals()

  return (
    <div className="flex h-screen bg-gray-100 page-with-sidebar">
      <Sidebar />
      <div className="flex-1 overflow-auto app-scroll-pad">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Bills (Accounts Payable)</h1>
          <p className="text-gray-600 mt-1">
            Record vendor purchases and operating expenses for filling stations, aquaculture, and general AP — then pay
            from Payments.
          </p>
          <div className="mt-3 max-w-4xl rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
            <p className="font-semibold text-slate-900">How to record expenses on a bill</p>
            <p className="mt-1 text-sm text-slate-600">
              Choose <span className="font-medium">what this bill is mainly for</span> on the form, then add lines. The
              form shows only the fields that match.
            </p>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 leading-relaxed">
              <li>
                <span className="font-medium text-slate-800">Station / shop:</span> fuel + <span className="font-medium">tank</span>;
                shop <span className="font-medium">items</span> + header station; site costs with{' '}
                <span className="font-medium">Station cost type</span> — split across sites with{' '}
                <span className="font-medium">Shared</span> on a line.
              </li>
              {aquaculturePonds.length > 0 ? (
                <li>
                  <span className="font-medium text-teal-900">Ponds:</span>{' '}
                  <span className="font-medium">Pond cost allocation</span> (one pond or shared split), category, fish
                  kg/heads. Record new pond vendor costs here (not Pond costs).
                </li>
              ) : null}
              <li>
                <span className="font-medium text-slate-800">Head office:</span> expense accounts only.
              </li>
            </ul>
            <p className="mt-2 text-xs text-slate-600">
              Custom labels for aquaculture and fuel-station categories are set under{' '}
              <Link href="/reporting-categories" className="font-medium text-blue-700 underline hover:text-blue-800">
                Reporting categories
              </Link>{' '}
              (company admin). Built-in categories appear in the line pickers when you tag a pond or leave the pond unset.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-4 flex-1">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
              <input
                type="text"
                placeholder="Search bills..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Status</option>
              <option value="draft">Draft</option>
              <option value="open">Open</option>
              <option value="paid">Paid</option>
              <option value="partial">Partially Paid</option>
              <option value="overdue">Overdue</option>
            </select>
          </div>
          <div className="ml-4 flex flex-wrap items-center gap-2">
            <DocumentExportButtons
              onPrint={() => void handlePrintBillList()}
              onDownloadCsv={handleDownloadBillListCsv}
              onDownloadJson={handleDownloadBillListJson}
              disabled={bills.length === 0}
              printLabel="Print list"
            />
            <button
              type="button"
              onClick={() => {
                resetForm()
                setShowModal(true)
              }}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="h-5 w-5" />
              <span>Add Bill</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Bill #
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Vendor
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Bill Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Due Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Total
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Balance
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {bills.map((bill) => (
                  <tr key={bill.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {bill.bill_number}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {bill.vendor_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {formatDateOnly(bill.bill_date)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {bill.due_date ? formatDateOnly(bill.due_date) : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {currencySymbol}{formatNumber(billTotal(bill))}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {currencySymbol}{formatNumber(billBalance(bill))}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(bill.status)}`}>
                        {formatBillStatusLabel(bill.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleViewBill(bill.id)}
                          className="p-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
                          title="View bill"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        {canShowBillActions(bill) && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleEdit(bill)}
                              disabled={isBillEditDisabled(bill)}
                              className={`p-2 rounded-lg transition-colors ${
                                isBillEditDisabled(bill)
                                  ? 'text-gray-400 cursor-not-allowed'
                                  : 'text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50'
                              }`}
                              title={
                                isBillEditDisabled(bill)
                                  ? 'Cannot edit paid or partially paid bill'
                                  : 'Edit bill'
                              }
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleVoidBill(bill.id, bill.bill_number)}
                              disabled={isBillVoidDisabled(bill)}
                              className={`p-2 rounded-lg transition-colors ${
                                isBillVoidDisabled(bill)
                                  ? 'text-gray-400 cursor-not-allowed'
                                  : 'text-amber-700 hover:text-amber-800 hover:bg-amber-50'
                              }`}
                              title={
                                isBillVoidDisabled(bill)
                                  ? billStatusNorm(bill.status) === 'draft'
                                    ? 'Delete draft bills instead of voiding'
                                    : billPaid(bill) > 0
                                      ? 'Cannot void: remove vendor payments first'
                                      : 'Bill is already void'
                                  : 'Void bill (reverse GL and stock)'
                              }
                            >
                              <Ban className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(bill.id, bill.bill_number)}
                              disabled={isBillDeleteDisabled(bill)}
                              className={`p-2 rounded-lg transition-colors ${
                                isBillDeleteDisabled(bill)
                                  ? 'text-gray-400 cursor-not-allowed'
                                  : 'text-red-600 hover:text-red-700 hover:bg-red-50'
                              }`}
                              title={
                                isBillDeleteDisabled(bill)
                                  ? 'Cannot delete: remove vendor payments first'
                                  : 'Delete bill'
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {bills.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                <p>No bills found</p>
              </div>
            )}
            {billsTotal > 0 && (
              <div className="border-t border-gray-200 bg-gray-50 px-4 py-3">
                <OffsetPaginationControls
                  page={listPage}
                  pageSize={pageSize}
                  total={billsTotal}
                  disabled={loading}
                  onPageChange={setListPage}
                  onPageSizeChange={(n) => {
                    setPageSize(n)
                    setListPage(1)
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* View Bill Modal */}
        {showViewModal && viewingBill && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
            <div className="bg-white rounded-lg app-modal-pad max-w-4xl w-full max-h-[90vh] overflow-y-auto my-8">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Bill Details</h2>
                <div className="flex items-center gap-2">
                  <DocumentExportButtons
                    size="compact"
                    onPrint={() => void handlePrintViewingBill()}
                    onDownloadCsv={handleDownloadViewingBillCsv}
                    onDownloadJson={handleDownloadViewingBillJson}
                  />
                  <button
                    onClick={handleCloseViewModal}
                    className="text-gray-400 hover:text-gray-600"
                    aria-label="Close"
                  >
                    <X className="h-6 w-6" />
                  </button>
                </div>
              </div>

              <div className="space-y-6">
                {/* Bill Header */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-600">Bill Number</p>
                    <p className="text-lg font-semibold">{viewingBill.bill_number}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Status</p>
                    <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(viewingBill.status)}`}>
                      {formatBillStatusLabel(viewingBill.status)}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Vendor</p>
                    <p className="text-lg">{viewingBill.vendor_name || 'N/A'}</p>
                  </div>
                  {(viewingBill.receipt_station_name ||
                    viewingBill.receipt_station_id ||
                    viewingBill.lines?.some((l) => l.aquaculture_pond_id)) && (
                    <div>
                      <p className="text-sm text-gray-600">Receiving location</p>
                      <p className="text-lg">
                        {(() => {
                          const pondIds = new Set<number>()
                          for (const line of viewingBill.lines || []) {
                            const pid = line.aquaculture_pond_id
                            if (pid != null && Number(pid) > 0) pondIds.add(Number(pid))
                          }
                          if (pondIds.size === 1) {
                            const pid = [...pondIds][0]
                            const pond = aquaculturePonds.find((p) => p.id === pid)
                            const shop =
                              viewingBill.receipt_station_name ||
                              (viewingBill.receipt_station_id
                                ? `Station #${viewingBill.receipt_station_id}`
                                : '')
                            return (
                              <>
                                Pond: {pond?.name || `Pond #${pid}`}
                                {shop ? (
                                  <span className="block text-sm font-normal text-gray-600">
                                    Shop hub: {shop}
                                  </span>
                                ) : null}
                              </>
                            )
                          }
                          return (
                            viewingBill.receipt_station_name ||
                            (viewingBill.receipt_station_id
                              ? `Station #${viewingBill.receipt_station_id}`
                              : '—')
                          )
                        })()}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-sm text-gray-600">Bill Date</p>
                    <p className="text-lg">{formatDateOnly(viewingBill.bill_date)}</p>
                  </div>
                  {viewingBill.due_date && (
                    <div>
                      <p className="text-sm text-gray-600">Due Date</p>
                      <p className="text-lg">{formatDateOnly(viewingBill.due_date)}</p>
                    </div>
                  )}
                </div>

                {/* Line Items */}
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold mb-4">Line Items</h3>
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="min-w-[56rem] w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tank</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Pond</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cycle</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Line (pcs/kg)</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Wt (kg)</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Fish #</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Quantity</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Unit Cost</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {viewingBill.lines?.map((item: BillLineItem) => {
                        const rowItem = item.item_id ? items.find((i) => i.id === item.item_id) : undefined
                        const showFishCols = isFishTypeItem(rowItem)
                        const wkg = item.aquaculture_fish_weight_kg
                        const fc = item.aquaculture_fish_count
                        return (
                          <tr key={item.id}>
                            <td className="px-4 py-3 text-sm text-gray-900">
                              {items.find(i => i.id === item.item_id)?.name || expenseAccounts.find(a => a.id === item.expense_account_id)?.account_name || 'N/A'}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">{item.description || '-'}</td>
                            <td className="px-4 py-3 text-sm text-gray-700">
                              {item.tank_name ||
                                (item.tank_id
                                  ? tanks.find((t) => t.id === item.tank_id)?.tank_name || `Tank #${item.tank_id}`
                                  : '—')}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-700">
                              {item.aquaculture_pond_id
                                ? aquaculturePonds.find((p) => p.id === item.aquaculture_pond_id)?.name ||
                                  `Pond #${item.aquaculture_pond_id}`
                                : '—'}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-700">
                              {item.aquaculture_production_cycle_id
                                ? productionCycles.find((c) => c.id === item.aquaculture_production_cycle_id)
                                    ?.name || `Cycle #${item.aquaculture_production_cycle_id}`
                                : '—'}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right tabular-nums">
                              {showFishCols ? formatFishLinePcsPerKg(rowItem) : '—'}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right tabular-nums">
                              {showFishCols && wkg != null && String(wkg) !== '' ? formatNumber(Number(wkg)) : '—'}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right tabular-nums">
                              {showFishCols && fc != null && String(fc) !== '' ? formatNumber(Number(fc)) : '—'}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right">{formatNumber(Number(item.quantity))}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right">{currencySymbol}{formatNumber(Number(item.unit_cost ?? item.unit_price ?? 0))}</td>
                            <td className="px-4 py-3 text-sm font-medium text-gray-900 text-right">{currencySymbol}{formatNumber(Number(item.amount || 0))}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  </div>
                </div>

                {/* Totals */}
                <div className="border-t pt-4">
                  <div className="flex justify-end space-x-8">
                    <div className="text-right">
                      <p className="text-sm text-gray-600">Subtotal:</p>
                      <p className="text-sm text-gray-600">Tax:</p>
                      <p className="text-lg font-semibold text-gray-900">Total:</p>
                      <p className="text-sm text-gray-600 mt-2">Amount paid:</p>
                      <p className="text-sm font-medium text-gray-800">Balance due:</p>
                    </div>
                    <div className="text-right min-w-[120px]">
                      <p className="text-sm text-gray-900">{currencySymbol}{formatNumber(billSubtotal(viewingBill))}</p>
                      <p className="text-sm text-gray-900">{currencySymbol}{formatNumber(billTax(viewingBill))}</p>
                      <p className="text-lg font-semibold text-gray-900">{currencySymbol}{formatNumber(billTotal(viewingBill))}</p>
                      <p className="text-sm text-gray-900 mt-2">{currencySymbol}{formatNumber(billPaid(viewingBill))}</p>
                      <p className="text-sm font-medium text-gray-900">{currencySymbol}{formatNumber(billBalance(viewingBill))}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap justify-end gap-2">
                {canShowBillActions(viewingBill) && (
                  <>
                  <button
                    type="button"
                    disabled={isBillEditDisabled(viewingBill)}
                    onClick={() => {
                      const b = viewingBill
                      handleCloseViewModal()
                      void handleEdit(b)
                    }}
                    className={`px-4 py-2 rounded-lg text-white ${
                      isBillEditDisabled(viewingBill)
                        ? 'bg-gray-400 cursor-not-allowed'
                        : 'bg-indigo-600 hover:bg-indigo-700'
                    }`}
                    title={
                      isBillEditDisabled(viewingBill)
                        ? 'Cannot edit paid or partially paid bill'
                        : 'Edit bill'
                    }
                  >
                    Edit bill
                  </button>
                    <button
                      type="button"
                      disabled={isBillVoidDisabled(viewingBill)}
                      onClick={() => void handleVoidBill(viewingBill.id, viewingBill.bill_number)}
                      className={`px-4 py-2 rounded-lg text-white ${
                        isBillVoidDisabled(viewingBill)
                          ? 'bg-gray-400 cursor-not-allowed'
                          : 'bg-amber-600 hover:bg-amber-700'
                      }`}
                      title={
                        isBillVoidDisabled(viewingBill)
                          ? billStatusNorm(viewingBill.status) === 'draft'
                            ? 'Delete draft bills instead of voiding'
                            : billPaid(viewingBill) > 0
                              ? 'Cannot void: remove vendor payments first'
                              : 'Bill is already void'
                          : 'Void bill (reverse GL and stock)'
                      }
                    >
                      Void bill
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={handleCloseViewModal}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Bill Modal */}
        {showEditModal && editingBill && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
            <div className="bg-white rounded-lg app-modal-pad max-w-7xl w-full max-h-[90vh] overflow-y-auto my-8">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Edit Bill {editingBill.bill_number}</h2>
                <button
                  onClick={handleCloseEditModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <form onSubmit={handleUpdate}>
                {/* Edit Bill Form Content - reuse same form structure as Create Modal */}
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Vendor *
                    </label>
                    <select
                      required
                      value={formData.vendor_id}
                      onChange={(e) => handleFormVendorChange(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="0">Select Vendor</option>
                      {vendors.map((vendor) => (
                        <option key={vendor.id} value={vendor.id}>
                          {vendor.display_name} ({vendor.vendor_number})
                        </option>
                      ))}
                    </select>
                    {selectedVendorReceivingHint ? (
                      <p className="mt-1 text-xs text-teal-800">{selectedVendorReceivingHint}</p>
                    ) : null}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Bill Date *
                    </label>
                    <input
                      type="date"
                      required
                      value={formData.bill_date}
                      onChange={(e) => setFormData({ ...formData, bill_date: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Due Date
                    </label>
                    <input
                      type="date"
                      value={formData.due_date}
                      onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Vendor Reference
                    </label>
                    <input
                      type="text"
                      value={formData.vendor_reference}
                      onChange={(e) => setFormData({ ...formData, vendor_reference: e.target.value })}
                      placeholder="Vendor invoice number"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Receiving location (station or pond)
                    </label>
                    <BillReceiptLocationSelect
                      value={formData.receipt_location_key}
                      onChange={handleReceiptLocationChange}
                      stations={stations}
                      ponds={aquaculturePonds}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                    {formData.receipt_location_key.startsWith('p:') ? (
                      <p className="mt-1 text-xs text-teal-800">
                        Pond bill — lines tag this pond for aquaculture P&amp;L (671x). Shop hub for stock is set
                        automatically for payments and non-pond inventory.
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-gray-500">
                      Pre-filled from the vendor&apos;s usual pond or site when set. Pick a{' '}
                      <strong className="font-medium">fuel/shop station</strong> for site costs and tank/shop stock, or
                      a <strong className="font-medium">pond</strong> for lease, feed, electricity, and other pond
                      expenses. Head office bills: choose &quot;Head office / general&quot; below and leave this not set.
                    </p>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Memo/Notes
                    </label>
                    <textarea
                      value={formData.memo}
                      onChange={(e) => setFormData({ ...formData, memo: e.target.value })}
                      placeholder="Additional notes"
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <BillPurposeSection
                  value={formData.bill_purpose}
                  onChange={handleBillPurposeChange}
                  showPondOption={aquaculturePonds.length > 0}
                />

                {/* Line Items */}
                <div className="mb-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold">Line Items</h3>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          addBillLine(
                            formData.lines.length
                              ? billLineKind(formData.lines[formData.lines.length - 1])
                              : 'item'
                          )
                        }
                        title="Adds a new line of the same type (Item or Expense) as the last line. Switch a line's type any time with its Item/Expense toggle."
                        className="flex items-center space-x-1 px-3 py-1 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                      >
                        <PlusCircle className="h-4 w-4" />
                        <span>Add line</span>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {formData.lines.map((line, index) => {
                      const availableTanks = getTanksForItem(line.item_id)
                      const lineItem = line.item_id ? items.find((i) => i.id === line.item_id) : undefined
                      const showFishDims = isFishTypeItem(lineItem)
                      const fishLineAuto = showFishDims && itemPiecesPerKg(lineItem) != null
                      const pondSel =
                        line.aquaculture_pond_id === '' || line.aquaculture_pond_id == null
                          ? ''
                          : Number(line.aquaculture_pond_id)
                      const cyclesForLine =
                        pondSel === '' || !Number.isFinite(pondSel)
                          ? []
                          : productionCycles.filter((c) => c.pond_id === pondSel)
                      const showAqTag =
                        aquaculturePonds.length > 0 || (pondSel !== '' && Number.isFinite(pondSel))
                      return (
                        <div
                          key={index}
                          className="border border-gray-200 rounded-lg p-3 min-w-0 bg-white shadow-sm"
                        >
                          <div className="grid grid-cols-12 gap-x-2 gap-y-2 items-end">
                            <div className="col-span-12 lg:col-span-2 min-w-0">
                              <label className="block text-xs font-medium text-gray-700 mb-0.5">
                                {billLineKind(line) === 'item' ? 'Item / product' : 'Expense account'}
                              </label>
                              <BillLineTypePicker
                                kind={billLineKind(line)}
                                items={items}
                                expenseAccounts={expenseAccounts}
                                itemId={line.item_id}
                                expenseAccountId={line.expense_account_id}
                                className={`${BILL_LINE_CTL} max-w-full`}
                                onChangeKind={(k) => setBillLineKind(index, k)}
                                onSelectItem={(id) => applyBillLinePickerSelection(index, { kind: 'item', id })}
                                onSelectAccount={(id) =>
                                  applyBillLinePickerSelection(index, { kind: 'account', id })
                                }
                              >
                                {lineItem && (lineItem.item_type || '').toLowerCase() === 'inventory' && (
                                  <ItemCogsOnSaleHint
                                    item={lineItem}
                                    coaOptions={coaForItemHints}
                                    className="mt-1"
                                  />
                                )}
                                {billLineKind(line) === 'expense' && !line.expense_account_id && (
                                  <p className="mt-1 text-[11px] text-slate-600">
                                    Pick an expense account, or leave blank for{' '}
                                    {billLineExpenseRecommendLabel.replace(/^— | —$/g, '')} at post.
                                  </p>
                                )}
                              </BillLineTypePicker>
                            </div>
                            {availableTanks.length > 0 && (
                              <div className="col-span-12 lg:col-span-2 min-w-0">
                                <label className="block text-xs font-medium text-gray-700 mb-0.5">Tank</label>
                                <select
                                  value={line.tank_id || ''}
                                  onChange={(e) =>
                                    handleLineChange(
                                      index,
                                      'tank_id',
                                      e.target.value ? parseInt(e.target.value) : undefined
                                    )
                                  }
                                  className={BILL_LINE_CTL}
                                >
                                  <option value="">Select…</option>
                                  {availableTanks.map((tank) => (
                                    <option key={`tank-${tank.id}`} value={tank.id}>
                                      {tank.tank_name} ({tank.tank_number})
                                      {tank.station_name ? ` · ${tank.station_name}` : ''}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                            <div
                              className={`col-span-12 min-w-0 ${availableTanks.length > 0 ? 'lg:col-span-4' : 'lg:col-span-6'}`}
                            >
                              <label className="block text-xs font-medium text-gray-700 mb-0.5">Description</label>
                              <input
                                type="text"
                                value={line.description || ''}
                                onChange={(e) => handleLineChange(index, 'description', e.target.value)}
                                placeholder="Line memo"
                                className={BILL_LINE_CTL}
                              />
                            </div>
                            <div className="col-span-4 sm:col-span-3 lg:col-span-1 min-w-[5.25rem]">
                              <label className="block text-xs font-medium text-gray-700 mb-0.5">
                                {fishLineAuto ? 'Qty (kg)' : 'Qty'}
                              </label>
                              <input
                                type={fishLineAuto ? 'text' : 'number'}
                                readOnly={fishLineAuto}
                                tabIndex={fishLineAuto ? -1 : undefined}
                                step={fishLineAuto ? undefined : '0.01'}
                                min={fishLineAuto ? undefined : 0}
                                value={fishLineAuto && !line.quantity ? '' : line.quantity}
                                onChange={
                                  fishLineAuto
                                    ? undefined
                                    : (e) =>
                                        handleLineChange(index, 'quantity', parseFloat(e.target.value) || 0)
                                }
                                className={
                                  fishLineAuto
                                    ? `${BILL_LINE_NUM} bg-gray-50 cursor-default border-gray-200`
                                    : BILL_LINE_NUM
                                }
                                title={fishLineAuto ? 'Derived: heads ÷ Line (pcs/kg)' : undefined}
                              />
                            </div>
                            <div className="col-span-4 sm:col-span-3 lg:col-span-1 min-w-[5.25rem]">
                              <label className="block text-xs font-medium text-gray-700 mb-0.5">
                                {fishLineAuto ? 'Rate (per kg)' : 'Unit'}
                              </label>
                              <input
                                type={fishLineAuto ? 'text' : 'number'}
                                readOnly={fishLineAuto}
                                tabIndex={fishLineAuto ? -1 : undefined}
                                step={fishLineAuto ? undefined : '0.01'}
                                min={fishLineAuto ? undefined : 0}
                                value={line.unit_cost}
                                onChange={
                                  fishLineAuto
                                    ? undefined
                                    : (e) =>
                                        handleLineChange(index, 'unit_cost', parseFloat(e.target.value) || 0)
                                }
                                className={
                                  fishLineAuto
                                    ? `${BILL_LINE_NUM} bg-gray-50 cursor-default border-gray-200`
                                    : BILL_LINE_NUM
                                }
                                title={fishLineAuto ? 'Derived: Amount ÷ Qty (kg)' : undefined}
                              />
                            </div>
                            <div className="col-span-4 sm:col-span-3 lg:col-span-1 min-w-[6.5rem]">
                              <label className="block text-xs font-medium text-gray-700 mb-0.5">Amount</label>
                              {fishLineAuto ? (
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={line.amount}
                                  onChange={(e) =>
                                    handleLineChange(index, 'amount', parseFloat(e.target.value) || 0)
                                  }
                                  className={BILL_LINE_NUM}
                                  title="Vendor line total (BDT) — enter with total fish (heads)"
                                />
                              ) : (
                                <input
                                  type="text"
                                  readOnly
                                  value={formatNumber(line.amount)}
                                  title={`${currencySymbol}${formatNumber(line.amount)}`}
                                  className={`${AMOUNT_READ_ONLY_INPUT_CLASS} min-h-[2.25rem] py-1.5`}
                                />
                              )}
                            </div>
                            <div className="col-span-12 sm:col-span-3 lg:col-span-1 flex justify-end lg:justify-center pb-0.5">
                              <button
                                type="button"
                                onClick={() => {
                                  const newLines = formData.lines
                                    .filter((_, i) => i !== index)
                                    .map((line, i) => ({ ...line, line_number: i + 1 }))
                                  setFormData({ ...formData, lines: newLines })
                                }}
                                className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-md border border-transparent hover:border-red-100"
                                aria-label="Remove line"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                          {showFishDims ? (
                            <FishBillLineDimensionRow
                              line={line}
                              index={index}
                              lineItem={lineItem}
                              fishLineAuto={fishLineAuto}
                              speciesOptions={fishSpeciesOptions}
                              currencySymbol={currencySymbol}
                              onFieldChange={handleLineChange}
                            />
                          ) : null}
                          {(formData.bill_purpose === 'pond' || showFishDims) && showAqTag ? (
                            <BillPondAllocationFields
                              line={line}
                              index={index}
                              ponds={pondOptionsForFish}
                              cycles={productionCycles}
                              billExpenseCategories={billExpenseCategories}
                              expenseAccounts={expenseAccounts}
                              onFieldChange={handleLineChange}
                              directOnly={showFishDims}
                            />
                          ) : null}
                          {formData.bill_purpose === 'station' &&
                          billFuelCategories.length > 0 &&
                          !showFishDims ? (
                            <BillStationAllocationFields
                              line={line}
                              index={index}
                              stations={stations}
                              billFuelCategories={billFuelCategories}
                              expenseAccounts={expenseAccounts}
                              onFieldChange={handleLineChange}
                              showCategoryBlock={!line.item_id}
                            />
                          ) : null}
                        </div>
                      )
                    })}
                  </div>

                  {formData.lines.length === 0 && (
                    <p className="text-center text-gray-500 py-4">No line items added. Click &quot;Add Line&quot; to add items.</p>
                  )}
                </div>

                {/* Totals */}
                {formData.lines.length > 0 && (
                  <div className="border-t pt-4 mb-6">
                    <div className="flex justify-end space-x-8">
                      <div className="text-right">
                        <p className="text-sm text-gray-600">Subtotal:</p>
                        <p className="text-sm text-gray-600">Tax:</p>
                        <p className="text-lg font-semibold text-gray-900">Total:</p>
                      </div>
                      <div className="text-right min-w-[120px]">
                        <p className="text-sm text-gray-900">{currencySymbol}{formatNumber(calculateTotals().subtotal)}</p>
                        <p className="text-sm text-gray-900">{currencySymbol}{formatNumber(calculateTotals().taxAmount)}</p>
                        <p className="text-lg font-semibold text-gray-900">{currencySymbol}{formatNumber(calculateTotals().total)}</p>
                      </div>
                    </div>
                  </div>
                )}

                {editingBill.status === 'draft' && (
                  <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <label className="flex items-start gap-2 text-sm text-gray-800 cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        checked={postDraftBillOnUpdate}
                        onChange={(e) => setPostDraftBillOnUpdate(e.target.checked)}
                      />
                      <span>
                        <span className="font-medium">Approve on save</span>
                        <span className="block text-gray-600">
                          Mark Open and post this bill to the general ledger when you save.
                        </span>
                      </span>
                    </label>
                  </div>
                )}

                {/* Form Actions */}
                <div className="flex justify-end space-x-4">
                  <button
                    type="button"
                    onClick={handleCloseEditModal}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    {postDraftBillOnUpdate && editingBill.status === 'draft' ? 'Save & approve' : 'Update Bill'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Tank capacity / stock review (warning — user may continue, e.g. drums) */}
        {stockReviewOpen && stockReviewPayload && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] overflow-y-auto p-4">
            <div
              className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 border border-amber-200"
              role="dialog"
              aria-labelledby="stock-review-title"
            >
              <h3 id="stock-review-title" className="text-lg font-semibold text-amber-900 mb-2">
                Tank capacity notice
              </h3>
              <p className="text-sm text-gray-700 mb-4">
                This bill would receive more fuel than fits in the tank(s) below (current stock + this bill &gt; tank
                capacity). You can still continue if overflow will be stored elsewhere (for example in drums).
              </p>
              {stockReviewPayload.draftNote && (
                <p className="text-sm text-blue-800 bg-blue-50 border border-blue-100 rounded-md px-3 py-2 mb-4">
                  You are saving as draft — inventory is not received until the bill is posted (Open).
                </p>
              )}
              <div className="overflow-x-auto mb-4">
                <table className="min-w-full text-sm border border-gray-200 rounded-md">
                  <thead className="bg-gray-50 text-left">
                    <tr>
                      <th className="px-3 py-2 font-medium text-gray-700">Tank</th>
                      <th className="px-3 py-2 font-medium text-gray-700 text-right">In tank</th>
                      <th className="px-3 py-2 font-medium text-gray-700 text-right">Capacity</th>
                      <th className="px-3 py-2 font-medium text-gray-700 text-right">Free space</th>
                      <th className="px-3 py-2 font-medium text-gray-700 text-right">This bill</th>
                      <th className="px-3 py-2 font-medium text-gray-700 text-right">Over by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockReviewPayload.tankIssues.map((row) => (
                      <tr key={row.tankId} className="border-t border-gray-100">
                        <td className="px-3 py-2 text-gray-900">{row.tankName}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatNumber(row.currentStock)} {row.unit}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatNumber(row.capacity)} {row.unit}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-800">
                          {formatNumber(row.remainingUllage)} {row.unit}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.receiptQty)} {row.unit}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium text-amber-800">
                          {formatNumber(row.overBy)} {row.unit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {stockReviewPayload.catalogLines.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-2">Items on this bill</p>
                  <ul className="text-sm text-gray-800 space-y-1 border border-gray-100 rounded-md px-3 py-2 bg-gray-50/80">
                    {stockReviewPayload.catalogLines.map((row, i) => (
                      <li key={i}>
                        <span className="font-medium">{row.itemName}</span>
                        {' — '}
                        bill qty {formatNumber(row.billQty)} {row.unit}
                        {row.quantityOnHand !== null && (
                          <span className="text-gray-600">
                            {' '}
                            · current stock (system) {formatNumber(row.quantityOnHand)} {row.unit}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex flex-wrap justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setStockReviewOpen(false)
                    setStockReviewPayload(null)
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void confirmStockReview()}
                  className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
                >
                  {stockReviewPayload.needsServerAck ? 'Continue and confirm overflow' : 'Continue'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Create Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
            <div className="bg-white rounded-lg app-modal-pad max-w-7xl w-full max-h-[90vh] overflow-y-auto my-8">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Add New Bill</h2>
                {referenceLoading ? (
                  <span className="text-sm font-normal text-gray-500">Loading form data…</span>
                ) : null}
                <button
                  onClick={handleCloseModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <form onSubmit={handleCreate} className={referenceLoading ? 'pointer-events-none opacity-60' : undefined}>
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Vendor *
                    </label>
                    <select
                      required
                      value={formData.vendor_id}
                      onChange={(e) => handleFormVendorChange(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="0">Select Vendor</option>
                      {vendors.length === 0 ? (
                        <option value="0" disabled>No active vendors available</option>
                      ) : (
                        vendors.map((vendor) => (
                          <option key={vendor.id} value={vendor.id}>
                            {vendor.display_name} ({vendor.vendor_number})
                          </option>
                        ))
                      )}
                    </select>
                    {vendors.length === 0 && (
                      <p className="mt-1 text-xs text-red-600">
                        No active vendors found. Please create a vendor first or check if vendors are active.
                      </p>
                    )}
                    {selectedVendorReceivingHint ? (
                      <p className="mt-1 text-xs text-teal-800">{selectedVendorReceivingHint}</p>
                    ) : null}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Bill Date *
                    </label>
                    <input
                      type="date"
                      required
                      value={formData.bill_date}
                      onChange={(e) => setFormData({ ...formData, bill_date: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Due Date
                    </label>
                    <input
                      type="date"
                      value={formData.due_date}
                      onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Vendor Reference
                    </label>
                    <input
                      type="text"
                      value={formData.vendor_reference}
                      onChange={(e) => setFormData({ ...formData, vendor_reference: e.target.value })}
                      placeholder="Vendor invoice number"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Receiving location (station or pond)
                    </label>
                    <BillReceiptLocationSelect
                      value={formData.receipt_location_key}
                      onChange={handleReceiptLocationChange}
                      stations={stations}
                      ponds={aquaculturePonds}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                    {formData.receipt_location_key.startsWith('p:') ? (
                      <p className="mt-1 text-xs text-teal-800">
                        Pond bill — lines tag this pond for aquaculture P&amp;L (671x). Shop hub for stock is set
                        automatically for payments and non-pond inventory.
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-gray-500">
                      Pre-filled from the vendor&apos;s usual pond or site when set. Pick a{' '}
                      <strong className="font-medium">fuel/shop station</strong> for site costs and tank/shop stock, or
                      a <strong className="font-medium">pond</strong> for lease, feed, electricity, and other pond
                      expenses. Head office bills: choose &quot;Head office / general&quot; below and leave this not set.
                    </p>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Memo/Notes
                    </label>
                    <textarea
                      value={formData.memo}
                      onChange={(e) => setFormData({ ...formData, memo: e.target.value })}
                      rows={2}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <BillPurposeSection
                  value={formData.bill_purpose}
                  onChange={handleBillPurposeChange}
                  showPondOption={aquaculturePonds.length > 0}
                />

                {/* Line Items */}
                <div className="mb-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold">Line Items</h3>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          addBillLine(
                            formData.lines.length
                              ? billLineKind(formData.lines[formData.lines.length - 1])
                              : 'item'
                          )
                        }
                        title="Adds a new line of the same type (Item or Expense) as the last line. Switch a line's type any time with its Item/Expense toggle."
                        className="flex items-center space-x-1 px-3 py-1 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                      >
                        <PlusCircle className="h-4 w-4" />
                        <span>Add line</span>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {formData.lines.map((line, index) => {
                      const availableTanks = getTanksForItem(line.item_id)
                      const isFuelItem = availableTanks.length > 0
                      const selectedTank =
                        line.tank_id && isFuelItem
                          ? availableTanks.find((t) => t.id === line.tank_id)
                          : undefined
                      const tankTitle =
                        selectedTank != null
                          ? `Current: ${formatNumber(Number(selectedTank.current_stock) || 0)}L / Capacity: ${formatNumber(Number(selectedTank.capacity) || 0)}L`
                          : undefined
                      const lineItem = line.item_id ? items.find((i) => i.id === line.item_id) : undefined
                      const showFishDims = isFishTypeItem(lineItem)
                      const fishLineAuto = showFishDims && itemPiecesPerKg(lineItem) != null
                      const pondSel =
                        line.aquaculture_pond_id === '' || line.aquaculture_pond_id == null
                          ? ''
                          : Number(line.aquaculture_pond_id)
                      const cyclesForLine =
                        pondSel === '' || !Number.isFinite(pondSel)
                          ? []
                          : productionCycles.filter((c) => c.pond_id === pondSel)
                      const showAqTag =
                        aquaculturePonds.length > 0 || (pondSel !== '' && Number.isFinite(pondSel))

                      return (
                        <div
                          key={index}
                          className="border border-gray-200 rounded-lg p-3 min-w-0 bg-gray-50/80 shadow-sm"
                        >
                          <div className="grid grid-cols-12 gap-x-2 gap-y-2 items-end">
                            <div className="col-span-12 lg:col-span-2 min-w-0">
                              <label className="block text-xs font-medium text-gray-700 mb-0.5">
                                {billLineKind(line) === 'item' ? 'Item / product' : 'Expense account'}
                              </label>
                              <BillLineTypePicker
                                kind={billLineKind(line)}
                                items={items}
                                expenseAccounts={expenseAccounts}
                                itemId={line.item_id}
                                expenseAccountId={line.expense_account_id}
                                className={`${BILL_LINE_CTL} max-w-full`}
                                onChangeKind={(k) => setBillLineKind(index, k)}
                                onSelectItem={(id) => applyBillLinePickerSelection(index, { kind: 'item', id })}
                                onSelectAccount={(id) =>
                                  applyBillLinePickerSelection(index, { kind: 'account', id })
                                }
                              >
                                {lineItem && (lineItem.item_type || '').toLowerCase() === 'inventory' && (
                                  <ItemCogsOnSaleHint
                                    item={lineItem}
                                    coaOptions={coaForItemHints}
                                    className="mt-1"
                                  />
                                )}
                                {billLineKind(line) === 'expense' && !line.expense_account_id && (
                                  <p className="mt-1 text-[11px] text-slate-600">
                                    Pick an expense account, or leave blank for{' '}
                                    {billLineExpenseRecommendLabel.replace(/^— | —$/g, '')} at post.
                                  </p>
                                )}
                              </BillLineTypePicker>
                            </div>

                            {isFuelItem && (
                              <div className="col-span-12 lg:col-span-2 min-w-0">
                                <label className="block text-xs font-medium text-gray-700 mb-0.5">
                                  Tank <span className="text-red-500">*</span>
                                </label>
                                <select
                                  value={line.tank_id || ''}
                                  title={tankTitle}
                                  onChange={(e) =>
                                    handleLineChange(
                                      index,
                                      'tank_id',
                                      e.target.value ? parseInt(e.target.value) : undefined
                                    )
                                  }
                                  className={`${BILL_LINE_CTL} border-yellow-400 bg-yellow-50 focus:ring-yellow-500`}
                                  required={isFuelItem}
                                >
                                  <option value="">Select…</option>
                                  {availableTanks.map((tank) => (
                                    <option key={`tank-${tank.id}`} value={tank.id}>
                                      {tank.tank_name} ({tank.tank_number})
                                      {tank.station_name ? ` · ${tank.station_name}` : ''}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}

                            <div
                              className={`col-span-12 min-w-0 ${isFuelItem ? 'lg:col-span-3' : 'lg:col-span-5'}`}
                            >
                              <label className="block text-xs font-medium text-gray-700 mb-0.5">Description</label>
                              <input
                                type="text"
                                value={line.description || ''}
                                onChange={(e) => handleLineChange(index, 'description', e.target.value)}
                                placeholder="Line memo"
                                className={BILL_LINE_CTL}
                              />
                            </div>
                            <div className="col-span-4 sm:col-span-2 lg:col-span-1 min-w-[5.25rem]">
                              <label className="block text-xs font-medium text-gray-700 mb-0.5">
                                {fishLineAuto ? 'Qty (kg)' : 'Qty'}
                              </label>
                              <input
                                type={fishLineAuto ? 'text' : 'number'}
                                readOnly={fishLineAuto}
                                tabIndex={fishLineAuto ? -1 : undefined}
                                step={fishLineAuto ? undefined : '0.01'}
                                min={fishLineAuto ? undefined : 0}
                                value={fishLineAuto && !line.quantity ? '' : line.quantity}
                                onChange={
                                  fishLineAuto
                                    ? undefined
                                    : (e) =>
                                        handleLineChange(index, 'quantity', parseFloat(e.target.value) || 0)
                                }
                                className={
                                  fishLineAuto
                                    ? `${BILL_LINE_NUM} bg-gray-50 cursor-default border-gray-200`
                                    : BILL_LINE_NUM
                                }
                                title={fishLineAuto ? 'Derived: heads ÷ Line (pcs/kg)' : undefined}
                              />
                            </div>
                            <div className="col-span-4 sm:col-span-2 lg:col-span-1 min-w-[5.25rem]">
                              <label className="block text-xs font-medium text-gray-700 mb-0.5">
                                {fishLineAuto ? 'Rate (per kg)' : 'Rate'}
                              </label>
                              <input
                                type={fishLineAuto ? 'text' : 'number'}
                                readOnly={fishLineAuto}
                                tabIndex={fishLineAuto ? -1 : undefined}
                                step={fishLineAuto ? undefined : '0.01'}
                                min={fishLineAuto ? undefined : 0}
                                value={line.unit_cost}
                                onChange={
                                  fishLineAuto
                                    ? undefined
                                    : (e) =>
                                        handleLineChange(index, 'unit_cost', parseFloat(e.target.value) || 0)
                                }
                                className={
                                  fishLineAuto
                                    ? `${BILL_LINE_NUM} bg-gray-50 cursor-default border-gray-200`
                                    : BILL_LINE_NUM
                                }
                                title={fishLineAuto ? 'Derived: Amount ÷ Qty (kg)' : undefined}
                              />
                            </div>
                            <div className="col-span-4 sm:col-span-2 lg:col-span-1 min-w-[5rem]">
                              <label className="block text-xs font-medium text-gray-700 mb-0.5">Tax</label>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={line.tax_amount}
                                onChange={(e) => handleLineChange(index, 'tax_amount', parseFloat(e.target.value) || 0)}
                                className={BILL_LINE_NUM}
                              />
                            </div>
                            <div className="col-span-6 sm:col-span-3 lg:col-span-1 min-w-[6.5rem]">
                              <label className="block text-xs font-medium text-gray-700 mb-0.5">Amount</label>
                              {fishLineAuto ? (
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={line.amount}
                                  onChange={(e) =>
                                    handleLineChange(index, 'amount', parseFloat(e.target.value) || 0)
                                  }
                                  className={BILL_LINE_NUM}
                                  title="Vendor line total (BDT) — enter with total fish (heads)"
                                />
                              ) : (
                                <input
                                  type="text"
                                  readOnly
                                  inputMode="decimal"
                                  value={formatNumber(Number(line.amount) || 0)}
                                  title={`${currencySymbol}${formatNumber(Number(line.amount) || 0)}`}
                                  className={`${AMOUNT_READ_ONLY_INPUT_CLASS} min-h-[2.25rem] py-1.5`}
                                />
                              )}
                            </div>
                            <div className="col-span-6 sm:col-span-3 lg:col-span-1 flex justify-end lg:justify-center pb-0.5">
                              <button
                                type="button"
                                onClick={() => handleRemoveLine(index)}
                                className="p-2 text-red-600 hover:bg-red-50 rounded-md border border-transparent hover:border-red-100"
                                aria-label="Remove line"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                          {showFishDims ? (
                            <FishBillLineDimensionRow
                              line={line}
                              index={index}
                              lineItem={lineItem}
                              fishLineAuto={fishLineAuto}
                              speciesOptions={fishSpeciesOptions}
                              currencySymbol={currencySymbol}
                              onFieldChange={handleLineChange}
                            />
                          ) : null}
                          {(formData.bill_purpose === 'pond' || showFishDims) && showAqTag ? (
                            <BillPondAllocationFields
                              line={line}
                              index={index}
                              ponds={pondOptionsForFish}
                              cycles={productionCycles}
                              billExpenseCategories={billExpenseCategories}
                              expenseAccounts={expenseAccounts}
                              onFieldChange={handleLineChange}
                              directOnly={showFishDims}
                            />
                          ) : null}
                          {formData.bill_purpose === 'station' &&
                          billFuelCategories.length > 0 &&
                          !showFishDims ? (
                            <BillStationAllocationFields
                              line={line}
                              index={index}
                              stations={stations}
                              billFuelCategories={billFuelCategories}
                              expenseAccounts={expenseAccounts}
                              onFieldChange={handleLineChange}
                              showCategoryBlock={!line.item_id}
                            />
                          ) : null}
                        </div>
                      )
                    })}
                  </div>

                  {formData.lines.length === 0 && (
                    <div className="text-center py-8 text-gray-500 border border-dashed border-gray-300 rounded-lg">
                      <p>No line items. Click "Add Line" to add items or expense accounts.</p>
                    </div>
                  )}
                </div>

                {/* Totals */}
                <div className="border-t pt-4 mb-6">
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
                    <label className="flex items-start gap-2 text-sm text-gray-700 max-w-md cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        checked={approveBill}
                        onChange={(e) => setApproveBill(e.target.checked)}
                      />
                      <span>
                        <span className="font-medium text-gray-900">Approve for payment</span>
                        <span className="block text-gray-600">
                          Mark as Open and post to the general ledger (A/P). Leave unchecked to save as a draft you can edit later.
                        </span>
                      </span>
                    </label>
                    <div className="w-full sm:w-64 space-y-2 sm:text-right">
                      <div className="flex justify-between text-sm sm:flex sm:justify-between">
                        <span className="text-gray-600">Subtotal:</span>
                        <span className="font-medium">{currencySymbol}{formatNumber(Number(subtotal) || 0)}</span>
                      </div>
                      <div className="flex justify-between text-sm sm:flex sm:justify-between">
                        <span className="text-gray-600">Tax:</span>
                        <span className="font-medium">{currencySymbol}{formatNumber(Number(taxAmount) || 0)}</span>
                      </div>
                      <div className="flex justify-between text-lg font-bold border-t pt-2 sm:flex sm:justify-between">
                        <span>Total:</span>
                        <span>{currencySymbol}{formatNumber(Number(total) || 0)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap justify-end gap-3">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    {approveBill ? 'Save & approve' : 'Save as draft'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
