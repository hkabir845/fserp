/**
 * Aquaculture register P&L — shared figures and export fragments (print / CSV / JSON).
 * Net profit is always: total income − total expenses (feed, medicine, and every other cost).
 */

import {
  resolveAquaculturePlFigures,
  resolvePlMgmtSnapshot,
  type PlCategoryRow,
  type PlMgmtSnapshot,
  type PlTotalsLike,
} from '@/components/reports/AquaculturePlCategoryMatrices'
import { escapeHtml } from '@/utils/printDocument'

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  const str = String(value).replace(/"/g, '""')
  return `"${str}"`
}

export interface AquaculturePlExportFigures {
  totalIncome: number
  totalExpenses: number
  netProfit: number
  pondName?: string | null
  incomeCategories: PlCategoryRow[]
  expenseCategories: PlCategoryRow[]
}

function mgmtFromReportData(
  data: Record<string, unknown>,
  pondId?: number | null,
  pondRows?: Record<string, unknown>[],
): PlMgmtSnapshot | null {
  const fromResolver = resolvePlMgmtSnapshot(data, pondRows, pondId)
  if (fromResolver?.totals) return fromResolver
  const totals = data.totals as PlTotalsLike | undefined
  if (!totals) return null
  return {
    totals,
    ponds: (data.ponds as PlMgmtSnapshot['ponds']) ?? [],
    expenses_by_category: (data.expenses_by_category as PlCategoryRow[]) ?? [],
    income_by_category: (data.income_by_category as PlCategoryRow[]) ?? [],
    expenses_by_pond: (data.expenses_by_pond as PlMgmtSnapshot['expenses_by_pond']) ?? [],
    income_by_pond: (data.income_by_pond as PlMgmtSnapshot['income_by_pond']) ?? [],
  }
}

/** Resolve canonical register P&L figures for export (pond-scoped or company aquaculture totals). */
export function getAquaculturePlExportFigures(
  data: Record<string, unknown> | null | undefined,
  pondId?: number | null,
  pondRows?: Record<string, unknown>[],
  pondName?: string | null,
): AquaculturePlExportFigures | null {
  if (!data) return null
  const mgmt = mgmtFromReportData(data, pondId, pondRows)
  if (!mgmt?.totals) return null
  const expenseCategories = mgmt.expenses_by_category ?? []
  const incomeCategories = mgmt.income_by_category ?? []
  const { income, expenses, netProfit } = resolveAquaculturePlFigures(mgmt.totals, expenseCategories)
  const name =
    pondName?.trim() ||
    mgmt.ponds?.find((p) => pondId != null && Number(p.pond_id) === pondId)?.pond_name?.trim() ||
    mgmt.ponds?.[0]?.pond_name?.trim() ||
    (typeof data.filter_pond_name === 'string' ? String(data.filter_pond_name).trim() : null) ||
    null
  return {
    totalIncome: income,
    totalExpenses: expenses,
    netProfit,
    pondName: name,
    incomeCategories,
    expenseCategories,
  }
}

export function formatPlBottomLineText(income: number, expenses: number, netProfit: number): string {
  return `Total income (${income.toFixed(2)}) − Total expenses (${expenses.toFixed(2)}) = Net profit (${netProfit.toFixed(2)})`
}

export function buildAquaculturePlBottomLineCsv(figures: AquaculturePlExportFigures): string {
  let out = '\nP&L summary (aquaculture register)\n'
  out += 'Metric,Amount (BDT)\n'
  out += `Total income,${figures.totalIncome}\n`
  out += `Total expenses,${figures.totalExpenses}\n`
  out += `Net profit,${figures.netProfit}\n`
  out += `Formula,"${formatPlBottomLineText(figures.totalIncome, figures.totalExpenses, figures.netProfit)}"\n`
  return out
}

