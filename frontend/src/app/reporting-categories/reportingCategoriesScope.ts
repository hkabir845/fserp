import { formatPondScopeKey, formatHeadOfficeScopeKey, parseReportSiteScopeKey } from '@/app/reports/reportSiteScope'
import type { ReportStationForSegment } from '@/app/reports/reportBusinessSegment'

export type ReportingApplication = 'aquaculture' | 'fuel_station'
export type ReportingKind = 'expense' | 'income'

/** Scope key: '' = all, `ho` = head office, plain id = station, `p:{id}` = pond. */
export function applicationForScope(
  scopeKey: string,
  stations: ReportStationForSegment[]
): ReportingApplication | null {
  const scope = parseReportSiteScopeKey(scopeKey)
  if (scope.kind === 'all') return null
  if (scope.kind === 'head_office') return 'fuel_station'
  if (scope.kind === 'pond') return 'aquaculture'
  const st = stations.find((s) => s.id === scope.id)
  if (!st) return 'aquaculture'
  return st.operates_fuel_retail === false ? 'aquaculture' : 'fuel_station'
}

export function scopeDisplayLabel(
  scopeKey: string,
  stations: ReportStationForSegment[],
  ponds: { id: number; name: string }[],
  companyName?: string
): string {
  const scope = parseReportSiteScopeKey(scopeKey)
  if (scope.kind === 'all') return 'All entities'
  if (scope.kind === 'head_office') {
    return companyName?.trim() ? `Head office (${companyName.trim()})` : 'Head office'
  }
  if (scope.kind === 'station') {
    return stations.find((s) => s.id === scope.id)?.station_name?.trim() || `Station #${scope.id}`
  }
  return ponds.find((p) => p.id === scope.id)?.name?.trim() || `Pond #${scope.id}`
}

export function scopeContextBlurb(
  scopeKey: string,
  stations: ReportStationForSegment[]
): string {
  const scope = parseReportSiteScopeKey(scopeKey)
  if (scope.kind === 'all') {
    return 'View and manage custom income and expense labels for every entity — head office, fuel stations, shop hubs, and ponds.'
  }
  if (scope.kind === 'head_office') {
    return 'Head office categories apply to company-wide costs with no station or pond tag — admin, treasury, and general overhead.'
  }
  if (scope.kind === 'pond') {
    return 'Aquaculture pond categories roll into built-in P&L types for pond expenses, fish sales, and posted GL.'
  }
  const st = stations.find((s) => s.id === scope.id)
  if (st?.operates_fuel_retail === false) {
    return `Shop / aquaculture hub (${st.station_name}) — categories for pond-linked P&L, vendor bills, and sales.`
  }
  if (st) {
    return `Fuel site (${st.station_name}) — tags for manual journal lines and fuel-station expense rollups.`
  }
  return 'Custom labels map to built-in rollups so accounting stays consistent.'
}

export function applicationLabel(app: ReportingApplication): string {
  return app === 'fuel_station' ? 'Fuel station' : 'Aquaculture'
}

export function kindLabel(kind: ReportingKind): string {
  return kind === 'expense' ? 'Expense' : 'Income'
}

/** Mirror backend `normalize_category_code` for live suggestions in the form. */
export function suggestCategoryCodeFromLabel(label: string): string {
  let s = label
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
  s = s.replace(/_+/g, '_').replace(/^_|_$/g, '')
  if (!s) return ''
  if (!/^[a-z]/.test(s)) s = `c_${s}`
  return s.slice(0, 64)
}

export function validateCategoryCodeClient(code: string): string | null {
  const s = code.trim()
  if (!s) return 'Code is required (or enter a label to auto-generate one).'
  if (s.length > 64) return 'Code must be at most 64 characters.'
  if (!/^[a-z][a-z0-9_]*$/.test(s)) {
    return 'Use lowercase letters, numbers, and underscores only; must start with a letter.'
  }
  return null
}

export interface ReportingMapTarget {
  id: string
  label: string
  hint?: string | null
  group?: string | null
  coa_code?: string | null
  manual_create_allowed?: boolean
  non_biological_sale?: boolean
}

export function groupReportingMapTargets(
  targets: ReportingMapTarget[]
): { group: string; items: ReportingMapTarget[] }[] {
  const order: string[] = []
  const buckets = new Map<string, ReportingMapTarget[]>()
  for (const t of targets) {
    const g = (t.group || '').trim()
    if (!buckets.has(g)) {
      order.push(g)
      buckets.set(g, [])
    }
    buckets.get(g)!.push(t)
  }
  return order.map((group) => ({
    group: group || 'Options',
    items: buckets.get(group)!,
  }))
}

export { formatPondScopeKey }
