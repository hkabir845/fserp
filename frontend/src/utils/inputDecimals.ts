/**
 * Normalize typed numeric field values (commas stripped). Empty input stays empty.
 */
export function roundDecimalInputString(raw: string, decimals: number): string {
  const t = String(raw ?? '')
    .trim()
    .replace(/,/g, '')
  if (t === '') return ''
  const n = Number(t)
  if (!Number.isFinite(n)) return String(raw ?? '').trim()
  const d = Math.max(0, Math.min(20, Math.trunc(decimals)))
  return Number(n.toFixed(d)).toFixed(d)
}

/** Whole non-negative counts (e.g. fish heads). */
export function roundCountInputString(raw: string): string {
  const t = String(raw ?? '')
    .trim()
    .replace(/,/g, '')
  if (t === '') return ''
  const n = Math.round(Number(t))
  if (!Number.isFinite(n)) return t
  return String(Math.max(0, n))
}
