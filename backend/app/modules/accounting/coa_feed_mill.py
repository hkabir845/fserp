"""
Feed mill / agri-industry chart of accounts — structured for general-purpose IFRS-style
reporting (IAS 1 presentation) and common local GAAP where the same line items apply.

Conceptual mapping (indicative; statutory reporting remains the entity’s responsibility):
- IAS 1: current vs non-current assets/liabilities; profit/loss by nature (expense headings).
- IAS 2: inventories (13xx / COGS).
- IFRS 15: revenue, contract assets, refunds/contra-revenue, contract liabilities.
- IAS 16 / IFRS 16: PPE, right-of-use assets, lease liabilities (split current / non-current).
- IAS 12: deferred tax assets/liabilities; current tax via income tax expense and payables.
- IAS 37: provisions (current / non-current).
- IAS 20: government grants (income or deferred to liabilities as applicable).

Apply once per tenant; add jurisdiction-specific statutory accounts (withholding, sector levies)
via separate rows or local extensions.
"""
from typing import List, Optional, Tuple
from sqlalchemy.orm import Session

from app.modules.accounting.models import Account, JournalLine

# (code, name, type, parent_code optional)
FEED_MILL_COA: List[Tuple[str, str, str, Optional[str]]] = [
    # ASSETS
    ("1000", "ASSETS", "asset", None),
    ("1100", "Current assets", "asset", "1000"),
    ("1110", "Cash on hand", "asset", "1100"),
    ("1120", "Bank accounts — operating", "asset", "1100"),
    ("1130", "Bank accounts — payroll", "asset", "1100"),
    ("1140", "Petty cash", "asset", "1100"),
    ("1150", "Cash equivalents & short-term deposits", "asset", "1100"),
    ("1200", "Accounts receivable — trade", "asset", "1100"),
    ("1210", "Accounts receivable — other", "asset", "1100"),
    ("1220", "Allowance for doubtful debts", "asset", "1100"),
    ("1230", "Contract assets (unbilled revenue, IFRS 15)", "asset", "1100"),
    ("1300", "Inventory — raw materials", "asset", "1100"),
    ("1310", "Inventory — packaging", "asset", "1100"),
    ("1320", "Inventory — finished goods (feed)", "asset", "1100"),
    ("1330", "Inventory — spare parts & supplies", "asset", "1100"),
    ("1400", "Prepayments & advances to suppliers", "asset", "1100"),
    ("1410", "Prepaid expenses (non-trade)", "asset", "1100"),
    ("1420", "Capitalized contract costs to fulfil (IFRS 15)", "asset", "1100"),
    ("1500", "VAT / GST input (recoverable)", "asset", "1100"),
    ("1600", "Non-current assets", "asset", "1000"),
    ("1610", "Property, plant & equipment — land & buildings", "asset", "1600"),
    ("1620", "Plant & machinery — feed mill", "asset", "1600"),
    ("1630", "Vehicles & transport fleet", "asset", "1600"),
    ("1640", "Computer & office equipment", "asset", "1600"),
    ("1650", "Accumulated depreciation & accumulated impairment — PPE", "asset", "1600"),
    ("1660", "Deferred tax assets (IAS 12)", "asset", "1600"),
    ("1670", "Right-of-use assets (IFRS 16)", "asset", "1600"),
    ("1700", "Intangibles & software", "asset", "1600"),
    # LIABILITIES
    ("2000", "LIABILITIES", "liability", None),
    ("2100", "Current liabilities", "liability", "2000"),
    ("2110", "Accounts payable — trade", "liability", "2100"),
    ("2120", "Accounts payable — other", "liability", "2100"),
    ("2130", "Accrued expenses", "liability", "2100"),
    ("2140", "Employee payables & reimbursements", "liability", "2100"),
    ("2150", "Short-term borrowings & bank OD", "liability", "2100"),
    ("2155", "Current portion of long-term borrowings", "liability", "2100"),
    ("2115", "Lease liabilities — current (IFRS 16)", "liability", "2100"),
    ("2160", "VAT / GST output (payable)", "liability", "2100"),
    ("2165", "Income & other taxes payable — current", "liability", "2100"),
    ("2170", "Provisions — current (IAS 37)", "liability", "2100"),
    ("2180", "Contract liabilities & customer advances (IFRS 15)", "liability", "2100"),
    ("2200", "Non-current liabilities", "liability", "2000"),
    ("2210", "Long-term loans", "liability", "2200"),
    ("2215", "Lease liabilities — non-current (IFRS 16)", "liability", "2200"),
    ("2220", "Provisions — non-current (IAS 37)", "liability", "2200"),
    ("2250", "Deferred tax liabilities (IAS 12)", "liability", "2200"),
    # EQUITY
    ("3000", "EQUITY", "equity", None),
    ("3100", "Share capital", "equity", "3000"),
    ("3200", "Retained earnings", "equity", "3000"),
    ("3300", "Current year profit / loss", "equity", "3000"),
    ("3360", "Other reserves (e.g. OCI / statutory / revaluation)", "equity", "3000"),
    # INCOME
    ("4000", "INCOME", "income", None),
    ("4100", "Sales revenue — finished feed", "income", "4000"),
    ("4110", "Sales revenue — by-products", "income", "4000"),
    ("4120", "Sales returns, rebates & discounts (adjustment to revenue, IFRS 15)", "income", "4000"),
    ("4130", "Government grants & incentivized income (IAS 20)", "income", "4000"),
    ("4200", "Other operating income", "income", "4000"),
    # COST & EXPENSES
    ("5000", "COST OF SALES & OPERATING EXPENSES", "expense", None),
    ("5100", "Cost of goods sold — materials", "expense", "5000"),
    ("5110", "Cost of goods sold — conversion & overhead", "expense", "5000"),
    ("5200", "Freight & distribution — outbound", "expense", "5000"),
    ("5210", "Fuel & fleet operating (non-capitalized)", "expense", "5000"),
    ("5300", "Employee costs — salaries & wages", "expense", "5000"),
    ("5310", "Employee costs — benefits & statutory", "expense", "5000"),
    ("5320", "Field & travel — client visits & claims", "expense", "5000"),
    ("5400", "Utilities — power & water (production)", "expense", "5000"),
    ("5410", "Repairs & maintenance — plant & fleet", "expense", "5000"),
    ("5500", "Laboratory & QC", "expense", "5000"),
    ("5600", "Sales & marketing", "expense", "5000"),
    ("5700", "Administrative expenses", "expense", "5000"),
    ("5800", "Finance costs", "expense", "5000"),
    ("5810", "Interest expense — borrowings", "expense", "5000"),
    ("5820", "Interest expense — lease liabilities (IFRS 16)", "expense", "5000"),
    ("5830", "Bank charges & other finance costs", "expense", "5000"),
    ("5840", "Income tax expense — current year (IAS 12)", "expense", "5000"),
    ("5850", "Income tax expense — deferred (IAS 12)", "expense", "5000"),
    ("5860", "Impairment losses — financial assets & PPE (IFRS 9 / IAS 36)", "expense", "5000"),
    ("5900", "Depreciation & amortization", "expense", "5000"),
]


