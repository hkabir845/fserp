"""
Python parity checks for frontend report CSV export (reportExportHelpers.ts).
Used by test_report_accounting_audit.py — not a full TS runner; validates API JSON → CSV totals.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any


def escape_csv_value(value: Any) -> str:
    if value is None:
        return ""
    s = str(value).replace('"', '""')
    return f'"{s}"'


def build_expense_detail_csv(data: dict[str, Any]) -> str:
    expenses = data.get("expenses") or {}
    accounts = expenses.get("accounts") or []
    lines = ["Account code,Account name,Balance"]
    total = Decimal("0")
    for a in accounts:
        bal = Decimal(str(a.get("balance") or 0))
        total += bal
        lines.append(
            f"{escape_csv_value(a.get('account_code'))},{escape_csv_value(a.get('account_name'))},{bal}"
        )
    lines.append(f"Total,,{total}")
    return "\n".join(lines) + "\n"


def build_income_detail_csv(data: dict[str, Any]) -> str:
    income = data.get("income") or {}
    accounts = income.get("accounts") or []
    lines = ["Account code,Account name,Balance"]
    total = Decimal("0")
    for a in accounts:
        bal = Decimal(str(a.get("balance") or 0))
        total += bal
        lines.append(
            f"{escape_csv_value(a.get('account_code'))},{escape_csv_value(a.get('account_name'))},{bal}"
        )
    lines.append(f"Total,,{total}")
    return "\n".join(lines) + "\n"


def build_income_statement_csv(data: dict[str, Any]) -> str:
    """Matches frontend reports/page.tsx income-statement export branches."""
    lines = ["Section,Account code,Account name,Balance"]
    section_totals: dict[str, Decimal] = {
        "income": Decimal("0"),
        "cogs": Decimal("0"),
        "expense": Decimal("0"),
    }

    for acc in (data.get("income") or {}).get("accounts") or []:
        bal = Decimal(str(acc.get("balance") or 0))
        section_totals["income"] += bal
        lines.append(
            "Income,"
            f"{escape_csv_value(acc.get('account_code'))},"
            f"{escape_csv_value(acc.get('account_name'))},"
            f"{bal}"
        )
    for acc in (data.get("cost_of_goods_sold") or {}).get("accounts") or []:
        bal = Decimal(str(acc.get("balance") or 0))
        section_totals["cogs"] += bal
        lines.append(
            "Cost of Goods Sold,"
            f"{escape_csv_value(acc.get('account_code'))},"
            f"{escape_csv_value(acc.get('account_name'))},"
            f"{bal}"
        )
    for acc in (data.get("expenses") or {}).get("accounts") or []:
        bal = Decimal(str(acc.get("balance") or 0))
        section_totals["expense"] += bal
        lines.append(
            "Expenses,"
            f"{escape_csv_value(acc.get('account_code'))},"
            f"{escape_csv_value(acc.get('account_name'))},"
            f"{bal}"
        )

    lines.append(f"Gross Profit,,,{section_totals['income'] - section_totals['cogs']}")
    lines.append(
        f"Net Income,,,{section_totals['income'] - section_totals['cogs'] - section_totals['expense']}"
    )
    return "\n".join(lines) + "\n"


def parse_csv_total_row(csv_text: str) -> Decimal | None:
    for line in csv_text.strip().splitlines():
        if line.startswith("Total,,"):
            parts = line.split(",")
            if len(parts) >= 3 and parts[2]:
                return Decimal(parts[2])
    return None


def parse_income_statement_net_from_csv(csv_text: str) -> Decimal | None:
    for line in csv_text.strip().splitlines():
        if line.startswith("Net Income,,,"):
            return Decimal(line.split(",")[-1])
    return None
