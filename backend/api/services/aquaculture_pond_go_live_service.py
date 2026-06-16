"""Pond go-live readiness: cutover date, checklist, biology, inventory, bioasset estimate."""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from django.utils import timezone

from api.models import AquacultureLandlordPondShare, AquaculturePond, Company
from api.services.aquaculture_pond_opening_summary import build_all_pond_opening_summaries
from api.services.aquaculture_pond_pl_opening import category_catalog_for_api
from api.services.aquaculture_pond_stock_service import pond_warehouse_stock_matrix
from api.services.aquaculture_stock_service import compute_fish_stock_position_breakdown_rows

_MONEY = Decimal("0.01")


def _q(d: Decimal | None) -> Decimal:
    return (d or Decimal("0")).quantize(_MONEY, rounding=ROUND_HALF_UP)


def _str_money(d: Decimal) -> str:
    return str(_q(d))


def _parse_money(s: str | None) -> Decimal:
    if s is None:
        return Decimal("0")
    try:
        return _q(Decimal(str(s).replace(",", "")))
    except Exception:
        return Decimal("0")


def get_company_cutover_date(company: Company) -> date:
    if company.aquaculture_go_live_cutover_date:
        return company.aquaculture_go_live_cutover_date
    return timezone.localdate()


def set_company_cutover_date(company_id: int, cutover: date | None) -> None:
    Company.objects.filter(pk=company_id).update(aquaculture_go_live_cutover_date=cutover)


def _check(
    *,
    check_id: str,
    label: str,
    status: str,
    detail: str,
    tab: str | None = None,
    href: str | None = None,
) -> dict:
    return {
        "id": check_id,
        "label": label,
        "status": status,
        "detail": detail,
        "tab": tab,
        "href": href,
    }


def _inventory_summary(rows: list[dict]) -> dict[str, Any]:
    feed = [r for r in rows if (r.get("pos_category") or "").lower() == "feed"]
    med = [r for r in rows if (r.get("pos_category") or "").lower() == "medicine"]
    total_val = Decimal("0")
    for r in rows:
        q = _parse_money(r.get("quantity"))
        uc = _parse_money(r.get("unit_cost"))
        total_val += q * uc
    return {
        "feed_lines": len(feed),
        "medicine_lines": len(med),
        "total_lines": len(rows),
        "estimated_value": _str_money(total_val),
        "items": [
            {
                "item_id": r.get("item_id"),
                "item_name": r.get("item_name"),
                "quantity": r.get("quantity"),
                "unit": r.get("unit"),
                "pos_category": r.get("pos_category"),
            }
            for r in rows[:20]
        ],
    }


def _biology_summary(breakdown_rows: list[dict]) -> dict[str, Any]:
    species_map: dict[str, dict] = {}
    total_kg = Decimal("0")
    total_fish = 0
    for row in breakdown_rows:
        sp = (row.get("fish_species") or "tilapia").strip()
        label = (row.get("fish_species_label") or sp).strip()
        kg = _parse_money(row.get("implied_net_weight_kg"))
        fish = int(row.get("implied_net_fish_count") or 0)
        if sp not in species_map:
            species_map[sp] = {"code": sp, "label": label, "fish_count": 0, "weight_kg": Decimal("0")}
        species_map[sp]["fish_count"] += fish
        species_map[sp]["weight_kg"] += kg
        total_kg += kg
        total_fish += fish
    species = []
    for sp, data in sorted(species_map.items(), key=lambda x: x[1]["label"].lower()):
        species.append(
            {
                "code": data["code"],
                "label": data["label"],
                "fish_count": data["fish_count"],
                "weight_kg": _str_money(data["weight_kg"]),
            }
        )
    return {
        "species": species,
        "total_fish_count": total_fish,
        "total_weight_kg": _str_money(total_kg),
        "has_biomass": total_kg > 0 or total_fish > 0,
    }


def _bioasset_estimate(summary: dict, biology: dict) -> dict[str, Any]:
    expense = _parse_money(summary.get("totals", {}).get("pl_expense_signed"))
    expense_abs = abs(expense)
    biomass_kg = _parse_money(biology.get("total_weight_kg"))
    income = _parse_money(summary.get("totals", {}).get("pl_income_signed"))
    if biomass_kg > 0 and expense_abs > 0:
        cost_per_kg = _q(expense_abs / biomass_kg)
        estimated = _q(biomass_kg * cost_per_kg)
        method = "prior_expense_per_kg"
    elif biomass_kg > 0:
        cost_per_kg = Decimal("0")
        estimated = Decimal("0")
        method = "needs_expense_or_book_value"
    else:
        cost_per_kg = Decimal("0")
        estimated = Decimal("0")
        method = "needs_biomass"
    return {
        "estimated_value": _str_money(estimated),
        "cost_per_kg": _str_money(cost_per_kg) if cost_per_kg else None,
        "biomass_kg": biology.get("total_weight_kg"),
        "prior_expense_signed": _str_money(expense_abs),
        "prior_income_signed": _str_money(income),
        "method": method,
        "note": (
            "Estimate = biomass kg × (prior expense ÷ biomass kg). "
            "Enter prior expense on Expense tab and fish count/weight on Fish tab for a meaningful value."
        ),
    }


