import { escapeHtml } from '@/utils/printDocument'
import { formatNumber } from '@/utils/currency'
import type { CustomerContactExport, VendorContactExport } from '@/utils/businessDocumentExport'

export type ListTotalAmount = {
  value: number
  currencySymbol?: string
}

export function buildListTotalsFooter(options: {
  labelColspan: number
  label: string
  amounts?: ListTotalAmount[]
  trailingEmptyCols?: number
}): string {
  const { labelColspan, label, amounts = [], trailingEmptyCols = 0 } = options
  let cells = `<td colspan="${labelColspan}" class="right"><strong>${escapeHtml(label)}</strong></td>`
  for (const amt of amounts) {
    const formatted = amt.currencySymbol
      ? `${amt.currencySymbol}${formatNumber(amt.value)}`
      : formatNumber(amt.value)
    cells += `<td class="right"><strong>${escapeHtml(formatted)}</strong></td>`
  }
  for (let i = 0; i < trailingEmptyCols; i += 1) {
    cells += '<td></td>'
  }
  return `<tfoot><tr class="row-total">${cells}</tr></tfoot>`
}

export function buildListTruncatedNotice(
  rowCount: number,
  totalCount: number | undefined,
  entityPlural: string,
): string {
  if (totalCount == null || totalCount <= rowCount) return ''
  return `<p class="muted">List capped at ${rowCount} of ${totalCount} matching ${escapeHtml(entityPlural)} — totals reflect printed rows only.</p>`
}

function sumContactBalances(rows: Array<{ current_balance?: number | string }>): number {
  return rows.reduce((sum, row) => sum + (Number(row.current_balance) || 0), 0)
}

export type ContactListKind = 'customer' | 'vendor'

export function buildContactListPrintHtml(
  kind: ContactListKind,
  rows: CustomerContactExport[] | VendorContactExport[],
  currencySymbol: string,
  totalCount?: number,
): string {
  const count = rows.length
  const entity = kind === 'customer' ? 'customer' : 'vendor'
  const entityPlural = kind === 'customer' ? 'customers' : 'vendors'
  const balanceKind = kind === 'customer' ? 'receivable' : 'payable'
  const totalBalance = sumContactBalances(rows)

  let headHtml: string
  let bodyHtml: string
  let labelColspan: number

  if (kind === 'customer') {
    const customerRows = rows as CustomerContactExport[]
    headHtml =
      '<th>Customer #</th><th>Name</th><th>Default site</th><th>Contact</th><th class="right">Balance</th><th>Status</th>'
    bodyHtml = customerRows
      .map((c) => {
        const bal = Number(c.current_balance || 0)
        const contact = [c.email, c.phone].filter(Boolean).join(' · ') || '—'
        return `<tr>
            <td>${escapeHtml(c.customer_number || '')}</td>
            <td>${escapeHtml(c.display_name || '—')}</td>
            <td>${escapeHtml((c.default_station_name || '').trim() || '—')}</td>
            <td>${escapeHtml(contact)}</td>
            <td class="right">${escapeHtml(currencySymbol)}${escapeHtml(formatNumber(bal))}</td>
            <td>${escapeHtml(c.is_active ? 'Active' : 'Inactive')}</td>
          </tr>`
      })
      .join('')
    labelColspan = 4
  } else {
    const vendorRows = rows as VendorContactExport[]
    headHtml =
      '<th>Vendor #</th><th>Company</th><th>Display name</th><th>Usual location</th><th>Email</th><th class="right">Balance</th><th>Status</th>'
    bodyHtml = vendorRows
      .map((v) => {
        const bal = Number(v.current_balance || 0)
        return `<tr>
            <td>${escapeHtml(v.vendor_number || '')}</td>
            <td>${escapeHtml(v.company_name || '—')}</td>
            <td>${escapeHtml(v.display_name || '—')}</td>
            <td>${escapeHtml(v.usual_location || '—')}</td>
            <td>${escapeHtml(v.email || '—')}</td>
            <td class="right">${escapeHtml(currencySymbol)}${escapeHtml(formatNumber(bal))}</td>
            <td>${escapeHtml(v.is_active ? 'Active' : 'Inactive')}</td>
          </tr>`
      })
      .join('')
    labelColspan = 5
  }

  const tfootHtml =
    count > 0
      ? buildListTotalsFooter({
          labelColspan,
          label: `Total ${balanceKind} (${count} ${entity}${count === 1 ? '' : 's'})`,
          amounts: [{ value: totalBalance, currencySymbol }],
          trailingEmptyCols: 1,
        })
      : ''

  const truncated = buildListTruncatedNotice(count, totalCount, entityPlural)
  const summaryHtml =
    count > 0
      ? `<div class="summary"><p><strong>Total ${balanceKind} balance:</strong> ${escapeHtml(currencySymbol)}${escapeHtml(formatNumber(totalBalance))}</p>${truncated}</div>`
      : ''

  return `<table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml || `<tr><td colspan="20">No ${escapeHtml(entityPlural)}</td></tr>`}</tbody>${tfootHtml}</table>${summaryHtml}`
}
