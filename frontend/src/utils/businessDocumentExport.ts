/**
 * Print and download helpers for invoices, bills, and payments (money receipts / vouchers).
 */
import { escapeHtml, printDocument } from '@/utils/printDocument'
import { escapeCsvValue } from '@/utils/reportExportHelpers'
import type { PrintBranding } from '@/utils/printBranding'
import { formatNumber } from '@/utils/currency'
import { buildListTotalsFooter, buildListTruncatedNotice } from '@/utils/listExportHelpers'

export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  if (typeof window === 'undefined') return
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function downloadJsonFile(filename: string, data: unknown): void {
  downloadTextFile(filename, JSON.stringify(data, null, 2), 'application/json')
}

export function downloadCsvFile(filename: string, csv: string): void {
  downloadTextFile(filename, csv, 'text/csv;charset=utf-8')
}

export async function printHtmlDocument(
  title: string,
  bodyHtml: string,
  branding?: PrintBranding | null,
): Promise<boolean> {
  return printDocument({ title, bodyHtml, branding: branding ?? undefined })
}

function fmtAmt(n: unknown, sym: string): string {
  const v = Number(n ?? 0)
  const s = Number.isFinite(v)
    ? v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '0.00'
  return `${sym}${s}`
}

// --- Invoices ---

export type InvoiceLineExport = {
  item_id?: number
  item_name?: string
  description?: string
  quantity?: number | string
  unit_price?: number | string
  amount?: number | string
}

export type InvoiceExport = {
  id?: number
  invoice_number?: string
  pos_receipt_number?: string | null
  source?: string
  invoice_date?: string
  due_date?: string | null
  status?: string
  customer_name?: string
  customer_id?: number
  subtotal?: number | string
  tax_amount?: number | string
  discount_amount?: number | string
  total_amount?: number | string
  amount_paid?: number | string
  balance_due?: number | string
  line_items?: InvoiceLineExport[]
  memo?: string
}

export function invoiceDisplayNumber(inv: InvoiceExport): string {
  const pos = (inv.pos_receipt_number || '').trim()
  if (pos) return pos
  return String(inv.invoice_number || inv.id || '—')
}

export function buildInvoiceListCsv(
  rows: InvoiceExport[],
  opts: { formatDate: (iso: string) => string; resolveCustomer: (inv: InvoiceExport) => string },
): string {
  let out = 'Invoice #,Source,Date,Due,Customer,Total,Status\n'
  rows.forEach((inv) => {
    out += [
      escapeCsvValue(invoiceDisplayNumber(inv)),
      escapeCsvValue(inv.source || ''),
      escapeCsvValue(opts.formatDate(inv.invoice_date || '')),
      escapeCsvValue(inv.due_date ? opts.formatDate(inv.due_date) : ''),
      escapeCsvValue(opts.resolveCustomer(inv)),
      inv.total_amount ?? 0,
      escapeCsvValue(inv.status || ''),
    ].join(',')
    out += '\n'
  })
  return out
}

export function buildInvoiceDetailCsv(inv: InvoiceExport, sym: string): string {
  let out = `Invoice,${escapeCsvValue(invoiceDisplayNumber(inv))}\n`
  out += `Date,${escapeCsvValue(inv.invoice_date || '')}\n`
  out += `Status,${escapeCsvValue(inv.status || '')}\n`
  out += `Customer,${escapeCsvValue(inv.customer_name || '')}\n\n`
  out += 'Item,Description,Qty,Unit price,Amount\n'
  ;(inv.line_items || []).forEach((line) => {
    out += [
      escapeCsvValue(line.item_name || ''),
      escapeCsvValue(line.description || ''),
      line.quantity ?? '',
      line.unit_price ?? '',
      line.amount ?? '',
    ].join(',')
    out += '\n'
  })
  out += `\nSubtotal,,,,${inv.subtotal ?? 0}\n`
  out += `Tax,,,,${inv.tax_amount ?? 0}\n`
  out += `Total,,,,${inv.total_amount ?? 0}\n`
  if (inv.amount_paid != null && Number(inv.amount_paid) > 0) {
    out += `Paid,,,,${inv.amount_paid}\n`
    out += `Balance due,,,,${inv.balance_due ?? 0}\n`
  }
  return out
}

