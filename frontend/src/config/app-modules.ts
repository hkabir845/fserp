import type { HubLink } from '@/components/ModuleHub'

/** Sidebar + module map — single source of truth for ERP navigation. */
export interface AppMenuItem {
  title: string
  href: string
  icon: string
  children?: AppMenuItem[]
  /** 'planned' = designed but the backend does not serve it yet; shown as unavailable. */
  status?: 'live' | 'planned'
}

export const erpMenuItems: AppMenuItem[] = [
  { title: 'Dashboard', href: '/dashboard', icon: '📊' },
  { title: 'Announcements', href: '/announcements', icon: '📣', status: 'planned' },
  { title: 'Modules', href: '/modules', icon: '🗂️' },
  {
    title: 'Master Data',
    icon: '📋',
    href: '/master-data',
    children: [
      { title: 'Items', href: '/items', icon: '📦' },
      { title: 'Warehouses', href: '/warehouses', icon: '🏭', status: 'planned' },
      { title: 'Suppliers', href: '/suppliers', icon: '🏢', status: 'planned' },
      { title: 'Customers', href: '/customers', icon: '👥' },
    ],
  },
  {
    title: 'Procurement',
    icon: '🛒',
    href: '/procurement',
    children: [
      { title: 'Purchase requisitions', href: '/purchase/requisitions', icon: '📋', status: 'planned' },
      { title: 'Approvals inbox', href: '/requisitions/inbox', icon: '✅', status: 'planned' },
      { title: 'Purchase Orders', href: '/purchase/orders', icon: '📝', status: 'planned' },
      { title: 'Goods Receipt', href: '/purchase/grn', icon: '📥', status: 'planned' },
      { title: 'Vendor Bills', href: '/purchase/bills', icon: '💰', status: 'planned' },
    ],
  },
  {
    title: 'Trade finance',
    icon: '🌐',
    href: '/trade-finance',
    children: [
      { title: 'Letters of credit (LC)', href: '/trade-finance/lc', icon: '📜', status: 'planned' },
      { title: 'New LC', href: '/trade-finance/lc/new', icon: '➕', status: 'planned' },
    ],
  },
  {
    title: 'Sales',
    icon: '💼',
    href: '/sales',
    children: [
      { title: 'Sales requisitions', href: '/sales/requisitions', icon: '📋', status: 'planned' },
      { title: 'Approvals inbox', href: '/requisitions/inbox', icon: '✅', status: 'planned' },
      { title: 'Sales Invoices', href: '/sales/invoices', icon: '🧾', status: 'planned' },
      { title: 'Receipts', href: '/sales/receipts', icon: '💵', status: 'planned' },
    ],
  },
  {
    title: 'Manufacturing',
    icon: '🏭',
    href: '/manufacturing',
    children: [
      { title: 'Feed BOMs (Formulations)', href: '/manufacturing/feed-boms', icon: '📐', status: 'planned' },
      { title: 'Classic BOMs', href: '/manufacturing/boms', icon: '📎', status: 'planned' },
      { title: 'Pre-formulations', href: '/preformulations', icon: '🧪', status: 'planned' },
      { title: 'Silos', href: '/manufacturing/silos', icon: '🛖', status: 'planned' },
      { title: 'Production Batches', href: '/manufacturing/batches', icon: '⚙️', status: 'planned' },
      { title: 'Production Orders', href: '/manufacturing/production-orders', icon: '📋', status: 'planned' },
      { title: 'Quality lab', href: '/lab', icon: '🧪', status: 'planned' },
    ],
  },
  { title: 'Inventory', href: '/inventory', icon: '📊' },
  {
    title: 'Reporting',
    icon: '📈',
    href: '/reports',
    children: [
      { title: 'Reports hub', href: '/reports', icon: '📑' },
      { title: 'Trial balance', href: '/accounting/trial-balance', icon: '⚖️', status: 'planned' },
      { title: 'Balance sheet', href: '/accounting/balance-sheet', icon: '📊', status: 'planned' },
      { title: 'Journal entries', href: '/accounting/journal', icon: '📔', status: 'planned' },
    ],
  },
  { title: 'Livestock', href: '/livestock', icon: '🐄', status: 'planned' },
  { title: 'Transport', href: '/transport', icon: '🚚', status: 'planned' },
  { title: 'Workshop', href: '/workshop', icon: '🔧', status: 'planned' },
  { title: 'Fuel Station', href: '/fuel', icon: '⛽', status: 'planned' },
  { title: 'Loans', href: '/loans', icon: '🏦' },
  {
    title: 'CRM',
    icon: '🤝',
    href: '/crm',
    children: [
      { title: 'Leads & pipeline', href: '/crm/leads', icon: '🎯', status: 'planned' },
      { title: 'Activities', href: '/crm/activities', icon: '📌', status: 'planned' },
    ],
  },
  {
    title: 'HR & people',
    icon: '👥',
    href: '/hr',
    children: [
      { title: 'Time & attendance', href: '/hr/time', icon: '🗓️', status: 'planned' },
      { title: 'Expense claims', href: '/hr/expenses', icon: '🧾', status: 'planned' },
      { title: 'Business cards', href: '/cards', icon: '💳', status: 'planned' },
    ],
  },
  {
    title: 'Accounting',
    icon: '💳',
    href: '/accounting',
    children: [
      { title: 'Chart of Accounts', href: '/accounting/accounts', icon: '📑', status: 'planned' },
      { title: 'Journal Entries', href: '/accounting/journal', icon: '📔', status: 'planned' },
      { title: 'Trial Balance', href: '/accounting/trial-balance', icon: '⚖️', status: 'planned' },
      { title: 'Balance Sheet', href: '/accounting/balance-sheet', icon: '📊', status: 'planned' },
      { title: 'Loans (facilities)', href: '/loans', icon: '🏦' },
    ],
  },
  {
    title: 'Payroll',
    icon: '👔',
    href: '/payroll',
    children: [
      { title: 'Overview', href: '/payroll', icon: '📋' },
      { title: 'Employees', href: '/payroll/employees', icon: '👤', status: 'planned' },
      { title: 'Payroll runs', href: '/payroll/runs', icon: '📅', status: 'planned' },
    ],
  },
  {
    title: 'Settings',
    href: '/settings',
    icon: '⚙️',
    children: [
      { title: 'General', href: '/settings/general', icon: '⚙️' },
      { title: 'Currencies', href: '/settings/currencies', icon: '💱' },
      { title: 'Units of measure', href: '/settings/units', icon: '📏' },
    ],
  },
]


