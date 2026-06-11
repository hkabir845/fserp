/** Sales / Purchase report: Fuel forecourt vs Aquaculture shop hub (e.g. Premium Agro). */
export type ReportBusinessSegment = 'all' | 'fuel' | 'aquaculture'

export const REPORT_BUSINESS_SEGMENT_STORAGE_KEY = 'fserp_report_business_segment'

export type ReportStationForSegment = {
  id: number
  station_name: string
  operates_fuel_retail?: boolean
  business_kind?: 'fuel_station' | 'shop_hub'
  business_kind_label?: string
}

export function parseReportBusinessSegment(raw: string | null | undefined): ReportBusinessSegment {
  const s = (raw || '').trim().toLowerCase()
  if (s === 'fuel' || s === 'aquaculture') return s
  return 'all'
}

export function segmentAvailability(stations: ReportStationForSegment[]) {
  const fuel = stations.filter((s) => s.operates_fuel_retail !== false)
  const shop = stations.filter((s) => s.operates_fuel_retail === false)
  const premium = shop.find((s) => (s.station_name || '').trim().toLowerCase() === 'premium agro')
  const aquacultureLabel = premium
    ? `Aquaculture (${premium.station_name})`
    : shop.length === 1
      ? `Aquaculture (${shop[0].station_name})`
      : shop.length > 1
        ? 'Aquaculture (Shop hubs)'
        : 'Aquaculture (Premium Agro)'
  return {
    hasFuel: fuel.length > 0,
    hasAquaculture: shop.length > 0,
    fuelStationNames: fuel.map((s) => s.station_name),
    aquacultureStationNames: shop.map((s) => s.station_name),
    aquacultureLabel,
    premiumAgroStationId: premium?.id ?? shop[0]?.id ?? null,
  }
}

export function inferSegmentFromHomeStation(
  stations: ReportStationForSegment[],
  homeStationId: number | null | undefined
): ReportBusinessSegment | null {
  if (homeStationId == null) return null
  const st = stations.find((s) => s.id === homeStationId)
  if (!st) return null
  return st.operates_fuel_retail === false ? 'aquaculture' : 'fuel'
}
