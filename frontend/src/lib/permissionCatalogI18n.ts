import type { AppLanguage } from '@/lib/i18n'
import { navLabel } from '@/lib/erpNavI18n'
import { REPORT_CATALOG_LABELS } from '@/lib/reportCatalogI18n'
import { APP_PAGE_PERMISSIONS } from '@/navigation/appPagePermissions'

export type PermCatalogItem = { id: string; label: string; group: string }

const PAGE_ID_TO_HREF: Record<string, string> = Object.fromEntries(
  APP_PAGE_PERMISSIONS.map((p) => [p.id, p.href])
)

const AQUACULTURE_PERM_TO_HREF: Record<string, string> = {
  'app.aquaculture.dashboard': '/aquaculture',
  'app.aquaculture.ponds': '/aquaculture/ponds',
  'app.aquaculture.landlords': '/aquaculture/landlords',
  'app.aquaculture.cycles': '/aquaculture/cycles',
  'app.aquaculture.transfers': '/aquaculture/transfers',
  'app.aquaculture.stock': '/aquaculture/stock',
  'app.aquaculture.sampling': '/aquaculture/sampling',
  'app.aquaculture.feeding': '/aquaculture/feeding',
  'app.aquaculture.medicine': '/aquaculture/medicine',
  'app.aquaculture.sales': '/aquaculture/sales',
  'app.aquaculture.expenses': '/aquaculture/expenses',
  'app.aquaculture.financing': '/aquaculture/financing',
  'app.aquaculture.data_bank': '/aquaculture/data-bank',
  'app.aquaculture.report_pl': '/reports?report=aquaculture-pl-management&category=aquaculture',
}

const PERMISSION_LABEL_BN: Record<string, string> = {
  'app.launcher': 'অ্যাপ লঞ্চার (সব Main অ্যাপ)',
  'app.pos': 'POS / ক্যাশিয়ার (সব Main POS অ্যাক্সেস)',
  'app.station': 'সব স্টেশন অ্যাপ (স্টেশন, ট্যাঙ্ক, আইল্যান্ড, ডিসপেন্সার, মিটার, নজল)',
  'app.operations': 'সব অপারেশন অ্যাপ (শিফট ও ট্যাঙ্ক ডিপ)',
  'app.accounting': 'সব হিসাব অ্যাপ (চার্ট, জার্নাল, ফান্ড ট্রান্সফার, ঋণ)',
  'app.sales': 'সব বিক্রি অ্যাপ (ভেন্ডর, ইনভয়েস, বিল, পেমেন্ট)',
  'app.customers': 'গ্রাহক ডিরেক্টরি (সব গ্রাহক অ্যাক্সেস)',
  'app.inventory': 'সব ইনভেন্টরি অ্যাপ (পণ্য ও স্টক স্থানান্তর)',
  'app.hr': 'সব HR অ্যাপ (কর্মচারী ও পে-রোল)',
  'app.settings': 'সব সেটিংস অ্যাপ (কোম্পানি, ট্যাক্স, সাবস্ক্রিপশন, রিপোর্টিং ক্যাটাগরি)',
  'app.users': 'ব্যবহারকারী অ্যাকাউন্ট (সব user management)',
  'app.roles': 'রোল ও অ্যাক্সেস (সব role management)',
  'app.backup': 'ব্যাকআপ ও রিস্টোর (সব backup অ্যাক্সেস)',
  'app.reports': 'রিপোর্ট হাব — সব আর্থিক, অপারেশন ও বিশ্লেষণ রিপোর্ট',
  'report.inventory_sku': 'সব ইনভেন্টরি ও আইটেম রিপোর্ট (শর্টকাট)',
  'app.aquaculture': 'অ্যাকোয়াকালচার — সব মডিউল',
  'app.aquaculture.report_pl': 'P&L ব্যবস্থাপনা রিপোর্ট (রিপোর্ট হাব)',
}

const GROUP_LABEL_BN: Record<string, string> = {
  'Apps — Main': 'অ্যাপস — মূল',
  'Apps — Station': 'অ্যাপস — স্টেশন',
  'Apps — Operations': 'অ্যাপস — অপারেশন',
  'Apps — Accounting': 'অ্যাপস — হিসাব',
  'Apps — Sales': 'অ্যাপস — বিক্রি',
  'Apps — Inventory': 'অ্যাপস — ইনভেন্টরি',
  'Apps — HR': 'অ্যাপস — HR',
  'Apps — Management': 'অ্যাপস — ব্যবস্থাপনা',
  'Apps — Reports': 'অ্যাপস — রিপোর্ট',
  Reports: 'রিপোর্ট',
  'Reports — Financial': 'রিপোর্ট — আর্থিক',
  'Reports — Operational': 'রিপোর্ট — অপারেশন',
  'Reports — Analytical': 'রিপোর্ট — বিশ্লেষণ',
  'Reports — Inventory': 'রিপোর্ট — ইনভেন্টরি',
  'Reports — Aquaculture': 'রিপোর্ট — অ্যাকোয়াকালচার',
  Aquaculture: 'অ্যাকোয়াকালচার',
}

function reportSlugFromPermissionId(id: string): string | null {
  if (!id.startsWith('report.')) return null
  const slug = id.slice('report.'.length).replace(/_/g, '-')
  return slug === 'inventory-sku' ? null : slug
}

export function localizePermissionLabel(id: string, fallback: string, lang: AppLanguage): string {
  if (lang !== 'bn') return fallback

  const href = PAGE_ID_TO_HREF[id] ?? AQUACULTURE_PERM_TO_HREF[id]
  if (href) return navLabel(href, lang, undefined, fallback)

  const reportSlug = reportSlugFromPermissionId(id)
  if (reportSlug && REPORT_CATALOG_LABELS[reportSlug]) {
    return REPORT_CATALOG_LABELS[reportSlug].title.bn
  }

  if (id === 'report.inventory_sku') {
    return PERMISSION_LABEL_BN[id]
  }

  return PERMISSION_LABEL_BN[id] ?? fallback
}

export function localizePermissionGroup(group: string, lang: AppLanguage): string {
  if (lang !== 'bn') return group
  return GROUP_LABEL_BN[group] ?? group
}

export function localizePermissionCatalog(
  catalog: PermCatalogItem[],
  lang: AppLanguage
): PermCatalogItem[] {
  if (lang !== 'bn') return catalog
  return catalog.map((item) => ({
    id: item.id,
    label: localizePermissionLabel(item.id, item.label, lang),
    group: localizePermissionGroup(item.group, lang),
  }))
}

export function permissionItemMatchesQuery(
  item: PermCatalogItem,
  query: string,
  lang: AppLanguage
): boolean {
  const q = query.toLowerCase().trim()
  if (!q) return true
  const localized = localizePermissionCatalog([item], lang)[0]
  return (
    item.id.toLowerCase().includes(q) ||
    item.label.toLowerCase().includes(q) ||
    item.group.toLowerCase().includes(q) ||
    localized.label.toLowerCase().includes(q) ||
    localized.group.toLowerCase().includes(q)
  )
}
