import {
  formatHeadOfficeScopeKey,
  formatPondScopeKey,
  HEAD_OFFICE_SCOPE_KEY,
  parseReportSiteScopeKey,
} from '@/app/reports/reportSiteScope'
import type { JournalEntryDefaultEntity } from '@/utils/entityGlScoping'

export type JournalLineEntityFields = {
  station_id?: number | '' | null
  aquaculture_pond_id?: number | '' | null
}

/** Scope key from line fields only (no entry default): station id, `p:{pondId}`, or empty. */
export function journalLineEntityKeyExplicit(line: JournalLineEntityFields): string {
  const pond =
    line.aquaculture_pond_id !== '' &&
    line.aquaculture_pond_id != null &&
    Number.isFinite(Number(line.aquaculture_pond_id))
  if (pond) return formatPondScopeKey(Number(line.aquaculture_pond_id))
  const st =
    line.station_id !== '' && line.station_id != null && Number.isFinite(Number(line.station_id))
  if (st) return String(line.station_id)
  return ''
}

/** Effective entity for a line: explicit line tag, else entry default. */
export function resolveLineEffectiveEntityKey(
  line: JournalLineEntityFields,
  entryDefaultKey: string
): string {
  const explicit = journalLineEntityKeyExplicit(line)
  if (explicit) return explicit
  return entryDefaultKey.trim()
}

/** Apply entity selection to journal line station/pond fields. */
export function applyJournalLineEntityKey<T extends JournalLineEntityFields>(
  line: T,
  key: string
): T {
  const scope = parseReportSiteScopeKey(key)
  if (scope.kind === 'pond') {
    return {
      ...line,
      aquaculture_pond_id: scope.id,
      station_id: '',
    }
  }
  if (scope.kind === 'station') {
    return {
      ...line,
      station_id: scope.id,
      aquaculture_pond_id: '',
    }
  }
  return {
    ...line,
    station_id: '',
    aquaculture_pond_id: '',
  }
}

/** Default entity for journal entry header: `ho`, station id, `p:{pondId}`, or empty. */
export function parseJournalDefaultEntityKey(key: string): JournalEntryDefaultEntity {
  const scope = parseReportSiteScopeKey(key)
  if (scope.kind === 'station') {
    return { stationId: scope.id, pondId: '', isHeadOffice: false }
  }
  if (scope.kind === 'pond') {
    return { stationId: '', pondId: scope.id, isHeadOffice: false }
  }
  if (scope.kind === 'head_office') {
    return { stationId: '', pondId: '', isHeadOffice: true }
  }
  return { stationId: '', pondId: '', isHeadOffice: false }
}

export function formatJournalDefaultEntityKey(defaults: JournalEntryDefaultEntity): string {
  if (defaults.isHeadOffice) return formatHeadOfficeScopeKey()
  if (defaults.pondId !== '' && defaults.pondId != null) {
    return formatPondScopeKey(Number(defaults.pondId))
  }
  if (defaults.stationId !== '' && defaults.stationId != null) {
    return String(defaults.stationId)
  }
  return ''
}

type JournalEntryLike = {
  station_id?: number | null
  lines: Array<{ station_id?: number | null; aquaculture_pond_id?: number | null }>
}

/** Restore header default from saved entry (station header, shared pond on lines, or head office). */
export function inferJournalDefaultEntityKey(entry: JournalEntryLike): string {
  if (entry.station_id != null && entry.station_id !== undefined) {
    return String(entry.station_id)
  }
  const pondIds = new Set<number>()
  let anyTagged = false
  for (const line of entry.lines) {
    if (line.station_id != null && line.station_id !== undefined) {
      anyTagged = true
    }
    const pid = line.aquaculture_pond_id
    if (pid != null && pid !== undefined) {
      pondIds.add(Number(pid))
      anyTagged = true
    }
  }
  if (pondIds.size === 1) {
    return formatPondScopeKey([...pondIds][0])
  }
  if (!anyTagged) {
    return formatHeadOfficeScopeKey()
  }
  return ''
}

/** UI value for per-line entity select (`''` = inherit entry default). */
export function journalLineEntitySelectValue(
  line: JournalLineEntityFields & { entity_key?: string },
  _entryDefaultKey: string
): string {
  if (line.entity_key === '__inherit__') return ''
  if (line.entity_key === HEAD_OFFICE_SCOPE_KEY) return HEAD_OFFICE_SCOPE_KEY
  if (line.entity_key && line.entity_key !== '') return line.entity_key
  const explicit = journalLineEntityKeyExplicit(line)
  if (explicit) return explicit
  return ''
}

/** Whether this line explicitly opts out of the entry default (head office). */
export function journalLineExplicitHeadOffice(
  line: JournalLineEntityFields & { entity_key?: string }
): boolean {
  return line.entity_key === HEAD_OFFICE_SCOPE_KEY
}

export function inferLineEntityKeyFromSaved(
  line: JournalLineEntityFields,
  entryDefaultKey: string
): string | '__inherit__' | typeof HEAD_OFFICE_SCOPE_KEY {
  const explicit = journalLineEntityKeyExplicit(line)
  if (explicit) {
    if (entryDefaultKey && explicit === entryDefaultKey) return '__inherit__'
    return explicit
  }
  if (!entryDefaultKey || entryDefaultKey === formatHeadOfficeScopeKey()) {
    return HEAD_OFFICE_SCOPE_KEY
  }
  return '__inherit__'
}

export { HEAD_OFFICE_SCOPE_KEY, formatHeadOfficeScopeKey }
