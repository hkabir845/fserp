import type { GroupedComboboxGroup } from '@/components/bills/SearchableGroupedCombobox'
import { formatCoaOptionLabel, type CoaLike } from '@/utils/coaOptionLabel'
import type { ReportingMapTarget } from '@/app/reporting-categories/reportingCategoriesScope'
import { groupReportingMapTargets } from '@/app/reporting-categories/reportingCategoriesScope'

export type VendorReferenceRow = {
  id: number
  display_name?: string | null
  vendor_number?: string
  email?: string | null
  phone?: string | null
}

export type CustomerReferenceRow = {
  id: number
  display_name?: string | null
  customer_number?: string
  email?: string | null
  phone?: string | null
}

export type EmployeeReferenceRow = {
  id: number
  display_name?: string
  employee_number?: string
  first_name?: string
  last_name?: string
  email?: string | null
}

export type CoaReferenceRow = CoaLike & { id: number }

function employeeDisplayName(e: EmployeeReferenceRow): string {
  const direct = (e.display_name || '').trim()
  if (direct) return direct
  const parts = [e.first_name, e.last_name].map((x) => (x || '').trim()).filter(Boolean)
  return parts.join(' ') || `Employee #${e.id}`
}

export function vendorReferenceGroups(vendors: VendorReferenceRow[]): GroupedComboboxGroup[] {
  if (vendors.length === 0) return []
  return [
    {
      label: 'Vendors',
      options: vendors.map((v) => {
        const name = (v.display_name || '').trim() || `Vendor #${v.id}`
        const num = (v.vendor_number || '').trim()
        const label = num ? `${name} (${num})` : name
        const meta = [num, v.email, v.phone].filter(Boolean).join(' · ')
        return {
          value: String(v.id),
          label,
          description: meta || undefined,
          searchText: `${name} ${num} ${v.email || ''} ${v.phone || ''}`,
          title: label,
        }
      }),
    },
  ]
}

export function customerReferenceGroups(customers: CustomerReferenceRow[]): GroupedComboboxGroup[] {
  if (customers.length === 0) return []
  return [
    {
      label: 'Customers',
      options: customers.map((c) => {
        const name = (c.display_name || '').trim() || `Customer #${c.id}`
        const num = (c.customer_number || '').trim()
        const label = num ? `${name} (${num})` : name
        const meta = [num, c.email, c.phone].filter(Boolean).join(' · ')
        return {
          value: String(c.id),
          label,
          description: meta || undefined,
          searchText: `${name} ${num} ${c.email || ''} ${c.phone || ''}`,
          title: label,
        }
      }),
    },
  ]
}

export function employeeReferenceGroups(employees: EmployeeReferenceRow[]): GroupedComboboxGroup[] {
  if (employees.length === 0) return []
  return [
    {
      label: 'Employees',
      options: employees.map((e) => {
        const name = employeeDisplayName(e)
        const num = (e.employee_number || '').trim()
        const label = num ? `${name} (${num})` : name
        return {
          value: String(e.id),
          label,
          description: num || e.email || undefined,
          searchText: `${name} ${num} ${e.email || ''}`,
          title: label,
        }
      }),
    },
  ]
}

export function coaAccountReferenceGroups(
  accounts: CoaReferenceRow[],
  opts?: { groupByType?: boolean },
): GroupedComboboxGroup[] {
  if (accounts.length === 0) return []
  const toOpt = (a: CoaReferenceRow) => {
    const label = formatCoaOptionLabel(a)
    return {
      value: String(a.id),
      label,
      description: (a.account_sub_type || '').replace(/_/g, ' ') || undefined,
      searchText: `${a.account_code || ''} ${a.account_name || ''} ${a.account_type || ''} ${a.account_sub_type || ''}`,
      title: label,
    }
  }
  if (opts?.groupByType === false) {
    return [{ label: 'Accounts', options: accounts.map(toOpt) }]
  }
  const buckets = new Map<string, CoaReferenceRow[]>()
  const order: string[] = []
  for (const a of accounts) {
    const g = (a.account_type || 'Other').replace(/_/g, ' ')
    const key = g.charAt(0).toUpperCase() + g.slice(1)
    if (!buckets.has(key)) {
      buckets.set(key, [])
      order.push(key)
    }
    buckets.get(key)!.push(a)
  }
  return order.map((group) => ({
    label: group,
    options: (buckets.get(group) || []).map(toOpt),
  }))
}

export function reportingMapTargetGroups(
  targets: ReportingMapTarget[],
  extraOption?: { value: string; label: string; searchText?: string; description?: string },
): GroupedComboboxGroup[] {
  const grouped = groupReportingMapTargets(targets)
  const out: GroupedComboboxGroup[] = grouped.map(({ group, items }) => ({
    label: group,
    options: items.map((m) => {
      const label = m.coa_code ? `${m.label} (${m.coa_code})` : m.label
      return {
        value: m.id,
        label,
        description: m.hint || undefined,
        searchText: `${m.id} ${m.label} ${m.coa_code || ''} ${m.hint || ''} ${m.group || ''}`,
        title: m.hint || label,
      }
    }),
  }))
  if (extraOption) {
    out.unshift({
      label: 'Current',
      options: [
        {
          value: extraOption.value,
          label: extraOption.label,
          searchText: extraOption.searchText || extraOption.label,
          description: extraOption.description,
        },
      ],
    })
  }
  return out
}

export function stringReferenceGroups(
  groupLabel: string,
  options: { value: string; label: string; description?: string; searchText?: string }[],
): GroupedComboboxGroup[] {
  if (options.length === 0) return []
  return [
    {
      label: groupLabel,
      options: options.map((o) => ({
        value: o.value,
        label: o.label,
        description: o.description,
        searchText: o.searchText ?? `${o.label} ${o.description || ''}`,
        title: o.label,
      })),
    },
  ]
}
