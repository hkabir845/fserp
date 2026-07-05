/**
 * CSV and print HTML builders for reports that share ExtraFinancialReportPanels shapes.
 */

import { escapeHtml } from '@/utils/printDocument'

export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  const str = String(value).replace(/"/g, '""')
  return `"${str}"`
}

const AGING_BUCKETS = [
  { key: 'current', label: 'Current' },
  { key: 'days_1_30', label: '1-30 days' },
  { key: 'days_31_60', label: '31-60 days' },
  { key: 'days_61_90', label: '61-90 days' },
  { key: 'days_over_90', label: '90+ days' },
] as const

function entityRowsCsv(
  section: string,
  kind: 'pl' | 'bs' | 'tb',
  rows: Record<string, unknown>[],
): string {
  if (!rows.length) return ''
  let out = `\n${section}\n`
  if (kind === 'pl') {
    out += 'Entity,Income,COGS,Expenses,Gross profit,Net income\n'
    rows.forEach((r) => {
      out += [
        escapeCsvValue(r.entity_name),
        r.income ?? 0,
        r.cost_of_goods_sold ?? 0,
        r.expenses ?? 0,
        r.gross_profit ?? 0,
        r.net_income ?? 0,
      ].join(',')
      out += '\n'
    })
  } else if (kind === 'bs') {
    out += 'Entity,Assets,Liabilities,Equity,L+E\n'
    rows.forEach((r) => {
      out += [
        escapeCsvValue(r.entity_name),
        r.total_assets ?? 0,
        r.total_liabilities ?? 0,
        r.total_equity ?? 0,
        r.total_liabilities_and_equity ?? 0,
      ].join(',')
      out += '\n'
    })
  } else {
    out += 'Entity,Debits,Credits,Balanced\n'
    rows.forEach((r) => {
      out += [
        escapeCsvValue(r.entity_name),
        r.trial_balance_debit ?? 0,
        r.trial_balance_credit ?? 0,
        r.trial_balance_balanced ? 'Yes' : 'No',
      ].join(',')
      out += '\n'
    })
  }
  return out
}

function appendEntitySectionsCsv(data: Record<string, unknown>, kind: 'pl' | 'bs' | 'tb'): string {
  const byStation = (data.by_station as Record<string, unknown>[]) ?? []
  const byFuel =
    (data.by_fuel_station as Record<string, unknown>[]) ??
    byStation.filter((r) => r.business_kind !== 'shop_hub')
  const byShop =
    (data.by_shop_hub as Record<string, unknown>[]) ??
    byStation.filter((r) => r.business_kind === 'shop_hub')
  const byPond = (data.by_pond as Record<string, unknown>[]) ?? []
  const unscoped = data.unscoped as Record<string, unknown> | undefined
  let out = ''
  out += entityRowsCsv(`${kind.toUpperCase()} — fuel filling stations`, kind, byFuel)
  out += entityRowsCsv(`${kind.toUpperCase()} — shop hubs (no fuel)`, kind, byShop)
  if (byPond.length) out += entityRowsCsv(`${kind.toUpperCase()} — ponds`, kind, byPond)
  if (unscoped) out += entityRowsCsv(`${kind.toUpperCase()} — head office`, kind, [unscoped])
  return out
}