def _contract_years_rounded_int(start: date, end: date) -> int | None:
    if not start or not end or end < start:
        return None
    days = (end - start).days + 1
    return max(1, round(days / 365.25))


def _remaining_years_months(period_start: date, period_end: date) -> tuple[int, int]:
    if period_end < period_start:
        return 0, 0
    months = (period_end.year - period_start.year) * 12 + (period_end.month - period_start.month)
    if period_end.day < period_start.day:
        months -= 1
    months = max(0, months)
    return months // 12, months % 12


def _lease_snapshot(pond: AquaculturePond) -> dict[str, Any]:
    today = timezone.localdate()
    size = pond.leasing_area_decimal
    price = pond.lease_price_per_decimal_per_year
    start = pond.lease_contract_start
    end = pond.lease_contract_end
    paid = _q(pond.lease_paid_to_landlord)

    annual: Decimal | None = None
    if size is not None and price is not None:
        annual = _q(size * price)

    contract_years: int | None = None
    contract_total: Decimal | None = None
    if start and end and end >= start:
        contract_years = _contract_years_rounded_int(start, end)
        if annual is not None and contract_years is not None:
            contract_total = _q(annual * Decimal(contract_years))

    rem_y, rem_m = None, None
    if end:
        ref = max(today, start) if start else today
        rem_y, rem_m = _remaining_years_months(ref, end)

    balance: Decimal | None = None
    if contract_total is not None:
        balance = _q(contract_total - paid)

    has_contract = bool(start or end or size or price)
    return {
        "has_contract": has_contract,
        "contract_total": _str_money(contract_total) if contract_total is not None else None,
        "paid_to_landlord": _str_money(paid),
        "balance_due": _str_money(balance) if balance is not None else None,
        "remaining_years": rem_y,
        "remaining_months": rem_m,
    }


def _landlord_status(company_id: int, pond_id: int) -> tuple[str, str]:
    shares = list(
        AquacultureLandlordPondShare.objects.filter(
            pond_id=pond_id, landlord__company_id=company_id
        ).select_related("landlord")
    )
    if not shares:
        return "na", "No landlord linked to this pond."
    missing = []
    for sh in shares:
        ll = sh.landlord
        ob = _q(ll.opening_balance)
        if ob != 0 and not ll.opening_balance_date:
            missing.append((ll.name or f"Landlord #{ll.id}").strip())
    if missing:
        return "missing", f"Opening balance date needed for: {', '.join(missing)}."
    return "complete", f"{len(shares)} landlord share(s) — openings on Landlords screen."


