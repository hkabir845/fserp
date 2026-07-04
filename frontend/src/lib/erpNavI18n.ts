/**
 * ERP sidebar / app launcher labels (en / bn) keyed by route href.
 * Company.language drives which string is shown via useErpNavigationMenu.
 */
import { pick, type AppLanguage } from '@/lib/i18n'

type Row = { en: string; bn: string }

const NAV_BY_HREF: Record<string, Row> = {
  '/apps': { en: 'Apps', bn: 'অ্যাপস' },
  '/dashboard': { en: 'Dashboard', bn: 'ড্যাশবোর্ড' },
  '/brain': { en: 'Company Brain', bn: 'কোম্পানি ব্রেইন' },
  '/cashier': { en: 'POS / Cashier', bn: 'POS / ক্যাশিয়ার' },

  '/stations': { en: 'Stations', bn: 'স্টেশন' },
  '/tanks': { en: 'Tanks', bn: 'ট্যাঙ্ক' },
  '/islands': { en: 'Islands', bn: 'আইল্যান্ড' },
  '/dispensers': { en: 'Dispensers', bn: 'ডিসপেন্সার' },
  '/meters': { en: 'Meters', bn: 'মিটার' },
  '/nozzles': { en: 'Nozzles', bn: 'নজল' },

  '/shift-management': { en: 'Shift Management', bn: 'শিফট ব্যবস্থাপনা' },
  '/tank-dips': { en: 'Tank Dips', bn: 'ট্যাঙ্ক ডিপ' },

  '/chart-of-accounts': { en: 'Chart of Accounts', bn: 'অ্যাকাউন্ট চার্ট' },
  '/journal-entries': { en: 'Journal Entries', bn: 'জার্নাল এন্ট্রি' },
  '/fund-transfers': { en: 'Fund Transfer', bn: 'ফান্ড ট্রান্সফার' },
  '/loans': { en: 'Loans', bn: 'ঋণ' },
  '/fixed-assets': { en: 'Fixed Assets', bn: 'স্থায়ী সম্পদ' },

  '/customers': { en: 'Customers', bn: 'গ্রাহক' },
  '/vendors': { en: 'Vendors', bn: 'ভেন্ডর' },
  '/invoices': { en: 'Invoices', bn: 'ইনভয়েস' },
  '/bills': { en: 'Bills', bn: 'বিল' },
  '/payments': { en: 'Payments', bn: 'পেমেন্ট' },

  '/items': { en: 'Products & services', bn: 'পণ্য ও সেবা' },
  '/inventory': { en: 'Inventory & transfers', bn: 'ইনভেন্টরি ও স্থানান্তর' },

  '/employees': { en: 'Employees', bn: 'কর্মচারী' },
  '/payroll': { en: 'Payroll', bn: 'পে-রোল' },

  '/company': { en: 'Company', bn: 'কোম্পানি' },
  '/subscriptions': { en: 'Subscriptions', bn: 'সাবস্ক্রিপশন' },
  '/users': { en: 'Users', bn: 'ব্যবহারকারী' },
  '/roles': { en: 'Roles & access', bn: 'রোল ও অ্যাক্সেস' },
  '/tax': { en: 'Tax', bn: 'ট্যাক্স' },
  '/reporting-categories': { en: 'Reporting categories', bn: 'রিপোর্টিং ক্যাটাগরি' },
  '/backup': { en: 'Backup & Restore', bn: 'ব্যাকআপ ও রিস্টোর' },

  '/reports': { en: 'Reports', bn: 'রিপোর্ট' },

  '/aquaculture': { en: 'Dashboard', bn: 'ড্যাশবোর্ড' },
  '/aquaculture/ponds': { en: 'Ponds', bn: 'পুকুর' },
  '/aquaculture/landlords': { en: 'Landlords', bn: 'জমির মালিক' },
  '/aquaculture/cycles': { en: 'Stocking batches', bn: 'স্টকিং ব্যাচ' },
  '/aquaculture/transfers': { en: 'Fish pond transfers', bn: 'পুকুর স্থানান্তর' },
  '/aquaculture/stock': { en: 'Pond stock', bn: 'পুকুর স্টক' },
  '/aquaculture/sampling': { en: 'Biomass sampling', bn: 'বায়োমাস নমুনা' },
  '/aquaculture/feeding': { en: 'Feeding advice', bn: 'খাবার পরামর্শ' },
  '/aquaculture/medicine': { en: 'Medicine & treatments', bn: 'ঔষধ ও চিকিৎসা' },
  '/aquaculture/sales': { en: 'Pond & fish sales', bn: 'পুকুর ও মাছ বিক্রি' },
  '/aquaculture/expenses': { en: 'Pond costs', bn: 'পুকুর খরচ' },
  '/aquaculture/financing': { en: 'Financing', bn: 'অর্থায়ন' },
  '/aquaculture/data-bank': { en: 'Data Bank', bn: 'ডেটা ব্যাংক' },
  '/aquaculture/report': { en: 'Aquaculture report', bn: 'অ্যাকোয়াকালচার রিপোর্ট' },
  '/reports?report=aquaculture-pl-management&category=aquaculture': {
    en: 'P&L management',
    bn: 'লাভ-ক্ষতি ব্যবস্থাপনা',
  },

  '/aquaculture/stock/adjustments': { en: 'Mortality & adj.', bn: 'মৃত্যু ও সমন্বয়' },
  '/aquaculture/stock/movements': { en: 'All movements', bn: 'সব চলাচল' },
  '/aquaculture/stock/breakdown': { en: 'Batch detail', bn: 'ব্যাচ বিবরণ' },
  '/aquaculture/stock/supplies': { en: 'Feed & supplies', bn: 'খাদ্য ও সরঞ্জাম' },
  '/aquaculture/stock/supplies/movements': { en: 'WH movements', bn: 'গুদাম চলাচল' },
  '/aquaculture/stock/supplies/consumed': { en: 'Consumed', bn: 'ব্যবহৃত' },
  '/aquaculture/stock/options': { en: 'Options', bn: 'অপশন' },

  '/admin/overview': { en: 'Platform Overview', bn: 'প্ল্যাটফর্ম ওভারভিউ' },
  '/admin/subscription-billing': { en: 'Subscription & Billing', bn: 'সাবস্ক্রিপশন ও বিলিং' },
  '/admin/companies': { en: 'Companies ({count})', bn: 'কোম্পানি ({count})' },
  '/admin/users': { en: 'All Users ({count})', bn: 'সব ব্যবহারকারী ({count})' },
  '/admin/contracts': { en: 'Contract Management', bn: 'চুক্তি ব্যবস্থাপনা' },
  '/admin/subscription-ledger': { en: 'Subscription Ledger', bn: 'সাবস্ক্রিপশন লেজার' },
  '/admin/broadcasting': { en: 'Broadcasting', bn: 'ব্রডকাস্টিং' },
  '/admin/backup': { en: 'Backup & Restore', bn: 'ব্যাকআপ ও রিস্টোর' },
  '/admin/brain-settings': { en: 'Brain API', bn: 'ব্রেইন API' },
}