/** Returns CSV body lines (no metadata header) for extra-financial report types. */
export function buildExtraFinancialReportCsv(
  reportId: string,
  data: Record<string, unknown>,
): string | null {
  if (reportId === 'expense-detail') {
    const expenses = data.expenses as { accounts?: Record<string, unknown>[]; total?: number } | undefined
    const accounts = expenses?.accounts ?? []
    let out = 'Account code,Account name,Balance\n'
    accounts.forEach((a) => {
      out += `${escapeCsvValue(a.account_code)},${escapeCsvValue(a.account_name)},${a.balance ?? 0}\n`
    })
    out += `Total,,${expenses?.total ?? 0}\n`
    return out
  }

  if (reportId === 'income-detail') {
    const income = data.income as { accounts?: Record<string, unknown>[]; total?: number } | undefined
    const accounts = income?.accounts ?? []
    let out = 'Account code,Account name,Balance\n'
    accounts.forEach((a) => {
      out += `${escapeCsvValue(a.account_code)},${escapeCsvValue(a.account_name)},${a.balance ?? 0}\n`
    })
    out += `Total,,${income?.total ?? 0}\n`
    return out
  }

  if (reportId === 'cash-flow') {
    const op = (data.operating as Record<string, number>) ?? {}
    const cash = (data.cash_summary as Record<string, number>) ?? {}
    let out = 'Metric,Value\n'
    out += `Net income (P&L),${op.net_income ?? 0}\n`
    out += `Customer payments received,${op.customer_payments_received ?? 0}\n`
    out += `Vendor payments made,${op.vendor_payments_made ?? 0}\n`
    out += `Beginning cash,${cash.beginning_cash ?? 0}\n`
    out += `Net change in cash,${cash.net_change_in_cash ?? 0}\n`
    out += `Ending cash,${cash.ending_cash ?? 0}\n`
    const banks = (data.bank_accounts as Record<string, unknown>[]) ?? []
    if (banks.length) {
      out += '\nBank account,Code,Beginning,Deposits,Withdrawals,Ending\n'
      banks.forEach((b) => {
        out += [
          escapeCsvValue(b.account_name),
          escapeCsvValue(b.account_code),
          b.beginning_balance ?? 0,
          b.deposits ?? 0,
          b.withdrawals ?? 0,
          b.ending_balance ?? 0,
        ].join(',')
        out += '\n'
      })
    }
    const entityCsv = (title: string, rows: Record<string, unknown>[]) => {
      if (!rows.length) return ''
      let s = `\n${title}\nEntity,Net income,Inflows,Outflows,Net cash change,Ending cash\n`
      rows.forEach((r) => {
        s += [
          escapeCsvValue(r.entity_name),
          r.net_income ?? 0,
          r.customer_payments_received ?? 0,
          r.vendor_payments_made ?? 0,
          r.net_change_in_cash ?? 0,
          r.ending_cash ?? 0,
        ].join(',')
        s += '\n'
      })
      return s
    }
    out += entityCsv('By station', (data.by_station as Record<string, unknown>[]) ?? [])
    out += entityCsv('By pond', (data.by_pond as Record<string, unknown>[]) ?? [])
    const unscoped = data.unscoped as Record<string, unknown> | undefined
    if (unscoped) out += entityCsv('Head office', [unscoped])
    return out
  }

  if (
    reportId === 'entities-pl-summary' ||
    reportId === 'entities-balance-sheet-summary' ||
    reportId === 'entities-trial-balance-summary' ||
    reportId === 'entities-financial-summary'
  ) {
    const kind =
      reportId === 'entities-pl-summary'
        ? 'pl'
        : reportId === 'entities-balance-sheet-summary'
          ? 'bs'
          : reportId === 'entities-trial-balance-summary'
            ? 'tb'
            : 'combined'
    let out = ''
    if (kind === 'combined' || kind === 'pl') out += appendEntitySectionsCsv(data, 'pl')
    if (kind === 'combined' || kind === 'bs') out += appendEntitySectionsCsv(data, 'bs')
    if (kind === 'tb') out += appendEntitySectionsCsv(data, 'tb')
    const co = (data.company_total as Record<string, unknown>) ?? {}
    out += '\nCompany total\n'
    if (kind !== 'tb') {
      out += `Income,${co.income ?? 0}\nCOGS,${co.cost_of_goods_sold ?? 0}\nExpenses,${co.expenses ?? 0}\nGross profit,${co.gross_profit ?? 0}\nNet income,${co.net_income ?? 0}\n`
    }
    if (kind === 'bs' || kind === 'combined') {
      out += `Assets,${co.total_assets ?? 0}\nLiabilities,${co.total_liabilities ?? 0}\nEquity,${co.total_equity ?? 0}\n`
    }
    if (kind === 'tb') {
      out += `TB debits,${co.trial_balance_debit ?? 0}\nTB credits,${co.trial_balance_credit ?? 0}\nBalanced,${co.trial_balance_balanced ? 'Yes' : 'No'}\n`
    }
    return out
  }

  if (
    reportId === 'stations-financial-summary' ||
    reportId === 'fuel-stations-pl-summary' ||
    reportId === 'shop-hubs-pl-summary' ||
    reportId === 'ponds-pl-summary'
  ) {
    const isPond = reportId === 'ponds-pl-summary'
    const isFuel = reportId === 'fuel-stations-pl-summary'
    const isShop = reportId === 'shop-hubs-pl-summary'
    const rows = (isPond
      ? (data.ponds as Record<string, unknown>[])
      : isFuel
        ? (data.fuel_stations as Record<string, unknown>[])
        : isShop
          ? (data.shop_hubs as Record<string, unknown>[])
          : (data.stations as Record<string, unknown>[])) ?? []
    const catTotal = (isPond
      ? data.ponds_total
      : isFuel || isShop
        ? data.category_total
        : data.stations_total) as Record<string, number> | undefined
    const co = (data.company_total as Record<string, number>) ?? {}
    const label = isPond ? 'Pond' : isFuel ? 'Fuel station' : isShop ? 'Shop hub' : 'Station'
    let out = `${label},Income,COGS,Expenses,Gross profit,Net income\n`
    rows.forEach((r) => {
      out += [
        escapeCsvValue(isPond ? r.pond_name : r.station_name ?? r.entity_name),
        r.income ?? 0,
        r.cost_of_goods_sold ?? 0,
        r.expenses ?? 0,
        r.gross_profit ?? 0,
        r.net_income ?? 0,
      ].join(',')
      out += '\n'
    })
    if (catTotal) {
      out += `Category total,${catTotal.income ?? 0},${catTotal.cost_of_goods_sold ?? 0},${catTotal.expenses ?? 0},${catTotal.gross_profit ?? 0},${catTotal.net_income ?? 0}\n`
    }
    out += `Company total,${co.income ?? 0},${co.cost_of_goods_sold ?? 0},${co.expenses ?? 0},${co.gross_profit ?? 0},${co.net_income ?? 0}\n`
    return out
  }

  if (reportId === 'ar-aging' || reportId === 'ap-aging') {
    const isAr = reportId === 'ar-aging'
    const list = (isAr ? data.customers : data.vendors) as Record<string, unknown>[] | undefined
    const parties = list ?? []
    const totals = (data.totals as Record<string, number>) ?? {}
    let out = `${isAr ? 'Customer' : 'Vendor'},${AGING_BUCKETS.map((b) => b.label).join(',')},Total\n`
    parties.forEach((p) => {
      out += [
        escapeCsvValue(p.display_name),
        ...AGING_BUCKETS.map((b) => p[b.key] ?? 0),
        p.total ?? 0,
      ].join(',')
      out += '\n'
    })
    out += `Totals,${AGING_BUCKETS.map((b) => totals[b.key] ?? 0).join(',')},${totals.total ?? 0}\n`
    return out
  }

  return null
}

