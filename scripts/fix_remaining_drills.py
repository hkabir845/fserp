from pathlib import Path

p = Path(__file__).resolve().parents[1] / "frontend" / "src" / "app" / "reports" / "page.tsx"
text = p.read_text(encoding="utf-8")

text = text.replace("{formatCurrency(netIncome)}", '{Money(netIncome, plAllDrill, "total")}', 1)

text = text.replace(
    '<td className="px-3 py-2 text-right font-semibold text-slate-900">{formatCurrency(ta)}</td>',
    '<td className="px-3 py-2 text-right font-semibold text-slate-900">{Money(ta, itemsTotalRow(cRows, "Item purchases", ["period_purchase_amount"]), "period_purchase_amount")}</td>',
    1,
)

text = text.replace(
    "{formatCurrency(tpa)}",
    '{Money(tpa, itemsTotalRow(cRows, "Stock movement purchases", ["purchase_amount"]), "purchase_amount")}',
)
text = text.replace(
    "{formatCurrency(tsr)}",
    '{Money(tsr, itemsTotalRow(cRows, "Stock movement sales", ["sales_revenue"]), "sales_revenue")}',
)
text = text.replace(
    "{formatCurrency(st.rev)}",
    '{Money(st.rev, itemsTotalRow(cRows, "Category revenue", ["period_revenue"]), "period_revenue")}',
)
text = text.replace(
    "{formatCurrency(gt.rev)}",
    '{Money(gt.rev, itemsTotalRow(cRows, "Grand revenue", ["period_revenue"]), "period_revenue")}',
)
text = text.replace(
    "{formatCurrency(st.pam)}",
    '{Money(st.pam, itemsTotalRow(cRows, "Category purchases", ["period_purchase_amount"]), "period_purchase_amount")}',
)
text = text.replace(
    "{formatCurrency(gt.pam)}",
    '{Money(gt.pam, itemsTotalRow(cRows, "Grand purchases", ["period_purchase_amount"]), "period_purchase_amount")}',
)

text = text.replace(
    "? formatCurrency(row.variance_value_estimate)",
    '? Money(row.variance_value_estimate, row, "variance_value_estimate")',
)
text = text.replace(
    "{formatCurrency(entryValSum)}",
    '{Money(entryValSum, itemsTotalRow(entries, "Dip variance value", ["variance_value_estimate"]), "variance_value_estimate")}',
)

text = text.replace(
    "{formatCurrency(summary.total_gain_value)}",
    '{Money(summary.total_gain_value, summary, "total_gain_value")}',
)
text = text.replace(
    "{formatCurrency(summary.total_loss_value)}",
    '{Money(summary.total_loss_value, summary, "total_loss_value")}',
)
text = text.replace(
    "({formatCurrency(summary.net_variance_value)})",
    '({Money(summary.net_variance_value, summary, "net_variance_value")})',
)
text = text.replace(
    "({formatCurrency(stats.total_gain_value || 0)})",
    '({Money(stats.total_gain_value || 0, stats, "total_gain_value")})',
)
text = text.replace(
    "({formatCurrency(stats.total_loss_value || 0)})",
    '({Money(stats.total_loss_value || 0, stats, "total_loss_value")})',
)
text = text.replace(
    "({formatCurrency(stats.net_variance_value || 0)})",
    '({Money(stats.net_variance_value || 0, stats, "net_variance_value")})',
)
text = text.replace(
    "{formatCurrency(dipVval)}",
    '{Money(dipVval, documentsTotalRow(dips, { title: "Tank dip variance", entityType: "customers" }), "net_variance_value")}',
)

pond_row_fields = [
    ("p.revenue", "p", "revenue"),
    ("p.direct_operating_expenses", "p", "direct_operating_expenses"),
    ("p.shared_operating_expenses", "p", "shared_operating_expenses"),
    ("p.payroll_allocated", "p", "payroll_allocated"),
    ("p.total_costs", "p", "total_costs"),
    ("p.profit", "p", "profit"),
]
for expr, var, field in pond_row_fields:
    text = text.replace(f"{{MoneyBdt({expr})}}", f'{{MoneyBdt({expr}, {var}, "{field}")}}')

footer_fields = [
    ("t.revenue", "revenue"),
    ("t.payroll_allocated", "payroll_allocated"),
    ("t.total_costs", "total_costs"),
    ("t.profit", "profit"),
]
for expr, field in footer_fields:
    text = text.replace(
        f"{{MoneyBdt({expr})}}",
        f'{{MoneyBdt({expr}, scopedPlTotalRow(ponds, "Pond P&L total {field}", "{field}"), "{field}")}}',
    )

seg_fields = [
    ("s.revenue", "s", "revenue"),
    ("s.direct_operating_expenses", "s", "direct_operating_expenses"),
    ("s.segment_margin", "s", "segment_margin"),
]
for expr, var, field in seg_fields:
    text = text.replace(f"{{MoneyBdt({expr})}}", f'{{MoneyBdt({expr}, {var}, "{field}")}}')

p.write_text(text, encoding="utf-8")
print("done")
