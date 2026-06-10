#!/usr/bin/env python3
"""Wire remaining interactive report totals to ReportAmountCell (Money helper)."""
from __future__ import annotations

from pathlib import Path

PAGE = Path(__file__).resolve().parents[1] / "frontend" / "src" / "app" / "reports" / "page.tsx"
EXTRA = Path(__file__).resolve().parents[1] / "frontend" / "src" / "components" / "reports" / "ExtraFinancialReportPanels.tsx"

REPLACEMENTS: list[tuple[str, str]] = [
    # imports
    (
        "  loansTotalRow,\n} from '@/components/reports/reportDrillAggregate'",
        "  loansTotalRow,\n  scopedPlTotalRow,\n} from '@/components/reports/reportDrillAggregate'",
    ),
    # Money helpers
    (
        "  const Money = (amount: unknown, row?: Record<string, unknown>, field?: string) => (\n"
        "    <ReportAmountCell amount={Number(amount ?? 0)} row={row} field={field} scope={reportDrillScope()} />\n"
        "  )",
        "  const Money = (amount: unknown, row?: Record<string, unknown>, field?: string) => (\n"
        "    <ReportAmountCell amount={Number(amount ?? 0)} row={row} field={field} scope={reportDrillScope()} />\n"
        "  )\n\n"
        "  const MoneyBdt = (amount: unknown, row?: Record<string, unknown>, field?: string) => (\n"
        "    <ReportAmountCell amount={Number(amount ?? 0)} row={row} field={field} scope={reportDrillScope()} currency=\"BDT\" />\n"
        "  )",
    ),
    # daily-summary fuel KPIs
    (
        "{ label: 'Fuel sales', value: formatCurrency(sales.fuel_amount ?? sales.total_amount), icon: DollarSign, color: 'green' },",
        "{ label: 'Fuel sales', money: true, amount: sales.fuel_amount ?? sales.total_amount, row: sales, field: 'fuel_amount', icon: DollarSign, color: 'green' },",
    ),
    (
        "{ label: 'Shop / other', value: formatCurrency(sales.shop_amount ?? 0), icon: Package, color: 'purple' },",
        "{ label: 'Shop / other', money: true, amount: sales.shop_amount ?? 0, row: sales, field: 'shop_amount', icon: Package, color: 'purple' },",
    ),
    (
        "{ label: 'Cash sales', value: formatCurrency(sales.cash_sales_total ?? 0), icon: Banknote, color: 'green' },",
        "{ label: 'Cash sales', money: true, amount: sales.cash_sales_total ?? 0, row: sales, field: 'cash_sales_total', icon: Banknote, color: 'green' },",
    ),
    (
        "{ label: 'Cash variance', value: formatCurrency(shifts.total_cash_variance), icon: DollarSign, color: 'yellow' },",
        "{ label: 'Cash variance', money: true, amount: shifts.total_cash_variance, row: shifts, field: 'total_cash_variance', icon: DollarSign, color: 'yellow' },",
    ),
    (
        "{ label: 'Shop sales', value: formatCurrency(sales.shop_amount ?? sales.total_amount), icon: DollarSign, color: 'green' },",
        "{ label: 'Shop sales', money: true, amount: sales.shop_amount ?? sales.total_amount, row: sales, field: 'shop_amount', icon: DollarSign, color: 'green' },",
    ),
    (
        "{ label: 'Cash (walk-in)', value: formatCurrency(sales.cash_sales_total ?? 0), icon: Banknote, color: 'green' },",
        "{ label: 'Cash (walk-in)', money: true, amount: sales.cash_sales_total ?? 0, row: sales, field: 'cash_sales_total', icon: Banknote, color: 'green' },",
    ),
    (
        "{ label: 'Credit (pond POS)', value: formatCurrency(sales.credit_sales_total ?? 0), icon: CreditCard, color: 'amber' },",
        "{ label: 'Credit (pond POS)', money: true, amount: sales.credit_sales_total ?? 0, row: sales, field: 'credit_sales_total', icon: CreditCard, color: 'amber' },",
    ),
    (
        "{ label: 'Pond POS total', value: formatCurrency(aq.pond_pos_sales_total ?? 0), icon: Fish, color: 'teal' },",
        "{ label: 'Pond POS total', money: true, amount: aq.pond_pos_sales_total ?? 0, row: aq, field: 'pond_pos_sales_total', icon: Fish, color: 'teal' },",
    ),
    (
        "{ label: 'Average sale', value: formatCurrency(sales.average_sale), icon: TrendingUp, color: 'purple' },",
        "{ label: 'Average sale', money: true, amount: sales.average_sale, row: sales, field: 'average_sale', icon: TrendingUp, color: 'purple' },",
    ),
    (
        "<p className={`text-xl font-bold mt-1 ${text.replace('600', '900')}`}>{item.value}</p>",
        "<p className={`text-xl font-bold mt-1 ${text.replace('600', '900')}`}>{"
        "item.money ? Money(item.amount, item.row as Record<string, unknown>, item.field) : item.value"
        "}</p>",
    ),
    (
        "{formatCurrency(data.sales?.total_amount ?? 0)} across",
        "{Money(data.sales?.total_amount ?? 0, data.sales, 'total_amount')} across",
    ),
    # income statement section + waterfall
    (
        "{formatCurrency(payload?.total ?? 0)}",
        "{Money(payload?.total ?? 0, accountsTotalRow(payload?.accounts ?? [], title), 'total')}",
    ),
    (
        "{formatCurrency(grossProfit)}",
        "{Money(grossProfit, accountsTotalRow([...incomeAccounts, ...cogsAccounts], 'Gross profit'), 'total')}",
    ),
    (
        "{formatCurrency(netIncome)}",
        "{Money(netIncome, plAllDrill, 'total')}",
    ),
    (
        "{formatCurrency(incomeTotal)}",
        "{Money(incomeTotal, plIncomeDrill, 'total')}",
    ),
    (
        "({formatCurrency(cogsTotal)})",
        "({Money(cogsTotal, plCogsDrill, 'total')})",
    ),
    (
        "({formatCurrency(expenseTotal)})",
        "({Money(expenseTotal, plExpenseDrill, 'total')})",
    ),
    # liabilities / loan GL footers
    (
        "{formatCurrency(data.total_liabilities ?? 0)}",
        "{Money(data.total_liabilities ?? 0, accountsTotalRow(accounts, 'Total liabilities'), 'total')}",
    ),
    (
        "{formatCurrency(data.total_loan_receivable_gl ?? 0)}",
        "{Money(data.total_loan_receivable_gl ?? 0, accountsTotalRow(accounts, 'Loan receivable GL'), 'total')}",
    ),
    (
        "{formatCurrency(data.total_loan_payable_gl ?? 0)}",
        "{Money(data.total_loan_payable_gl ?? 0, accountsTotalRow(accounts, 'Loan payable GL'), 'total')}",
    ),
    # fuel-sales KPI
    (
        "{item.format === 'currency' ? formatCurrency(item.value) :",
        "{item.format === 'currency' ? Money(item.value, data, item.label === 'Total Amount' ? 'total_amount' : 'average_sale_amount') :",
    ),
    # item-master footers
    (
        "{formatCurrency(Number(ms.total_extended_cost_value ?? catTotals.cost))}",
        "{Money(Number(ms.total_extended_cost_value ?? catTotals.cost), itemsTotalRow(rows, 'Catalog cost totals', ['extended_cost_value']), 'extended_cost_value')}",
    ),
    (
        "{formatCurrency(Number(ms.total_extended_list_value ?? catTotals.list))}",
        "{Money(Number(ms.total_extended_list_value ?? catTotals.list), itemsTotalRow(rows, 'Catalog list totals', ['extended_list_value']), 'extended_list_value')}",
    ),
    (
        "{formatCurrency(detailTotals.cost)}",
        "{Money(detailTotals.cost, itemsTotalRow(rows, 'Item detail cost', ['extended_cost_value']), 'extended_cost_value')}",
    ),
    (
        "{formatCurrency(detailTotals.list)}",
        "{Money(detailTotals.list, itemsTotalRow(rows, 'Item detail list', ['extended_list_value']), 'extended_list_value')}",
    ),
    # sales-by-nozzle summary KPIs
    (
        "{ label: 'Total Amount', value: formatCurrency(summary.total_amount), icon: DollarSign, color: 'indigo' },",
        "{ label: 'Total Amount', money: true, amount: summary.total_amount, row: summary, field: 'total_amount', icon: DollarSign, color: 'indigo' },",
    ),
    (
        "{ label: 'Average Sale', value: formatCurrency(summary.average_sale_amount), icon: TrendingUp, color: 'pink' },",
        "{ label: 'Average Sale', money: true, amount: summary.average_sale_amount, row: summary, field: 'average_sale_amount', icon: TrendingUp, color: 'pink' },",
    ),
    (
        "<p className={`text-2xl font-bold mt-1 ${text.replace('600', '900')}`}>{item.value}</p>",
        "<p className={`text-2xl font-bold mt-1 ${text.replace('600', '900')}`}>{"
        "item.money ? Money(item.amount, item.row as Record<string, unknown>, item.field) : item.value"
        "}</p>",
    ),
    (
        "{formatCurrency(Number(summary.total_amount ?? nozzles.reduce((s: number, n: any) => s + Number(n.total_amount ?? 0), 0)))}",
        "{Money(Number(summary.total_amount ?? nozzles.reduce((s: number, n: any) => s + Number(n.total_amount ?? 0), 0)), documentsTotalRow(nozzles, { title: 'Nozzle sales', entityType: 'customers' }), 'total_amount')}",
    ),
    # shift summary
    (
        "{formatCurrency(summary.total_sales)}",
        "{Money(summary.total_sales, summary, 'total_sales')}",
    ),
    (
        "{formatCurrency(summary.total_cash_expected)}",
        "{Money(summary.total_cash_expected, summary, 'total_cash_expected')}",
    ),
    (
        "Counted: {formatCurrency(summary.total_cash_counted || 0)}",
        "Counted: {Money(summary.total_cash_counted || 0, summary, 'total_cash_counted')}",
    ),
    (
        "{formatCurrency(Math.abs(summary.total_variance || 0))}",
        "{Money(Math.abs(summary.total_variance || 0), summary, 'total_variance')}",
    ),
    (
        "{formatCurrency(stats.total_sales)}",
        "{Money(stats.total_sales, { ...stats, documents: stats.documents }, 'total_sales')}",
    ),
    (
        "{formatCurrency(stats.total_cash_sales || 0)}",
        "{Money(stats.total_cash_sales || 0, stats, 'total_cash_sales')}",
    ),
    (
        "{formatCurrency(stats.total_non_cash_sales || 0)}",
        "{Money(stats.total_non_cash_sales || 0, stats, 'total_non_cash_sales')}",
    ),
    (
        "{formatCurrency(Math.abs(Number(stats.cash_variance || 0)))}",
        "{Money(Math.abs(Number(stats.cash_variance || 0)), stats, 'cash_variance')}",
    ),
    (
        "{formatCurrency(session.total_sales)}",
        "{Money(session.total_sales, session, 'total_sales')}",
    ),
    (
        "{formatCurrency(sessTotals.sales)}",
        "{Money(sessTotals.sales, documentsTotalRow(sessions, { title: 'Session sales', entityType: 'customers' }), 'total_sales')}",
    ),
    (
        "{formatCurrency(sessTotals.expected)}",
        "{Money(sessTotals.expected, summary, 'total_cash_expected')}",
    ),
    (
        "{formatCurrency(sessTotals.counted)}",
        "{Money(sessTotals.counted, summary, 'total_cash_counted')}",
    ),
    (
        "{formatCurrency(sessTotals.variance)}",
        "{Money(Math.abs(sessTotals.variance), summary, 'total_variance')}",
    ),
    # aqBdt -> MoneyBdt
    (
        "  const aqBdt = (n: number | string | undefined | null) => formatCurrency(Number(n ?? 0), 'BDT')\n",
        "",
    ),
]

