"""Aquaculture: ponds, expenses, fish sales, biomass samples, P&L summary (company module)."""
from __future__ import annotations

import re
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.db.models import Case, Count, DecimalField, F, Prefetch, Q, Sum, Value, When
from django.db.models.functions import Greatest
from django.http import JsonResponse
from django.utils import timezone as django_timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from api.exceptions import GlPostingError, StockBusinessError
from api.models import (
    AquacultureBiomassSample,
    AquacultureExpense,
    AquacultureExpensePondShare,
    AquacultureFeedingAdvice,
    AquacultureFishPondTransfer,
    AquacultureFishPondTransferLine,
    AquacultureFishSale,
    AquacultureFishStockLedger,
    AquacultureLandlord,
    AquacultureLandlordLedgerEntry,
    AquacultureLandlordPondShare,
    AquaculturePond,
    AquaculturePondProfitTransfer,
    AquacultureProductionCycle,
    BankAccount,
    ChartOfAccount,
    Company,
    Customer,
    Item,
    JournalEntry,
    JournalEntryLine,
    Station,
)
from api.views.journal_entries_views import _entry_to_json
from api.services.aquaculture_feeding_advice_service import build_feeding_advice_payload, effective_advice_text
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.services.aquaculture_transfer_cost import (
    backfill_missing_transfer_line_costs,
    resolve_auto_transfer_line_cost,
)
from api.services.aquaculture_biomass_sample_service import apply_aquaculture_biomass_sample_extrapolation
from api.services.aquaculture_stock_service import (
    compute_fish_stock_position_breakdown_rows,
    compute_fish_stock_position_rows,
)
from api.services.aquaculture_fish_biomass_ledger_service import (
    SOURCE_LABELS as FISH_BIOMASS_LEDGER_SOURCE_LABELS,
    compute_fish_biomass_ledger_rows,
)
from api.services.aquaculture_pond_consumption_ledger_service import (
    CONSUMPTION_KIND_LABELS,
    compute_pond_warehouse_consumption_rows,
)
from api.services.aquaculture_units import (
    compute_water_surface_sq_ft,
    compute_water_volume_cu_ft,
    format_pond_area_decimal_for_api,
    format_two_decimal_places_for_api,
    metres_to_feet,
    quantize_pond_area_decimal,
    quantize_two_decimal_places,
)
from api.services.aquaculture_expense_cleanup import (
    aquaculture_expense_has_posting_effects,
    cleanup_aquaculture_expense_posting_effects,
    sync_aquaculture_expense_posting_effects,
)
from api.services.aquaculture_sale_cleanup import (
    cleanup_aquaculture_fish_sale_effects,
    reconcile_aquaculture_fish_sale_with_invoice,
)
from api.services.gl_posting import (
    delete_landlord_lease_payment_journal,
    item_inventory_unit_cost,
    post_aquaculture_fish_stock_ledger_journal,
    sync_landlord_lease_payment_journal,
)
from api.services.aquaculture_production_cycle_service import cycle_code_conflict, next_automatic_cycle_code
from api.services.aquaculture_pond_pos_customer import (
    maybe_provision_auto_pos_customer,
    on_pond_deleted,
    on_pond_pos_customer_cleared,
    on_pond_pos_customer_replaced,
    provision_missing_pond_pos_customers,
    sync_auto_pos_customer_from_pond,
)
from api.services.aquaculture_sale_biomass_sync import sync_biomass_sample_from_fish_sale
from api.services.aquaculture_biomass_sample_reference_service import last_biomass_sample_reference_for_ledger
from api.services.aquaculture_sale_reference_service import last_fish_sale_reference_for_ledger
from api.services.aquaculture_pond_stock_service import (
    consume_pond_feed_on_advice_apply,
    consume_pond_warehouse_stock,
    feed_inventory_qty_from_kg,
    pond_warehouse_stock_matrix,
    pond_warehouse_stock_rows,
    transfer_station_stock_to_pond_warehouse,
)
from api.services.aquaculture_shop_stock import execute_aquaculture_shop_stock_issue
from api.services.tenant_reporting_categories import (
    aquaculture_expense_label,
    aquaculture_income_label,
    income_type_is_non_biological_for_company,
    manual_aquaculture_expense_category_change_allowed_for_company,
    merged_aquaculture_expense_category_list_for_api,
    merged_aquaculture_income_type_list_for_api,
    normalize_expense_category_for_company,
    normalize_income_type_for_company,
    resolve_aquaculture_expense_to_builtin,
)
from api.services.aquaculture_data_bank_service import (
    assert_ponds_writable,
    effective_pl_start_for_pond,
    filter_live_pond_queryset,
    pond_live_data_after_date,
    pond_lock_summary,
    pond_write_blocked_detail,
)
from api.services.aquaculture_constants import (
    AQUACULTURE_FISH_SPECIES_CHOICES,
    AQUACULTURE_POND_ROLE_CHOICES,
    INTER_POND_FISH_TRANSFER_PL_NOTE,
    POND_ROLE_LABELS,
    STOCK_LEDGER_COA_NOTE,
    STOCK_LEDGER_ENTRY_KIND_CHOICES,
    STOCK_LEDGER_ENTRY_KIND_LABELS,
    STOCK_LEDGER_LOSS_REASON_CHOICES,
    STOCK_LEDGER_LOSS_REASON_LABELS,
    fish_species_display_label,
    normalize_fish_species,
    normalize_fish_species_other,
    normalize_pond_role,
    normalize_stock_ledger_entry_kind,
    normalize_stock_ledger_loss_reason,
)
from api.services.permission_service import user_may_access_aquaculture_api
from api.utils.auth import auth_required
from api.views.common import parse_json_body, require_company_id


def _decimal(val, default="0") -> Decimal:
    if val is None:
        return Decimal(default)
    try:
        return Decimal(str(val))
    except Exception:
        return Decimal(default)


def _parse_date(val) -> date | None:
    if not val:
        return None
    try:
        return date.fromisoformat(str(val).split("T")[0])
    except (TypeError, ValueError):
        return None


def _money_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"))


def _json_bool(value) -> bool:
    """Interpret JSON / form-style booleans; ``bool("false")`` in Python is True — avoid that."""
    if value is True:
        return True
    if value is False or value is None:
        return False
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        s = value.strip().lower()
        if s in ("0", "false", "no", "off", ""):
            return False
        if s in ("1", "true", "yes", "on"):
            return True
    return bool(value)


def _optional_json_bool(value):
    """``None`` = client omitted the key; otherwise same coercion as ``_json_bool``."""
    if value is None:
        return None
    return _json_bool(value)


def _contract_fractional_years(start: date, end: date) -> Decimal:
    """Year fraction using average year length (365.25 days), before rounding to whole years."""
    if not start or not end or end < start:
        return Decimal(0)
    days = (end - start).days
    if days <= 0:
        return Decimal(0)
    return (Decimal(days) / Decimal("365.25")).quantize(Decimal("0.0001"))


