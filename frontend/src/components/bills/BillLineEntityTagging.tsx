'use client'

import {
  applyAquacultureCategoryToBillLine,
  findBillCategory,
  type AquacultureBillExpenseCategory,
} from '@/lib/aquacultureBillLine'
import {
  applyFuelCategoryToBillLine,
  findFuelBillCategory,
  type FuelStationBillExpenseCategory,
} from '@/lib/fuelStationBillLine'
import {
  applyBillLineEntityKey,
  billLineEntityKey,
  billLineEntityKind,
  billLineExpenseReportingKind,
} from '@/lib/billLineEntity'
import {
  useEntityScopedBillExpenseCategories,
  useEntityScopedFuelBillExpenseCategories,
} from '@/lib/entityScopedReportingCategories'
import { ReportingCategoryCombobox } from './ReportingCategoryCombobox'
import type { BillReceiptLocationPond, BillReceiptLocationStation } from '@/lib/billReceiptLocation'
import type { CoaPick } from '@/lib/coaDefaults'
import type { BillPurpose } from '@/lib/billAllocation'
import { BillLineEntitySelect } from './BillLineEntitySelect'

export type BillLineEntityTagShape = {
  item_id?: number
  aquaculture_pond_id?: number | '' | null
  line_receipt_station_id?: number | '' | null
  aquaculture_expense_category?: string
  fuel_station_expense_category?: string
  expense_account_id?: number
}

export function BillLineEntityTagging({
  line,
  index,
  stations,
  ponds,
  billExpenseCategories,
  billFuelCategories,
  billExpenseCoaOptions = [],
  onFieldChange,
  selectClassName = 'w-full min-w-0 px-2 py-1 text-sm border border-border rounded focus:ring-1 focus:ring-ring',
  showHeadOffice = true,
  companyName,
  billPurpose,
  showChargeTo = false,
}: {
  line: BillLineEntityTagShape
  index: number
  stations: BillReceiptLocationStation[]
  ponds: BillReceiptLocationPond[]
  billExpenseCategories: AquacultureBillExpenseCategory[]
  billFuelCategories: FuelStationBillExpenseCategory[]
  billExpenseCoaOptions?: CoaPick[]
  onFieldChange: (index: number, field: string, value: unknown) => void
  selectClassName?: string
  showHeadOffice?: boolean
  companyName?: string
  billPurpose?: BillPurpose
  showChargeTo?: boolean
}) {
  const entityKey = billLineEntityKey(line)
  const entityKind = billLineEntityKind(entityKey)
  const expenseReportingKind = billLineExpenseReportingKind(entityKey, stations)
  const showCategory = expenseReportingKind === 'aquaculture' || expenseReportingKind === 'fuel_station'
  const isShopHubEntity = expenseReportingKind === 'aquaculture' && entityKind === 'station'
  const showPondMismatchHint = billPurpose === 'pond' && entityKind === 'station' && !isShopHubEntity

  const { categories: scopedPondCategories, loading: pondCategoriesLoading } =
    useEntityScopedBillExpenseCategories(entityKey, expenseReportingKind)
  const { categories: scopedFuelCategories, loading: fuelCategoriesLoading } =
    useEntityScopedFuelBillExpenseCategories(entityKey, expenseReportingKind)

  const pondCategories =
    scopedPondCategories.length > 0 ? scopedPondCategories : billExpenseCategories

  const fuelCategories =
    scopedFuelCategories.length > 0 ? scopedFuelCategories : billFuelCategories

  const handleEntityChange = (key: string) => {
    const next = applyBillLineEntityKey(line, key, stations)
    onFieldChange(index, '__entity_bundle__', next)
  }

  const handlePondCategory = (catId: string) => {
    const cat = findBillCategory(pondCategories, catId)
    if (!cat) {
      onFieldChange(index, 'aquaculture_expense_category', catId)
      return
    }
    const patched = applyAquacultureCategoryToBillLine(line, cat, billExpenseCoaOptions)
    onFieldChange(index, '__entity_bundle__', patched)
  }

  const handleFuelCategory = (catId: string) => {
    const cat = findFuelBillCategory(fuelCategories, catId)
    if (!cat) {
      onFieldChange(index, 'fuel_station_expense_category', catId)
      return
    }
    const patched = applyFuelCategoryToBillLine(line, cat, billExpenseCoaOptions)
    onFieldChange(index, '__entity_bundle__', patched)
  }

  if (!showHeadOffice && stations.length === 0 && ponds.length === 0) return null
  if (!showChargeTo && !showCategory && !isShopHubEntity && !showPondMismatchHint) return null

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-dashed border-border pt-2">
      {showChargeTo ? (
        <div className="min-w-[12rem] flex-1">
          <label className="block text-xs font-medium text-foreground/85 mb-1">Charge to</label>
          <BillLineEntitySelect
            value={entityKey}
            onChange={handleEntityChange}
            stations={stations}
            ponds={ponds}
            className={selectClassName}
            showHeadOffice={showHeadOffice}
            companyName={companyName}
            placeholder="Pond, station, shop hub, or head office…"
          />
        </div>
      ) : null}
      {isShopHubEntity ? (
        <p className="w-full text-xs text-primary leading-snug">
          <strong>Shop / aquaculture hub</strong> — pick an aquaculture expense category below.
        </p>
      ) : null}
      {showPondMismatchHint ? (
        <p className="w-full text-xs text-warning-foreground leading-snug">
          Fuel station on a pond bill — use a <strong>pond</strong> or <strong>shop hub</strong> in Charge to
          for feed and pond costs.
        </p>
      ) : null}
      {showCategory && expenseReportingKind === 'aquaculture' ? (
        <div className="min-w-[12rem] flex-1">
          <label className="block text-xs font-medium text-foreground/85 mb-1">
            {isShopHubEntity ? 'Shop / aquaculture expense category' : 'Pond expense category'}
          </label>
          <ReportingCategoryCombobox
            categories={pondCategories}
            value={line.aquaculture_expense_category || ''}
            onChange={handlePondCategory}
            className={selectClassName}
            placeholder={pondCategoriesLoading ? 'Loading categories…' : 'Search category…'}
          />
        </div>
      ) : null}
      {showCategory && expenseReportingKind === 'fuel_station' ? (
        <div className="min-w-[12rem] flex-1">
          <label className="block text-xs font-medium text-foreground/85 mb-1">Station expense category</label>
          <ReportingCategoryCombobox
            categories={fuelCategories}
            value={line.fuel_station_expense_category || ''}
            onChange={handleFuelCategory}
            className={selectClassName}
            placeholder={fuelCategoriesLoading ? 'Loading categories…' : 'Search station category…'}
          />
        </div>
      ) : null}
    </div>
  )
}
