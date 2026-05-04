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
    ensure_donation_social_support_account,
    ensure_loan_module_default_accounts,
    seed_fuel_station_chart,
)
from api.models import Company, Item, Tax, TaxRate
from api.services.tenant_release import (
    apply_platform_release,
    get_target_release,
    rollback_platform_release,
    tenant_needs_release,
)
from api.services.tenant_upgrade_audit import record_release_audit


def find_master_company() -> Company | None:
    return (
        Company.objects.filter(is_deleted=False)
        .filter(Q(is_master__iexact="true") | Q(is_master="1"))
        .order_by("id")
        .first()
    )


def _parse_selected_company_ids(company_ids: list[int] | None) -> tuple[list[int] | None, str | None]:
    ids: list[int] = []
    for x in company_ids or []:
        if x is None:
            continue
        try:
            ids.append(int(x))
        except (TypeError, ValueError):
            return None, "company_ids must be integers"
    if not ids:
        return None, "company_ids required when scope is selected"
    return ids, None


def _tenant_targets(
    *,
    scope: str,
    company_ids: list[int] | None,
    exclude_master: bool,
) -> tuple[list[Company], str | None]:
    """
    Returns (targets, error_message).

    When exclude_master is True (template sync only, or tenant list without Master), the Master
    row is excluded. When False (platform release only, rollback, or combined release+sync),
    Master may appear in the list.
    """
    scope = (scope or "all_tenants").strip().lower()
    if scope not in ("all_tenants", "selected"):
        return [], "scope must be all_tenants or selected"

    qs = Company.objects.filter(is_deleted=False)
    master_q = Q(is_master__iexact="true") | Q(is_master="1")
    if exclude_master:
        qs = qs.exclude(master_q)

    if scope == "all_tenants":
        return list(qs.order_by("id")), None

    raw_ids, err = _parse_selected_company_ids(company_ids)
    if err or raw_ids is None:
        return [], err or "company_ids required when scope is selected"
    ids = raw_ids

    rows = list(qs.filter(id__in=ids).order_by("id"))
    if len(rows) != len(set(ids)):
        return [], (
            "One or more company_ids are invalid, deleted, or (when syncing template data only) "
            "master cannot be a target"
        )
    return rows, None


