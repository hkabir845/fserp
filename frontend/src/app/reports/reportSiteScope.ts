/** Parsed value from Reports → Site scope (stations use plain id; ponds use `p:{id}`). */
export type ReportSiteScope =
  | { kind: 'all' }
  | { kind: 'station'; id: number }
  | { kind: 'pond'; id: number }

export function parseReportSiteScopeKey(key: string): ReportSiteScope {
  const k = key.trim()
  if (!k) return { kind: 'all' }
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

export function formatPondScopeKey(pondId: number): string {
  return `p:${pondId}`
}

export function isPersistedReportSiteScopeKey(key: string): boolean {
  const k = key.trim()
  return k === '' || /^\d+$/.test(k) || /^p:\d+$/.test(k)
}

export function isValidReportSiteScopeKey(
  key: string,
  stations: { id: number }[],
  ponds: { id: number }[]
): boolean {
  const scope = parseReportSiteScopeKey(key)
  if (scope.kind === 'all') return key.trim() === ''
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
