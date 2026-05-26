/**
 * Per-app launcher permissions (must stay aligned with backend app_page_permissions.py).
 */

export type AppPagePermissionDef = {
  id: string
  label: string
  group: string
  parent: string
  href: string
}

export const APP_PAGE_PERMISSIONS: AppPagePermissionDef[] = [
  { id: 'app.page.dashboard', label: 'Dashboard', group: 'Apps — Main', parent: 'app.launcher', href: '/dashboard' },
  { id: 'app.page.cashier', label: 'POS / Cashier', group: 'Apps — Main', parent: 'app.pos', href: '/cashier' },
  { id: 'app.page.stations', label: 'Stations', group: 'Apps — Station', parent: 'app.station', href: '/stations' },
  { id: 'app.page.tanks', label: 'Tanks', group: 'Apps — Station', parent: 'app.station', href: '/tanks' },
  { id: 'app.page.islands', label: 'Islands', group: 'Apps — Station', parent: 'app.station', href: '/islands' },
  { id: 'app.page.dispensers', label: 'Dispensers', group: 'Apps — Station', parent: 'app.station', href: '/dispensers' },
  { id: 'app.page.meters', label: 'Meters', group: 'Apps — Station', parent: 'app.station', href: '/meters' },
  { id: 'app.page.nozzles', label: 'Nozzles', group: 'Apps — Station', parent: 'app.station', href: '/nozzles' },
  {
    id: 'app.page.shift_management',
    label: 'Shift Management',
    group: 'Apps — Operations',
    parent: 'app.operations',
    href: '/shift-management',
  },
  { id: 'app.page.tank_dips', label: 'Tank Dips', group: 'Apps — Operations', parent: 'app.operations', href: '/tank-dips' },
  {
    id: 'app.page.chart_of_accounts',
    label: 'Chart of Accounts',
    group: 'Apps — Accounting',
    parent: 'app.accounting',
    href: '/chart-of-accounts',
  },
  {
    id: 'app.page.journal_entries',
    label: 'Journal Entries',
    group: 'Apps — Accounting',
    parent: 'app.accounting',
    href: '/journal-entries',
  },
  {
    id: 'app.page.fund_transfers',
    label: 'Fund Transfer',
    group: 'Apps — Accounting',
    parent: 'app.accounting',
    href: '/fund-transfers',
  },
  { id: 'app.page.loans', label: 'Loans', group: 'Apps — Accounting', parent: 'app.accounting', href: '/loans' },
  { id: 'app.page.customers', label: 'Customers', group: 'Apps — Sales', parent: 'app.customers', href: '/customers' },
  { id: 'app.page.vendors', label: 'Vendors', group: 'Apps — Sales', parent: 'app.sales', href: '/vendors' },
  { id: 'app.page.invoices', label: 'Invoices', group: 'Apps — Sales', parent: 'app.sales', href: '/invoices' },
  { id: 'app.page.bills', label: 'Bills', group: 'Apps — Sales', parent: 'app.sales', href: '/bills' },
  { id: 'app.page.payments', label: 'Payments', group: 'Apps — Sales', parent: 'app.sales', href: '/payments' },
  {
    id: 'app.page.items',
    label: 'Products & services',
    group: 'Apps — Inventory',
    parent: 'app.inventory',
    href: '/items',
  },
  {
    id: 'app.page.inventory',
    label: 'Inventory & transfers',
    group: 'Apps — Inventory',
    parent: 'app.inventory',
    href: '/inventory',
  },
  { id: 'app.page.employees', label: 'Employees', group: 'Apps — HR', parent: 'app.hr', href: '/employees' },
  { id: 'app.page.payroll', label: 'Payroll', group: 'Apps — HR', parent: 'app.hr', href: '/payroll' },
  { id: 'app.page.company', label: 'Company', group: 'Apps — Management', parent: 'app.settings', href: '/company' },
  {
    id: 'app.page.subscriptions',
    label: 'Subscriptions',
    group: 'Apps — Management',
    parent: 'app.settings',
    href: '/subscriptions',
  },
  { id: 'app.page.users', label: 'Users', group: 'Apps — Management', parent: 'app.users', href: '/users' },
  { id: 'app.page.roles', label: 'Roles & access', group: 'Apps — Management', parent: 'app.roles', href: '/roles' },
  { id: 'app.page.tax', label: 'Tax', group: 'Apps — Management', parent: 'app.settings', href: '/tax' },
  {
    id: 'app.page.reporting_categories',
    label: 'Reporting categories',
    group: 'Apps — Management',
    parent: 'app.settings',
    href: '/reporting-categories',
  },
  { id: 'app.page.backup', label: 'Backup & Restore', group: 'Apps — Management', parent: 'app.backup', href: '/backup' },
  { id: 'app.page.reports', label: 'Reports hub', group: 'Apps — Reports', parent: 'app.reports', href: '/reports' },
]

export const PAGE_PERMISSION_PARENT_BY_ID: Record<string, string> = Object.fromEntries(
  APP_PAGE_PERMISSIONS.map((p) => [p.id, p.parent])
)

export function permissionKeysForAppHref(href: string): string[] {
  const keys: string[] = []
  const page = APP_PAGE_PERMISSIONS.find((p) => p.href === href)
  if (page) {
    keys.push(page.id, page.parent)
  }
  if (href === '/customers') keys.push('app.sales')
  if (href === '/reports/analytics') keys.push('app.reports')
  return [...new Set(keys)]
}

export function buildAppPageHrefPermissionMap(): Record<string, string[]> {
  const map: Record<string, string[]> = {
    '/apps': ['app.launcher'],
  }
  for (const p of APP_PAGE_PERMISSIONS) {
    map[p.href] = permissionKeysForAppHref(p.href)
  }
  return map
}
