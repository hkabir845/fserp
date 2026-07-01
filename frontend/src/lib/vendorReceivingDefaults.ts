/**
 * Vendor receiving defaults — mirrors backend receipt_station_id_for_vendor().
 * One vendor record per supplier; bill-level station/pond can differ each time.
 */

import {
  resolveBillReceiptLocation,
  resolveReceiptLocationKeyForVendor,
  type BillReceiptLocationPond,
  type BillReceiptLocationStation,
} from '@/lib/billReceiptLocation'

export interface VendorReceivingFields {
  default_station_id?: number | null
  default_aquaculture_pond_id?: number | null
  default_station_name?: string | null
  default_aquaculture_pond_name?: string | null
}

export type StationForVendorReceiving = BillReceiptLocationStation

export { resolveReceiptLocationKeyForVendor }

/** Receipt location key for a new bill (`station id` or `p:{pondId}`), or '' when none applies. */
export function resolveReceiptLocationKeyForVendorBill(
  vendor: VendorReceivingFields | null | undefined,
  stations: BillReceiptLocationStation[],
  ponds: BillReceiptLocationPond[] = []
): string {
  return resolveReceiptLocationKeyForVendor(vendor, stations, ponds)
}

/** Legacy: numeric receipt station id only (pond selections resolve to linked shop hub). */
export function resolveReceiptStationIdForVendor(
  vendor: VendorReceivingFields | null | undefined,
  stations: BillReceiptLocationStation[],
  ponds: BillReceiptLocationPond[] = []
): number | '' {
  const key = resolveReceiptLocationKeyForVendor(vendor, stations, ponds)
  if (!key) return ''
  const resolved = resolveBillReceiptLocation(key, stations, ponds)
  return resolved.receiptStationId != null && resolved.receiptStationId > 0
    ? resolved.receiptStationId
    : ''
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
    return `Vendor usual site: pond “${label}” — pre-fills Charge to on your first line only.`
  }
  return `Vendor usual site: “${label}” — pre-fills Charge to on your first line only.`
}
