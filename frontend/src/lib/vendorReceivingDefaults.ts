/**
 * Vendor receiving defaults — mirrors backend receipt_station_id_for_vendor().
 * One vendor record per supplier; bill-level station/pond can differ each time.
 */

export interface VendorReceivingFields {
  default_station_id?: number | null
  default_aquaculture_pond_id?: number | null
  default_station_name?: string | null
  default_aquaculture_pond_name?: string | null
}

export interface StationForVendorReceiving {
  id: number
  is_active?: boolean
  default_aquaculture_pond_id?: number | null
}

/** Receipt station id for a new bill, or '' when none applies. */
export function resolveReceiptStationIdForVendor(
  vendor: VendorReceivingFields | null | undefined,
  stations: StationForVendorReceiving[]
): number | '' {
  if (!vendor) return ''
  const active = stations.filter((s) => s.is_active !== false)
  const ds = vendor.default_station_id
  if (ds != null && ds > 0 && active.some((s) => s.id === ds)) {
    return ds
  }
  const pid = vendor.default_aquaculture_pond_id
  if (pid != null && pid > 0) {
    const linked = active.find((s) => s.default_aquaculture_pond_id === pid)
    if (linked) return linked.id
  }
  return ''
}

export function vendorUsualReceivingLabel(vendor: VendorReceivingFields): string {
  const pond = (vendor.default_aquaculture_pond_name || '').trim()
  if (pond) return pond
  const site = (vendor.default_station_name || '').trim()
  if (site) return site
  return ''
}

export function vendorUsualReceivingSummary(vendor: VendorReceivingFields): string | null {
  const label = vendorUsualReceivingLabel(vendor)
  if (!label) return null
  if (vendor.default_aquaculture_pond_id != null && vendor.default_aquaculture_pond_id > 0) {
    return `Usual delivery: pond “${label}” (change on each bill if needed).`
  }
  return `Usual delivery: site “${label}” (change on each bill if needed).`
}
