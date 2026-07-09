"""Company-defined reporting categories for Aquaculture and Fuel Station (income + expense)."""

from __future__ import annotations

import re
from typing import Any

from django.db.models import Q

from api.services.aquaculture_constants import (
    EXPENSE_CATEGORY_CODES,
    INCOME_TYPE_CODES,
    MANUAL_AQUACULTURE_EXPENSE_CATEGORY_CODES,
)

APP_AQUACULTURE = "aquaculture"
APP_FUEL_STATION = "fuel_station"
KIND_EXPENSE = "expense"
KIND_INCOME = "income"

_AUTO_CATEGORY_PREFIX: dict[tuple[str, str], str] = {
    (APP_AQUACULTURE, KIND_EXPENSE): "aqe",
    (APP_AQUACULTURE, KIND_INCOME): "aqi",
    (APP_FUEL_STATION, KIND_EXPENSE): "fse",
    (APP_FUEL_STATION, KIND_INCOME): "fsi",
}

FUEL_STATION_EXPENSE_MAP_TARGETS: tuple[tuple[str, str], ...] = (
    ("operating", "Operating & admin (general)"),
    ("payroll", "Payroll & wages"),
    ("rent", "Rent & lease"),
    ("insurance", "Insurance"),
    ("bank_charges", "Bank & merchant fees"),
    ("marketing", "Marketing & loyalty"),
    ("security", "Security & cash handling"),
    ("office_supplies", "Office & admin supplies"),
    ("donations", "Donations & social support"),
    ("licenses_permits", "Licenses & permits"),
    ("environmental", "Environmental & compliance"),
    ("freight", "Freight & hauling"),
    ("asset_disposal", "Asset disposal loss"),
    ("cost_of_sales", "Fuel shrink & wet-stock variance"),
    ("shop_shrink", "Shop inventory shrinkage"),
    ("shop_cogs", "Shop cost of goods sold"),
    ("maintenance", "Forecourt & equipment maintenance"),
    ("building_maintenance", "Building & canopy repairs"),
    ("utilities", "Utilities & generator fuel"),
    ("water_sewer", "Water & sewer"),
    ("other", "Other / miscellaneous"),
)
FUEL_STATION_INCOME_MAP_TARGETS: tuple[tuple[str, str], ...] = (
    ("fuel_revenue", "Fuel sales revenue (retail)"),
    ("diesel_revenue", "Diesel sales revenue"),
    ("premium_fuel_revenue", "Premium / super fuel revenue"),
    ("other_fuel_revenue", "Other fuel grades & blends"),
    ("fleet_revenue", "Fleet & commercial (B2B) fuel"),
    ("shop_revenue", "Shop / agro retail revenue"),
    ("services_revenue", "Car wash & services revenue"),
    ("other", "Other operating revenue"),
)

FUEL_STATION_EXPENSE_MAP_HINTS: dict[str, str] = {
    "operating": (
        "General station overhead — security contracts, casual day labor, misc admin, and catch-all site costs. "
        "Default GL 6920."
    ),
    "payroll": "Gross wages and salaries for station staff. Default GL 6400.",
    "rent": "Site lease, land rent, and building occupancy. Default GL 6200.",
    "insurance": "Property, inventory, and business-interruption coverage. Default GL 6500.",
    "bank_charges": "Card interchange, acquirer fees, and bank service charges. Default GL 6600.",
    "marketing": "Local advertising, signage, and loyalty programs. Default GL 6700.",
    "security": "CIT, alarms, monitoring, and cash-handling services. Default GL 7000.",
    "office_supplies": (
        "Postage, stationery, and small office tools only — not general station operating. Default GL 6900."
    ),
    "donations": "Charitable giving and local social support from station cash. Default GL 6910.",
    "licenses_permits": "Business licenses, environmental permits, and regulatory fees. Default GL 7200.",
    "environmental": "Tank testing, remediation, and environmental compliance costs. Default GL 7300.",
    "freight": "Fuel delivery freight and hauling charges. Default GL 7100.",
    "asset_disposal": "Loss on disposal of equipment or fixtures. Default GL 7400.",
    "cost_of_sales": "Fuel wet-stock shrink, variance, and dispensing losses. Default GL 5200.",
    "shop_shrink": "Theft, damage, and count adjustments for shop inventory. Default GL 5210.",
    "shop_cogs": "Direct cost of shop goods sold at the station. Default GL 5120.",
    "maintenance": "Pump service, forecourt repairs, tank maintenance, and dispensing equipment. Default GL 6300.",
    "building_maintenance": "Structural, canopy, and cosmetic building upkeep. Default GL 6310.",
    "utilities": "Electricity, generator diesel, and telecom for the site. Default GL 6100.",
    "water_sewer": "Water for wash bays and site use; sewer where billed separately. Default GL 6110.",
    "other": "One-off or uncategorized station costs. Default GL 6990.",
}
FUEL_STATION_INCOME_MAP_HINTS: dict[str, str] = {
    "fuel_revenue": "General retail petrol and fuel dispenser sales. Default GL 4100.",
    "diesel_revenue": "Retail diesel sales from dispensers. Default GL 4110.",
    "premium_fuel_revenue": "Higher-octane or premium grade fuel sales. Default GL 4120.",
    "other_fuel_revenue": "E85, biodiesel blends, and other fuel grades. Default GL 4130.",
    "fleet_revenue": "Fuel sold on credit to fleet and commercial accounts. Default GL 4140.",
    "shop_revenue": "Convenience store, agro-input shop, and non-fuel retail. Default GL 4200.",
    "services_revenue": "Car wash, air, commissions, and ancillary services. Default GL 4220.",
    "other": "Air, vacuum, commissions, and miscellaneous operating revenue. Default GL 4230.",
}

