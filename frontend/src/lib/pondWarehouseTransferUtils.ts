/** Shared helpers for shop → pond warehouse moves (ItemPondStock). */

export type PondListItem = { id: number; name: string; sort_order: number; is_active: boolean }

export type TransferStation = {
  id: number
  station_name: string
  station_number?: string
  is_active?: boolean
  default_aquaculture_pond_id?: number | null
  default_aquaculture_pond_name?: string
  default_aquaculture_pond_sort_order?: number | null
}

export type PosTransferItem = {
  id: number
  name: string
  item_number?: string
  pos_category?: string
}

export type TransferLineRow = { item_id: number; quantity: string }

export type AvailabilityResponse =
  | {
      item_id: number
      name: string
      tracks_per_station: true
      unit: string
      total_on_hand: string
      stations: { station_id: number; station_name: string; station_number: string; quantity: string }[]
      pond_warehouses?: { pond_id: number; pond_name: string; quantity: string }[]
    }
  | {
      item_id: number
      name: string
      tracks_per_station: false
      message?: string
      stations: unknown[]
    }

export type ItemAvailState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: AvailabilityResponse }
  | { status: 'error'; message: string }

export function parseQtyInput(raw: string): number {
  const n = parseFloat(String(raw).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : NaN
}

export function qtyAtSourceStation(
  data: AvailabilityResponse,
  fromStationId: number,
): { qtyNum: number; unit: string } {
  if (!data.tracks_per_station) return { qtyNum: 0, unit: '' }
  const row = data.stations.find((s) => s.station_id === fromStationId)
  const q = parseFloat(String(row?.quantity ?? '0').replace(/,/g, ''))
  return {
    qtyNum: Number.isFinite(q) ? q : 0,
    unit: (data.unit || 'units').trim() || 'units',
  }
}

export function sumQtySameItemOtherLines(
  rows: TransferLineRow[],
  itemId: number,
  exceptIndex: number,
): number {
  let sum = 0
  rows.forEach((r, j) => {
    if (j === exceptIndex || r.item_id !== itemId) return
    const q = parseQtyInput(r.quantity)
    if (q > 0) sum += q
  })
  return sum
}

export function formatStationTransferLabel(s: TransferStation): string {
  const pond = (s.default_aquaculture_pond_name || '').trim()
  const nm = (s.station_name || '').trim() || 'Station'
  const num = s.station_number ? ` (${s.station_number})` : ''
  if (!pond) return `${nm}${num}`
  const same = pond.localeCompare(nm, undefined, { sensitivity: 'accent' }) === 0
  if (same) return `${pond}${num}`
  return `${pond} — ${nm}${num}`
}

export function comparePondsForTransfer(a: PondListItem, b: PondListItem): number {
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
  return a.id - b.id
}

export function pondWarehouseShelfLabel(pos: string | undefined): string {
  const labels: Record<string, string> = {
    feed: 'Feed',
    fish: 'Fish & fingerlings',
    medicine: 'Medicine & treatment',
    general: 'General & supplies',
  }
  const k = (pos || 'general').toLowerCase()
  return labels[k] || k.replace(/_/g, ' ')
}

export function readUserHomeStationId(): number | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem('user')
  if (!raw || raw === 'null' || raw === 'undefined') return null
  try {
    const u = JSON.parse(raw) as { home_station_id?: unknown }
    if (u?.home_station_id == null || String(u.home_station_id).trim() === '') return null
    const id = Number(u.home_station_id)
    return Number.isFinite(id) && id > 0 ? id : null
  } catch {
    return null
  }
}

export function defaultStationForPond(
  stations: TransferStation[],
  pondId: number,
  homeStationId: number | null,
): number | '' {
  const active = stations.filter((s) => s.is_active !== false)
  if (homeStationId != null && active.some((s) => s.id === homeStationId)) {
    return homeStationId
  }
  const linked = active.find((s) => s.default_aquaculture_pond_id === pondId)
  if (linked) return linked.id
  if (active.length === 1) return active[0].id
  return active[0]?.id ?? ''
}

export function validatePondWarehouseLines(args: {
  stationId: number | ''
  pondId: number | ''
  lineRows: TransferLineRow[]
  itemAvail: Record<number, ItemAvailState>
}): string[] {
  const issues: string[] = []
  const { stationId, pondId, lineRows, itemAvail } = args
  if (!stationId) issues.push('Select the shop site that holds the stock.')
  if (!pondId) issues.push('Select the destination pond.')
  if (!stationId || !pondId) return issues

  const validLines = lineRows
    .map((r, i) => ({ ...r, i, q: parseQtyInput(r.quantity) }))
    .filter((x) => x.item_id > 0)
  if (!validLines.length) {
    issues.push('Add at least one product with a quantity greater than zero.')
    return issues
  }

  for (const row of validLines) {
    if (!Number.isFinite(row.q) || row.q <= 0) {
      issues.push(`Line ${row.i + 1}: enter a quantity greater than zero.`)
      continue
    }
    const st = itemAvail[row.item_id]
    if (!st || st.status === 'loading') {
      issues.push(`Line ${row.i + 1}: loading shop stock…`)
      continue
    }
    if (st.status === 'error') {
      issues.push(`Line ${row.i + 1}: ${st.message}`)
      continue
    }
    if (st.status !== 'ok') continue
    const data = st.data
    if (!data.tracks_per_station) {
      issues.push(`Line ${row.i + 1}: "${data.name}" is not tracked in shop bins.`)
      continue
    }
    const { qtyNum, unit } = qtyAtSourceStation(data, stationId)
    const others = sumQtySameItemOtherLines(lineRows, row.item_id, row.i)
    const maxForLine = qtyNum - others
    if (qtyNum <= 0 && row.q > 0) {
      issues.push(`Line ${row.i + 1}: no stock at this shop for "${data.name}".`)
    } else if (row.q > maxForLine + 1e-9) {
      issues.push(
        `Line ${row.i + 1}: max ${Math.max(0, maxForLine).toLocaleString()} ${unit} at shop` +
          (others > 0 ? ` (${others.toLocaleString()} ${unit} on other lines)` : '') +
          '.',
      )
    }
  }
  return issues
}
