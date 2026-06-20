/** Stable permission keys for aquaculture sub-modules (Roles page + menu). */

export const AQUACULTURE_ALL = 'app.aquaculture'

export const AQUACULTURE_MODULE_PERMISSIONS: { id: string; label: string }[] = [
  { id: 'app.aquaculture.dashboard', label: 'Operations dashboard' },
  { id: 'app.aquaculture.ponds', label: 'Ponds' },
  { id: 'app.aquaculture.landlords', label: 'Landlords' },
  { id: 'app.aquaculture.cycles', label: 'Stocking batches' },
  { id: 'app.aquaculture.transfers', label: 'Pond transfers' },
  { id: 'app.aquaculture.stock', label: 'Pond stock' },
  { id: 'app.aquaculture.sampling', label: 'Biomass sampling' },
  { id: 'app.aquaculture.feeding', label: 'Feeding advice' },
  { id: 'app.aquaculture.medicine', label: 'Medicine & treatments' },
  { id: 'app.aquaculture.sales', label: 'Pond & fish sales' },
  { id: 'app.aquaculture.expenses', label: 'Pond costs & expenses' },
  { id: 'app.aquaculture.financing', label: 'Financing & loan repayment' },
  { id: 'app.aquaculture.data_bank', label: 'Data Bank' },
  { id: 'app.aquaculture.report_pl', label: 'P&L management report (Reports hub)' },
]

const HREF_TO_MODULE: Record<string, string> = {
  '/aquaculture': 'app.aquaculture.dashboard',
  '/aquaculture/ponds': 'app.aquaculture.ponds',
  '/aquaculture/landlords': 'app.aquaculture.landlords',
  '/aquaculture/cycles': 'app.aquaculture.cycles',
  '/aquaculture/transfers': 'app.aquaculture.transfers',
  '/aquaculture/stock': 'app.aquaculture.stock',
  '/aquaculture/sampling': 'app.aquaculture.sampling',
  '/aquaculture/feeding': 'app.aquaculture.feeding',
  '/aquaculture/medicine': 'app.aquaculture.medicine',
  '/aquaculture/sales': 'app.aquaculture.sales',
  '/aquaculture/expenses': 'app.aquaculture.expenses',
  '/aquaculture/financing': 'app.aquaculture.financing',
  '/aquaculture/data-bank': 'app.aquaculture.data_bank',
  '/aquaculture/report': 'app.aquaculture.report_pl',
  '/reports?report=aquaculture-pl-management&category=aquaculture': 'app.aquaculture.report_pl',
}

export function aquacultureModulePermissionForHref(href: string): string | null {
  const path = href.split('?')[0].replace(/\/$/, '') || '/'
  if (HREF_TO_MODULE[path]) return HREF_TO_MODULE[path]
  if (path.startsWith('/aquaculture/ponds/')) return 'app.aquaculture.ponds'
  if (path.startsWith('/aquaculture/landlords/')) return 'app.aquaculture.landlords'
  if (path.startsWith('/aquaculture')) return AQUACULTURE_ALL
  if (href.includes('aquaculture-pl-management')) return 'app.aquaculture.report_pl'
  return null
}

export function hasAquacultureModuleInList(perms: string[], moduleId: string): boolean {
  if (perms.includes('*') || perms.includes(AQUACULTURE_ALL)) return true
  return perms.includes(moduleId)
}

export function hasAnyAquacultureModuleInList(perms: string[]): boolean {
  if (perms.includes('*') || perms.includes(AQUACULTURE_ALL)) return true
  return AQUACULTURE_MODULE_PERMISSIONS.some((m) => perms.includes(m.id))
}

export function menuHrefAllowedForAquaculture(href: string, perms: string[]): boolean {
  const mod = aquacultureModulePermissionForHref(href)
  if (!mod) return false
  return hasAquacultureModuleInList(perms, mod)
}
