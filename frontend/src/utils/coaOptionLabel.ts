/** Shape from /chart-of-accounts/ (or filtered subsets). */
export type CoaLike = {
  account_code?: string
  account_name?: string
  account_type?: string
  account_sub_type?: string
}

function humanizeLabel(s: string | undefined): string {
  if (!s || typeof s !== 'string') return ''
  const t = s.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/**
 * Dropdown label: code — name (account type · subtype).
 * Subtype omitted when empty.
 */
export function formatCoaOptionLabel(account: CoaLike): string {
  const code = (account.account_code || '').trim()
  const name = (account.account_name || '').trim()
  const core = code && name ? `${code} — ${name}` : code || name || 'Account'

  const typePart = humanizeLabel(account.account_type)
  const subPart = humanizeLabel(account.account_sub_type)
  let meta = ''
  if (typePart && subPart) meta = `${typePart} · ${subPart}`
  else meta = typePart || subPart

  if (!meta) return core
  return `${core} (${meta})`
}