def _contract_years_rounded_int(start: date, end: date) -> int | None:
    """Whole contract length in years (half-up), for display and lease total."""
    if not start or not end or end < start:
        return None
    frac = _contract_fractional_years(start, end)
    if frac <= 0:
        return 0
    return int(frac.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _remaining_years_months(period_start: date, period_end: date) -> tuple[int, int]:
    """Whole years and months from period_start through period_end (end-inclusive style)."""
    if period_start > period_end:
        return 0, 0
    y1, m1, d1 = period_start.year, period_start.month, period_start.day
    y2, m2, d2 = period_end.year, period_end.month, period_end.day
    months = (y2 - y1) * 12 + (m2 - m1)
    if d2 < d1:
        months -= 1
    months = max(0, months)
    return divmod(months, 12)


def _apply_pond_lease_fields(p: AquaculturePond, body: dict) -> str | None:
    """Mutate pond lease-related fields from JSON body. Returns error message or None."""
    if "leasing_area_decimal" in body or "pond_size_decimal" in body:
        if "leasing_area_decimal" in body:
            raw = body.get("leasing_area_decimal")
        else:
            raw = body.get("pond_size_decimal")
        if raw in (None, ""):
            p.leasing_area_decimal = None
        else:
            p.leasing_area_decimal = quantize_pond_area_decimal(_decimal(raw))
            if p.leasing_area_decimal < 0:
                return "leasing_area_decimal cannot be negative"
    if "lease_contract_start" in body:
        if body.get("lease_contract_start") in (None, ""):
            p.lease_contract_start = None
        else:
            sd = _parse_date(body.get("lease_contract_start"))
            if not sd:
                return "lease_contract_start must be YYYY-MM-DD"
            p.lease_contract_start = sd
    if "lease_contract_end" in body:
        if body.get("lease_contract_end") in (None, ""):
            p.lease_contract_end = None
        else:
            ed = _parse_date(body.get("lease_contract_end"))
            if not ed:
                return "lease_contract_end must be YYYY-MM-DD"
            p.lease_contract_end = ed
    if "lease_price_per_decimal_per_year" in body:
        raw = body.get("lease_price_per_decimal_per_year")
        if raw in (None, ""):
            p.lease_price_per_decimal_per_year = None
        else:
            p.lease_price_per_decimal_per_year = quantize_two_decimal_places(_decimal(raw))
            if p.lease_price_per_decimal_per_year < 0:
                return "lease_price_per_decimal_per_year cannot be negative"
    if "lease_paid_to_landlord" in body:
        p.lease_paid_to_landlord = _money_q(_decimal(body.get("lease_paid_to_landlord"), "0"))
        if p.lease_paid_to_landlord < 0:
            return "lease_paid_to_landlord cannot be negative"
    if p.lease_contract_start and p.lease_contract_end and p.lease_contract_end < p.lease_contract_start:
        return "lease_contract_end must be on or after lease_contract_start"
    return None


def _apply_pond_aquaculture_fields(p: AquaculturePond, body: dict) -> str | None:
    """Mutate water surface area and depth from JSON. Returns error message or None."""
    if "water_area_decimal" in body:
        raw = body.get("water_area_decimal")
        if raw in (None, ""):
            p.water_area_decimal = None
        else:
            p.water_area_decimal = quantize_pond_area_decimal(_decimal(raw))
            if p.water_area_decimal < 0:
                return "water_area_decimal cannot be negative"
    depth_set = False
    if "pond_depth_ft" in body:
        raw = body.get("pond_depth_ft")
        if raw in (None, ""):
            p.pond_depth_ft = None
        else:
            p.pond_depth_ft = quantize_two_decimal_places(_decimal(raw))
            if p.pond_depth_ft < 0:
                return "pond_depth_ft cannot be negative"
        depth_set = True
    if not depth_set and "pond_depth_m" in body:
        raw = body.get("pond_depth_m")
        if raw in (None, ""):
            p.pond_depth_ft = None
        else:
            dm = _decimal(raw)
            if dm < 0:
                return "pond_depth_m cannot be negative"
            p.pond_depth_ft = quantize_two_decimal_places(metres_to_feet(dm))
    return None


def _apply_pond_default_feed_item(p: AquaculturePond, body: dict, company_id: int) -> str | None:
    """Set optional default feed inventory item for pond warehouse consumption. Returns error or None."""
    if "default_feed_item_id" not in body:
        return None
    raw = body.get("default_feed_item_id")
    if raw in (None, ""):
        p.default_feed_item_id = None
        return None
    try:
        iid = int(raw)
    except (TypeError, ValueError):
        return "default_feed_item_id must be an integer or null"
    it = Item.objects.filter(pk=iid, company_id=company_id).first()
    if not it:
        return "default_feed_item_id must refer to an item in this company"
    if not it.is_active:
        return "default_feed_item_id must refer to an active item"
    p.default_feed_item_id = iid
    return None


def _apply_pond_default_medicine_item(p: AquaculturePond, body: dict, company_id: int) -> str | None:
    """Set optional default medicine inventory item for pond warehouse consumption. Returns error or None."""
    if "default_medicine_item_id" not in body:
        return None
    raw = body.get("default_medicine_item_id")
    if raw in (None, ""):
        p.default_medicine_item_id = None
        return None
    try:
        iid = int(raw)
    except (TypeError, ValueError):
        return "default_medicine_item_id must be an integer or null"
    it = Item.objects.filter(pk=iid, company_id=company_id).first()
    if not it:
        return "default_medicine_item_id must refer to an item in this company"
    if not it.is_active:
        return "default_medicine_item_id must refer to an active item"
    p.default_medicine_item_id = iid
    return None


def _apply_pond_pos_customer(p: AquaculturePond, body: dict, company_id: int) -> str | None:
    """Mutate pond POS customer link from JSON. Returns error message or None."""
    if "pos_customer_id" not in body:
        return None
    raw = body.get("pos_customer_id")
    if raw in (None, ""):
        p.pos_customer_id = None
        p.auto_pos_customer = False
        return None
    try:
        cust_id = int(raw)
    except (TypeError, ValueError):
        return "pos_customer_id must be an integer or null"
    cust = Customer.objects.filter(pk=cust_id, company_id=company_id).first()
    if not cust:
        return "pos_customer_id must refer to a customer in this company"
    if not cust.is_active and p.pos_customer_id != cust_id:
        return "pos_customer_id must be an active customer"
    p.pos_customer_id = cust_id
    p.auto_pos_customer = False
    return None


def _apply_expense_feed_metrics_from_body(x: AquacultureExpense, body: dict) -> str | None:
    """Mutate optional feed sack / kg fields when present in JSON."""
    for key, field in (("feed_sack_count", "feed_sack_count"), ("feed_weight_kg", "feed_weight_kg")):
        if key not in body:
            continue
        raw = body.get(key)
        if raw in (None, ""):
            setattr(x, field, None)
            continue
        v = _decimal(str(raw))
        if v < 0:
            return f"{key} cannot be negative"
        setattr(x, field, v)
    return None


def _pond_lease_derived(p: AquaculturePond, today: date) -> dict:
    """Computed lease figures for API consumers (not stored)."""
    size = p.leasing_area_decimal
    price = p.lease_price_per_decimal_per_year
    start = p.lease_contract_start
    end = p.lease_contract_end
    paid = p.lease_paid_to_landlord if p.lease_paid_to_landlord is not None else Decimal(0)

    annual: Decimal | None = None
    if size is not None and price is not None:
        annual = _money_q(size * price)

    contract_years_rounded: int | None = None
    contract_total: Decimal | None = None
    if start and end and end >= start:
        contract_years_rounded = _contract_years_rounded_int(start, end)
        if annual is not None and contract_years_rounded is not None:
            contract_total = _money_q(annual * Decimal(contract_years_rounded))

    rem_y: int | None = None
    rem_m: int | None = None
    if end:
        ref = max(today, start) if start else today
        rem_y, rem_m = _remaining_years_months(ref, end)

    balance: Decimal | None = None
    if contract_total is not None:
        balance = _money_q(contract_total - paid)

    return {
        "lease_annual_amount": str(annual) if annual is not None else None,
        "lease_contract_years": (
            str(contract_years_rounded) if contract_years_rounded is not None else None
        ),
        "lease_contract_total": str(contract_total) if contract_total is not None else None,
        "lease_remaining_years": rem_y,
        "lease_remaining_months": rem_m,
        "lease_balance_due": str(balance) if balance is not None else None,
    }


def _equal_split_amounts(total: Decimal, pond_ids: list[int]) -> list[tuple[int, Decimal]]:
    """Split total into len(pond_ids) currency amounts that sum exactly to total (cent fairness)."""
    n = len(pond_ids)
    total_cents = int(_money_q(total) * 100)
    base = total_cents // n
    rem = total_cents % n
    out: list[tuple[int, Decimal]] = []
    for i, pid in enumerate(pond_ids):
        cents = base + (1 if i < rem else 0)
        out.append((pid, Decimal(cents) / Decimal(100)))
    return out


def _ponds_valid_for_company(company_id: int, pond_ids: list[int]) -> bool:
    if not pond_ids:
        return False
    return AquaculturePond.objects.filter(company_id=company_id, pk__in=pond_ids).count() == len(set(pond_ids))


def _parse_shared_expense_plan(
    body: dict, company_id: int, total_amount: Decimal
) -> tuple[list[tuple[int, Decimal]] | None, str | None]:
    """
    Parse shared split for an expense with pond=null.
    Returns (list of (pond_id, amount), error_message).
    """
    eq = body.get("shared_equal_pond_ids")
    raw_shares = body.get("pond_shares")
    if eq is not None and raw_shares is not None:
        return None, "Use either shared_equal_pond_ids or pond_shares, not both."
    if eq is not None:
        if not isinstance(eq, list) or len(eq) < 2:
            return None, "shared_equal_pond_ids must be a list of at least two pond ids."
        try:
            pids = [int(x) for x in eq]
        except (TypeError, ValueError):
            return None, "shared_equal_pond_ids must be integers."
        if len(set(pids)) < 2:
            return None, "shared_equal_pond_ids must name at least two distinct ponds."
        if not _ponds_valid_for_company(company_id, pids):
            return None, "One or more pond ids are invalid for this company."
        return _equal_split_amounts(_money_q(total_amount), pids), None
    if raw_shares is not None:
        if not isinstance(raw_shares, list) or len(raw_shares) < 2:
            return None, "pond_shares must be a list with at least two {pond_id, amount} rows."
        pairs: list[tuple[int, Decimal]] = []
        seen: set[int] = set()
        for row in raw_shares:
            if not isinstance(row, dict):
                return None, "Each pond_shares row must be an object."
            try:
                pid = int(row.get("pond_id"))
            except (TypeError, ValueError):
                return None, "pond_id in pond_shares must be an integer."
            if pid in seen:
                return None, "Duplicate pond_id in pond_shares."
            seen.add(pid)
            amt = _decimal(row.get("amount"))
            if amt <= 0:
                return None, "Each pond_shares amount must be greater than zero."
            pairs.append((pid, _money_q(amt)))
        if len(seen) < 2:
            return None, "pond_shares must cover at least two distinct ponds."
        if not _ponds_valid_for_company(company_id, list(seen)):
            return None, "One or more pond ids in pond_shares are invalid for this company."
        sm = sum(a for _, a in pairs)
        if _money_q(sm) != _money_q(total_amount):
            return None, "pond_shares must sum exactly to the expense amount (two decimal places)."
        return pairs, None
    return None, "Shared expense requires shared_equal_pond_ids or pond_shares."


def _cycle_for_company(company_id: int, cycle_id: int) -> AquacultureProductionCycle | None:
    return AquacultureProductionCycle.objects.filter(pk=cycle_id, company_id=company_id).first()


def _cycle_to_json(c: AquacultureProductionCycle) -> dict:
    return {
        "id": c.id,
        "pond_id": c.pond_id,
        "name": c.name or "",
        "code": c.code or "",
        "start_date": c.start_date.isoformat(),
        "end_date": c.end_date.isoformat() if c.end_date else None,
        "sort_order": c.sort_order,
        "is_active": c.is_active,
        "notes": c.notes or "",
        "created_at": c.created_at.isoformat() if c.created_at else "",
        "updated_at": c.updated_at.isoformat() if c.updated_at else "",
    }


def _aquaculture_access(request) -> JsonResponse | None:
    """
    Tenant must have the module enabled (superuser). Only the tenant Admin account or a
    platform super-admin may use aquaculture APIs.
    """
    c = Company.objects.filter(pk=request.company_id).only("aquaculture_enabled").first()
    if not c or not getattr(c, "aquaculture_enabled", False):
        return JsonResponse(
            {
                "detail": "Aquaculture is not enabled for this company. Ask a platform administrator to turn it on in Company settings.",
            },
            status=403,
        )
    user = getattr(request, "api_user", None)
    if not user_may_access_aquaculture_api(user):
        return JsonResponse(
            {
                "detail": "Aquaculture requires Admin or app.aquaculture permission for this tenant.",
            },
            status=403,
        )
    return None


def _pond_for_company(company_id: int, pond_id: int) -> AquaculturePond | None:
    return AquaculturePond.objects.filter(pk=pond_id, company_id=company_id).first()


def _pond_write_lock_response(
    company_id: int,
    pond_id: int,
    transaction_date: date | None = None,
):
    detail = pond_write_blocked_detail(company_id, pond_id, transaction_date)
    if detail:
        return JsonResponse({"detail": detail, "code": "pond_data_locked"}, status=409)
    return None


def _ponds_write_lock_response(
    company_id: int,
    pond_ids: list[int],
    transaction_date: date | None = None,
):
    detail = assert_ponds_writable(company_id, pond_ids, transaction_date)
    if detail:
        return JsonResponse({"detail": detail, "code": "pond_data_locked"}, status=409)
    return None


_POND_AUTO_CODE = re.compile(r"^[pP](\d+)$")


def _pond_code_serial(code: str) -> int | None:
    m = _POND_AUTO_CODE.match((code or "").strip())
    return int(m.group(1)) if m else None


def _occupied_pond_code_serials(company_id: int, exclude_pond_id: int | None = None) -> set[int]:
    qs = AquaculturePond.objects.filter(company_id=company_id)
    if exclude_pond_id is not None:
        qs = qs.exclude(pk=exclude_pond_id)
    out: set[int] = set()
    for c in qs.values_list("code", flat=True):
        n = _pond_code_serial(c or "")
        if n is not None:
            out.add(n)
    return out


def _format_auto_pond_code(n: int, occupied: set[int]) -> str:
    width = max(2, len(str(n)))
    if occupied:
        width = max(width, max((len(str(x)) for x in occupied), default=0))
    return "P" + str(n).zfill(width)


def _next_automatic_pond_code(company_id: int) -> str:
    """Smallest unused P + serial code (P01, P02, …), filling gaps (e.g. only P02 → next is P01)."""
    occupied = _occupied_pond_code_serials(company_id)
    m = 1
    while m in occupied:
        m += 1
    return _format_auto_pond_code(m, occupied)


def _pond_code_conflict(company_id: int, code: str, exclude_pond_id: int | None) -> bool:
    c = (code or "").strip()
    if not c:
        return False
    qs = AquaculturePond.objects.filter(company_id=company_id, code__iexact=c)
    if exclude_pond_id is not None:
        qs = qs.exclude(pk=exclude_pond_id)
    return qs.exists()


def _tilapia_load_fields(stock_row: dict | None) -> dict:
    """Pond JSON extras: tilapia-only implied stock and kg-per-decimal load (from movements + pond water area)."""
    if not stock_row:
        return {
            "tilapia_net_fish_count": None,
            "tilapia_net_weight_kg": None,
            "tilapia_kg_per_decimal": None,
            "tilapia_kg_per_1000_cu_ft": None,
            "tilapia_load_level": None,
            "tilapia_load_level_label": None,
        }
    return {
        "tilapia_net_fish_count": stock_row.get("implied_net_fish_count"),
        "tilapia_net_weight_kg": stock_row.get("implied_net_weight_kg"),
        "tilapia_kg_per_decimal": stock_row.get("stock_density_kg_per_decimal"),
        "tilapia_kg_per_1000_cu_ft": stock_row.get("stock_density_kg_per_1000_cu_ft"),
        "tilapia_load_level": stock_row.get("load_level"),
        "tilapia_load_level_label": stock_row.get("load_level_label"),
    }


def _fetch_tilapia_stock_row_for_pond(company_id: int, pond_id: int) -> dict | None:
    rows = compute_fish_stock_position_rows(
        company_id,
        pond_id=pond_id,
        fish_species_filter="tilapia",
        include_inactive_ponds=True,
        entries_after_date=pond_live_data_after_date(company_id, pond_id),
    )
    return rows[0] if rows else None


def _landlord_pond_share_json(sh: AquacultureLandlordPondShare) -> dict:
    ll = sh.landlord
    return {
        "id": sh.id,
        "landlord_id": sh.landlord_id,
        "landlord_name": (ll.name or "").strip() if ll else "",
        "landlord_code": (getattr(ll, "code", None) or "").strip() if ll else "",
        "land_area_decimal": str(sh.land_area_decimal),
        "notes": (sh.notes or "").strip(),
    }


def _pond_lease_payment_status_payload(p: AquaculturePond, lease: dict) -> dict:
    paid = _money_q(p.lease_paid_to_landlord or Decimal(0))
    return {
        "contract_total": lease.get("lease_contract_total"),
        "paid_total": str(paid),
        "outstanding": lease.get("lease_balance_due"),
    }


def _pond_to_json(
    p: AquaculturePond,
    tilapia_load: dict | None = None,
    landlord_shares: list | None = None,
) -> dict:
    today = django_timezone.localdate()
    lease = _pond_lease_derived(p, today)
    pcid = getattr(p, "pos_customer_id", None)
    pc_disp = ""
    pc = getattr(p, "pos_customer", None)
    if pc:
        pc_disp = (pc.company_name or pc.display_name or "").strip() or f"Customer #{pc.id}"
    wa = p.water_area_decimal
    d_ft = getattr(p, "pond_depth_ft", None)
    sq_ft = compute_water_surface_sq_ft(wa)
    vol_cu = compute_water_volume_cu_ft(wa, d_ft)
    out = {
        "id": p.id,
        "name": p.name or "",
        "code": p.code or "",
        "sort_order": p.sort_order,
        "is_active": p.is_active,
        "notes": p.notes or "",
        "leasing_area_decimal": format_pond_area_decimal_for_api(p.leasing_area_decimal),
        "water_area_decimal": format_pond_area_decimal_for_api(p.water_area_decimal),
        "pond_depth_ft": format_two_decimal_places_for_api(d_ft),
        "water_surface_sq_ft": str(sq_ft) if sq_ft is not None else None,
        "water_volume_cu_ft": str(vol_cu) if vol_cu is not None else None,
        "lease_contract_start": p.lease_contract_start.isoformat() if p.lease_contract_start else None,
        "lease_contract_end": p.lease_contract_end.isoformat() if p.lease_contract_end else None,
        "lease_price_per_decimal_per_year": format_two_decimal_places_for_api(
            p.lease_price_per_decimal_per_year
        ),
        "lease_paid_to_landlord": str(_money_q(p.lease_paid_to_landlord or Decimal(0))),
        **lease,
        "pos_customer_id": pcid,
        "pos_customer_display": pc_disp,
        "pos_customer_auto_managed": bool(getattr(p, "auto_pos_customer", False)),
        "default_feed_item_id": getattr(p, "default_feed_item_id", None),
        "default_feed_item_name": (
            (p.default_feed_item.name or "").strip()
            if getattr(p, "default_feed_item_id", None) and getattr(p, "default_feed_item", None)
            else ""
        ),
        "default_medicine_item_id": getattr(p, "default_medicine_item_id", None),
        "default_medicine_item_name": (
            (p.default_medicine_item.name or "").strip()
            if getattr(p, "default_medicine_item_id", None) and getattr(p, "default_medicine_item", None)
            else ""
        ),
        "pond_role": getattr(p, "pond_role", None) or "grow_out",
        "pond_role_label": POND_ROLE_LABELS.get(getattr(p, "pond_role", None) or "grow_out", "Grow-out"),
        "created_at": p.created_at.isoformat() if p.created_at else "",
        "updated_at": p.updated_at.isoformat() if p.updated_at else "",
        "landlord_pond_shares": landlord_shares if landlord_shares is not None else [],
        "lease_payment_status": _pond_lease_payment_status_payload(p, lease),
        "data_bank_lock": pond_lock_summary(p.company_id, p.id),
    }
    if tilapia_load:
        out.update(tilapia_load)
    return out


_LANDLORD_POND_SHARE_PREFETCH = Prefetch(
    "landlord_pond_shares",
    queryset=AquacultureLandlordPondShare.objects.select_related("landlord").order_by(
        "landlord__name", "id"
    ),
)


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def aquaculture_expense_categories(request):
    err = _aquaculture_access(request)
    if err:
        return err
    return JsonResponse(merged_aquaculture_expense_category_list_for_api(request.company_id), safe=False)


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def aquaculture_income_types(request):
    err = _aquaculture_access(request)
    if err:
        return err
    return JsonResponse(merged_aquaculture_income_type_list_for_api(request.company_id), safe=False)


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def aquaculture_fish_species(request):
    err = _aquaculture_access(request)
    if err:
        return err
    return JsonResponse(
        [{"id": c, "label": lbl} for c, lbl in AQUACULTURE_FISH_SPECIES_CHOICES],
        safe=False,
    )


@csrf_exempt
@require_http_methods(["GET", "POST"])
@auth_required
@require_company_id
def aquaculture_production_cycles_list_or_create(request):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    if request.method == "GET":
        qs = AquacultureProductionCycle.objects.filter(company_id=cid).select_related("pond")
        pid = request.GET.get("pond_id")
        if pid and str(pid).strip().isdigit():
            p_int = int(pid)
            qs = qs.filter(pond_id=p_int)
            qs = filter_live_pond_queryset(qs, cid, p_int, "start_date")
        qs = qs.order_by("pond_id", "sort_order", "-start_date", "id")
        return JsonResponse([_cycle_to_json(c) for c in qs], safe=False)

    body, e = parse_json_body(request)
    if e:
        return e
    try:
        pond_id = int(body.get("pond_id"))
    except (TypeError, ValueError):
        return JsonResponse({"detail": "pond_id is required and must be an integer"}, status=400)
    pond = _pond_for_company(cid, pond_id)
    if not pond:
        return JsonResponse({"detail": "Pond not found"}, status=404)
    sd = _parse_date(body.get("start_date"))
    lock_err = _pond_write_lock_response(cid, pond_id, sd)
    if lock_err:
        return lock_err
    name = (body.get("name") or "").strip()
    if not name:
        return JsonResponse({"detail": "name is required"}, status=400)
    if not sd:
        return JsonResponse({"detail": "start_date is required (YYYY-MM-DD)"}, status=400)
    ed = _parse_date(body.get("end_date")) if body.get("end_date") else None
    if ed and ed < sd:
        return JsonResponse({"detail": "end_date must be on or after start_date"}, status=400)
    auto_code = next_automatic_cycle_code(cid, pond_id)
    c = AquacultureProductionCycle(
        company_id=cid,
        pond=pond,
        name=name[:200],
        code=auto_code[:64],
        start_date=sd,
        end_date=ed,
        sort_order=int(body.get("sort_order") or 0),
        is_active=bool(body.get("is_active", True)),
        notes=(body.get("notes") or "")[:5000],
    )
    c.save()
    return JsonResponse(_cycle_to_json(c), status=201)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
@auth_required
@require_company_id
def aquaculture_production_cycle_detail(request, cycle_id: int):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    c = AquacultureProductionCycle.objects.filter(pk=cycle_id, company_id=cid).select_related("pond").first()
    if not c:
        return JsonResponse({"detail": "Not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(_cycle_to_json(c))
    if request.method == "PUT":
        lock_err = _pond_write_lock_response(cid, c.pond_id, c.start_date)
        if lock_err:
            return lock_err
        body, e = parse_json_body(request)
        if e:
            return e
        if "name" in body:
            n = (body.get("name") or "").strip()
            if n:
                c.name = n[:200]
        if "code" in body:
            new_code = (body.get("code") or "").strip()[:64]
            if new_code != (c.code or "").strip() and cycle_code_conflict(cid, c.pond_id, new_code, c.id):
                return JsonResponse(
                    {"detail": "Another cycle for this pond already uses this code."},
                    status=400,
                )
            c.code = new_code
        if "start_date" in body:
            sd = _parse_date(body.get("start_date"))
            if not sd:
                return JsonResponse({"detail": "Invalid start_date"}, status=400)
            c.start_date = sd
        if "end_date" in body:
            if body.get("end_date") in (None, ""):
                c.end_date = None
            else:
                ed = _parse_date(body.get("end_date"))
                if not ed:
                    return JsonResponse({"detail": "Invalid end_date"}, status=400)
                c.end_date = ed
        if c.end_date and c.end_date < c.start_date:
            return JsonResponse({"detail": "end_date must be on or after start_date"}, status=400)
        if "sort_order" in body:
            c.sort_order = int(body.get("sort_order") or 0)
        if "is_active" in body:
            c.is_active = bool(body["is_active"])
        if "notes" in body:
            c.notes = str(body.get("notes") or "")[:5000]
        c.save()
        return JsonResponse(_cycle_to_json(c))
    lock_err = _pond_write_lock_response(cid, c.pond_id, c.start_date)
    if lock_err:
        return lock_err
    c.delete()
    return JsonResponse({"detail": "Deleted"}, status=200)


@csrf_exempt
@require_http_methods(["GET", "POST"])
@auth_required
@require_company_id
def aquaculture_ponds_list_or_create(request):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    if request.method == "GET":
        qs = (
            AquaculturePond.objects.filter(company_id=cid)
            .select_related("pos_customer", "default_feed_item", "default_medicine_item")
            .prefetch_related(_LANDLORD_POND_SHARE_PREFETCH)
            .order_by("sort_order", "id")
        )
        tilapia_rows = compute_fish_stock_position_rows(
            cid, fish_species_filter="tilapia", include_inactive_ponds=True
        )
        by_pid = {r["pond_id"]: r for r in tilapia_rows}
        for p in qs:
            if pond_live_data_after_date(cid, p.id) is not None:
                live_row = _fetch_tilapia_stock_row_for_pond(cid, p.id)
                if live_row:
                    by_pid[p.id] = live_row
                elif p.id in by_pid:
                    del by_pid[p.id]
        return JsonResponse(
            [
                _pond_to_json(
                    p,
                    _tilapia_load_fields(by_pid.get(p.id)),
                    landlord_shares=[_landlord_pond_share_json(sh) for sh in p.landlord_pond_shares.all()],
                )
                for p in qs
            ],
            safe=False,
        )

    body, e = parse_json_body(request)
    if e:
        return e
    name = (body.get("name") or "").strip()
    if not name:
        return JsonResponse({"detail": "name is required"}, status=400)
    skip_auto = bool(body.get("skip_auto_pos_customer"))
    auto_code = _next_automatic_pond_code(cid)
    p = AquaculturePond(
        company_id=cid,
        name=name[:200],
        code=auto_code[:64],
        sort_order=int(body.get("sort_order") or 0),
        is_active=bool(body.get("is_active", True)),
        notes=(body.get("notes") or "")[:5000],
    )
    if body.get("pond_role") is not None and str(body.get("pond_role")).strip() != "":
        pr, pr_err = normalize_pond_role(body.get("pond_role"))
        if pr_err:
            return JsonResponse({"detail": pr_err}, status=400)
        p.pond_role = pr
    lease_err = _apply_pond_lease_fields(p, body)
    if lease_err:
        return JsonResponse({"detail": lease_err}, status=400)
    aq_err = _apply_pond_aquaculture_fields(p, body)
    if aq_err:
        return JsonResponse({"detail": aq_err}, status=400)
    pos_err = _apply_pond_pos_customer(p, body, cid)
    if pos_err:
        return JsonResponse({"detail": pos_err}, status=400)
    dfi_err = _apply_pond_default_feed_item(p, body, cid)
    if dfi_err:
        return JsonResponse({"detail": dfi_err}, status=400)
    dmi_err = _apply_pond_default_medicine_item(p, body, cid)
    if dmi_err:
        return JsonResponse({"detail": dmi_err}, status=400)
    try:
        with transaction.atomic():
            p.save()
            prov_err = maybe_provision_auto_pos_customer(company_id=cid, pond=p, skip_auto=skip_auto)
            if prov_err:
                raise ValueError(prov_err)
    except ValueError as ex:
        return JsonResponse({"detail": str(ex)}, status=400)
    p = (
        AquaculturePond.objects.filter(pk=p.pk)
        .select_related("pos_customer", "default_feed_item", "default_medicine_item")
        .prefetch_related(_LANDLORD_POND_SHARE_PREFETCH)
        .first()
    )
    return JsonResponse(
        _pond_to_json(
            p,
            _tilapia_load_fields(_fetch_tilapia_stock_row_for_pond(cid, p.id)),
            landlord_shares=[_landlord_pond_share_json(sh) for sh in p.landlord_pond_shares.all()],
        ),
        status=201,
    )


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
def aquaculture_ponds_provision_pos_customers(request):
    """Create missing Aquaculture — [pond] POS customers for on-account sales at the shop hub."""
    err = _aquaculture_access(request)
    if err:
        return err
    result = provision_missing_pond_pos_customers(company_id=request.company_id)
    return JsonResponse(result)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
@auth_required
@require_company_id
def aquaculture_pond_detail(request, pond_id: int):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    p = _pond_for_company(cid, pond_id)
    if not p:
        return JsonResponse({"detail": "Pond not found"}, status=404)
    if request.method == "GET":
        p = (
            AquaculturePond.objects.filter(pk=p.pk)
            .select_related("pos_customer", "default_feed_item", "default_medicine_item")
            .prefetch_related(_LANDLORD_POND_SHARE_PREFETCH)
            .first()
        )
        return JsonResponse(
            _pond_to_json(
                p,
                _tilapia_load_fields(_fetch_tilapia_stock_row_for_pond(cid, p.id)),
                landlord_shares=[_landlord_pond_share_json(sh) for sh in p.landlord_pond_shares.all()],
            )
        )
    if request.method == "PUT":
        lock_err = _pond_write_lock_response(cid, pond_id)
        if lock_err:
            return lock_err
        body, e = parse_json_body(request)
        if e:
            return e
        prev_pos_customer_id = p.pos_customer_id
        prev_auto_pos_customer = bool(getattr(p, "auto_pos_customer", False))
        if "name" in body:
            n = (body.get("name") or "").strip()
            if n:
                p.name = n[:200]
        if "code" in body:
            new_code = (body.get("code") or "").strip()[:64]
            if new_code != (p.code or "").strip() and _pond_code_conflict(cid, new_code, p.id):
                return JsonResponse({"detail": "Another pond already uses this code."}, status=400)
            p.code = new_code
        if "sort_order" in body:
            p.sort_order = int(body.get("sort_order") or 0)
        if "is_active" in body:
            p.is_active = bool(body["is_active"])
        if "notes" in body:
            p.notes = str(body.get("notes") or "")[:5000]
        if "pond_role" in body:
            pr, pr_err = normalize_pond_role(body.get("pond_role"))
            if pr_err:
                return JsonResponse({"detail": pr_err}, status=400)
            p.pond_role = pr
        lease_err = _apply_pond_lease_fields(p, body)
        if lease_err:
            return JsonResponse({"detail": lease_err}, status=400)
        aq_err = _apply_pond_aquaculture_fields(p, body)
        if aq_err:
            return JsonResponse({"detail": aq_err}, status=400)
        pos_err = _apply_pond_pos_customer(p, body, cid)
        if pos_err:
            return JsonResponse({"detail": pos_err}, status=400)
        dfi_err = _apply_pond_default_feed_item(p, body, cid)
        if dfi_err:
            return JsonResponse({"detail": dfi_err}, status=400)
        dmi_err = _apply_pond_default_medicine_item(p, body, cid)
        if dmi_err:
            return JsonResponse({"detail": dmi_err}, status=400)
        p.save()
        if "pos_customer_id" in body:
            raw_pc = body.get("pos_customer_id")
            if raw_pc in (None, ""):
                on_pond_pos_customer_cleared(
                    company_id=cid,
                    old_customer_id=prev_pos_customer_id,
                    old_was_auto_managed=prev_auto_pos_customer,
                )
            else:
                new_pc = p.pos_customer_id
                if prev_pos_customer_id != new_pc:
                    on_pond_pos_customer_replaced(
                        company_id=cid,
                        old_customer_id=prev_pos_customer_id,
                        old_was_auto_managed=prev_auto_pos_customer,
                        new_customer_id=new_pc,
                    )
        sync_auto_pos_customer_from_pond(p)
        p = (
            AquaculturePond.objects.filter(pk=p.pk)
            .select_related("pos_customer", "default_feed_item", "default_medicine_item")
            .prefetch_related(_LANDLORD_POND_SHARE_PREFETCH)
            .first()
        )
        return JsonResponse(
            _pond_to_json(
                p,
                _tilapia_load_fields(_fetch_tilapia_stock_row_for_pond(cid, p.id)),
                landlord_shares=[_landlord_pond_share_json(sh) for sh in p.landlord_pond_shares.all()],
            )
        )
    lock_err = _pond_write_lock_response(cid, pond_id)
    if lock_err:
        return lock_err
    on_pond_deleted(company_id=cid, pond=p)
    p.delete()
    return JsonResponse({"detail": "Deleted"}, status=200)


def _expense_to_json(x: AquacultureExpense) -> dict:
    pond_name = ""
    if x.pond_id and getattr(x, "pond", None):
        pond_name = (x.pond.name or "").strip()
    shares = []
    for sh in x.pond_shares.all():
        pname = ""
        if getattr(sh, "pond", None):
            pname = (sh.pond.name or "").strip()
        shares.append({"pond_id": sh.pond_id, "pond_name": pname, "amount": str(sh.amount)})
    shares.sort(key=lambda r: r["pond_id"])
    cname = ""
    cid_cycle = None
    if x.production_cycle_id and getattr(x, "production_cycle", None):
        cid_cycle = x.production_cycle_id
        cname = (x.production_cycle.name or "").strip()
    src_sid = getattr(x, "source_station_id", None)
    src_sname = ""
    if src_sid and getattr(x, "source_station", None):
        src_sname = (x.source_station.station_name or "").strip()
    return {
        "id": x.id,
        "pond_id": x.pond_id,
        "pond_name": pond_name,
        "is_shared": x.pond_id is None,
        "pond_shares": shares,
        "production_cycle_id": cid_cycle,
        "production_cycle_name": cname,
        "expense_category": x.expense_category,
        "expense_category_label": aquaculture_expense_label(x.company_id, x.expense_category),
        "expense_date": x.expense_date.isoformat(),
        "amount": str(x.amount),
        "memo": x.memo or "",
        "vendor_name": x.vendor_name or "",
        "source_station_id": src_sid,
        "source_station_name": src_sname,
        "feed_sack_count": str(x.feed_sack_count) if getattr(x, "feed_sack_count", None) is not None else None,
        "feed_weight_kg": str(x.feed_weight_kg) if getattr(x, "feed_weight_kg", None) is not None else None,
        "created_at": x.created_at.isoformat() if x.created_at else "",
    }


@csrf_exempt
@require_http_methods(["GET", "POST"])
@auth_required
@require_company_id
def aquaculture_expenses_list_or_create(request):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    if request.method == "GET":
        qs = (
            AquacultureExpense.objects.filter(company_id=cid)
            .select_related("pond", "production_cycle", "source_station")
            .prefetch_related("pond_shares__pond")
        )
        pid = request.GET.get("pond_id")
        if pid and str(pid).strip().isdigit():
            p_int = int(pid)
            qs = qs.filter(Q(pond_id=p_int) | Q(pond_shares__pond_id=p_int)).distinct()
            qs = filter_live_pond_queryset(qs, cid, p_int, "expense_date")
        qs = qs.order_by("-expense_date", "-id")[:500]
        return JsonResponse([_expense_to_json(x) for x in qs], safe=False)

    return JsonResponse(
        {
            "detail": (
                "Manual pond costs are no longer created here. Record operating expenses on "
                "Vendor bills: add a line, tag the pond, choose an expense category (chart account "
                "is suggested automatically), then post the bill and pay from Payments. "
                "Feed/medicine inventory, lease, and payroll use their dedicated flows."
            ),
        },
        status=400,
    )


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
def aquaculture_shop_stock_issue(request):
    """
    Advanced / optional: issue perpetual-inventory shop stock from a station to a pond at average cost
    (Dr COGS / Cr inventory + one AquacultureExpense). Prefer POS on-account sales to the pond’s linked customer
    for inventoried items so quantity and GL follow normal retail; use this endpoint only for internal at-cost moves.
    """
    err = _aquaculture_access(request)
    if err:
        return err
    body, e = parse_json_body(request)
    if e:
        return e
    cid = request.company_id
    cat, cerr = normalize_expense_category_for_company(cid, body.get("expense_category"))
    if cerr:
        return JsonResponse({"detail": cerr}, status=400)
    resolved = resolve_aquaculture_expense_to_builtin(cid, cat)
    if resolved not in ("feed_purchase", "medicine_purchase"):
        return JsonResponse(
            {
                "detail": "Shop stock issue only supports expense_category feed_purchase or medicine_purchase.",
            },
            status=400,
        )
    ed = _parse_date(body.get("expense_date"))
    if not ed:
        return JsonResponse({"detail": "expense_date is required (YYYY-MM-DD)"}, status=400)
    raw_sid = body.get("station_id")
    raw_pid = body.get("pond_id")
    if raw_sid is None or raw_sid == "":
        return JsonResponse({"detail": "station_id is required"}, status=400)
    if raw_pid is None or raw_pid == "":
        return JsonResponse({"detail": "pond_id is required"}, status=400)
    try:
        station_id = int(raw_sid)
        pond_id = int(raw_pid)
    except (TypeError, ValueError):
        return JsonResponse({"detail": "station_id and pond_id must be integers"}, status=400)
    lock_err = _pond_write_lock_response(cid, pond_id, ed)
    if lock_err:
        return lock_err
    cycle_raw = body.get("production_cycle_id")
    cycle_id: int | None
    if cycle_raw in (None, ""):
        cycle_id = None
    else:
        try:
            cycle_id = int(cycle_raw)
        except (TypeError, ValueError):
            return JsonResponse({"detail": "production_cycle_id must be an integer or null"}, status=400)
    items = body.get("items")
    if not isinstance(items, list):
        return JsonResponse({"detail": "items must be an array of { item_id, quantity }"}, status=400)
    memo = str(body.get("memo") or "")
    vendor_name = str(body.get("vendor_name") or "")
    feed_sack_count: Decimal | None = None
    feed_weight_kg: Decimal | None = None
    if "feed_sack_count" in body:
        r = body.get("feed_sack_count")
        if r not in (None, ""):
            feed_sack_count = _decimal(str(r))
            if feed_sack_count < 0:
                return JsonResponse({"detail": "feed_sack_count cannot be negative"}, status=400)
    if "feed_weight_kg" in body:
        r = body.get("feed_weight_kg")
        if r not in (None, ""):
            feed_weight_kg = _decimal(str(r))
            if feed_weight_kg < 0:
                return JsonResponse({"detail": "feed_weight_kg cannot be negative"}, status=400)
    try:
        x = execute_aquaculture_shop_stock_issue(
            company_id=cid,
            station_id=station_id,
            pond_id=pond_id,
            production_cycle_id=cycle_id,
            expense_category=cat,
            expense_date=ed,
            items=items,
            memo=memo,
            vendor_name=vendor_name,
            feed_sack_count=feed_sack_count,
            feed_weight_kg=feed_weight_kg,
        )
    except StockBusinessError as ex:
        return JsonResponse({"detail": getattr(ex, "detail", str(ex))}, status=400)
    except GlPostingError as ex:
        return JsonResponse({"detail": getattr(ex, "detail", str(ex))}, status=400)
    return JsonResponse(_expense_to_json(x), status=201)


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def aquaculture_pond_warehouse_stock(request, pond_id: int):
    """On-hand feed/supplies at the pond (after transfer from a shop station)."""
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    if not _pond_for_company(cid, pond_id):
        return JsonResponse({"detail": "Pond not found"}, status=404)
    rows = pond_warehouse_stock_rows(cid, pond_id)
    return JsonResponse({"pond_id": pond_id, "items": rows})


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def aquaculture_pond_warehouse_stock_overview(request):
    """On-hand feed/supplies at every pond warehouse (optional pond_id filter)."""
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    raw_pid = request.GET.get("pond_id")
    if raw_pid in (None, ""):
        pond_id = None
    else:
        try:
            pond_id = int(raw_pid)
        except (TypeError, ValueError):
            return JsonResponse({"detail": "pond_id must be an integer"}, status=400)
        if not _pond_for_company(cid, pond_id):
            return JsonResponse({"detail": "Pond not found"}, status=404)
    rows = pond_warehouse_stock_matrix(cid, pond_id=pond_id)
    return JsonResponse({"rows": rows})


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
def aquaculture_pond_warehouse_transfer(request):
    """
    Move station shop stock to the pond warehouse (no COGS yet). Use Premium Agro (or any station) as source.
    """
    err = _aquaculture_access(request)
    if err:
        return err
    body, e = parse_json_body(request)
    if e:
        return e
    cid = request.company_id
    raw_sid = body.get("station_id")
    raw_pid = body.get("pond_id")
    if raw_sid is None or raw_sid == "":
        return JsonResponse({"detail": "station_id is required"}, status=400)
    if raw_pid is None or raw_pid == "":
        return JsonResponse({"detail": "pond_id is required"}, status=400)
    try:
        station_id = int(raw_sid)
        pond_id = int(raw_pid)
    except (TypeError, ValueError):
        return JsonResponse({"detail": "station_id and pond_id must be integers"}, status=400)
    lock_err = _pond_write_lock_response(cid, pond_id)
    if lock_err:
        return lock_err
    items = body.get("items")
    if not isinstance(items, list):
        return JsonResponse({"detail": "items must be an array of { item_id, quantity }"}, status=400)
    try:
        transfer_station_stock_to_pond_warehouse(
            company_id=cid,
            station_id=station_id,
            pond_id=pond_id,
            items=items,
        )
    except StockBusinessError as ex:
        return JsonResponse({"detail": getattr(ex, "detail", str(ex))}, status=400)
    rows = pond_warehouse_stock_rows(cid, pond_id)
    return JsonResponse({"pond_id": pond_id, "items": rows}, status=201)


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
def aquaculture_pond_warehouse_consume(request):
    """
    Record feed or medicine used from the pond warehouse: Dr COGS / Cr inventory (same pattern as feeding-advice apply).
    expense_category: feed_consumed | medicine_consumed. For feed, pass quantity and/or feed_weight_kg (+ sack_size_kg).
    """
    err = _aquaculture_access(request)
    if err:
        return err
    body, e = parse_json_body(request)
    if e:
        return e
    cid = request.company_id

    raw_pid = body.get("pond_id")
    if raw_pid in (None, ""):
        return JsonResponse({"detail": "pond_id is required"}, status=400)
    try:
        pond_id = int(raw_pid)
    except (TypeError, ValueError):
        return JsonResponse({"detail": "pond_id must be an integer"}, status=400)

    cat, cerr = normalize_expense_category_for_company(cid, body.get("expense_category"))
    if cerr:
        return JsonResponse({"detail": cerr}, status=400)
    resolved = resolve_aquaculture_expense_to_builtin(cid, cat)
    if resolved not in ("feed_consumed", "medicine_consumed"):
        return JsonResponse(
            {"detail": "expense_category must be feed_consumed or medicine_consumed"},
            status=400,
        )

    pond = AquaculturePond.objects.filter(pk=pond_id, company_id=cid).first()
    if not pond:
        return JsonResponse({"detail": "Pond not found"}, status=404)
    ed_consume = _parse_date(body.get("expense_date"))
    lock_err = _pond_write_lock_response(cid, pond_id, ed_consume)
    if lock_err:
        return lock_err

    raw_iid = body.get("item_id")
    if raw_iid in (None, ""):
        if cat == "medicine_consumed" and pond.default_medicine_item_id:
            item_id = pond.default_medicine_item_id
        elif cat == "feed_consumed" and pond.default_feed_item_id:
            item_id = pond.default_feed_item_id
        else:
            return JsonResponse(
                {"detail": "item_id is required (or set the pond default SKU for this category)"},
                status=400,
            )
    else:
        try:
            item_id = int(raw_iid)
        except (TypeError, ValueError):
            return JsonResponse({"detail": "item_id must be an integer"}, status=400)

    item = Item.objects.filter(pk=item_id, company_id=cid).first()
    if not item:
        return JsonResponse({"detail": "item_id not found for this company"}, status=400)

    ed = _parse_date(body.get("expense_date")) or django_timezone.localdate()

    raw_cycle = body.get("production_cycle_id")
    cycle_id: int | None = None
    if raw_cycle not in (None, ""):
        try:
            cycle_id = int(raw_cycle)
        except (TypeError, ValueError):
            return JsonResponse({"detail": "production_cycle_id must be an integer or null"}, status=400)

    memo_in = str(body.get("memo") or "").strip()
    memo = (
        memo_in
        if memo_in
        else (
            "Pond warehouse medicine consumed"
            if cat == "medicine_consumed"
            else "Pond warehouse feed consumed"
        )
    )[:5000]

    quantity: Decimal | None = None
    raw_q = body.get("quantity")
    if raw_q not in (None, ""):
        quantity = _decimal(str(raw_q))
        if quantity < 0:
            return JsonResponse({"detail": "quantity cannot be negative"}, status=400)

    feed_w_kg: Decimal | None = None
    feed_sacks: Decimal | None = None
    if cat == "feed_consumed":
        raw_kg = body.get("feed_weight_kg")
        sack_sz: int | None = None
        sack_raw = body.get("sack_size_kg")
        if sack_raw not in (None, ""):
            try:
                sack_sz = int(sack_raw)
            except (TypeError, ValueError):
                return JsonResponse({"detail": "sack_size_kg must be an integer or null"}, status=400)
        if raw_kg not in (None, ""):
            feed_w_kg = _decimal(str(raw_kg))
            if feed_w_kg <= 0:
                return JsonResponse({"detail": "feed_weight_kg must be greater than zero"}, status=400)
            q_kg = feed_inventory_qty_from_kg(item, feed_w_kg, sack_sz)
            if quantity is None:
                quantity = q_kg
            if item.content_weight_kg and item.content_weight_kg > 0:
                feed_sacks = (feed_w_kg / Decimal(item.content_weight_kg)).quantize(Decimal("0.0001"))
            elif sack_sz is not None and sack_sz > 0:
                feed_sacks = (feed_w_kg / Decimal(sack_sz)).quantize(Decimal("0.0001"))

    if quantity is None or quantity <= 0:
        return JsonResponse(
            {
                "detail": "Provide quantity in inventory units, or for feed_consumed provide feed_weight_kg to derive quantity",
            },
            status=400,
        )

    try:
        expense_obj = consume_pond_warehouse_stock(
            company_id=cid,
            pond=pond,
            production_cycle_id=cycle_id,
            expense_category=cat,
            expense_date=ed,
            item=item,
            quantity=quantity,
            memo=memo,
            feed_weight_kg=feed_w_kg if cat == "feed_consumed" else None,
            feed_sack_count=feed_sacks if cat == "feed_consumed" else None,
        )
    except StockBusinessError as ex:
        return JsonResponse({"detail": getattr(ex, "detail", str(ex))}, status=400)
    except GlPostingError as ex:
        return JsonResponse({"detail": getattr(ex, "detail", str(ex))}, status=400)

    rows = pond_warehouse_stock_rows(cid, pond_id)
    return JsonResponse(
        {"pond_id": pond_id, "expense": _expense_to_json(expense_obj), "items": rows},
        status=201,
    )


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
@auth_required
@require_company_id
def aquaculture_expense_detail(request, expense_id: int):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    x = (
        AquacultureExpense.objects.filter(pk=expense_id, company_id=cid)
        .select_related("pond", "production_cycle", "source_station")
        .prefetch_related("pond_shares__pond")
        .first()
    )
    if not x:
        return JsonResponse({"detail": "Not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(_expense_to_json(x))
    if request.method == "PUT":
        body, e = parse_json_body(request)
        if e:
            return e
        was_shared = x.pond_id is None
        must_reshare = False
        if "amount" in body:
            na = _decimal(body.get("amount"))
            if na <= 0:
                return JsonResponse({"detail": "amount must be greater than zero"}, status=400)
            amt = _money_q(na)
        else:
            amt = _money_q(x.amount)

        if "pond_id" in body:
            pr = body.get("pond_id")
            target_shared = pr is None or pr is False or (isinstance(pr, str) and str(pr).strip() == "")
        else:
            target_shared = was_shared

        cy = x.production_cycle
        if "production_cycle_id" in body:
            raw_cy = body.get("production_cycle_id")
            if raw_cy in (None, ""):
                cy = None
            else:
                try:
                    cy_id = int(raw_cy)
                except (TypeError, ValueError):
                    return JsonResponse({"detail": "production_cycle_id must be an integer"}, status=400)
                cy = _cycle_for_company(cid, cy_id)
                if not cy:
                    return JsonResponse({"detail": "Production cycle not found"}, status=404)

        if target_shared:
            if cy is not None:
                return JsonResponse({"detail": "Shared expenses cannot use production_cycle_id."}, status=400)
            must_reshare = (not was_shared) or ("amount" in body) or body.get("pond_shares") is not None or body.get(
                "shared_equal_pond_ids"
            ) is not None
            if must_reshare:
                pairs, perr = _parse_shared_expense_plan(body, cid, amt)
                if perr:
                    return JsonResponse({"detail": perr}, status=400)
                assert pairs is not None
                with transaction.atomic():
                    x.pond = None
                    x.production_cycle = None
                    x.amount = amt
                    AquacultureExpensePondShare.objects.filter(expense=x).delete()
                    for pid, a in pairs:
                        AquacultureExpensePondShare.objects.create(
                            expense=x,
                            pond_id=pid,
                            amount=_money_q(a),
                        )
            else:
                x.pond = None
                x.production_cycle = None
        else:
            if "pond_id" in body:
                try:
                    pid = int(body["pond_id"])
                except (TypeError, ValueError):
                    return JsonResponse({"detail": "pond_id must be an integer for a direct expense"}, status=400)
            else:
                pid = x.pond_id
            if pid is None:
                return JsonResponse({"detail": "pond_id is required for a direct expense"}, status=400)
            pond = _pond_for_company(cid, pid)
            if not pond:
                return JsonResponse({"detail": "Pond not found"}, status=404)
            if body.get("pond_shares") is not None or body.get("shared_equal_pond_ids") is not None:
                return JsonResponse(
                    {"detail": "Remove pond_shares / shared_equal_pond_ids when assigning a direct pond_id."},
                    status=400,
                )
            if cy is not None and cy.pond_id != pond.id:
                return JsonResponse(
                    {"detail": "production_cycle_id does not belong to the selected pond"},
                    status=400,
                )
            with transaction.atomic():
                x.pond = pond
                x.production_cycle = cy
                x.amount = amt
                AquacultureExpensePondShare.objects.filter(expense=x).delete()

        if "expense_category" in body:
            cat, cerr = normalize_expense_category_for_company(cid, body.get("expense_category"))
            if cerr:
                return JsonResponse({"detail": cerr}, status=400)
            ok_cat, cat_detail = manual_aquaculture_expense_category_change_allowed_for_company(
                company_id=cid,
                old_category=x.expense_category,
                new_category=cat,
            )
            if not ok_cat:
                return JsonResponse({"detail": cat_detail or "Invalid expense category."}, status=400)
            x.expense_category = cat
        if "expense_date" in body:
            ed = _parse_date(body.get("expense_date"))
            if not ed:
                return JsonResponse({"detail": "Invalid expense_date"}, status=400)
            x.expense_date = ed
        if "memo" in body:
            x.memo = str(body.get("memo") or "")[:5000]
        if "vendor_name" in body:
            x.vendor_name = str(body.get("vendor_name") or "")[:200]

        fer = _apply_expense_feed_metrics_from_body(x, body)
        if fer:
            return JsonResponse({"detail": fer}, status=400)

        material_expense = must_reshare or any(
            k in body
            for k in (
                "amount",
                "pond_id",
                "production_cycle_id",
                "expense_category",
                "expense_date",
                "pond_shares",
                "shared_equal_pond_ids",
            )
        )

        with transaction.atomic():
            x.save()
            if material_expense and aquaculture_expense_has_posting_effects(cid, expense_id):
                cleanup_aquaculture_expense_posting_effects(cid, expense_id)
                sync_aquaculture_expense_posting_effects(cid, expense_id)
        x = (
            AquacultureExpense.objects.filter(pk=x.pk)
            .select_related("pond", "production_cycle", "source_station")
            .prefetch_related("pond_shares__pond")
            .first()
        )
        return JsonResponse(_expense_to_json(x))
    with transaction.atomic():
        cleanup_aquaculture_expense_posting_effects(cid, expense_id)
        x.delete()
    return JsonResponse({"detail": "Deleted"}, status=200)


def _sale_to_json(s: AquacultureFishSale) -> dict:
    cname = ""
    cid_cycle = None
    if s.production_cycle_id and getattr(s, "production_cycle", None):
        cid_cycle = s.production_cycle_id
        cname = (s.production_cycle.name or "").strip()
    it = getattr(s, "income_type", None) or "fish_harvest_sale"
    sp = getattr(s, "fish_species", None) or "tilapia"
    spo = getattr(s, "fish_species_other", None) or ""
    return {
        "id": s.id,
        "pond_id": s.pond_id,
        "pond_name": (s.pond.name or "").strip() if getattr(s, "pond_id", None) else "",
        "production_cycle_id": cid_cycle,
        "production_cycle_name": cname,
        "income_type": it,
        "income_type_label": aquaculture_income_label(s.company_id, it),
        "fish_species": sp,
        "fish_species_other": spo,
        "fish_species_label": fish_species_display_label(sp, spo),
        "sale_date": s.sale_date.isoformat(),
        "weight_kg": str(s.weight_kg),
        "fish_count": s.fish_count,
        "total_amount": str(s.total_amount),
        "buyer_name": s.buyer_name or "",
        "memo": s.memo or "",
        "created_at": s.created_at.isoformat() if s.created_at else "",
        "invoice_id": getattr(s, "invoice_id", None),
        "invoice_number": (
            (getattr(s, "invoice", None) and getattr(s.invoice, "invoice_number", None)) or None
        ),
        "accounting_posted": bool(getattr(s, "invoice_id", None)),
    }


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def aquaculture_fish_sale_last_reference(request):
    """Latest biological sale for pond + production cycle + species (stock ledger book value hint)."""
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    pond_id, e = _parse_optional_int(request.GET.get("pond_id"), name="pond_id")
    if e:
        return e
    if pond_id is None:
        return JsonResponse({"detail": "pond_id is required"}, status=400)
    if not _pond_for_company(cid, pond_id):
        return JsonResponse({"detail": "pond not found"}, status=404)
    cy_id, e = _parse_optional_int(request.GET.get("production_cycle_id"), name="production_cycle_id")
    if e:
        return e
    if cy_id is not None:
        cy = AquacultureProductionCycle.objects.filter(pk=cy_id, company_id=cid).first()
        if not cy:
            return JsonResponse({"detail": "production_cycle not found"}, status=404)
        if cy.pond_id != pond_id:
            return JsonResponse({"detail": "production_cycle_id does not belong to pond_id"}, status=400)
    species_raw = (request.GET.get("fish_species") or "").strip()
    if not species_raw:
        return JsonResponse({"detail": "fish_species is required"}, status=400)
    other = (request.GET.get("fish_species_other") or "").strip()
    ref = last_fish_sale_reference_for_ledger(
        cid,
        pond_id=pond_id,
        production_cycle_id=cy_id,
        fish_species=species_raw,
        fish_species_other=other or None,
    )
    if not ref:
        return JsonResponse({"found": False})
    return JsonResponse({"found": True, **ref})


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def aquaculture_biomass_sample_last_reference(request):
    """Latest biomass sample for pond + production cycle + species (stock ledger quantity hints)."""
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    pond_id, e = _parse_optional_int(request.GET.get("pond_id"), name="pond_id")
    if e:
        return e
    if pond_id is None:
        return JsonResponse({"detail": "pond_id is required"}, status=400)
    if not _pond_for_company(cid, pond_id):
        return JsonResponse({"detail": "pond not found"}, status=404)
    cy_id, e = _parse_optional_int(request.GET.get("production_cycle_id"), name="production_cycle_id")
    if e:
        return e
    if cy_id is not None:
        cy = AquacultureProductionCycle.objects.filter(pk=cy_id, company_id=cid).first()
        if not cy:
            return JsonResponse({"detail": "production_cycle not found"}, status=404)
        if cy.pond_id != pond_id:
            return JsonResponse({"detail": "production_cycle_id does not belong to pond_id"}, status=400)
    species_raw = (request.GET.get("fish_species") or "").strip()
    if not species_raw:
        return JsonResponse({"detail": "fish_species is required"}, status=400)
    other = (request.GET.get("fish_species_other") or "").strip()
    ref = last_biomass_sample_reference_for_ledger(
        cid,
        pond_id=pond_id,
        production_cycle_id=cy_id,
        fish_species=species_raw,
        fish_species_other=other or None,
    )
    if not ref:
        return JsonResponse({"found": False})
    return JsonResponse({"found": True, **ref})


@csrf_exempt
@require_http_methods(["GET", "POST"])
@auth_required
@require_company_id
def aquaculture_sales_list_or_create(request):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    if request.method == "GET":
        qs = AquacultureFishSale.objects.filter(company_id=cid).select_related(
            "pond", "production_cycle", "invoice"
        )
        pid = request.GET.get("pond_id")
        if pid and str(pid).strip().isdigit():
            p_int = int(pid)
            qs = qs.filter(pond_id=p_int)
            qs = filter_live_pond_queryset(qs, cid, p_int, "sale_date")
        qs = qs.order_by("-sale_date", "-id")[:500]
        return JsonResponse([_sale_to_json(s) for s in qs], safe=False)

    body, e = parse_json_body(request)
    if e:
        return e
    try:
        pond_id = int(body.get("pond_id"))
    except (TypeError, ValueError):
        return JsonResponse({"detail": "pond_id is required and must be an integer"}, status=400)
    pond = _pond_for_company(cid, pond_id)
    if not pond:
        return JsonResponse({"detail": "Pond not found"}, status=404)
    sd = _parse_date(body.get("sale_date"))
    lock_err = _pond_write_lock_response(cid, pond_id, sd)
    if lock_err:
        return lock_err
    it, ierr = normalize_income_type_for_company(cid, body.get("income_type"))
    if ierr or not it:
        return JsonResponse({"detail": ierr or "Invalid income_type"}, status=400)
    cycle_obj = None
    raw_cy = body.get("production_cycle_id")
    if raw_cy not in (None, ""):
        try:
            cy_id = int(raw_cy)
        except (TypeError, ValueError):
            return JsonResponse({"detail": "production_cycle_id must be an integer"}, status=400)
        cycle_obj = _cycle_for_company(cid, cy_id)
        if not cycle_obj:
            return JsonResponse({"detail": "Production cycle not found"}, status=404)
        if cycle_obj.pond_id != pond.id:
            return JsonResponse({"detail": "production_cycle_id does not belong to the selected pond"}, status=400)
    if not sd:
        return JsonResponse({"detail": "sale_date is required (YYYY-MM-DD)"}, status=400)
    wk = _decimal(body.get("weight_kg"))
    if wk <= 0:
        return JsonResponse({"detail": "weight_kg must be greater than zero"}, status=400)
    ta = _decimal(body.get("total_amount"))
    if ta < 0:
        return JsonResponse({"detail": "total_amount cannot be negative"}, status=400)
    fc = body.get("fish_count")
    fc_int = None
    if fc is not None and str(fc).strip() != "":
        try:
            fc_int = int(fc)
        except (TypeError, ValueError):
            return JsonResponse({"detail": "fish_count must be an integer"}, status=400)
    if income_type_is_non_biological_for_company(cid, it):
        fs = "not_applicable"
        fso = ""
        fc_int = None
    else:
        if fc_int is None or fc_int <= 0:
            return JsonResponse({"detail": "fish_count is required and must be greater than zero"}, status=400)
        fs, fserr = normalize_fish_species(body.get("fish_species"))
        if fserr:
            return JsonResponse({"detail": fserr}, status=400)
        if fs == "not_applicable":
            return JsonResponse(
                {
                    "detail": "Pick a fish species for fish-related income, or choose empty sacks / scrap sale for non-fish lines."
                },
                status=400,
            )
        fso = normalize_fish_species_other(body.get("fish_species_other"), fs)
    s = AquacultureFishSale(
        company_id=cid,
        pond=pond,
        production_cycle=cycle_obj,
        income_type=it,
        fish_species=fs,
        fish_species_other=fso,
        sale_date=sd,
        weight_kg=wk,
        fish_count=fc_int,
        total_amount=ta.quantize(Decimal("0.01")),
        buyer_name=(body.get("buyer_name") or "")[:200],
        memo=(body.get("memo") or "")[:5000],
    )
    with transaction.atomic():
        s.save()
        sync_biomass_sample_from_fish_sale(s)
    s = AquacultureFishSale.objects.filter(pk=s.pk).select_related(
        "pond", "production_cycle", "invoice"
    ).first()
    return JsonResponse(_sale_to_json(s), status=201)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
@auth_required
@require_company_id
def aquaculture_sale_detail(request, sale_id: int):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    s = (
        AquacultureFishSale.objects.filter(pk=sale_id, company_id=cid)
        .select_related("pond", "production_cycle", "invoice")
        .first()
    )
    if not s:
        return JsonResponse({"detail": "Not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(_sale_to_json(s))
    if request.method == "PUT":
        lock_err = _pond_write_lock_response(cid, s.pond_id, s.sale_date)
        if lock_err:
            return lock_err
        body, e = parse_json_body(request)
        if e:
            return e
        if "pond_id" in body:
            try:
                pid = int(body["pond_id"])
            except (TypeError, ValueError):
                return JsonResponse({"detail": "pond_id must be an integer"}, status=400)
            pond = _pond_for_company(cid, pid)
            if not pond:
                return JsonResponse({"detail": "Pond not found"}, status=404)
            s.pond = pond
        if "income_type" in body:
            it, ierr = normalize_income_type_for_company(cid, body.get("income_type"))
            if ierr or not it:
                return JsonResponse({"detail": ierr or "Invalid income_type"}, status=400)
            s.income_type = it
        if "production_cycle_id" in body:
            raw_cy = body.get("production_cycle_id")
            if raw_cy in (None, ""):
                s.production_cycle = None
            else:
                try:
                    cy_id = int(raw_cy)
                except (TypeError, ValueError):
                    return JsonResponse({"detail": "production_cycle_id must be an integer"}, status=400)
                cy = _cycle_for_company(cid, cy_id)
                if not cy:
                    return JsonResponse({"detail": "Production cycle not found"}, status=404)
                if cy.pond_id != s.pond_id:
                    return JsonResponse({"detail": "production_cycle_id does not belong to the sale pond"}, status=400)
                s.production_cycle = cy
        if "sale_date" in body:
            sd = _parse_date(body.get("sale_date"))
            if not sd:
                return JsonResponse({"detail": "Invalid sale_date"}, status=400)
            s.sale_date = sd
        if "weight_kg" in body:
            wk = _decimal(body.get("weight_kg"))
            if wk <= 0:
                return JsonResponse({"detail": "weight_kg must be greater than zero"}, status=400)
            s.weight_kg = wk
        if "total_amount" in body:
            ta = _decimal(body.get("total_amount"))
            if ta < 0:
                return JsonResponse({"detail": "total_amount cannot be negative"}, status=400)
            s.total_amount = ta.quantize(Decimal("0.01"))
        if "fish_count" in body:
            fc = body.get("fish_count")
            if fc is None or str(fc).strip() == "":
                s.fish_count = None
            else:
                try:
                    s.fish_count = int(fc)
                except (TypeError, ValueError):
                    return JsonResponse({"detail": "fish_count must be an integer"}, status=400)
        if "buyer_name" in body:
            s.buyer_name = str(body.get("buyer_name") or "")[:200]
        if "memo" in body:
            s.memo = str(body.get("memo") or "")[:5000]
        if "fish_species" in body:
            fs, fserr = normalize_fish_species(body.get("fish_species"))
            if fserr:
                return JsonResponse({"detail": fserr}, status=400)
            s.fish_species = fs
            if "fish_species_other" in body:
                s.fish_species_other = normalize_fish_species_other(body.get("fish_species_other"), fs)
            else:
                s.fish_species_other = normalize_fish_species_other(None, fs)
        elif "fish_species_other" in body:
            s.fish_species_other = normalize_fish_species_other(body.get("fish_species_other"), s.fish_species)
        if income_type_is_non_biological_for_company(cid, s.income_type):
            s.fish_species = "not_applicable"
            s.fish_species_other = ""
            s.fish_count = None
        elif s.fish_species == "not_applicable":
            return JsonResponse(
                {
                    "detail": "Pick a fish species for fish-related income, or use an empty-sack / scrap income type for non-fish lines."
                },
                status=400,
            )
        elif s.fish_count is None or s.fish_count <= 0:
            return JsonResponse({"detail": "fish_count is required and must be greater than zero"}, status=400)
        material_sale = any(
            k in body
            for k in (
                "pond_id",
                "production_cycle_id",
                "income_type",
                "sale_date",
                "weight_kg",
                "total_amount",
                "fish_count",
                "fish_species",
                "fish_species_other",
            )
        )
        with transaction.atomic():
            s.save()
            if s.invoice_id and material_sale:
                ok_sync, err_sync = reconcile_aquaculture_fish_sale_with_invoice(cid, s)
                if not ok_sync:
                    return JsonResponse({"detail": err_sync}, status=409)
            else:
                sync_biomass_sample_from_fish_sale(s)
        s = AquacultureFishSale.objects.filter(pk=s.pk).select_related(
            "pond", "production_cycle", "invoice"
        ).first()
        return JsonResponse(_sale_to_json(s))
    lock_err = _pond_write_lock_response(cid, s.pond_id, s.sale_date)
    if lock_err:
        return lock_err
    with transaction.atomic():
        ok_del, err_del = cleanup_aquaculture_fish_sale_effects(cid, s)
        if not ok_del:
            return JsonResponse({"detail": err_del}, status=409)
        s.delete()
    return JsonResponse({"detail": "Deleted"}, status=200)


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
def aquaculture_sale_finalize(request, sale_id: int):
    """Create Invoice + GL for a pond sale (idempotent if already finalized)."""
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    body, e = parse_json_body(request)
    if e:
        return e
    from api.services.aquaculture_sale_accounting import finalize_aquaculture_fish_sale_to_invoice

    sale_pre = AquacultureFishSale.objects.filter(pk=sale_id, company_id=cid).first()
    if sale_pre:
        lock_err = _pond_write_lock_response(cid, sale_pre.pond_id, sale_pre.sale_date)
        if lock_err:
            return lock_err
    sale, inv_dict, msg = finalize_aquaculture_fish_sale_to_invoice(cid, sale_id, body or {})
    if msg:
        return JsonResponse({"detail": msg}, status=400)
    if sale is None or inv_dict is None:
        return JsonResponse({"detail": "Unexpected finalize result"}, status=500)
    sale = (
        AquacultureFishSale.objects.filter(pk=sale.pk, company_id=cid)
        .select_related("pond", "production_cycle", "invoice")
        .first()
    )
    return JsonResponse({"sale": _sale_to_json(sale), "invoice": inv_dict})


def _sample_to_json(b: AquacultureBiomassSample) -> dict:
    cyc_id = getattr(b, "production_cycle_id", None)
    cname = ""
    if cyc_id and getattr(b, "production_cycle", None):
        cname = (b.production_cycle.name or "").strip()
    sp = getattr(b, "fish_species", None) or "tilapia"
    spo = getattr(b, "fish_species_other", None) or ""
    return {
        "id": b.id,
        "pond_id": b.pond_id,
        "pond_name": (b.pond.name or "").strip() if getattr(b, "pond_id", None) else "",
        "production_cycle_id": cyc_id,
        "production_cycle_name": cname,
        "sample_date": b.sample_date.isoformat(),
        "estimated_fish_count": b.estimated_fish_count,
        "estimated_total_weight_kg": str(b.estimated_total_weight_kg) if b.estimated_total_weight_kg is not None else None,
        "avg_weight_kg": str(b.avg_weight_kg) if b.avg_weight_kg is not None else None,
        "stock_reference_fish_count": b.stock_reference_fish_count,
        "stock_reference_net_weight_kg": (
            str(b.stock_reference_net_weight_kg) if b.stock_reference_net_weight_kg is not None else None
        ),
        "stock_reference_avg_weight_kg": (
            str(b.stock_reference_avg_weight_kg) if b.stock_reference_avg_weight_kg is not None else None
        ),
        "extrapolated_biomass_kg": str(b.extrapolated_biomass_kg) if b.extrapolated_biomass_kg is not None else None,
        "biomass_gain_kg": str(b.biomass_gain_kg) if b.biomass_gain_kg is not None else None,
        "fish_species": sp,
        "fish_species_other": spo,
        "fish_species_label": fish_species_display_label(sp, spo),
        "notes": b.notes or "",
        "source_fish_sale_id": getattr(b, "source_fish_sale_id", None),
        "created_at": b.created_at.isoformat() if b.created_at else "",
    }


@csrf_exempt
@require_http_methods(["GET", "POST"])
@auth_required
@require_company_id
def aquaculture_samples_list_or_create(request):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    if request.method == "GET":
        qs = AquacultureBiomassSample.objects.filter(company_id=cid).select_related("pond", "production_cycle")
        pid = request.GET.get("pond_id")
        if pid and str(pid).strip().isdigit():
            p_int = int(pid)
            qs = qs.filter(pond_id=p_int)
            qs = filter_live_pond_queryset(qs, cid, p_int, "sample_date")
        qs = qs.order_by("-sample_date", "-id")[:200]
        return JsonResponse([_sample_to_json(b) for b in qs], safe=False)

    body, e = parse_json_body(request)
    if e:
        return e
    try:
        pond_id = int(body.get("pond_id"))
    except (TypeError, ValueError):
        return JsonResponse({"detail": "pond_id is required and must be an integer"}, status=400)
    pond = _pond_for_company(cid, pond_id)
    if not pond:
        return JsonResponse({"detail": "Pond not found"}, status=404)
    sd = _parse_date(body.get("sample_date"))
    lock_err = _pond_write_lock_response(cid, pond_id, sd)
    if lock_err:
        return lock_err
    if not sd:
        return JsonResponse({"detail": "sample_date is required (YYYY-MM-DD)"}, status=400)
    efc = body.get("estimated_fish_count")
    efc_i = None
    if efc is not None and str(efc).strip() != "":
        try:
            efc_i = int(efc)
        except (TypeError, ValueError):
            return JsonResponse({"detail": "estimated_fish_count must be an integer"}, status=400)
    etw = body.get("estimated_total_weight_kg")
    etw_d = None
    if etw is not None and str(etw).strip() != "":
        etw_d = _decimal(etw)
        if etw_d < 0:
            return JsonResponse({"detail": "estimated_total_weight_kg cannot be negative"}, status=400)
    aw = body.get("avg_weight_kg")
    aw_d = None
    if aw is not None and str(aw).strip() != "":
        aw_d = _decimal(aw)
        if aw_d < 0:
            return JsonResponse({"detail": "avg_weight_kg cannot be negative"}, status=400)
    cycle_obj = None
    raw_cy = body.get("production_cycle_id")
    if raw_cy not in (None, ""):
        try:
            cy_id = int(raw_cy)
        except (TypeError, ValueError):
            return JsonResponse({"detail": "production_cycle_id must be an integer or null"}, status=400)
        cycle_obj = _cycle_for_company(cid, cy_id)
        if not cycle_obj:
            return JsonResponse({"detail": "Production cycle not found"}, status=404)
        if cycle_obj.pond_id != pond.id:
            return JsonResponse({"detail": "production_cycle_id does not belong to the selected pond"}, status=400)
    fs, fserr = normalize_fish_species(body.get("fish_species"))
    if fserr:
        return JsonResponse({"detail": fserr}, status=400)
    if fs == "not_applicable":
        return JsonResponse(
            {"detail": "fish_species must be a fish species (not N/A) for biomass sampling."},
            status=400,
        )
    fso = normalize_fish_species_other(body.get("fish_species_other"), fs)
    if efc_i is None or efc_i <= 0:
        return JsonResponse(
            {"detail": "estimated_fish_count is required and must be greater than zero."},
            status=400,
        )
    if etw_d is None or etw_d <= 0:
        return JsonResponse(
            {"detail": "estimated_total_weight_kg is required and must be greater than zero."},
            status=400,
        )
    b = AquacultureBiomassSample(
        company_id=cid,
        pond=pond,
        production_cycle=cycle_obj,
        sample_date=sd,
        estimated_fish_count=efc_i,
        estimated_total_weight_kg=etw_d,
        avg_weight_kg=aw_d,
        fish_species=fs,
        fish_species_other=fso,
        notes=(body.get("notes") or "")[:5000],
    )
    apply_aquaculture_biomass_sample_extrapolation(b)
    b.save()
    b = AquacultureBiomassSample.objects.filter(pk=b.pk).select_related("pond", "production_cycle").first()
    return JsonResponse(_sample_to_json(b), status=201)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
@auth_required
@require_company_id
def aquaculture_sample_detail(request, sample_id: int):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    b = (
        AquacultureBiomassSample.objects.filter(pk=sample_id, company_id=cid)
        .select_related("pond", "production_cycle")
        .first()
    )
    if not b:
        return JsonResponse({"detail": "Not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(_sample_to_json(b))
    if request.method == "PUT":
        lock_err = _pond_write_lock_response(cid, b.pond_id, b.sample_date)
        if lock_err:
            return lock_err
        body, e = parse_json_body(request)
        if e:
            return e
        if "pond_id" in body:
            try:
                pid = int(body["pond_id"])
            except (TypeError, ValueError):
                return JsonResponse({"detail": "pond_id must be an integer"}, status=400)
            pond = _pond_for_company(cid, pid)
            if not pond:
                return JsonResponse({"detail": "Pond not found"}, status=404)
            b.pond = pond
        if "sample_date" in body:
            sd = _parse_date(body.get("sample_date"))
            if not sd:
                return JsonResponse({"detail": "Invalid sample_date"}, status=400)
            b.sample_date = sd
        if "estimated_fish_count" in body:
            fc = body.get("estimated_fish_count")
            if fc is None or str(fc).strip() == "":
                b.estimated_fish_count = None
            else:
                try:
                    b.estimated_fish_count = int(fc)
                except (TypeError, ValueError):
                    return JsonResponse({"detail": "estimated_fish_count must be an integer"}, status=400)
        if "estimated_total_weight_kg" in body:
            etw = body.get("estimated_total_weight_kg")
            if etw is None or str(etw).strip() == "":
                b.estimated_total_weight_kg = None
            else:
                d = _decimal(etw)
                if d < 0:
                    return JsonResponse({"detail": "estimated_total_weight_kg cannot be negative"}, status=400)
                b.estimated_total_weight_kg = d
        if "avg_weight_kg" in body:
            aw = body.get("avg_weight_kg")
            if aw is None or str(aw).strip() == "":
                b.avg_weight_kg = None
            else:
                d = _decimal(aw)
                if d < 0:
                    return JsonResponse({"detail": "avg_weight_kg cannot be negative"}, status=400)
                b.avg_weight_kg = d
        if "production_cycle_id" in body:
            raw_cy = body.get("production_cycle_id")
            if raw_cy in (None, ""):
                b.production_cycle = None
            else:
                try:
                    cy_id = int(raw_cy)
                except (TypeError, ValueError):
                    return JsonResponse({"detail": "production_cycle_id must be an integer or null"}, status=400)
                cy = _cycle_for_company(cid, cy_id)
                if not cy:
                    return JsonResponse({"detail": "Production cycle not found"}, status=404)
                if cy.pond_id != b.pond_id:
                    return JsonResponse({"detail": "production_cycle_id does not belong to the sample pond"}, status=400)
                b.production_cycle = cy
        if "notes" in body:
            b.notes = str(body.get("notes") or "")[:5000]
        if "fish_species" in body:
            fs, fserr = normalize_fish_species(body.get("fish_species"))
            if fserr:
                return JsonResponse({"detail": fserr}, status=400)
            if fs == "not_applicable":
                return JsonResponse(
                    {"detail": "fish_species must be a fish species (not N/A) for biomass sampling."},
                    status=400,
                )
            b.fish_species = fs
            if "fish_species_other" in body:
                b.fish_species_other = normalize_fish_species_other(body.get("fish_species_other"), fs)
            else:
                b.fish_species_other = normalize_fish_species_other(None, fs)
        elif "fish_species_other" in body:
            b.fish_species_other = normalize_fish_species_other(body.get("fish_species_other"), b.fish_species)
        if b.estimated_fish_count is None or b.estimated_fish_count <= 0:
            return JsonResponse(
                {"detail": "estimated_fish_count is required and must be greater than zero."},
                status=400,
            )
        if b.estimated_total_weight_kg is None or b.estimated_total_weight_kg <= 0:
            return JsonResponse(
                {"detail": "estimated_total_weight_kg is required and must be greater than zero."},
                status=400,
            )
        apply_aquaculture_biomass_sample_extrapolation(b)
        b.save()
        b = AquacultureBiomassSample.objects.filter(pk=b.pk).select_related("pond", "production_cycle").first()
        return JsonResponse(_sample_to_json(b))
    lock_err = _pond_write_lock_response(cid, b.pond_id, b.sample_date)
    if lock_err:
        return lock_err
    b.delete()
    return JsonResponse({"detail": "Deleted"}, status=200)


def _stock_ledger_to_json(x: AquacultureFishStockLedger) -> dict:
    cyc_id = getattr(x, "production_cycle_id", None)
    cname = ""
    if cyc_id and getattr(x, "production_cycle", None):
        cname = (x.production_cycle.name or "").strip()
    je = x.journal_entry
    lr = (x.loss_reason or "").strip()
    return {
        "id": x.id,
        "pond_id": x.pond_id,
        "pond_name": (x.pond.name or "").strip() if getattr(x, "pond_id", None) else "",
        "production_cycle_id": cyc_id,
        "production_cycle_name": cname,
        "entry_date": x.entry_date.isoformat(),
        "entry_kind": x.entry_kind,
        "entry_kind_label": STOCK_LEDGER_ENTRY_KIND_LABELS.get(x.entry_kind, x.entry_kind),
        "loss_reason": lr,
        "loss_reason_label": STOCK_LEDGER_LOSS_REASON_LABELS.get(lr, "") or None,
        "fish_species": x.fish_species,
        "fish_species_other": x.fish_species_other or "",
        "fish_species_label": fish_species_display_label(x.fish_species, x.fish_species_other),
        "fish_count_delta": x.fish_count_delta,
        "weight_kg_delta": str(x.weight_kg_delta),
        "book_value": str(x.book_value),
        "post_to_books": bool(x.post_to_books),
        "memo": x.memo or "",
        "journal_entry_id": x.journal_entry_id,
        "journal_is_posted": bool(je.is_posted) if je else False,
        "journal_entry_number": (je.entry_number or "") if je else "",
        "created_at": x.created_at.isoformat() if x.created_at else "",
    }


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def aquaculture_stock_ledger_reference(request):
    err = _aquaculture_access(request)
    if err:
        return err
    return JsonResponse(
        {
            "entry_kind": [{"id": c, "label": lbl} for c, lbl in STOCK_LEDGER_ENTRY_KIND_CHOICES],
            "loss_reason": [{"id": c, "label": lbl} for c, lbl in STOCK_LEDGER_LOSS_REASON_CHOICES],
            "coa_note": STOCK_LEDGER_COA_NOTE,
        }
    )


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def aquaculture_fish_stock_position(request):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    pond_id = None
    raw_p = request.GET.get("pond_id")
    if raw_p and str(raw_p).strip().isdigit():
        pond_id = int(raw_p)
        if not _pond_for_company(cid, pond_id):
            return JsonResponse({"detail": "pond not found"}, status=404)
    cy_id = None
    raw_c = request.GET.get("production_cycle_id")
    if raw_c and str(raw_c).strip().isdigit():
        cy_id = int(raw_c)
        cy = AquacultureProductionCycle.objects.filter(pk=cy_id, company_id=cid).first()
        if not cy:
            return JsonResponse({"detail": "production_cycle not found"}, status=404)
        if pond_id is not None and cy.pond_id != pond_id:
            return JsonResponse({"detail": "production_cycle_id does not belong to pond_id"}, status=400)
    species_raw = (request.GET.get("fish_species") or "").strip()
    species_filter = species_raw if species_raw else None
    entries_after = pond_live_data_after_date(cid, pond_id) if pond_id is not None else None
    rows = compute_fish_stock_position_rows(
        cid,
        pond_id=pond_id,
        production_cycle_id=cy_id,
        fish_species_filter=species_filter,
        entries_after_date=entries_after,
    )
    payload: dict = {"rows": rows}
    if str(request.GET.get("breakdown", "")).lower() in ("1", "true", "yes", "cycle_species"):
        payload["breakdown_rows"] = compute_fish_stock_position_breakdown_rows(
            cid,
            pond_id=pond_id,
            production_cycle_id=cy_id,
            fish_species_filter=species_filter,
            entries_after_date=entries_after,
        )
    return JsonResponse(payload)


def _parse_optional_int(raw, *, name: str) -> tuple[int | None, JsonResponse | None]:
    if raw is None or str(raw).strip() == "":
        return None, None
    s = str(raw).strip()
    if not s.lstrip("-").isdigit():
        return None, JsonResponse({"detail": f"{name} must be an integer"}, status=400)
    return int(s), None


def _parse_iso_date_qs(raw, *, name: str) -> tuple[date | None, JsonResponse | None]:
    if raw is None or str(raw).strip() == "":
        return None, None
    d = _parse_date(raw)
    if not d:
        return None, JsonResponse({"detail": f"{name} must be YYYY-MM-DD"}, status=400)
    return d, None


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def aquaculture_fish_biomass_ledger(request):
    """Unified, read-only ledger of every event that moved fish biomass."""
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    pond_id, e = _parse_optional_int(request.GET.get("pond_id"), name="pond_id")
    if e:
        return e
    if pond_id is not None and not _pond_for_company(cid, pond_id):
        return JsonResponse({"detail": "pond not found"}, status=404)
    cy_id, e = _parse_optional_int(request.GET.get("production_cycle_id"), name="production_cycle_id")
    if e:
        return e
    if cy_id is not None:
        cy = AquacultureProductionCycle.objects.filter(pk=cy_id, company_id=cid).first()
        if not cy:
            return JsonResponse({"detail": "production_cycle not found"}, status=404)
        if pond_id is not None and cy.pond_id != pond_id:
            return JsonResponse({"detail": "production_cycle_id does not belong to pond_id"}, status=400)
    df, e = _parse_iso_date_qs(request.GET.get("date_from"), name="date_from")
    if e:
        return e
    dt, e = _parse_iso_date_qs(request.GET.get("date_to"), name="date_to")
    if e:
        return e
    if df and dt and df > dt:
        return JsonResponse({"detail": "date_from cannot be after date_to"}, status=400)
    species_raw = (request.GET.get("fish_species") or "").strip()
    species_filter = species_raw if species_raw else None
    raw_sources = (request.GET.get("sources") or "").strip()
    sources: frozenset[str] | None = None
    if raw_sources:
        wanted = {s.strip() for s in raw_sources.split(",") if s.strip()}
        valid = wanted & set(FISH_BIOMASS_LEDGER_SOURCE_LABELS.keys())
        if not valid:
            return JsonResponse(
                {
                    "detail": "Unknown sources value. Allowed: "
                    + ",".join(sorted(FISH_BIOMASS_LEDGER_SOURCE_LABELS.keys()))
                },
                status=400,
            )
        sources = frozenset(valid)
    try:
        limit = int(request.GET.get("limit") or 500)
    except (TypeError, ValueError):
        return JsonResponse({"detail": "limit must be an integer"}, status=400)
    limit = max(1, min(limit, 2000))

    rows = compute_fish_biomass_ledger_rows(
        cid,
        pond_id=pond_id,
        production_cycle_id=cy_id,
        fish_species_filter=species_filter,
        date_from=df,
        date_to=dt,
        sources=sources,
        limit=limit,
    )
    return JsonResponse(
        {
            "rows": rows,
            "row_count": len(rows),
            "limit": limit,
            "sources": [
                {"id": k, "label": v} for k, v in FISH_BIOMASS_LEDGER_SOURCE_LABELS.items()
            ],
        }
    )


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def aquaculture_pond_warehouse_consumption_ledger(request):
    """Read-only ledger of feed and medicine consumed from each pond's warehouse."""
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    pond_id, e = _parse_optional_int(request.GET.get("pond_id"), name="pond_id")
    if e:
        return e
    if pond_id is not None and not _pond_for_company(cid, pond_id):
        return JsonResponse({"detail": "pond not found"}, status=404)
    cy_id, e = _parse_optional_int(request.GET.get("production_cycle_id"), name="production_cycle_id")
    if e:
        return e
    if cy_id is not None:
        cy = AquacultureProductionCycle.objects.filter(pk=cy_id, company_id=cid).first()
        if not cy:
            return JsonResponse({"detail": "production_cycle not found"}, status=404)
        if pond_id is not None and cy.pond_id != pond_id:
            return JsonResponse({"detail": "production_cycle_id does not belong to pond_id"}, status=400)
    df, e = _parse_iso_date_qs(request.GET.get("date_from"), name="date_from")
    if e:
        return e
    dt, e = _parse_iso_date_qs(request.GET.get("date_to"), name="date_to")
    if e:
        return e
    if df and dt and df > dt:
        return JsonResponse({"detail": "date_from cannot be after date_to"}, status=400)
    kind_raw = (request.GET.get("kind") or "").strip().lower()
    if kind_raw and kind_raw not in {"feed", "medicine", "feed_consumed", "medicine_consumed", "med"}:
        return JsonResponse({"detail": "kind must be one of feed, medicine"}, status=400)
    try:
        limit = int(request.GET.get("limit") or 500)
    except (TypeError, ValueError):
        return JsonResponse({"detail": "limit must be an integer"}, status=400)
    limit = max(1, min(limit, 2000))

    rows = compute_pond_warehouse_consumption_rows(
        cid,
        pond_id=pond_id,
        production_cycle_id=cy_id,
        kind=kind_raw or None,
        date_from=df,
        date_to=dt,
        limit=limit,
    )
    return JsonResponse(
        {
            "rows": rows,
            "row_count": len(rows),
            "limit": limit,
            "kinds": [{"id": k, "label": lbl} for k, lbl in CONSUMPTION_KIND_LABELS.items()],
        }
    )


@csrf_exempt
@require_http_methods(["GET", "POST"])
@auth_required
@require_company_id
def aquaculture_fish_stock_ledger_list_or_create(request):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    if request.method == "GET":
        qs = AquacultureFishStockLedger.objects.filter(company_id=cid).select_related(
            "pond", "production_cycle", "journal_entry"
        )
        pond_id_int: int | None = None
        pid = request.GET.get("pond_id")
        if pid and str(pid).strip().isdigit():
            pond_id_int = int(pid)
            if not _pond_for_company(cid, pond_id_int):
                return JsonResponse({"detail": "pond not found"}, status=404)
            qs = qs.filter(pond_id=pond_id_int)
            qs = filter_live_pond_queryset(qs, cid, pond_id_int, "entry_date")
        cy_id = None
        raw_c = request.GET.get("production_cycle_id")
        if raw_c and str(raw_c).strip().isdigit():
            cy_id = int(raw_c)
            cy = AquacultureProductionCycle.objects.filter(pk=cy_id, company_id=cid).first()
            if not cy:
                return JsonResponse({"detail": "production_cycle not found"}, status=404)
            if pond_id_int is not None and cy.pond_id != pond_id_int:
                return JsonResponse({"detail": "production_cycle_id does not belong to pond_id"}, status=400)
            qs = qs.filter(production_cycle_id=cy_id)
        species_raw = (request.GET.get("fish_species") or "").strip()
        if species_raw:
            species_code, _ = normalize_fish_species(species_raw)
            qs = qs.filter(fish_species=species_code)
        try:
            limit = int(str(request.GET.get("limit") or "2000").strip())
        except (TypeError, ValueError):
            return JsonResponse({"detail": "limit must be an integer"}, status=400)
        limit = max(1, min(limit, 5000))
        agg = qs.aggregate(
            n=Count("id"),
            fish=Sum("fish_count_delta"),
            kg=Sum("weight_kg_delta"),
        )
        total_row_count = int(agg["n"] or 0)
        total_fish = int(agg["fish"] or 0)
        total_kg = agg["kg"]
        if total_kg is None:
            total_kg = Decimal("0")
        ordered = qs.order_by("-entry_date", "-id")[:limit]
        rows = [_stock_ledger_to_json(x) for x in ordered]
        want_agg = str(request.GET.get("aggregates") or "").strip().lower() in ("1", "true", "yes")
        if want_agg:
            return JsonResponse(
                {
                    "rows": rows,
                    "total_row_count": total_row_count,
                    "total_fish_count_delta": total_fish,
                    "total_weight_kg_delta": str(total_kg),
                    "limit": limit,
                    "returned": len(rows),
                }
            )
        return JsonResponse(rows, safe=False)

    body, e = parse_json_body(request)
    if e:
        return e
    try:
        pond_id = int(body.get("pond_id"))
    except (TypeError, ValueError):
        return JsonResponse({"detail": "pond_id is required and must be an integer"}, status=400)
    pond = _pond_for_company(cid, pond_id)
    if not pond:
        return JsonResponse({"detail": "Pond not found"}, status=404)
    ed = _parse_date(body.get("entry_date"))
    lock_err = _pond_write_lock_response(cid, pond_id, ed)
    if lock_err:
        return lock_err
    if not ed:
        return JsonResponse({"detail": "entry_date is required (YYYY-MM-DD)"}, status=400)
    kind, kerr = normalize_stock_ledger_entry_kind(body.get("entry_kind"))
    if kerr:
        return JsonResponse({"detail": kerr}, status=400)
    lr, lerr = normalize_stock_ledger_loss_reason(body.get("loss_reason"), kind)
    if lerr:
        return JsonResponse({"detail": lerr}, status=400)
    fs, fserr = normalize_fish_species(body.get("fish_species"))
    if fserr:
        return JsonResponse({"detail": fserr}, status=400)
    fso = normalize_fish_species_other(body.get("fish_species_other"), fs)
    try:
        fcd = int(body.get("fish_count_delta", 0))
    except (TypeError, ValueError):
        return JsonResponse({"detail": "fish_count_delta must be an integer"}, status=400)
    wkd = _decimal(body.get("weight_kg_delta"), "0")
    bv = _money_q(_decimal(body.get("book_value"), "0"))
    if bv < 0:
        return JsonResponse({"detail": "book_value cannot be negative"}, status=400)
    post_books = body.get("post_to_books")
    if post_books is None:
        post_books = False
    else:
        post_books = bool(post_books)
    if post_books and bv <= 0:
        return JsonResponse({"detail": "post_to_books requires book_value greater than zero"}, status=400)
    if fcd == 0 or wkd == 0:
        return JsonResponse(
            {"detail": "fish_count_delta and weight_kg_delta must both be non-zero."},
            status=400,
        )
    if kind == "loss":
        if fcd > 0 or wkd > 0:
            return JsonResponse({"detail": "For entry_kind loss, fish_count_delta and weight_kg_delta must be <= 0"}, status=400)
    cycle_obj = None
    raw_cy = body.get("production_cycle_id")
    if raw_cy not in (None, ""):
        try:
            cy_id = int(raw_cy)
        except (TypeError, ValueError):
            return JsonResponse({"detail": "production_cycle_id must be an integer or null"}, status=400)
        cycle_obj = _cycle_for_company(cid, cy_id)
        if not cycle_obj:
            return JsonResponse({"detail": "Production cycle not found"}, status=404)
        if cycle_obj.pond_id != pond.id:
            return JsonResponse({"detail": "production_cycle_id does not belong to the selected pond"}, status=400)

    is_write_down = True
    if kind == "adjustment":
        if fcd >= 0 and wkd >= 0 and (fcd > 0 or wkd > 0):
            is_write_down = False
        elif fcd <= 0 and wkd <= 0 and (fcd < 0 or wkd < 0):
            is_write_down = True
        else:
            return JsonResponse(
                {"detail": "Manual adjustment cannot mix positive and negative signs across count and weight"},
                status=400,
            )
    if post_books:
        if kind == "adjustment" and not is_write_down and (fcd <= 0 or wkd <= 0):
            return JsonResponse(
                {"detail": "Count gain posting requires positive fish_count_delta and positive weight_kg_delta."},
                status=400,
            )
        if is_write_down and (fcd >= 0 or wkd >= 0):
            return JsonResponse(
                {"detail": "Write-down posting requires negative fish_count_delta and negative weight_kg_delta."},
                status=400,
            )

    memo = str(body.get("memo") or "")[:5000]
    pond_label = (pond.name or "").strip() or f"Pond #{pond.id}"
    line_memo = memo or f"Aquaculture fish stock — {kind}"

    if post_books:
        bio = ChartOfAccount.objects.filter(company_id=cid, account_code="1581", is_active=True).first()
        exp = ChartOfAccount.objects.filter(company_id=cid, account_code="6726", is_active=True).first()
        gain = ChartOfAccount.objects.filter(company_id=cid, account_code="4244", is_active=True).first()
        if not bio or (is_write_down and not exp) or (not is_write_down and not gain):
            return JsonResponse(
                {
                    "detail": (
                        "Could not post GL: missing chart accounts 1581 (biological inventory), "
                        "6726 (mortality expense), and/or 4244 (count gain). Re-save Company settings with "
                        "Aquaculture enabled to seed new COA lines, or add these codes manually."
                    )
                },
                status=400,
            )

    with transaction.atomic():
        led = AquacultureFishStockLedger(
            company_id=cid,
            pond=pond,
            production_cycle=cycle_obj,
            entry_date=ed,
            entry_kind=kind,
            loss_reason=lr,
            fish_species=fs,
            fish_species_other=fso,
            fish_count_delta=fcd,
            weight_kg_delta=wkd,
            book_value=bv,
            post_to_books=post_books,
            memo=memo,
        )
        led.save()
        if post_books:
            je = post_aquaculture_fish_stock_ledger_journal(
                cid,
                led.id,
                ed,
                is_write_down=is_write_down,
                book_value=bv,
                pond_label=pond_label,
                line_memo=line_memo[:300],
            )
            if je:
                led.journal_entry = je
                led.save(update_fields=["journal_entry"])

    led = (
        AquacultureFishStockLedger.objects.filter(pk=led.pk)
        .select_related("pond", "production_cycle", "journal_entry")
        .first()
    )
    return JsonResponse(_stock_ledger_to_json(led), status=201)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
@auth_required
@require_company_id
def aquaculture_fish_stock_ledger_detail(request, ledger_id: int):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    led = (
        AquacultureFishStockLedger.objects.filter(pk=ledger_id, company_id=cid)
        .select_related("pond", "production_cycle", "journal_entry")
        .first()
    )
    if not led:
        return JsonResponse({"detail": "Not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(_stock_ledger_to_json(led))
    if request.method == "DELETE":
        lock_err = _pond_write_lock_response(cid, led.pond_id, led.entry_date)
        if lock_err:
            return lock_err
        with transaction.atomic():
            led = (
                AquacultureFishStockLedger.objects.select_for_update()
                .filter(pk=ledger_id, company_id=cid)
                .first()
            )
            if not led:
                return JsonResponse({"detail": "Not found"}, status=404)
            if led.journal_entry_id:
                je = (
                    JournalEntry.objects.select_for_update()
                    .filter(pk=led.journal_entry_id, company_id=cid)
                    .first()
                )
                expected = f"AUTO-AQ-BIOSTK-{ledger_id}"
                if not je or (je.entry_number or "").strip() != expected:
                    return JsonResponse(
                        {
                            "detail": (
                                "This row is linked to a journal that is not the automatic fish-stock entry "
                                f"({expected}). Adjust or void that journal in the GL first, then retry."
                            )
                        },
                        status=400,
                    )
                je.delete()
            led.delete()
        return JsonResponse({"detail": "Deleted"}, status=200)

    body, e = parse_json_body(request)
    if e:
        return e
    if led.journal_entry_id:
        if set(body.keys()) - {"memo"}:
            return JsonResponse({"detail": "Only memo can be edited after GL posting"}, status=400)
        if "memo" in body:
            led.memo = str(body.get("memo") or "")[:5000]
            led.save(update_fields=["memo", "updated_at"])
        led = AquacultureFishStockLedger.objects.filter(pk=led.pk).select_related("pond", "production_cycle", "journal_entry").first()
        return JsonResponse(_stock_ledger_to_json(led))

    ed = _parse_date(body.get("entry_date")) if "entry_date" in body else led.entry_date
    if "entry_date" in body and not ed:
        return JsonResponse({"detail": "Invalid entry_date"}, status=400)
    if "entry_date" in body:
        led.entry_date = ed
    if "entry_kind" in body:
        kind, kerr = normalize_stock_ledger_entry_kind(body.get("entry_kind"))
        if kerr:
            return JsonResponse({"detail": kerr}, status=400)
        led.entry_kind = kind
    kind_cur = led.entry_kind
    if "loss_reason" in body:
        lr, lerr = normalize_stock_ledger_loss_reason(body.get("loss_reason"), kind_cur)
        if lerr:
            return JsonResponse({"detail": lerr}, status=400)
        led.loss_reason = lr
    if "fish_species" in body:
        fs, fserr = normalize_fish_species(body.get("fish_species"))
        if fserr:
            return JsonResponse({"detail": fserr}, status=400)
        led.fish_species = fs
    if "fish_species_other" in body:
        led.fish_species_other = normalize_fish_species_other(body.get("fish_species_other"), led.fish_species)
    elif "fish_species" in body:
        led.fish_species_other = normalize_fish_species_other(None, led.fish_species)
    if "fish_count_delta" in body:
        try:
            led.fish_count_delta = int(body.get("fish_count_delta"))
        except (TypeError, ValueError):
            return JsonResponse({"detail": "fish_count_delta must be an integer"}, status=400)
    if "weight_kg_delta" in body:
        led.weight_kg_delta = _decimal(body.get("weight_kg_delta"), "0")
    if "book_value" in body:
        led.book_value = _money_q(_decimal(body.get("book_value"), "0"))
    if "memo" in body:
        led.memo = str(body.get("memo") or "")[:5000]
    if "production_cycle_id" in body:
        raw_cy = body.get("production_cycle_id")
        if raw_cy in (None, ""):
            led.production_cycle = None
        else:
            try:
                cy_id = int(raw_cy)
            except (TypeError, ValueError):
                return JsonResponse({"detail": "production_cycle_id must be an integer or null"}, status=400)
            cy = _cycle_for_company(cid, cy_id)
            if not cy:
                return JsonResponse({"detail": "Production cycle not found"}, status=404)
            if cy.pond_id != led.pond_id:
                return JsonResponse({"detail": "production_cycle_id does not belong to this row's pond"}, status=400)
            led.production_cycle = cy
    if "pond_id" in body:
        try:
            pid = int(body["pond_id"])
        except (TypeError, ValueError):
            return JsonResponse({"detail": "pond_id must be an integer"}, status=400)
        p2 = _pond_for_company(cid, pid)
        if not p2:
            return JsonResponse({"detail": "Pond not found"}, status=404)
        led.pond = p2
        if led.production_cycle_id and led.production_cycle.pond_id != p2.id:
            led.production_cycle = None

    if led.fish_count_delta == 0 or led.weight_kg_delta == 0:
        return JsonResponse(
            {"detail": "fish_count_delta and weight_kg_delta must both be non-zero."},
            status=400,
        )

    led.save()
    led = AquacultureFishStockLedger.objects.filter(pk=led.pk).select_related("pond", "production_cycle", "journal_entry").first()
    return JsonResponse(_stock_ledger_to_json(led))


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def aquaculture_pl_summary(request):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    start = _parse_date(request.GET.get("start_date"))
    end = _parse_date(request.GET.get("end_date"))
    if not start or not end:
        return JsonResponse({"detail": "start_date and end_date are required (YYYY-MM-DD)"}, status=400)
    if start > end:
        return JsonResponse({"detail": "start_date must be on or before end_date"}, status=400)

    pond_filter_id = None
    raw_p = request.GET.get("pond_id")
    if raw_p and str(raw_p).strip().isdigit():
        pond_filter_id = int(raw_p)
        if not _pond_for_company(cid, pond_filter_id):
            return JsonResponse({"detail": "Pond not found"}, status=404)

    cycle_filter_id = None
    scoped_cycle = None
    raw_c = request.GET.get("cycle_id")
    if raw_c and str(raw_c).strip().isdigit():
        cycle_filter_id = int(raw_c)
        scoped_cycle = AquacultureProductionCycle.objects.filter(pk=cycle_filter_id, company_id=cid).first()
        if not scoped_cycle:
            return JsonResponse({"detail": "Production cycle not found"}, status=404)
        if pond_filter_id is not None and scoped_cycle.pond_id != pond_filter_id:
            return JsonResponse({"detail": "cycle_id does not belong to the selected pond"}, status=400)
        pond_filter_id = scoped_cycle.pond_id

    include_cycle_breakdown = str(request.GET.get("include_cycle_breakdown", "")).lower() in ("1", "true", "yes")

    if pond_filter_id is not None:
        start = effective_pl_start_for_pond(cid, pond_filter_id, start)
        if start > end:
            return JsonResponse(
                {
                    "start_date": start.isoformat(),
                    "end_date": end.isoformat(),
                    "ponds": [],
                    "expenses_by_category": [],
                    "totals": {
                        "revenue": "0.00",
                        "operating_expenses": "0.00",
                        "payroll_allocated": "0.00",
                        "total_costs": "0.00",
                        "profit": "0.00",
                    },
                    "data_bank_live_only": True,
                }
            )

    payload = compute_aquaculture_pl_summary_dict(
        cid,
        start,
        end,
        pond_filter_id,
        cycle_filter_id,
        scoped_cycle,
        include_cycle_breakdown,
    )
    return JsonResponse(payload)


def _profit_transfer_to_json(t: AquaculturePondProfitTransfer, *, include_journal: bool = False) -> dict:
    je = t.journal_entry
    cyc_id = getattr(t, "production_cycle_id", None)
    cyc_name = ""
    if cyc_id and getattr(t, "production_cycle", None):
        cyc_name = (t.production_cycle.name or "").strip()
    out = {
        "id": t.id,
        "pond_id": t.pond_id,
        "pond_name": (t.pond.name or "") if t.pond_id else "",
        "production_cycle_id": cyc_id,
        "production_cycle_name": cyc_name,
        "transfer_date": t.transfer_date.isoformat(),
        "amount": str(t.amount),
        "debit_account_id": t.debit_account_id,
        "debit_account_code": (t.debit_account.account_code or "") if t.debit_account_id else "",
        "debit_account_name": (t.debit_account.account_name or "") if t.debit_account_id else "",
        "credit_account_id": t.credit_account_id,
        "credit_account_code": (t.credit_account.account_code or "") if t.credit_account_id else "",
        "credit_account_name": (t.credit_account.account_name or "") if t.credit_account_id else "",
        "memo": t.memo or "",
        "journal_entry_id": t.journal_entry_id,
        "journal_is_posted": bool(je.is_posted) if je else False,
        "journal_entry_number": (je.entry_number or "") if je else "",
    }
    if include_journal:
        out["journal_entry"] = _entry_to_json(je) if je else None
    return out


@csrf_exempt
@require_http_methods(["GET", "POST"])
@auth_required
@require_company_id
def aquaculture_pond_profit_transfers(request):
    """
    GET: recent pond-scoped profit transfers (each posts Dr/Cr to chosen GL accounts).
    POST: create balanced journal (optionally posted) and link audit row to the pond.
    """
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    if request.method == "GET":
        qs = (
            AquaculturePondProfitTransfer.objects.filter(company_id=cid)
            .select_related("pond", "production_cycle", "debit_account", "credit_account", "journal_entry")
            .order_by("-transfer_date", "-id")[:200]
        )
        return JsonResponse([_profit_transfer_to_json(t, include_journal=False) for t in qs], safe=False)

    body, e = parse_json_body(request)
    if e:
        return e
    try:
        pond_id = int(body.get("pond_id"))
    except (TypeError, ValueError):
        return JsonResponse({"detail": "pond_id is required and must be an integer"}, status=400)
    pond = _pond_for_company(cid, pond_id)
    if not pond:
        return JsonResponse({"detail": "Pond not found"}, status=404)
    cycle_obj = None
    raw_cy = body.get("production_cycle_id")
    if raw_cy not in (None, ""):
        try:
            cy_id = int(raw_cy)
        except (TypeError, ValueError):
            return JsonResponse({"detail": "production_cycle_id must be an integer"}, status=400)
        cycle_obj = _cycle_for_company(cid, cy_id)
        if not cycle_obj:
            return JsonResponse({"detail": "Production cycle not found"}, status=404)
        if cycle_obj.pond_id != pond.id:
            return JsonResponse({"detail": "production_cycle_id does not belong to the selected pond"}, status=400)
    td = _parse_date(body.get("transfer_date"))
    if not td:
        return JsonResponse({"detail": "transfer_date is required (YYYY-MM-DD)"}, status=400)
    amt = _decimal(body.get("amount"))
    if amt <= 0:
        return JsonResponse({"detail": "amount must be greater than zero"}, status=400)
    amt = amt.quantize(Decimal("0.01"))
    try:
        debit_id = int(body.get("debit_account_id"))
        credit_id = int(body.get("credit_account_id"))
    except (TypeError, ValueError):
        return JsonResponse(
            {"detail": "debit_account_id and credit_account_id are required integers"},
            status=400,
        )
    if debit_id == credit_id:
        return JsonResponse({"detail": "Debit and credit accounts must differ"}, status=400)
    dr = ChartOfAccount.objects.filter(pk=debit_id, company_id=cid).first()
    cr = ChartOfAccount.objects.filter(pk=credit_id, company_id=cid).first()
    if not dr or not cr:
        return JsonResponse({"detail": "One or both GL accounts were not found for this company"}, status=400)
    memo = (body.get("memo") or "")[:5000]
    do_post = body.get("post")
    if do_post is None:
        do_post = True
    else:
        do_post = bool(do_post)

    pond_label = (pond.name or "").strip() or f"Pond #{pond.id}"
    cycle_bit = f" ({cycle_obj.name})" if cycle_obj else ""
    desc = (body.get("description") or "").strip()
    if not desc:
        desc = f"Aquaculture pond profit transfer — {pond_label}{cycle_bit}"
    desc = desc[:500]

    with transaction.atomic():
        count = JournalEntry.objects.filter(company_id=cid).count()
        je = JournalEntry(
            company_id=cid,
            entry_number=f"JE-{count + 1}",
            entry_date=td,
            description=desc,
            station_id=None,
            is_posted=False,
            posted_at=None,
        )
        je.save()
        line_desc = (memo or desc)[:300]
        JournalEntryLine.objects.create(
            journal_entry=je,
            account_id=debit_id,
            debit=amt,
            credit=Decimal("0"),
            description=line_desc,
            station_id=None,
        )
        JournalEntryLine.objects.create(
            journal_entry=je,
            account_id=credit_id,
            debit=Decimal("0"),
            credit=amt,
            description=line_desc,
            station_id=None,
        )
        xfer = AquaculturePondProfitTransfer(
            company_id=cid,
            pond=pond,
            production_cycle=cycle_obj,
            transfer_date=td,
            amount=amt,
            debit_account_id=debit_id,
            credit_account_id=credit_id,
            memo=memo,
            journal_entry=je,
        )
        xfer.save()
        if do_post:
            je.is_posted = True
            je.posted_at = django_timezone.now()
            je.save()

    xfer = (
        AquaculturePondProfitTransfer.objects.filter(pk=xfer.pk)
        .select_related("pond", "production_cycle", "debit_account", "credit_account", "journal_entry")
        .prefetch_related(
            "journal_entry__lines",
            "journal_entry__lines__account",
            "journal_entry__lines__station",
            "journal_entry__station",
        )
        .first()
    )
    return JsonResponse(_profit_transfer_to_json(xfer, include_journal=True), status=201)


def _fish_transfer_line_to_json(line: AquacultureFishPondTransferLine) -> dict:
    cname = ""
    if line.to_production_cycle_id and getattr(line, "to_production_cycle", None):
        cname = (line.to_production_cycle.name or "").strip()
    tpname = ""
    if getattr(line, "to_pond", None):
        tpname = (line.to_pond.name or "").strip()
    return {
        "id": line.id,
        "to_pond_id": line.to_pond_id,
        "to_pond_name": tpname,
        "to_production_cycle_id": line.to_production_cycle_id,
        "to_production_cycle_name": cname,
        "weight_kg": str(line.weight_kg),
        "fish_count": line.fish_count,
        "pcs_per_kg": str(line.pcs_per_kg) if line.pcs_per_kg is not None else None,
        "cost_amount": str(_money_q(line.cost_amount or Decimal(0))),
    }


def _fish_transfer_to_json(t: AquacultureFishPondTransfer) -> dict:
    from_name = (t.from_pond.name or "").strip() if getattr(t, "from_pond", None) else ""
    fcname = ""
    if t.from_production_cycle_id and getattr(t, "from_production_cycle", None):
        fcname = (t.from_production_cycle.name or "").strip()
    lines = [_fish_transfer_line_to_json(x) for x in t.lines.all()]
    return {
        "id": t.id,
        "company_id": t.company_id,
        "from_pond_id": t.from_pond_id,
        "from_pond_name": from_name,
        "from_production_cycle_id": t.from_production_cycle_id,
        "from_production_cycle_name": fcname,
        "transfer_date": t.transfer_date.isoformat(),
        "fish_species": t.fish_species or "tilapia",
        "fish_species_label": fish_species_display_label(t.fish_species, t.fish_species_other),
        "fish_species_other": t.fish_species_other or "",
        "memo": t.memo or "",
        "lines": lines,
        "created_at": t.created_at.isoformat() if t.created_at else "",
    }


def _parse_fish_transfer_payload(cid: int, body: dict) -> tuple[JsonResponse | None, dict | None]:
    """Shared validation for POST (create) and PUT (replace). Returns (error_response, None) or (None, data)."""
    try:
        from_pond_id = int(body.get("from_pond_id"))
    except (TypeError, ValueError):
        return JsonResponse({"detail": "from_pond_id is required and must be an integer"}, status=400), None
    from_pond = _pond_for_company(cid, from_pond_id)
    if not from_pond:
        return JsonResponse({"detail": "from_pond not found"}, status=404), None
    td = _parse_date(body.get("transfer_date"))
    if not td:
        return JsonResponse({"detail": "transfer_date is required (YYYY-MM-DD)"}, status=400), None
    sp, sperr = normalize_fish_species(body.get("fish_species"))
    if sperr:
        return JsonResponse({"detail": sperr}, status=400), None
    sp_other = normalize_fish_species_other(body.get("fish_species_other"), sp)
    from_cycle_obj = None
    raw_fc = body.get("from_production_cycle_id")
    if raw_fc not in (None, ""):
        try:
            fcy = int(raw_fc)
        except (TypeError, ValueError):
            return JsonResponse({"detail": "from_production_cycle_id must be an integer or null"}, status=400), None
        from_cycle_obj = AquacultureProductionCycle.objects.filter(
            pk=fcy, company_id=cid, pond_id=from_pond_id
        ).first()
        if not from_cycle_obj:
            return JsonResponse({"detail": "from_production_cycle_id not found for this pond"}, status=404), None
    raw_lines = body.get("lines")
    if not isinstance(raw_lines, list) or len(raw_lines) == 0:
        return JsonResponse({"detail": "lines must be a non-empty array"}, status=400), None

    memo = str(body.get("memo") or "")[:5000]
    parsed_rows: list[dict] = []
    total_transfer_weight = Decimal("0")
    for i, row in enumerate(raw_lines):
        if not isinstance(row, dict):
            return JsonResponse({"detail": f"lines[{i}] must be an object"}, status=400), None
        try:
            to_pond_id = int(row.get("to_pond_id"))
        except (TypeError, ValueError):
            return JsonResponse({"detail": f"lines[{i}].to_pond_id is required (integer)"}, status=400), None
        if to_pond_id == from_pond_id:
            return JsonResponse({"detail": f"lines[{i}].to_pond_id must differ from from_pond_id"}, status=400), None
        to_pond = _pond_for_company(cid, to_pond_id)
        if not to_pond:
            return JsonResponse({"detail": f"lines[{i}].to_pond not found"}, status=404), None
        wk = _decimal(row.get("weight_kg"))
        if wk <= 0:
            return JsonResponse({"detail": f"lines[{i}].weight_kg must be greater than zero"}, status=400), None
        total_transfer_weight += wk
        parsed_rows.append({"index": i, "row": row, "to_pond": to_pond, "wk": wk})

    total_transfer_weight = _money_q(total_transfer_weight)
    line_models: list[AquacultureFishPondTransferLine] = []
    for pr in parsed_rows:
        i = pr["index"]
        row = pr["row"]
        to_pond = pr["to_pond"]
        wk = pr["wk"]
        fcount = row.get("fish_count")
        if fcount in (None, ""):
            return JsonResponse(
                {"detail": f"lines[{i}].fish_count is required and must be an integer greater than zero"},
                status=400,
            ), None
        try:
            fcount_i = int(fcount)
        except (TypeError, ValueError):
            return JsonResponse({"detail": f"lines[{i}].fish_count must be an integer"}, status=400), None
        if fcount_i <= 0:
            return JsonResponse(
                {"detail": f"lines[{i}].fish_count must be greater than zero"},
                status=400,
            ), None
        cost_amt = _money_q(_decimal(row.get("cost_amount"), "0"))
        if cost_amt < 0:
            return JsonResponse({"detail": f"lines[{i}].cost_amount cannot be negative"}, status=400), None
        cost_amt = resolve_auto_transfer_line_cost(
            company_id=cid,
            from_pond_id=from_pond_id,
            transfer_date=td,
            from_cycle=from_cycle_obj,
            weight_kg=wk,
            submitted_cost=cost_amt,
            transfer_total_weight_kg=total_transfer_weight,
            fish_count=fcount_i,
        )
        fc_raw = row.get("to_production_cycle_id")
        to_cycle = None
        if fc_raw not in (None, ""):
            try:
                tcy = int(fc_raw)
            except (TypeError, ValueError):
                return JsonResponse({"detail": f"lines[{i}].to_production_cycle_id must be integer or null"}, status=400), None
            to_cycle = AquacultureProductionCycle.objects.filter(
                pk=tcy, company_id=cid, pond_id=to_pond_id
            ).first()
            if not to_cycle:
                return JsonResponse({"detail": f"lines[{i}].to_production_cycle_id not found for destination pond"}, status=404), None
        pcs_raw = row.get("pcs_per_kg")
        pcs_dec = None
        if pcs_raw not in (None, ""):
            pcs_dec = _decimal(pcs_raw)
            if pcs_dec < 0:
                return JsonResponse({"detail": f"lines[{i}].pcs_per_kg cannot be negative"}, status=400), None
        line_models.append(
            AquacultureFishPondTransferLine(
                to_pond=to_pond,
                to_production_cycle=to_cycle,
                weight_kg=wk,
                fish_count=fcount_i,
                pcs_per_kg=pcs_dec,
                cost_amount=cost_amt,
            )
        )

    return None, {
        "from_pond": from_pond,
        "from_cycle_obj": from_cycle_obj,
        "td": td,
        "sp": sp,
        "sp_other": sp_other,
        "memo": memo,
        "line_models": line_models,
    }


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def aquaculture_pond_roles_reference(request):
    err = _aquaculture_access(request)
    if err:
        return err
    return JsonResponse(
        [{"id": c, "label": lbl} for c, lbl in AQUACULTURE_POND_ROLE_CHOICES],
        safe=False,
    )


@csrf_exempt
@require_http_methods(["GET", "POST"])
@auth_required
@require_company_id
def aquaculture_fish_pond_transfers(request):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    if request.method == "GET":
        qs = (
            AquacultureFishPondTransfer.objects.filter(company_id=cid)
            .select_related("from_pond", "from_production_cycle")
            .prefetch_related("lines__to_pond", "lines__to_production_cycle")
            .order_by("-transfer_date", "-id")
        )
        fp = request.GET.get("from_pond_id")
        if fp and str(fp).strip().isdigit():
            fp_int = int(fp)
            qs = qs.filter(from_pond_id=fp_int)
            qs = filter_live_pond_queryset(qs, cid, fp_int, "transfer_date")
        tp = request.GET.get("to_pond_id")
        if tp and str(tp).strip().isdigit():
            tp_int = int(tp)
            qs = qs.filter(lines__to_pond_id=tp_int).distinct()
            qs = filter_live_pond_queryset(qs, cid, tp_int, "transfer_date")
        ordered_ids = list(qs.values_list("pk", flat=True)[:300])
        xfer_qs = AquacultureFishPondTransfer.objects.filter(pk__in=ordered_ids).select_related(
            "from_pond", "from_production_cycle"
        ).prefetch_related("lines__to_pond", "lines__to_production_cycle")
        for t in xfer_qs:
            backfill_missing_transfer_line_costs(t)
        if ordered_ids:
            order = Case(*[When(pk=pk, then=pos) for pos, pk in enumerate(ordered_ids)])
            xfer_qs = xfer_qs.order_by(order)
        else:
            xfer_qs = xfer_qs.none()
        return JsonResponse(
            {
                "inter_pond_fish_transfer_note": INTER_POND_FISH_TRANSFER_PL_NOTE,
                "transfers": [_fish_transfer_to_json(t) for t in xfer_qs],
            }
        )

    body, e = parse_json_body(request)
    if e:
        return e
    err, data = _parse_fish_transfer_payload(cid, body)
    if err:
        return err
    assert data is not None
    pond_ids = [data["from_pond"].id] + [ln.to_pond_id for ln in data["line_models"]]
    lock_err = _ponds_write_lock_response(cid, pond_ids, data["td"])
    if lock_err:
        return lock_err

    with transaction.atomic():
        xfer = AquacultureFishPondTransfer(
            company_id=cid,
            from_pond=data["from_pond"],
            from_production_cycle=data["from_cycle_obj"],
            transfer_date=data["td"],
            fish_species=data["sp"],
            fish_species_other=data["sp_other"],
            memo=data["memo"],
        )
        xfer.save()
        for ln in data["line_models"]:
            ln.transfer = xfer
            ln.save()

    xfer = (
        AquacultureFishPondTransfer.objects.filter(pk=xfer.pk)
        .select_related("from_pond", "from_production_cycle")
        .prefetch_related("lines__to_pond", "lines__to_production_cycle")
        .first()
    )
    return JsonResponse(
        {
            "inter_pond_fish_transfer_note": INTER_POND_FISH_TRANSFER_PL_NOTE,
            "transfer": _fish_transfer_to_json(xfer),
        },
        status=201,
    )


@csrf_exempt
@require_http_methods(["GET", "DELETE", "PUT"])
@auth_required
@require_company_id
def aquaculture_fish_pond_transfer_detail(request, transfer_id: int):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    t = (
        AquacultureFishPondTransfer.objects.filter(pk=transfer_id, company_id=cid)
        .select_related("from_pond", "from_production_cycle")
        .prefetch_related("lines__to_pond", "lines__to_production_cycle")
        .first()
    )
    if not t:
        return JsonResponse({"detail": "Not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(
            {
                "inter_pond_fish_transfer_note": INTER_POND_FISH_TRANSFER_PL_NOTE,
                "transfer": _fish_transfer_to_json(t),
            }
        )
    if request.method == "PUT":
        body, e = parse_json_body(request)
        if e:
            return e
        err, data = _parse_fish_transfer_payload(cid, body)
        if err:
            return err
        assert data is not None
        pond_ids = [data["from_pond"].id] + [ln.to_pond_id for ln in data["line_models"]]
        lock_err = _ponds_write_lock_response(cid, pond_ids, data["td"])
        if lock_err:
            return lock_err
        with transaction.atomic():
            t.from_pond = data["from_pond"]
            t.from_production_cycle = data["from_cycle_obj"]
            t.transfer_date = data["td"]
            t.fish_species = data["sp"]
            t.fish_species_other = data["sp_other"]
            t.memo = data["memo"]
            t.save()
            t.lines.all().delete()
            for ln in data["line_models"]:
                ln.transfer = t
                ln.save()
        t = (
            AquacultureFishPondTransfer.objects.filter(pk=t.pk)
            .select_related("from_pond", "from_production_cycle")
            .prefetch_related("lines__to_pond", "lines__to_production_cycle")
            .first()
        )
        return JsonResponse(
            {
                "inter_pond_fish_transfer_note": INTER_POND_FISH_TRANSFER_PL_NOTE,
                "transfer": _fish_transfer_to_json(t),
            }
        )
    pond_ids = [t.from_pond_id] + list(t.lines.values_list("to_pond_id", flat=True))
    lock_err = _ponds_write_lock_response(cid, pond_ids, t.transfer_date)
    if lock_err:
        return lock_err
    t.delete()
    return JsonResponse({"detail": "Deleted"}, status=200)


# --- Feeding advice (heuristic / manager workflow) ---------------------------------

_FEEDING_ADVICE_STATUS_LABELS: dict[str, str] = {
    AquacultureFeedingAdvice.STATUS_PENDING_REVIEW: "Pending review",
    AquacultureFeedingAdvice.STATUS_APPROVED: "Approved",
    AquacultureFeedingAdvice.STATUS_APPLIED: "Applied",
    AquacultureFeedingAdvice.STATUS_CANCELLED: "Cancelled",
}


def _user_display(u) -> str:
    if not u:
        return ""
    fn = (getattr(u, "full_name", None) or "").strip()
    if fn:
        return fn
    return (getattr(u, "username", None) or "").strip()


def _feeding_advice_for_company(company_id: int, advice_id: int) -> AquacultureFeedingAdvice | None:
    return (
        AquacultureFeedingAdvice.objects.filter(pk=advice_id, company_id=company_id)
        .select_related(
            "pond",
            "pond__default_feed_item",
            "production_cycle",
            "approved_by",
            "applied_by",
            "created_by",
            "linked_expense",
        )
        .first()
    )


_FEEDING_ADVICE_SACK_SIZES_KG = frozenset({10, 20, 25})


def _parse_feeding_advice_sack_size_kg(raw) -> int | None | str:
    if raw in (None, ""):
        return None
    try:
        v = int(raw)
    except (TypeError, ValueError):
        return "sack_size_kg must be an integer (10, 20, or 25) or null"
    if v not in _FEEDING_ADVICE_SACK_SIZES_KG:
        return "sack_size_kg must be 10, 20, or 25"
    return v


def _feeding_advice_to_json(a: AquacultureFeedingAdvice) -> dict:
    pond_name = ""
    if getattr(a, "pond", None):
        pond_name = (a.pond.name or "").strip()
    eff = effective_advice_text(a.ai_advice_text or "", a.edited_advice_text or "")
    pdf = getattr(a, "pond", None)
    pdf_id = getattr(pdf, "default_feed_item_id", None) if pdf else None
    pdf_name = ""
    if pdf and getattr(pdf, "default_feed_item", None):
        pdf_name = (pdf.default_feed_item.name or "").strip()
    return {
        "id": a.id,
        "pond_id": a.pond_id,
        "pond_name": pond_name,
        "pond_default_feed_item_id": pdf_id,
        "pond_default_feed_item_name": pdf_name,
        "production_cycle_id": a.production_cycle_id,
        "production_cycle_name": (
            (a.production_cycle.name or "").strip() if getattr(a, "production_cycle", None) else ""
        ),
        "target_date": a.target_date.isoformat() if a.target_date else "",
        "status": a.status,
        "status_label": _FEEDING_ADVICE_STATUS_LABELS.get(a.status, a.status),
        "pond_status_snapshot": a.pond_status_snapshot if isinstance(a.pond_status_snapshot, dict) else {},
        "ai_advice_text": a.ai_advice_text or "",
        "edited_advice_text": a.edited_advice_text or "",
        "effective_advice_text": eff,
        "approved_advice_text": a.approved_advice_text or "",
        "suggested_feed_kg": str(a.suggested_feed_kg) if a.suggested_feed_kg is not None else None,
        "sack_size_kg": int(a.sack_size_kg) if a.sack_size_kg is not None else None,
        "approved_at": a.approved_at.isoformat() if a.approved_at else None,
        "approved_by_display": _user_display(getattr(a, "approved_by", None)),
        "applied_feed_kg": str(a.applied_feed_kg) if a.applied_feed_kg is not None else None,
        "applied_at": a.applied_at.isoformat() if a.applied_at else None,
        "applied_by_display": _user_display(getattr(a, "applied_by", None)),
        "linked_expense_id": a.linked_expense_id,
        "linked_expense_category": (
            (a.linked_expense.expense_category or "").strip()
            if getattr(a, "linked_expense_id", None) and getattr(a, "linked_expense", None)
            else ""
        ),
        "created_by_display": _user_display(getattr(a, "created_by", None)),
        "created_at": a.created_at.isoformat() if a.created_at else "",
        "updated_at": a.updated_at.isoformat() if a.updated_at else "",
    }


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def aquaculture_feeding_advice_list(request):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    qs = AquacultureFeedingAdvice.objects.filter(company_id=cid).select_related(
        "pond", "pond__default_feed_item", "production_cycle", "linked_expense"
    )
    pid = request.GET.get("pond_id")
    if pid and str(pid).strip().isdigit():
        qs = qs.filter(pond_id=int(pid))
    st = (request.GET.get("status") or "").strip()
    if st:
        qs = qs.filter(status=st)
    qs = qs.order_by("-target_date", "-id")[:200]
    return JsonResponse([_feeding_advice_to_json(x) for x in qs], safe=False)


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
def aquaculture_feeding_advice_generate(request):
    err = _aquaculture_access(request)
    if err:
        return err
    body, e = parse_json_body(request)
    if e:
        return e
    cid = request.company_id
    raw_pid = body.get("pond_id")
    try:
        pond_id = int(raw_pid)
    except (TypeError, ValueError):
        return JsonResponse({"detail": "pond_id is required (integer)"}, status=400)
    pond = _pond_for_company(cid, pond_id)
    if not pond:
        return JsonResponse({"detail": "Pond not found"}, status=404)
    td = _parse_date(body.get("target_date")) or django_timezone.localdate()
    lock_err = _pond_write_lock_response(cid, pond_id, td)
    if lock_err:
        return lock_err
    cy_id: int | None = None
    raw_cy = body.get("production_cycle_id")
    if raw_cy not in (None, ""):
        try:
            cy_id = int(raw_cy)
        except (TypeError, ValueError):
            return JsonResponse({"detail": "production_cycle_id must be an integer or null"}, status=400)

    temp_dec: Decimal | None = None
    raw_t = body.get("water_temp_c")
    if raw_t not in (None, ""):
        try:
            temp_dec = Decimal(str(raw_t))
        except Exception:
            return JsonResponse({"detail": "water_temp_c must be a number"}, status=400)

    payload, msg = build_feeding_advice_payload(cid, pond_id, td, cy_id, water_temp_c=temp_dec)
    if not payload:
        return JsonResponse({"detail": msg or "Could not generate advice"}, status=400)

    cycle_obj = _cycle_for_company(cid, cy_id) if cy_id is not None else None
    if cy_id is not None and not cycle_obj:
        return JsonResponse({"detail": "Production cycle not found"}, status=404)
    if cycle_obj is not None and cycle_obj.pond_id != pond_id:
        return JsonResponse({"detail": "production_cycle_id does not belong to the selected pond"}, status=400)

    user = getattr(request, "api_user", None)
    sack_sz = _parse_feeding_advice_sack_size_kg(body.get("sack_size_kg"))
    if isinstance(sack_sz, str):
        return JsonResponse({"detail": sack_sz}, status=400)
    if sack_sz is None:
        sack_sz = 25

    a = AquacultureFeedingAdvice(
        company_id=cid,
        pond=pond,
        production_cycle=cycle_obj,
        target_date=td,
        status=AquacultureFeedingAdvice.STATUS_PENDING_REVIEW,
        pond_status_snapshot=payload["pond_status_snapshot"],
        ai_advice_text=payload["ai_advice_text"],
        edited_advice_text="",
        suggested_feed_kg=payload.get("suggested_feed_kg"),
        sack_size_kg=sack_sz,
        created_by=user,
    )
    a.save()
    a = _feeding_advice_for_company(cid, a.id)
    return JsonResponse(_feeding_advice_to_json(a), status=201)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
@auth_required
@require_company_id
def aquaculture_feeding_advice_detail(request, advice_id: int):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    a = _feeding_advice_for_company(cid, advice_id)
    if not a:
        return JsonResponse({"detail": "Not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(_feeding_advice_to_json(a))
    if request.method == "DELETE":
        if a.status != AquacultureFeedingAdvice.STATUS_CANCELLED:
            return JsonResponse(
                {"detail": "Only cancelled feeding advice can be deleted. Cancel a draft first, or leave other records for audit."},
                status=400,
            )
        lock_err = _pond_write_lock_response(cid, a.pond_id, a.target_date)
        if lock_err:
            return lock_err
        a.delete()
        return JsonResponse({"detail": "Deleted", "id": advice_id}, status=200)
    lock_err = _pond_write_lock_response(cid, a.pond_id, a.target_date)
    if lock_err:
        return lock_err
    body, e = parse_json_body(request)
    if e:
        return e
    if a.status == AquacultureFeedingAdvice.STATUS_CANCELLED:
        return JsonResponse({"detail": "Cancelled advice cannot be edited"}, status=400)
    if a.status != AquacultureFeedingAdvice.STATUS_PENDING_REVIEW:
        extra = set(body.keys()) - {"sack_size_kg"}
        if extra:
            return JsonResponse(
                {"detail": "Only sack_size_kg can be updated once advice is no longer pending review"},
                status=400,
            )
        if "sack_size_kg" not in body:
            return JsonResponse({"detail": "Only pending advice can be edited"}, status=400)
        parsed = _parse_feeding_advice_sack_size_kg(body.get("sack_size_kg"))
        if isinstance(parsed, str):
            return JsonResponse({"detail": parsed}, status=400)
        a.sack_size_kg = parsed
        a.save()
        a = _feeding_advice_for_company(cid, advice_id)
        return JsonResponse(_feeding_advice_to_json(a))
    if "edited_advice_text" in body:
        a.edited_advice_text = str(body.get("edited_advice_text") or "")[:20000]
    if "suggested_feed_kg" in body:
        raw = body.get("suggested_feed_kg")
        if raw in (None, ""):
            a.suggested_feed_kg = None
        else:
            v = _decimal(str(raw))
            if v < 0:
                return JsonResponse({"detail": "suggested_feed_kg cannot be negative"}, status=400)
            a.suggested_feed_kg = v
    if "sack_size_kg" in body:
        parsed = _parse_feeding_advice_sack_size_kg(body.get("sack_size_kg"))
        if isinstance(parsed, str):
            return JsonResponse({"detail": parsed}, status=400)
        a.sack_size_kg = parsed
    a.save()
    a = _feeding_advice_for_company(cid, advice_id)
    return JsonResponse(_feeding_advice_to_json(a))


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
def aquaculture_feeding_advice_approve(request, advice_id: int):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    a = _feeding_advice_for_company(cid, advice_id)
    if not a:
        return JsonResponse({"detail": "Not found"}, status=404)
    if a.status != AquacultureFeedingAdvice.STATUS_PENDING_REVIEW:
        return JsonResponse({"detail": "Only pending advice can be approved"}, status=400)
    lock_err = _pond_write_lock_response(cid, a.pond_id, a.target_date)
    if lock_err:
        return lock_err
    eff = effective_advice_text(a.ai_advice_text or "", a.edited_advice_text or "")
    if not eff.strip():
        return JsonResponse({"detail": "Advice text is empty"}, status=400)
    user = getattr(request, "api_user", None)
    a.status = AquacultureFeedingAdvice.STATUS_APPROVED
    a.approved_advice_text = eff
    a.approved_at = django_timezone.now()
    a.approved_by = user
    a.save()
    a = _feeding_advice_for_company(cid, advice_id)
    return JsonResponse(_feeding_advice_to_json(a))


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
def aquaculture_feeding_advice_cancel(request, advice_id: int):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    a = _feeding_advice_for_company(cid, advice_id)
    if not a:
        return JsonResponse({"detail": "Not found"}, status=404)
    if a.status != AquacultureFeedingAdvice.STATUS_PENDING_REVIEW:
        return JsonResponse({"detail": "Only pending advice can be cancelled"}, status=400)
    lock_err = _pond_write_lock_response(cid, a.pond_id, a.target_date)
    if lock_err:
        return lock_err
    a.status = AquacultureFeedingAdvice.STATUS_CANCELLED
    a.save()
    a = _feeding_advice_for_company(cid, advice_id)
    return JsonResponse(_feeding_advice_to_json(a))


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
def aquaculture_feeding_advice_apply(request, advice_id: int):
    err = _aquaculture_access(request)
    if err:
        return err
    body, e = parse_json_body(request)
    if e:
        return e
    cid = request.company_id

    create_exp = _json_bool(body.get("create_expense"))
    consume_flag = _optional_json_bool(body.get("consume_pond_stock"))

    with transaction.atomic():
        a = (
            AquacultureFeedingAdvice.objects.select_for_update()
            .filter(pk=advice_id, company_id=cid)
            .first()
        )
        if not a:
            return JsonResponse({"detail": "Not found"}, status=404)
        if a.status != AquacultureFeedingAdvice.STATUS_APPROVED:
            return JsonResponse({"detail": "Only approved advice can be applied"}, status=400)
        lock_err = _pond_write_lock_response(cid, a.pond_id, a.target_date)
        if lock_err:
            return lock_err

        raw_kg = body.get("feed_weight_kg")
        if raw_kg in (None, ""):
            applied_kg = a.suggested_feed_kg
        else:
            applied_kg = _decimal(str(raw_kg))
            if applied_kg < 0:
                return JsonResponse({"detail": "feed_weight_kg cannot be negative"}, status=400)
        if applied_kg is None or applied_kg <= 0:
            return JsonResponse({"detail": "Set feed_weight_kg or suggested_feed_kg before applying"}, status=400)

        pond = (
            AquaculturePond.objects.select_related("default_feed_item", "default_medicine_item")
            .filter(pk=a.pond_id, company_id=cid)
            .first()
        )
        if not pond:
            return JsonResponse({"detail": "Pond not found"}, status=404)

        user = getattr(request, "api_user", None)
        expense_obj: AquacultureExpense | None = None

        if create_exp:
            if consume_flag is True:
                return JsonResponse(
                    {
                        "detail": "Do not set consume_pond_stock when create_expense is true; choose one cost recording path.",
                    },
                    status=400,
                )
            cat, cerr = normalize_expense_category_for_company(cid, body.get("expense_category") or "feed_purchase")
            if cerr:
                return JsonResponse({"detail": cerr}, status=400)
            resolved_cat = resolve_aquaculture_expense_to_builtin(cid, cat)
            ed = _parse_date(body.get("expense_date")) or a.target_date
            raw_amt = body.get("amount")
            amt = _money_q(_decimal(raw_amt)) if raw_amt not in (None, "") else Decimal("0")
            item_for_auto_sacks: Item | None = None
            if amt <= 0:
                if resolved_cat != "feed_purchase":
                    return JsonResponse(
                        {"detail": "amount must be greater than zero when create_expense is true"},
                        status=400,
                    )
                sack_sz = int(a.sack_size_kg) if a.sack_size_kg is not None else None
                feed_item_id_auto: int | None = None
                raw_fi_exp = body.get("feed_item_id")
                if raw_fi_exp not in (None, ""):
                    try:
                        feed_item_id_auto = int(raw_fi_exp)
                    except (TypeError, ValueError):
                        return JsonResponse({"detail": "feed_item_id must be an integer"}, status=400)
                elif pond.default_feed_item_id:
                    feed_item_id_auto = pond.default_feed_item_id
                if feed_item_id_auto is None:
                    return JsonResponse(
                        {
                            "detail": "Enter a purchase amount, or choose a feed product / set the pond default feed so the system can value kg from inventory cost.",
                        },
                        status=400,
                    )
                item_auto = Item.objects.filter(pk=feed_item_id_auto, company_id=cid).first()
                if not item_auto:
                    return JsonResponse({"detail": "feed_item_id not found for this company"}, status=400)
                try:
                    qty_auto = feed_inventory_qty_from_kg(item_auto, applied_kg, sack_sz)
                except StockBusinessError as ex:
                    return JsonResponse({"detail": getattr(ex, "detail", str(ex))}, status=400)
                uc = item_inventory_unit_cost(item_auto)
                if uc <= 0:
                    return JsonResponse(
                        {
                            "detail": "Selected feed product has no cost or unit price — enter the purchase amount manually.",
                        },
                        status=400,
                    )
                amt = _money_q((qty_auto * uc).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
                if amt <= 0:
                    return JsonResponse(
                        {"detail": "Computed purchase amount is zero — check kg and item cost."},
                        status=400,
                    )
                item_for_auto_sacks = item_auto
            cycle_obj = None
            if a.production_cycle_id:
                cycle_obj = _cycle_for_company(cid, a.production_cycle_id)
                if cycle_obj and cycle_obj.pond_id != pond.id:
                    cycle_obj = None
            memo_in = str(body.get("memo") or "").strip()
            memo = (memo_in + f"\n[Feeding advice #{a.id}]").strip()[:5000]
            vendor = str(body.get("vendor_name") or "")[:200]
            x = AquacultureExpense(
                company_id=cid,
                pond=pond,
                production_cycle=cycle_obj,
                expense_category=cat,
                expense_date=ed,
                amount=amt,
                memo=memo,
                vendor_name=vendor,
                feed_weight_kg=applied_kg,
            )
            metrics_payload: dict = {"feed_weight_kg": str(applied_kg)}
            raw_sc = body.get("feed_sack_count")
            if raw_sc not in (None, ""):
                metrics_payload["feed_sack_count"] = raw_sc
            elif item_for_auto_sacks is not None:
                it = item_for_auto_sacks
                sack_sz = int(a.sack_size_kg) if a.sack_size_kg is not None else None
                if it.content_weight_kg and it.content_weight_kg > 0:
                    metrics_payload["feed_sack_count"] = str(
                        (applied_kg / Decimal(it.content_weight_kg)).quantize(Decimal("0.0001"))
                    )
                elif sack_sz is not None and sack_sz > 0:
                    metrics_payload["feed_sack_count"] = str(
                        (applied_kg / Decimal(sack_sz)).quantize(Decimal("0.0001"))
                    )
            elif resolved_cat == "feed_purchase" and applied_kg > 0:
                advice_sack = int(a.sack_size_kg) if a.sack_size_kg is not None else None
                if advice_sack is not None and advice_sack > 0:
                    metrics_payload["feed_sack_count"] = str(
                        (applied_kg / Decimal(advice_sack)).quantize(Decimal("0.0001"))
                    )
            fer = _apply_expense_feed_metrics_from_body(
                x,
                metrics_payload,
            )
            if fer:
                return JsonResponse({"detail": fer}, status=400)
            x.save()
            expense_obj = x
        else:
            do_consume = False
            if consume_flag is False:
                do_consume = False
            elif consume_flag is True:
                do_consume = True
            else:
                if body.get("feed_item_id") not in (None, ""):
                    do_consume = True
                elif pond.default_feed_item_id:
                    do_consume = True

            if do_consume:
                feed_item_id: int | None = None
                raw_fi = body.get("feed_item_id")
                if raw_fi not in (None, ""):
                    try:
                        feed_item_id = int(raw_fi)
                    except (TypeError, ValueError):
                        return JsonResponse({"detail": "feed_item_id must be an integer"}, status=400)
                elif pond.default_feed_item_id:
                    feed_item_id = pond.default_feed_item_id
                if feed_item_id is None:
                    return JsonResponse(
                        {
                            "detail": "Set the pond's default feed product, pass feed_item_id, or send consume_pond_stock: false.",
                        },
                        status=400,
                    )
                if not Item.objects.filter(pk=feed_item_id, company_id=cid).exists():
                    return JsonResponse({"detail": "feed_item_id not found for this company"}, status=400)
                try:
                    expense_obj = consume_pond_feed_on_advice_apply(
                        company_id=cid,
                        pond=pond,
                        production_cycle_id=a.production_cycle_id,
                        advice_id=a.id,
                        applied_kg=applied_kg,
                        sack_size_kg=int(a.sack_size_kg) if a.sack_size_kg is not None else None,
                        feed_item_id=feed_item_id,
                        expense_date=a.target_date,
                    )
                except StockBusinessError as ex:
                    return JsonResponse({"detail": getattr(ex, "detail", str(ex))}, status=400)
                except GlPostingError as ex:
                    return JsonResponse({"detail": getattr(ex, "detail", str(ex))}, status=400)

        a.status = AquacultureFeedingAdvice.STATUS_APPLIED
        a.applied_feed_kg = applied_kg
        a.applied_at = django_timezone.now()
        a.applied_by = user
        if expense_obj:
            a.linked_expense = expense_obj
        a.save()

    a = _feeding_advice_for_company(cid, advice_id)
    out = _feeding_advice_to_json(a)
    if expense_obj:
        out["created_expense"] = _expense_to_json(expense_obj)
    return JsonResponse(out)


# --- Landlords (pond lease counterparties, pond shares, payment ledger) ---

_MONEY_DEC = DecimalField(max_digits=18, decimal_places=2)
_ZERO = Value(Decimal("0"))


def _prorated_annual_rent_days(annual: Decimal, period_start: date, period_end: date) -> Decimal:
    """Linear proration: annual rent × (inclusive days / 365)."""
    if annual <= 0 or period_end < period_start:
        return Decimal(0)
    days = (period_end - period_start).days + 1
    if days <= 0:
        return Decimal(0)
    return _money_q(annual * Decimal(days) / Decimal("365"))


def _landlord_share_remaining_contract_payable(
    sh: AquacultureLandlordPondShare, as_of: date
) -> tuple[Decimal, bool]:
    """
    Returns (prorated amount owed for [as_of, contract_end], incomplete_flag).
    incomplete_flag True when annual rent is known but contract end is missing (amount excludes that share).
    """
    p = sh.pond
    if p is None:
        return Decimal(0), False
    price = p.lease_price_per_decimal_per_year
    if price is None or price <= 0:
        return Decimal(0), False
    annual = _money_q(sh.land_area_decimal * price)
    if annual <= 0:
        return Decimal(0), False
    c_start = p.lease_contract_start
    c_end = p.lease_contract_end
    if c_end is not None and as_of > c_end:
        return Decimal(0), False
    if c_end is None:
        return Decimal(0), True
    eff_start = as_of
    if c_start is not None and c_start > eff_start:
        eff_start = c_start
    return _prorated_annual_rent_days(annual, eff_start, c_end), False


def _landlord_remaining_contract_rollup(
    shares: list[AquacultureLandlordPondShare], as_of: date
) -> tuple[Decimal, bool]:
    total = Decimal(0)
    incomplete = False
    for sh in shares:
        amt, inc = _landlord_share_remaining_contract_payable(sh, as_of)
        total = _money_q(total + amt)
        incomplete = incomplete or inc
    return total, incomplete


def _ledger_period_totals_by_landlord_pond(
    landlord_ids: list[int],
    *,
    filter_year: int | None,
    pond_id_scope: int | None,
) -> dict[tuple[int, int | None], tuple[Decimal, Decimal, Decimal]]:
    """Per (landlord_id, pond_id or None): (receivable+, payments+, period net signed)."""
    if not landlord_ids:
        return {}
    qs = AquacultureLandlordLedgerEntry.objects.filter(landlord_id__in=landlord_ids)
    if filter_year is not None:
        qs = qs.filter(entry_date__year=filter_year)
    if pond_id_scope is not None:
        qs = qs.filter(pond_id=pond_id_scope)
    rows = qs.values("landlord_id", "pond_id").annotate(
        ytd_pos=Sum(
            Case(
                When(amount_signed__gt=0, then=F("amount_signed")),
                default=_ZERO,
                output_field=_MONEY_DEC,
            )
        ),
        ytd_neg=Sum(
            Case(
                When(amount_signed__lt=0, then=F("amount_signed")),
                default=_ZERO,
                output_field=_MONEY_DEC,
            )
        ),
    )
    out: dict[tuple[int, int | None], tuple[Decimal, Decimal, Decimal]] = {}
    for r in rows:
        lid = int(r["landlord_id"])
        raw_pid = r["pond_id"]
        pid: int | None = int(raw_pid) if raw_pid is not None else None
        pos = _money_q(r["ytd_pos"] or Decimal(0))
        neg = _money_q(r["ytd_neg"] or Decimal(0))
        paid = _money_q(-neg)
        net = _money_q(pos + neg)
        out[(lid, pid)] = (pos, paid, net)
    return out


def _landlord_balance(landlord_id: int) -> Decimal:
    row = AquacultureLandlordLedgerEntry.objects.filter(landlord_id=landlord_id).aggregate(
        t=Sum("amount_signed")
    )
    t = row.get("t")
    return _money_q(t) if t is not None else Decimal(0)


def _landlord_balance_status(bal: Decimal) -> str:
    if bal > 0:
        return "payable"
    if bal < 0:
        return "credit"
    return "clear"


def _landlord_ledger_rows(landlord_id: int) -> list[dict]:
    entries = list(
        AquacultureLandlordLedgerEntry.objects.filter(landlord_id=landlord_id)
        .select_related("pond", "journal_entry", "bank_account", "station")
        .order_by("entry_date", "id")
    )
    run = Decimal(0)
    out: list[dict] = []
    for e in entries:
        run = _money_q(run + e.amount_signed)
        pond_name = ""
        if e.pond_id and e.pond:
            pond_name = (e.pond.name or "").strip()
        amt = _money_q(e.amount_signed)
        charge_display: str | None = None
        payment_display: str | None = None
        if e.kind == AquacultureLandlordLedgerEntry.KIND_RENT_CHARGE:
            charge_display = str(amt)
        elif e.kind == AquacultureLandlordLedgerEntry.KIND_PAYMENT:
            payment_display = str(_money_q(abs(amt)))
        else:
            if amt > 0:
                charge_display = str(amt)
            elif amt < 0:
                payment_display = str(_money_q(abs(amt)))
        out.append(
            {
                "id": e.id,
                "entry_date": e.entry_date.isoformat(),
                "kind": e.kind,
                "amount_signed": str(amt),
                "running_balance": str(run),
                "memo": e.memo or "",
                "reference": e.reference or "",
                "pond_id": e.pond_id,
                "pond_name": pond_name,
                "applies_to_lease_paid": e.applies_to_lease_paid,
                "lease_paid_delta": (
                    str(_money_q(e.lease_paid_delta)) if e.lease_paid_delta is not None else None
                ),
                "charge_display": charge_display,
                "payment_display": payment_display,
                "bank_account_id": e.bank_account_id,
                "station_id": e.station_id,
                "payment_method": (e.payment_method or "cash").strip(),
                "journal_entry_id": e.journal_entry_id,
                "journal_entry_number": (
                    (e.journal_entry.entry_number or "").strip()
                    if e.journal_entry_id and e.journal_entry
                    else ""
                ),
            }
        )
    return out


def _landlord_json_list_row(
    l: AquacultureLandlord,
    *,
    pond_id: int | None,
    pond_name: str,
    metrics_year: int | None,
    metrics_as_of: date,
    land_share_decimal: Decimal,
    implied_annual_lease: Decimal,
    ytd_receivable: Decimal,
    ytd_paid: Decimal,
    ytd_balance: Decimal,
    remaining_contract_payable: Decimal,
    remaining_contract_excludes_open_ended: bool,
) -> dict:
    bal = _landlord_balance(l.id)
    return {
        "id": l.id,
        "name": (l.name or "").strip(),
        "code": (l.code or "").strip(),
        "phone": (l.phone or "").strip(),
        "is_active": l.is_active,
        "pond_share_count": getattr(l, "pond_share_count", l.pond_shares.count()),
        "pond_id": pond_id,
        "pond_name": (pond_name or "").strip(),
        "balance_signed": str(bal),
        "balance_status": _landlord_balance_status(bal),
        "metrics_year": metrics_year,
        "metrics_as_of": metrics_as_of.isoformat(),
        "land_share_decimal": str(land_share_decimal),
        "implied_annual_lease": str(implied_annual_lease),
        "ytd_receivable": str(ytd_receivable),
        "ytd_paid": str(ytd_paid),
        "ytd_balance": str(ytd_balance),
        "remaining_contract_payable": str(remaining_contract_payable),
        "remaining_contract_excludes_open_ended": remaining_contract_excludes_open_ended,
    }


def _landlord_json_detail(l: AquacultureLandlord) -> dict:
    bal = _landlord_balance(l.id)
    shares = []
    for sh in l.pond_shares.select_related("pond").order_by("pond__sort_order", "pond__name", "id"):
        pn = ""
        implied_annual: str | None = None
        price_per_dec: str | None = None
        if sh.pond_id and sh.pond:
            pn = (sh.pond.name or "").strip()
            p = sh.pond
            if p.lease_price_per_decimal_per_year is not None:
                price_per_dec = str(_money_q(p.lease_price_per_decimal_per_year))
                implied = _money_q(sh.land_area_decimal * p.lease_price_per_decimal_per_year)
                implied_annual = str(implied)
        shares.append(
            {
                "id": sh.id,
                "pond_id": sh.pond_id,
                "pond_name": pn,
                "land_area_decimal": str(sh.land_area_decimal),
                "notes": (sh.notes or "").strip(),
                "lease_price_per_decimal_per_year": price_per_dec,
                "implied_annual_lease": implied_annual,
            }
        )
    return {
        "id": l.id,
        "name": (l.name or "").strip(),
        "code": (l.code or "").strip(),
        "phone": (l.phone or "").strip(),
        "email": (l.email or "").strip(),
        "notes": (l.notes or "").strip(),
        "is_active": l.is_active,
        "balance_signed": str(bal),
        "balance_status": _landlord_balance_status(bal),
        "pond_shares": shares,
        "ledger": _landlord_ledger_rows(l.id),
        "created_at": l.created_at.isoformat() if l.created_at else "",
        "updated_at": l.updated_at.isoformat() if l.updated_at else "",
    }


def _landlord_for_company(company_id: int, landlord_id: int) -> AquacultureLandlord | None:
    return AquacultureLandlord.objects.filter(pk=landlord_id, company_id=company_id).first()


def _parse_landlord_ledger_payment_gl_fields(
    body: dict, cid: int
) -> tuple[int | None, int | None, str, JsonResponse | None]:
    """Optional bank_account_id, station_id, payment_method (for payment ledger rows that post G/L)."""
    bank_account_id: int | None = None
    raw_b = body.get("bank_account_id")
    if raw_b not in (None, ""):
        try:
            bank_account_id = int(raw_b)
        except (TypeError, ValueError):
            return (
                None,
                None,
                "cash",
                JsonResponse({"detail": "bank_account_id must be an integer"}, status=400),
            )
        if not BankAccount.objects.filter(
            pk=bank_account_id, company_id=cid, is_active=True
        ).exists():
            return None, None, "cash", JsonResponse({"detail": "Bank account not found"}, status=404)

    station_id: int | None = None
    raw_s = body.get("station_id")
    if raw_s not in (None, ""):
        try:
            station_id = int(raw_s)
        except (TypeError, ValueError):
            return (
                None,
                None,
                "cash",
                JsonResponse({"detail": "station_id must be an integer"}, status=400),
            )
        if not Station.objects.filter(pk=station_id, company_id=cid, is_active=True).exists():
            return None, None, "cash", JsonResponse({"detail": "Station not found"}, status=404)

    pm = (body.get("payment_method") or "cash").strip().lower() or "cash"
    return bank_account_id, station_id, pm, None


def _normalize_landlord_ledger_kind(raw) -> tuple[str | None, str | None]:
    s = (str(raw or "")).strip().lower()
    if s in ("rent_charge", "charge", "rent"):
        return AquacultureLandlordLedgerEntry.KIND_RENT_CHARGE, None
    if s in ("payment", "pay"):
        return AquacultureLandlordLedgerEntry.KIND_PAYMENT, None
    if s in ("adjustment", "adj"):
        return AquacultureLandlordLedgerEntry.KIND_ADJUSTMENT, None
    return None, "kind must be rent_charge, payment, or adjustment"


def _reverse_landlord_lease_paid_effect(cid: int, ent: AquacultureLandlordLedgerEntry) -> None:
    if ent.applies_to_lease_paid and ent.pond_id and ent.lease_paid_delta is not None:
        dec = _money_q(ent.lease_paid_delta)
        AquaculturePond.objects.filter(pk=ent.pond_id, company_id=cid).update(
            lease_paid_to_landlord=Greatest(
                F("lease_paid_to_landlord") - dec,
                Value(Decimal("0")),
            )
        )


def _landlord_ledger_signed_and_lease_effect(
    ll: AquacultureLandlord,
    cid: int,
    kind: str,
    amt_raw,
    pond_id: int | None,
    applies: bool,
) -> tuple[Decimal | None, bool, Decimal | None, JsonResponse | None]:
    """
    Compute amount_signed, applies_to_lease_paid flag, and lease_paid_delta for one ledger line.
    Returns (None, _, _, err) if validation fails.
    """
    signed: Decimal | None = None
    lease_paid_delta: Decimal | None = None
    applies_flag = False

    if kind == AquacultureLandlordLedgerEntry.KIND_RENT_CHARGE:
        mag = _money_q(_decimal(amt_raw))
        if mag <= 0:
            return None, False, None, JsonResponse(
                {"detail": "amount must be greater than zero for rent_charge"}, status=400
            )
        signed = mag
    elif kind == AquacultureLandlordLedgerEntry.KIND_PAYMENT:
        mag = _money_q(_decimal(amt_raw))
        if mag <= 0:
            return None, False, None, JsonResponse(
                {"detail": "amount must be greater than zero for payment"}, status=400
            )
        signed = -mag
        if applies and pond_id is not None:
            if not AquacultureLandlordPondShare.objects.filter(landlord_id=ll.id, pond_id=pond_id).exists():
                return None, False, None, JsonResponse(
                    {
                        "detail": "Record a pond share for this landlord on the selected pond before "
                        "applying a payment to lease_paid_to_landlord.",
                    },
                    status=400,
                )
            applies_flag = True
            lease_paid_delta = mag
    else:
        signed = _money_q(_decimal(amt_raw))
        if signed == 0:
            return None, False, None, JsonResponse({"detail": "adjustment amount cannot be zero"}, status=400)

    return signed, applies_flag, lease_paid_delta, None


def _replace_pond_shares_from_body(
    landlord: AquacultureLandlord, company_id: int, body: dict
) -> str | None:
    if "pond_shares" not in body:
        return None
    raw = body.get("pond_shares")
    if raw is None:
        landlord.pond_shares.all().delete()
        return None
    if not isinstance(raw, list):
        return "pond_shares must be a list"
    seen_ponds: set[int] = set()
    rows: list[AquacultureLandlordPondShare] = []
    for item in raw:
        if not isinstance(item, dict):
            return "each pond_shares item must be an object"
        pid = item.get("pond_id")
        try:
            pond_id = int(pid)
        except (TypeError, ValueError):
            return "pond_id must be an integer"
        if pond_id in seen_ponds:
            return "duplicate pond_id in pond_shares"
        seen_ponds.add(pond_id)
        if not AquaculturePond.objects.filter(pk=pond_id, company_id=company_id).exists():
            return f"Pond {pond_id} not found for this company"
        area = _decimal(item.get("land_area_decimal"))
        if area <= 0:
            return "land_area_decimal must be greater than zero"
        note = str(item.get("notes") or "")[:500]
        rows.append(
            AquacultureLandlordPondShare(
                landlord=landlord,
                pond_id=pond_id,
                land_area_decimal=area,
                notes=note,
            )
        )
    landlord.pond_shares.all().delete()
    AquacultureLandlordPondShare.objects.bulk_create(rows)
    return None


@csrf_exempt
@require_http_methods(["GET", "POST"])
@auth_required
@require_company_id
def aquaculture_landlords_list_or_create(request):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    if request.method == "GET":
        today = django_timezone.localdate()
        metrics_as_of = _parse_date(request.GET.get("as_of")) or today

        raw_year = request.GET.get("year")
        filter_year: int | None = None
        metrics_year_val: int | None = None
        if raw_year not in (None, "", "all"):
            try:
                filter_year = int(raw_year)
                metrics_year_val = filter_year
            except (TypeError, ValueError):
                return JsonResponse({"detail": "year must be an integer or 'all'"}, status=400)

        pond_id_scope: int | None = None
        raw_pond = request.GET.get("pond_id")
        if raw_pond not in (None, ""):
            try:
                pond_id_scope = int(raw_pond)
            except (TypeError, ValueError):
                return JsonResponse({"detail": "pond_id must be an integer"}, status=400)
            if not AquaculturePond.objects.filter(pk=pond_id_scope, company_id=cid).exists():
                return JsonResponse({"detail": "Pond not found"}, status=404)

        shares_qs = AquacultureLandlordPondShare.objects.filter(landlord__company_id=cid).select_related(
            "landlord", "pond"
        )
        if pond_id_scope is not None:
            shares_qs = shares_qs.filter(pond_id=pond_id_scope)
        shares = list(
            shares_qs.order_by("pond__sort_order", "pond__name", "pond_id", "landlord__name", "id")
        )
        share_lids = sorted({sh.landlord_id for sh in shares})
        count_map: dict[int, int] = {
            row.id: row.pond_share_count
            for row in AquacultureLandlord.objects.filter(company_id=cid, id__in=share_lids).annotate(
                pond_share_count=Count("pond_shares", distinct=True)
            )
        }
        ledger_map = _ledger_period_totals_by_landlord_pond(
            share_lids, filter_year=filter_year, pond_id_scope=pond_id_scope
        )

        out_list: list[dict] = []
        for sh in shares:
            ll = sh.landlord
            setattr(ll, "pond_share_count", count_map.get(ll.id, 0))
            rec, paid, _n = ledger_map.get((ll.id, sh.pond_id), (Decimal(0), Decimal(0), Decimal(0)))
            ytd_balance = _money_q(rec - paid)
            land_share = sh.land_area_decimal.quantize(Decimal("0.0001"))
            pond = sh.pond
            implied_ann = Decimal(0)
            if pond and pond.lease_price_per_decimal_per_year is not None:
                pr = _money_q(pond.lease_price_per_decimal_per_year)
                if pr > 0:
                    implied_ann = _money_q(land_share * pr)
            rem, rem_inc = _landlord_share_remaining_contract_payable(sh, metrics_as_of)
            pnm = (pond.name or "").strip() if pond else ""
            out_list.append(
                _landlord_json_list_row(
                    ll,
                    pond_id=sh.pond_id,
                    pond_name=pnm,
                    metrics_year=metrics_year_val,
                    metrics_as_of=metrics_as_of,
                    land_share_decimal=land_share,
                    implied_annual_lease=implied_ann,
                    ytd_receivable=rec,
                    ytd_paid=paid,
                    ytd_balance=ytd_balance,
                    remaining_contract_payable=rem,
                    remaining_contract_excludes_open_ended=rem_inc,
                )
            )

        if pond_id_scope is None and share_lids:
            for lid in share_lids:
                tup = ledger_map.get((lid, None))
                if tup is None:
                    continue
                rec, paid, _n = tup
                if rec == 0 and paid == 0:
                    continue
                ll = next((sh.landlord for sh in shares if sh.landlord_id == lid), None)
                if ll is None:
                    continue
                setattr(ll, "pond_share_count", count_map.get(ll.id, 0))
                ytd_balance = _money_q(rec - paid)
                out_list.append(
                    _landlord_json_list_row(
                        ll,
                        pond_id=None,
                        pond_name="",
                        metrics_year=metrics_year_val,
                        metrics_as_of=metrics_as_of,
                        land_share_decimal=Decimal(0),
                        implied_annual_lease=Decimal(0),
                        ytd_receivable=rec,
                        ytd_paid=paid,
                        ytd_balance=ytd_balance,
                        remaining_contract_payable=Decimal(0),
                        remaining_contract_excludes_open_ended=False,
                    )
                )

        return JsonResponse(out_list, safe=False)

    body, e = parse_json_body(request)
    if e:
        return e
    name = (body.get("name") or "").strip()
    if not name:
        return JsonResponse({"detail": "name is required"}, status=400)
    code_in = (body.get("code") or "").strip()[:64]
    ll = AquacultureLandlord(
        company_id=cid,
        name=name[:200],
        code=code_in,
        phone=(body.get("phone") or "").strip()[:64],
        email=(body.get("email") or "").strip()[:254],
        notes=str(body.get("notes") or "")[:5000],
        is_active=bool(body.get("is_active", True)),
    )
    ll.save()
    if not (ll.code or "").strip():
        auto_code = f"LL-{ll.id:04d}"
        AquacultureLandlord.objects.filter(pk=ll.pk).update(code=auto_code)
        ll.code = auto_code
    perr = _replace_pond_shares_from_body(ll, cid, body)
    if perr:
        ll.delete()
        return JsonResponse({"detail": perr}, status=400)
    ll = AquacultureLandlord.objects.filter(pk=ll.pk).first()
    return JsonResponse(_landlord_json_detail(ll), status=201)


@csrf_exempt
@require_http_methods(["GET", "PATCH", "DELETE"])
@auth_required
@require_company_id
def aquaculture_landlord_detail(request, landlord_id: int):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    ll = _landlord_for_company(cid, landlord_id)
    if not ll:
        return JsonResponse({"detail": "Landlord not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(_landlord_json_detail(ll))
    if request.method == "DELETE":
        ll.delete()
        return JsonResponse({"detail": "Deleted"}, status=200)

    body, e = parse_json_body(request)
    if e:
        return e
    if "name" in body:
        n = (body.get("name") or "").strip()
        if n:
            ll.name = n[:200]
    if "code" in body:
        ll.code = (body.get("code") or "").strip()[:64]
    if "phone" in body:
        ll.phone = (body.get("phone") or "").strip()[:64]
    if "email" in body:
        ll.email = (body.get("email") or "").strip()[:254]
    if "notes" in body:
        ll.notes = str(body.get("notes") or "")[:5000]
    if "is_active" in body:
        ll.is_active = bool(body.get("is_active"))
    perr = _replace_pond_shares_from_body(ll, cid, body)
    if perr:
        return JsonResponse({"detail": perr}, status=400)
    ll.save()
    ll = _landlord_for_company(cid, landlord_id)
    return JsonResponse(_landlord_json_detail(ll))


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
def aquaculture_landlord_ledger_create(request, landlord_id: int):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    ll = _landlord_for_company(cid, landlord_id)
    if not ll:
        return JsonResponse({"detail": "Landlord not found"}, status=404)
    body, e = parse_json_body(request)
    if e:
        return e
    kind, kerr = _normalize_landlord_ledger_kind(body.get("kind"))
    if kerr:
        return JsonResponse({"detail": kerr}, status=400)
    ed = _parse_date(body.get("entry_date")) or django_timezone.localdate()
    memo = str(body.get("memo") or "")[:500]
    reference = str(body.get("reference") or "")[:200]

    bank_account_id: int | None = None
    station_id_gl: int | None = None
    payment_method_gl = "cash"
    if kind == AquacultureLandlordLedgerEntry.KIND_PAYMENT:
        bank_account_id, station_id_gl, payment_method_gl, gl_err = _parse_landlord_ledger_payment_gl_fields(
            body, cid
        )
        if gl_err:
            return gl_err

    allocations = body.get("allocations")
    if allocations is not None:
        if kind != AquacultureLandlordLedgerEntry.KIND_PAYMENT:
            return JsonResponse(
                {"detail": "allocations are only valid when kind is payment"}, status=400
            )
        if not isinstance(allocations, list) or len(allocations) == 0:
            return JsonResponse(
                {"detail": "allocations must be a non-empty list of {pond_id, amount} lines"}, status=400
            )
        lines: list[tuple[int | None, Decimal, bool, Decimal | None]] = []
        for item in allocations:
            if not isinstance(item, dict):
                return JsonResponse({"detail": "each allocations item must be an object"}, status=400)
            raw_pond = item.get("pond_id")
            pond_id_alloc: int | None = None
            if raw_pond not in (None, ""):
                try:
                    pond_id_alloc = int(raw_pond)
                except (TypeError, ValueError):
                    return JsonResponse({"detail": "pond_id must be an integer"}, status=400)
                if not AquaculturePond.objects.filter(pk=pond_id_alloc, company_id=cid).exists():
                    return JsonResponse({"detail": "Pond not found"}, status=404)
            applies = bool(item.get("applies_to_lease_paid", True))
            if applies and pond_id_alloc is None:
                return JsonResponse(
                    {
                        "detail": "When applies_to_lease_paid is true, each allocation needs a pond_id.",
                    },
                    status=400,
                )
            amt_raw_line = item.get("amount")
            signed, applies_flag, lease_paid_delta, line_err = _landlord_ledger_signed_and_lease_effect(
                ll, cid, kind, amt_raw_line, pond_id_alloc, applies
            )
            if line_err:
                return line_err
            assert signed is not None
            lines.append((pond_id_alloc, signed, applies_flag, lease_paid_delta))
        pond_ids_alloc = [p for p, _, _, _ in lines if p is not None]
        lock_err = _ponds_write_lock_response(cid, pond_ids_alloc, ed)
        if lock_err:
            return lock_err
        try:
            with transaction.atomic():
                for pond_id_alloc, signed, applies_flag, lease_paid_delta in lines:
                    ent = AquacultureLandlordLedgerEntry.objects.create(
                        landlord_id=ll.id,
                        pond_id=pond_id_alloc,
                        entry_date=ed,
                        kind=kind,
                        amount_signed=signed,
                        memo=memo,
                        reference=reference,
                        applies_to_lease_paid=applies_flag,
                        lease_paid_delta=lease_paid_delta,
                        bank_account_id=bank_account_id,
                        station_id=station_id_gl,
                        payment_method=payment_method_gl,
                    )
                    if applies_flag and pond_id_alloc is not None and lease_paid_delta is not None:
                        AquaculturePond.objects.filter(pk=pond_id_alloc, company_id=cid).update(
                            lease_paid_to_landlord=F("lease_paid_to_landlord") + lease_paid_delta
                        )
                    _, gerr = sync_landlord_lease_payment_journal(cid, ent)
                    if gerr:
                        raise ValueError(gerr)
        except ValueError as verr:
            return JsonResponse({"detail": str(verr)}, status=400)
        except Exception as ex:
            return JsonResponse({"detail": str(ex)}, status=400)
        ll = _landlord_for_company(cid, landlord_id)
        return JsonResponse(_landlord_json_detail(ll), status=201)

    amt_raw = body.get("amount")
    if amt_raw in (None, ""):
        return JsonResponse({"detail": "amount is required (or use allocations for multi-pond payments)"}, status=400)

    pond_id: int | None = None
    raw_pond = body.get("pond_id")
    if raw_pond not in (None, ""):
        try:
            pond_id = int(raw_pond)
        except (TypeError, ValueError):
            return JsonResponse({"detail": "pond_id must be an integer"}, status=400)
        if not AquaculturePond.objects.filter(pk=pond_id, company_id=cid).exists():
            return JsonResponse({"detail": "Pond not found"}, status=404)

    applies = bool(body.get("applies_to_lease_paid", True))

    signed, applies_flag, lease_paid_delta, line_err = _landlord_ledger_signed_and_lease_effect(
        ll, cid, kind, amt_raw, pond_id, applies
    )
    if line_err:
        return line_err
    assert signed is not None
    if pond_id is not None:
        lock_err = _pond_write_lock_response(cid, pond_id, ed)
        if lock_err:
            return lock_err

    try:
        with transaction.atomic():
            ent = AquacultureLandlordLedgerEntry.objects.create(
                landlord_id=ll.id,
                pond_id=pond_id,
                entry_date=ed,
                kind=kind,
                amount_signed=signed,
                memo=memo,
                reference=reference,
                applies_to_lease_paid=applies_flag,
                lease_paid_delta=lease_paid_delta,
                bank_account_id=bank_account_id if kind == AquacultureLandlordLedgerEntry.KIND_PAYMENT else None,
                station_id=station_id_gl if kind == AquacultureLandlordLedgerEntry.KIND_PAYMENT else None,
                payment_method=payment_method_gl if kind == AquacultureLandlordLedgerEntry.KIND_PAYMENT else "cash",
            )
            if applies_flag and pond_id is not None and lease_paid_delta is not None:
                AquaculturePond.objects.filter(pk=pond_id, company_id=cid).update(
                    lease_paid_to_landlord=F("lease_paid_to_landlord") + lease_paid_delta
                )
            _, gerr = sync_landlord_lease_payment_journal(cid, ent)
            if gerr:
                raise ValueError(gerr)
    except ValueError as verr:
        return JsonResponse({"detail": str(verr)}, status=400)
    except Exception as ex:
        return JsonResponse({"detail": str(ex)}, status=400)

    ll = _landlord_for_company(cid, landlord_id)
    return JsonResponse(_landlord_json_detail(ll), status=201)


@csrf_exempt
@require_http_methods(["DELETE", "PATCH"])
@auth_required
@require_company_id
def aquaculture_landlord_ledger_entry_detail(request, landlord_id: int, entry_id: int):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    if not _landlord_for_company(cid, landlord_id):
        return JsonResponse({"detail": "Landlord not found"}, status=404)
    ent = (
        AquacultureLandlordLedgerEntry.objects.filter(
            pk=entry_id,
            landlord_id=landlord_id,
            landlord__company_id=cid,
        )
        .select_related("landlord", "pond")
        .first()
    )
    if not ent:
        return JsonResponse({"detail": "Ledger entry not found"}, status=404)

    if request.method == "DELETE":
        try:
            with transaction.atomic():
                _reverse_landlord_lease_paid_effect(cid, ent)
                delete_landlord_lease_payment_journal(cid, ent.id)
                ent.delete()
        except Exception as ex:
            return JsonResponse({"detail": str(ex)}, status=400)
        ll = _landlord_for_company(cid, landlord_id)
        return JsonResponse(_landlord_json_detail(ll), status=200)

    body, e = parse_json_body(request)
    if e:
        return e
    ll = ent.landlord
    kind, kerr = _normalize_landlord_ledger_kind(body.get("kind", ent.kind))
    if kerr:
        return JsonResponse({"detail": kerr}, status=400)
    ed = _parse_date(body.get("entry_date")) if "entry_date" in body else ent.entry_date
    if ed is None:
        ed = ent.entry_date
    amt_raw = body.get("amount")
    if amt_raw in (None, ""):
        mag = abs(_money_q(ent.amount_signed))
        amt_raw = str(mag) if ent.kind != AquacultureLandlordLedgerEntry.KIND_ADJUSTMENT else str(
            _money_q(ent.amount_signed)
        )
    memo = str(body.get("memo", ent.memo) or "")[:500]
    reference = str(body.get("reference", ent.reference) or "")[:200]

    bank_account_id = ent.bank_account_id
    station_id_gl = ent.station_id
    payment_method_gl = (ent.payment_method or "cash").strip().lower() or "cash"
    if kind != AquacultureLandlordLedgerEntry.KIND_PAYMENT:
        bank_account_id = None
        station_id_gl = None
        payment_method_gl = "cash"
    else:
        if "bank_account_id" in body:
            rb = body.get("bank_account_id")
            if rb in (None, ""):
                bank_account_id = None
            else:
                try:
                    bank_account_id = int(rb)
                except (TypeError, ValueError):
                    return JsonResponse({"detail": "bank_account_id must be an integer"}, status=400)
                if not BankAccount.objects.filter(
                    pk=bank_account_id, company_id=cid, is_active=True
                ).exists():
                    return JsonResponse({"detail": "Bank account not found"}, status=404)
        if "station_id" in body:
            rs = body.get("station_id")
            if rs in (None, ""):
                station_id_gl = None
            else:
                try:
                    station_id_gl = int(rs)
                except (TypeError, ValueError):
                    return JsonResponse({"detail": "station_id must be an integer"}, status=400)
                if not Station.objects.filter(pk=station_id_gl, company_id=cid, is_active=True).exists():
                    return JsonResponse({"detail": "Station not found"}, status=404)
        if "payment_method" in body:
            payment_method_gl = (body.get("payment_method") or "cash").strip().lower() or "cash"

    pond_id: int | None = ent.pond_id
    if "pond_id" in body:
        raw_pond = body.get("pond_id")
        if raw_pond in (None, ""):
            pond_id = None
        else:
            try:
                pond_id = int(raw_pond)
            except (TypeError, ValueError):
                return JsonResponse({"detail": "pond_id must be an integer"}, status=400)
            if not AquaculturePond.objects.filter(pk=pond_id, company_id=cid).exists():
                return JsonResponse({"detail": "Pond not found"}, status=404)

    applies = bool(body.get("applies_to_lease_paid", ent.applies_to_lease_paid))

    signed, applies_flag, lease_paid_delta, line_err = _landlord_ledger_signed_and_lease_effect(
        ll, cid, kind, amt_raw, pond_id, applies
    )
    if line_err:
        return line_err
    assert signed is not None

    try:
        with transaction.atomic():
            _reverse_landlord_lease_paid_effect(cid, ent)
            ent.entry_date = ed
            ent.kind = kind
            ent.amount_signed = signed
            ent.memo = memo
            ent.reference = reference
            ent.pond_id = pond_id
            ent.applies_to_lease_paid = applies_flag
            ent.lease_paid_delta = lease_paid_delta
            ent.bank_account_id = bank_account_id
            ent.station_id = station_id_gl
            ent.payment_method = payment_method_gl
            ent.save(
                update_fields=[
                    "entry_date",
                    "kind",
                    "amount_signed",
                    "memo",
                    "reference",
                    "pond_id",
                    "applies_to_lease_paid",
                    "lease_paid_delta",
                    "bank_account_id",
                    "station_id",
                    "payment_method",
                ]
            )
            if applies_flag and pond_id is not None and lease_paid_delta is not None:
                AquaculturePond.objects.filter(pk=pond_id, company_id=cid).update(
                    lease_paid_to_landlord=F("lease_paid_to_landlord") + lease_paid_delta
                )
            _, gerr = sync_landlord_lease_payment_journal(cid, ent)
            if gerr:
                raise ValueError(gerr)
    except ValueError as verr:
        return JsonResponse({"detail": str(verr)}, status=400)
    except Exception as ex:
        return JsonResponse({"detail": str(ex)}, status=400)

    ll_out = _landlord_for_company(cid, landlord_id)
    return JsonResponse(_landlord_json_detail(ll_out), status=200)
