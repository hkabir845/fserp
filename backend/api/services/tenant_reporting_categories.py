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
    ("operating", "Operating & admin"),
    ("cost_of_sales", "Cost of sales / shrink"),
    ("maintenance", "Maintenance & repairs"),
    ("utilities", "Utilities & generator fuel"),
    ("other", "Other / miscellaneous"),
)
FUEL_STATION_INCOME_MAP_TARGETS: tuple[tuple[str, str], ...] = (
    ("fuel_revenue", "Fuel sales revenue"),
    ("shop_revenue", "Shop / agro retail revenue"),
    ("services_revenue", "Services & fees revenue"),
    ("other", "Other income"),
)

FUEL_STATION_EXPENSE_MAP_HINTS: dict[str, str] = {
    "operating": (
        "Payroll, rent, insurance, bank charges, security, marketing, office supplies, and general admin for the site. "
        "Default GL 6920 on bills; override line account for 6400 wages, 6200 rent, 6500 insurance, 6600 bank fees, "
        "7000 security, 6700 marketing, or 6900 office supplies only."
    ),
    "cost_of_sales": (
        "Fuel shrink or variance, inventory write-offs, and direct cost of shop goods sold at the station. "
        "Default GL 5200 (fuel wet loss); use 5210 for shop shrink or 5120 COGS when appropriate."
    ),
    "maintenance": (
        "Forecourt repairs, pump service, tank maintenance, signage, and building upkeep. "
        "Default GL 6300 (dispensing & site); use 6310 for building/canopy work."
    ),
    "utilities": (
        "Electricity, generator diesel, water, telecom, and other utility bills. "
        "Default GL 6100; use 6110 for water/sewer or override when generator fuel is inventoried."
    ),
    "other": "One-off or uncategorized station costs that do not fit the groups above. Default GL 6990.",
}
FUEL_STATION_INCOME_MAP_HINTS: dict[str, str] = {
    "fuel_revenue": "Petrol, diesel, octane, and lubricant sales from dispensers. Default revenue GL 4100–4140.",
    "shop_revenue": "Convenience store, agro-input shop, and other non-fuel retail at the site. Default GL 4200.",
    "services_revenue": "Car wash, air, commissions, equipment hire, and service fees. Default GL 4220.",
    "other": "Miscellaneous station income not counted as fuel, shop, or services revenue. Default GL 4230.",
}

AQUACULTURE_EXPENSE_MAP_GROUPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Land & rights", ("lease",)),
    ("Labor & payroll", ("worker_salary",)),
    ("Pond development", ("soilcut", "pond_preparation", "fry_stocking")),
    ("Feed", ("feed_purchase", "feed_consumed")),
    ("Medicine & health", ("medicine_purchase", "medicine_consumed")),
    ("Power, equipment & repairs", ("electricity", "equipment", "repair_maintenance")),
    ("Operations", ("fisherman", "transportation", "other")),
    ("System (automatic)", ("vendor_bill_pond",)),
)
AQUACULTURE_INCOME_MAP_GROUPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Fish & production sales", ("fish_harvest_sale", "fingerling_sale", "processing_value_add")),
    (
        "By-products & scrap",
        ("empty_feed_sack_sale", "used_material_sale", "rejected_material_sale", "used_equipment_sale"),
    ),
    ("Other", ("other_income",)),
)
FUEL_STATION_EXPENSE_MAP_GROUPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Operating & admin", ("operating",)),
    ("Cost of sales", ("cost_of_sales",)),
    ("Facility & upkeep", ("maintenance", "utilities")),
    ("Other", ("other",)),
)
FUEL_STATION_INCOME_MAP_GROUPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Sales revenue", ("fuel_revenue", "shop_revenue", "services_revenue")),
    ("Other income", ("other",)),
)

_AQUACULTURE_EXPENSE_SUPPLEMENTAL_HINTS: dict[str, str] = {
    "soilcut": "Earthworks and soil removal when preparing new ponds or expanding existing ones.",
    "pond_preparation": "Lime, fertiliser, pond drying, and other preparation before stocking.",
    "fry_stocking": (
        "Fry and fingerling purchases — prefer vendor bills with pond-tagged fish-type lines rather than manual costs."
    ),
    "electricity": "Grid power, prepaid meters, and site electrical costs for pumps and aerators.",
    "fisherman": "Harvest crew or contract fisherman payments tied to pond operations.",
    "transportation": "Fish hauling, feed delivery to ponds, and vehicle costs for the aquaculture site.",
}
AQUACULTURE_INCOME_TYPE_HINTS: dict[str, str] = {
    "fish_harvest_sale": "Primary table-fish or market harvest revenue from the pond.",
    "fingerling_sale": "Sales of fry or fingerlings produced or held at the pond.",
    "processing_value_add": "Smoked, filleted, or otherwise processed fish sold at a premium.",
    "empty_feed_sack_sale": "Scrap income from empty feed sacks — does not reduce fish biomass in stock reports.",
    "used_material_sale": "Scrap materials (netting, drums, etc.) — non-biological pond revenue.",
    "rejected_material_sale": "Rejected or waste material sold off — non-biological pond revenue.",
    "used_equipment_sale": "Used or scrap equipment sold — non-biological pond revenue.",
    "other_income": "Tours, consulting, grants, or other pond income that does not fit a named type above.",
}

