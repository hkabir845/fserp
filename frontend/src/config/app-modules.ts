import type { HubLink } from '@/components/ModuleHub'

/** Sidebar + module map — single source of truth for ERP navigation. */
export interface AppMenuItem {
  title: string
  href: string
  icon: string
  children?: AppMenuItem[]
}

export const erpMenuItems: AppMenuItem[] = [
  { title: 'Dashboard', href: '/dashboard', icon: '📊' },
  { title: 'Announcements', href: '/announcements', icon: '📣' },
  { title: 'Modules', href: '/modules', icon: '🗂️' },
  {
    title: 'Master Data',
    icon: '📋',
    href: '/master-data',
    children: [
      { title: 'Items', href: '/items', icon: '📦' },
      { title: 'Warehouses', href: '/warehouses', icon: '🏭' },
      { title: 'Suppliers', href: '/suppliers', icon: '🏢' },
      { title: 'Customers', href: '/customers', icon: '👥' },
    ],
  },
  {
    title: 'Procurement',
    icon: '🛒',
    href: '/procurement',
    children: [
      { title: 'Purchase requisitions', href: '/purchase/requisitions', icon: '📋' },
      { title: 'Approvals inbox', href: '/requisitions/inbox', icon: '✅' },
      { title: 'Purchase Orders', href: '/purchase/orders', icon: '📝' },
      { title: 'Goods Receipt', href: '/purchase/grn', icon: '📥' },
      { title: 'Vendor Bills', href: '/purchase/bills', icon: '💰' },
    ],
  },
  {
    title: 'Trade finance',
    icon: '🌐',
    href: '/trade-finance',
    children: [
      { title: 'Letters of credit (LC)', href: '/trade-finance/lc', icon: '📜' },
      { title: 'New LC', href: '/trade-finance/lc/new', icon: '➕' },
    ],
  },
  {
    title: 'Sales',
    icon: '💼',
    href: '/sales',
    children: [
      { title: 'Sales requisitions', href: '/sales/requisitions', icon: '📋' },
      { title: 'Approvals inbox', href: '/requisitions/inbox', icon: '✅' },
      { title: 'Sales Invoices', href: '/sales/invoices', icon: '🧾' },
      { title: 'Receipts', href: '/sales/receipts', icon: '💵' },
    ],
  },
  {
    title: 'Manufacturing',
    icon: '🏭',
    href: '/manufacturing',
    children: [
      { title: 'Feed BOMs (Formulations)', href: '/manufacturing/feed-boms', icon: '📐' },
      { title: 'Classic BOMs', href: '/manufacturing/boms', icon: '📎' },
      { title: 'Pre-formulations', href: '/preformulations', icon: '🧪' },
      { title: 'Silos', href: '/manufacturing/silos', icon: '🛖' },
      { title: 'Production Batches', href: '/manufacturing/batches', icon: '⚙️' },
      { title: 'Production Orders', href: '/manufacturing/production-orders', icon: '📋' },
      { title: 'Quality lab', href: '/lab', icon: '🧪' },
    ],
  },
  { title: 'Inventory', href: '/inventory', icon: '📊' },
  {
    title: 'Reporting',
    icon: '📈',
    href: '/reports',
    children: [
      { title: 'Reports hub', href: '/reports', icon: '📑' },
      { title: 'Trial balance', href: '/accounting/trial-balance', icon: '⚖️' },
      { title: 'Balance sheet', href: '/accounting/balance-sheet', icon: '📊' },
      { title: 'Journal entries', href: '/accounting/journal', icon: '📔' },
    ],
  },
  { title: 'Livestock', href: '/livestock', icon: '🐄' },
  { title: 'Transport', href: '/transport', icon: '🚚' },
  { title: 'Workshop', href: '/workshop', icon: '🔧' },
  { title: 'Fuel Station', href: '/fuel', icon: '⛽' },
  { title: 'Loans', href: '/loans', icon: '🏦' },
  {
    title: 'CRM',
    icon: '🤝',
    href: '/crm',
    children: [
      { title: 'Leads & pipeline', href: '/crm/leads', icon: '🎯' },
      { title: 'Activities', href: '/crm/activities', icon: '📌' },
    ],
  },
  {
    title: 'HR & people',
    icon: '👥',
    href: '/hr',
    children: [
      { title: 'Time & attendance', href: '/hr/time', icon: '🗓️' },
      { title: 'Expense claims', href: '/hr/expenses', icon: '🧾' },
      { title: 'Business cards', href: '/cards', icon: '💳' },
    ],
  },
  {
    title: 'Accounting',
    icon: '💳',
    href: '/accounting',
    children: [
      { title: 'Chart of Accounts', href: '/accounting/accounts', icon: '📑' },
      { title: 'Journal Entries', href: '/accounting/journal', icon: '📔' },
      { title: 'Trial Balance', href: '/accounting/trial-balance', icon: '⚖️' },
      { title: 'Balance Sheet', href: '/accounting/balance-sheet', icon: '📊' },
      { title: 'Loans (facilities)', href: '/loans', icon: '🏦' },
    ],
  },
  {
    title: 'Payroll',
    icon: '👔',
    href: '/payroll',
    children: [
      { title: 'Overview', href: '/payroll', icon: '📋' },
      { title: 'Employees', href: '/payroll/employees', icon: '👤' },
      { title: 'Payroll runs', href: '/payroll/runs', icon: '📅' },
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

/** Platform (SaaS operator) area — shown on /modules and optional hub. */
export const platformMenuItems: AppMenuItem[] = [
  { title: 'Platform dashboard', href: '/platform/dashboard', icon: '📊' },
  {
    title: 'Tenants',
    href: '/platform/tenants',
    icon: '🏢',
    children: [
      { title: 'All tenants', href: '/platform/tenants', icon: '📋' },
      { title: 'Browse', href: '/platform/tenants/browse', icon: '🔎' },
      { title: 'New tenant', href: '/platform/tenants/new', icon: '➕' },
    ],
  },
  { title: 'Subscription plans', href: '/platform/plans', icon: '📜' },
  { title: 'Billing', href: '/platform/billing', icon: '💳' },
  { title: 'Payments', href: '/platform/payments', icon: '💵' },
  { title: 'Invoices', href: '/platform/invoices', icon: '🧾' },
  { title: 'Subscriptions', href: '/platform/subscriptions', icon: '🔄' },
  { title: 'Broadcast', href: '/platform/broadcast', icon: '📢' },
  {
    title: 'Platform settings',
    href: '/platform/settings',
    icon: '⚙️',
    children: [
      { title: 'Overview', href: '/platform/settings', icon: '⚙️' },
      { title: 'General', href: '/platform/settings/general', icon: '📋' },
      { title: 'Currencies', href: '/platform/settings/currencies', icon: '💱' },
      { title: 'Units', href: '/platform/settings/units', icon: '📏' },
    ],
  },
]

export const masterDataHub = {
  title: 'Master Data',
  subtitle: 'Core reference data shared across procurement, sales, and inventory.',
  links: [
    { title: 'Items', href: '/items', icon: '📦', description: 'Products, SKUs, stock flags' },
    { title: 'Warehouses', href: '/warehouses', icon: '🏭', description: 'Storage locations' },
    { title: 'Suppliers', href: '/suppliers', icon: '🏢', description: 'Vendor master' },
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
      description: 'Multi-level approval before raising a PO',
    },
    { title: 'Approvals inbox', href: '/requisitions/inbox', icon: '✅', description: 'Department and executive queues' },
    { title: 'Purchase Orders', href: '/purchase/orders', icon: '📝', description: 'Create and track POs' },
    { title: 'Goods Receipt (GRN)', href: '/purchase/grn', icon: '📥', description: 'Receive against POs' },
    { title: 'Vendor Bills', href: '/purchase/bills', icon: '💰', description: 'Accounts payable bills' },
    {
      title: 'Letters of credit',
      href: '/trade-finance/lc',
      icon: '📜',
      description: 'Import/export LCs — Bangladesh AD bank workflow',
    },
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
      description: 'All letters of credit, import and export',
    },
    {
      title: 'New LC',
      href: '/trade-finance/lc/new',
      icon: '➕',
      description: 'Register application or opened LC from bank SWIFT',
    },
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
      description: 'Commercial approval chain before invoicing',
    },
    { title: 'Approvals inbox', href: '/requisitions/inbox', icon: '✅', description: 'Sales head and executive queues' },
    { title: 'Sales Invoices', href: '/sales/invoices', icon: '🧾', description: 'Customer billing' },
    { title: 'Receipts', href: '/sales/receipts', icon: '💵', description: 'Payment receipts' },
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
      description: 'Parameters, specs, samples, and OOS evaluation',
    },
  ] satisfies HubLink[],
}