export type ErpNavSectionId =
  | 'main'
  | 'station'
  | 'operations'
  | 'accounting'
  | 'sales'
  | 'inventory'
  | 'hr'
  | 'management'
  | 'aquaculture'
  | 'reports'
  | 'saas'

const SECTION_LABELS: Record<ErpNavSectionId, Row> = {
  main: { en: 'Main', bn: 'মূল' },
  station: { en: 'Station Management', bn: 'স্টেশন ব্যবস্থাপনা' },
  operations: { en: 'Operations', bn: 'অপারেশন' },
  accounting: { en: 'Accounting', bn: 'হিসাব' },
  sales: { en: 'Sales & Customers', bn: 'বিক্রি ও গ্রাহক' },
  inventory: { en: 'Products & services', bn: 'পণ্য ও সেবা' },
  hr: { en: 'HR & Payroll', bn: 'HR ও পে-রোল' },
  management: { en: 'Management', bn: 'ব্যবস্থাপনা' },
  aquaculture: { en: 'Aquaculture', bn: 'অ্যাকোয়াকালচার' },
  reports: { en: 'Reports & Analytics', bn: 'রিপোর্ট ও বিশ্লেষণ' },
  saas: { en: 'SaaS Management', bn: 'SaaS ব্যবস্থাপনা' },
}

const AQUACULTURE_GROUP_LABELS: Record<string, Row> = {
  overview: { en: 'Overview', bn: 'সংক্ষিপ্ত বিবরণ' },
  site: { en: 'Site & lease', bn: 'সাইট ও লিজ' },
  production: { en: 'Fish production', bn: 'মাছ উৎপাদন' },
  economics: { en: 'Economics', bn: 'অর্থনীতি' },
  archive: { en: 'Archive', bn: 'আর্কাইভ' },
}

function applyVars(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  let s = template
  for (const [k, v] of Object.entries(vars)) {
    s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
  }
  return s
}

export function navLabel(
  href: string,
  lang: AppLanguage,
  vars?: Record<string, string | number>,
  fallback?: string
): string {
  const row = NAV_BY_HREF[href]
  if (row) return applyVars(pick(lang, row.en, row.bn), vars)
  return fallback ?? href
}

export function navSectionLabel(sectionId: ErpNavSectionId, lang: AppLanguage): string {
  const row = SECTION_LABELS[sectionId]
  return row ? pick(lang, row.en, row.bn) : sectionId
}

export function aquacultureGroupLabel(groupId: string, lang: AppLanguage, fallback?: string): string {
  const row = AQUACULTURE_GROUP_LABELS[groupId]
  if (row) return pick(lang, row.en, row.bn)
  return fallback ?? groupId
}