def _readiness_checks(
    *,
    summary: dict,
    pond: AquaculturePond,
    biology: dict,
    inventory: dict,
    lease: dict,
    landlord_status: str,
    landlord_detail: str,
) -> list[dict]:
    checks: list[dict] = []
    pl_income = _parse_money(summary.get("totals", {}).get("pl_income_signed"))
    pl_expense = _parse_money(summary.get("totals", {}).get("pl_expense_signed"))
    pl_expense_abs = abs(pl_expense)
    if pl_income > 0 or pl_expense_abs > 0:
        pl_status, pl_detail = "complete", "Prior income and/or expense recorded."
    elif getattr(pond, "prior_pl_zero_confirmed_at", None):
        pl_status, pl_detail = (
            "complete",
            "No prior P&L before cutover — confirmed zero at go-live.",
        )
    elif pond.is_active and (pond.pond_role or "grow_out") == "grow_out":
        pl_status, pl_detail = (
            "missing",
            "Enter prior revenue and costs for this crop (Income and Expense tabs).",
        )
    else:
        pl_status, pl_detail = "optional", "No prior P&L entered (optional for inactive or non grow-out ponds)."

    checks.append(
        _check(
            check_id="pl",
            label="Prior P&L (income & expense)",
            status=pl_status,
            detail=pl_detail,
            tab="income",
        )
    )

    if pond.pos_customer_id:
        cust_lines = [ln for ln in summary.get("balance_sheet_lines", []) if ln.get("kind") == "customer"]
        if cust_lines:
            ob = _parse_money(cust_lines[0].get("opening_balance"))
            dt = cust_lines[0].get("opening_balance_date")
            if ob != 0 and not dt:
                c_status, c_detail = "missing", "Customer owes money — set opening balance and as-of date."
            else:
                c_status, c_detail = "complete", "Customer A/R opening captured (zero is OK)."
        else:
            c_status, c_detail = "warning", "POS customer linked — confirm A/R opening on Customers tab."
        checks.append(
            _check(
                check_id="customer",
                label="Customer A/R",
                status=c_status,
                detail=c_detail,
                tab="customer",
            )
        )
    elif pond.is_active and (pond.pond_role or "grow_out") == "grow_out":
        checks.append(
            _check(
                check_id="customer",
                label="Customer A/R",
                status="optional",
                detail="No POS customer on pond — link one on Edit pond if you track on-account sales.",
                tab="customer",
            )
        )

    adv_kinds = ("vendor", "employee", "loan")
    adv_lines = [ln for ln in summary.get("balance_sheet_lines", []) if ln.get("kind") in adv_kinds]
    if not adv_lines:
        checks.append(
            _check(
                check_id="parties",
                label="Vendor / employee / loan",
                status="na",
                detail="No pond-linked vendor, employee, or loan openings.",
                tab="vendor",
            )
        )
    else:
        bad = [
            ln.get("name") or ln.get("kind")
            for ln in adv_lines
            if _parse_money(ln.get("opening_balance")) != 0 and not ln.get("opening_balance_date")
        ]
        if bad:
            p_status, p_detail = "missing", f"Set as-of date for: {', '.join(bad)}."
        else:
            p_status, p_detail = "complete", f"{len(adv_lines)} linked party opening(s) OK."
        checks.append(
            _check(
                check_id="parties",
                label="Vendor / employee / loan",
                status=p_status,
                detail=p_detail,
                tab="vendor",
            )
        )

    if biology.get("has_biomass"):
        b_status, b_detail = (
            "complete",
            f"{biology.get('total_fish_count', 0):,} fish, {biology.get('total_weight_kg')} kg on hand.",
        )
    elif pond.is_active:
        b_status, b_detail = (
            "missing",
            "Record opening fish count and weight (species-wise) on the Fish tab.",
        )
    else:
        b_status, b_detail = "optional", "No fish biomass recorded."
    checks.append(
        _check(
            check_id="biomass",
            label="Fish biomass (species)",
            status=b_status,
            detail=b_detail,
            tab="fish",
        )
    )

    needs_feed = bool(getattr(pond, "default_feed_item_id", None))
    needs_med = bool(getattr(pond, "default_medicine_item_id", None))
    if not needs_feed and not needs_med and inventory.get("total_lines", 0) == 0:
        i_status, i_detail = "optional", "No default feed/medicine on pond — add stock if you keep inventory at pond."
    elif inventory.get("total_lines", 0) > 0:
        i_status, i_detail = (
            "complete",
            f"{inventory.get('total_lines')} item(s) on hand (~{inventory.get('estimated_value')} value).",
        )
    elif needs_feed or needs_med:
        i_status, i_detail = (
            "warning",
            "Default feed or medicine set but pond warehouse is empty — transfer stock from shop.",
        )
    else:
        i_status, i_detail = "optional", "No pond warehouse stock yet."
    checks.append(
        _check(
            check_id="inventory",
            label="Feed & medicine on hand",
            status=i_status,
            detail=i_detail,
            tab="inventory",
        )
    )

    if not lease.get("has_contract"):
        checks.append(
            _check(
                check_id="lease",
                label="Lease contract",
                status="na",
                detail="No lease contract on this pond.",
                tab="lease_paid",
            )
        )
    elif lease.get("balance_due") is not None:
        checks.append(
            _check(
                check_id="lease",
                label="Lease contract",
                status="complete",
                detail=f"Remaining on contract: {lease.get('balance_due')} (after prepaid rent).",
                tab="lease_paid",
            )
        )
    else:
        checks.append(
            _check(
                check_id="lease",
                label="Lease contract",
                status="warning",
                detail="Lease dates or pricing incomplete — finish on Edit pond.",
                tab="lease_paid",
            )
        )

    checks.append(
        _check(
            check_id="landlord",
            label="Landlord rent ledger",
            status=landlord_status,
            detail=landlord_detail,
            href="/aquaculture/landlords",
        )
    )
    return checks