const LINE_CSV_COLUMNS: { key: string; header: string }[] = [
  { key: 'sale_date', header: 'Date' },
  { key: 'invoice_date', header: 'Date' },
  { key: 'transaction_date', header: 'Date' },
  { key: 'entry_date', header: 'Date' },
  { key: 'name', header: 'Name' },
  { key: 'description', header: 'Description' },
  { key: 'income_type_label', header: 'Type' },
  { key: 'fish_species_label', header: 'Species' },
  { key: 'item_name', header: 'Item' },
  { key: 'invoice_number', header: 'Invoice' },
  { key: 'buyer_name', header: 'Party' },
  { key: 'weight_kg', header: 'Weight kg' },
  { key: 'quantity', header: 'Qty' },
  { key: 'amount', header: 'Amount' },
  { key: 'total_amount', header: 'Amount' },
  { key: 'debit', header: 'Debit' },
  { key: 'credit', header: 'Credit' },
  { key: 'balance', header: 'Balance' },
]

function lineToCsvCells(line: Record<string, unknown>): string[] {
  const used = new Set<string>()
  const cells: string[] = []
  for (const col of LINE_CSV_COLUMNS) {
    if (col.key in line && line[col.key] != null && line[col.key] !== '' && !used.has(col.key)) {
      used.add(col.key)
      cells.push(String(line[col.key]))
    }
  }
  if (!cells.length) {
    Object.entries(line).forEach(([k, v]) => {
      if (v != null && typeof v !== 'object') cells.push(`${k}=${v}`)
    })
  }
  return cells
}

/** Flatten aquaculture `groups[].lines[]` into readable CSV (not JSON blobs). */
export function buildAquacultureGroupsCsv(data: Record<string, unknown>): string {
  const groups = Array.isArray(data.groups) ? (data.groups as Record<string, unknown>[]) : []
  if (!groups.length) return ''
  let out = 'Pond,Line #,Details,Amount\n'
  groups.forEach((g) => {
    const pond = String(g.pond_name ?? '')
    const lines = Array.isArray(g.lines) ? (g.lines as Record<string, unknown>[]) : []
    lines.forEach((ln, idx) => {
      const cells = lineToCsvCells(ln)
      const amount =
        ln.total_amount ?? ln.amount ?? ln.debit ?? ln.credit ?? ln.balance ?? g.subtotal_amount ?? ''
      out += `${escapeCsvValue(pond)},${idx + 1},${escapeCsvValue(cells.join(' | '))},${amount}\n`
    })
    if (g.subtotal_amount != null || g.subtotal_samples != null) {
      out += `${escapeCsvValue(pond)},,Subtotal,${g.subtotal_amount ?? g.subtotal_samples ?? ''}\n`
    }
  })
  return out
}

const GENERIC_EXPORT_SKIP_KEYS = new Set([
  'period',
  'summary',
  'report_id',
  'accounting_note',
  'company_total',
  'filters',
])

function scalarColumns(sample: Record<string, unknown>): string[] {
  return Object.keys(sample).filter((k) => {
    if (k === '_drill') return false
    const v = sample[k]
    return v == null || typeof v !== 'object'
  })
}

function appendArraySectionCsv(
  out: string,
  title: string,
  rows: Record<string, unknown>[],
): string {
  if (!rows.length) return out
  const cols = scalarColumns(rows[0])
  if (cols.length < 1) return out
  let section = `\n${title}\n${cols.join(',')}\n`
  rows.forEach((row) => {
    section += cols.map((c) => escapeCsvValue(row[c])).join(',')
    section += '\n'
  })
  return out + section
}

