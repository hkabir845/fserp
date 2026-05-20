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