AQUACULTURE_EXPENSE_MAP_GROUPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Land & rights", ("lease",)),
    ("Labor & payroll", ("worker_salary", "meals_entertainment")),
    (
        "Pond development & care",
        ("soilcut", "pond_preparation", "pond_care_products", "fry_stocking"),
    ),
    ("Feed", ("feed_purchase", "feed_consumed")),
    ("Medicine & health", ("medicine_purchase", "medicine_consumed", "sampling_lab")),
    ("Power, generator & water", ("electricity", "generator_fuel", "water")),
    ("Equipment, repairs & depreciation", ("equipment", "repair_maintenance", "depreciation")),
    ("Shop, office & supplies", ("shop_supplies", "office_supplies", "netting_gear")),
    ("Transport & live haul", ("transportation", "fish_haul_supplies")),
    ("Security & compliance", ("security", "insurance", "licenses_permits", "predator_control")),
    ("Finance & professional", ("bank_charges", "professional_fees", "communication")),
    ("Mortality & shrinkage", ("mortality",)),
    ("Operations", ("fisherman", "day_labor", "other")),
    ("System (automatic)", ("vendor_bill_pond",)),
)
AQUACULTURE_INCOME_MAP_GROUPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Fish & production sales", ("fish_harvest_sale", "fingerling_sale", "inter_pond_fingerling_transfer", "processing_value_add")),
    (
        "By-products & scrap",
        ("empty_feed_sack_sale", "used_material_sale", "rejected_material_sale", "used_equipment_sale"),
    ),
    ("Inventory reconciliation", ("biological_count_gain",)),
    (
        "Grants & other revenue",
        ("subsidy_grant", "commission_income", "pond_rental_income", "other_income"),
    ),
)
FUEL_STATION_EXPENSE_MAP_GROUPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "Payroll & occupancy",
        ("payroll", "rent", "insurance"),
    ),
    (
        "Operating & admin",
        (
            "operating",
            "office_supplies",
            "bank_charges",
            "marketing",
            "security",
            "donations",
            "licenses_permits",
            "environmental",
            "freight",
            "asset_disposal",
        ),
    ),
    ("Cost of sales", ("cost_of_sales", "shop_shrink", "shop_cogs")),
    ("Facility & upkeep", ("maintenance", "building_maintenance", "utilities", "water_sewer")),
    ("Other", ("other",)),
)
FUEL_STATION_INCOME_MAP_GROUPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "Fuel sales",
        ("fuel_revenue", "diesel_revenue", "premium_fuel_revenue", "other_fuel_revenue", "fleet_revenue"),
    ),
    ("Shop & services", ("shop_revenue", "services_revenue")),
    ("Other income", ("other",)),
)

_AQUACULTURE_EXPENSE_SUPPLEMENTAL_HINTS: dict[str, str] = {
    "soilcut": "Earthworks and soil removal when preparing new ponds or expanding existing ones.",
    "pond_preparation": (
        "Lime, fertiliser, pond drying, and other one-time preparation before stocking a new crop."
    ),
    "pond_care_products": (
        "Ongoing pond water-care products: probiotics, conditioners, and treatment chemicals that are not "
        "classified as veterinary medicine."
    ),
    "fry_stocking": (
        "Fry and fingerling purchases — prefer vendor bills with pond-tagged fish-type lines rather than manual costs."
    ),
    "electricity": "Grid power, prepaid meters, and site electrical costs for pumps and aerators.",
    "generator_fuel": "Diesel and fuel for on-site generators when grid power is unavailable.",
    "water": "Tube-well pumping, irrigation water, and water-delivery charges for pond sites.",
    "depreciation": "Depreciation on pond fixed assets — usually auto-posted from Fixed Assets (GL 6320).",
    "netting_gear": "Nets, cages, bird netting, and pond gear — distinct from general shop inventory.",
    "sampling_lab": "Water-quality and fish-health lab tests — not veterinary medicine purchases.",
    "security": "Watchman services, guard contracts, and site security cash costs.",
    "predator_control": "Predator fencing, traps, and bird deterrents — preventive cash costs.",
    "insurance": "Pond, stock, and liability insurance premiums.",
    "bank_charges": "Bank fees and mobile-wallet charges on pond transactions.",
    "licenses_permits": "Fisheries permits and regulatory licenses for the site.",
    "professional_fees": "Accounting, audit, legal, and consulting fees.",
    "communication": "Mobile airtime and internet for pond site offices.",
    "fisherman": "Harvest crew or contract fisherman payments tied to pond operations.",
    "day_labor": (
        "Daily hired workers and short-term labor on vendor bills — not employees. "
        "Same ordinary AP flow as electricity or repairs: bill, tag pond, pay."
    ),
    "transportation": "Fish hauling vehicles, fuel, drivers, and logistics between sites or to market.",
    "fish_haul_supplies": (
        "Ice blocks, oxygen cylinders, saline, and live-haul consumables for moving fish between ponds or to buyers."
    ),
    "office_supplies": "Paper, pens, printer supplies, and small admin items for the pond site office.",
    "meals_entertainment": "Site meals for workers and modest entertainment — not payroll wages.",
    "worker_salary": "Permanent staff wages only — use HR Payroll, not vendor bills or custom labels.",
}
AQUACULTURE_INCOME_TYPE_HINTS: dict[str, str] = {
    "fish_harvest_sale": "Primary table-fish or market harvest revenue from the pond.",
    "fingerling_sale": "Sales of fry or fingerlings produced or held at the pond.",
    "inter_pond_fingerling_transfer": (
        "Internal nursing-to-grow-out fingerling transfer at fully loaded cost (nursing income)."
    ),
    "processing_value_add": "Smoked, filleted, or otherwise processed fish sold at a premium.",
    "empty_feed_sack_sale": (
        "Non-biological byproduct income for this pond — empty sacks sold after feed consumption. "
        "Included in pond P&L revenue (with fish harvest sales); does not reduce fish biomass or bio-asset GL 1581."
    ),
    "used_material_sale": "Scrap materials (netting, drums, etc.) — non-biological pond revenue.",
    "rejected_material_sale": "Rejected or waste material sold off — non-biological pond revenue.",
    "used_equipment_sale": "Used or scrap equipment sold — non-biological pond revenue.",
    "biological_count_gain": (
        "Upward physical fish count vs books when posted from the fish stock ledger (Dr 1581 / Cr 4244). "
        "Not a cash sale — use for custom labels tied to inventory reconciliation income."
    ),
    "other_income": "Tours, consulting, or other pond income that does not fit a named type above.",
    "subsidy_grant": "Government aquaculture subsidies, grants, and development-program payments.",
    "commission_income": "Sales commissions, brokerage, and agent fees earned on pond sales.",
    "pond_rental_income": "Income from renting ponds, facilities, or equipment to third parties.",
}

