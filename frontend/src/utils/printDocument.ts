/**
 * Default printing for FSERP — use from any client screen to open a print-ready page
 * (same typography, tables, and @page margins) and trigger the browser print dialog.
 *
 * @example
 * import { printDocument, escapeHtml } from '@/utils/printDocument'
 * printDocument({
 *   title: 'Invoice',
 *   bodyHtml: `<h1>${escapeHtml(companyName)}</h1><p>…</p>`,
 * })
 */

export const PRINT_DOCUMENT_DELAY_MS = 220

/** Shared print stylesheet: invoices, reports, statements, contracts. */
export const PRINT_APP_STYLES = `
  @page { margin: 12mm; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    margin: 0;
    padding: 16px;
    color: #111827;
    font-size: 13px;
    line-height: 1.45;
  }
  h1 {
    font-size: 1.35rem;
    margin: 0 0 12px;
    padding-bottom: 10px;
    border-bottom: 2px solid #3b82f6;
    color: #111827;
  }
  h2 {
    font-size: 1.1rem;
    margin: 22px 0 12px;
    color: #374151;
  }
  h3 { font-size: 1rem; margin: 16px 0 8px; color: #374151; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0 18px; }
  th, td {
    border: 1px solid #d1d5db;
    padding: 8px 10px;
    text-align: left;
    vertical-align: top;
  }
  th {
    background: #f3f4f6;
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }
  tfoot td { background: #f9fafb; font-weight: 600; }
  .summary {
    background: #f9fafb;
    padding: 15px;
    margin: 15px 0;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
  }
  .period {
    color: #6b7280;
    margin-bottom: 18px;
    padding-bottom: 14px;
    border-bottom: 1px solid #e5e7eb;
    font-size: 12px;
  }
  .muted { color: #6b7280; font-size: 12px; }
  .right, th[style*="text-align:right"], td[style*="text-align:right"] { text-align: right; }
  .row-total { font-weight: 600; background: #fafafa; }
  .co { margin-bottom: 14px; line-height: 1.45; }
  .contract-header { text-align: center; margin-bottom: 24px; }
  .label { font-weight: 700; }
  .no-print { display: none !important; }
  @media print {
    body { padding: 0; }
    .no-print { display: none !important; }
    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
  }
`

export function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** Escape plain text and preserve line breaks (for memos / terms stored as text). */
export function escapeHtmlWithBreaks(text: string): string {
  return escapeHtml(text).replace(/\r\n/g, "\n").split("\n").join("<br/>")
}

