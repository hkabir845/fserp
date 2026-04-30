/**
 * Client-only tenant display formats (from GET /companies/current/).
 * Set by CompanyLocaleProvider after auth; defaults match backend when unset.
 */
import {
  DEFAULT_COMPANY_DATE_FORMAT,
  DEFAULT_COMPANY_TIME_FORMAT,
} from '@/utils/companyLocaleFormats'
import { DEFAULT_COMPANY_TIME_ZONE } from '@/utils/timeZones'

export type StationMode = 'single' | 'multi'

export type TenantLocaleConfig = {
  dateFormat: string
  timeFormat: string
  /** IANA name from GET /companies/current/; default Asia/Dhaka. */
  timeZone: string
  /** From GET /companies/current/; default multi when unset. */
  stationMode: StationMode
}

const defaults: TenantLocaleConfig = {
  dateFormat: DEFAULT_COMPANY_DATE_FORMAT,
  timeFormat: DEFAULT_COMPANY_TIME_FORMAT,
  timeZone: DEFAULT_COMPANY_TIME_ZONE,
  stationMode: 'single',
}

let clientConfig: TenantLocaleConfig | null = null

/** Called when user logs out or before login. */
export function setTenantLocaleConfig(config: TenantLocaleConfig | null): void {
  if (typeof window === 'undefined') return
  clientConfig = config
}

export function getTenantLocaleConfig(): TenantLocaleConfig {
  return clientConfig ?? defaults
}
