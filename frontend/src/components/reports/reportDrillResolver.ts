import type { ReportDrillTarget, AgingDrillDocument } from '@/components/reports/ReportDrillContext'
import { isTotalField } from '@/components/reports/reportDrillAggregate'

export type ReportDrillScope = {
  startDate?: string
  endDate?: string
  stationId?: number | null
  pondId?: number | null
  reportType?: string
}

type DrillMeta = Partial<ReportDrillTarget> & { kind?: string }

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function pickDrillMeta(row: Record<string, unknown>, field?: string): DrillMeta | null {
  const raw = row._drill
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  if (field && d[field] && typeof d[field] === 'object') {
    return d[field] as DrillMeta
  }
  if (d.kind) return d as DrillMeta
  return null
}

function metaToTarget(meta: DrillMeta, scope: ReportDrillScope): ReportDrillTarget | null {
  const kind = String(meta.kind || '')
  switch (kind) {
    case 'gl-account':
      if (!num(meta.accountId ?? meta.account_id)) return null
      return {
        kind: 'gl-account',
        accountId: num(meta.accountId ?? meta.account_id),
        label: typeof meta.label === 'string' ? meta.label : undefined,
        startDate: (meta.startDate as string) || scope.startDate,
        endDate: (meta.endDate as string) || scope.endDate,
        stationId: meta.stationId != null ? num(meta.stationId) : scope.stationId,
        pondId: meta.pondId != null ? num(meta.pondId) : scope.pondId,
      }
    case 'contact-ledger':
      if (!num(meta.entityId ?? meta.entity_id)) return null
      return {
        kind: 'contact-ledger',
        entity: (meta.entity as 'customers' | 'vendors') || 'customers',
        entityId: num(meta.entityId ?? meta.entity_id),
        label: typeof meta.label === 'string' ? meta.label : undefined,
        startDate: (meta.startDate as string) || scope.startDate,
        endDate: (meta.endDate as string) || scope.endDate,
      }
    case 'invoice':
      if (!num(meta.invoiceId ?? meta.invoice_id)) return null
      return {
        kind: 'invoice',
        invoiceId: num(meta.invoiceId ?? meta.invoice_id),
        label: typeof meta.label === 'string' ? meta.label : undefined,
      }
    case 'bill':
      if (!num(meta.billId ?? meta.bill_id)) return null
      return {
        kind: 'bill',
        billId: num(meta.billId ?? meta.bill_id),
        label: typeof meta.label === 'string' ? meta.label : undefined,
      }
    case 'aging-documents':
      if (!Array.isArray(meta.documents)) return null
      return {
        kind: 'aging-documents',
        title: String(meta.title || 'Documents'),
        subtitle: typeof meta.subtitle === 'string' ? meta.subtitle : undefined,
        entityType: (meta.entityType as 'customers' | 'vendors') || 'customers',
        documents: meta.documents as AgingDrillDocument[],
      }
    case 'invoice-list':
      if (!num(meta.customerId ?? meta.customer_id)) return null
      return {
        kind: 'invoice-list',
        customerId: num(meta.customerId ?? meta.customer_id),
        label: typeof meta.label === 'string' ? meta.label : undefined,
        startDate: (meta.startDate as string) || scope.startDate,
        endDate: (meta.endDate as string) || scope.endDate,
        stationId: meta.stationId != null ? num(meta.stationId) : scope.stationId,
        paymentFilter: meta.paymentFilter as 'cash' | 'credit' | 'all' | undefined,
      }
    case 'bill-list':
      if (!num(meta.vendorId ?? meta.vendor_id)) return null
      return {
        kind: 'bill-list',
        vendorId: num(meta.vendorId ?? meta.vendor_id),
        label: typeof meta.label === 'string' ? meta.label : undefined,
        startDate: (meta.startDate as string) || scope.startDate,
        endDate: (meta.endDate as string) || scope.endDate,
        stationId: meta.stationId != null ? num(meta.stationId) : scope.stationId,
      }
    case 'item-stock-ledger':
      if (!num(meta.itemId ?? meta.item_id)) return null
      return {
        kind: 'item-stock-ledger',
        itemId: num(meta.itemId ?? meta.item_id),
        label: typeof meta.label === 'string' ? meta.label : undefined,
        startDate: (meta.startDate as string) || scope.startDate,
        endDate: (meta.endDate as string) || scope.endDate,
      }
    case 'loan-statement':
      if (!num(meta.loanId ?? meta.loan_id ?? meta.id)) return null
      return {
        kind: 'loan-statement',
        loanId: num(meta.loanId ?? meta.loan_id ?? meta.id),
        label: typeof meta.label === 'string' ? meta.label : undefined,
        startDate: (meta.startDate as string) || scope.startDate,
        endDate: (meta.endDate as string) || scope.endDate,
      }
    case 'scoped-pl':
      return {
        kind: 'scoped-pl',
        stationId: meta.stationId != null ? num(meta.stationId) : scope.stationId ?? null,
        pondId: meta.pondId != null ? num(meta.pondId) : scope.pondId ?? null,
        label: typeof meta.label === 'string' ? meta.label : undefined,
        startDate: (meta.startDate as string) || scope.startDate,
        endDate: (meta.endDate as string) || scope.endDate,
      }
    case 'account-breakdown':
      if (!Array.isArray(meta.accounts)) return null
      return {
        kind: 'account-breakdown',
        title: String(meta.title || 'Accounts'),
        amountField: String(meta.amountField || 'balance'),
        accounts: meta.accounts as ReportDrillTarget extends { kind: 'account-breakdown' } ? never : never,
        startDate: (meta.startDate as string) || scope.startDate,
        endDate: (meta.endDate as string) || scope.endDate,
        stationId: meta.stationId != null ? num(meta.stationId) : scope.stationId,
        pondId: meta.pondId != null ? num(meta.pondId) : scope.pondId,
      } as ReportDrillTarget
    case 'item-breakdown':
      if (!Array.isArray(meta.items)) return null
      return {
        kind: 'item-breakdown',
        title: String(meta.title || 'Items'),
        amountField: String(meta.amountField || 'amount'),
        items: meta.items as ReportDrillTarget extends { kind: 'item-breakdown' } ? never : never,
        startDate: (meta.startDate as string) || scope.startDate,
        endDate: (meta.endDate as string) || scope.endDate,
      } as ReportDrillTarget
    case 'loan-breakdown':
      if (!Array.isArray(meta.loans)) return null
      return {
        kind: 'loan-breakdown',
        title: String(meta.title || 'Loans'),
        amountField: String(meta.amountField || 'amount'),
        loans: meta.loans as ReportDrillTarget extends { kind: 'loan-breakdown' } ? never : never,
        startDate: (meta.startDate as string) || scope.startDate,
        endDate: (meta.endDate as string) || scope.endDate,
      } as ReportDrillTarget
    case 'contact-breakdown':
      if (!Array.isArray(meta.contacts)) return null
      return {
        kind: 'contact-breakdown',
        title: String(meta.title || 'Contacts'),
        entityType: (meta.entityType as 'customers' | 'vendors') || 'customers',
        amountField: String(meta.amountField || 'balance'),
        contacts: meta.contacts as ReportDrillTarget extends { kind: 'contact-breakdown' } ? never : never,
        startDate: (meta.startDate as string) || scope.startDate,
        endDate: (meta.endDate as string) || scope.endDate,
      } as ReportDrillTarget
    case 'scoped-pl-breakdown':
      if (!Array.isArray(meta.entities)) return null
      return {
        kind: 'scoped-pl-breakdown',
        title: String(meta.title || 'Sites'),
        amountField: String(meta.amountField || 'amount'),
        entities: meta.entities as ReportDrillTarget extends { kind: 'scoped-pl-breakdown' } ? never : never,
        startDate: (meta.startDate as string) || scope.startDate,
        endDate: (meta.endDate as string) || scope.endDate,
      } as ReportDrillTarget
    default:
      return null
  }
}

