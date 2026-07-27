/**
 * Built-in tenant job types — keep aligned with backend tenant_job_types.py.
 * Prefer `job_types` from GET /permission-catalog/ or /company-job-types/ when available.
 */

export type TenantJobTypeOption = {
  value: string
  label: string
  hint: string
  is_custom?: boolean
  inherits_from?: string
  access_profile_enabled?: boolean
  allowed_role_ids?: number[]
  company_job_type_id?: number | null
  is_active?: boolean
  sort_order?: number
}

export const TENANT_JOB_TYPE_OPTIONS: TenantJobTypeOption[] = [
  {
    value: 'admin',
    label: 'Admin',
    hint: 'Company admin: people, company settings, and all modules (unless a custom access profile overrides).',
  },
  {
    value: 'manager',
    label: 'Manager (Fuel Station, Shop & Aquaculture)',
    hint: 'Runs fuel station, shop, and aquaculture: operations, reports, and company settings. Cannot manage user accounts.',
  },
  {
    value: 'accountant',
    label: 'Accountant (Fuel Station, Shop & Aquaculture)',
    hint: 'Back office: GL, AR/AP, fuel and shop inventory, HR, reports, and aquaculture when enabled.',
  },
  {
    value: 'auditor',
    label: 'Auditor (read-only finance)',
    hint: 'View GL, AR/AP, and reports. No POS, user management, or backup.',
  },
  {
    value: 'forecourt_supervisor',
    label: 'Forecourt supervisor (Fuel Station)',
    hint: 'Stations, tanks, shifts, tank dips, and operational reports. No shop GL or user management.',
  },
  {
    value: 'supervisor',
    label: 'Supervisor (Ponds)',
    hint: 'Pond operations: sampling, feeding, pond costs, fish sales, and aquaculture reports.',
  },
  {
    value: 'inventory_clerk',
    label: 'Inventory clerk',
    hint: 'Products, stock, transfers, and inventory reports. No POS or accounting.',
  },
  {
    value: 'sales_clerk',
    label: 'Sales clerk (AR/AP desk)',
    hint: 'Customers, vendors, invoices, bills, and payments. No fuel forecourt setup.',
  },
  {
    value: 'shopkeeper',
    label: 'Shopkeeper (C-store / shop)',
    hint: 'Shop POS (general merchandise), customers, and product catalog. Assign a site when you have multiple locations.',
  },
  {
    value: 'cashier',
    label: 'Cashier',
    hint: 'Register, customers, and basic reports. Assign a site for multi-location tenants; set fuel/shop lane below.',
  },
  {
    value: 'pump_attendant',
    label: 'Pump attendant (Fuel Station)',
    hint: 'Fuel POS only at an assigned site: new sale and donation on the forecourt register.',
  },
  {
    value: 'operator',
    label: 'Operator (Fuel Station)',
    hint: 'Same as pump attendant: fuel-station POS only at an assigned site.',
  },
  {
    value: 'hr_officer',
    label: 'HR officer',
    hint: 'Employees and payroll only.',
  },
]

export const BUILTIN_JOB_TYPE_SEEDS = [
  'aquaculture_only',
  ...TENANT_JOB_TYPE_OPTIONS.map((o) => o.value),
] as const

export const BUILTIN_JOB_TYPE_VALUES = new Set(TENANT_JOB_TYPE_OPTIONS.map((o) => o.value))

export const ROLES_REQUIRING_HOME_STATION = new Set([
  'shopkeeper',
  'cashier',
  'pump_attendant',
  'operator',
])

export const ROLES_WITH_POS_SALE_SCOPE = new Set([
  'shopkeeper',
  'cashier',
  'pump_attendant',
  'operator',
])

export const LIMITED_POS_REGISTER_ROLES = new Set(['pump_attendant', 'operator'])

export function jobTypeHint(value: string, options?: TenantJobTypeOption[]): string {
  const list = options?.length ? options : TENANT_JOB_TYPE_OPTIONS
  return list.find((o) => o.value === value)?.hint ?? ''
}

export function mergeJobTypesFromApi(
  fromApi: TenantJobTypeOption[] | null | undefined
): TenantJobTypeOption[] {
  if (!fromApi?.length) return TENANT_JOB_TYPE_OPTIONS
  const byValue = new Map<string, TenantJobTypeOption>()
  for (const o of TENANT_JOB_TYPE_OPTIONS) {
    byValue.set(o.value, { ...o })
  }
  for (const row of fromApi) {
    if (!row?.value) continue
    const prev = byValue.get(row.value)
    byValue.set(row.value, {
      ...(prev || {}),
      ...row,
      value: row.value,
      label: row.label || prev?.label || row.value,
      hint: row.hint ?? prev?.hint ?? '',
    })
  }
  return Array.from(byValue.values()).sort(
    (a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999) || a.label.localeCompare(b.label)
  )
}

export function effectiveBuiltinRoleKey(
  role: string,
  options?: TenantJobTypeOption[]
): string {
  const r = (role || '').toLowerCase()
  if (BUILTIN_JOB_TYPE_VALUES.has(r)) return r
  const opt = options?.find((o) => o.value === r)
  const inh = (opt?.inherits_from || '').toLowerCase()
  if (inh && BUILTIN_JOB_TYPE_VALUES.has(inh)) return inh
  return r
}

export function defaultPosScopeForRole(role: string, options?: TenantJobTypeOption[]): string {
  const r = effectiveBuiltinRoleKey(role, options)
  if (r === 'shopkeeper') return 'general'
  if (r === 'operator' || r === 'pump_attendant') return 'fuel'
  if (r === 'cashier') return 'both'
  return 'both'
}

export function jobTypeRequiresAccessProfile(
  role: string,
  options?: TenantJobTypeOption[]
): boolean {
  const opt = options?.find((o) => o.value === role)
  if (!opt?.access_profile_enabled) return false
  return Array.isArray(opt.allowed_role_ids) && opt.allowed_role_ids.length > 0
}

export function allowedAccessProfileIdsForJobType(
  role: string,
  options?: TenantJobTypeOption[]
): number[] | null {
  const opt = options?.find((o) => o.value === role)
  if (!opt?.access_profile_enabled) return null
  if (!Array.isArray(opt.allowed_role_ids) || opt.allowed_role_ids.length === 0) return null
  return opt.allowed_role_ids.map((id) => Number(id))
}
