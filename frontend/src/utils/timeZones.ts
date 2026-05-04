/**
 * IANA time zones for company profile / SaaS company creation.
 * Default: Asia/Dhaka (Bangladesh) — first entry is the product default.
 */
export const DEFAULT_COMPANY_TIME_ZONE = 'Asia/Dhaka'

export const COMPANY_TIME_ZONE_OPTIONS: { value: string; label: string }[] = [
  { value: 'Asia/Dhaka', label: 'Asia/Dhaka (Bangladesh)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (UAE)' },
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (India)' },
  { value: 'Asia/Karachi', label: 'Asia/Karachi (Pakistan)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (Japan)' },
  { value: 'Asia/Bangkok', label: 'Asia/Bangkok' },
  { value: 'Asia/Hong_Kong', label: 'Asia/Hong Kong' },
  { value: 'Europe/London', label: 'Europe/London' },
  { value: 'Europe/Paris', label: 'Europe/Paris' },
  { value: 'America/New_York', label: 'America/New_York (US Eastern)' },
  { value: 'America/Chicago', label: 'America/Chicago (US Central)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (US Pacific)' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney' },
]

export function isKnownCompanyTimeZone(value: string | undefined | null): boolean {
  if (!value) return false
  return COMPANY_TIME_ZONE_OPTIONS.some((o) => o.value === value)
}