export const manufacturingHub = {
  title: 'Manufacturing',
  subtitle: 'Formulations, batch runs, and production orders.',
  links: [
    { title: 'Quality lab', href: '/lab', icon: '🧪', description: 'Feed-grade and ingredient testing vs specs' },
    { title: 'Feed BOMs (Formulations)', href: '/manufacturing/feed-boms', icon: '📐', description: 'Formulations and recipes' },
    { title: 'Classic BOMs', href: '/manufacturing/boms', icon: '📎', description: 'Bill of materials (generic)' },
    { title: 'Pre-formulations', href: '/preformulations', icon: '🧪', description: 'R&D formulations before BOM' },
    { title: 'Production Batches', href: '/manufacturing/batches', icon: '⚙️', description: 'Batch-oriented production view' },
    { title: 'Production Orders', href: '/manufacturing/production-orders', icon: '📋', description: 'Manufacturing orders' },
    { title: 'Silos', href: '/manufacturing/silos', icon: '🛖', description: 'Bulk ingredient bins, levels, PLC / sensor hooks' },
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
      description: 'Create jobs, assign staff, track status from draft to complete',
    },
  ] satisfies HubLink[],
}

export const crmHub = {
  title: 'CRM',
  subtitle: 'Customer relationships for feed distribution: farms, dealers, integrators, and key accounts.',
  links: [
    { title: 'Leads & pipeline', href: '/crm/leads', icon: '🎯', description: 'Dealers, farms, distributors' },
    {
      title: 'Activities',
      href: '/crm/activities',
      icon: '📌',
      description: 'Calls, visits, tasks, and follow-ups on leads',
    },
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
      description: 'Leave requests and daily attendance',
    },
    { title: 'Expense claims', href: '/hr/expenses', icon: '🧾', description: 'Client visits, meals, transport, fuel' },
    { title: 'Digital business cards', href: '/cards', icon: '💳', description: 'NFC & digital cards for your team' },
  ] satisfies HubLink[],
}