FUEL_STATION_EXPENSE_MAP_CODES: frozenset[str] = frozenset(c for c, _ in FUEL_STATION_EXPENSE_MAP_TARGETS)
FUEL_STATION_INCOME_MAP_CODES: frozenset[str] = frozenset(c for c, _ in FUEL_STATION_INCOME_MAP_TARGETS)


def _tenant_category_entity_filter(
    qs,
    *,
    station_id: int | None = None,
    pond_id: int | None = None,
    head_office: bool = False,
):
    """Include company-wide categories plus rows scoped to the given entity."""
    company_wide = Q(
        station_id__isnull=True,
        aquaculture_pond_id__isnull=True,
        head_office_only=False,
    )
    if head_office:
        return qs.filter(Q(head_office_only=True) | company_wide)
    if station_id:
        return qs.filter(company_wide | Q(station_id=int(station_id))).exclude(head_office_only=True)
    if pond_id:
        return qs.filter(company_wide | Q(aquaculture_pond_id=int(pond_id))).exclude(
            head_office_only=True
        )
    return qs.filter(company_wide)


def _parse_entity_scope_params(
    request,
) -> tuple[int | None, int | None, bool, str | None]:
    """Parse optional station_id / pond_id / head_office query params (mutually exclusive)."""
    station_raw = (request.GET.get("station_id") or "").strip()
    pond_raw = (request.GET.get("pond_id") or "").strip()
    head_raw = (request.GET.get("head_office") or "").strip().lower()
    station_id: int | None = None
    pond_id: int | None = None
    head_office = head_raw in ("1", "true", "yes")
    if station_raw:
        try:
            station_id = int(station_raw)
        except (TypeError, ValueError):
            return None, None, False, "station_id must be a positive integer"
        if station_id <= 0:
            return None, None, False, "station_id must be a positive integer"
    if pond_raw:
        try:
            pond_id = int(pond_raw)
        except (TypeError, ValueError):
            return None, None, False, "pond_id must be a positive integer"
        if pond_id <= 0:
            return None, None, False, "pond_id must be a positive integer"
    if sum(bool(x) for x in (station_id, pond_id, head_office)) > 1:
        return None, None, False, "station_id, pond_id, and head_office are mutually exclusive"
    return station_id, pond_id, head_office, None


def _parse_entity_scope_body(
    body: dict,
    *,
    company_id: int,
    application: str,
) -> tuple[int | None, int | None, bool, str | None]:
    """Resolve optional station_id / aquaculture_pond_id / head_office_only on create/update."""
    from api.models import AquaculturePond, Station

    station_id: int | None = None
    pond_id: int | None = None
    head_office_only = bool(body.get("head_office_only")) if "head_office_only" in body else False
    if "station_id" in body:
        raw = body.get("station_id")
        if raw is None or str(raw).strip() == "":
            station_id = None
        else:
            try:
                station_id = int(raw)
            except (TypeError, ValueError):
                return None, None, False, "station_id must be a positive integer"
            if station_id <= 0:
                return None, None, False, "station_id must be a positive integer"
            if not Station.objects.filter(pk=station_id, company_id=company_id).exists():
                return None, None, False, "station_id not found for this company"
            head_office_only = False
    if "aquaculture_pond_id" in body:
        raw = body.get("aquaculture_pond_id")
        if raw is None or str(raw).strip() == "":
            pond_id = None
        else:
            try:
                pond_id = int(raw)
            except (TypeError, ValueError):
                return None, None, False, "aquaculture_pond_id must be a positive integer"
            if pond_id <= 0:
                return None, None, False, "aquaculture_pond_id must be a positive integer"
            if not AquaculturePond.objects.filter(pk=pond_id, company_id=company_id).exists():
                return None, None, False, "aquaculture_pond_id not found for this company"
            head_office_only = False
    if station_id and pond_id:
        return None, None, False, "station_id and aquaculture_pond_id are mutually exclusive"
    if head_office_only and (station_id or pond_id):
        return None, None, False, "head_office_only cannot be combined with station_id or aquaculture_pond_id"
    if application == APP_AQUACULTURE and station_id:
        return None, None, False, "aquaculture categories cannot be scoped to a station — use aquaculture_pond_id"
    if application == APP_FUEL_STATION and pond_id:
        return None, None, False, "fuel station categories cannot be scoped to a pond — use station_id"
    return station_id, pond_id, head_office_only, None


