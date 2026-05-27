/**
 * CSV and print HTML builders for reports that share ExtraFinancialReportPanels shapes.
 */

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
  const byPond = (data.by_pond as Record<string, unknown>[]) ?? []
  const unscoped = data.unscoped as Record<string, unknown> | undefined
  let out = ''
  out += entityRowsCsv(`${kind.toUpperCase()} — stations`, kind, byStation)
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

  if (reportId === 'stations-financial-summary' || reportId === 'ponds-pl-summary') {
    const isPond = reportId === 'ponds-pl-summary'
    const rows = (isPond
      ? (data.ponds as Record<string, unknown>[])
      : (data.stations as Record<string, unknown>[])) ?? []
    const co = (data.company_total as Record<string, number>) ?? {}
    let out = `${isPond ? 'Pond' : 'Station'},Income,COGS,Expenses,Gross profit,Net income\n`
    rows.forEach((r) => {
      out += [
        escapeCsvValue(isPond ? r.pond_name : r.station_name),
        r.income ?? 0,
        r.cost_of_goods_sold ?? 0,
        r.expenses ?? 0,
        r.gross_profit ?? 0,
        r.net_income ?? 0,
      ].join(',')
      out += '\n'
    })
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

/** Best-effort CSV from unknown report payload (arrays of objects). */
export function buildGenericTabularCsv(data: Record<string, unknown>): string | null {
  const skipKeys = new Set(['period', 'summary', 'report_id', 'accounting_note', 'company_total'])
  for (const [key, val] of Object.entries(data)) {
    if (skipKeys.has(key) || !Array.isArray(val) || val.length === 0) continue
    const first = val[0]
    if (!first || typeof first !== 'object' || Array.isArray(first)) continue
    const sample = first as Record<string, unknown>
    const cols = Object.keys(sample).filter((k) => {
      const v = sample[k]
      return v == null || typeof v !== 'string' || v.length < 200
    })
    if (cols.length < 2) continue
    let out = `${key}\n${cols.join(',')}\n`
    ;(val as Record<string, unknown>[]).forEach((row) => {
      out += cols.map((c) => escapeCsvValue(row[c])).join(',')
      out += '\n'
    })
    return out
  }
  return null
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