export function buildInvoicePrintHtml(
  inv: InvoiceExport,
  opts: {
    currencySymbol: string
    formatDateOnly: (iso: string) => string
    formatDateTime: (d: Date) => string
    resolveCustomer: (inv: InvoiceExport) => string
    resolveItemLabel: (line: InvoiceLineExport) => string
    formatNumber: (n: number) => string
  },
): string {
  const displayNo = invoiceDisplayNumber(inv)
  const cust = opts.resolveCustomer(inv)
  const lines = inv.line_items || []
  const sym = opts.currencySymbol
  const lineRows = lines
    .map(
      (item) => `<tr>
        <td>${escapeHtml(opts.resolveItemLabel(item))}</td>
        <td>${escapeHtml(item.description || '—')}</td>
        <td class="right">${escapeHtml(opts.formatNumber(Number(item.quantity)))}</td>
        <td class="right">${escapeHtml(sym)}${escapeHtml(opts.formatNumber(Number(item.unit_price || 0)))}</td>
        <td class="right">${escapeHtml(sym)}${escapeHtml(opts.formatNumber(Number(item.amount || 0)))}</td>
      </tr>`,
    )
    .join('')
  const disc =
    inv.discount_amount && Number(inv.discount_amount) > 0
      ? `<tr><td colspan="4" class="right">Discount</td><td class="right">${escapeHtml(sym)}${escapeHtml(
          opts.formatNumber(Number(inv.discount_amount)),
        )}</td></tr>`
      : ''
  const paidBlock =
    inv.amount_paid != null && Number(inv.amount_paid) > 0
      ? `<p><strong>Amount paid:</strong> ${escapeHtml(fmtAmt(inv.amount_paid, sym))} &nbsp;|&nbsp; <strong>Balance due:</strong> ${escapeHtml(
          fmtAmt(inv.balance_due, sym),
        )}</p>`
      : ''
  return `
    <h1>Invoice / receipt</h1>
    <div class="period">
      <strong>Invoice #</strong> ${escapeHtml(displayNo)}<br/>
      <strong>Status:</strong> ${escapeHtml(inv.status || '')} · <strong>Date:</strong> ${escapeHtml(
        opts.formatDateOnly(inv.invoice_date || ''),
      )}${inv.due_date ? ` · <strong>Due:</strong> ${escapeHtml(opts.formatDateOnly(inv.due_date))}` : ''}
      <br/>Printed ${escapeHtml(opts.formatDateTime(new Date()))}
    </div>
    <p><strong>Bill to:</strong> ${escapeHtml(cust)}</p>
    <table>
      <thead><tr><th>Item</th><th>Description</th><th class="right">Qty</th><th class="right">Unit</th><th class="right">Amount</th></tr></thead>
      <tbody>${lineRows || '<tr><td colspan="5" style="text-align:center;color:#6b7280">No line items</td></tr>'}</tbody>
      <tfoot>
        <tr><td colspan="4" class="right">Subtotal</td><td class="right">${escapeHtml(sym)}${escapeHtml(
          opts.formatNumber(Number(inv.subtotal || 0)),
        )}</td></tr>
        <tr><td colspan="4" class="right">Tax</td><td class="right">${escapeHtml(sym)}${escapeHtml(
          opts.formatNumber(Number(inv.tax_amount || 0)),
        )}</td></tr>
        ${disc}
        <tr class="row-total"><td colspan="4" class="right">Total</td><td class="right">${escapeHtml(sym)}${escapeHtml(
          opts.formatNumber(Number(inv.total_amount || 0)),
        )}</td></tr>
      </tfoot>
    </table>
    ${paidBlock}
  `
}

// --- Bills ---

export type BillLineExport = {
  description?: string
  item_id?: number
  item_name?: string
  tank_name?: string | null
  aquaculture_pond_id?: number | null
  pond_name?: string
  quantity?: number | string
  unit_cost?: number | string
  unit_price?: number | string
  amount?: number | string
}

export type BillExport = {
  id?: number
  bill_number?: string
  vendor_name?: string
  vendor_reference?: string
  receipt_station_name?: string | null
  bill_date?: string
  due_date?: string | null
  status?: string
  memo?: string
  subtotal?: number | string
  tax_amount?: number | string
  tax_total?: number | string
  total_amount?: number | string
  total?: number | string
  amount_paid?: number | string
  balance_due?: number | string
  lines?: BillLineExport[]
}

