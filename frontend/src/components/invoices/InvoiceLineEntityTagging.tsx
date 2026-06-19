'use client'

import {
  applyAquacultureIncomeToInvoiceLine,
  findAquacultureInvoiceCategory,
  type AquacultureInvoiceIncomeCategory,
} from '@/lib/aquacultureInvoiceLine'
import {
  applyFuelCategoryToInvoiceLine,
  findFuelInvoiceCategory,
  type FuelStationInvoiceIncomeCategory,
} from '@/lib/fuelStationInvoiceLine'
import {
  applyInvoiceLineEntityKey,
  invoiceLineEntityKey,
  invoiceLineEntityKind,
} from '@/lib/invoiceLineEntity'
import { useEntityScopedInvoiceIncomeCategories } from '@/lib/entityScopedReportingCategories'
import type { BillReceiptLocationPond, BillReceiptLocationStation } from '@/lib/billReceiptLocation'
import { BillLineEntitySelect } from '@/components/bills/BillLineEntitySelect'
import { ReportingCategoryCombobox } from '@/components/bills/ReportingCategoryCombobox'

export type InvoiceLineEntityTagShape = {
  item_id?: number
  aquaculture_pond_id?: number | '' | null
  line_receipt_station_id?: number | '' | null
  aquaculture_income_category?: string
  fuel_station_income_category?: string
  revenue_account_id?: number
  description?: string
}

export function InvoiceLineEntityTagging({
  line,
  index,
  stations,
  ponds,
  pondIncomeCategories,
  stationIncomeCategories,
  onFieldChange,
  selectClassName = 'w-full min-w-0 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500',
  showHeadOffice = true,
  companyName,
}: {
  line: InvoiceLineEntityTagShape
  index: number
  stations: BillReceiptLocationStation[]
  ponds: BillReceiptLocationPond[]
  pondIncomeCategories: AquacultureInvoiceIncomeCategory[]
  stationIncomeCategories: FuelStationInvoiceIncomeCategory[]
  onFieldChange: (index: number, field: string, value: unknown) => void
  selectClassName?: string
  showHeadOffice?: boolean
  companyName?: string
}) {
  const entityKey = invoiceLineEntityKey(line)
  const entityKind = invoiceLineEntityKind(entityKey)
  const showCategory = entityKind === 'pond' || entityKind === 'station'

  const {
    pondCategories: scopedPondCategories,
    stationCategories: scopedStationCategories,
    loading: categoriesLoading,
  } = useEntityScopedInvoiceIncomeCategories(entityKey, entityKind)

  const pondCategories =
    scopedPondCategories.length > 0 ? scopedPondCategories : pondIncomeCategories
  const stationCategories =
    scopedStationCategories.length > 0 ? scopedStationCategories : stationIncomeCategories

  const handleEntityChange = (key: string) => {
    const next = applyInvoiceLineEntityKey(line, key)
    onFieldChange(index, '__entity_bundle__', {
      ...next,
      aquaculture_income_category: '',
      fuel_station_income_category: '',
    })
  }

  const handlePondCategory = (catId: string) => {
    const cat = findAquacultureInvoiceCategory(pondCategories, catId)
    if (!cat) {
      onFieldChange(index, 'aquaculture_income_category', catId)
      return
    }
    onFieldChange(index, '__entity_bundle__', applyAquacultureIncomeToInvoiceLine(line, cat))
  }

  const handleFuelCategory = (catId: string) => {
    const cat = findFuelInvoiceCategory(stationCategories, catId)
    if (!cat) {
      onFieldChange(index, 'fuel_station_income_category', catId)
      return
    }
    onFieldChange(index, '__entity_bundle__', applyFuelCategoryToInvoiceLine(line, cat))
  }

  if (!showHeadOffice && stations.length === 0 && ponds.length === 0) return null

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-dashed border-slate-200 pt-2">
      <div className="min-w-[12rem] flex-1">
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Entity (selling site / pond)
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
          <label className="block text-xs font-medium text-gray-700 mb-1">Income tag (reporting)</label>
          <ReportingCategoryCombobox
            categories={pondCategories}
            value={line.aquaculture_income_category || ''}
            onChange={handlePondCategory}
            className={selectClassName}
            placeholder={categoriesLoading ? 'Loading income types…' : 'Search income type…'}
            emptyLabel="— Select income type —"
          />
        </div>
      ) : null}
      {showCategory && entityKind === 'station' ? (
        <div className="min-w-[12rem] flex-1">
          <label className="block text-xs font-medium text-gray-700 mb-1">Income tag (reporting)</label>
          <ReportingCategoryCombobox
            categories={stationCategories}
            value={line.fuel_station_income_category || ''}
            onChange={handleFuelCategory}
            className={selectClassName}
            placeholder={categoriesLoading ? 'Loading income categories…' : 'Search income category…'}
            emptyLabel="— Select income category —"
          />
        </div>
      ) : null}
    </div>
  )
}