def _push_target_companies(
    *,
    scope: str,
    company_ids: list[int] | None,
    apply_platform_release_flag: bool,
    has_data_sync: bool,
) -> tuple[list[Company], str | None]:
    """
    Companies to visit in one master push. Release-only includes Master; template-only excludes
    Master; release+sync includes Master for release but data_sync must skip the Master row.
    """
    combined = apply_platform_release_flag and has_data_sync
    if not combined:
        return _tenant_targets(
            scope=scope,
            company_ids=company_ids,
            exclude_master=has_data_sync,
        )

    scope_l = (scope or "all_tenants").strip().lower()
    if scope_l not in ("all_tenants", "selected"):
        return [], "scope must be all_tenants or selected"

    qs = Company.objects.filter(is_deleted=False).order_by("id")
    if scope_l == "all_tenants":
        return list(qs), None

    raw_ids, err = _parse_selected_company_ids(company_ids)
    if err or raw_ids is None:
        return [], err or "company_ids required when scope is selected"
    rows = list(qs.filter(id__in=raw_ids).order_by("id"))
    if len(rows) != len(set(raw_ids)):
        return [], "One or more company_ids are invalid or deleted"
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
        it = Item(
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
        it.save()
        from api.services.station_stock import ensure_item_station_row_for_new_shop_item

        ensure_item_station_row_for_new_shop_item(tenant_id, it)
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


def _preview_items_sync_counts(master_id: int, tenant_id: int) -> dict[str, Any]:
    would_add = 0
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
        would_add += 1
    return {"would_add": would_add, "would_skip_existing": skipped}


def _preview_taxes_sync_counts(master_id: int, tenant_id: int) -> dict[str, Any]:
    would_add_taxes = 0
    would_add_rate_rows = 0
    skipped = 0
    for mt in Tax.objects.filter(company_id=master_id).order_by("id"):
        name = (mt.name or "").strip()
        if not name:
            skipped += 1
            continue
        if Tax.objects.filter(company_id=tenant_id, name=name).exists():
            skipped += 1
            continue
        would_add_taxes += 1
        would_add_rate_rows += mt.rates.count()
    return {
        "would_add_tax_definitions": would_add_taxes,
        "would_add_rate_rows": would_add_rate_rows,
        "skipped": skipped,
    }


def _preview_company_settings_diff(master: Company, tenant: Company) -> dict[str, Any]:
    fields = [
        "currency",
        "date_format",
        "time_format",
        "fiscal_year_start",
    ]
    diff: dict[str, Any] = {}
    for f in fields:
        mv = getattr(master, f, None)
        tv = getattr(tenant, f, None)
        if mv != tv:
            diff[f] = {"from": tv, "to": mv}
    return {"field_changes": diff, "would_update": bool(diff)}


def _preview_data_sync_for_tenant(master: Company, tenant: Company, options: dict[str, bool]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    mid, tid = master.id, tenant.id
    if options.get("sync_chart_of_accounts"):
        out["chart_of_accounts"] = {
            "would_run": True,
            "note": "Adds missing template accounts from the fuel-station profile; does not delete tenant data.",
        }
    if options.get("sync_items"):
        out["items"] = _preview_items_sync_counts(mid, tid)
    if options.get("sync_tax_codes"):
        out["taxes"] = _preview_taxes_sync_counts(mid, tid)
    if options.get("sync_company_settings"):
        out["company_settings"] = _preview_company_settings_diff(master, tenant)
    return out


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
        donation = ensure_donation_social_support_account(tid)
        desc = backfill_company_coa_descriptions(tid, only_blank=True, force_template=False)
        out["chart_of_accounts"] = {
            "seed": seed,
            "loan_defaults": loan,
            "donation_support": donation,
            "descriptions": desc,
        }
    if options.get("sync_items"):
        out["items"] = _sync_items(mid, tid)
    if options.get("sync_tax_codes"):
        out["taxes"] = _sync_taxes(mid, tid)
    if options.get("sync_company_settings"):
        out["company_settings"] = _sync_company_settings(master, tenant)
    return out


def _audit_master_push_row(
    *,
    tenant_id: int,
    actor_user_id: int | None,
    audit_source: str,
    row: dict[str, Any],
) -> None:
    tgt = get_target_release()
    success = bool(row.get("ok"))
    detail: dict[str, Any] = {}
    if "platform_release" in row:
        detail["platform_release"] = row["platform_release"]
    if "data_sync" in row:
        detail["data_sync"] = row["data_sync"]
    if not success:
        detail["error"] = row.get("detail")
    record_release_audit(
        company_id=tenant_id,
        category="master_push",
        server_target_release=tgt,
        success=success,
        actor_user_id=actor_user_id,
        source=audit_source,
        detail=detail or None,
        error_message=(row.get("detail") or "") if not success else "",
    )


def preview_master_push(
    *,
    scope: str,
    company_ids: list[int] | None,
    apply_platform_release_flag: bool,
    sync_chart_of_accounts: bool,
    sync_items: bool,
    sync_tax_codes: bool,
    sync_company_settings: bool,
) -> dict[str, Any]:
    """
    Dry-run: same inputs as run_master_push; no database writes.
    """
    has_data_sync = bool(
        sync_chart_of_accounts or sync_items or sync_tax_codes or sync_company_settings
    )
    targets, err = _push_target_companies(
        scope=scope,
        company_ids=company_ids,
        apply_platform_release_flag=apply_platform_release_flag,
        has_data_sync=has_data_sync,
    )
    if err:
        raise ValueError(err)

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
    tgt = get_target_release()
    preview_rows: list[dict[str, Any]] = []
    release_would_apply = 0
    release_would_skip = 0

    for tenant in targets:
        row: dict[str, Any] = {"company_id": tenant.id, "company_name": tenant.name}
        if apply_platform_release_flag:
            cur = (tenant.platform_release or "").strip()
            needs = tenant_needs_release(tenant)
            row["release"] = {
                "current_release": cur,
                "target_release": tgt,
                "would_apply": needs,
                "would_skip_already_current": not needs,
            }
            if needs:
                release_would_apply += 1
            else:
                release_would_skip += 1
        if has_data_sync and master is not None:
            if master.id == tenant.id:
                row["data_sync_preview"] = {
                    "skipped": True,
                    "reason": "Master is the template source; sync applies to tenant companies only.",
                }
            else:
                row["data_sync_preview"] = _preview_data_sync_for_tenant(master, tenant, options)
        preview_rows.append(row)

    return {
        "dry_run": True,
        "target_release": tgt,
        "master_company_id": master.id if master else None,
        "target_tenant_count": len(targets),
        "release_preview_summary": {
            "would_apply": release_would_apply,
            "would_skip_already_at_target": release_would_skip,
        }
        if apply_platform_release_flag
        else None,
        "preview": preview_rows,
    }


def run_master_push(
    *,
    scope: str,
    company_ids: list[int] | None,
    apply_platform_release_flag: bool,
    sync_chart_of_accounts: bool,
    sync_items: bool,
    sync_tax_codes: bool,
    sync_company_settings: bool,
    actor_user_id: int | None = None,
    audit_source: str = "master_push",
) -> dict[str, Any]:
    has_data_sync = bool(
        sync_chart_of_accounts or sync_items or sync_tax_codes or sync_company_settings
    )
    targets, err = _push_target_companies(
        scope=scope,
        company_ids=company_ids,
        apply_platform_release_flag=apply_platform_release_flag,
        has_data_sync=has_data_sync,
    )
    if err:
        raise ValueError(err)

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
    platform_release_applied = 0
    platform_release_skipped_already = 0

    for tenant in targets:
        row: dict[str, Any] = {"company_id": tenant.id, "company_name": tenant.name, "ok": True}
        try:
            if apply_platform_release_flag:
                pr = apply_platform_release(tenant, None)
                row["platform_release"] = pr
                if isinstance(pr, dict) and pr.get("skipped"):
                    platform_release_skipped_already += 1
                else:
                    platform_release_applied += 1
            if has_data_sync and master is not None:
                if master.id == tenant.id:
                    row["data_sync"] = {
                        "skipped": True,
                        "reason": "Master is the template source; sync applies to tenant companies only.",
                    }
                else:
                    row["data_sync"] = _apply_data_sync_for_tenant(master, tenant, options)
            ok_count += 1
        except Exception as e:
            row["ok"] = False
            row["detail"] = str(e)
        results.append(row)
        _audit_master_push_row(
            tenant_id=tenant.id,
            actor_user_id=actor_user_id,
            audit_source=audit_source,
            row=row,
        )

    failed_count = len(targets) - ok_count
    out: dict[str, Any] = {
        "ok": failed_count == 0,
        "master_company_id": master.id if master else None,
        "target_tenant_count": len(targets),
        "updated_count": ok_count,
        "failed_count": failed_count,
        "results": results,
    }
    if apply_platform_release_flag:
        tgt = get_target_release()
        out["platform_release_summary"] = {
            "target": tgt,
            "tenants_applied": platform_release_applied,
            "tenants_skipped_already_at_target": platform_release_skipped_already,
            "tenants_failed": failed_count,
        }
    return out


def _audit_rollback_row(
    *,
    tenant_id: int,
    actor_user_id: int | None,
    audit_source: str,
    row: dict[str, Any],
) -> None:
    tgt = get_target_release()
    success = bool(row.get("ok"))
    detail: dict[str, Any] = {"rollback": row.get("rollback")}
    if not success:
        detail["error"] = row.get("detail")
    record_release_audit(
        company_id=tenant_id,
        category="rollback_batch",
        server_target_release=tgt,
        success=success,
        actor_user_id=actor_user_id,
        source=audit_source,
        detail=detail,
        error_message=(row.get("detail") or "") if not success else "",
    )


def run_master_rollback(
    *,
    scope: str,
    company_ids: list[int] | None,
    actor_user_id: int | None = None,
    audit_source: str = "rollback_batch",
) -> dict[str, Any]:
    """
    Roll back the last platform release tag on each target company (includes Master when scope matches).
    Rows with nothing recorded skip with a message; failures are per-row.
    """
    targets, err = _tenant_targets(scope=scope, company_ids=company_ids, exclude_master=False)
    if err:
        raise ValueError(err)

    results: list[dict[str, Any]] = []
    ok_count = 0
    rolled_back = 0
    skipped_nothing_to_undo = 0

    for tenant in targets:
        row: dict[str, Any] = {"company_id": tenant.id, "company_name": tenant.name, "ok": True}
        try:
            tenant.refresh_from_db(fields=["platform_release", "platform_release_previous", "platform_release_applied_at"])
            if tenant.platform_release_previous is None:
                row["rollback"] = {
                    "skipped": True,
                    "message": "No upgrade recorded to roll back.",
                }
                skipped_nothing_to_undo += 1
            else:
                row["rollback"] = rollback_platform_release(tenant)
                rolled_back += 1
            ok_count += 1
        except Exception as e:
            row["ok"] = False
            row["detail"] = str(e)
        results.append(row)
        _audit_rollback_row(
            tenant_id=tenant.id,
            actor_user_id=actor_user_id,
            audit_source=audit_source,
            row=row,
        )

    failed_count = len(targets) - ok_count
    return {
        "ok": failed_count == 0,
        "target_tenant_count": len(targets),
        "updated_count": ok_count,
        "failed_count": failed_count,
        "rollback_summary": {
            "tenants_rolled_back": rolled_back,
            "tenants_skipped_nothing_to_undo": skipped_nothing_to_undo,
            "tenants_failed": failed_count,
        },
        "results": results,
    }
