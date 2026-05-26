/**
 * Built-in tenant job types — keep aligned with backend tenant_job_types.py.
 * Prefer `job_types` from GET /permission-catalog/ when available.
 */

export type TenantJobTypeOption = { value: string; label: string; hint: string }

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

export function jobTypeHint(value: string): string {
  return TENANT_JOB_TYPE_OPTIONS.find((o) => o.value === value)?.hint ?? ''
}

export function mergeJobTypesFromApi(
  fromApi: TenantJobTypeOption[] | null | undefined
): TenantJobTypeOption[] {
  if (!fromApi?.length) return TENANT_JOB_TYPE_OPTIONS
  const byValue = new Map(TENANT_JOB_TYPE_OPTIONS.map((o) => [o.value, o]))
  for (const row of fromApi) {
    if (row?.value) byValue.set(row.value, row)
  }
  return Array.from(byValue.values())
}

export function defaultPosScopeForRole(role: string): string {
  const r = (role || '').toLowerCase()
  if (r === 'shopkeeper') return 'general'
  if (r === 'operator' || r === 'pump_attendant') return 'fuel'
  if (r === 'cashier') return 'both'
  return 'both'
}
