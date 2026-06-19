import type { AquacultureBillExpenseCategory } from '@/lib/aquacultureBillLine'
import type { FuelStationBillExpenseCategory } from '@/lib/fuelStationBillLine'
import { isShopHubStationId } from '@/utils/stationCapabilities'

export type BillPurpose = 'station' | 'pond' | 'office' | 'mixed'

export type PondCostMode = 'direct' | 'shared_equal' | 'shared_manual'
export type StationCostMode = 'direct' | 'shared_equal' | 'shared_manual'

export interface BillLineAllocationFields {
  item_id?: number
  aquaculture_pond_id?: number | '' | null
  aquaculture_expense_category?: string
  aquaculture_cost_mode?: PondCostMode
  shared_equal_pond_ids?: number[]
  pond_shares?: { pond_id: number | ''; amount: number | string }[]
  fuel_station_expense_category?: string
  station_cost_mode?: StationCostMode
  shared_equal_station_ids?: number[]
  station_shares?: { station_id: number | ''; amount: number | string }[]
  line_receipt_station_id?: number | '' | null
  amount: number
}

export function billLinePondCostMode(line: BillLineAllocationFields): PondCostMode {
  return line.aquaculture_cost_mode || 'direct'
}

export function billLineStationCostMode(line: BillLineAllocationFields): StationCostMode {
  return line.station_cost_mode || 'direct'
}

export function inferBillPurposeFromLines(
  lines: BillLineAllocationFields[],
  headerStationId: number | '' | null | undefined,
  hasPonds: boolean,
  stations: { id: number; operates_fuel_retail?: boolean }[] = []
): BillPurpose {
  for (const line of lines) {
    const pond =
      line.aquaculture_pond_id !== '' &&
      line.aquaculture_pond_id != null &&
      Number.isFinite(Number(line.aquaculture_pond_id))
    if (pond) return 'pond'
    if (
      billLinePondCostMode(line) === 'shared_equal' ||
      billLinePondCostMode(line) === 'shared_manual' ||
      line.aquaculture_expense_category
    ) {
      return 'pond'
    }
    const stRaw = line.line_receipt_station_id
    const stId =
      stRaw !== '' && stRaw != null && Number.isFinite(Number(stRaw)) ? Number(stRaw) : null
    if (stId && isShopHubStationId(stId, stations)) return 'pond'
    if (
      billLineStationCostMode(line) === 'shared_equal' ||
      billLineStationCostMode(line) === 'shared_manual' ||
      (line.fuel_station_expense_category || '').trim()
    ) {
      return 'station'
    }
    if (stId) return 'station'
  }
  if (headerStationId !== '' && headerStationId != null && Number.isFinite(Number(headerStationId))) {
    const hid = Number(headerStationId)
    if (isShopHubStationId(hid, stations)) return 'pond'
    return 'station'
  }
  return hasPonds ? 'station' : 'office'
}

export function inferBillPurposeIncludingMixed(
  lines: BillLineAllocationFields[],
  headerStationId: number | '' | null | undefined,
  hasPonds: boolean,
  stations: { id: number; operates_fuel_retail?: boolean }[] = []
): BillPurpose {
  let hasPond = false
  let hasStation = false
  for (const line of lines) {
    const pond =
      line.aquaculture_pond_id !== '' &&
      line.aquaculture_pond_id != null &&
      Number.isFinite(Number(line.aquaculture_pond_id))
    if (pond) hasPond = true
    if (
      billLinePondCostMode(line) === 'shared_equal' ||
      billLinePondCostMode(line) === 'shared_manual' ||
      line.aquaculture_expense_category
    ) {
      hasPond = true
    }
    const stRaw = line.line_receipt_station_id
    const stId =
      stRaw !== '' && stRaw != null && Number.isFinite(Number(stRaw)) ? Number(stRaw) : null
    if (stId && isShopHubStationId(stId, stations)) hasPond = true
    if (
      billLineStationCostMode(line) === 'shared_equal' ||
      billLineStationCostMode(line) === 'shared_manual' ||
      (line.fuel_station_expense_category || '').trim()
    ) {
      hasStation = true
    }
    if (stId && !isShopHubStationId(stId, stations)) hasStation = true
  }
  if (hasPond && hasStation) return 'mixed'
  if (hasPond) return 'pond'
  if (hasStation) return 'station'
  if (headerStationId !== '' && headerStationId != null && Number.isFinite(Number(headerStationId))) {
    const hid = Number(headerStationId)
    if (isShopHubStationId(hid, stations)) return 'pond'
    return 'station'
  }
  return hasPonds ? 'station' : 'office'
}