def _score_checks(checks: list[dict]) -> tuple[int, bool]:
    weights = {
        "pl": 20,
        "customer": 10,
        "parties": 10,
        "biomass": 20,
        "inventory": 10,
        "lease": 10,
        "landlord": 10,
    }
    earned = 0
    possible = 0
    blocking = False
    for c in checks:
        cid = c["id"]
        w = weights.get(cid, 5)
        st = c["status"]
        if st == "na":
            continue
        possible += w
        if st == "complete":
            earned += w
        elif st in ("missing", "warning"):
            if st == "missing" and cid in ("pl", "biomass", "customer"):
                blocking = True
            if st == "missing":
                earned += 0
            else:
                earned += w // 2
        elif st == "optional":
            earned += w
    pct = int(round(100 * earned / possible)) if possible else 100
    ready = pct >= 85 and not blocking
    return pct, ready


def build_pond_go_live_block(
    *,
    company_id: int,
    summary: dict,
    pond: AquaculturePond,
    breakdown_rows: list[dict],
    inventory_rows: list[dict],
) -> dict[str, Any]:
    biology = _biology_summary(breakdown_rows)
    inventory = _inventory_summary(inventory_rows)
    lease = _lease_snapshot(pond)
    ll_status, ll_detail = _landlord_status(company_id, pond.id)
    checks = _readiness_checks(
        summary=summary,
        pond=pond,
        biology=biology,
        inventory=inventory,
        lease=lease,
        landlord_status=ll_status,
        landlord_detail=ll_detail,
    )
    pct, ready = _score_checks(checks)
    bioasset = _bioasset_estimate(summary, biology)
    return {
        "readiness_percent": pct,
        "ready": ready,
        "checks": checks,
        "biology": biology,
        "inventory": inventory,
        "bioasset": bioasset,
        "lease": lease,
    }


def build_opening_balances_payload(company_id: int) -> dict[str, Any]:
    company = Company.objects.filter(pk=company_id).first()
    cutover = get_company_cutover_date(company) if company else timezone.localdate()

    summaries = build_all_pond_opening_summaries(company_id)
    ponds = {
        p.id: p
        for p in AquaculturePond.objects.filter(company_id=company_id)
        .select_related("pos_customer", "default_feed_item", "default_medicine_item")
        .order_by("sort_order", "id")
    }

    breakdown_all = compute_fish_stock_position_breakdown_rows(
        company_id, include_inactive_ponds=True
    )
    breakdown_by_pond: dict[int, list[dict]] = defaultdict(list)
    for row in breakdown_all:
        breakdown_by_pond[int(row["pond_id"])].append(row)

    inventory_by_pond: dict[int, list[dict]] = defaultdict(list)
    for row in pond_warehouse_stock_matrix(company_id):
        inventory_by_pond[int(row["pond_id"])].append(row)

    ready_count = 0
    for s in summaries:
        pond = ponds.get(s["pond_id"])
        if not pond:
            s["go_live"] = {"readiness_percent": 0, "ready": False, "checks": []}
            continue
        gl = build_pond_go_live_block(
            company_id=company_id,
            summary=s,
            pond=pond,
            breakdown_rows=breakdown_by_pond.get(s["pond_id"], []),
            inventory_rows=inventory_by_pond.get(s["pond_id"], []),
        )
        s["go_live"] = gl
        if gl.get("ready"):
            ready_count += 1

    total = len(summaries)
    return {
        "cutover_date": cutover.isoformat(),
        "go_live": {
            "ready_ponds": ready_count,
            "total_ponds": total,
            "ready_percent": int(round(100 * ready_count / total)) if total else 0,
            "message": (
                "Enter each track as of the cutover date. After go-live, use Sales, Expenses, "
                "Feeding, Stock, and Landlords for day-to-day activity."
            ),
        },
        "ponds": summaries,
        "catalog": category_catalog_for_api(company_id),
        "conventions": {
            "pl_income": "Prior revenue by income type since crop start (not G/L).",
            "pl_expense": "Prior costs by expense category — exclude lease; use Landlords for rent.",
            "customer": "Unpaid on-account sales (A/R) still outstanding at cutover.",
            "landlords": "Landlord rent opening on Aquaculture → Landlords only.",
            "advanced": "Vendor, employee, and loan party openings when linked to this pond.",
            "biomass": "Fish count and weight by species — biological snapshot at cutover.",
            "inventory": "Feed and medicine physically at the pond warehouse.",
            "bioasset": "Estimated fish asset from biomass × prior cost per kg (informational).",
        },
    }