export const accountingHub = {
  title: 'Accounting',
  subtitle: 'Financial records and statements (sections under active development).',
  links: [
    { title: 'Chart of Accounts', href: '/accounting/accounts', icon: '📑', description: 'GL account tree' },
    { title: 'Journal Entries', href: '/accounting/journal', icon: '📔', description: 'Manual journals' },
    { title: 'Trial Balance', href: '/accounting/trial-balance', icon: '⚖️', description: 'Period TB' },
    { title: 'Balance Sheet', href: '/accounting/balance-sheet', icon: '📊', description: 'Statement of position' },
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
    { title: 'Trial balance', href: '/accounting/trial-balance', icon: '⚖️', description: 'GL trial balance' },
    { title: 'Balance sheet', href: '/accounting/balance-sheet', icon: '📊', description: 'Statement of position' },
    { title: 'Journal entries', href: '/accounting/journal', icon: '📔', description: 'Posted and draft journals' },
    { title: 'Stock positions', href: '/inventory', icon: '📦', description: 'Ledger-based warehouse stock' },
  ] satisfies HubLink[],
}

export const settingsHub = {
  title: 'Settings',
  subtitle: 'Tenant defaults, currencies, and units of measure.',
  links: [
    { title: 'General', href: '/settings/general', icon: '⚙️', description: 'Company and defaults' },
    { title: 'Currencies', href: '/settings/currencies', icon: '💱', description: 'Tenant currency setup' },
    { title: 'Units of measure', href: '/settings/units', icon: '📏', description: 'UOM catalog for this tenant' },
  ] satisfies HubLink[],
}

export const platformHub = {
  title: 'Platform',
  subtitle: 'Multi-tenant SaaS administration (superadmin).',
  links: [
    { title: 'Platform dashboard', href: '/platform/dashboard', icon: '📊', description: 'Tenants and revenue overview' },
    { title: 'All tenants', href: '/platform/tenants', icon: '📋', description: 'Tenant directory' },
    { title: 'Browse tenants', href: '/platform/tenants/browse', icon: '🔎', description: 'Search and filter' },
    {
      title: 'Tenant backup & restore',
      href: '/platform/tenants/browse',
      icon: '💾',
      description: 'Per-tenant JSON export/restore — open a tenant from Browse',
    },
    { title: 'New tenant', href: '/platform/tenants/new', icon: '➕', description: 'Onboard a tenant' },
    { title: 'Subscription plans', href: '/platform/plans', icon: '📜', description: 'Plans and pricing' },
    { title: 'Billing', href: '/platform/billing', icon: '💳', description: 'Platform billing' },
    { title: 'Payments', href: '/platform/payments', icon: '💵', description: 'Payment records' },
    { title: 'Invoices', href: '/platform/invoices', icon: '🧾', description: 'Subscription invoices' },
    { title: 'Subscriptions', href: '/platform/subscriptions', icon: '🔄', description: 'Tenant subscriptions' },
    { title: 'Broadcast', href: '/platform/broadcast', icon: '📢', description: 'Announcements to tenants' },
    { title: 'Platform settings', href: '/platform/settings', icon: '⚙️', description: 'Global currencies and units' },
    { title: 'General (platform)', href: '/platform/settings/general', icon: '📋', description: 'Company-wide defaults' },
    { title: 'Currencies (platform)', href: '/platform/settings/currencies', icon: '💱', description: 'Master currency list' },
    { title: 'Units (platform)', href: '/platform/settings/units', icon: '📏', description: 'Master UOM list' },
  ] satisfies HubLink[],
}

/** Slug → canonical app path for modules that use a full screen instead of a link grid. */
export const moduleSlugRedirects: Record<string, string> = {
  dashboard: '/dashboard',
  lab: '/lab',
  inventory: '/inventory',
  livestock: '/livestock',
  transport: '/transport',
  workshop: '/workshop',
  fuel: '/fuel',
  loans: '/loans',
  payroll: '/payroll',
  platform: '/platform',
  'trade-finance': '/trade-finance/lc',
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