/** Best-effort CSV from unknown report payload (all top-level arrays of objects). */
export function buildGenericTabularCsv(data: Record<string, unknown>): string | null {
  let out = ''
  for (const [key, val] of Object.entries(data)) {
    if (GENERIC_EXPORT_SKIP_KEYS.has(key) || !Array.isArray(val) || val.length === 0) continue
    const first = val[0]
    if (!first || typeof first !== 'object' || Array.isArray(first)) continue
    out = appendArraySectionCsv(out, key.replace(/_/g, ' '), val as Record<string, unknown>[])
  }
  for (const [key, val] of Object.entries(data)) {
    if (GENERIC_EXPORT_SKIP_KEYS.has(key) || val == null || Array.isArray(val)) continue
    if (typeof val !== 'object') continue
    const obj = val as Record<string, unknown>
    const accounts = obj.accounts
    if (Array.isArray(accounts) && accounts.length > 0 && typeof accounts[0] === 'object') {
      out = appendArraySectionCsv(out, key.replace(/_/g, ' '), accounts as Record<string, unknown>[])
    }
  }
  return out.trim() ? out : null
}

function printGroupsHtml(title: string, groups: Record<string, unknown>[]): string {
  if (!groups.length) return ''
  let html = `<h2>${escapeHtml(title)}</h2>`
  groups.forEach((g) => {
    const pond = String(g.pond_name ?? '')
    const lines = Array.isArray(g.lines) ? (g.lines as Record<string, unknown>[]) : []
    if (!lines.length) return
    const cols = scalarColumns(lines[0])
    if (!cols.length) return
    html += `<h3>${escapeHtml(pond)}</h3><table><thead><tr>`
    cols.forEach((c) => {
      html += `<th>${escapeHtml(c.replace(/_/g, ' '))}</th>`
    })
    html += '</tr></thead><tbody>'
    lines.forEach((ln) => {
      html += '<tr>'
      cols.forEach((c) => {
        html += `<td>${escapeHtml(String(ln[c] ?? ''))}</td>`
      })
      html += '</tr>'
    })
    html += '</tbody></table>'
    if (g.subtotal_amount != null || g.subtotal_samples != null) {
      html += `<p><strong>Subtotal:</strong> ${escapeHtml(String(g.subtotal_amount ?? g.subtotal_samples ?? ''))}</p>`
    }
  })
  return html
}

/** Print HTML for aquaculture report payloads (groups, pond P&L, nested sections). */
export function buildAquaculturePrintHtml(
  reportId: string,
  data: Record<string, unknown>,
): string | null {
  if (reportId === 'aquaculture-pond-pl' && Array.isArray(data.ponds)) {
    const ponds = data.ponds as Record<string, unknown>[]
    const headers = [
      'Pond',
      'Fish sales (right)',
      'Empty sacks (right)',
      'Other income (right)',
      'Total revenue (right)',
      'Feed consumed (right)',
      'Medicine consumed (right)',
      'Fry/fingerling (right)',
      'Lease (right)',
      'Other expenses (right)',
      'Payroll (right)',
      'Total costs (right)',
      'Net profit (right)',
    ]
    const rows = ponds.map((p) => [
      String(p.pond_name ?? ''),
      fmtMoney(p.revenue_fish_sales),
      fmtMoney(p.revenue_empty_sack_sales),
      fmtMoney(p.revenue_other_income),
      fmtMoney(p.revenue),
      fmtMoney(p.feed_consumption_cost),
      fmtMoney(p.medicine_consumption_cost),
      fmtMoney(p.fry_fingerling_cost),
      fmtMoney(p.lease_cost),
      fmtMoney(p.other_operating_expenses),
      fmtMoney(p.payroll_allocated),
      fmtMoney(p.total_costs),
      fmtMoney(p.profit),
    ])
    let html = htmlTable('Pond P&L', headers, rows)
    const totals = (data.totals as Record<string, unknown>) ?? {}
    if (Object.keys(totals).length) {
      html += `<div class="summary"><p><strong>Total fish sales:</strong> ${fmtMoney(totals.revenue_fish_sales)}</p>`
      html += `<p><strong>Total empty sacks:</strong> ${fmtMoney(totals.revenue_empty_sack_sales)}</p>`
      html += `<p><strong>Total other income:</strong> ${fmtMoney(totals.revenue_other_income)}</p>`
      html += `<p><strong>Total revenue:</strong> ${fmtMoney(totals.revenue)}</p>`
      html += `<p><strong>Total feed consumption:</strong> ${fmtMoney(totals.feed_consumption_cost)}</p>`
      html += `<p><strong>Total medicine consumption:</strong> ${fmtMoney(totals.medicine_consumption_cost)}</p>`
      html += `<p><strong>Total fry/fingerling:</strong> ${fmtMoney(totals.fry_fingerling_cost)}</p>`
      html += `<p><strong>Total lease:</strong> ${fmtMoney(totals.lease_cost)}</p>`
      html += `<p><strong>Total other expenses:</strong> ${fmtMoney(totals.other_operating_expenses)}</p>`
      html += `<p><strong>Total costs:</strong> ${fmtMoney(totals.total_costs)}</p>`
      html += `<p><strong>Total profit:</strong> ${fmtMoney(totals.profit)}</p></div>`
    }
    return html
  }

  if (Array.isArray(data.groups)) {
    return printGroupsHtml('Detail', data.groups as Record<string, unknown>[])
  }

  if (reportId === 'aquaculture-pond-sales-comprehensive') {
    let html = ''
    const fish = data.fish_sales as Record<string, unknown> | undefined
    const pos = data.pos_shop_sales as Record<string, unknown> | undefined
    if (fish && Array.isArray(fish.groups)) {
      html += printGroupsHtml('Registered pond sales', fish.groups as Record<string, unknown>[])
    }
    if (pos && Array.isArray(pos.groups)) {
      html += printGroupsHtml('Pond POS (non-fuel)', pos.groups as Record<string, unknown>[])
    }
    return html || null
  }

  return buildGenericPrintHtml(data)
}

