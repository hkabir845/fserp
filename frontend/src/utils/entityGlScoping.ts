/** Mirror backend P&L buckets for manual journal entity tagging (station or pond). */

export type CoaAccountLike = {
  account_type?: string
  account_sub_type?: string
  account_code?: string
}

export function accountNeedsEntityTag(account: CoaAccountLike | null | undefined): boolean {
  if (!account) return false
  const t = (account.account_type || '').trim().toLowerCase().replace(/-/g, '_')
  const st = (account.account_sub_type || '').trim().toLowerCase()
  const code = (account.account_code || '').trim()
  if (t === 'income') return true
  if (t === 'cost_of_goods_sold') return true
  if (t === 'expense') {
    if (st && (st.includes('cogs') || st === 'cost_of_goods_sold' || st === 'supplies_materials_cogs')) {
      return true
    }
    if (code.length >= 4 && /^\d+$/.test(code.slice(0, 4)) && (code.startsWith('51') || code.startsWith('52'))) {
      return true
    }
    return true
  }
  return false
}

export function resolveJournalLinePondId(
  linePondId: number | '' | null | undefined,
  entryPondId?: number | '' | null | undefined
): number | null {
  if (linePondId !== '' && linePondId != null) {
    return Number(linePondId)
  }
  if (entryPondId !== '' && entryPondId != null) {
    return Number(entryPondId)
  }
  return null
}

export type JournalEntryDefaultEntity = {
  stationId: number | ''
  pondId: number | ''
  isHeadOffice?: boolean
}

export function lineHasEntityTag(
  line: { station_id?: number | '' | null; aquaculture_pond_id?: number | '' | null },
  entryDefault?: JournalEntryDefaultEntity | number | '' | null | undefined
): boolean {
  const entryStationId =
    entryDefault != null && typeof entryDefault === 'object'
      ? entryDefault.stationId
      : entryDefault
  const entryPondId =
    entryDefault != null && typeof entryDefault === 'object' ? entryDefault.pondId : ''
  const entryIsHeadOffice =
    entryDefault != null &&
    typeof entryDefault === 'object' &&
    Boolean(entryDefault.isHeadOffice)

  const pond =
    line.aquaculture_pond_id !== '' &&
    line.aquaculture_pond_id != null &&
    line.aquaculture_pond_id !== undefined
  if (pond) return true
  const st = line.station_id
  if (st !== '' && st != null) return true
  if (entryIsHeadOffice) return false
  if (entryPondId !== '' && entryPondId != null) return true
  if (entryStationId !== '' && entryStationId != null) return true
  return false
}

/** True when line (or entry default) tags a fuel station, shop hub, or pond — not head office. */
export function lineHasBusinessEntityTag(
  line: {
    station_id?: number | '' | null
    aquaculture_pond_id?: number | '' | null
    entity_key?: string
  },
  entryDefaultKey: string
): boolean {
  if (line.entity_key === 'ho') return false
  const hasLineStation = line.station_id !== '' && line.station_id != null
  const hasLinePond =
    line.aquaculture_pond_id !== '' &&
    line.aquaculture_pond_id != null &&
    line.aquaculture_pond_id !== undefined
  if (hasLineStation || hasLinePond) return true
  if (line.entity_key && line.entity_key !== '__inherit__' && line.entity_key !== 'ho') {
    return true
  }
  const key = entryDefaultKey.trim()
  return key !== '' && key !== 'ho'
}