export function validateBillLinePondAllocation(
  line: BillLineAllocationFields,
  lineIndex: number,
  isFishLine: boolean,
  stations: { id: number; operates_fuel_retail?: boolean }[] = []
): string | null {
  const n = lineIndex + 1
  const mode = billLinePondCostMode(line)
  if (mode !== 'direct' && isFishLine) {
    return `Line ${n}: fish lines must use one pond (direct), not shared split.`
  }
  if (mode === 'direct') {
    const pond =
      line.aquaculture_pond_id !== '' &&
      line.aquaculture_pond_id != null &&
      Number.isFinite(Number(line.aquaculture_pond_id))
    if (pond && !line.item_id && !line.aquaculture_expense_category) {
      return `Line ${n}: choose a pond expense category (or pick an inventory item for feed/medicine/fry).`
    }
    const stRaw = line.line_receipt_station_id
    const stId =
      stRaw !== '' && stRaw != null && Number.isFinite(Number(stRaw)) ? Number(stRaw) : null
    if (
      !pond &&
      stId &&
      isShopHubStationId(stId, stations) &&
      !line.item_id &&
      !line.aquaculture_expense_category
    ) {
      return `Line ${n}: choose an aquaculture expense category for the shop hub (or pick a feed/medicine item).`
    }
    return null
  }
  if (!line.item_id && !line.aquaculture_expense_category) {
    return `Line ${n}: choose a pond expense category for shared split lines.`
  }
  const amt = Number(line.amount)
  if (!Number.isFinite(amt) || amt <= 0) {
    return `Line ${n}: enter a line amount before splitting across ponds.`
  }
  if (mode === 'shared_equal') {
    const ids = (line.shared_equal_pond_ids || []).filter((id) => Number.isFinite(id) && id > 0)
    if (ids.length < 2) return `Line ${n}: select at least two ponds for equal split.`
    return null
  }
  const rows = line.pond_shares || []
  const valid = rows.filter(
    (r) =>
      r.pond_id !== '' &&
      r.pond_id != null &&
      Number.isFinite(Number(r.pond_id)) &&
      Number(r.amount) > 0
  )
  if (valid.length < 2) return `Line ${n}: manual split needs at least two ponds with amounts.`
  const sum = valid.reduce((s, r) => s + Number(r.amount), 0)
  if (Math.abs(sum - amt) > 0.009) {
    return `Line ${n}: manual pond amounts must sum to the line amount (${amt.toFixed(2)}).`
  }
  return null
}

export function validateBillLineStationAllocation(
  line: BillLineAllocationFields,
  lineIndex: number,
  billPurpose: BillPurpose
): string | null {
  if (billPurpose === 'office') return null
  if (billPurpose === 'mixed') {
    const hasPond =
      line.aquaculture_pond_id !== '' &&
      line.aquaculture_pond_id != null &&
      Number.isFinite(Number(line.aquaculture_pond_id))
    if (hasPond) return null
  }
  if (billPurpose !== 'station' && billPurpose !== 'mixed') return null
  const n = lineIndex + 1
  const mode = billLineStationCostMode(line)
  const hasPond =
    line.aquaculture_pond_id !== '' &&
    line.aquaculture_pond_id != null &&
    Number.isFinite(Number(line.aquaculture_pond_id))
  if (hasPond) {
    return `Line ${n}: station bills cannot tag a pond on the same line.`
  }
  if (mode === 'direct') {
    return null
  }
  const amt = Number(line.amount)
  if (!Number.isFinite(amt) || amt <= 0) {
    return `Line ${n}: enter a line amount before splitting across stations.`
  }
  if (mode === 'shared_equal') {
    const ids = (line.shared_equal_station_ids || []).filter((id) => Number.isFinite(id) && id > 0)
    if (ids.length < 2) return `Line ${n}: select at least two stations for equal split.`
    return null
  }
  const rows = line.station_shares || []
  const valid = rows.filter(
    (r) =>
      r.station_id !== '' &&
      r.station_id != null &&
      Number.isFinite(Number(r.station_id)) &&
      Number(r.amount) > 0
  )
  if (valid.length < 2) return `Line ${n}: manual split needs at least two stations with amounts.`
  const sum = valid.reduce((s, r) => s + Number(r.amount), 0)
  if (Math.abs(sum - amt) > 0.009) {
    return `Line ${n}: manual station amounts must sum to the line amount (${amt.toFixed(2)}).`
  }
  return null
}

export function pondSharePayload(line: BillLineAllocationFields): Record<string, unknown> {
  const mode = billLinePondCostMode(line)
  if (mode === 'shared_equal') {
    const ids = (line.shared_equal_pond_ids || []).filter((id) => Number.isFinite(id) && id > 0)
    return {
      aquaculture_cost_mode: 'shared_equal',
      aquaculture_pond_id: null,
      aquaculture_production_cycle_id: null,
      shared_equal_pond_ids: ids,
    }
  }
  if (mode === 'shared_manual') {
    const shares = (line.pond_shares || [])
      .filter(
        (r) =>
          r.pond_id !== '' &&
          r.pond_id != null &&
          Number.isFinite(Number(r.pond_id)) &&
          Number(r.amount) > 0
      )
      .map((r) => ({
        pond_id: Number(r.pond_id),
        amount: Number(r.amount).toFixed(2),
      }))
    return {
      aquaculture_cost_mode: 'shared_manual',
      aquaculture_pond_id: null,
      aquaculture_production_cycle_id: null,
      pond_shares: shares,
    }
  }
  return {}
}

export function stationSharePayload(line: BillLineAllocationFields): Record<string, unknown> {
  const mode = billLineStationCostMode(line)
  if (mode === 'shared_equal') {
    const ids = (line.shared_equal_station_ids || []).filter((id) => Number.isFinite(id) && id > 0)
    return {
      station_cost_mode: 'shared_equal',
      line_receipt_station_id: null,
      shared_equal_station_ids: ids,
    }
  }
  if (mode === 'shared_manual') {
    const shares = (line.station_shares || [])
      .filter(
        (r) =>
          r.station_id !== '' &&
          r.station_id != null &&
          Number.isFinite(Number(r.station_id)) &&
          Number(r.amount) > 0
      )
      .map((r) => ({
        station_id: Number(r.station_id),
        amount: Number(r.amount).toFixed(2),
      }))
    return {
      station_cost_mode: 'shared_manual',
      line_receipt_station_id: null,
      station_shares: shares,
    }
  }
  const ls = line.line_receipt_station_id
  if (ls !== '' && ls != null && Number.isFinite(Number(ls))) {
    return { station_cost_mode: 'direct', line_receipt_station_id: Number(ls) }
  }
  return { station_cost_mode: 'direct' }
}

export type { AquacultureBillExpenseCategory, FuelStationBillExpenseCategory }