/** Auto-table print HTML for any report JSON with array sections (fallback). */
export function buildGenericPrintHtml(data: Record<string, unknown>): string | null {
  let html = ''
  for (const [key, val] of Object.entries(data)) {
    if (GENERIC_EXPORT_SKIP_KEYS.has(key) || !Array.isArray(val) || val.length === 0) continue
    const first = val[0]
    if (!first || typeof first !== 'object' || Array.isArray(first)) continue
    const rows = val as Record<string, unknown>[]
    const cols = scalarColumns(rows[0])
    if (cols.length < 1) continue
    html += htmlTable(
      key.replace(/_/g, ' '),
      cols.map((c) => c.replace(/_/g, ' ')),
      rows.map((row) => cols.map((c) => String(row[c] ?? ''))),
    )
  }
  for (const [key, val] of Object.entries(data)) {
    if (GENERIC_EXPORT_SKIP_KEYS.has(key) || val == null || Array.isArray(val)) continue
    if (typeof val !== 'object') continue
    const obj = val as Record<string, unknown>
    const accounts = obj.accounts
    if (Array.isArray(accounts) && accounts.length > 0 && typeof accounts[0] === 'object') {
      const rows = accounts as Record<string, unknown>[]
      const cols = scalarColumns(rows[0])
      if (cols.length >= 1) {
        html += htmlTable(
          key.replace(/_/g, ' '),
          cols.map((c) => `${c.replace(/_/g, ' ')} (right)`),
          rows.map((row) => cols.map((c) => fmtMoney(row[c]))),
        )
        if (obj.total != null) {
          html += `<p><strong>Total:</strong> ${fmtMoney(obj.total)}</p>`
        }
      }
    }
  }
  return html.trim() ? html : null
}

/** CSV export for aquaculture management P&L panel (ponds tab + optional fuel site tab). */
function matrixAmountForPond(
  group: Record<string, unknown> | undefined,
  code: string,
): string {
  const cats = group?.categories as { category?: string; amount?: string }[] | undefined
  const hit = cats?.find((c) => c.category === code)
  return String(hit?.amount ?? '0')
}

function appendIncomeExpenseMatrixCsv(
  out: string,
  payload: {
    incomeByPond?: Record<string, unknown>[]
    incomeByCategory?: Record<string, unknown>[]
    expensesByPond?: Record<string, unknown>[]
    expensesByCategory?: Record<string, unknown>[]
    incomeColumns?: { code: string; label: string }[]
    expenseColumns?: { code: string; label: string }[]
    ponds?: Record<string, unknown>[]
    totals?: Record<string, unknown>
  },
): string {
  const incomeCols = payload.incomeColumns ?? []
  const expenseCols = payload.expenseColumns ?? []
  if (!incomeCols.length && !expenseCols.length) return out
  const incomeByPond = payload.incomeByPond ?? []
  const expensesByPond = payload.expensesByPond ?? []
  const incomeMap = new Map(incomeByPond.map((g) => [Number(g.pond_id), g]))
  const expenseMap = new Map(expensesByPond.map((g) => [Number(g.pond_id), g]))
  const ponds = payload.ponds ?? []
  out += '\nIncome and expense matrix\nPond'
  incomeCols.forEach((c) => {
    out += `,${escapeCsvValue(c.label)}`
  })
  if (incomeCols.length) out += ',Income total'
  expenseCols.forEach((c) => {
    out += `,${escapeCsvValue(c.label)}`
  })
  if (expenseCols.length) out += ',Expense total'
  out += ',Net profit\n'
  ponds.forEach((p) => {
    const pid = Number(p.pond_id)
    const incGroup = incomeMap.get(pid)
    const expGroup = expenseMap.get(pid)
    let incSum = 0
    let expSum = 0
    out += escapeCsvValue(p.pond_name)
    incomeCols.forEach((c) => {
      const amt = matrixAmountForPond(incGroup, c.code)
      incSum += Number(amt) || 0
      out += `,${amt}`
    })
    if (incomeCols.length) out += `,${incSum.toFixed(2)}`
    expenseCols.forEach((c) => {
      const amt = matrixAmountForPond(expGroup, c.code)
      expSum += Number(amt) || 0
      out += `,${amt}`
    })
    if (expenseCols.length) out += `,${expSum.toFixed(2)}`
    out += `,${p.profit ?? (incSum - expSum).toFixed(2)}\n`
  })
  out += 'Grand total'
  let grandInc = 0
  let grandExp = 0
  incomeCols.forEach((c) => {
    const hit = (payload.incomeByCategory ?? []).find((r) => r.category === c.code)
    const amt = Number(hit?.amount ?? 0)
    grandInc += amt
    out += `,${hit?.amount ?? '0'}`
  })
  if (incomeCols.length) out += `,${grandInc.toFixed(2)}`
  expenseCols.forEach((c) => {
    const hit = (payload.expensesByCategory ?? []).find((r) => r.category === c.code)
    const amt = Number(hit?.amount ?? 0)
    grandExp += amt
    out += `,${hit?.amount ?? '0'}`
  })
  if (expenseCols.length) out += `,${grandExp.toFixed(2)}`
  out += `,${payload.totals?.profit ?? (grandInc - grandExp).toFixed(2)}\n`
  return out
}

