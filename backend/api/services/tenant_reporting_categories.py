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

FUEL_STATION_EXPENSE_MAP_TARGETS: tuple[tuple[str, str], ...] = (
    ("operating", "General station operating expense"),
    ("cost_of_sales", "Cost of sales / shrink / variance"),
    ("maintenance", "Maintenance & repairs"),
    ("utilities", "Utilities & services"),
    ("other", "Other / miscellaneous"),
)
FUEL_STATION_INCOME_MAP_TARGETS: tuple[tuple[str, str], ...] = (
    ("fuel_revenue", "Fuel sales revenue"),
    ("shop_revenue", "Shop / non-fuel retail revenue"),
    ("services_revenue", "Services & fees revenue"),
    ("other", "Other income"),
)

FUEL_STATION_EXPENSE_MAP_CODES: frozenset[str] = frozenset(c for c, _ in FUEL_STATION_EXPENSE_MAP_TARGETS)
FUEL_STATION_INCOME_MAP_CODES: frozenset[str] = frozenset(c for c, _ in FUEL_STATION_INCOME_MAP_TARGETS)


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
    company_id: int, application: str, kind: str, code: str
) -> Any | None:
    from api.models import TenantReportingCategory

    return (
        TenantReportingCategory.objects.filter(
            company_id=company_id,
            application=application,
            kind=kind,
            code__iexact=code,
            is_active=True,
        )
        .first()
    )


def tenant_expense_row(company_id: int, application: str, code: str) -> Any | None:
    return _row(company_id, application, KIND_EXPENSE, code)


def tenant_income_row(company_id: int, application: str, code: str) -> Any | None:
    return _row(company_id, application, KIND_INCOME, code)


def resolve_aquaculture_expense_to_builtin(company_id: int, stored_code: str) -> str:
    s = (stored_code or "").strip()
    if s in EXPENSE_CATEGORY_CODES:
        return s
    r = tenant_expense_row(company_id, APP_AQUACULTURE, s)
    if r and (r.maps_to_code or "").strip() in EXPENSE_CATEGORY_CODES:
        return (r.maps_to_code or "").strip()
    return s


def resolve_aquaculture_income_to_builtin(company_id: int, stored_code: str) -> str:
    s = (stored_code or "").strip()
    if s in INCOME_TYPE_CODES:
        return s
    r = tenant_income_row(company_id, APP_AQUACULTURE, s)
    if r and (r.maps_to_code or "").strip() in INCOME_TYPE_CODES:
        return (r.maps_to_code or "").strip()
    return s


def aquaculture_expense_label(company_id: int, stored_code: str) -> str:
    from api.services.aquaculture_constants import EXPENSE_CATEGORY_LABELS

    s = (stored_code or "").strip()
    if s in EXPENSE_CATEGORY_LABELS:
        return EXPENSE_CATEGORY_LABELS[s]
    r = tenant_expense_row(company_id, APP_AQUACULTURE, s)
    if r:
        return (r.label or r.code).strip()
    return s or "—"


def aquaculture_income_label(company_id: int, stored_code: str) -> str:
    from api.services.aquaculture_constants import INCOME_TYPE_LABELS

    s = (stored_code or "").strip()
    if s in INCOME_TYPE_LABELS:
        return INCOME_TYPE_LABELS[s]
    r = tenant_income_row(company_id, APP_AQUACULTURE, s)
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


def list_map_target_choices(*, application: str, kind: str) -> list[dict]:
    if application == APP_AQUACULTURE:
        from api.services.aquaculture_constants import (
            AQUACULTURE_EXPENSE_CATEGORY_CHOICES,
            AQUACULTURE_INCOME_TYPE_CHOICES,
        )

        if kind == KIND_EXPENSE:
            return [{"id": c, "label": lbl} for c, lbl in AQUACULTURE_EXPENSE_CATEGORY_CHOICES]
        return [{"id": c, "label": lbl} for c, lbl in AQUACULTURE_INCOME_TYPE_CHOICES]
    if application == APP_FUEL_STATION:
        if kind == KIND_EXPENSE:
            return [{"id": c, "label": lbl} for c, lbl in FUEL_STATION_EXPENSE_MAP_TARGETS]
        return [{"id": c, "label": lbl} for c, lbl in FUEL_STATION_INCOME_MAP_TARGETS]
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
    from api.models import TenantReportingCategory

    def _row(*, code: str, label: str, tenant_defined: bool, maps_to: str | None, trc_id: int | None) -> dict:
        return {
            "id": code,
            "label": label,
            "tenant_defined": tenant_defined,
            "maps_to_code": maps_to,
            "tenant_reporting_category_id": trc_id,
            "bill_create_allowed": True,
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