FUEL_STATION_EXPENSE_MAP_CODES: frozenset[str] = frozenset(c for c, _ in FUEL_STATION_EXPENSE_MAP_TARGETS)
FUEL_STATION_INCOME_MAP_CODES: frozenset[str] = frozenset(c for c, _ in FUEL_STATION_INCOME_MAP_TARGETS)


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
        mapped = (r.maps_to_code or "").strip()
        if mapped in MANUAL_AQUACULTURE_EXPENSE_CATEGORY_CODES:
            return True, None
        return (
            False,
            "This company-defined category rolls up to a built-in type that cannot be used for manual pond costs.",
        )
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


def validate_maps_to(*, application: str, kind: str, maps_to_code: str) -> str | None:
    m = (maps_to_code or "").strip()
    if not m:
        return "maps_to_code is required"
    if application == APP_AQUACULTURE:
        if kind == KIND_EXPENSE and m not in EXPENSE_CATEGORY_CODES:
            return "maps_to_code must be a built-in aquaculture expense category code"
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
            groups = _group_lookup(AQUACULTURE_EXPENSE_MAP_GROUPS)
            group_order = tuple(g for g, _ in AQUACULTURE_EXPENSE_MAP_GROUPS)
            rows: list[dict] = []
            for code, label in AQUACULTURE_EXPENSE_CATEGORY_CHOICES:
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


def merged_aquaculture_expense_category_list_for_api(company_id: int) -> list[dict]:
    from api.models import ChartOfAccount, TenantReportingCategory
    from api.services.aquaculture_bill_defaults import (
        BILL_AQUACULTURE_EXPENSE_CATEGORY_CODES,
        chart_account_id_for_aquaculture_expense_category,
    )
    from api.services.aquaculture_constants import (
        AQUACULTURE_EXPENSE_CATEGORY_CHOICES,
        EXPENSE_CATEGORY_EXTRA_HELP,
        coa_account_code_for_aquaculture_expense_category,
    )
    from api.services.aquaculture_cost_per_kg import aquaculture_expense_category_to_cost_bucket

    def _row(*, code: str, label: str, tenant_defined: bool, maps_to: str | None) -> dict:
        builtin = maps_to or code
        coa_code = coa_account_code_for_aquaculture_expense_category(builtin, company_id=company_id)
        coa_id = chart_account_id_for_aquaculture_expense_category(company_id, builtin)
        coa_name = ""
        if coa_id:
            acc = ChartOfAccount.objects.filter(pk=coa_id, company_id=company_id).first()
            coa_name = (acc.account_name or "").strip() if acc else ""
        return {
            "id": code,
            "label": label,
            "hint": EXPENSE_CATEGORY_EXTRA_HELP.get(builtin),
            "manual_create_allowed": code in MANUAL_AQUACULTURE_EXPENSE_CATEGORY_CODES,
            "bill_create_allowed": builtin in BILL_AQUACULTURE_EXPENSE_CATEGORY_CODES,
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
    for r in TenantReportingCategory.objects.filter(
        company_id=company_id,
        application=APP_AQUACULTURE,
        kind=KIND_EXPENSE,
        is_active=True,
    ).order_by("sort_order", "code"):
        mapped = (r.maps_to_code or "").strip()
        out.append(
            _row(code=r.code, label=r.label, tenant_defined=True, maps_to=mapped or None)
        )
    return out


def merged_fuel_station_expense_category_list_for_api(company_id: int) -> list[dict]:
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
    for r in TenantReportingCategory.objects.filter(
        company_id=company_id,
        application=APP_FUEL_STATION,
        kind=KIND_EXPENSE,
        is_active=True,
    ).order_by("sort_order", "code"):
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


def merged_aquaculture_income_type_list_for_api(company_id: int) -> list[dict]:
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
    for r in TenantReportingCategory.objects.filter(
        company_id=company_id,
        application=APP_AQUACULTURE,
        kind=KIND_INCOME,
        is_active=True,
    ).order_by("sort_order", "code"):
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