export function buildAquaculturePlManagementCsv(payload: {
  start: string
  end: string
  plScope: string
  ponds?: Record<string, unknown>[]
  totals?: Record<string, unknown>
  incomeByPond?: Record<string, unknown>[]
  incomeByCategory?: Record<string, unknown>[]
  expensesByPond?: Record<string, unknown>[]
  expensesByCategory?: Record<string, unknown>[]
  incomeColumns?: { code: string; label: string }[]
  expenseColumns?: { code: string; label: string }[]
  fuelIncomeStatement?: Record<string, unknown> | null
}): string {
  let out = `Aquaculture P&L management\nPeriod,${payload.start},${payload.end}\nScope,${payload.plScope}\n\n`
  if (payload.ponds?.length) {
    out += 'Pond,Revenue,Feed consumption,Medicine consumption,Other expenses,Shared exp,Payroll,Total costs,Profit\n'
    payload.ponds.forEach((p) => {
      out += [
        escapeCsvValue(p.pond_name),
        p.revenue ?? '',
        p.feed_consumption_cost ?? '',
        p.medicine_consumption_cost ?? '',
        p.other_operating_expenses ?? '',
        p.shared_operating_expenses ?? '',
        p.payroll_allocated ?? '',
        p.total_costs ?? '',
        p.profit ?? '',
      ].join(',')
      out += '\n'
    })
    const t = payload.totals ?? {}
    out += [
      'Total',
      t.revenue ?? '',
      t.feed_consumption_cost ?? '',
      t.medicine_consumption_cost ?? '',
      t.other_operating_expenses ?? t.operating_expenses ?? '',
      t.shared_operating_expenses ?? '',
      t.payroll_allocated ?? '',
      t.total_costs ?? '',
      t.profit ?? '',
    ].join(',')
    out += '\n'
  }
  out = appendIncomeExpenseMatrixCsv(out, payload)
  if (payload.expensesByCategory?.length) {
    out += '\nExpenses by category\nCategory,Label,Amount\n'
    payload.expensesByCategory.forEach((r) => {
      out += `${escapeCsvValue(r.category)},${escapeCsvValue(r.label)},${r.amount ?? ''}\n`
    })
  }
  const fuel = payload.fuelIncomeStatement
  if (fuel) {
    out += '\nFuel & shop site P&L\n'
    out += `Gross profit,${fuel.gross_profit ?? ''}\nNet income,${fuel.net_income ?? ''}\n`
    for (const section of ['income', 'cost_of_goods_sold', 'expenses']) {
      const block = fuel[section] as { accounts?: Record<string, unknown>[]; total?: unknown } | undefined
      if (!block?.accounts?.length) continue
      out += `\n${section}\nCode,Account,Balance\n`
      block.accounts.forEach((a) => {
        out += `${escapeCsvValue(a.account_code)},${escapeCsvValue(a.account_name)},${a.balance ?? ''}\n`
      })
      out += `Total,,${block.total ?? ''}\n`
    }
  }
  return out
}