function formatPrintAmount(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export type PrintDocumentOptions = {
  /** Window title and HTML document title (escaped automatically). */
  title: string
  /** Inner HTML for <body> — escape dynamic strings with {@link escapeHtml}. */
  bodyHtml: string
  /** Extra tags for <head> (e.g. `<style>…</style>`) after default styles. */
  extraHead?: string
  delayMs?: number
}

function buildPrintDocumentHtml(
  title: string,
  bodyHtml: string,
  extraHead: string
): string {
  const safeTitle = escapeHtml(title)
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${safeTitle}</title><style>${PRINT_APP_STYLES}</style>${extraHead}</head><body>${bodyHtml}</body></html>`
}

/**
 * Fallback: new tab + document.write. Do not use `noopener` — Chromium often leaves
 * `about:blank` with a non-writable document so nothing appears.
 */
function printViaPopup(docHtml: string, delayMs: number): boolean {
  const w = window.open("", "_blank")
  if (!w) return false
  try {
    w.document.open()
    w.document.write(docHtml)
    w.document.close()
    w.focus()
    window.setTimeout(() => {
      try {
        w.print()
      } catch {
        /* ignore */
      }
    }, delayMs)
  } catch {
    try {
      w.close()
    } catch {
      /* ignore */
    }
    return false
  }
  return true
}

/**
 * Prints HTML using a hidden iframe (preferred — avoids blank `about:blank` tabs and
 * popup/document.write quirks). Falls back to a normal popup if iframe setup fails.
 *
 * @returns false only if both paths fail or popup is blocked (fallback).
 */
export function printDocument(options: PrintDocumentOptions): boolean {
  const { title, bodyHtml, extraHead = "", delayMs = PRINT_DOCUMENT_DELAY_MS } = options
  if (typeof window === "undefined" || typeof document === "undefined") return false

  const docHtml = buildPrintDocumentHtml(title, bodyHtml, extraHead)

  try {
    const iframe = document.createElement("iframe")
    iframe.style.cssText =
      "position:fixed;inset:0;width:0;height:0;border:0;opacity:0;pointer-events:none;visibility:hidden"
    iframe.setAttribute("aria-hidden", "true")
    iframe.title = String(title).slice(0, 200)
    document.body.appendChild(iframe)

    const cw = iframe.contentWindow
    if (!cw) {
      iframe.remove()
      return printViaPopup(docHtml, delayMs)
    }

    const cleanup = () => {
      try {
        iframe.remove()
      } catch {
        /* ignore */
      }
    }

    const doPrint = () => {
      try {
        cw.focus()
        cw.print()
      } catch {
        /* ignore */
      } finally {
        window.setTimeout(cleanup, 800)
      }
    }

    const el = iframe as HTMLIFrameElement
    if ("srcdoc" in el) {
      let printScheduled = false
      const schedulePrint = () => {
        if (printScheduled) return
        printScheduled = true
        window.setTimeout(doPrint, delayMs)
      }
      iframe.onload = () => schedulePrint()
      el.srcdoc = docHtml
      window.setTimeout(schedulePrint, delayMs + 400)
      return true
    }

    const idoc = iframe.contentDocument
    if (!idoc) {
      iframe.remove()
      return printViaPopup(docHtml, delayMs)
    }
    idoc.open()
    idoc.write(docHtml)
    idoc.close()
    window.setTimeout(doPrint, delayMs)
    return true
  } catch {
    return printViaPopup(docHtml, delayMs)
  }
}

/** Print the current browser tab (for on-screen previews with @media print rules). */
export function printCurrentWindow(): void {
  if (typeof window !== "undefined") window.print()
}

/** Fields needed to print a SaaS / admin contract agreement. */
export type ContractPrintFields = {
  contract_number: string
  company_name?: string | null
  contract_date: string
  expiry_date: string
  status: string
  license_type?: string | null
  billing_period: string
  currency: string
  total_contract_value: string | number
  broadcast_message?: string | null
  payment_reminder_message?: string | null
  terms_and_conditions?: string | null
}

export function buildContractAgreementHtml(
  c: ContractPrintFields,
  formatDateOnly: (iso: string) => string
): string {
  const terms = c.terms_and_conditions
    ? `<div class="section"><h3>Terms and Conditions</h3><p>${escapeHtmlWithBreaks(c.terms_and_conditions)}</p></div>`
    : ""
  return `
    <div class="contract-header">
      <h1>CONTRACT AGREEMENT</h1>
      <p>Contract Number: ${escapeHtml(String(c.contract_number))}</p>
    </div>
    <div class="section">
      <p><span class="label">Company:</span> ${escapeHtml(c.company_name || "N/A")}</p>
      <p><span class="label">Contract Date:</span> ${escapeHtml(formatDateOnly(c.contract_date))}</p>
      <p><span class="label">Expiry Date:</span> ${escapeHtml(formatDateOnly(c.expiry_date))}</p>
      <p><span class="label">Status:</span> ${escapeHtml(String(c.status).toUpperCase())}</p>
      <p><span class="label">License Type:</span> ${escapeHtml(c.license_type || "N/A")}</p>
      <p><span class="label">Billing Period:</span> ${escapeHtml(String(c.billing_period).toUpperCase())}</p>
      <p><span class="label">Amount:</span> ${escapeHtml(String(c.currency))} ${escapeHtml(String(c.total_contract_value))}</p>
      ${
        c.broadcast_message
          ? `<p><span class="label">Broadcast Message:</span> ${escapeHtml(c.broadcast_message)}</p>`
          : ""
      }
      ${
        c.payment_reminder_message
          ? `<p><span class="label">Payment Reminder:</span> ${escapeHtml(c.payment_reminder_message)}</p>`
          : ""
      }
      ${terms}
    </div>
  `
}

export function printContractAgreement(
  c: ContractPrintFields,
  formatDateOnly: (iso: string) => string
): boolean {
  return printDocument({
    title: `Contract ${c.contract_number}`,
    bodyHtml: buildContractAgreementHtml(c, formatDateOnly),
  })
}

/** Minimal shape for customer/vendor/employee ledger printouts. */
export type LedgerStatementPrintInput = {
  display_name: string
  period_start_balance?: string
  closing_balance?: string
  start_date?: string | null
  end_date?: string | null
  transactions: Array<{
    date: string
    type: string
    reference: string
    description: string
    debit: string
    credit: string
    balance: string
  }>
}

export function buildLedgerStatementHtml(
  data: LedgerStatementPrintInput,
  options: {
    companyName: string
    companyAddress?: string
    currencySymbol: string
    /** e.g. "Customer account statement" */
    documentTitle: string
    printedAt: string
  }
): string {
  const sym = options.currencySymbol
  const periodNote =
    data.start_date && data.end_date
      ? `Period: ${escapeHtml(data.start_date)} — ${escapeHtml(data.end_date)}`
      : "All activity (default period)"
  const rows =
    data.transactions?.length > 0
      ? data.transactions
          .map(row => {
            const d = parseFloat(row.debit || "0")
            const c = parseFloat(row.credit || "0")
            const b = parseFloat(row.balance || "0")
            return `<tr>
            <td>${escapeHtml(row.date || "")}</td>
            <td>${escapeHtml(row.type || "")}</td>
            <td>${escapeHtml(row.reference || "")}</td>
            <td>${escapeHtml(row.description || "")}</td>
            <td class="right">${escapeHtml(sym)}${d > 0 ? escapeHtml(formatPrintAmount(d)) : "—"}</td>
            <td class="right">${escapeHtml(sym)}${c > 0 ? escapeHtml(formatPrintAmount(c)) : "—"}</td>
            <td class="right">${escapeHtml(sym)}${escapeHtml(formatPrintAmount(b))}</td>
          </tr>`
          })
          .join("")
      : `<tr><td colspan="7" style="text-align:center;color:#6b7280">No transactions in this period.</td></tr>`

  const ps = formatPrintAmount(parseFloat(data.period_start_balance || "0"))
  const cl = formatPrintAmount(parseFloat(data.closing_balance || "0"))

  return `
    <div class="co">
      <h1>${escapeHtml(options.documentTitle)}</h1>
      <div><strong>${escapeHtml(options.companyName)}</strong></div>
      ${options.companyAddress ? `<div class="muted">${escapeHtml(options.companyAddress)}</div>` : ""}
      <p class="muted">Printed ${escapeHtml(options.printedAt)}</p>
    </div>
    <p><strong>${escapeHtml(data.display_name || "Account")}</strong></p>
    <p class="muted">${periodNote}</p>
    <table><tbody>
      <tr><td>Period start balance</td><td class="right">${escapeHtml(sym)}${escapeHtml(ps)}</td></tr>
      <tr><td>Closing balance (period)</td><td class="right">${escapeHtml(sym)}${escapeHtml(cl)}</td></tr>
    </tbody></table>
    <table><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Description</th><th class="right">Debit</th><th class="right">Credit</th><th class="right">Balance</th></tr></thead><tbody>
    ${rows}
    </tbody></table>
  `
}

export function printLedgerStatement(
  data: LedgerStatementPrintInput,
  options: Parameters<typeof buildLedgerStatementHtml>[1]
): boolean {
  return printDocument({
    title: `${options.documentTitle} — ${data.display_name}`,
    bodyHtml: buildLedgerStatementHtml(data, options),
  })
}