export function buildBillListCsv(
  rows: BillExport[],
  opts: { formatDate: (iso: string) => string; totalOf: (b: BillExport) => number; balanceOf: (b: BillExport) => number },
): string {
  let out = 'Bill #,Vendor,Bill date,Due date,Total,Balance,Status\n'
  rows.forEach((b) => {
    out += [
      escapeCsvValue(b.bill_number || ''),
      escapeCsvValue(b.vendor_name || ''),
      escapeCsvValue(opts.formatDate(b.bill_date || '')),
      escapeCsvValue(b.due_date ? opts.formatDate(b.due_date) : ''),
      opts.totalOf(b),
      opts.balanceOf(b),
      escapeCsvValue(b.status || ''),
    ].join(',')
    out += '\n'
  })
  return out
}

export function buildBillDetailCsv(bill: BillExport): string {
  let out = `Bill,${escapeCsvValue(bill.bill_number || '')}\n`
  out += `Vendor,${escapeCsvValue(bill.vendor_name || '')}\n`
  out += `Date,${escapeCsvValue(bill.bill_date || '')}\n`
  out += `Status,${escapeCsvValue(bill.status || '')}\n\n`
  out += 'Description,Item,Tank,Pond,Qty,Unit cost,Amount\n'
  ;(bill.lines || []).forEach((line) => {
    out += [
      escapeCsvValue(line.description || ''),
      escapeCsvValue(line.item_name || ''),
      escapeCsvValue(line.tank_name || ''),
      escapeCsvValue(line.pond_name || ''),
      line.quantity ?? '',
      line.unit_cost ?? line.unit_price ?? '',
      line.amount ?? '',
    ].join(',')
    out += '\n'
  })
  const total = bill.total_amount ?? bill.total ?? 0
  out += `\nTotal,,,,,,${total}\n`
  if (bill.amount_paid != null) out += `Paid,,,,,,${bill.amount_paid}\n`
  if (bill.balance_due != null) out += `Balance,,,,,,${bill.balance_due}\n`
  return out
}

export function buildBillPrintHtml(
  bill: BillExport,
  opts: {
    currencySymbol: string
    formatDateOnly: (iso: string) => string
    formatDateTime: (d: Date) => string
    formatNumber: (n: number) => string
    resolveItemLabel: (line: BillLineExport) => string
    resolvePondLabel: (line: BillLineExport) => string
    receivingLocation?: string
    totalOf: (b: BillExport) => number
    taxOf: (b: BillExport) => number
    paidOf: (b: BillExport) => number
    balanceOf: (b: BillExport) => number
    subtotalOf: (b: BillExport) => number
  },
): string {
  const sym = opts.currencySymbol
  const lineRows = (bill.lines || [])
    .map(
      (line) => `<tr>
        <td>${escapeHtml(opts.resolveItemLabel(line))}</td>
        <td>${escapeHtml(line.description || '—')}</td>
        <td>${escapeHtml(line.tank_name || '—')}</td>
        <td>${escapeHtml(opts.resolvePondLabel(line))}</td>
        <td class="right">${escapeHtml(opts.formatNumber(Number(line.quantity || 0)))}</td>
        <td class="right">${escapeHtml(sym)}${escapeHtml(
          opts.formatNumber(Number(line.unit_cost ?? line.unit_price ?? 0)),
        )}</td>
        <td class="right">${escapeHtml(sym)}${escapeHtml(opts.formatNumber(Number(line.amount || 0)))}</td>
      </tr>`,
    )
    .join('')
  return `
    <h1>Vendor bill</h1>
    <div class="period">
      <strong>Bill #</strong> ${escapeHtml(bill.bill_number || '')}<br/>
      <strong>Status:</strong> ${escapeHtml(bill.status || '')} · <strong>Date:</strong> ${escapeHtml(
        opts.formatDateOnly(bill.bill_date || ''),
      )}${bill.due_date ? ` · <strong>Due:</strong> ${escapeHtml(opts.formatDateOnly(bill.due_date))}` : ''}
      <br/>Printed ${escapeHtml(opts.formatDateTime(new Date()))}
    </div>
    <p><strong>Vendor:</strong> ${escapeHtml(bill.vendor_name || '—')}</p>
    ${opts.receivingLocation ? `<p><strong>Receiving location:</strong> ${escapeHtml(opts.receivingLocation)}</p>` : ''}
    ${bill.vendor_reference ? `<p><strong>Vendor ref:</strong> ${escapeHtml(bill.vendor_reference)}</p>` : ''}
    ${bill.memo ? `<p><strong>Memo:</strong> ${escapeHtml(bill.memo)}</p>` : ''}
    <table>
      <thead><tr><th>Item</th><th>Description</th><th>Tank</th><th>Pond</th><th class="right">Qty</th><th class="right">Unit</th><th class="right">Amount</th></tr></thead>
      <tbody>${lineRows || '<tr><td colspan="7" style="text-align:center;color:#6b7280">No line items</td></tr>'}</tbody>
      <tfoot>
        <tr><td colspan="6" class="right">Subtotal</td><td class="right">${escapeHtml(sym)}${escapeHtml(
          opts.formatNumber(opts.subtotalOf(bill)),
        )}</td></tr>
        <tr><td colspan="6" class="right">Tax</td><td class="right">${escapeHtml(sym)}${escapeHtml(
          opts.formatNumber(opts.taxOf(bill)),
        )}</td></tr>
        <tr class="row-total"><td colspan="6" class="right">Total</td><td class="right">${escapeHtml(sym)}${escapeHtml(
          opts.formatNumber(opts.totalOf(bill)),
        )}</td></tr>
        <tr><td colspan="6" class="right">Paid</td><td class="right">${escapeHtml(sym)}${escapeHtml(
          opts.formatNumber(opts.paidOf(bill)),
        )}</td></tr>
        <tr><td colspan="6" class="right">Balance due</td><td class="right">${escapeHtml(sym)}${escapeHtml(
          opts.formatNumber(opts.balanceOf(bill)),
        )}</td></tr>
      </tfoot>
    </table>
  `
}

