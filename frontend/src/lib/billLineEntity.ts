import {
  formatHeadOfficeScopeKey,
  formatPondScopeKey,
  HEAD_OFFICE_SCOPE_KEY,
  parseReportSiteScopeKey,
  reportScopeQueryParams,
} from '@/app/reports/reportSiteScope'
import type { BillPurpose } from '@/lib/billAllocation'

export type BillLineEntityFields = {
  aquaculture_pond_id?: number | '' | null
  line_receipt_station_id?: number | '' | null
  aquaculture_expense_category?: string
  fuel_station_expense_category?: string
  aquaculture_cost_mode?: string
  station_cost_mode?: string
  shared_equal_pond_ids?: number[]
  pond_shares?: { pond_id: number | ''; amount: number | string }[]
  shared_equal_station_ids?: number[]
  station_shares?: { station_id: number | ''; amount: number | string }[]
}

/** Scope key for a bill line: `ho` = head office, station id, or `p:{pondId}`. */
export function billLineEntityKey(line: BillLineEntityFields): string {
  const pond =
    line.aquaculture_pond_id !== '' &&
    line.aquaculture_pond_id != null &&
    Number.isFinite(Number(line.aquaculture_pond_id))
  if (pond) return formatPondScopeKey(Number(line.aquaculture_pond_id))
  const st =
    line.line_receipt_station_id !== '' &&
    line.line_receipt_station_id != null &&
    Number.isFinite(Number(line.line_receipt_station_id))
  if (st) return String(line.line_receipt_station_id)
  return formatHeadOfficeScopeKey()
}

export function billLineEntityKind(
  key: string
): 'office' | 'station' | 'pond' {
  const scope = parseReportSiteScopeKey(key)
  if (scope.kind === 'pond') return 'pond'
  if (scope.kind === 'station') return 'station'
  return 'office'
}

/** Apply entity selection to line fields; clears incompatible tags/categories. */
export function applyBillLineEntityKey<T extends BillLineEntityFields>(
  line: T,
  key: string
): T {
  const scope = parseReportSiteScopeKey(key)
  if (scope.kind === 'pond') {
    return {
      ...line,
      aquaculture_pond_id: scope.id,
      line_receipt_station_id: '',
      fuel_station_expense_category: '',
      station_cost_mode: 'direct',
      shared_equal_station_ids: [],
      station_shares: [],
    }
  }
  if (scope.kind === 'station') {
    return {
      ...line,
      line_receipt_station_id: scope.id,
      aquaculture_pond_id: '',
      aquaculture_expense_category: '',
      aquaculture_cost_mode: 'direct',
      shared_equal_pond_ids: [],
      pond_shares: [],
    }
  }
  return {
    ...line,
    aquaculture_pond_id: '',
    line_receipt_station_id: '',
    aquaculture_expense_category: '',
    fuel_station_expense_category: '',
    aquaculture_cost_mode: 'direct',
    station_cost_mode: 'direct',
    shared_equal_pond_ids: [],
    pond_shares: [],
    shared_equal_station_ids: [],
    station_shares: [],
  }
}

export function inferBillPurposeFromEntityLines(
  lines: BillLineEntityFields[],
  hasPonds: boolean
): BillPurpose {
  let hasPond = false
  let hasStation = false
  let hasOffice = false
  for (const line of lines) {
    const kind = billLineEntityKind(billLineEntityKey(line))
    if (kind === 'pond') hasPond = true
    if (kind === 'station') hasStation = true
    if (kind === 'office') hasOffice = true
    if ((line.fuel_station_expense_category || '').trim()) hasStation = true
    if (
      line.aquaculture_cost_mode === 'shared_equal' ||
      line.aquaculture_cost_mode === 'shared_manual' ||
      line.aquaculture_expense_category
    ) {
      hasPond = true
    }
    if (
      line.station_cost_mode === 'shared_equal' ||
      line.station_cost_mode === 'shared_manual'
    ) {
      hasStation = true
    }
  }
  if (hasPond && hasStation) return 'mixed'
  if (hasPond) return 'pond'
  if (hasStation) return 'station'
  if (hasOffice) return 'office'
  return hasPonds ? 'station' : 'office'
}

export function entityScopeKeyFromCategoryRow(row: {
  station_id?: number | null
  aquaculture_pond_id?: number | null
  head_office_only?: boolean | null
}): string {
  if (row.aquaculture_pond_id) return formatPondScopeKey(row.aquaculture_pond_id)
  if (row.station_id) return String(row.station_id)
  if (row.head_office_only) return formatHeadOfficeScopeKey()
  return ''
}

export function entityScopeParamsFromKey(key: string): {
  station_id?: string
  pond_id?: string
  head_office?: string
} {
  return reportScopeQueryParams(key)
}

export { HEAD_OFFICE_SCOPE_KEY, formatHeadOfficeScopeKey }

export function countBusinessEntities(stations: { operates_fuel_retail?: boolean }[], ponds: unknown[]): {
  headOffice: number
  fuelStations: number
  shopHubs: number
  ponds: number
  total: number
} {
  const fuelStations = stations.filter((s) => s.operates_fuel_retail !== false).length
  const shopHubs = stations.filter((s) => s.operates_fuel_retail === false).length
  const pondCount = ponds.length
  return {
    headOffice: 1,
    fuelStations,
    shopHubs,
    ponds: pondCount,
    total: 1 + stations.length + pondCount,
  }
}

export function formatEntityCountSummary(
  counts: ReturnType<typeof countBusinessEntities>
): string {
  const parts: string[] = ['1 head office']
  if (counts.fuelStations > 0) {
    parts.push(`${counts.fuelStations} fuel station${counts.fuelStations === 1 ? '' : 's'}`)
  }
  if (counts.shopHubs > 0) {
    parts.push(`${counts.shopHubs} shop hub${counts.shopHubs === 1 ? '' : 's'}`)
  }
  if (counts.ponds > 0) {
    parts.push(`${counts.ponds} pond${counts.ponds === 1 ? '' : 's'}`)
  }
  return `${counts.total} entit${counts.total === 1 ? 'y' : 'ies'}: ${parts.join(', ')}`
}
