/** Reserved company code for the master tenant — must stay aligned with backend `api.services.company_code`. */
export const MASTER_COMPANY_CODE = 'FS-000001'

function isMasterFlag(v: unknown): boolean {
  return v === true || String(v ?? '').toLowerCase() === 'true'
}

/**
 * Stable label for UI when `company_code` is absent (e.g. stale cache).
 * Matches backend `compute_company_code` / `resolved_company_code`.
 */
export function displayCompanyCode(c: {
  id: number
  company_code?: string | null
  is_master?: string | boolean | null
}): string {
  const raw = c.company_code != null ? String(c.company_code).trim() : ''
  if (raw !== '') return raw
  if (isMasterFlag(c.is_master)) return MASTER_COMPANY_CODE
  if (c.id === 1) return 'FS-N000001'
  return `FS-${String(c.id).padStart(6, '0')}`
}
