/** Parsed value from Reports → Site scope (stations use plain id; ponds use `p:{id}`; head office uses `ho`). */
export type ReportSiteScope =
  | { kind: 'all' }
  | { kind: 'head_office' }
  | { kind: 'station'; id: number }
  | { kind: 'pond'; id: number }

export const HEAD_OFFICE_SCOPE_KEY = 'ho'

export function formatHeadOfficeScopeKey(): string {
  return HEAD_OFFICE_SCOPE_KEY
}

export function parseReportSiteScopeKey(key: string): ReportSiteScope {
  const k = key.trim()
  if (!k) return { kind: 'all' }
  if (k === HEAD_OFFICE_SCOPE_KEY) return { kind: 'head_office' }
  const pondMatch = /^p:(\d+)$/.exec(k)
  if (pondMatch) {
    const id = parseInt(pondMatch[1], 10)
    if (Number.isFinite(id) && id > 0) return { kind: 'pond', id }
  }
  if (/^\d+$/.test(k)) {
    const id = parseInt(k, 10)
    if (Number.isFinite(id) && id > 0) return { kind: 'station', id }
  }
  return { kind: 'all' }
}

/** Query params for API calls that accept Reports → Site scope (station id, p:{pondId}, or ho). */
export function reportScopeQueryParams(scopeKey: string): {
  station_id?: string
  pond_id?: string
  head_office?: string
} {
  const scope = parseReportSiteScopeKey(scopeKey)
  if (scope.kind === 'station') return { station_id: String(scope.id) }
  if (scope.kind === 'pond') return { pond_id: String(scope.id) }
  if (scope.kind === 'head_office') return { head_office: '1' }
  return {}
}

export type SiteScopeReportCapabilities = {
  /** GL / operational reports that accept pond_id */
  pond?: boolean
  /** Reports that accept station_id */
  station?: boolean
  /** GL reports that accept head_office=1 (unscoped journal lines) */
  headOffice?: boolean
}

/**
 * Apply Reports → Site scope to API query params (mutates `params` in place).
 * Explicit entity selection always wins over home-station defaults on the server.
 * Empty scope = all entities (company-wide where the API allows).
 */
export function applySiteScopeToReportParams(
  scopeKey: string,
  params: Record<string, string>,
  caps: SiteScopeReportCapabilities,
): void {
  const scope = parseReportSiteScopeKey(scopeKey.trim())
  delete params.station_id
  delete params.pond_id
  delete params.head_office
  if (scope.kind === 'pond' && caps.pond) {
    params.pond_id = String(scope.id)
    return
  }
  if (scope.kind === 'head_office' && caps.headOffice) {
    params.head_office = '1'
    return
  }
  if (scope.kind === 'station' && caps.station) {
    params.station_id = String(scope.id)
  }
}

export function formatPondScopeKey(pondId: number): string {
  return `p:${pondId}`
}

export function isPersistedReportSiteScopeKey(key: string): boolean {
  const k = key.trim()
  return k === '' || k === HEAD_OFFICE_SCOPE_KEY || /^\d+$/.test(k) || /^p:\d+$/.test(k)
}

export function isValidReportSiteScopeKey(
  key: string,
  stations: { id: number }[],
  ponds: { id: number }[]
): boolean {
  const scope = parseReportSiteScopeKey(key)
  if (scope.kind === 'all') return key.trim() === ''
  if (scope.kind === 'head_office') return key.trim() === HEAD_OFFICE_SCOPE_KEY
  if (scope.kind === 'station') return stations.some((s) => s.id === scope.id)
  return ponds.some((p) => p.id === scope.id)
}

type ScopeStation = { id: number; station_name: string }
type ScopePond = { id: number; name: string }

export type ReportTotalLabelOptions = {
  /** In-report aquaculture pond filter */
  aquaculturePondId?: string
  /** When the rendered set is a single entity (one row / one group) */
  singleName?: string | null
}

/** Footer label for scoped report totals — station or pond name when filtered, else "all …". */
export function resolveReportTotalLabel(
  entityKind: 'station' | 'pond',
  scopeKey: string,
  stations: ScopeStation[],
  ponds: ScopePond[],
  options?: ReportTotalLabelOptions
): string {
  const allText = entityKind === 'station' ? 'all stations' : 'all ponds'

  if (options?.singleName?.trim()) {
    return `Total — ${options.singleName.trim()}`
  }

  const pondFilter = options?.aquaculturePondId?.trim()
  if (entityKind === 'pond' && pondFilter && /^\d+$/.test(pondFilter)) {
    const id = parseInt(pondFilter, 10)
    const name = ponds.find((p) => p.id === id)?.name?.trim() || `Pond #${id}`
    return `Total — ${name}`
  }

  const scope = parseReportSiteScopeKey(scopeKey)
  if (entityKind === 'station' && scope.kind === 'station') {
    const name =
      stations.find((s) => s.id === scope.id)?.station_name?.trim() || `Station #${scope.id}`
    return `Total — ${name}`
  }
  if (entityKind === 'pond' && scope.kind === 'pond') {
    const name = ponds.find((p) => p.id === scope.id)?.name?.trim() || `Pond #${scope.id}`
    return `Total — ${name}`
  }

  return `Total — ${allText}`
}

export function resolveGrandTotalLabel(
  entityKind: 'station' | 'pond',
  scopeKey: string,
  stations: ScopeStation[],
  ponds: ScopePond[],
  options?: ReportTotalLabelOptions
): string {
  return resolveReportTotalLabel(entityKind, scopeKey, stations, ponds, options).replace(
    /^Total — /,
    'Grand total — '
  )
}

/** Site scope pond wins; otherwise optional in-report pond filter (only when scope is All). */
export function resolveEffectiveAquaculturePondId(
  scopeKey: string,
  aquaculturePondId: string
): string {
  const scope = parseReportSiteScopeKey(scopeKey)
  if (scope.kind === 'pond') return String(scope.id)
  const p = aquaculturePondId.trim()
  return /^\d+$/.test(p) ? p : ''
}

export function isPondLockedBySiteScope(scopeKey: string): boolean {
  return parseReportSiteScopeKey(scopeKey).kind === 'pond'
}
