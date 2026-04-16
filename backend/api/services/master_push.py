"""
Push configuration and platform release from the Master Filling Station company to tenant companies.

Used by Super Admin: POST /api/admin/master-company/push-updates/
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from django.db import transaction
from django.db.models import Q

from api.chart_templates.fuel_station import (
    backfill_company_coa_descriptions,
    ensure_loan_module_default_accounts,
    seed_fuel_station_chart,
)
from api.models import Company, Item, Tax, TaxRate
from api.services.tenant_release import apply_platform_release


def find_master_company() -> Company | None:
    return (
        Company.objects.filter(is_deleted=False)
        .filter(Q(is_master__iexact="true") | Q(is_master="1"))
        .order_by("id")
        .first()
    )


def _tenant_targets(
    *,
    scope: str,
    company_ids: list[int] | None,
) -> tuple[list[Company], str | None]:
    """
    Returns (targets, error_message). Targets exclude master and deleted rows.
    """
    scope = (scope or "all_tenants").strip().lower()
    if scope not in ("all_tenants", "selected"):
        return [], "scope must be all_tenants or selected"

    qs = Company.objects.filter(is_deleted=False)
    master_q = Q(is_master__iexact="true") | Q(is_master="1")
    qs = qs.exclude(master_q)

    if scope == "all_tenants":
        return list(qs.order_by("id")), None

    ids: list[int] = []
    for x in company_ids or []:
        if x is None:
            continue
        try:
            ids.append(int(x))
        except (TypeError, ValueError):
            return [], "company_ids must be integers"
    if not ids:
        return [], "company_ids required when scope is selected"

    rows = list(qs.filter(id__in=ids).order_by("id"))
    if len(rows) != len(set(ids)):
        return [], "One or more company_ids are invalid, deleted, or master company"
    return rows, None


def _sync_items(master_id: int, tenant_id: int) -> dict[str, Any]:
    added = 0
    skipped = 0
    for mi in Item.objects.filter(company_id=master_id).order_by("id"):
        num = (mi.item_number or "").strip()
        if num:
            if Item.objects.filter(company_id=tenant_id, item_number=num).exists():
                skipped += 1
                continue
        else:
            if Item.objects.filter(company_id=tenant_id, name=mi.name).exists():
                skipped += 1
                continue
        Item.objects.create(
            company_id=tenant_id,
            item_number=mi.item_number,
            name=mi.name,
            description=mi.description or "",
            item_type=mi.item_type or "inventory",
            unit_price=mi.unit_price or Decimal("0"),
            cost=mi.cost or Decimal("0"),
            quantity_on_hand=Decimal("0"),
            unit=mi.unit or "piece",
            pos_category=mi.pos_category or "general",
            category=mi.category or "",
            barcode=mi.barcode or "",
            is_taxable=bool(mi.is_taxable),
            is_pos_available=bool(mi.is_pos_available),
            is_active=bool(mi.is_active),
            image_url=mi.image_url or "",
        )
        added += 1
    return {"added": added, "skipped": skipped}


def _sync_taxes(master_id: int, tenant_id: int) -> dict[str, Any]:
    taxes_added = 0
    rates_added = 0
    skipped = 0
    for mt in Tax.objects.filter(company_id=master_id).order_by("id"):
        name = (mt.name or "").strip()
        if not name:
            skipped += 1
            continue
        if Tax.objects.filter(company_id=tenant_id, name=name).exists():
            skipped += 1
            continue
        nt = Tax.objects.create(
            company_id=tenant_id,
            name=name,
            description=mt.description or "",
            is_active=bool(mt.is_active),
        )
        taxes_added += 1
        for r in mt.rates.all().order_by("id"):
            TaxRate.objects.create(
                tax=nt,
                rate=r.rate,
                effective_from=r.effective_from,
                effective_to=r.effective_to,
            )
            rates_added += 1
    return {"taxes_added": taxes_added, "rates_added": rates_added, "skipped": skipped}


def _sync_company_settings(master: Company, tenant: Company) -> dict[str, Any]:
    fields = [
        "currency",
        "date_format",
        "time_format",
        "fiscal_year_start",
    ]
    updates: dict[str, Any] = {}
    for f in fields:
        mv = getattr(master, f, None)
        tv = getattr(tenant, f, None)
        if mv != tv:
            setattr(tenant, f, mv)
            updates[f] = mv
    if updates:
        tenant.save(update_fields=list(updates.keys()) + ["updated_at"])
    return {"updated_fields": updates}


@transaction.atomic
def _apply_data_sync_for_tenant(master: Company, tenant: Company, options: dict[str, bool]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    mid, tid = master.id, tenant.id
    if options.get("sync_chart_of_accounts"):
        seed = seed_fuel_station_chart(tid, profile="full", replace=False)
        loan = ensure_loan_module_default_accounts(tid)
        desc = backfill_company_coa_descriptions(tid, only_blank=True, force_template=False)
        out["chart_of_accounts"] = {"seed": seed, "loan_defaults": loan, "descriptions": desc}
    if options.get("sync_items"):
        out["items"] = _sync_items(mid, tid)
    if options.get("sync_tax_codes"):
        out["taxes"] = _sync_taxes(mid, tid)
    if options.get("sync_company_settings"):
        out["company_settings"] = _sync_company_settings(master, tenant)
    return out


def run_master_push(
    *,
    scope: str,
    company_ids: list[int] | None,
    apply_platform_release_flag: bool,
    sync_chart_of_accounts: bool,
    sync_items: bool,
    sync_tax_codes: bool,
    sync_company_settings: bool,
) -> dict[str, Any]:
    targets, err = _tenant_targets(scope=scope, company_ids=company_ids)
    if err:
        raise ValueError(err)

    has_data_sync = bool(
        sync_chart_of_accounts or sync_items or sync_tax_codes or sync_company_settings
    )
    master = find_master_company() if has_data_sync else None
    if has_data_sync and not master:
        raise ValueError(
            "No Master company found. Create one with is_master=true or disable data sync options."
        )

    if not apply_platform_release_flag and not has_data_sync:
        raise ValueError("Select at least one operation (platform release and/or data sync).")

    options = {
        "sync_chart_of_accounts": sync_chart_of_accounts,
        "sync_items": sync_items,
        "sync_tax_codes": sync_tax_codes,
        "sync_company_settings": sync_company_settings,
    }

    results: list[dict[str, Any]] = []
    ok_count = 0

    for tenant in targets:
        row: dict[str, Any] = {"company_id": tenant.id, "company_name": tenant.name, "ok": True}
        try:
            if apply_platform_release_flag:
                row["platform_release"] = apply_platform_release(tenant, None)
            if has_data_sync and master is not None:
                row["data_sync"] = _apply_data_sync_for_tenant(master, tenant, options)
            ok_count += 1
        except Exception as e:
            row["ok"] = False
            row["detail"] = str(e)
        results.append(row)

    return {
        "ok": True,
        "master_company_id": master.id if master else None,
        "target_tenant_count": len(targets),
        "updated_count": ok_count,
        "results": results,
    }