// --- Payments ---

export type PaymentAllocationExport = {
  invoice_id?: number | null
  bill_id?: number | null
  invoice_number?: string
  bill_number?: string
  amount?: number | string
  allocated_amount?: number | string
}

export type PaymentExport = {
  id?: number
  payment_number?: string
  payment_type?: string
  payment_date?: string
  payment_method?: string
  amount?: number | string
  reference_number?: string | null
  reference?: string | null
  memo?: string | null
  customer_id?: number | null
  vendor_id?: number | null
  customer_name?: string | null
  vendor_name?: string | null
  bank_account_name?: string | null
  allocations?: PaymentAllocationExport[]
}

export function paymentDisplayNumber(p: PaymentExport): string {
  return String(p.payment_number || (p.id ? `PAY-${p.id}` : '—'))
}

export function buildPaymentListCsv(
  rows: PaymentExport[],
  opts: {
    formatDate: (iso: string) => string
    partyLabel: (p: PaymentExport) => string
    typeLabel: string
  },
): string {
  let out = 'Payment #,Date,Party,Method,Amount,Type\n'
  rows.forEach((p) => {
    out += [
      escapeCsvValue(paymentDisplayNumber(p)),
      escapeCsvValue(opts.formatDate(p.payment_date || '')),
      escapeCsvValue(opts.partyLabel(p)),
      escapeCsvValue((p.payment_method || '').replace(/_/g, ' ')),
      p.amount ?? 0,
      escapeCsvValue(opts.typeLabel),
    ].join(',')
    out += '\n'
  })
  return out
}

export function buildPaymentDetailCsv(p: PaymentExport): string {
  const isReceived = (p.payment_type || '').toLowerCase() === 'received'
  let out = `Payment,${escapeCsvValue(paymentDisplayNumber(p))}\n`
  out += `Type,${escapeCsvValue(isReceived ? 'Money receipt' : 'Payment voucher')}\n`
  out += `Date,${escapeCsvValue(p.payment_date || '')}\n`
  out += `Method,${escapeCsvValue(p.payment_method || '')}\n`
  out += `${isReceived ? 'Customer' : 'Vendor'},${escapeCsvValue(
    isReceived ? p.customer_name || '' : p.vendor_name || '',
  )}\n`
  out += `Amount,${p.amount ?? 0}\n`
  if (p.reference_number || p.reference) out += `Reference,${escapeCsvValue(String(p.reference_number ?? p.reference))}\n`
  if (p.bank_account_name) out += `Bank register,${escapeCsvValue(p.bank_account_name)}\n`
  if (p.memo) out += `Memo,${escapeCsvValue(p.memo)}\n`
  const allocs = p.allocations || []
  if (allocs.length) {
    out += `\n${isReceived ? 'Invoice' : 'Bill'},Reference,Amount\n`
    allocs.forEach((a) => {
      const ref = isReceived
        ? a.invoice_number || (a.invoice_id ? `INV-${a.invoice_id}` : 'On account')
        : a.bill_number || (a.bill_id ? `BILL-${a.bill_id}` : 'On account')
      out += [
        isReceived ? 'Invoice' : 'Bill',
        escapeCsvValue(ref),
        a.amount ?? a.allocated_amount ?? 0,
      ].join(',')
      out += '\n'
    })
  }
  return out
}

