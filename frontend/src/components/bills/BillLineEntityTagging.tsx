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
} from '@/lib/billLineEntity'
import {
  useEntityScopedBillExpenseCategories,
  useEntityScopedFuelBillExpenseCategories,
} from '@/lib/entityScopedReportingCategories'
import { ReportingCategoryCombobox } from './ReportingCategoryCombobox'
import type { BillReceiptLocationPond, BillReceiptLocationStation } from '@/lib/billReceiptLocation'
import type { CoaPick } from '@/lib/coaDefaults'
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
  selectClassName = 'w-full min-w-0 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500',
  showHeadOffice = true,
  companyName,
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
}) {
  const entityKey = billLineEntityKey(line)
  const entityKind = billLineEntityKind(entityKey)
  const showCategory = entityKind === 'pond' || entityKind === 'station'

  const { categories: scopedPondCategories, loading: pondCategoriesLoading } =
    useEntityScopedBillExpenseCategories(entityKey, entityKind)
  const { categories: scopedFuelCategories, loading: fuelCategoriesLoading } =
    useEntityScopedFuelBillExpenseCategories(entityKey, entityKind)

  const pondCategories =
    scopedPondCategories.length > 0 ? scopedPondCategories : billExpenseCategories

  const fuelCategories =
    scopedFuelCategories.length > 0 ? scopedFuelCategories : billFuelCategories

  const handleEntityChange = (key: string) => {
    const next = applyBillLineEntityKey(line, key)
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

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-dashed border-slate-200 pt-2">
      <div className="min-w-[12rem] flex-1">
        <label className="block text-xs font-medium text-gray-700 mb-1">
          {line.item_id ? 'Entity (P&L / cost tag)' : 'Entity (who this expense is for)'}
        </label>
        <BillLineEntitySelect
          value={entityKey}
          onChange={handleEntityChange}
          stations={stations}
          ponds={ponds}
          className={selectClassName}
          showHeadOffice={showHeadOffice}
          companyName={companyName}
        />
      </div>
      {showCategory && entityKind === 'pond' ? (
        <div className="min-w-[12rem] flex-1">
          <label className="block text-xs font-medium text-gray-700 mb-1">Pond expense category</label>
          <ReportingCategoryCombobox
            categories={pondCategories}
            value={line.aquaculture_expense_category || ''}
            onChange={handlePondCategory}
            className={selectClassName}
            placeholder={pondCategoriesLoading ? 'Loading categories…' : 'Search pond category…'}
          />
        </div>
      ) : null}
      {showCategory && entityKind === 'station' ? (
        <div className="min-w-[12rem] flex-1">
          <label className="block text-xs font-medium text-gray-700 mb-1">Station expense category</label>
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