def apply_feed_mill_chart(db: Session, tenant_id: int, replace_existing: bool = False) -> int:
    """
    Insert template accounts. If replace_existing, removes tenant accounts first (destructive).
    """
    if replace_existing:
        posted = (
            db.query(JournalLine)
            .filter(JournalLine.tenant_id == tenant_id)
            .count()
        )
        if posted > 0:
            raise ValueError("Cannot replace chart: journal lines already exist for this tenant.")
        db.query(Account).filter(Account.tenant_id == tenant_id).delete()
        db.commit()

    code_to_id: dict[str, int] = {}
    created = 0
    # Two passes: parents first (ordered by code length / hierarchy in list)
    for code, name, acc_type, parent_code in FEED_MILL_COA:
        parent_id = None
        if parent_code:
            parent_id = code_to_id.get(parent_code)
        exists = (
            db.query(Account)
            .filter(Account.tenant_id == tenant_id, Account.code == code)
            .first()
        )
        if exists:
            code_to_id[code] = exists.id
            continue
        row = Account(
            tenant_id=tenant_id,
            code=code,
            name=name,
            type=acc_type,
            parent_id=parent_id,
            is_active=True,
        )
        db.add(row)
        db.flush()
        code_to_id[code] = row.id
        created += 1
    db.commit()
    return created