/** Print HTML for aquaculture management P&L panel. */
export function buildAquaculturePlManagementPrintHtml(payload: {
  plScope: string
  start: string
  end: string
  ponds?: Record<string, unknown>[]
  totals?: Record<string, unknown>
  incomeByPond?: Record<string, unknown>[]
  incomeByCategory?: Record<string, unknown>[]
  expensesByPond?: Record<string, unknown>[]
  expensesByCategory?: Record<string, unknown>[]
  incomeColumns?: { code: string; label: string }[]
  expenseColumns?: { code: string; label: string }[]
  fuelIncomeStatement?: Record<string, unknown> | null
}): string {
  let html = `<p><strong>Scope:</strong> ${escapeHtml(payload.plScope)}</p>`
  html += `<p><strong>Period:</strong> ${escapeHtml(payload.start)} to ${escapeHtml(payload.end)}</p>`
  if (payload.ponds?.length) {
    html += htmlTable(
      'Pond P&L',
      [
        'Pond',
        'Revenue (right)',
        'Feed (right)',
        'Medicine (right)',
        'Other exp (right)',
        'Shared exp (right)',
        'Payroll (right)',
        'Total costs (right)',
        'Profit (right)',
      ],
      payload.ponds.map((p) => [
        String(p.pond_name ?? ''),
        fmtMoney(p.revenue),
        fmtMoney(p.feed_consumption_cost),
        fmtMoney(p.medicine_consumption_cost),
        fmtMoney(p.other_operating_expenses),
        fmtMoney(p.shared_operating_expenses),
        fmtMoney(p.payroll_allocated),
        fmtMoney(p.total_costs),
        fmtMoney(p.profit),
      ]),
    )
  }
  const incomeCols = payload.incomeColumns ?? []
  const expenseCols = payload.expenseColumns ?? []
  if ((incomeCols.length || expenseCols.length) && payload.ponds?.length) {
    const headers = [
      'Pond',
      ...incomeCols.map((c) => `${c.label} (right)`),
      ...(incomeCols.length ? ['Income total (right)'] : []),
      ...expenseCols.map((c) => `${c.label} (right)`),
      ...(expenseCols.length ? ['Expense total (right)'] : []),
      'Net profit (right)',
    ]
    const incomeMap = new Map((payload.incomeByPond ?? []).map((g) => [Number(g.pond_id), g]))
    const expenseMap = new Map((payload.expensesByPond ?? []).map((g) => [Number(g.pond_id), g]))
    const rows = (payload.ponds ?? []).map((p) => {
      const pid = Number(p.pond_id)
      const incGroup = incomeMap.get(pid)
      const expGroup = expenseMap.get(pid)
      let incSum = 0
      let expSum = 0
      const row: string[] = [String(p.pond_name ?? '')]
      incomeCols.forEach((c) => {
        const amt = matrixAmountForPond(incGroup, c.code)
        incSum += Number(amt) || 0
        row.push(fmtMoney(amt))
      })
      if (incomeCols.length) row.push(fmtMoney(incSum))
      expenseCols.forEach((c) => {
        const amt = matrixAmountForPond(expGroup, c.code)
        expSum += Number(amt) || 0
        row.push(fmtMoney(amt))
      })
      if (expenseCols.length) row.push(fmtMoney(expSum))
      row.push(fmtMoney(p.profit ?? incSum - expSum))
      return row
    })
    html += htmlTable('Income and expense matrix', headers, rows)
  }
  if (payload.expensesByCategory?.length) {
    html += htmlTable(
      'Expenses by category',
      ['Category', 'Label', 'Amount (right)'],
      payload.expensesByCategory.map((r) => [
        String(r.category ?? ''),
        String(r.label ?? ''),
        fmtMoney(r.amount),
      ]),
    )
  }
  const fuel = payload.fuelIncomeStatement
  if (fuel) {
    html += `<h2>Fuel &amp; shop site P&amp;L</h2>`
    html += `<p><strong>Gross profit:</strong> ${fmtMoney(fuel.gross_profit)}</p>`
    html += `<p><strong>Net income:</strong> ${fmtMoney(fuel.net_income)}</p>`
    for (const section of ['income', 'cost_of_goods_sold', 'expenses'] as const) {
      const block = fuel[section] as { accounts?: Record<string, unknown>[]; total?: unknown } | undefined
      if (!block?.accounts?.length) continue
      html += htmlTable(
        section.replace(/_/g, ' '),
        ['Code', 'Account', 'Balance (right)'],
        block.accounts.map((a) => [
          String(a.account_code ?? ''),
          String(a.account_name ?? ''),
          fmtMoney(a.balance),
        ]),
      )
      html += `<p><strong>Total:</strong> ${fmtMoney(block.total)}</p>`
    }
  }
  return html
}

function fmtMoney(n: unknown): string {
  const v = Number(n ?? 0)
  return Number.isFinite(v) ? v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'
}

function htmlTable(title: string, headers: string[], rows: string[][]): string {
  if (!rows.length) return ''
  let h = `<h2>${title}</h2><table><thead><tr>`
  headers.forEach((hd) => {
    h += `<th${hd.includes('right') ? ' style="text-align:right"' : ''}>${hd.replace(' (right)', '')}</th>`
  })
  h += '</tr></thead><tbody>'
  rows.forEach((cells) => {
    h += '<tr>'
    cells.forEach((c, i) => {
      const right = headers[i]?.includes('(right)')
      h += `<td${right ? ' style="text-align:right"' : ''}>${c}</td>`
    })
    h += '</tr>'
  })
  h += '</tbody></table>'
  return h
}

