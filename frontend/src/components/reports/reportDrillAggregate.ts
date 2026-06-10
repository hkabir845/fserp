import type { AgingDrillDocument } from '@/components/reports/ReportDrillContext'

type EntityType = 'customers' | 'vendors'

/** Flatten invoice/bill document lists from report rows. */
export function mergeDocumentsFromRows(rows: readonly Record<string, unknown>[]): AgingDrillDocument[] {
  const out: AgingDrillDocument[] = []
  for (const r of rows) {
    if (Array.isArray(r.documents)) {
      out.push(...(r.documents as AgingDrillDocument[]))
    }
  }
  return out
}

/** Synthetic row for subtotals / grand totals backed by merged documents. */
export function documentsTotalRow(
  rows: readonly Record<string, unknown>[],
  opts: { title: string; entityType: EntityType; field?: string },
): Record<string, unknown> {
  const docs = mergeDocumentsFromRows(rows)
  const field = opts.field || 'total'
  const meta = {
    kind: 'aging-documents' as const,
    title: opts.title,
    entityType: opts.entityType,
    documents: docs,
  }
  return {
    documents: docs,
    _drill: { [field]: meta, total: meta },
  }
}

type AccountLine = {
  account_id: number
  account_code?: string
  account_name?: string
  amount: number | string
}

function accountBreakdownMeta(
  accounts: readonly Record<string, unknown>[],
  amountField: string,
  title: string,
) {
  const lines: AccountLine[] = accounts
    .filter((a) => Number(a[amountField] ?? 0) !== 0 && a.account_id != null)
    .map((a) => ({
      account_id: Number(a.account_id),
      account_code: String(a.account_code ?? ''),
      account_name: String(a.account_name ?? ''),
      amount: a[amountField] as number | string,
    }))
  return {
    kind: 'account-breakdown' as const,
    title,
    amountField,
    accounts: lines,
  }
}

/** Synthetic row for GL account subtotals (trial balance, P&L sections, balance sheet). */
export function accountsTotalRow(
  accounts: readonly Record<string, unknown>[],
  titlePrefix: string,
): Record<string, unknown> {
  const fields = ['debit', 'credit', 'balance', 'total'] as const
  const drill: Record<string, unknown> = {}
  for (const f of fields) {
    drill[f] = accountBreakdownMeta(accounts, f, `${titlePrefix} — ${f}`)
    drill[`total_${f}`] = drill[f]
  }
  return { _drill: drill }
}

type ItemLine = {
  item_id: number
  sku?: string
  name?: string
  amount: number | string
}

function itemBreakdownMeta(
  rows: readonly Record<string, unknown>[],
  amountField: string,
  title: string,
) {
  const lines: ItemLine[] = rows
    .filter((r) => Number(r[amountField] ?? 0) !== 0 && r.item_id != null)
    .map((r) => ({
      item_id: Number(r.item_id),
      sku: String(r.sku ?? r.item_number ?? ''),
      name: String(r.name ?? r.item_name ?? ''),
      amount: r[amountField] as number | string,
    }))
  return {
    kind: 'item-breakdown' as const,
    title,
    amountField,
    items: lines,
  }
}

/** Synthetic row for inventory / item report totals. */
export function itemsTotalRow(
  rows: readonly Record<string, unknown>[],
  title: string,
  amountFields: string[],
): Record<string, unknown> {
  const sourceField = (f: string) => {
    if (f === 'total_cost_value') return 'extended_cost_value'
    if (f === 'total_list_value') return 'extended_list_value'
    if (f === 'total_period_revenue') return 'period_revenue'
    return f
  }
  const drill: Record<string, unknown> = {}
  for (const f of amountFields) {
    drill[f] = itemBreakdownMeta(rows, sourceField(f), `${title} — ${f.replace(/_/g, ' ')}`)
  }
  drill.total = itemBreakdownMeta(rows, sourceField(amountFields[0] ?? 'total'), title)
  return { _drill: drill }
}

type LoanLine = {
  loan_id: number
  loan_no?: string
  counterparty_name?: string
  amount: number | string
}