export const masterDataHub = {
  title: 'Master Data',
  subtitle: 'Core reference data shared across procurement, sales, and inventory.',
  links: [
    { title: 'Items', href: '/items', icon: '📦', description: 'Products, SKUs, stock flags' },
    { title: 'Warehouses', href: '/warehouses', icon: '🏭', description: 'Storage locations', status: 'planned' },
    { title: 'Suppliers', href: '/suppliers', icon: '🏢', description: 'Vendor master', status: 'planned' },
    { title: 'Customers', href: '/customers', icon: '👥', description: 'Customer master' },
  ] satisfies HubLink[],
}

export const procurementHub = {
  title: 'Procurement',
  subtitle: 'Purchasing workflow from order through receipt and invoicing.',
  links: [
    {
      title: 'Purchase requisitions',
      href: '/purchase/requisitions',
      icon: '📋',
      description: 'Multi-level approval before raising a PO', status: 'planned' },
    { title: 'Approvals inbox', href: '/requisitions/inbox', icon: '✅', description: 'Department and executive queues', status: 'planned' },
    { title: 'Purchase Orders', href: '/purchase/orders', icon: '📝', description: 'Create and track POs', status: 'planned' },
    { title: 'Goods Receipt (GRN)', href: '/purchase/grn', icon: '📥', description: 'Receive against POs', status: 'planned' },
    { title: 'Vendor Bills', href: '/purchase/bills', icon: '💰', description: 'Accounts payable bills', status: 'planned' },
    {
      title: 'Letters of credit',
      href: '/trade-finance/lc',
      icon: '📜',
      description: 'Import/export LCs — Bangladesh AD bank workflow', status: 'planned' },
  ] satisfies HubLink[],
}

export const tradeFinanceHub = {
  title: 'Trade finance',
  subtitle:
    'Letters of Credit for imported ingredients, machinery & spares and for export sales — with Bangladesh Bank / AD bank reference fields and document tracking.',
  links: [
    {
      title: 'LC register',
      href: '/trade-finance/lc',
      icon: '📋',
      description: 'All letters of credit, import and export', status: 'planned' },
    {
      title: 'New LC',
      href: '/trade-finance/lc/new',
      icon: '➕',
      description: 'Register application or opened LC from bank SWIFT', status: 'planned' },
  ] satisfies HubLink[],
}

