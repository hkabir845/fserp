/**
 * Effective Aquaculture enablement for the ERP UI (web + Capacitor Android shell).
 * Keep in sync with backend `api.services.aquaculture_company_flags`.
 */

import { shouldForceAquacultureUnlock } from '@/lib/adibAndroidApp'

export const PERMANENT_AQUACULTURE_COMPANY_CODES = new Set(['FS-000002'])
export const PERMANENT_AQUACULTURE_COMPANY_NAMES = new Set(['adib filling station'])

export type AquacultureCompanyFlagsInput = {
  id?: number
  company_code?: string | null
  name?: string | null
  company_name?: string | null
  aquaculture_enabled?: boolean
  aquaculture_permanent?: boolean
} | null | undefined

export function isPermanentAquacultureCompany(company: AquacultureCompanyFlagsInput): boolean {
  if (!company) return false
  if (company.aquaculture_permanent) return true
  const code = (company.company_code || '').trim().toUpperCase()
  if (code && PERMANENT_AQUACULTURE_COMPANY_CODES.has(code)) return true
  const name = (company.name || company.company_name || '').trim().toLowerCase()
  return PERMANENT_AQUACULTURE_COMPANY_NAMES.has(name)
}

/** True when Aquaculture menu/routes should be available for this company. */
export function resolveAquacultureEnabled(company: AquacultureCompanyFlagsInput): boolean {
  if (shouldForceAquacultureUnlock()) return true
  if (!company) return false
  return Boolean(company.aquaculture_enabled) || isPermanentAquacultureCompany(company)
}

/** Normalize API company payload so Android/web clients always see effective flags. */
export function withEffectiveAquacultureFlags<T extends Record<string, unknown>>(data: T): T & {
  aquaculture_enabled: boolean
  aquaculture_permanent: boolean
} {
  const permanent =
    shouldForceAquacultureUnlock() || isPermanentAquacultureCompany(data as AquacultureCompanyFlagsInput)
  return {
    ...data,
    aquaculture_enabled: resolveAquacultureEnabled(data as AquacultureCompanyFlagsInput),
    aquaculture_permanent: permanent,
  }
}
