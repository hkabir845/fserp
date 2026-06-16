/**
 * ERP “apps” — each module is a first-class area; together they form the suite.
 * Used by /modules launcher and documentation.
 */
import type { ModuleSlug } from './app-modules'

export type ModuleCategoryId =
  | 'overview'
  | 'foundation'
  | 'supply'
  | 'commercial'
  | 'operations'
  | 'finance'
  | 'people'

export type ErpModuleApp = {
  id: string
  title: string
  tagline: string
  icon: string
  /** Primary route (same as sidebar root). */
  entryHref: string
  /** Hub mirror under /modules/[slug] (grid or redirect). */
  hubSlug: ModuleSlug
}

export type ModuleReadiness = 'production' | 'beta' | 'planned'

export type ModuleProfessionalProfile = {
  readiness: ModuleReadiness
  domains: string[]
  capabilities: string[]
}

export const moduleCategoryLabels: Record<ModuleCategoryId, { title: string; subtitle: string }> = {
  overview: { title: 'Overview', subtitle: 'Snapshot and navigation' },
  foundation: { title: 'Foundation', subtitle: 'Master data and tenant setup' },
  supply: { title: 'Supply chain', subtitle: 'Buy, move, and finance materials' },
  commercial: { title: 'Commercial', subtitle: 'Sell and grow relationships' },
  operations: { title: 'Operations & field', subtitle: 'Make, move, and maintain' },
  finance: { title: 'Finance & control', subtitle: 'Books, payroll, and facilities' },
  people: { title: 'People', subtitle: 'Workforce and time' },
}

export const erpModuleApps: Array<ErpModuleApp & { category: ModuleCategoryId }> = [
  {
    id: 'dashboard',
    title: 'Dashboard',
    tagline: 'Live counts and links across your tenant — inventory, orders, manufacturing, and collections.',
    icon: '📊',
    entryHref: '/dashboard',
    hubSlug: 'dashboard',
    category: 'overview',
  },
  {
    id: 'reports',
    title: 'Reporting',
    tagline: 'Operational and financial views — reports hub, statements, journals, and stock truth.',
    icon: '📈',
    entryHref: '/reports',
    hubSlug: 'reports',
    category: 'overview',
  },
  {
    id: 'master-data',
    title: 'Master Data',
    tagline: 'Items, warehouses, suppliers, and customers — shared across every transaction.',
    icon: '📋',
    entryHref: '/master-data',
    hubSlug: 'master-data',
    category: 'foundation',
  },
  {
    id: 'settings',
    title: 'Settings',
    tagline: 'Company defaults, currencies, units of measure, and tenant preferences.',
    icon: '⚙️',
    entryHref: '/settings',
    hubSlug: 'settings',
    category: 'foundation',
  },
  {
    id: 'procurement',
    title: 'Procurement',
    tagline: 'Purchase orders, goods receipt (GRN), vendor bills, and purchase analytics.',
    icon: '🛒',
    entryHref: '/procurement',
    hubSlug: 'procurement',
    category: 'supply',
  },
  {
    id: 'trade-finance',
    title: 'Trade finance',
    tagline: 'Import/export letters of credit, bank references, and document checklists.',
    icon: '🌐',
    entryHref: '/trade-finance',
    hubSlug: 'trade-finance',
    category: 'supply',
  },
  {
    id: 'inventory',
    title: 'Inventory',
    tagline: 'Stock positions, lots, and movements across warehouses.',
    icon: '📦',
    entryHref: '/inventory',
    hubSlug: 'inventory',
    category: 'supply',
  },
  {
    id: 'sales',
    title: 'Sales',
    tagline: 'Invoices, receipts, and order-to-cash flows.',
    icon: '💼',
    entryHref: '/sales',
    hubSlug: 'sales',
    category: 'commercial',
  },
  {
    id: 'crm',
    title: 'CRM',
    tagline: 'Leads, pipeline, and activities for dealers and farms.',
    icon: '🤝',
    entryHref: '/crm',
    hubSlug: 'crm',
    category: 'commercial',
  },
  {
    id: 'manufacturing',
    title: 'Manufacturing',
    tagline: 'Formulations, BOMs, batches, silos, and production orders.',
    icon: '🏭',
    entryHref: '/manufacturing',
    hubSlug: 'manufacturing',
    category: 'operations',
  },
  {
    id: 'lab',
    title: 'Quality lab',
    tagline: 'Specifications, samples, and QC results for feed safety and release.',
    icon: '🧪',
    entryHref: '/lab',
    hubSlug: 'lab',
    category: 'operations',
  },
  {
    id: 'livestock',
    title: 'Livestock',
    tagline: 'Herd events, movements, and production animal records.',
    icon: '🐄',
    entryHref: '/livestock',
    hubSlug: 'livestock',
    category: 'operations',
  },
  {
    id: 'transport',
    title: 'Transport',
    tagline: 'Vehicles, trips, and deliveries.',
    icon: '🚚',
    entryHref: '/transport',
    hubSlug: 'transport',
    category: 'operations',
  },
  {
    id: 'workshop',
    title: 'Workshop',
    tagline: 'Maintenance jobs, technicians, and equipment repair.',
    icon: '🔧',
    entryHref: '/workshop',
    hubSlug: 'workshop',
    category: 'operations',
  },
  {
    id: 'fuel',
    title: 'Fuel station',
    tagline: 'Tanks, issues, and fuel-grade tracking.',
    icon: '⛽',
    entryHref: '/fuel',
    hubSlug: 'fuel',
    category: 'operations',
  },
  {
    id: 'accounting',
    title: 'Accounting',
    tagline: 'Chart of accounts, journals, trial balance, and financial statements.',
    icon: '💳',
    entryHref: '/accounting',
    hubSlug: 'accounting',
    category: 'finance',
  },
  {
    id: 'loans',
    title: 'Loans',
    tagline: 'Loan facilities, amortization, and payment tracking.',
    icon: '🏦',
    entryHref: '/loans',
    hubSlug: 'loans',
    category: 'finance',
  },
  {
    id: 'payroll',
    title: 'Payroll',
    tagline: 'Employees, payroll runs, and payslips.',
    icon: '👔',
    entryHref: '/payroll',
    hubSlug: 'payroll',
    category: 'finance',
  },
  {
    id: 'hr',
    title: 'HR & people',
    tagline: 'Time & attendance, expenses, and team tools.',
    icon: '👥',
    entryHref: '/hr',
    hubSlug: 'hr',
    category: 'people',
  },
]