def next_auto_tenant_reporting_category_code(company_id: int, application: str, kind: str) -> str:
    """Lowest free compact code per app/kind (aqe001, fse002, …); reuses gaps after deletes."""
    from api.models import TenantReportingCategory
    from api.services.reference_code import first_free_suffix

    prefix = _AUTO_CATEGORY_PREFIX[(application, kind)]
    pat = re.compile(rf"^{re.escape(prefix)}(\d+)$", re.IGNORECASE)
    used: set[int] = set()
    for raw in TenantReportingCategory.objects.filter(
        company_id=company_id, application=application, kind=kind
    ).values_list("code", flat=True):
        m = pat.match((raw or "").strip())
        if m:
            used.add(int(m.group(1)))
    n = first_free_suffix(used)
    return f"{prefix}{n:03d}"


def normalize_category_code(raw: str | None) -> tuple[str | None, str | None]:
    if raw is None:
        return None, "code is required"
    s = str(raw).strip().lower().replace(" ", "_").replace("-", "_")
    s = re.sub(r"[^a-z0-9_]", "", s)
    if not s:
        return None, "code is required"
    if len(s) > 64:
        return None, "code must be at most 64 characters"
    if not re.match(r"^[a-z][a-z0-9_]*$", s):
        return None, "code must start with a letter and contain only lowercase letters, digits, and underscores"
    return s, None


def _row(
    company_id: int, application: str, kind: str, code: str, *, active_only: bool = True
) -> Any | None:
    from api.models import TenantReportingCategory

    qs = TenantReportingCategory.objects.filter(
        company_id=company_id,
        application=application,
        kind=kind,
        code__iexact=code,
    )
    if active_only:
        qs = qs.filter(is_active=True)
    return qs.first()


def tenant_expense_row(company_id: int, application: str, code: str) -> Any | None:
    return _row(company_id, application, KIND_EXPENSE, code, active_only=True)


def tenant_income_row(company_id: int, application: str, code: str) -> Any | None:
    return _row(company_id, application, KIND_INCOME, code, active_only=True)


def tenant_expense_row_for_stored_code(company_id: int, application: str, code: str) -> Any | None:
    """Resolve a category code saved on historical transactions (includes inactive rows)."""
    return _row(company_id, application, KIND_EXPENSE, code, active_only=False)


def tenant_income_row_for_stored_code(company_id: int, application: str, code: str) -> Any | None:
    return _row(company_id, application, KIND_INCOME, code, active_only=False)


def resolve_aquaculture_expense_to_builtin(company_id: int, stored_code: str) -> str:
    s = (stored_code or "").strip()
    if s in EXPENSE_CATEGORY_CODES:
        return s
    r = tenant_expense_row_for_stored_code(company_id, APP_AQUACULTURE, s)
    if r and (r.maps_to_code or "").strip() in EXPENSE_CATEGORY_CODES:
        return (r.maps_to_code or "").strip()
    return s


def resolve_aquaculture_income_to_builtin(company_id: int, stored_code: str) -> str:
    s = (stored_code or "").strip()
    if s in INCOME_TYPE_CODES:
        return s
    r = tenant_income_row_for_stored_code(company_id, APP_AQUACULTURE, s)
    if r and (r.maps_to_code or "").strip() in INCOME_TYPE_CODES:
        return (r.maps_to_code or "").strip()
    return s


def aquaculture_expense_label(company_id: int, stored_code: str) -> str:
    from api.services.aquaculture_constants import EXPENSE_CATEGORY_LABELS

    s = (stored_code or "").strip()
    if s in EXPENSE_CATEGORY_LABELS:
        return EXPENSE_CATEGORY_LABELS[s]
    r = tenant_expense_row_for_stored_code(company_id, APP_AQUACULTURE, s)
    if r:
        return (r.label or r.code).strip()
    return s or "—"


def aquaculture_income_label(company_id: int, stored_code: str) -> str:
    from api.services.aquaculture_constants import INCOME_TYPE_LABELS

    s = (stored_code or "").strip()
    if s in INCOME_TYPE_LABELS:
        return INCOME_TYPE_LABELS[s]
    r = tenant_income_row_for_stored_code(company_id, APP_AQUACULTURE, s)
    if r:
        return (r.label or r.code).strip()
    return s or "—"


def income_type_is_non_biological_for_company(company_id: int, stored_code: str) -> bool:
    from api.services.aquaculture_constants import NON_BIOLOGICAL_POND_SALE_INCOME_TYPES

    b = resolve_aquaculture_income_to_builtin(company_id, stored_code)
    return b in NON_BIOLOGICAL_POND_SALE_INCOME_TYPES


