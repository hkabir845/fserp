/**
 * QuickBooks-style report hub: categories + links into existing ERP screens.
 * Operational dataset reports still come from GET /reports/catalog.
 */

export type ReportCategoryId =
  | 'company'
  | 'receivables'
  | 'payables'
  | 'sales'
  | 'purchases'
  | 'inventory'
  | 'payroll'
  | 'assets'
  | 'manufacturing'
  | 'custom'

export const REPORT_CATEGORY_ORDER: ReportCategoryId[] = [
  'company',
  'receivables',
  'payables',
  'sales',
  'purchases',
  'inventory',
  'payroll',
  'assets',
  'manufacturing',
  'custom',
]

export const REPORT_CATEGORY_META: Record<
  ReportCategoryId,
  { title: string; subtitle: string }
> = {
  company: {
    title: 'Company & financial',
    subtitle: 'Trial balance, balance sheet, GL, chart of accounts, borrowing.',
  },
  receivables: {
    title: 'Customers & receivables (A/R)',
    subtitle: 'Who owes you, invoices, and cash receipts.',
  },
  payables: {
    title: 'Suppliers & payables (A/P)',
    subtitle: 'Who you owe, purchase documents, and GRN.',
  },
  sales: {
    title: 'Sales',
    subtitle: 'Orders-to-cash workflow and requisitions.',
  },
  purchases: {
    title: 'Purchases',
    subtitle: 'Procurement, vendor bills, and inbound logistics.',
  },
  inventory: {
    title: 'Inventory & operations',
    subtitle: 'Stock, items, warehouses, fuel, and operational analytics below.',
  },
  payroll: {
    title: 'Payroll & people',
    subtitle: 'Employees, runs, time, and expenses.',
  },
  assets: {
    title: 'Fixed assets & fleet',
    subtitle: 'Vehicles, workshop, and trade finance.',
  },
  manufacturing: {
    title: 'Manufacturing',
    subtitle: 'Production, BOMs, silos, batches, and lab.',
  },
  custom: {
    title: 'Custom reports',
    subtitle: 'Save named reports on top of live datasets (same sources as catalog).',
  },
}

export type StaticReportLink = {
  name: string
  description: string
  href: string
  tag?: string
}

