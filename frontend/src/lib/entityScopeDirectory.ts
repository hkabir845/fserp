import api from '@/lib/api'
import type { BillReceiptLocationPond, BillReceiptLocationStation } from '@/lib/billReceiptLocation'
import { unwrapReferenceList } from '@/lib/pagination'

export function parseStationsFromApi(data: unknown): BillReceiptLocationStation[] {
  return unwrapReferenceList<Record<string, unknown>>(data)
    .map((s) => ({
      id: typeof s.id === 'number' ? s.id : Number(s.id),
      station_name: String(s.station_name || '').trim() || 'Station',
      station_number: s.station_number != null ? String(s.station_number) : undefined,
      default_aquaculture_pond_id:
        s.default_aquaculture_pond_id != null && s.default_aquaculture_pond_id !== ''
          ? Number(s.default_aquaculture_pond_id)
          : null,
      operates_fuel_retail: s.operates_fuel_retail !== false,
      is_active: s.is_active !== false,
    }))
    .filter((s) => Number.isFinite(s.id))
}

export function parsePondsFromApi(data: unknown): BillReceiptLocationPond[] {
  return unwrapReferenceList<Record<string, unknown>>(data)
    .map((p) => ({
      id: typeof p.id === 'number' ? p.id : Number(p.id),
      name: String(p.name || '').trim() || `Pond ${p.id}`,
      pond_role: String(p.pond_role || '').trim(),
      physical_site_name: String(p.physical_site_name || '').trim(),
      linked_grow_out_pond_id:
        p.linked_grow_out_pond_id != null && p.linked_grow_out_pond_id !== ''
          ? Number(p.linked_grow_out_pond_id)
          : null,
      nursing_display_name: String(p.nursing_display_name || '').trim(),
      grow_out_display_name: String(p.grow_out_display_name || '').trim(),
      operational_display_name: String(p.operational_display_name || '').trim(),
      is_active: p.is_active !== false,
    }))
    .filter((p) => Number.isFinite(p.id))
}

/** Stations + ponds for entity / receiving-location pickers (same data as bill line Entity tag). */
export async function fetchEntityScopeDirectory(): Promise<{
  stations: BillReceiptLocationStation[]
  ponds: BillReceiptLocationPond[]
}> {
  const [stationsRes, pondsRes] = await Promise.allSettled([
    api.get('/stations/'),
    api.get('/aquaculture/ponds/'),
  ])
  return {
    stations:
      stationsRes.status === 'fulfilled' ? parseStationsFromApi(stationsRes.value.data) : [],
    ponds: pondsRes.status === 'fulfilled' ? parsePondsFromApi(pondsRes.value.data) : [],
  }
}

/** GL manual journal entries — always includes ponds when company has them (no aquaculture API gate). */
export async function fetchJournalEntityScopeDirectory(): Promise<{
  stations: BillReceiptLocationStation[]
  ponds: BillReceiptLocationPond[]
}> {
  try {
    const res = await api.get<{ stations?: unknown; ponds?: unknown }>(
      '/journal-entries/entity-directory/',
      { timeout: 10000 }
    )
    const data = res.data
    return {
      stations: parseStationsFromApi(data?.stations ?? []),
      ponds: parsePondsFromApi(data?.ponds ?? []),
    }
  } catch {
    return fetchEntityScopeDirectory()
  }
}
