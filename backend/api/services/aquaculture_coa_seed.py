"""
Built-in Chart of Accounts lines for the Aquaculture module.

Seeded when a company enables Aquaculture (idempotent: skips any account_code that already exists).
Codes use the 424x revenue band (between fuel template 4230 and 4300) and 6711+ expense band
(after marketing 6700, before professional fees 6800), plus 1580 asset and 3190 equity clearing.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Iterable

from django.db import transaction
from django.utils import timezone

from api.models import ChartOfAccount, Company

# (account_code, account_name, account_type, account_sub_type, description)
AQUACULTURE_COA_ROWS: tuple[tuple[str, str, str, str, str], ...] = (
    (
        "1580",
        "Aquaculture — Pond & Production Equipment (Capitalizable)",
        "asset",
        "machinery_and_equipment",
        "Capitalize durable pond equipment, aerators, nets, and similar when following a fixed-asset policy.",
    ),
    (
        "3190",
        "Aquaculture — Pond Profit Clearing (Equity)",
        "equity",
        "retained_earnings",
        "Common credit side when posting pond profit transfers from management P&L into the books; pair with bank or cash.",
    ),
    (
        "4240",
        "Aquaculture Revenue — Fish Harvest Sales",
        "income",
        "sales_of_product_income",
        "Revenue from table-size / harvest fish sales (see Aquaculture income_type fish_harvest_sale).",
    ),
    (
        "4241",
        "Aquaculture Revenue — Fingerling & Fry Sales",
        "income",
        "sales_of_product_income",
        "Revenue from seed / fry sales (income_type fingerling_sale).",
    ),
    (
        "4242",
        "Aquaculture Revenue — Processing & Value-Add",
        "income",
        "service_fee_income",
        "Processing, filleting, smoking, or other value-added services (income_type processing_value_add).",
    ),
    (
        "4243",
        "Aquaculture Revenue — Other",
        "income",
        "other_income",
        "Other aquaculture-related income (income_type other_income).",
    ),
    (
        "4244",
        "Aquaculture Revenue — Empty Sacks & Scrap Sales",
        "income",
        "other_income",
        "Empty feed sacks, used or rejected materials, and used or scrap equipment sold from ponds "
        "(income_type empty_feed_sack_sale, used_material_sale, rejected_material_sale, used_equipment_sale).",
    ),
    (
        "6711",
        "Aquaculture Expense — Lease & Pond Rights",
        "expense",
        "rent_or_lease_of_buildings",
        "Lease money and pond rental (maps to aquaculture expense_category lease).",
    ),
    (
        "6712",
        "Aquaculture Expense — Labor & Wages",
        "expense",
        "payroll_expenses",
        "Pond workers and casual labor (worker_salary).",
    ),
    (
        "6713",
        "Aquaculture Expense — Soil Cut & Earthworks",
        "expense",
        "repair_maintenance",
        "Soil cut and earthworks for pond construction or maintenance (soilcut).",
    ),
    (
        "6714",
        "Aquaculture Expense — Pond Preparation",
        "expense",
        "supplies_materials",
        "Liming, fertilization, drying, and preparation before stocking (pond_preparation).",
    ),
    (
        "6715",
        "Aquaculture Expense — Fry & Fingerlings",
        "expense",
        "supplies_materials",
        "Stocking purchases (fry_stocking).",
    ),
    (
        "6716",
        "Aquaculture Expense — Feed",
        "expense",
        "supplies_materials",
        "Commercial feed purchases (feed_purchase).",
    ),
    (
        "6717",
        "Aquaculture Expense — Electricity (Ponds)",
        "expense",
        "utilities",
        "Aeration and pond electricity (electricity).",
    ),
    (
        "6718",
        "Aquaculture Expense — Equipment & Repairs",
        "expense",
        "repair_maintenance",
        "Equipment, small tools, and repairs not capitalized to 1580 (equipment).",
    ),
    (
        "6719",
        "Aquaculture Expense — Harvesting & Fisherman Charges",
        "expense",
        "other_business_expenses",
        "Contract harvest and fisherman bills (fisherman).",
    ),
    (
        "6720",
        "Aquaculture Expense — Transportation",
        "expense",
        "other_business_expenses",
        "Fish haulage and logistics (transportation).",
    ),
    (
        "6721",
        "Aquaculture Expense — Medicine & Veterinary",
        "expense",
        "supplies_materials",
        "Medicine, vaccine, and veterinary supplies (medicine_purchase).",
    ),
    (
        "6725",
        "Aquaculture Expense — Miscellaneous & other operating",
        "expense",
        "other_business_expenses",
        "Miscellaneous pond costs (code other): boats, wiring, lighting, cameras, engines, aerators, nets, "
        "repairs, bikes, labour, site consumables, and items not mapped to a dedicated category.",
    ),
    (
        "1581",
        "Aquaculture — Biological Inventory (Live Fish in Ponds)",
        "asset",
        "other_current_assets",
        "Live fish biomass in ponds when capitalized; reduced on mortality (paired with 6726) or harvest, "
        "increased on positive count reconciliation (paired with 4244).",
    ),
    (
        "6726",
        "Aquaculture — Mortality, Predation & Shrinkage",
        "expense",
        "other_business_expenses",
        "Deaths, snake or predator losses, birds, theft, escapes, and similar shrinkage (Dr expense / Cr 1581).",
    ),
    (
        "4244",
        "Aquaculture — Biological Inventory Count Gain",
        "income",
        "other_income",
        "Upward physical count vs books (Dr 1581 / Cr this account).",
    ),
)


def ensure_aquaculture_chart_accounts(company_id: int) -> int:
    """
    Create missing aquaculture COA rows for the company. Returns number of rows inserted.
    Safe to call multiple times.
    """
    if not Company.objects.filter(pk=company_id, is_deleted=False).exists():
        return 0
    today = timezone.now().date()
    existing = set(ChartOfAccount.objects.filter(company_id=company_id).values_list("account_code", flat=True))
    created = 0
    rows: Iterable[tuple[str, str, str, str, str]] = AQUACULTURE_COA_ROWS
    with transaction.atomic():
        for code, name, atype, stype, desc in rows:
            if code in existing:
                continue
            ChartOfAccount.objects.create(
                company_id=company_id,
                account_code=code,
                account_name=name,
                account_type=atype,
                account_sub_type=stype,
                description=desc,
                parent_id=None,
                opening_balance=Decimal("0"),
                opening_balance_date=today,
                is_active=True,
            )
            existing.add(code)
            created += 1
    return created


def seed_aquaculture_coa_for_all_enabled_companies() -> int:
    """Data migration helper: total rows created across tenants that already have Aquaculture on."""
    total = 0
    for cid in Company.objects.filter(is_deleted=False, aquaculture_enabled=True).values_list("id", flat=True):
        total += ensure_aquaculture_chart_accounts(int(cid))
    return total