/** Print HTML fragment for extra-financial reports. */
export function buildExtraFinancialPrintHtml(
  reportId: string,
  data: Record<string, unknown>,
): string | null {
  if (reportId === 'ar-aging' || reportId === 'ap-aging') {
    const isAr = reportId === 'ar-aging'
    const list = ((isAr ? data.customers : data.vendors) as Record<string, unknown>[]) ?? []
    const totals = (data.totals as Record<string, number>) ?? {}
    const headers = [
      isAr ? 'Customer' : 'Vendor',
      ...AGING_BUCKETS.map((b) => `${b.label} (right)`),
      'Total (right)',
    ]
    const rows = list.map((p) => [
      String(p.display_name ?? ''),
      ...AGING_BUCKETS.map((b) => fmtMoney(p[b.key])),
      fmtMoney(p.total),
    ])
    rows.push(['Totals', ...AGING_BUCKETS.map((b) => fmtMoney(totals[b.key])), fmtMoney(totals.total)])
    return htmlTable(`${isAr ? 'AR' : 'AP'} Aging`, headers, rows)
  }

  if (reportId === 'expense-detail') {
    const accounts =
      ((data.expenses as { accounts?: Record<string, unknown>[] })?.accounts as Record<string, unknown>[]) ?? []
    return htmlTable(
      'Operating expenses',
      ['Code', 'Account', 'Balance (right)'],
      accounts.map((a) => [String(a.account_code ?? ''), String(a.account_name ?? ''), fmtMoney(a.balance)]),
    )
  }

  if (reportId === 'income-detail') {
    const accounts =
      ((data.income as { accounts?: Record<string, unknown>[] })?.accounts as Record<string, unknown>[]) ?? []
    return htmlTable(
      'Income',
      ['Code', 'Account', 'Balance (right)'],
      accounts.map((a) => [String(a.account_code ?? ''), String(a.account_name ?? ''), fmtMoney(a.balance)]),
    )
  }

  if (reportId === 'stations-financial-summary' || reportId === 'ponds-pl-summary') {
    const isPond = reportId === 'ponds-pl-summary'
    const rows = ((isPond ? data.ponds : data.stations) as Record<string, unknown>[] | undefined ?? []).map(
      (r) => [
        String(isPond ? r.pond_name : r.station_name ?? ''),
        fmtMoney(r.income),
        fmtMoney(r.cost_of_goods_sold),
        fmtMoney(r.expenses),
        fmtMoney(r.gross_profit),
        fmtMoney(r.net_income),
      ],
    )
    return htmlTable(
      isPond ? 'Pond P&L' : 'Station P&L',
      [
        isPond ? 'Pond' : 'Station',
        'Income (right)',
        'COGS (right)',
        'Expenses (right)',
        'Gross (right)',
        'Net (right)',
      ],
      rows,
    )
  }

  const entityIds = [
    'entities-pl-summary',
    'entities-balance-sheet-summary',
    'entities-trial-balance-summary',
    'entities-financial-summary',
  ]
  if (entityIds.includes(reportId)) {
    let html = ''
    const sections = {
      byStation: (data.by_station as Record<string, unknown>[]) ?? [],
      byPond: (data.by_pond as Record<string, unknown>[]) ?? [],
    }
    const appendPl = (title: string, rows: Record<string, unknown>[]) => {
      html += htmlTable(
        title,
        ['Entity', 'Income (right)', 'COGS (right)', 'Expenses (right)', 'Gross (right)', 'Net (right)'],
        rows.map((r) => [
          String(r.entity_name ?? ''),
          fmtMoney(r.income),
          fmtMoney(r.cost_of_goods_sold),
          fmtMoney(r.expenses),
          fmtMoney(r.gross_profit),
          fmtMoney(r.net_income),
        ]),
      )
    }
    const needsPl = reportId === 'entities-pl-summary' || reportId === 'entities-financial-summary'
    const needsBs =
      reportId === 'entities-balance-sheet-summary' || reportId === 'entities-financial-summary'
    if (needsPl) {
      appendPl('P&L — stations', sections.byStation)
      if (sections.byPond.length) appendPl('P&L — ponds', sections.byPond)
    }
    if (needsBs) {
      const appendBs = (title: string, rows: Record<string, unknown>[]) =>
        htmlTable(
          title,
          ['Entity', 'Assets (right)', 'Liabilities (right)', 'Equity (right)', 'L+E (right)'],
          rows.map((r) => [
            String(r.entity_name ?? ''),
            fmtMoney(r.total_assets),
            fmtMoney(r.total_liabilities),
            fmtMoney(r.total_equity),
            fmtMoney(r.total_liabilities_and_equity),
          ]),
        )
      html += appendBs('Balance sheet — stations', sections.byStation)
      if (sections.byPond.length) html += appendBs('Balance sheet — ponds', sections.byPond)
    }
    return html || null
  }

  if (reportId === 'cash-flow') {
    const op = (data.operating as Record<string, number>) ?? {}
    const cash = (data.cash_summary as Record<string, number>) ?? {}
    return `<div class="summary"><p><strong>Net income:</strong> ${fmtMoney(op.net_income)}</p>
      <p><strong>Customer receipts:</strong> ${fmtMoney(op.customer_payments_received)}</p>
      <p><strong>Vendor payments:</strong> ${fmtMoney(op.vendor_payments_made)}</p>
      <p><strong>Beginning cash:</strong> ${fmtMoney(cash.beginning_cash)}</p>
      <p><strong>Net change:</strong> ${fmtMoney(cash.net_change_in_cash)}</p>
      <p><strong>Ending cash:</strong> ${fmtMoney(cash.ending_cash)}</p></div>`
  }

  return null
}