export function buildPaymentPrintHtml(
  p: PaymentExport,
  opts: {
    currencySymbol: string
    formatDateOnly: (iso: string) => string
    formatDateTime: (d: Date) => string
    formatNumber: (n: number) => string
    resolveAllocRows?: Array<{ label: string; reference: string; amount: number }>
  },
): string {
  const isReceived = (p.payment_type || '').toLowerCase() === 'received'
  const title = isReceived ? 'Money receipt' : 'Payment voucher'
  const partyLabel = isReceived ? 'Received from' : 'Paid to'
  const party = isReceived ? p.customer_name || '—' : p.vendor_name || '—'
  const sym = opts.currencySymbol
  const allocRows = (opts.resolveAllocRows || [])
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.label)}</td>
        <td>${escapeHtml(row.reference)}</td>
        <td class="right">${escapeHtml(sym)}${escapeHtml(opts.formatNumber(row.amount))}</td>
      </tr>`,
    )
    .join('')
  const allocTable = allocRows
    ? `<h2>Applied to</h2><table><thead><tr><th>Type</th><th>Reference</th><th class="right">Amount</th></tr></thead><tbody>${allocRows}</tbody></table>`
    : ''
  return `
    <h1>${title}</h1>
    <div class="period">
      <strong>Payment #</strong> ${escapeHtml(paymentDisplayNumber(p))}<br/>
      <strong>Date:</strong> ${escapeHtml(opts.formatDateOnly(p.payment_date || ''))} · <strong>Method:</strong> ${escapeHtml(
        (p.payment_method || 'unspecified').replace(/_/g, ' '),
      )}
      <br/>Printed ${escapeHtml(opts.formatDateTime(new Date()))}
    </div>
    <p><strong>${partyLabel}:</strong> ${escapeHtml(party)}</p>
    ${p.bank_account_name ? `<p><strong>Bank register:</strong> ${escapeHtml(p.bank_account_name)}</p>` : ''}
    ${p.reference_number || p.reference ? `<p><strong>Reference:</strong> ${escapeHtml(String(p.reference_number ?? p.reference))}</p>` : ''}
    ${p.memo ? `<p><strong>Memo:</strong> ${escapeHtml(p.memo)}</p>` : ''}
    <div class="summary"><p><strong>Amount:</strong> ${escapeHtml(fmtAmt(p.amount, sym))}</p></div>
    ${allocTable}
  `
}

// --- Journal entries ---

export type JournalEntryLineExport = {
  line_number?: number
  description?: string
  debit_account_id?: number | null
  credit_account_id?: number | null
  debit_account_code?: string
  debit_account_name?: string
  credit_account_code?: string
  credit_account_name?: string
  amount?: number | string
  station_name?: string
  pond_name?: string
}

export type JournalEntryExport = {
  id?: number
  entry_number?: string
  entry_date?: string
  reference?: string
  description?: string
  station_name?: string
  is_posted?: boolean
  total_debit?: number | string
  total_credit?: number | string
  lines?: JournalEntryLineExport[]
}

export function buildJournalEntryListCsv(
  rows: JournalEntryExport[],
  opts: { formatDate: (iso: string) => string },
): string {
  let out = 'Entry #,Date,Reference,Description,Site,Status,Total debit,Total credit\n'
  rows.forEach((e) => {
    out += [
      escapeCsvValue(e.entry_number || ''),
      escapeCsvValue(opts.formatDate(e.entry_date || '')),
      escapeCsvValue(e.reference || ''),
      escapeCsvValue(e.description || ''),
      escapeCsvValue(e.station_name || ''),
      escapeCsvValue(e.is_posted ? 'Posted' : 'Draft'),
      e.total_debit ?? 0,
      e.total_credit ?? 0,
    ].join(',')
    out += '\n'
  })
  return out
}

export function buildJournalEntryDetailCsv(entry: JournalEntryExport): string {
  let out = `Entry,${escapeCsvValue(entry.entry_number || '')}\n`
  out += `Date,${escapeCsvValue(entry.entry_date || '')}\n`
  out += `Reference,${escapeCsvValue(entry.reference || '')}\n`
  out += `Description,${escapeCsvValue(entry.description || '')}\n`
  out += `Site,${escapeCsvValue(entry.station_name || '')}\n`
  out += `Status,${escapeCsvValue(entry.is_posted ? 'Posted' : 'Draft')}\n\n`
  out += 'Line,Account,Description,Site,Pond,Debit,Credit\n'
  ;(entry.lines || []).forEach((line) => {
    const account = line.debit_account_id
      ? `${line.debit_account_code || ''} - ${line.debit_account_name || ''}`.trim()
      : line.credit_account_id
        ? `${line.credit_account_code || ''} - ${line.credit_account_name || ''}`.trim()
        : ''
    const debit = line.debit_account_id ? line.amount ?? 0 : ''
    const credit = line.credit_account_id ? line.amount ?? 0 : ''
    out += [
      line.line_number ?? '',
      escapeCsvValue(account),
      escapeCsvValue(line.description || ''),
      escapeCsvValue(line.station_name || ''),
      escapeCsvValue(line.pond_name || ''),
      debit,
      credit,
    ].join(',')
    out += '\n'
  })
  out += `\nTotal,,,,,${entry.total_debit ?? 0},${entry.total_credit ?? 0}\n`
  return out
}

export function buildJournalEntryPrintHtml(
  entry: JournalEntryExport,
  opts: {
    currencySymbol: string
    formatDateOnly: (iso: string) => string
    formatDateTime: (d: Date) => string
    formatNumber: (n: number) => string
  },
): string {
  const sym = opts.currencySymbol
  const lineRows = (entry.lines || [])
    .map((line) => {
      const account = line.debit_account_id
        ? `${line.debit_account_code || ''} - ${line.debit_account_name || ''}`.trim()
        : line.credit_account_id
          ? `${line.credit_account_code || ''} - ${line.credit_account_name || ''}`.trim()
          : '—'
      const debit = line.debit_account_id
        ? `${sym}${opts.formatNumber(Number(line.amount || 0))}`
        : '—'
      const credit = line.credit_account_id
        ? `${sym}${opts.formatNumber(Number(line.amount || 0))}`
        : '—'
      return `<tr>
        <td>${line.line_number ?? ''}</td>
        <td>${escapeHtml(account)}</td>
        <td>${escapeHtml(line.description || '—')}</td>
        <td>${escapeHtml(line.station_name?.trim() || '—')}</td>
        <td>${escapeHtml(line.pond_name?.trim() || '—')}</td>
        <td class="right">${escapeHtml(debit)}</td>
        <td class="right">${escapeHtml(credit)}</td>
      </tr>`
    })
    .join('')
  return `
    <h1>Journal entry</h1>
    <div class="period">
      <strong>Entry #</strong> ${escapeHtml(entry.entry_number || '')}<br/>
      <strong>Date:</strong> ${escapeHtml(opts.formatDateOnly(entry.entry_date || ''))} ·
      <strong>Status:</strong> ${escapeHtml(entry.is_posted ? 'Posted' : 'Draft')}
      ${entry.station_name?.trim() ? ` · <strong>Site:</strong> ${escapeHtml(entry.station_name)}` : ''}
      <br/>Printed ${escapeHtml(opts.formatDateTime(new Date()))}
    </div>
    ${entry.reference ? `<p><strong>Reference:</strong> ${escapeHtml(entry.reference)}</p>` : ''}
    ${entry.description ? `<p><strong>Description:</strong> ${escapeHtml(entry.description)}</p>` : ''}
    <table>
      <thead><tr><th>Line</th><th>Account</th><th>Description</th><th>Site</th><th>Pond</th><th class="right">Debit</th><th class="right">Credit</th></tr></thead>
      <tbody>${lineRows || '<tr><td colspan="7" style="text-align:center;color:#6b7280">No lines</td></tr>'}</tbody>
      <tfoot>
        <tr class="row-total">
          <td colspan="5" class="right">Total</td>
          <td class="right">${escapeHtml(sym)}${escapeHtml(opts.formatNumber(Number(entry.total_debit || 0)))}</td>
          <td class="right">${escapeHtml(sym)}${escapeHtml(opts.formatNumber(Number(entry.total_credit || 0)))}</td>
        </tr>
      </tfoot>
    </table>
  `
}

// --- Customers & vendors (contact lists) ---

export type CustomerContactExport = {
  customer_number?: string
  display_name?: string | null
  default_station_name?: string | null
  email?: string | null
  phone?: string | null
  current_balance?: number | string
  is_active?: boolean
}

export type VendorContactExport = {
  vendor_number?: string
  company_name?: string
  display_name?: string
  usual_location?: string
  email?: string
  phone?: string
  current_balance?: number | string
  is_active?: boolean
}

export function buildCustomerListCsv(rows: CustomerContactExport[]): string {
  let out = 'Customer #,Name,Default site,Email,Phone,Balance,Status\n'
  let total = 0
  rows.forEach((c) => {
    const bal = Number(c.current_balance ?? 0) || 0
    total += bal
    out += [
      escapeCsvValue(c.customer_number),
      escapeCsvValue(c.display_name),
      escapeCsvValue(c.default_station_name),
      escapeCsvValue(c.email),
      escapeCsvValue(c.phone),
      bal,
      escapeCsvValue(c.is_active ? 'Active' : 'Inactive'),
    ].join(',')
    out += '\n'
  })
  out += `Total (${rows.length} customers),,,,,${total},\n`
  return out
}

export function buildVendorListCsv(rows: VendorContactExport[]): string {
  let out = 'Vendor #,Company,Display name,Usual location,Email,Phone,Balance,Status\n'
  let total = 0
  rows.forEach((v) => {
    const bal = Number(v.current_balance ?? 0) || 0
    total += bal
    out += [
      escapeCsvValue(v.vendor_number),
      escapeCsvValue(v.company_name),
      escapeCsvValue(v.display_name),
      escapeCsvValue(v.usual_location),
      escapeCsvValue(v.email),
      escapeCsvValue(v.phone),
      bal,
      escapeCsvValue(v.is_active ? 'Active' : 'Inactive'),
    ].join(',')
    out += '\n'
  })
  out += `Total (${rows.length} vendors),,,,,,${total},\n`
  return out
}

// --- Products / items catalog ---

export type ItemListExportOptions = {
  includeQty: boolean
  includeCost: boolean
  includePrice: boolean
  includeSuppliers: boolean
}

export type ItemProductExport = {
  item_number?: string
  name?: string
  category?: string
  item_type?: string
  pos_category?: string
  unit?: string
  is_active?: boolean
  quantity_on_hand?: number | string
  cost?: number | string
  unit_price?: number | string
  suppliers?: string
}

function parseItemQty(v: number | string | undefined): number {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  return parseFloat(String(v).replace(/,/g, '')) || 0
}

function itemListTotals(rows: ItemProductExport[]) {
  let totalQty = 0
  let totalCost = 0
  let totalPrice = 0
  for (const row of rows) {
    const qty = parseItemQty(row.quantity_on_hand)
    const cost = Number(row.cost) || 0
    const price = Number(row.unit_price) || 0
    totalQty += qty
    totalCost += qty * cost
    totalPrice += qty * price
  }
  return { count: rows.length, totalQty, totalCost, totalPrice }
}

function itemListHeaders(opts: ItemListExportOptions, currencySymbol: string): string[] {
  const headers = ['SKU', 'Name', 'Category', 'Type', 'Unit', 'Status']
  if (opts.includeQty) headers.push('Qty on hand')
  if (opts.includeCost) headers.push(`Unit cost (${currencySymbol})`)
  if (opts.includePrice) headers.push(`Unit price (${currencySymbol})`)
  if (opts.includeSuppliers) headers.push('Suppliers (from bills)')
  return headers
}

function itemListCells(row: ItemProductExport, opts: ItemListExportOptions): string[] {
  const cells = [
    row.item_number || '',
    row.name || '',
    row.category || 'General',
    (row.item_type || '').replace(/_/g, ' '),
    row.unit || '',
    row.is_active === false ? 'Inactive' : 'Active',
  ]
  if (opts.includeQty) cells.push(String(row.quantity_on_hand ?? 0))
  if (opts.includeCost) cells.push(String(row.cost ?? 0))
  if (opts.includePrice) cells.push(String(row.unit_price ?? 0))
  if (opts.includeSuppliers) cells.push(row.suppliers || '—')
  return cells
}

export function buildItemListCsv(
  rows: ItemProductExport[],
  opts: ItemListExportOptions,
  currencySymbol: string,
): string {
  const headers = itemListHeaders(opts, currencySymbol)
  let out = `${headers.map((h) => escapeCsvValue(h)).join(',')}\n`
  rows.forEach((row) => {
    out += itemListCells(row, opts).map((c) => escapeCsvValue(c)).join(',')
    out += '\n'
  })
  if (rows.length > 0) {
    const { count, totalQty, totalCost, totalPrice } = itemListTotals(rows)
    const footer = [
      'Total',
      `(${count} products)`,
      '',
      '',
      '',
      '',
    ]
    if (opts.includeQty) footer.push(String(totalQty))
    if (opts.includeCost) footer.push(String(totalCost))
    if (opts.includePrice) footer.push(String(totalPrice))
    if (opts.includeSuppliers) footer.push('')
    out += `${footer.map((c) => escapeCsvValue(c)).join(',')}\n`
  }
  return out
}

export function buildItemListPrintHtml(
  rows: ItemProductExport[],
  opts: ItemListExportOptions,
  currencySymbol: string,
  subtitle: string,
  totalCount?: number,
): string {
  const headers = itemListHeaders(opts, currencySymbol)
  const headHtml = headers
    .map((h) => {
      const right = h.includes('cost') || h.includes('price') || h.includes('Qty')
      return `<th${right ? ' class="right"' : ''}>${escapeHtml(h)}</th>`
    })
    .join('')
  const bodyHtml = rows
    .map((row) => {
      const cells = itemListCells(row, opts)
      return `<tr>${cells
        .map((c, i) => {
          const right =
            headers[i]?.includes('cost') ||
            headers[i]?.includes('price') ||
            headers[i]?.includes('Qty')
          return `<td${right ? ' class="right"' : ''}>${escapeHtml(c)}</td>`
        })
        .join('')}</tr>`
    })
    .join('')
  const { count, totalQty, totalCost, totalPrice } = itemListTotals(rows)
  const truncated = buildListTruncatedNotice(count, totalCount, 'products')
  const footerAmounts = []
  if (opts.includeQty) footerAmounts.push({ value: totalQty })
  if (opts.includeCost) footerAmounts.push({ value: totalCost, currencySymbol })
  if (opts.includePrice) footerAmounts.push({ value: totalPrice, currencySymbol })
  const tfootHtml =
    rows.length > 0
      ? buildListTotalsFooter({
          labelColspan: 6,
          label: `Total (${count} product${count === 1 ? '' : 's'})`,
          amounts: footerAmounts,
          trailingEmptyCols: opts.includeSuppliers ? 1 : 0,
        })
      : ''
  const cols = headers
    .map((h) => {
      if (h.includes('Suppliers')) return 'Suppliers'
      if (h.includes('cost')) return 'Cost'
      if (h.includes('price')) return 'Price'
      if (h.includes('Qty')) return 'Qty'
      return h.split(' ')[0]
    })
    .join(', ')
  return `
    <h1>Product catalog</h1>
    <div class="period">${escapeHtml(subtitle)}</div>
    <p class="muted">Columns: ${escapeHtml(cols)}</p>
    <table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml || '<tr><td colspan="20">No products</td></tr>'}</tbody>${tfootHtml}</table>
    ${
      rows.length > 0
        ? `<div class="summary">
      <p><strong>Total products:</strong> ${count}</p>
      <p><strong>Total inventory cost:</strong> ${escapeHtml(currencySymbol)}${escapeHtml(formatNumber(totalCost))}</p>
      <p><strong>Total value at sale price:</strong> ${escapeHtml(currencySymbol)}${escapeHtml(formatNumber(totalPrice))}</p>
      ${truncated}
    </div>`
        : ''
    }
  `
}