def manual_aquaculture_expense_category_change_allowed_for_company(
    *,
    company_id: int,
    old_category: str | None,
    new_category: str,
) -> tuple[bool, str | None]:
    from api.services.aquaculture_constants import manual_aquaculture_expense_category_change_allowed

    if new_category in MANUAL_AQUACULTURE_EXPENSE_CATEGORY_CODES:
        return True, None
    r = tenant_expense_row(company_id, APP_AQUACULTURE, new_category)
    if r:
        return True, None
    if old_category == new_category:
        return True, None
    return manual_aquaculture_expense_category_change_allowed(
        old_category=old_category, new_category=new_category
    )


def normalize_expense_category_for_company(company_id: int, raw: str | None) -> tuple[str | None, str | None]:
    from api.services.aquaculture_constants import normalize_expense_category

    if raw is None:
        return None, "expense_category is required"
    s = str(raw).strip().lower().replace(" ", "_")
    if not s:
        return None, "expense_category is required"
    if len(s) > 64:
        return None, "expense_category must be at most 64 characters"
    if s in EXPENSE_CATEGORY_CODES:
        return normalize_expense_category(raw)
    if tenant_expense_row(company_id, APP_AQUACULTURE, s):
        return s, None
    return None, f"Unknown expense_category: {raw!r}. Use a known category code or a company-defined type."


def normalize_income_type_for_company(company_id: int, raw: str | None) -> tuple[str | None, str | None]:
    if raw is None or str(raw).strip() == "":
        return "fish_harvest_sale", None
    s = str(raw).strip().lower().replace(" ", "_")
    if len(s) > 64:
        return None, "income_type must be at most 64 characters"
    if s in INCOME_TYPE_CODES:
        return s, None
    if tenant_income_row(company_id, APP_AQUACULTURE, s):
        return s, None
    return None, f"Unknown income_type: {raw!r}. Use a known income type code or a company-defined type."


def validate_maps_to(
    *,
    application: str,
    kind: str,
    maps_to_code: str,
    previous_maps_to_code: str | None = None,
) -> str | None:
    m = (maps_to_code or "").strip()
    if not m:
        return "maps_to_code is required"
    if application == APP_AQUACULTURE:
        if kind == KIND_EXPENSE:
            if m not in EXPENSE_CATEGORY_CODES:
                return "maps_to_code must be a built-in aquaculture expense category code"
            from api.services.aquaculture_bill_defaults import (
                TENANT_BILL_AQUACULTURE_EXPENSE_BLOCKED_MAPS,
            )

            if m in TENANT_BILL_AQUACULTURE_EXPENSE_BLOCKED_MAPS:
                prev = (previous_maps_to_code or "").strip()
                if prev and m == prev:
                    return None
                return (
                    f'Rollup "{m}" cannot be used for custom expense labels '
                    "(not available on vendor bills). For day labor use Day & contract labor; "
                    "for staff wages use HR Payroll."
                )
        if kind == KIND_INCOME and m not in INCOME_TYPE_CODES:
            return "maps_to_code must be a built-in aquaculture income type code"
        return None
    if application == APP_FUEL_STATION:
        if kind == KIND_EXPENSE and m not in FUEL_STATION_EXPENSE_MAP_CODES:
            return "maps_to_code must be a valid fuel-station expense rollup code"
        if kind == KIND_INCOME and m not in FUEL_STATION_INCOME_MAP_CODES:
            return "maps_to_code must be a valid fuel-station income rollup code"
        return None
    return "Unknown application"


def validate_tenant_code_not_builtin_conflict(*, application: str, kind: str, code: str) -> str | None:
    if application == APP_AQUACULTURE and kind == KIND_EXPENSE and code in EXPENSE_CATEGORY_CODES:
        return "code must not match a built-in aquaculture expense category"
    if application == APP_AQUACULTURE and kind == KIND_INCOME and code in INCOME_TYPE_CODES:
        return "code must not match a built-in aquaculture income type"
    return None


def fuel_station_reporting_category_for_journal(
    company_id: int, category_id: int | None
) -> Any | None:
    from api.models import TenantReportingCategory

    if not category_id:
        return None
    return (
        TenantReportingCategory.objects.filter(
            pk=int(category_id),
            company_id=company_id,
            application=APP_FUEL_STATION,
            is_active=True,
        )
        .filter(Q(kind=KIND_EXPENSE) | Q(kind=KIND_INCOME))
        .first()
    )


def _group_lookup(groups: tuple[tuple[str, tuple[str, ...]], ...]) -> dict[str, str]:
    out: dict[str, str] = {}
    for group, codes in groups:
        for code in codes:
            out[code] = group
    return out


def _sort_map_targets(rows: list[dict], group_order: tuple[str, ...]) -> list[dict]:
    order_idx = {g: i for i, g in enumerate(group_order)}

    def _key(row: dict) -> tuple[int, str]:
        group = str(row.get("group") or "")
        return (order_idx.get(group, 999), str(row.get("label") or ""))

    return sorted(rows, key=_key)