export const salesHub = {
  title: 'Sales',
  subtitle: 'Order-to-cash documents and collections.',
  links: [
    {
      title: 'Sales requisitions',
      href: '/sales/requisitions',
      icon: '📋',
      description: 'Commercial approval chain before invoicing', status: 'planned' },
    { title: 'Approvals inbox', href: '/requisitions/inbox', icon: '✅', description: 'Sales head and executive queues', status: 'planned' },
    { title: 'Sales Invoices', href: '/sales/invoices', icon: '🧾', description: 'Customer billing', status: 'planned' },
    { title: 'Receipts', href: '/sales/receipts', icon: '💵', description: 'Payment receipts', status: 'planned' },
  ] satisfies HubLink[],
}

export const labHub = {
  title: 'Quality laboratory',
  subtitle:
    'ISO-aligned QC: supplier COA verification, formulation release testing, mycotoxin and proximate panels, retention samples, and full traceability.',
  links: [
    {
      title: 'Lab workspace',
      href: '/lab',
      icon: '🧪',
      description: 'Parameters, specs, samples, and OOS evaluation', status: 'planned' },
  ] satisfies HubLink[],
}

export const manufacturingHub = {
  title: 'Manufacturing',
  subtitle: 'Formulations, batch runs, and production orders.',
  links: [
    { title: 'Quality lab', href: '/lab', icon: '🧪', description: 'Feed-grade and ingredient testing vs specs', status: 'planned' },
    { title: 'Feed BOMs (Formulations)', href: '/manufacturing/feed-boms', icon: '📐', description: 'Formulations and recipes', status: 'planned' },
    { title: 'Classic BOMs', href: '/manufacturing/boms', icon: '📎', description: 'Bill of materials (generic)', status: 'planned' },
    { title: 'Pre-formulations', href: '/preformulations', icon: '🧪', description: 'R&D formulations before BOM', status: 'planned' },
    { title: 'Production Batches', href: '/manufacturing/batches', icon: '⚙️', description: 'Batch-oriented production view', status: 'planned' },
    { title: 'Production Orders', href: '/manufacturing/production-orders', icon: '📋', description: 'Manufacturing orders', status: 'planned' },
    { title: 'Silos', href: '/manufacturing/silos', icon: '🛖', description: 'Bulk ingredient bins, levels, PLC / sensor hooks', status: 'planned' },
  ] satisfies HubLink[],
}

export const workshopHub = {
  title: 'Workshop',
  subtitle:
    'In-plant repair and installation: production machines, utilities, lorries, trucks, and internal transport — with job cards and technician assignment.',
  links: [
    {
      title: 'Workshop jobs',
      href: '/workshop',
      icon: '🛠️',
      description: 'Create jobs, assign staff, track status from draft to complete', status: 'planned' },
  ] satisfies HubLink[],
}

export const crmHub = {
  title: 'CRM',
  subtitle: 'Customer relationships for feed distribution: farms, dealers, integrators, and key accounts.',
  links: [
    { title: 'Leads & pipeline', href: '/crm/leads', icon: '🎯', description: 'Dealers, farms, distributors', status: 'planned' },
    {
      title: 'Activities',
      href: '/crm/activities',
      icon: '📌',
      description: 'Calls, visits, tasks, and follow-ups on leads', status: 'planned' },
  ] satisfies HubLink[],
}

export const hrHub = {
  title: 'HR & people',
  subtitle: 'Payroll, time & attendance, reimbursements, and employee tools for FMERP.',
  links: [
    {
      title: 'Time & attendance',
      href: '/hr/time',
      icon: '🗓️',
      description: 'Leave requests and daily attendance', status: 'planned' },
    { title: 'Expense claims', href: '/hr/expenses', icon: '🧾', description: 'Client visits, meals, transport, fuel', status: 'planned' },
    { title: 'Digital business cards', href: '/cards', icon: '💳', description: 'NFC & digital cards for your team', status: 'planned' },
  ] satisfies HubLink[],
}

export const accountingHub = {
  title: 'Accounting',
  subtitle: 'Financial records and statements (sections under active development).',
  links: [
    { title: 'Chart of Accounts', href: '/accounting/accounts', icon: '📑', description: 'GL account tree', status: 'planned' },
    { title: 'Journal Entries', href: '/accounting/journal', icon: '📔', description: 'Manual journals', status: 'planned' },
    { title: 'Trial Balance', href: '/accounting/trial-balance', icon: '⚖️', description: 'Period TB', status: 'planned' },
    { title: 'Balance Sheet', href: '/accounting/balance-sheet', icon: '📊', description: 'Statement of position', status: 'planned' },
    {
      title: 'Operational reports hub',
      href: '/reports',
      icon: '📈',
      description: 'Inventory + silo observability, production pipeline, sales velocity, demand vs cover',
    },
  ] satisfies HubLink[],
}

