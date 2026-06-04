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
  linePondId: number | '' | null | undefined
): number | null {
  if (linePondId !== '' && linePondId != null) {
    return Number(linePondId)
  }
  return null
}

export function lineHasEntityTag(
  line: { station_id?: number | '' | null; aquaculture_pond_id?: number | '' | null },
  entryStationId: number | '' | null | undefined
): boolean {
  const pond =
    line.aquaculture_pond_id !== '' &&
    line.aquaculture_pond_id != null &&
    line.aquaculture_pond_id !== undefined
  if (pond) return true
  const st = line.station_id
  if (st !== '' && st != null) return true
  if (entryStationId !== '' && entryStationId != null) return true
  return false
}