export const STATIC_REPORT_LINKS: Record<ReportCategoryId, StaticReportLink[]> = {
  company: [
    {
      name: 'Trial balance',
      description: 'All GL accounts with debits, credits, and net balance as of a date.',
      href: '/accounting/trial-balance',
      tag: 'GL',
    },
    {
      name: 'Balance sheet',
      description: 'Assets, liabilities, and equity as of a date.',
      href: '/accounting/balance-sheet',
      tag: 'GL',
    },
    {
      name: 'Journal entries',
      description: 'Posted and draft journals with line detail.',
      href: '/accounting/journal',
      tag: 'GL',
    },
    {
      name: 'Chart of accounts',
      description: 'Account list, hierarchy, and feed-mill template.',
      href: '/accounting/accounts',
      tag: 'GL',
    },
    {
      name: 'Loans & facilities',
      description: 'Borrowing schedules, interest, and principal.',
      href: '/loans',
      tag: 'Finance',
    },
    {
      name: 'Dashboard',
      description: 'Executive snapshot for the signed-in tenant.',
      href: '/dashboard',
      tag: 'Home',
    },
  ],
  receivables: [
    {
      name: 'Customer master',
      description: 'Customers with bank details, opening balance, and sub-ledger codes.',
      href: '/customers',
      tag: 'Master',
    },
    {
      name: 'Sales invoices',
      description: 'Posted and draft customer invoices.',
      href: '/sales/invoices',
      tag: 'A/R',
    },
    {
      name: 'Receipts',
      description: 'Customer cash and bank receipts.',
      href: '/sales/receipts',
      tag: 'A/R',
    },
    {
      name: 'Sales requisitions',
      description: 'Internal sales requests before invoicing.',
      href: '/sales/requisitions',
      tag: 'Sales',
    },
  ],
  payables: [
    {
      name: 'Supplier master',
      description: 'Vendors with opening AP and sub-ledger codes.',
      href: '/suppliers',
      tag: 'Master',
    },
    {
      name: 'Purchase orders',
      description: 'Open and historical POs.',
      href: '/purchase/orders',
      tag: 'A/P',
    },
    {
      name: 'Goods receipts (GRN)',
      description: 'Inbound receipts against POs.',
      href: '/purchase/grn',
      tag: 'A/P',
    },
    {
      name: 'Vendor bills',
      description: 'Recorded supplier invoices for payment.',
      href: '/purchase/bills',
      tag: 'A/P',
    },
    {
      name: 'Purchase requisitions',
      description: 'Internal procurement requests.',
      href: '/purchase/requisitions',
      tag: 'Procurement',
    },
  ],
  sales: [
    {
      name: 'Sales hub',
      description: 'Sales module landing and shortcuts.',
      href: '/sales',
      tag: 'Hub',
    },
    {
      name: 'CRM leads',
      description: 'Pipeline and lead tracking.',
      href: '/crm/leads',
      tag: 'CRM',
    },
    {
      name: 'CRM activities',
      description: 'Calls, tasks, and follow-ups.',
      href: '/crm/activities',
      tag: 'CRM',
    },
  ],
  purchases: [
    {
      name: 'Procurement hub',
      description: 'Purchasing overview.',
      href: '/procurement',
      tag: 'Hub',
    },
    {
      name: 'Requisitions inbox',
      description: 'Cross-team purchase and sales requisition inbox.',
      href: '/requisitions/inbox',
      tag: 'Workflow',
    },
  ],
  inventory: [
    {
      name: 'Stock positions',
      description: 'On-hand by item and warehouse (and fuel tanks where applicable).',
      href: '/inventory',
      tag: 'Stock',
    },
    {
      name: 'Items & catalog',
      description: 'SKU master, costing, and fuel items.',
      href: '/items',
      tag: 'Master',
    },
    {
      name: 'Warehouses',
      description: 'Locations for stock ledger.',
      href: '/warehouses',
      tag: 'Master',
    },
    {
      name: 'Fuel station',
      description: 'Tanks, receipts, and internal issues.',
      href: '/fuel',
      tag: 'Ops',
    },
    {
      name: 'Livestock',
      description: 'Herd and flock registers.',
      href: '/livestock',
      tag: 'Ops',
    },
  ],
  payroll: [
    {
      name: 'Employees',
      description: 'Roster, salary structures, and employee sub-ledgers.',
      href: '/payroll/employees',
      tag: 'Payroll',
    },
    {
      name: 'Payroll runs',
      description: 'Period runs, payslips, and posting status.',
      href: '/payroll/runs',
      tag: 'Payroll',
    },
    {
      name: 'Time & attendance',
      description: 'Timesheets and attendance.',
      href: '/hr/time',
      tag: 'HR',
    },
    {
      name: 'Expense claims',
      description: 'Employee reimbursements.',
      href: '/hr/expenses',
      tag: 'HR',
    },
  ],
  assets: [
    {
      name: 'Fleet & transport',
      description: 'Vehicles, trips, and delivery notes.',
      href: '/transport',
      tag: 'Fleet',
    },
    {
      name: 'Workshop jobs',
      description: 'Maintenance and repair jobs.',
      href: '/workshop',
      tag: 'Assets',
    },
    {
      name: 'Letters of credit',
      description: 'LC register and amendments.',
      href: '/trade-finance/lc',
      tag: 'Trade',
    },
    {
      name: 'Trade finance hub',
      description: 'LC and related trade finance.',
      href: '/trade-finance',
      tag: 'Hub',
    },
  ],
  manufacturing: [
    {
      name: 'Manufacturing hub',
      description: 'Production overview.',
      href: '/manufacturing',
      tag: 'Hub',
    },
    {
      name: 'Production orders',
      description: 'Batch manufacturing orders.',
      href: '/manufacturing/production-orders',
      tag: 'MFG',
    },
    {
      name: 'Feed BOMs',
      description: 'Bill of materials for feed products.',
      href: '/manufacturing/feed-boms',
      tag: 'MFG',
    },
    {
      name: 'Silos',
      description: 'Bulk ingredient storage and transactions.',
      href: '/manufacturing/silos',
      tag: 'MFG',
    },
    {
      name: 'Classic BOMs & batches',
      description: 'Legacy BOM and batch views.',
      href: '/manufacturing/boms',
      tag: 'MFG',
    },
    {
      name: 'Lab & QC',
      description: 'Specifications, samples, and results.',
      href: '/lab',
      tag: 'QC',
    },
  ],
  custom: [],
}
