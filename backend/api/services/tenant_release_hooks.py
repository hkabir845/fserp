"""
Idempotent per-tenant backfills for Super Admin platform release rollout.

Runs when:
  - POST /api/admin/companies/<id>/apply-release/
  - POST /api/admin/master-company/push-updates/ with apply_platform_release=true
    (including **Apply release to all tenants** on Admin → Companies)

Schema changes still require ``python manage.py migrate`` on the server before promoting tenants.
These hooks only backfill tenant-scoped data so Master R&D features work on each company row.
"""
from __future__ import annotations

import logging
from decimal import Decimal

from django.utils import timezone

from api.chart_templates.fuel_station import (
    backfill_company_coa_descriptions,
    ensure_donation_social_support_account,
    ensure_loan_module_default_accounts,
    seed_fuel_station_chart,
)
from api.models import AquacultureExpense, AquaculturePond, ChartOfAccount, Company, Employee, Organization, Station
from api.services.employee_pond_labor import LABOR_SCOPE_ASSIGNED_POND, LABOR_SCOPE_NOT_APPLICABLE
from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts
from api.services.aquaculture_medicine_catalog_seed import ensure_aquaculture_medicine_catalog_items
from api.services.aquaculture_pond_pos_customer import (
    maybe_provision_auto_pos_customer,
    sync_aquaculture_customer_default_stations,
)
from api.services.employee_payroll_subledger import backfill_missing_payroll_subledger_lines

logger = logging.getLogger(__name__)


def _active_company(company_id: int) -> Company | None:
    return Company.objects.filter(pk=company_id, is_deleted=False).first()


def hook_ensure_organization(company_id: int) -> None:
    """Attach Organization shell when a company predates tenant groups (0079)."""
    company = _active_company(company_id)
    if not company or company.organization_id:
        return
    org = Organization.objects.create(
        name=company.name,
        legal_name=(company.legal_name or "")[:200],
    )
    company.organization = org
    company.save(update_fields=["organization_id", "updated_at"])


def hook_fuel_station_coa_basics(company_id: int) -> None:
    """Fuel-station COA profile, loan/donation defaults, blank description backfill."""
    if not _active_company(company_id):
        return
    seed_fuel_station_chart(company_id, profile="full", replace=False)
    ensure_loan_module_default_accounts(company_id)
    ensure_donation_social_support_account(company_id)
    backfill_company_coa_descriptions(company_id, only_blank=True, force_template=False)


def _ensure_aquaculture_medicine_coa(company_id: int) -> None:
    """0060: account 6721 for medicine_purchase when Aquaculture is on."""
    if ChartOfAccount.objects.filter(company_id=company_id, account_code="6721").exists():
        return
    today = timezone.now().date()
    ChartOfAccount.objects.create(
        company_id=company_id,
        account_code="6721",
        account_name="Aquaculture Expense — Medicine & Veterinary",
        account_type="expense",
        account_sub_type="supplies_materials",
        description="Medicine, vaccine, and veterinary supplies (medicine_purchase).",
        parent_id=None,
        opening_balance=Decimal("0"),
        opening_balance_date=today,
        is_active=True,
    )


def _sync_aquaculture_expense_category_labels(company_id: int) -> None:
    """0060 / 0061: legacy category + COA labels (idempotent)."""
    AquacultureExpense.objects.filter(
        company_id=company_id, expense_category="feed_medicine"
    ).update(expense_category="feed_purchase")
    ChartOfAccount.objects.filter(company_id=company_id, account_code="6716").update(
        account_name="Aquaculture Expense — Feed",
        description="Commercial feed purchases (feed_purchase).",
    )
    ChartOfAccount.objects.filter(company_id=company_id, account_code="6725").update(
        account_name="Aquaculture Expense — Miscellaneous & other operating",
        description=(
            "Miscellaneous pond costs (code other): boats, wiring, lighting, cameras, engines, "
            "aerators, nets, repairs, bikes, labour, site consumables, and items not mapped to a "
            "dedicated category."
        ),
    )