AQBDT = "aqBdt("
MONEY_BDT = "MoneyBdt("


def patch_page() -> None:
    text = PAGE.read_text(encoding="utf-8")
    for old, new in REPLACEMENTS:
        if old not in text:
            print(f"SKIP (not found): {old[:60]}...")
            continue
        text = text.replace(old, new, 1)
    text = text.replace(AQBDT, MONEY_BDT)
    PAGE.write_text(text, encoding="utf-8")
    print(f"Patched {PAGE}")


def patch_extra() -> None:
    text = EXTRA.read_text(encoding="utf-8")
    pairs = [
        (
            "<p className=\"font-semibold\">{formatCurrency(Number(co.income ?? 0))}</p>",
            "<p className=\"font-semibold\"><DrillAmount amount={Number(co.income ?? 0)} drill={ctx.drillScope ? { kind: 'scoped-pl', label: 'Company income', startDate: ctx.drillScope().startDate, endDate: ctx.drillScope().endDate } : null} /></p>",
        ),
    ]
    # simpler: use ReportAmountCell via inline - ExtraFinancial already has DrillAmount imported
    # Wire company totals with accounts from co if available - use scoped-pl for company level
    co_drill = """{coDrillRow && field ? (
                <ReportAmountCell amount={Number(co[field] ?? 0)} row={coDrillRow} field={field} scope={ctx.drillScope?.() ?? {}} />
              ) : (
                formatCurrency(Number(co[field] ?? 0))
              )}"""
    # Too complex - do targeted replacements for company totals using account breakdown from sections
    extra_replacements = [
        (
            '<p className="font-semibold">{formatCurrency(Number(co.income ?? 0))}</p>',
            '<p className="font-semibold"><ReportAmountCell amount={Number(co.income ?? 0)} row={{ _drill: { income: { kind: \'scoped-pl\', label: \'Company income\' } } }} field="income" scope={ctx.drillScope?.() ?? {}} /></p>',
        ),
        (
            '<p className="font-semibold">{formatCurrency(Number(co.cost_of_goods_sold ?? 0))}</p>',
            '<p className="font-semibold"><ReportAmountCell amount={Number(co.cost_of_goods_sold ?? 0)} row={{ _drill: { cost_of_goods_sold: { kind: \'scoped-pl\', label: \'Company COGS\' } } }} field="cost_of_goods_sold" scope={ctx.drillScope?.() ?? {}} /></p>',
        ),
        (
            '<p className="font-semibold">{formatCurrency(Number(co.expenses ?? 0))}</p>',
            '<p className="font-semibold"><ReportAmountCell amount={Number(co.expenses ?? 0)} row={{ _drill: { expenses: { kind: \'scoped-pl\', label: \'Company expenses\' } } }} field="expenses" scope={ctx.drillScope?.() ?? {}} /></p>',
        ),
        (
            '<p className="font-semibold">{formatCurrency(Number(co.gross_profit ?? 0))}</p>',
            '<p className="font-semibold"><ReportAmountCell amount={Number(co.gross_profit ?? 0)} row={{ _drill: { gross_profit: { kind: \'scoped-pl\', label: \'Company gross profit\' } } }} field="gross_profit" scope={ctx.drillScope?.() ?? {}} /></p>',
        ),
        (
            '<p className="font-semibold">{formatCurrency(Number(co.net_income ?? 0))}</p>',
            '<p className="font-semibold"><ReportAmountCell amount={Number(co.net_income ?? 0)} row={{ _drill: { net_income: { kind: \'scoped-pl\', label: \'Company net income\' } } }} field="net_income" scope={ctx.drillScope?.() ?? {}} /></p>',
        ),
    ]
    if "ReportAmountCell" not in text:
        text = text.replace(
            "import { DrillAmount, glAccountDrill",
            "import { DrillAmount, glAccountDrill, ReportAmountCell",
        )
        text = text.replace(
            "from '@/components/reports/ReportDrillContext'",
            "from '@/components/reports/ReportDrillContext'\nimport { ReportAmountCell } from '@/components/reports/ReportAmountCell'",
        )
    for old, new in extra_replacements:
        if old in text:
            text = text.replace(old, new, 1)
    EXTRA.write_text(text, encoding="utf-8")
    print(f"Patched {EXTRA}")


if __name__ == "__main__":
    patch_page()
    patch_extra()