def list_map_target_choices(*, application: str, kind: str, company_id: int | None = None) -> list[dict]:
    if application == APP_AQUACULTURE:
        from api.services.aquaculture_constants import (
            AQUACULTURE_EXPENSE_CATEGORY_CHOICES,
            AQUACULTURE_INCOME_TYPE_CHOICES,
            EXPENSE_CATEGORY_EXTRA_HELP,
            NON_BIOLOGICAL_POND_SALE_INCOME_TYPES,
            coa_account_code_for_aquaculture_expense_category,
        )

        if kind == KIND_EXPENSE:
            from api.services.aquaculture_bill_defaults import (
                TENANT_BILL_AQUACULTURE_EXPENSE_BLOCKED_MAPS,
            )

            groups = _group_lookup(AQUACULTURE_EXPENSE_MAP_GROUPS)
            group_order = tuple(g for g, _ in AQUACULTURE_EXPENSE_MAP_GROUPS)
            rows: list[dict] = []
            for code, label in AQUACULTURE_EXPENSE_CATEGORY_CHOICES:
                if code in TENANT_BILL_AQUACULTURE_EXPENSE_BLOCKED_MAPS:
                    continue
                hint = EXPENSE_CATEGORY_EXTRA_HELP.get(code) or _AQUACULTURE_EXPENSE_SUPPLEMENTAL_HINTS.get(code)
                row: dict = {
                    "id": code,
                    "label": label,
                    "group": groups.get(code),
                    "hint": hint,
                    "manual_create_allowed": code in MANUAL_AQUACULTURE_EXPENSE_CATEGORY_CODES,
                }
                if company_id:
                    row["coa_code"] = coa_account_code_for_aquaculture_expense_category(
                        code, company_id=company_id
                    )
                rows.append(row)
            return _sort_map_targets(rows, group_order)

        groups = _group_lookup(AQUACULTURE_INCOME_MAP_GROUPS)
        group_order = tuple(g for g, _ in AQUACULTURE_INCOME_MAP_GROUPS)
        rows = [
            {
                "id": code,
                "label": label,
                "group": groups.get(code),
                "hint": AQUACULTURE_INCOME_TYPE_HINTS.get(code),
                "non_biological_sale": code in NON_BIOLOGICAL_POND_SALE_INCOME_TYPES,
            }
            for code, label in AQUACULTURE_INCOME_TYPE_CHOICES
        ]
        return _sort_map_targets(rows, group_order)

    if application == APP_FUEL_STATION:
        if kind == KIND_EXPENSE:
            from api.services.fuel_station_coa_constants import (
                coa_account_code_for_fuel_station_expense_rollup,
            )

            groups = _group_lookup(FUEL_STATION_EXPENSE_MAP_GROUPS)
            group_order = tuple(g for g, _ in FUEL_STATION_EXPENSE_MAP_GROUPS)
            rows = [
                {
                    "id": code,
                    "label": label,
                    "group": groups.get(code),
                    "hint": FUEL_STATION_EXPENSE_MAP_HINTS.get(code),
                    "coa_code": coa_account_code_for_fuel_station_expense_rollup(
                        code, company_id=company_id
                    ),
                }
                for code, label in FUEL_STATION_EXPENSE_MAP_TARGETS
            ]
            return _sort_map_targets(rows, group_order)
        from api.services.fuel_station_coa_constants import coa_account_code_for_fuel_station_income_rollup

        groups = _group_lookup(FUEL_STATION_INCOME_MAP_GROUPS)
        group_order = tuple(g for g, _ in FUEL_STATION_INCOME_MAP_GROUPS)
        rows = [
            {
                "id": code,
                "label": label,
                "group": groups.get(code),
                "hint": FUEL_STATION_INCOME_MAP_HINTS.get(code),
                "coa_code": coa_account_code_for_fuel_station_income_rollup(
                    code, company_id=company_id
                ),
            }
            for code, label in FUEL_STATION_INCOME_MAP_TARGETS
        ]
        return _sort_map_targets(rows, group_order)
    return []


