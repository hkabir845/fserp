/**
 * Fuel forecourt vs aquaculture/shop-only station profile (`operates_fuel_retail` from `/stations/`).
 * Undefined treats as true so older cached payloads remain safe.
 */
export function stationHasFuelForecourt(station: { operates_fuel_retail?: boolean } | null | undefined): boolean {
  if (!station) return true
  return station.operates_fuel_retail !== false
}

export function filterFuelForecourtStations<T extends { operates_fuel_retail?: boolean }>(stations: T[]): T[] {
  return stations.filter((s) => stationHasFuelForecourt(s))
}

/** Aquaculture shop hub (e.g. Premium Agro) — sells feed/medicine/pond gear, not fuel. */
export function stationIsShopHub(
  station: { operates_fuel_retail?: boolean } | null | undefined
): boolean {
  return !stationHasFuelForecourt(station)
}

export function isShopHubStationId(
  stationId: number,
  stations: { id: number; operates_fuel_retail?: boolean }[]
): boolean {
  const st = stations.find((s) => s.id === stationId)
  return st != null && stationIsShopHub(st)
}
