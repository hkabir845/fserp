import api from '@/lib/api'

const STORAGE_STATION_ID = 'fserp_preferred_print_station_id'

export type PrintBranding = {
  companyName: string
  companyAddress?: string
  /** When empty, the station line is omitted on printouts. */
  stationName: string
}

type StationRow = { id?: unknown; name?: unknown; station_name?: unknown }

/**
 * Resolves default print branding: company from `/companies/current/`, station from
 * `/stations/` (single station, or preferred id in localStorage, or "All stations" when many).
 * Pass an explicit `stationNameOverride` when the document is for a specific location
 * (e.g. POS nozzle / shift).
 */
export async function loadPrintBranding(
  client: typeof api = api,
  stationNameOverride?: string | null
): Promise<PrintBranding> {
  const [coRes, stRes] = await Promise.all([
    client.get<Record<string, unknown>>('/companies/current/').catch(() => ({ data: null as null })),
    client.get<unknown>('/stations/').catch(() => ({ data: [] })),
  ])

  const d = coRes.data
  const label = [d?.name, d?.company_name]
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .find((s) => s.length > 0)
  const companyName = label || 'Company'
  const addr = d && typeof d.address === 'string' ? d.address.trim() : ''
  const companyAddress = addr || undefined

  const override = (stationNameOverride ?? '').trim()
  if (override) {
    return { companyName, companyAddress, stationName: override }
  }

  const raw = stRes.data
  const stations: StationRow[] = Array.isArray(raw) ? raw : []
  const list = stations
    .map((s) => ({
      id: typeof s.id === 'number' ? s.id : Number(s.id),
      name: String(s.name ?? s.station_name ?? '')
        .trim()
        .replace(/\s+/g, ' '),
    }))
    .filter((s) => s.name && Number.isFinite(s.id))

  let stationName = ''
  if (list.length === 1) {
    stationName = list[0].name
  } else if (list.length > 1) {
    let preferred: number | null = null
    if (typeof window !== 'undefined') {
      const rawId = localStorage.getItem(STORAGE_STATION_ID)
      const n = rawId != null ? parseInt(rawId, 10) : NaN
      if (Number.isFinite(n)) preferred = n
    }
    const pick = preferred != null ? list.find((s) => s.id === preferred) : null
    stationName = pick?.name ?? 'All stations'
  }

  return { companyName, companyAddress, stationName }
}

export function setPreferredPrintStationId(id: number | null): void {
  if (typeof window === 'undefined') return
  if (id == null) {
    localStorage.removeItem(STORAGE_STATION_ID)
  } else {
    localStorage.setItem(STORAGE_STATION_ID, String(id))
  }
}