def merged_aquaculture_expense_category_list_for_api(
    company_id: int,
    *,
    pond_id: int | None = None,
    head_office: bool = False,
) -> list[dict]:
    from api.models import ChartOfAccount, TenantReportingCategory
    from api.services.aquaculture_bill_defaults import (
        BILL_AQUACULTURE_EXPENSE_CATEGORY_CODES,
        TENANT_BILL_AQUACULTURE_EXPENSE_BLOCKED_MAPS,
        chart_account_id_for_aquaculture_expense_category,
    )
    from api.services.aquaculture_constants import (
        AQUACULTURE_EXPENSE_CATEGORY_CHOICES,
        EXPENSE_CATEGORY_EXTRA_HELP,
        coa_account_code_for_aquaculture_expense_category,
    )
    from api.services.aquaculture_cost_per_kg import aquaculture_expense_category_to_cost_bucket

    def _row(*, code: str, label: str, tenant_defined: bool, maps_to: str | None) -> dict:
        builtin = (maps_to or code).strip() if tenant_defined else code
        coa_code = coa_account_code_for_aquaculture_expense_category(builtin, company_id=company_id)
        coa_id = chart_account_id_for_aquaculture_expense_category(company_id, builtin)
        coa_name = ""
        if coa_id:
            acc = ChartOfAccount.objects.filter(pk=coa_id, company_id=company_id).first()
            coa_name = (acc.account_name or "").strip() if acc else ""
        if tenant_defined:
            bill_allowed = builtin not in TENANT_BILL_AQUACULTURE_EXPENSE_BLOCKED_MAPS
        else:
            bill_allowed = builtin in BILL_AQUACULTURE_EXPENSE_CATEGORY_CODES
        disallowed_reason: str | None = None
        if tenant_defined and not bill_allowed:
            disallowed_reason = (
                EXPENSE_CATEGORY_EXTRA_HELP.get(builtin)
                or f'This label rolls up to "{builtin}", which cannot be used on vendor bills. '
                "Edit the category and pick a different rollup (e.g. Other, Fisherman, Repair)."
            )
        return {
            "id": code,
            "label": label,
            "hint": EXPENSE_CATEGORY_EXTRA_HELP.get(builtin) if not disallowed_reason else disallowed_reason,
            "manual_create_allowed": code in MANUAL_AQUACULTURE_EXPENSE_CATEGORY_CODES,
            "bill_create_allowed": bill_allowed,
            "bill_create_disallowed_reason": disallowed_reason,
            "default_coa_account_code": coa_code,
            "default_coa_account_id": coa_id,
            "default_coa_account_name": coa_name,
            "default_cost_bucket": aquaculture_expense_category_to_cost_bucket(
                builtin, company_id=company_id
            ),
            "tenant_defined": tenant_defined,
            "maps_to_code": maps_to,
        }

    out: list[dict] = [
        _row(code=c, label=lbl, tenant_defined=False, maps_to=None)
        for c, lbl in AQUACULTURE_EXPENSE_CATEGORY_CHOICES
    ]
    tenant_qs = TenantReportingCategory.objects.filter(
        company_id=company_id,
        application=APP_AQUACULTURE,
        kind=KIND_EXPENSE,
        is_active=True,
    )
    tenant_qs = _tenant_category_entity_filter(
        tenant_qs, pond_id=pond_id, head_office=head_office
    )
    for r in tenant_qs.order_by("sort_order", "code"):
        mapped = (r.maps_to_code or "").strip()
        out.append(
            _row(code=r.code, label=r.label, tenant_defined=True, maps_to=mapped or None)
        )
    return out


def merged_fuel_station_income_category_list_for_api(
    company_id: int,
    *,
    station_id: int | None = None,
    head_office: bool = False,
) -> list[dict]:
    from api.models import ChartOfAccount, TenantReportingCategory
    from api.services.fuel_station_coa_constants import (
        coa_account_code_for_fuel_station_income_rollup,
        resolve_fuel_station_income_to_rollup,
    )

    def _row(
        *,
        code: str,
        label: str,
        tenant_defined: bool,
        maps_to: str | None,
        trc_id: int | None,
    ) -> dict:
        rollup = resolve_fuel_station_income_to_rollup(company_id, (maps_to or code).strip())
        coa_code = coa_account_code_for_fuel_station_income_rollup(rollup, company_id=company_id)
        coa_id = None
        acc = ChartOfAccount.objects.filter(
            company_id=company_id, account_code=coa_code, is_active=True
        ).first()
        coa_name = (acc.account_name or "").strip() if acc else ""
        if acc:
            coa_id = int(acc.id)
        return {
            "id": code,
            "label": label,
            "tenant_defined": tenant_defined,
            "maps_to_code": maps_to,
            "tenant_reporting_category_id": trc_id,
            "tagging_allowed": True,
            "default_coa_account_code": coa_code,
            "default_coa_account_id": coa_id,
            "default_coa_account_name": coa_name,
        }

    out: list[dict] = [
        _row(code=c, label=lbl, tenant_defined=False, maps_to=c, trc_id=None)
        for c, lbl in FUEL_STATION_INCOME_MAP_TARGETS
    ]
    tenant_qs = TenantReportingCategory.objects.filter(
        company_id=company_id,
        application=APP_FUEL_STATION,
        kind=KIND_INCOME,
        is_active=True,
    )
    tenant_qs = _tenant_category_entity_filter(
        tenant_qs, station_id=station_id, head_office=head_office
    )
    for r in tenant_qs.order_by("sort_order", "code"):
        mapped = (r.maps_to_code or "").strip() or r.code
        out.append(
            _row(
                code=r.code,
                label=r.label,
                tenant_defined=True,
                maps_to=mapped,
                trc_id=int(r.id),
            )
        )
    return out


def merged_fuel_station_expense_category_list_for_api(
    company_id: int,
    *,
    station_id: int | None = None,
    head_office: bool = False,
) -> list[dict]:
    from api.models import ChartOfAccount, TenantReportingCategory
    from api.services.fuel_station_coa_constants import (
        chart_account_id_for_fuel_station_expense_rollup,
        coa_account_code_for_fuel_station_expense_rollup,
        resolve_fuel_station_expense_to_rollup,
    )

    def _row(
        *,
        code: str,
        label: str,
        tenant_defined: bool,
        maps_to: str | None,
        trc_id: int | None,
    ) -> dict:
        rollup = resolve_fuel_station_expense_to_rollup(company_id, maps_to or code)
        coa_code = coa_account_code_for_fuel_station_expense_rollup(rollup, company_id=company_id)
        coa_id = chart_account_id_for_fuel_station_expense_rollup(company_id, rollup)
        coa_name = ""
        if coa_id:
            acc = ChartOfAccount.objects.filter(pk=coa_id, company_id=company_id).first()
            coa_name = (acc.account_name or "").strip() if acc else ""
        return {
            "id": code,
            "label": label,
            "tenant_defined": tenant_defined,
            "maps_to_code": maps_to,
            "tenant_reporting_category_id": trc_id,
            "bill_create_allowed": True,
            "default_coa_account_code": coa_code,
            "default_coa_account_id": coa_id,
            "default_coa_account_name": coa_name,
        }

    out: list[dict] = [
        _row(code=c, label=lbl, tenant_defined=False, maps_to=c, trc_id=None)
        for c, lbl in FUEL_STATION_EXPENSE_MAP_TARGETS
    ]
    tenant_qs = TenantReportingCategory.objects.filter(
        company_id=company_id,
        application=APP_FUEL_STATION,
        kind=KIND_EXPENSE,
        is_active=True,
    )
    tenant_qs = _tenant_category_entity_filter(
        tenant_qs, station_id=station_id, head_office=head_office
    )
    for r in tenant_qs.order_by("sort_order", "code"):
        mapped = (r.maps_to_code or "").strip() or r.code
        out.append(
            _row(
                code=r.code,
                label=r.label,
                tenant_defined=True,
                maps_to=mapped,
                trc_id=int(r.id),
            )
        )
    return out