export const reportsHub = {
  title: 'Reporting',
  subtitle: 'Financial statements, inventory truth, manufacturing pipeline, and demand hints for procurement.',
  links: [
    {
      title: 'Reports hub (operational)',
      href: '/reports',
      icon: '📊',
      description: 'Warehouse + silo + commitments, production schedule, sales velocity, naive demand vs stock',
    },
    { title: 'Trial balance', href: '/accounting/trial-balance', icon: '⚖️', description: 'GL trial balance', status: 'planned' },
    { title: 'Balance sheet', href: '/accounting/balance-sheet', icon: '📊', description: 'Statement of position', status: 'planned' },
    { title: 'Journal entries', href: '/accounting/journal', icon: '📔', description: 'Posted and draft journals', status: 'planned' },
    { title: 'Stock positions', href: '/inventory', icon: '📦', description: 'Ledger-based warehouse stock' },
  ] satisfies HubLink[],
}

export const settingsHub = {
  title: 'Settings',
  subtitle: 'Tenant defaults, currencies, and units of measure.',
  links: [
    { title: 'General', href: '/settings/general', icon: '⚙️', description: 'Company and defaults', status: 'planned' },
    { title: 'Currencies', href: '/settings/currencies', icon: '💱', description: 'Tenant currency setup', status: 'planned' },
    { title: 'Units of measure', href: '/settings/units', icon: '📏', description: 'UOM catalog for this tenant', status: 'planned' },
  ] satisfies HubLink[],
}


/**
 * Slug → canonical app path for modules that use a full screen instead of a link grid.
 *
 * Only modules that actually have a screen belong here. Lab, livestock, transport, workshop,
 * fuel, trade-finance and platform were removed with the FastAPI backend they talked to, so
 * /modules/<slug> now falls through to "module not found" rather than redirecting to a 404.
 */
export const moduleSlugRedirects: Record<string, string> = {
  dashboard: '/dashboard',
  inventory: '/inventory',
  loans: '/loans',
  payroll: '/payroll',
}

export type ModuleSlug =
  | 'master-data'
  | 'procurement'
  | 'sales'
  | 'manufacturing'
  | 'lab'
  | 'crm'
  | 'hr'
  | 'accounting'
  | 'settings'
  | 'dashboard'
  | 'reports'
  | 'inventory'
  | 'livestock'
  | 'transport'
  | 'workshop'
  | 'fuel'
  | 'loans'
  | 'payroll'
  | 'trade-finance'

export const moduleSlugList: ModuleSlug[] = [
  'dashboard',
  'reports',
  'master-data',
  'procurement',
  'sales',
  'manufacturing',
  'lab',
  'inventory',
  'livestock',
  'transport',
  'workshop',
  'fuel',
  'loans',
  'crm',
  'hr',
  'accounting',
  'payroll',
  'trade-finance',
  'settings',
]

export type ModuleHubResult =
  | { kind: 'hub'; title: string; subtitle: string; links: HubLink[] }
  | { kind: 'redirect'; to: string }

export function getModuleHubBySlug(slug: string): ModuleHubResult | null {
  switch (slug as ModuleSlug) {
    case 'master-data':
      return { kind: 'hub', ...masterDataHub }
    case 'procurement':
      return { kind: 'hub', ...procurementHub }
    case 'sales':
      return { kind: 'hub', ...salesHub }
    case 'manufacturing':
      return { kind: 'hub', ...manufacturingHub }
    case 'lab':
      return { kind: 'hub', ...labHub }
    case 'workshop':
      return { kind: 'hub', ...workshopHub }
    case 'crm':
      return { kind: 'hub', ...crmHub }
    case 'hr':
      return { kind: 'hub', ...hrHub }
    case 'accounting':
      return { kind: 'hub', ...accountingHub }
    case 'trade-finance':
      return { kind: 'hub', ...tradeFinanceHub }
    case 'settings':
      return { kind: 'hub', ...settingsHub }
    case 'reports':
      return { kind: 'hub', ...reportsHub }
    default: {
      const to = moduleSlugRedirects[slug]
      if (to) return { kind: 'redirect', to }
      return null
    }
  }
}
