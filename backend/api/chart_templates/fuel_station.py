"""
FSERP — International retail petroleum chart of accounts (template).

Designed for independent filling stations and small chains: pump sales, card settlements,
tank inventory, statutory taxes (configure labels per jurisdiction), c-store / lube / wash
where applicable, and operating expense buckets aligned with common P&L reporting.

Numbering (4-digit):
  1xxx  Current & fixed assets
  2xxx  Liabilities (trade, statutory, payroll, debt)
  3xxx  Equity
  4xxx  Revenue (fuel, non-fuel, other)
  5xxx  Cost of sales & inventory variance
  6xxx  Operating expenses

Profiles:
  full   — Fuel + c-store / lube / services + full expense taxonomy (~max coverage)
  retail — Core fuel retail + essential ops (smaller footprint)

Localize tax names (VAT/GST/excise) in your UI or rename accounts after import.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, List, Literal, Tuple


FUEL_STATION_TEMPLATE_ID = "fuel_station_v1"

ProfileName = Literal["full", "retail"]

FUEL_STATION_TEMPLATE_META: Dict[str, Any] = {
    "id": FUEL_STATION_TEMPLATE_ID,
    "name": "FSERP — Fuel Station (International Retail Petroleum)",
    "version": "1.0.0",
    "summary": (
        "Industry-style COA for retail fuel: cash & banking, card clearing, tank inventory, "
        "fuel and non-fuel revenue, COGS, merchant fees, shrinkage, and statutory payables. "
        "Use as a starting point — rename tax accounts for your country and add accounts as needed."
    ),
    "numbering_scheme": (
        "1xxx Assets · 2xxx Liabilities · 3xxx Equity · 4xxx Revenue · "
        "5xxx Cost of sales / variance · 6xxx Operating expenses"
    ),
    "profiles": {
        "full": {
            "label": "Full service",
            "description": (
                "Fuel grades, c-store / lube / services, card clearing, fleet receivables, "
                "and a broad expense structure suitable for multi-line sites."
            ),
        },
        "retail": {
            "label": "Fuel-first retail",
            "description": (
                "Streamlined set for pump-centric operations: core assets, liabilities, "
                "fuel sales & COGS, card fees, and essential operating costs (no c-store / wash lines)."
            ),
        },
    },
    "notes": [
        "Contra-asset or contra-revenue accounts can be added if your auditor prefers gross vs net presentation.",
        "Map POS, wet-stock, and card batch processes to Card clearing and Fuel inventory in your procedures.",
        "Rename 21xx tax accounts to match local labels (e.g. GST, HST, excise, carbon levy).",
    ],
}

# Accounts the FSERP engine looks up by code for automatic journals (if present in your COA).
# Missing codes: posting for that flow is skipped; operations still save.
ERP_AUTOMATION_ACCOUNT_GUIDE: List[Dict[str, str]] = [
    {
        "account_code": "1010",
        "purpose": "Default cash/bank side for paid POS invoices and undeposited cash when no bank account is linked on payment.",
    },
    {
        "account_code": "1020",
        "purpose": "Fallback cash clearing if 1010 is not in the chart.",
    },
    {
        "account_code": "1030",
        "purpose": (
            "Operating bank GL; payments received/made and bank-linked transfers when no per-bank GL is set. "
            "Owner cash contributions: debit 1030, credit 3000 (Owner Equity / Shareholder Capital) in a journal entry — "
            "link your Bank Account register to this chart account so the bank statement shows the same GL activity. "
            "Loans module: use as Settlement GL for disbursements/repayments when cash moves through this bank account."
        ),
    },
    {
        "account_code": "1100",
        "purpose": "Trade receivables: credit invoices (sent/partial), customer payments received, and remaining AR on mark-paid.",
    },
    {
        "account_code": "1120",
        "purpose": "Card / acquirer clearing: debit side for card POS sales when payment_method is card.",
    },
    {
        "account_code": "1200",
        "purpose": "Fuel (wet-stock) inventory: credited when COGS posts for fuel lines with item cost.",
    },
    {
        "account_code": "1220",
        "purpose": "Shop / c-store inventory: credited when COGS posts for non-fuel lines with item cost.",
    },
    {
        "account_code": "2000",
        "purpose": "Trade payables: vendor bills (non-draft) and payment-made journals.",
    },
    {
        "account_code": "2100",
        "purpose": "Collected VAT / sales tax on invoices and bills (output and simplified input side on bills).",
    },
    {
        "account_code": "4100",
        "purpose": "Revenue for fuel-grade / liter-based POS and invoice lines.",
    },
    {
        "account_code": "4200",
        "purpose": "Revenue for shop / convenience-style POS and invoice lines.",
    },
    {
        "account_code": "4230",
        "purpose": "Fallback revenue when a line does not map to 4100/4200.",
    },
    {
        "account_code": "5100",
        "purpose": "COGS for fuel lines (debit) when items have unit cost.",
    },
    {
        "account_code": "5120",
        "purpose": "COGS for shop lines (debit) when items have unit cost.",
    },
    {
        "account_code": "6900",
        "purpose": "Default expense for vendor bills (full bill amount to expense when bill posts).",
    },
    {
        "account_code": "3000",
        "purpose": "Owner Equity / Shareholder Capital (3000): credit this (and debit a bank/cash GL) via a manual journal when owners invest cash.",
    },
    {
        "account_code": "3300",
        "purpose": "Owner drawings / dividends: debit this (and credit bank/cash GL) when owners withdraw; use Journal Entries, not Fund Transfer.",
    },
    {
        "account_code": "1160",
        "purpose": (
            "Loans — principal receivable: Principal GL for money you **lent** (Loans → Lent). Chart type Loan, subtype loan receivable."
        ),
    },
    {
        "account_code": "2410",
        "purpose": (
            "Loans — principal payable: Principal GL for money you **borrowed** (Loans → Borrowed). Chart type Loan, subtype loan payable."
        ),
    },
    {
        "account_code": "6620",
        "purpose": "Loans — interest expense on borrowings; optional Interest GL when splitting repayments on borrowed loans.",
    },
    {
        "account_code": "4410",
        "purpose": "Loans — interest income on funds lent; optional Interest GL when splitting repayments on lent loans.",
    },
]


def _row(
    code: str,
    name: str,
    account_type: str,
    sub_type: str,
    description: str,
    profiles: Tuple[str, ...] = ("full", "retail"),
) -> Dict[str, Any]:
    return {
        "account_code": code,
        "account_name": name,
        "account_type": account_type,
        "account_sub_type": sub_type,
        "description": description,
        "profiles": profiles,
    }


# --- Template rows (flat list; parent links can be added later in UI if desired) ---------------
FUEL_STATION_COA_ROWS: List[Dict[str, Any]] = [
    # —— Assets: cash & banks ——
    _row("1010", "Cash on Hand — Station Tills", "asset", "cash_on_hand", "Physical cash in registers and safes."),
    _row("1020", "Cash Clearing — Undeposited", "asset", "other_current_asset", "Cash receipts not yet deposited to bank."),
    _row("1030", "Bank — Operating Account", "asset", "checking", "Primary operating bank account."),
    _row("1040", "Bank — Card Settlement", "asset", "checking", "Dedicated account for card acquirer settlements (optional)."),
    _row("1050", "Bank — Tax / Trust (Statutory)", "asset", "checking", "Segregated statutory or tax trust account if required."),
    # —— Assets: receivables & clearing ——
    _row("1100", "Accounts Receivable — Trade", "asset", "accounts_receivable", "Credit sales to walk-in or commercial customers."),
    _row("1110", "Accounts Receivable — Fleet / Commercial", "asset", "accounts_receivable", "Billed fleet cards and commercial charge accounts.", ("full",)),
    _row("1120", "Card Clearing — Visa / MC / Domestic Debit", "asset", "other_current_asset", "Unsettled card batches (acquirer clearing)."),
    _row("1130", "Card Clearing — Amex / Other Schemes", "asset", "other_current_asset", "Secondary card networks with different settlement cycles.", ("full",)),
    _row(
        "1140",
        "Allowance for Doubtful Accounts",
        "asset",
        "allowance_for_bad_debts",
        "Contra-AR reserve (credit balance; nets against receivables on the balance sheet).",
        ("full",),
    ),
    _row("1150", "Employee Advances & Loans", "asset", "other_current_asset", "Staff advances recoverable via payroll."),
    # —— Assets: inventory ——
    _row("1200", "Inventory — Fuel (Wet Stock at Cost)", "asset", "inventory", "Tank inventory valued at cost (FIFO/weighted average per policy)."),
    _row("1210", "Inventory — Lubricants & Fluids", "asset", "inventory", "Oils, DEF, additives on hand.", ("full",)),
    _row("1220", "Inventory — C-Store / Shop", "asset", "inventory", "Merchandise inventory for convenience retail.", ("full",)),
    _row("1230", "Inventory — Other Products", "asset", "inventory", "Car care, accessories, other resale goods.", ("full",)),
    # —— Assets: prepaid & deposits ——
    _row("1300", "Prepaid Insurance", "asset", "prepaid_expenses", "Unexpired insurance premiums."),
    _row("1310", "Prepaid Rent or Lease", "asset", "prepaid_expenses", "Rent paid in advance."),
    _row("1320", "Prepaid Other", "asset", "prepaid_expenses", "Licenses, subscriptions, other prepaids."),
    _row("1330", "Deposits — Utilities & Landlords", "asset", "other_current_asset", "Refundable utility or lease deposits."),
    # —— Assets: fixed ——
    _row("1500", "Land", "asset", "fixed_asset", "Owned land (if capitalized separately).", ("full",)),
    _row("1510", "Buildings — Station & Canopy", "asset", "fixed_asset", "Building and canopy structures."),
    _row("1520", "Dispensing Equipment & Underground Systems", "asset", "machinery_and_equipment", "Pumps, lines, tank-related equipment."),
    _row("1530", "Point of Sale & IT Equipment", "asset", "machinery_and_equipment", "POS, servers, networking, peripherals."),
    _row("1540", "Vehicles & Mobile Equipment", "asset", "vehicles", "Delivery and service vehicles."),
    _row(
        "1550",
        "Accumulated Depreciation — Buildings & Equipment",
        "asset",
        "accumulated_depreciation",
        "Contra-asset: accumulated depreciation (credit balance).",
    ),
    _row("1560", "Construction / Capex in Progress", "asset", "fixed_asset", "Capital projects not yet placed in service.", ("full",)),
    # —— Liabilities: trade & operating ——
    _row("2000", "Accounts Payable — Trade", "liability", "accounts_payable", "Vendor invoices — general."),
    _row("2010", "Accounts Payable — Fuel Supplier", "liability", "accounts_payable", "Wet-stock and fuel delivery payables."),
    _row("2020", "Credit Cards Payable — Company Cards", "liability", "credit_card", "Balances on corporate purchasing cards."),
    _row("2030", "Customer Deposits & Prepayments", "liability", "other_current_liability", "Customer prepayments or deposits taken."),
    # —— Liabilities: taxes & statutory ——
    _row("2100", "Sales / VAT Payable", "liability", "sales_tax_payable", "Collected sales or value-added tax remitted to authority."),
    _row("2110", "Excise / Fuel Duty Payable", "liability", "other_current_liability", "Fuel excise or carbon levies (rename per jurisdiction)."),
    _row("2120", "Withholding Tax Payable", "liability", "other_current_liability", "Employee or vendor withholding due to tax authority."),
    _row("2130", "Other Statutory Payables", "liability", "other_current_liability", "Environmental, licensing fees payable, etc.", ("full",)),
    # —— Liabilities: payroll ——
    _row("2200", "Payroll — Salaries & Wages Payable", "liability", "payroll_tax_payable", "Net pay and accrued wages owed."),
    _row("2210", "Payroll — Statutory Deductions Payable", "liability", "payroll_tax_payable", "Social security, health, pension contributions payable."),
    # —— Liabilities: accrued & debt ——
    _row("2300", "Accrued Expenses", "liability", "other_current_liability", "Accrued utilities, interest, and other period costs."),
    _row("2400", "Short-Term Loans & Bank Overdraft", "liability", "loan_payable", "Working capital facilities due within 12 months."),
    _row("2500", "Long-Term Debt", "liability", "long_term_liability", "Term loans and notes payable beyond 12 months."),
    # —— Equity ——
    _row("3000", "Owner Equity / Shareholder Capital", "equity", "owner_equity", "Paid-in capital and owner contributions."),
    _row("3100", "Retained Earnings", "equity", "retained_earnings", "Accumulated profits carried forward."),
    _row("3200", "Opening Balance Equity", "equity", "opening_balance_equity", "System opening balance offset during initial setup."),
    _row(
        "3300",
        "Dividends / Owner Drawings",
        "equity",
        "equity",
        "Distributions to owners (permanent accounts per policy).",
        ("full", "retail"),
    ),
    # —— Revenue: fuel ——
    _row("4100", "Fuel Sales — Gasoline / Petrol", "income", "sales_of_product_income", "Retail gasoline / petrol sales."),
    _row("4110", "Fuel Sales — Diesel", "income", "sales_of_product_income", "Retail diesel sales."),
    _row("4120", "Fuel Sales — Premium / Super", "income", "sales_of_product_income", "Higher-octane or premium grades."),
    _row("4130", "Fuel Sales — Other Grades / Blends", "income", "sales_of_product_income", "E85, biodiesel blends, other fuels.", ("full",)),
    _row("4140", "Fuel Sales — Fleet & Commercial (B2B)", "income", "sales_of_product_income", "Fuel sold on credit to fleet accounts.", ("full",)),
    # —— Revenue: non-fuel ——
    _row("4200", "C-Store / Convenience Sales", "income", "sales_of_product_income", "Merchandise and tobacco where permitted.", ("full",)),
    _row("4210", "Lubricants & Additives — Over-the-Counter", "income", "sales_of_product_income", "Bottled lubes and additives sold at counter.", ("full",)),
    _row("4220", "Car Wash & Services", "income", "service_fee_income", "Wash bay and ancillary services revenue.", ("full",)),
    _row("4230", "Other Operating Revenue", "income", "other_income", "Air, vacuum, commissions, misc. operating."),
    _row(
        "4300",
        "Discounts & Promotions (Contra Revenue)",
        "income",
        "discounts_refunds_given",
        "Loyalty and pump discounts (contra-revenue; net against sales per policy).",
        ("full",),
    ),
    _row("4400", "Interest & Non-Operating Income", "income", "other_income", "Bank interest, rebates, insurance recoveries."),
    # —— COGS & variance ——
    _row("5100", "Cost of Fuel Sold", "cost_of_goods_sold", "cost_of_goods_sold", "Fuel COGS (wet stock consumed) matched to fuel revenue."),
    _row("5110", "Cost of Lubricants & Fluids Sold", "cost_of_goods_sold", "supplies_materials_cogs", "Product cost for lube and fluids sold.", ("full",)),
    _row("5120", "Cost of C-Store Goods Sold", "cost_of_goods_sold", "cost_of_goods_sold", "Merchandise COGS for shop.", ("full",)),
    _row("5200", "Inventory Shrinkage — Fuel (Wet Loss / Variance)", "cost_of_goods_sold", "cost_of_goods_sold", "Tank loss, evaporation, meter variance beyond tolerance."),
    _row("5210", "Inventory Shrinkage — Shop / Other", "cost_of_goods_sold", "cost_of_goods_sold", "Theft, damage, count adjustments (non-fuel).", ("full",)),
    # —— Operating expenses ——
    _row("6100", "Utilities — Electricity", "expense", "utilities", "Power for pumps, lighting, refrigeration."),
    _row("6110", "Utilities — Water & Sewer", "expense", "utilities", "Water for wash and site use.", ("full",)),
    _row("6200", "Rent or Lease — Land & Building", "expense", "rent_or_lease_of_buildings", "Site lease or land rent."),
    _row("6210", "Lease — Equipment & Vehicles", "expense", "rent_or_lease_of_buildings", "Operating leases for equipment."),
    _row("6300", "Repairs & Maintenance — Dispensing & Site", "expense", "repair_maintenance", "Pump repair, line maintenance, forecourt upkeep."),
    _row("6310", "Repairs & Maintenance — Building & Canopy", "expense", "repair_maintenance", "Structural and cosmetic maintenance."),
    _row("6400", "Salaries & Wages", "expense", "payroll_expenses", "Gross wages before employer taxes and benefits."),
    _row("6410", "Payroll Taxes & Employer Contributions", "expense", "payroll_expenses", "Employer payroll taxes and benefits."),
    _row("6420", "Staff Training & Uniforms", "expense", "payroll_expenses", "Training, safety gear, uniforms.", ("full",)),
    _row("6500", "Insurance — Property & Business Interruption", "expense", "insurance", "Site, inventory, and business continuity coverage."),
    _row("6510", "Insurance — Liability & Environmental", "expense", "insurance", "General liability, pollution, statutory coverage."),
    _row("6600", "Bank Charges & Merchant Service Fees", "expense", "office_general_administrative_expenses", "Card interchange, acquirer fees, bank service charges."),
    _row("6610", "Cash Over / Short", "expense", "other_business_expenses", "Till variances after investigation."),
    _row("6700", "Marketing & Loyalty Programs", "expense", "advertising_promotional", "Local ads, signage, loyalty subsidies."),
    _row("6800", "Professional Fees — Legal & Accounting", "expense", "office_general_administrative_expenses", "Auditors, lawyers, consultants."),
    _row("6810", "IT & Software Subscriptions", "expense", "office_general_administrative_expenses", "SaaS, support, cybersecurity.", ("full",)),
    _row("6900", "Office & Administrative", "expense", "office_general_administrative_expenses", "Supplies, postage, small tools not capitalized."),
    _row("7000", "Security & Cash Handling Services", "expense", "other_business_expenses", "CIT, alarms, monitoring."),
    _row("7100", "Fuel Freight & Delivery In", "expense", "supplies_materials", "Transport surcharges on wet-stock deliveries."),
    _row("7200", "Licenses, Permits & Memberships", "expense", "other_business_expenses", "Station licenses, industry association dues."),
    _row("7300", "Environmental & Compliance", "expense", "other_business_expenses", "Testing, inspections, spill prevention supplies."),
    _row("7400", "Loss on Asset Disposal / Write-off", "expense", "other_business_expenses", "Net loss on sale or retirement of assets.", ("full",)),
]

# Built-in GL lines for the Loans module (principal + interest). Appended below; sorted by code in get_fuel_station_rows.
LOAN_MODULE_DEFAULT_COA_ROWS: List[Dict[str, Any]] = [
    _row(
        "1160",
        "Loans Receivable — Principal (Money Lent)",
        "loan",
        "loan_receivable",
        "Balance-sheet principal for funds you lent to others. Use as **Principal GL** on Loans → **Lent**.",
    ),
    _row(
        "2410",
        "Loans Payable — Principal (Borrowed Funds)",
        "loan",
        "loan_payable",
        "Balance-sheet principal for bank and third-party loans you owe. Use as **Principal GL** on Loans → **Borrowed**.",
    ),
    _row(
        "4410",
        "Interest Income — Loans Receivable",
        "income",
        "other_income",
        "Interest earned on lent funds. Optional **Interest GL** when splitting principal vs interest on **Lent** loans.",
    ),
    _row(
        "6620",
        "Interest Expense — Loan Borrowings",
        "expense",
        "other_business_expenses",
        "Interest paid on borrowed funds. Optional **Interest GL** when splitting principal vs interest on **Borrowed** loans.",
    ),
]

FUEL_STATION_COA_ROWS.extend(LOAN_MODULE_DEFAULT_COA_ROWS)


def _enrich_descriptions_with_erp_guide(rows: List[Dict[str, Any]]) -> None:
    """Append FSERP posting-engine hints so each guided code explains accounting use + how the app uses it."""
    guide_by_code = {str(g["account_code"]): str(g["purpose"]).strip() for g in ERP_AUTOMATION_ACCOUNT_GUIDE}
    tag = "FSERP / system use:"
    for r in rows:
        code = str(r.get("account_code", ""))
        extra = guide_by_code.get(code)
        if not extra:
            continue
        base = (r.get("description") or "").strip()
        suffix = f"{tag} {extra}"
        if suffix in base or (base and extra in base):
            continue
        r["description"] = f"{base}\n\n{suffix}" if base else suffix


_enrich_descriptions_with_erp_guide(FUEL_STATION_COA_ROWS)


def template_description_by_account_code() -> Dict[str, str]:
    """Canonical descriptions from the built-in template (after ERP guide enrichment), keyed by account_code."""
    return {
        str(r["account_code"]): (r.get("description") or "").strip()
        for r in FUEL_STATION_COA_ROWS
        if (r.get("description") or "").strip()
    }


def backfill_company_coa_descriptions(
    company_id: int,
    *,
    only_blank: bool = True,
    force_template: bool = False,
) -> Dict[str, Any]:
    """
    Copy template descriptions onto existing chart rows for this company.

    - only_blank=True: update rows whose description is empty (default).
    - force_template=True: overwrite with template text even if already set (use for admin repair only).
    """
    from api.models import ChartOfAccount

    tmpl = template_description_by_account_code()
    updated = 0
    skipped_no_template = 0
    skipped_has_text = 0
    skipped_unchanged = 0

    for coa in ChartOfAccount.objects.filter(company_id=company_id).order_by("id"):
        text = tmpl.get(str(coa.account_code).strip())
        if not text:
            skipped_no_template += 1
            continue
        current = (coa.description or "").strip()
        if only_blank and not force_template and current:
            skipped_has_text += 1
            continue
        if coa.description == text:
            skipped_unchanged += 1
            continue
        coa.description = text
        coa.save(update_fields=["description", "updated_at"])
        updated += 1

    return {
        "company_id": company_id,
        "updated": updated,
        "skipped_no_template": skipped_no_template,
        "skipped_has_text": skipped_has_text,
        "skipped_unchanged": skipped_unchanged,
    }


def ensure_loan_module_default_accounts(company_id: int) -> Dict[str, Any]:
    """
    Idempotently add standard Loans-module chart lines (1160, 2410, 4410, 6620) if missing.
    Use for existing companies seeded before these defaults existed; safe to call multiple times.
    """
    from django.utils import timezone

    from api.models import ChartOfAccount

    today = timezone.now().date()
    existing_codes = set(
        ChartOfAccount.objects.filter(company_id=company_id).values_list("account_code", flat=True)
    )
    added = 0
    for item in LOAN_MODULE_DEFAULT_COA_ROWS:
        code = item["account_code"]
        if code in existing_codes:
            continue
        ChartOfAccount.objects.create(
            company_id=company_id,
            account_code=code,
            account_name=item["account_name"],
            account_type=item["account_type"],
            account_sub_type=item.get("account_sub_type") or "",
            description=item.get("description") or "",
            parent_id=None,
            opening_balance=Decimal("0"),
            opening_balance_date=today,
            is_active=True,
        )
        added += 1
        existing_codes.add(code)
    return {
        "company_id": company_id,
        "added": added,
        "skipped": len(LOAN_MODULE_DEFAULT_COA_ROWS) - added,
        "codes": [r["account_code"] for r in LOAN_MODULE_DEFAULT_COA_ROWS],
    }


def get_fuel_station_rows(profile: ProfileName) -> List[Dict[str, Any]]:
    """Return template rows for the given profile, sorted by account code."""
    rows: List[Dict[str, Any]] = []
    for r in FUEL_STATION_COA_ROWS:
        profs: Tuple[str, ...] = r.get("profiles", ("full", "retail"))
        if profile == "full":
            rows.append(r)
        elif profile == "retail" and "retail" in profs:
            rows.append(r)
    rows.sort(key=lambda x: x["account_code"])
    return rows


def profile_account_counts() -> Dict[str, int]:
    return {
        "full": len(get_fuel_station_rows("full")),
        "retail": len(get_fuel_station_rows("retail")),
    }


def seed_fuel_station_if_empty(
    company_id: int,
    profile: ProfileName = "full",
) -> Dict[str, Any]:
    """
    Used when a new company is created: load the fuel-station template only if this
    company has no chart rows yet (avoids duplicating when accounts already exist).
    """
    from api.models import ChartOfAccount

    if ChartOfAccount.objects.filter(company_id=company_id).exists():
        return {
            "seeded": False,
            "reason": "chart_already_exists",
            "template_id": FUEL_STATION_TEMPLATE_ID,
            "total_now": ChartOfAccount.objects.filter(company_id=company_id).count(),
        }
    result = seed_fuel_station_chart(company_id, profile=profile, replace=False)
    result["seeded"] = True
    return result


def seed_fuel_station_chart(
    company_id: int,
    profile: ProfileName = "full",
    *,
    replace: bool = False,
) -> Dict[str, Any]:
    """
    Insert fuel-station template accounts for `company_id`.
    If `replace` is True, deletes all existing chart rows for the company first.
    Otherwise skips rows whose account_code already exists.
    """
    from django.utils import timezone
    from api.models import ChartOfAccount

    rows = get_fuel_station_rows(profile)
    today = timezone.now().date()
    deleted = 0

    if replace:
        deleted, _ = ChartOfAccount.objects.filter(company_id=company_id).delete()

    existing_codes = set(
        ChartOfAccount.objects.filter(company_id=company_id).values_list("account_code", flat=True)
    )

    added = 0
    skipped = 0
    for item in rows:
        code = item["account_code"]
        if code in existing_codes:
            skipped += 1
            continue
        ChartOfAccount.objects.create(
            company_id=company_id,
            account_code=code,
            account_name=item["account_name"],
            account_type=item["account_type"],
            account_sub_type=item.get("account_sub_type") or "",
            description=item.get("description") or "",
            parent_id=None,
            opening_balance=Decimal("0"),
            opening_balance_date=today,
            is_active=True,
        )
        added += 1
        existing_codes.add(code)

    return {
        "template_id": FUEL_STATION_TEMPLATE_ID,
        "profile": profile,
        "added": added,
        "skipped": skipped,
        "removed": deleted,
        "total_now": ChartOfAccount.objects.filter(company_id=company_id).count(),
    }
