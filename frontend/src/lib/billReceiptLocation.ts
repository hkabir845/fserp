/**
 * Vendor bill receiving location — fuel/shop stations plus aquaculture ponds.
 * Pond keys use the same `p:{id}` format as Reports → Site scope.
 */

import type { BillPurpose } from '@/lib/billAllocation'
import { formatPondScopeKey, parseReportSiteScopeKey } from '@/app/reports/reportSiteScope'

export { formatPondScopeKey, parseReportSiteScopeKey as parseBillReceiptLocationKey }

export interface BillReceiptLocationStation {
  id: number
  station_name: string
  station_number?: string
  default_aquaculture_pond_id?: number | null
  operates_fuel_retail?: boolean
  is_active?: boolean
}

export interface BillReceiptLocationPond {
  id: number
  name: string
  pond_role?: string
  is_active?: boolean
}

export interface ResolvedBillReceiptLocation {
  locationKey: string
  receiptStationId: number | null
  billPurpose: BillPurpose
  headerPondId: number | null
}

/** Default shop hub when a pond is selected (mirrors backend resolve_shop_station_for_pond). */
export function resolveShopStationIdForPond(
  pondId: number,
  stations: BillReceiptLocationStation[]
): number | null {
  const active = stations.filter((s) => s.is_active !== false)
  const linked = active.find((s) => s.default_aquaculture_pond_id === pondId)
  if (linked) return linked.id
  const shop = active.find((s) => s.operates_fuel_retail === false)
  if (shop) return shop.id
  const named = active.find((s) => s.station_name.trim().toLowerCase() === 'premium agro')
  if (named) return named.id
  return active[0]?.id ?? null
}

export function resolveBillReceiptLocation(
  locationKey: string,
  stations: BillReceiptLocationStation[],
  ponds: BillReceiptLocationPond[]
): ResolvedBillReceiptLocation {
  const key = (locationKey || '').trim()
  if (!key) {
    return {
      locationKey: '',
      receiptStationId: null,
      billPurpose: 'station',
      headerPondId: null,
    }
  }
  const scope = parseReportSiteScopeKey(key)
  if (scope.kind === 'pond' && ponds.some((p) => p.id === scope.id)) {
    return {
      locationKey: formatPondScopeKey(scope.id),
      receiptStationId: resolveShopStationIdForPond(scope.id, stations),
      billPurpose: 'pond',
      headerPondId: scope.id,
    }
  }
  if (scope.kind === 'station' && stations.some((s) => s.id === scope.id)) {
    return {
      locationKey: String(scope.id),
      receiptStationId: scope.id,
      billPurpose: 'station',
      headerPondId: null,
    }
  }
  return {
    locationKey: key,
    receiptStationId: null,
    billPurpose: 'station',
    headerPondId: null,
  }
}

export function resolveReceiptLocationKeyForVendor(
  vendor: {
    default_station_id?: number | null
    default_aquaculture_pond_id?: number | null
  } | null
  | undefined,
  stations: BillReceiptLocationStation[],
  ponds: BillReceiptLocationPond[] = []
): string {
  if (!vendor) return ''
  const activeStations = stations.filter((s) => s.is_active !== false)
  const activePonds = ponds.filter((p) => p.is_active !== false)
  const pid = vendor.default_aquaculture_pond_id
  if (pid != null && pid > 0 && activePonds.some((p) => p.id === pid)) {
    return formatPondScopeKey(pid)
  }
  const ds = vendor.default_station_id
  if (ds != null && ds > 0 && activeStations.some((s) => s.id === ds)) {
    return String(ds)
  }
  if (pid != null && pid > 0) {
    const linked = activeStations.find((s) => s.default_aquaculture_pond_id === pid)
    if (linked) return String(linked.id)
  }
  return ''
}

export function inferReceiptLocationKeyFromBill(args: {
  billPurpose: BillPurpose
  receiptStationId?: number | null
  lines: { aquaculture_pond_id?: number | '' | null }[]
  stations: BillReceiptLocationStation[]
  ponds: BillReceiptLocationPond[]
}): string {
  const { billPurpose, receiptStationId, lines, stations, ponds } = args
  if (billPurpose === 'pond') {
    const pondIds = new Set<number>()
    for (const line of lines) {
      const raw = line.aquaculture_pond_id
      if (raw !== '' && raw != null && Number(raw) > 0) pondIds.add(Number(raw))
    }
    if (pondIds.size === 1) {
      const pid = [...pondIds][0]
      if (ponds.some((p) => p.id === pid)) return formatPondScopeKey(pid)
    }
  }
  if (receiptStationId != null && receiptStationId > 0 && stations.some((s) => s.id === receiptStationId)) {
    return String(receiptStationId)
  }
  return ''
}

export function receiptLocationDisplayLabel(
  locationKey: string,
  stations: BillReceiptLocationStation[],
  ponds: BillReceiptLocationPond[]
): string {
  const key = (locationKey || '').trim()
  if (!key) return ''
  const scope = parseReportSiteScopeKey(key)
  if (scope.kind === 'pond') {
    const pond = ponds.find((p) => p.id === scope.id)
    return pond?.name?.trim() || `Pond #${scope.id}`
  }
  if (scope.kind === 'station') {
    const st = stations.find((s) => s.id === scope.id)
    const name = st?.station_name?.trim() || `Station #${scope.id}`
    return st?.station_number ? `${name} (${st.station_number})` : name
  }
  return key
}

export interface BillLinePondTagFields {
  aquaculture_pond_id?: number | '' | null
  aquaculture_production_cycle_id?: number | '' | null
  aquaculture_expense_category?: string
  aquaculture_cost_mode?: string
  shared_equal_pond_ids?: number[]
  pond_shares?: { pond_id: number | ''; amount: number | string }[]
}

export function applyHeaderPondToBillLines<T extends BillLinePondTagFields>(
  lines: T[],
  pondId: number,
  isFishLine: (line: T) => boolean
): T[] {
  return lines.map((line) => {
    if (isFishLine(line)) return line
    if (line.aquaculture_cost_mode === 'shared_equal' || line.aquaculture_cost_mode === 'shared_manual') {
      return line
    }
    const cur = line.aquaculture_pond_id
    if (cur !== '' && cur != null && Number(cur) > 0) return line
    return { ...line, aquaculture_pond_id: pondId }
  })
}

export function clearPondTagsFromNonFishLines<T extends BillLinePondTagFields>(
  lines: T[],
  isFishLine: (line: T) => boolean
): T[] {
  return lines.map((line) => {
    if (isFishLine(line)) return line
    return {
      ...line,
      aquaculture_pond_id: '',
      aquaculture_production_cycle_id: '',
      aquaculture_expense_category: undefined,
      aquaculture_cost_mode: undefined,
      shared_equal_pond_ids: undefined,
      pond_shares: undefined,
    }
  })
}

export function headerPondIdFromLocationKey(locationKey: string): number | null {
  const scope = parseReportSiteScopeKey(locationKey)
  return scope.kind === 'pond' ? scope.id : null
}
