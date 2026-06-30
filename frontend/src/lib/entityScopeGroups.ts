import {
  formatHeadOfficeScopeKey,
  formatPondScopeKey,
} from '@/app/reports/reportSiteScope'
import type { GroupedComboboxGroup } from '@/components/bills/SearchableGroupedCombobox'

export type EntityScopeStation = {
  id: number
  station_name: string
  station_number?: string
  operates_fuel_retail?: boolean
  is_active?: boolean
}

export type EntityScopePond = {
  id: number
  name: string
  pond_role?: string
  operational_display_name?: string
  is_active?: boolean
}

function pondRoleHint(role: string | undefined): string {
  const r = (role || '').trim().toLowerCase()
  if (r === 'nursing') return ' (nursing)'
  if (r === 'grow_out' || r === 'grow-out') return ' (grow-out)'
  return ''
}

export function partitionActiveBusinessEntities(
  stations: EntityScopeStation[],
  ponds: EntityScopePond[],
) {
  const activeStations = stations.filter((s) => s.is_active !== false)
  return {
    activeStations,
    fuelStations: activeStations.filter((s) => s.operates_fuel_retail !== false),
    shopHubs: activeStations.filter((s) => s.operates_fuel_retail === false),
    activePonds: ponds.filter((p) => p.is_active !== false),
  }
}

export function findOrphanEntitiesForScopeKey(
  value: string,
  stations: EntityScopeStation[],
  ponds: EntityScopePond[],
  activeStations: EntityScopeStation[],
  activePonds: EntityScopePond[],
) {
  const scopePond = value.startsWith('p:') ? parseInt(value.slice(2), 10) : NaN
  const scopeStation = /^\d+$/.test(value) ? parseInt(value, 10) : NaN
  const orphanPond =
    Number.isFinite(scopePond) && scopePond > 0 && !activePonds.some((p) => p.id === scopePond)
      ? ponds.find((p) => p.id === scopePond) ?? null
      : null
  const orphanStation =
    Number.isFinite(scopeStation) && scopeStation > 0 && !activeStations.some((s) => s.id === scopeStation)
      ? stations.find((s) => s.id === scopeStation) ?? null
      : null
  return { orphanPond, orphanStation }
}

/** Standard scope keys: `ho`, station id, or `p:{pondId}`. */
export function buildStandardEntityScopeGroups(opts: {
  stations: EntityScopeStation[]
  ponds: EntityScopePond[]
  value?: string
  showHeadOffice?: boolean
  companyName?: string
  stationValue?: (station: EntityScopeStation) => string
  pondValue?: (pond: EntityScopePond) => string
}): GroupedComboboxGroup[] {
  const {
    stations,
    ponds,
    value = '',
    showHeadOffice = true,
    companyName,
    stationValue = (s) => String(s.id),
    pondValue = (p) => formatPondScopeKey(p.id),
  } = opts

  const { activeStations, fuelStations, shopHubs, activePonds } = partitionActiveBusinessEntities(
    stations,
    ponds,
  )
  const { orphanPond, orphanStation } = findOrphanEntitiesForScopeKey(
    value,
    stations,
    ponds,
    activeStations,
    activePonds,
  )

  const headOfficeLabel = companyName?.trim()
    ? `Head office (${companyName.trim()})`
    : 'Head office / general'

  const out: GroupedComboboxGroup[] = []

  if (showHeadOffice) {
    out.push({
      label: 'Head office',
      options: [
        {
          value: formatHeadOfficeScopeKey(),
          label: headOfficeLabel,
          searchText: `head office ${companyName || ''} general ho`,
        },
      ],
    })
  }

  if (fuelStations.length > 0) {
    out.push({
      label: 'Fuel stations',
      options: fuelStations.map((s) => {
        const label = `${s.station_name}${s.station_number ? ` (${s.station_number})` : ''}`
        return {
          value: stationValue(s),
          label,
          searchText: `${s.station_name} ${s.station_number || ''} fuel station`,
        }
      }),
    })
  }

  if (shopHubs.length > 0) {
    out.push({
      label: 'Shop hubs',
      options: shopHubs.map((s) => {
        const label = `${s.station_name}${s.station_number ? ` (${s.station_number})` : ''}`
        return {
          value: stationValue(s),
          label,
          searchText: `${s.station_name} ${s.station_number || ''} shop hub agro premium`,
        }
      }),
    })
  }

  if (activePonds.length > 0) {
    out.push({
      label: 'Ponds',
      options: activePonds.map((p) => {
        const role = pondRoleHint(p.pond_role)
        const baseName = (p.operational_display_name || p.name || '').trim() || `Pond #${p.id}`
        const label = `${baseName}${role}`
        return {
          value: pondValue(p),
          label,
          searchText: `${baseName} ${p.name} ${p.pond_role || ''} pond grow nursing`,
        }
      }),
    })
  }

  const orphanOpts = []
  if (orphanStation) {
    orphanOpts.push({
      value: stationValue(orphanStation),
      label: `${orphanStation.station_name} (inactive)`,
      searchText: orphanStation.station_name,
    })
  }
  if (orphanPond) {
    orphanOpts.push({
      value: pondValue(orphanPond),
      label: `${orphanPond.name} (inactive)`,
      searchText: orphanPond.name,
    })
  }
  if (orphanOpts.length > 0) {
    out.push({ label: 'Other', options: orphanOpts })
  }

  return out
}