function fmtMoney(n: number): string {
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function buildAquaculturePlBottomLinePrintHtml(figures: AquaculturePlExportFigures): string {
  const title = figures.pondName ? `P&L — ${escapeHtml(figures.pondName)}` : 'P&L summary'
  return `<div class="summary"><h2>${title}</h2>
<p><strong>Total income:</strong> ${fmtMoney(figures.totalIncome)}</p>
<p><strong>Total expenses:</strong> ${fmtMoney(figures.totalExpenses)}</p>
<p><strong>Net profit:</strong> ${fmtMoney(figures.netProfit)}</p>
<p><em>Total income − Total expenses = Net profit</em></p></div>`
}

function categoryTableHtml(title: string, categories: PlCategoryRow[]): string {
  const active = categories.filter((c) => Number(c.amount ?? 0) !== 0)
  if (!active.length) return ''
  let html = `<h3>${escapeHtml(title)}</h3><table><thead><tr><th>Category</th><th style="text-align:right">Amount (BDT)</th></tr></thead><tbody>`
  active.forEach((c) => {
    html += `<tr><td>${escapeHtml(c.label || c.category.replace(/_/g, ' '))}</td><td style="text-align:right">${fmtMoney(Number(c.amount ?? 0))}</td></tr>`
  })
  html += '</tbody></table>'
  return html
}

function categoryTableCsv(title: string, categories: PlCategoryRow[]): string {
  const active = categories.filter((c) => Number(c.amount ?? 0) !== 0)
  if (!active.length) return ''
  let out = `\n${title}\nCategory,Amount (BDT)\n`
  active.forEach((c) => {
    out += `${escapeCsvValue(c.label || c.category)},${c.amount ?? 0}\n`
  })
  return out
}

export function buildAquaculturePlRegisterPrintHtml(
  figures: AquaculturePlExportFigures,
  options?: { showIncome?: boolean; showExpenses?: boolean },
): string {
  const showIncome = options?.showIncome !== false
  const showExpenses = options?.showExpenses !== false
  const heading = figures.pondName
    ? `Profit & Loss — ${escapeHtml(figures.pondName)} (aquaculture register)`
    : 'Profit & Loss (aquaculture register)'
  let html = `<h2>${heading}</h2>`
  if (showIncome && figures.incomeCategories.length) {
    html += categoryTableHtml('Income', figures.incomeCategories)
    html += `<p><strong>Total income:</strong> ${fmtMoney(figures.totalIncome)}</p>`
  }
  if (showExpenses && figures.expenseCategories.length) {
    html += categoryTableHtml('Expenses', figures.expenseCategories)
    html += `<p><strong>Total expenses:</strong> ${fmtMoney(figures.totalExpenses)}</p>`
  }
  html += buildAquaculturePlBottomLinePrintHtml(figures)
  return html
}

export function buildAquaculturePlRegisterCsv(
  figures: AquaculturePlExportFigures,
  options?: { showIncome?: boolean; showExpenses?: boolean },
): string {
  const showIncome = options?.showIncome !== false
  const showExpenses = options?.showExpenses !== false
  let out = ''
  if (showIncome) out += categoryTableCsv('Income', figures.incomeCategories)
  if (showExpenses) out += categoryTableCsv('Expenses', figures.expenseCategories)
  out += buildAquaculturePlBottomLineCsv(figures)
  return out
}

/** GL income statement bottom line: income − (COGS + expenses) = net income. */
export function buildGlIncomeStatementBottomLine(
  income: number,
  cogs: number,
  operatingExpenses: number,
  netIncome: number,
): { csv: string; printHtml: string } {
  const totalExpenses = cogs + operatingExpenses
  const csv =
    '\nP&L summary\n' +
    'Metric,Amount\n' +
    `Total income,${income}\n` +
    `Cost of goods sold,${cogs}\n` +
    `Operating expenses,${operatingExpenses}\n` +
    `Total expenses (COGS + operating),${totalExpenses}\n` +
    `Net income,${netIncome}\n` +
    `Formula,"Total income (${income}) − Total expenses (${totalExpenses}) = Net income (${netIncome})"\n`
  const printHtml = `<div class="summary"><h2>P&L summary</h2>
<p><strong>Total income:</strong> ${fmtMoney(income)}</p>
<p><strong>Total expenses (COGS + operating):</strong> ${fmtMoney(totalExpenses)}</p>
<p><strong>Net income:</strong> ${fmtMoney(netIncome)}</p>
<p><em>Total income − Total expenses = Net income</em></p></div>`
  return { csv, printHtml }
}

/** Attach computed pl_summary and corrected aquaculture totals for JSON export. */
export function enrichReportDataForExport(
  reportId: string,
  data: Record<string, unknown>,
  pondId?: number | null,
  pondName?: string | null,
): Record<string, unknown> {
  const out = { ...data }
  const aq = getAquaculturePlExportFigures(data, pondId, undefined, pondName)
  if (aq) {
    out.pl_summary = {
      total_income: aq.totalIncome,
      total_expenses: aq.totalExpenses,
      net_profit: aq.netProfit,
      formula: 'total_income - total_expenses = net_profit',
      pond_name: aq.pondName ?? null,
    }
    if (out.aquaculture_management && typeof out.aquaculture_management === 'object') {
      const mgmt = { ...(out.aquaculture_management as Record<string, unknown>) }
      mgmt.totals = {
        ...((mgmt.totals as Record<string, unknown>) ?? {}),
        total_income: String(aq.totalIncome),
        total_costs_and_expenses: String(aq.totalExpenses),
        net_profit: String(aq.netProfit),
        profit: String(aq.netProfit),
      }
      out.aquaculture_management = mgmt
    }
    if (out.totals && typeof out.totals === 'object') {
      out.totals = {
        ...(out.totals as Record<string, unknown>),
        total_income: String(aq.totalIncome),
        total_costs_and_expenses: String(aq.totalExpenses),
        net_profit: String(aq.netProfit),
        profit: String(aq.netProfit),
      }
    }
    if (out.pl_grand_totals && typeof out.pl_grand_totals === 'object') {
      out.pl_grand_totals = {
        ...(out.pl_grand_totals as Record<string, unknown>),
        total_income: String(aq.totalIncome),
        total_costs_and_expenses: String(aq.totalExpenses),
        net_profit: String(aq.netProfit),
      }
    }
  } else if (reportId === 'income-statement') {
    const income = Number((data.income as { total?: number })?.total ?? 0)
    const cogs = Number((data.cost_of_goods_sold as { total?: number })?.total ?? 0)
    const opExp = Number((data.expenses as { total?: number })?.total ?? 0)
    const net = Number(data.net_income ?? income - cogs - opExp)
    out.pl_summary = {
      total_income: income,
      total_expenses: cogs + opExp,
      net_income: net,
      cost_of_goods_sold: cogs,
      operating_expenses: opExp,
      formula: 'total_income - total_expenses = net_income',
    }
  }
  return out
}

/** Recompute per-pond net profit for aquaculture-pond-pl CSV/print rows. */
export function pondRowNetProfit(p: Record<string, unknown>): number {
  const income = Number(p.income_total ?? p.revenue ?? 0)
  const expenses = Number(p.expense_total ?? p.total_costs ?? 0)
  if (expenses > 0 || income > 0) return income - expenses
  return Number(p.net_profit ?? p.profit ?? 0)
}

export function pondTotalsFromRows(ponds: Record<string, unknown>[]): {
  totalIncome: number
  totalExpenses: number
  netProfit: number
} {
  let totalIncome = 0
  let totalExpenses = 0
  ponds.forEach((p) => {
    totalIncome += Number(p.income_total ?? p.revenue ?? 0)
    totalExpenses += Number(p.expense_total ?? p.total_costs ?? 0)
  })
  return { totalIncome, totalExpenses, netProfit: totalIncome - totalExpenses }
}