function loanBreakdownMeta(
  rows: readonly Record<string, unknown>[],
  amountField: string,
  title: string,
) {
  const lines: LoanLine[] = rows
    .filter((r) => Number(r[amountField] ?? 0) !== 0)
    .map((r) => ({
      loan_id: Number(r.loan_id ?? r.id),
      loan_no: String(r.loan_no ?? ''),
      counterparty_name: String(r.counterparty_name ?? r.display_name ?? ''),
      amount: r[amountField] as number | string,
    }))
    .filter((l) => l.loan_id > 0)
  return {
    kind: 'loan-breakdown' as const,
    title,
    amountField,
    loans: lines,
  }
}

/** Synthetic row for loan portfolio totals. */
export function loansTotalRow(
  rows: readonly Record<string, unknown>[],
  title: string,
  amountFields: string[],
): Record<string, unknown> {
  const drill: Record<string, unknown> = {}
  for (const f of amountFields) {
    drill[f] = loanBreakdownMeta(rows, f, `${title} — ${f.replace(/_/g, ' ')}`)
  }
  return { _drill: drill }
}

export function mergeAgingBucketDocuments(
  parties: readonly Record<string, unknown>[],
  bucketKey?: string,
): AgingDrillDocument[] {
  const out: AgingDrillDocument[] = []
  for (const p of parties) {
    const docs = (p.documents as AgingDrillDocument[]) ?? []
    if (bucketKey) {
      out.push(...docs.filter((d) => d.bucket === bucketKey))
    } else {
      out.push(...docs)
    }
  }
  return out
}

export function agingBucketTotalRow(
  parties: readonly Record<string, unknown>[],
  opts: { title: string; entityType: EntityType; field: string; bucketKey?: string },
): Record<string, unknown> {
  const docs = mergeAgingBucketDocuments(parties, opts.bucketKey)
  const meta = {
    kind: 'aging-documents' as const,
    title: opts.title,
    entityType: opts.entityType,
    documents: docs,
  }
  return {
    documents: docs,
    _drill: { [opts.field]: meta, total: meta },
  }
}

export function isTotalField(field?: string): boolean {
  if (!field) return false
  return /^(total|grand_total|subtotal|.*_total|total_.*|sum|total_ar|total_ap|total_net_balance|gross_profit|net_income)$/i.test(
    field,
  )
}

/** Synthetic row for customer/vendor balance totals. */
export function contactsTotalRow(
  entries: readonly Record<string, unknown>[],
  title: string,
  entityType: EntityType,
  amountField = 'balance',
): Record<string, unknown> {
  const idKey = entityType === 'customers' ? 'customer_id' : 'vendor_id'
  const contacts = entries
    .filter((e) => Number(e[amountField] ?? 0) !== 0 && e[idKey] != null)
    .map((e) => ({
      entity_id: Number(e[idKey]),
      display_name: String(e.display_name ?? e.company_name ?? ''),
      amount: e[amountField] as number | string,
    }))
  const meta = {
    kind: 'contact-breakdown' as const,
    title,
    entityType,
    amountField,
    contacts,
  }
  const drill: Record<string, unknown> = {
    [amountField]: meta,
    total: meta,
    total_ar: meta,
    total_ap: meta,
    total_net_balance: meta,
  }
  return { _drill: drill }
}

type ScopedEntityLine = {
  pond_id?: number
  station_id?: number
  name?: string
  amount: number | string
}

function scopedPlBreakdownMeta(
  rows: readonly Record<string, unknown>[],
  amountField: string,
  title: string,
  idKey: 'pond_id' | 'station_id',
) {
  const nameKey = idKey === 'pond_id' ? 'pond_name' : 'station_name'
  const entities: ScopedEntityLine[] = rows
    .filter((r) => Number(r[amountField] ?? 0) !== 0 && r[idKey] != null)
    .map((r) => ({
      [idKey]: Number(r[idKey]),
      name: String(r[nameKey] ?? r.entity_name ?? ''),
      amount: r[amountField] as number | string,
    }))
  return {
    kind: 'scoped-pl-breakdown' as const,
    title,
    amountField,
    entities,
  }
}

/** Synthetic row for pond/station P&L totals (aquaculture, entity reports). */
export function scopedPlTotalRow(
  rows: readonly Record<string, unknown>[],
  title: string,
  amountField: string,
  idKey: 'pond_id' | 'station_id' = 'pond_id',
): Record<string, unknown> {
  const meta = scopedPlBreakdownMeta(rows, amountField, title, idKey)
  return {
    _drill: {
      [amountField]: meta,
      total: meta,
      profit: meta,
      revenue: meta,
      total_costs: meta,
      payroll_allocated: meta,
      segment_margin: meta,
    },
  }
}

