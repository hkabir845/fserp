/**
 * Helpers for form GL account auto-suggest (active pre-fill + editable overrides).
 */

import type { CoaPick } from '@/lib/coaDefaults'
import { coaIdForCode } from '@/lib/coaDefaults'

export function parseSuggestedCoaId(suggested: string | number | null | undefined): number | undefined {
  if (suggested == null || suggested === '') return undefined
  const n = typeof suggested === 'number' ? suggested : parseInt(String(suggested), 10)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** Apply template suggestion when the field is empty and the user has not overridden it. */
export function mergeSuggestedStringField(
  current: string,
  suggested: string,
  touched: boolean
): string {
  if (touched) return current
  if (String(current || '').trim() !== '') return current
  return suggested || ''
}

/** Apply template suggestion for optional numeric line fields (invoice/bill lines). */
export function mergeSuggestedLineAccountId(
  current: number | null | undefined,
  suggested: number | undefined,
  touched: boolean
): number | undefined {
  if (touched) return current ?? undefined
  if (current != null && current > 0) return current
  return suggested
}

/** Line-level: explicit account pick = touched; cleared = allow auto-suggest again. */
export function syncLineTouchedForAccount(
  touched: Set<number>,
  lineNumber: number,
  accountId: number | null | undefined
): void {
  if (accountId != null && accountId > 0) touched.add(lineNumber)
  else touched.delete(lineNumber)
}

/** Field-level GL on product/vendor forms: empty selection re-enables suggestions. */
export function syncFieldTouchedForAccountPick(touched: Set<string>, fieldKey: string, value: string): void {
  if (String(value || '').trim() !== '') touched.add(fieldKey)
  else touched.delete(fieldKey)
}

export function syncBooleanFieldTouchedForAccountPick(touched: { current: boolean }, value: string): void {
  touched.current = String(value || '').trim() !== ''
}

export function coaPickFromRows(
  rows: { id: number; account_code?: string; account_name?: string }[]
): CoaPick[] {
  return rows.map((a) => ({
    id: a.id,
    account_code: String(a.account_code || ''),
    account_name: a.account_name != null ? String(a.account_name) : undefined,
  }))
}

export { coaIdForCode }