def merged_reporting_tagging_options_for_api(
    *,
    company_id: int,
    application: str,
    kind: str,
    station_id: int | None = None,
    pond_id: int | None = None,
    head_office: bool = False,
) -> list[dict]:
    """Built-in + active tenant labels shown together in expense/income tagging dropdowns."""
    if application == APP_AQUACULTURE and kind == KIND_EXPENSE:
        return merged_aquaculture_expense_category_list_for_api(
            company_id, pond_id=pond_id, head_office=head_office
        )
    if application == APP_AQUACULTURE and kind == KIND_INCOME:
        return merged_aquaculture_income_type_list_for_api(
            company_id, pond_id=pond_id, head_office=head_office
        )
    if application == APP_FUEL_STATION and kind == KIND_EXPENSE:
        return merged_fuel_station_expense_category_list_for_api(
            company_id, station_id=station_id, head_office=head_office
        )
    if application == APP_FUEL_STATION and kind == KIND_INCOME:
        return merged_fuel_station_income_category_list_for_api(
            company_id, station_id=station_id, head_office=head_office
        )
    return []


def merged_aquaculture_income_type_list_for_api(
    company_id: int,
    *,
    pond_id: int | None = None,
    head_office: bool = False,
) -> list[dict]:
    from api.models import TenantReportingCategory
    from api.services.aquaculture_constants import (
        AQUACULTURE_INCOME_TYPE_CHOICES,
        NON_BIOLOGICAL_POND_SALE_INCOME_TYPES,
    )

    out: list[dict] = [
        {
            "id": c,
            "label": lbl,
            "tenant_defined": False,
            "maps_to_code": None,
            "non_biological_sale": c in NON_BIOLOGICAL_POND_SALE_INCOME_TYPES,
        }
        for c, lbl in AQUACULTURE_INCOME_TYPE_CHOICES
    ]
    tenant_qs = TenantReportingCategory.objects.filter(
        company_id=company_id,
        application=APP_AQUACULTURE,
        kind=KIND_INCOME,
        is_active=True,
    )
    tenant_qs = _tenant_category_entity_filter(
        tenant_qs, pond_id=pond_id, head_office=head_office
    )
    for r in tenant_qs.order_by("sort_order", "code"):
        mapped = (r.maps_to_code or "").strip()
        out.append(
            {
                "id": r.code,
                "label": r.label,
                "tenant_defined": True,
                "maps_to_code": mapped,
                "non_biological_sale": income_type_is_non_biological_for_company(company_id, r.code),
            }
        )
    return out


CROSS_ENTITY_EXPENSE_CATEGORY_SEED: tuple[tuple[str, str, str, int], ...] = (
    # label, application, maps_to_code, sort_order
    ("Automobile Expense", APP_AQUACULTURE, "transportation", 10),
    ("Automobile Expense", APP_FUEL_STATION, "operating", 10),
    ("Fuel Tank Lorry Fare", APP_AQUACULTURE, "transportation", 20),
    ("Fuel Tank Lorry Fare", APP_FUEL_STATION, "freight", 20),
    ("Travel Expense", APP_AQUACULTURE, "transportation", 30),
    ("Travel Expense", APP_FUEL_STATION, "operating", 30),
)


def ensure_cross_entity_expense_categories(company_id: int) -> dict[str, int]:
    """
    Idempotently seed company-wide expense labels usable on any entity (station, shop, pond, head office).
    Creates aquaculture rows for pond bills and fuel-station rows for site/head-office bills.
    """
    from api.models import TenantReportingCategory

    created = 0
    for label, application, maps_to, sort_order in CROSS_ENTITY_EXPENSE_CATEGORY_SEED:
        if validate_maps_to(application=application, kind=KIND_EXPENSE, maps_to_code=maps_to):
            continue
        exists = TenantReportingCategory.objects.filter(
            company_id=company_id,
            application=application,
            kind=KIND_EXPENSE,
            label__iexact=label,
            station_id__isnull=True,
            aquaculture_pond_id__isnull=True,
            head_office_only=False,
        ).exists()
        if exists:
            continue
        code = next_auto_tenant_reporting_category_code(company_id, application, KIND_EXPENSE)
        TenantReportingCategory.objects.create(
            company_id=company_id,
            application=application,
            kind=KIND_EXPENSE,
            code=code,
            label=label,
            maps_to_code=maps_to,
            sort_order=sort_order,
            is_active=True,
            head_office_only=False,
        )
        created += 1
    return {"created": created}