/**
 * Business/industry profile metadata used by the module launcher.
 * Keeps professional context (domain fit + maturity) in one place.
 */
export const moduleProfessionalProfiles: Record<string, ModuleProfessionalProfile> = {
  dashboard: {
    readiness: 'production',
    domains: ['enterprise overview', 'kpi monitoring'],
    capabilities: ['cross-module metrics', 'operations snapshot'],
  },
  reports: {
    readiness: 'beta',
    domains: ['management reporting', 'financial visibility'],
    capabilities: ['operational reporting', 'financial statements'],
  },
  'master-data': {
    readiness: 'production',
    domains: ['foundation controls', 'data governance'],
    capabilities: ['items and sku master', 'supplier and customer master'],
  },
  settings: {
    readiness: 'production',
    domains: ['tenant governance', 'configuration management'],
    capabilities: ['currency setup', 'units and defaults'],
  },
  procurement: {
    readiness: 'production',
    domains: ['feed mill sourcing', 'flour mill sourcing', 'raw material procurement'],
    capabilities: ['requisitions and approvals', 'po to grn to bill flow'],
  },
  'trade-finance': {
    readiness: 'beta',
    domains: ['import/export operations', 'banking compliance'],
    capabilities: ['lc register', 'bank document tracking'],
  },
  inventory: {
    readiness: 'production',
    domains: ['warehouse operations', 'stock control'],
    capabilities: ['stock movement ledger', 'warehouse-level visibility'],
  },
  sales: {
    readiness: 'production',
    domains: ['distribution sales', 'dealer channel sales'],
    capabilities: ['invoicing and receipts', 'sales requisition workflow'],
  },
  crm: {
    readiness: 'beta',
    domains: ['dealer management', 'farm relationship management'],
    capabilities: ['lead pipeline', 'activity tracking'],
  },
  manufacturing: {
    readiness: 'production',
    domains: ['feed mill production', 'flour mill production', 'formula-driven manufacturing'],
    capabilities: ['formulations and boms', 'batches, silos, and production orders'],
  },
  lab: {
    readiness: 'beta',
    domains: ['quality assurance', 'feed safety'],
    capabilities: ['spec verification', 'sample and result workflows'],
  },
  livestock: {
    readiness: 'planned',
    domains: ['farm operations', 'animal management'],
    capabilities: ['herd record workflows'],
  },
  transport: {
    readiness: 'beta',
    domains: ['fleet logistics', 'distribution operations'],
    capabilities: ['vehicle and trip management'],
  },
  workshop: {
    readiness: 'beta',
    domains: ['maintenance operations', 'asset reliability'],
    capabilities: ['job cards', 'technician assignment'],
  },
  fuel: {
    readiness: 'beta',
    domains: ['fuel operations', 'fleet cost control'],
    capabilities: ['tank and issue tracking'],
  },
  accounting: {
    readiness: 'production',
    domains: ['general accounting', 'financial control'],
    capabilities: ['coa and journals', 'trial balance and balance sheet'],
  },
  loans: {
    readiness: 'beta',
    domains: ['corporate finance', 'facility management'],
    capabilities: ['loan register', 'amortization tracking'],
  },
  payroll: {
    readiness: 'beta',
    domains: ['payroll management', 'people finance'],
    capabilities: ['employee payroll runs'],
  },
  hr: {
    readiness: 'beta',
    domains: ['human resources', 'workforce operations'],
    capabilities: ['attendance and time', 'expense claim processing'],
  },
}