/** Resolve a drill target from explicit metadata, row IDs, or field heuristics. */
export function resolveDrillFromRow(
  row: Record<string, unknown> | null | undefined,
  field: string | undefined,
  scope: ReportDrillScope,
): ReportDrillTarget | null {
  if (!row) return null

  const meta = pickDrillMeta(row, field)
  if (meta) {
    const fromMeta = metaToTarget(meta, scope)
    if (fromMeta) return fromMeta
  }

  const accountId = num(row.account_id ?? row.principal_account_id)
  const amountFields = new Set([
    'balance',
    'debit',
    'credit',
    'total',
    'amount',
    'total_amount',
    'period_revenue',
    'extended_cost_value',
    'extended_list_value',
    'purchase_amount',
    'sales_revenue',
    'net_income',
    'income',
    'expenses',
    'cost_of_goods_sold',
    'gross_profit',
    'deposits',
    'withdrawals',
    'beginning_balance',
    'ending_balance',
    'net_change',
    'outstanding',
    'period_disbursements',
    'period_repayments',
  ])

  if (accountId && (!field || amountFields.has(field) || field.includes('balance') || field.includes('amount'))) {
    const label =
      row.account_name && row.account_code
        ? `${row.account_code} — ${row.account_name}`
        : String(row.account_name || row.account_code || '')
    return {
      kind: 'gl-account',
      accountId,
      label: label || undefined,
      startDate: scope.startDate,
      endDate: scope.endDate,
      stationId: scope.stationId,
      pondId: scope.pondId,
    }
  }

  const invoiceId = num(row.invoice_id)
  if (invoiceId && (!field || field.includes('amount') || field.includes('total') || field === 'period_revenue')) {
    return {
      kind: 'invoice',
      invoiceId,
      label: String(row.document_number || row.invoice_number || ''),
    }
  }

  const billId = num(row.bill_id)
  if (billId && (!field || field.includes('amount') || field.includes('total'))) {
    return {
      kind: 'bill',
      billId,
      label: String(row.document_number || row.bill_number || ''),
    }
  }

  const customerId = num(row.customer_id)
  if (
    customerId &&
    field &&
    (field === 'total' || field.includes('balance') || field.includes('amount') || field.includes('revenue'))
  ) {
    if (Array.isArray(row.documents) && row.documents.length > 0) {
      return {
        kind: 'aging-documents',
        title: String(row.display_name || 'Customer'),
        entityType: 'customers',
        documents: row.documents as AgingDrillDocument[],
      }
    }
    return {
      kind: 'invoice-list',
      customerId,
      label: String(row.display_name || ''),
      startDate: scope.startDate,
      endDate: scope.endDate,
      stationId: scope.stationId,
    }
  }

  const vendorId = num(row.vendor_id)
  if (
    vendorId &&
    field &&
    (field === 'total' || field.includes('balance') || field.includes('amount') || field.includes('purchase'))
  ) {
    if (Array.isArray(row.documents) && row.documents.length > 0) {
      return {
        kind: 'aging-documents',
        title: String(row.display_name || 'Vendor'),
        entityType: 'vendors',
        documents: row.documents as AgingDrillDocument[],
      }
    }
    return {
      kind: 'bill-list',
      vendorId,
      label: String(row.display_name || ''),
      startDate: scope.startDate,
      endDate: scope.endDate,
      stationId: scope.stationId,
    }
  }

  const itemId = num(row.item_id)
  if (
    itemId &&
    field &&
    (field.includes('revenue') ||
      field.includes('cost') ||
      field.includes('value') ||
      field.includes('amount') ||
      field.includes('purchase'))
  ) {
    return {
      kind: 'item-stock-ledger',
      itemId,
      label: String(row.name || row.item_name || row.sku || ''),
      startDate: scope.startDate,
      endDate: scope.endDate,
    }
  }

  const loanId = num(row.loan_id ?? row.id)
  if (
    loanId &&
    field &&
    (field.includes('outstanding') ||
      field.includes('disbursement') ||
      field.includes('repayment') ||
      field.includes('balance') ||
      field.includes('amount') ||
      field.includes('principal'))
  ) {
    return {
      kind: 'loan-statement',
      loanId,
      label: String(row.counterparty_name || row.loan_name || row.display_name || ''),
      startDate: scope.startDate,
      endDate: scope.endDate,
    }
  }

  const stationId = num(row.station_id ?? (row.entity_type === 'station' ? row.entity_id : 0))
  const pondId = num(row.pond_id ?? (row.entity_type === 'pond' ? row.entity_id : 0))
  const scopedPlFields = new Set([
    'net_income',
    'income',
    'expenses',
    'cost_of_goods_sold',
    'gross_profit',
    'revenue',
    'profit',
    'total_costs',
    'payroll_allocated',
    'direct_operating_expenses',
    'shared_operating_expenses',
    'segment_margin',
  ])
  if (field && scopedPlFields.has(field) && (stationId > 0 || pondId > 0)) {
    return {
      kind: 'scoped-pl',
      stationId: stationId > 0 ? stationId : null,
      pondId: pondId > 0 ? pondId : null,
      label: String(row.entity_name || row.pond_name || row.station_name || ''),
      startDate: scope.startDate,
      endDate: scope.endDate,
    }
  }

  if (
    field &&
    (field.includes('total') || isTotalField(field)) &&
    Array.isArray(row.documents) &&
    row.documents.length > 0
  ) {
    return {
      kind: 'aging-documents',
      title: String(row.display_name || row.station_name || row.entity_name || 'Documents'),
      entityType: customerId ? 'customers' : vendorId ? 'vendors' : 'customers',
      documents: row.documents as AgingDrillDocument[],
    }
  }

  return null
}