def hook_aquaculture_module(company_id: int) -> None:
    """
    Aquaculture COA (0057+), license flag (0058), feed/medicine split (0060), Data Bank-ready ops.
    """
    company = _active_company(company_id)
    if not company:
        return
    if company.aquaculture_enabled and not company.aquaculture_licensed:
        Company.objects.filter(pk=company_id).update(aquaculture_licensed=True)
        company.aquaculture_licensed = True
    if not (company.aquaculture_enabled or company.aquaculture_licensed):
        return
    ensure_aquaculture_chart_accounts(company_id)
    _ensure_aquaculture_medicine_coa(company_id)
    _sync_aquaculture_expense_category_labels(company_id)
    try:
        ensure_aquaculture_medicine_catalog_items(company_id)
    except Exception:
        logger.exception(
            "release hook medicine catalog seed failed company=%s", company_id
        )


def hook_aquaculture_pond_pos_customers(company_id: int) -> None:
    """0066 / 0099: auto POS customers for ponds and shop default_station on aquaculture customers."""
    company = _active_company(company_id)
    if not company or not (company.aquaculture_enabled or company.aquaculture_licensed):
        return
    for pond in AquaculturePond.objects.filter(
        company_id=company_id, pos_customer_id__isnull=True
    ).order_by("id"):
        try:
            err = maybe_provision_auto_pos_customer(
                company_id=company_id, pond=pond, skip_auto=False
            )
            if err:
                logger.warning(
                    "release hook pond POS: pond=%s company=%s: %s",
                    pond.pk,
                    company_id,
                    err,
                )
        except Exception:
            logger.exception(
                "release hook pond POS failed pond=%s company=%s", pond.pk, company_id
            )
    try:
        sync_aquaculture_customer_default_stations(company_id=company_id)
    except Exception:
        logger.exception(
            "release hook sync aquaculture customer stations failed company=%s", company_id
        )


def hook_payroll_employee_subledger(company_id: int) -> None:
    """Posted payroll runs missing EmployeeLedgerEntry lines."""
    if not _active_company(company_id):
        return
    backfill_missing_payroll_subledger_lines(company_id)


def hook_employee_labor_scope_cleanup(company_id: int) -> None:
    """
    Broaden 0103: staff on fuel retail sites without a home pond should not use assigned_pond scope.
    """
    if not _active_company(company_id):
        return
    fuel_station_ids = set(
        Station.objects.filter(company_id=company_id, operates_fuel_retail=True).values_list("id", flat=True)
    )
    if not fuel_station_ids:
        return
    Employee.objects.filter(
        company_id=company_id,
        home_station_id__in=fuel_station_ids,
        aquaculture_labor_scope=LABOR_SCOPE_ASSIGNED_POND,
        home_aquaculture_pond_id__isnull=True,
    ).update(aquaculture_labor_scope=LABOR_SCOPE_NOT_APPLICABLE)


def hook_bank_and_equity_registers(company_id: int) -> None:
    """Bank registers from chart + equity registers used for transfers."""
    if not _active_company(company_id):
        return
    from api.views.bank_accounts_views import (
        ensure_bank_registers_from_chart,
        ensure_equity_registers_for_transfer,
    )

    ensure_bank_registers_from_chart(company_id)
    ensure_equity_registers_for_transfer(company_id)


# Order matters: organization shell first, then COA, then module-specific rows.
TENANT_RELEASE_HOOKS: list = [
    hook_ensure_organization,
    hook_fuel_station_coa_basics,
    hook_aquaculture_module,
    hook_aquaculture_pond_pos_customers,
    hook_payroll_employee_subledger,
    hook_employee_labor_scope_cleanup,
    hook_bank_and_equity_registers,
]


def release_hook_catalog() -> list[dict[str, str]]:
    """Human-readable list for Super Admin platform release panel."""
    out: list[dict[str, str]] = []
    for fn in TENANT_RELEASE_HOOKS:
        doc = (fn.__doc__ or "").strip()
        summary = doc.split("\n\n")[0].replace("\n", " ") if doc else fn.__name__
        out.append({"name": fn.__name__, "summary": summary})
    return out