export type PlatformApp = {
  id: string
  title: string
  tagline: string
  icon: string
  entryHref: string
}

/** SaaS operator console — separate from tenant ERP. */
export const platformApps: PlatformApp[] = [
  {
    id: 'platform-dash',
    title: 'Platform dashboard',
    tagline: 'Cross-tenant overview and health.',
    icon: '📊',
    entryHref: '/platform/dashboard',
  },
  {
    id: 'tenants',
    title: 'Tenants',
    tagline: 'Directory, browse, and onboard companies.',
    icon: '🏢',
    entryHref: '/platform/tenants',
  },
  {
    id: 'plans',
    title: 'Plans',
    tagline: 'Subscription plans and packaging.',
    icon: '📜',
    entryHref: '/platform/plans',
  },
  {
    id: 'billing',
    title: 'Billing',
    tagline: 'Platform billing configuration.',
    icon: '💳',
    entryHref: '/platform/billing',
  },
  {
    id: 'payments',
    title: 'Payments',
    tagline: 'Payment records from customers.',
    icon: '💵',
    entryHref: '/platform/payments',
  },
  {
    id: 'invoices',
    title: 'Invoices',
    tagline: 'Subscription invoices.',
    icon: '🧾',
    entryHref: '/platform/invoices',
  },
  {
    id: 'subscriptions',
    title: 'Subscriptions',
    tagline: 'Active tenant subscriptions.',
    icon: '🔄',
    entryHref: '/platform/subscriptions',
  },
  {
    id: 'broadcast',
    title: 'Broadcast',
    tagline: 'Announcements to tenants.',
    icon: '📢',
    entryHref: '/platform/broadcast',
  },
  {
    id: 'platform-settings',
    title: 'Platform settings',
    tagline: 'Global currencies, units, and defaults.',
    icon: '⚙️',
    entryHref: '/platform/settings',
  },
]

const categoryOrder: ModuleCategoryId[] = [
  'overview',
  'foundation',
  'supply',
  'commercial',
  'operations',
  'finance',
  'people',
]

export function groupErpModulesByCategory() {
  const map = new Map<ModuleCategoryId, (typeof erpModuleApps)[number][]>()
  for (const id of categoryOrder) map.set(id, [])
  for (const app of erpModuleApps) {
    map.get(app.category)!.push(app)
  }
  return categoryOrder.map((cat) => ({ category: cat, apps: map.get(cat)! }))
}
