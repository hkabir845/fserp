"""Items (products) API: list, create, get, update, delete (company-scoped)."""
import json
import os
import re
import uuid
from datetime import datetime
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone
from django.db.models import Count, DecimalField, Exists, F, OuterRef, Q, Sum, Value
from django.db.models.functions import Coalesce
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET

from api.utils.auth import auth_required
from api.utils.pagination import json_paged, parse_skip_limit, wants_paged_response
from api.views.common import parse_json_body, require_company_id, _serialize_decimal
from api.models import AquaculturePond, Item, Station, Tank
from api.services.reference_code import assign_string_code_if_empty, user_supplied_code_or_auto
from api.services.item_catalog import item_tracks_physical_stock, normalize_item_type
from api.services.item_opening_stock_gl import (
    item_opening_fields_for_api,
    post_item_opening_stock_gl,
)
from api.services.coa_gl_defaults import (
    ALLOWED_BILL_EXPENSE_DEBIT,
    ALLOWED_COGS,
    ALLOWED_INCOME,
    ALLOWED_INVENTORY_ASSET,
    parse_optional_chart_account_id,
)
from api.services.item_name_uniqueness import (
    find_item_name_conflict,
    item_name_conflict_detail,
    normalize_item_name_for_storage,
)
from api.services.station_stock import (
    ensure_item_station_row_for_new_shop_item,
    get_or_create_default_station,
    item_uses_station_bins,
    move_shop_stock_to_station,
    per_pond_quantities,
    per_station_quantities,
    resolve_active_station_id,
    set_pond_stock,
    set_station_stock,
)


def _body_flag(body: dict, key: str) -> bool:
    v = body.get(key)
    return v in (True, "true", "1", 1, "yes")
from api.services.item_reporting_categories import (
    SUGGESTED_ITEM_REPORTING_CATEGORIES,
    normalize_item_reporting_category,
)


def _parse_decimal(val, default="0"):
    """Parse JSON number/string into Decimal; None -> default. Invalid -> None (caller returns 400)."""
    if val is None:
        return Decimal(default)
    try:
        s = str(val).strip().replace(",", "").replace(" ", "")
        if not s:
            return Decimal(default)
        return Decimal(s)
    except (InvalidOperation, ValueError):
        return None


# Sack/bag feed labels are almost always under this; larger values are usually BDT typed by mistake.
_MAX_CONTENT_WEIGHT_KG = Decimal("2000")


def _parse_optional_content_weight_kg(val):
    """
    Optional positive kg per selling unit (e.g. sack). None or blank string -> None.
    Returns (Decimal | None, error_detail | None).
    """
    if val is None:
        return None, None
    if isinstance(val, str) and not val.strip():
        return None, None
    d = _parse_decimal(val, "0")
    if d is None:
        return None, "Invalid content_weight_kg"
    if d <= 0:
        return None, "content_weight_kg must be greater than zero when provided"
    if d > _MAX_CONTENT_WEIGHT_KG:
        return (
            None,
            "Kg per sack is unrealistically large. This field must be the weight on the label (e.g. 25), "
            "not the selling price in BDT.",
        )
    return d, None


_MAX_PIECES_PER_KG = Decimal("1000000")


def _parse_optional_pieces_per_kg(val):
    """Optional positive pcs/kg for fish SKUs. None or blank -> None."""
    if val is None:
        return None, None
    if isinstance(val, str) and not val.strip():
        return None, None
    d = _parse_decimal(val, "0")
    if d is None:
        return None, "Invalid pieces_per_kg"
    if d <= 0:
        return None, "pieces_per_kg must be greater than zero when provided"
    if d > _MAX_PIECES_PER_KG:
        return None, "pieces_per_kg is unrealistically large"
    return d, None


def _truncate(val, max_len):
    if val is None:
        return ""
    return (str(val) or "")[:max_len]


def _apply_item_gl_accounts_from_body(company_id: int, body: dict, target: Item) -> JsonResponse | None:
    """
    When JSON keys are present, set optional revenue / COGS / inventory / expense chart FKs on target.
    Returns JsonResponse on validation error, else None.
    """
    pairs = (
        ("revenue_account_id", ALLOWED_INCOME),
        ("cogs_account_id", ALLOWED_COGS),
        ("inventory_account_id", ALLOWED_INVENTORY_ASSET),
        ("expense_account_id", ALLOWED_BILL_EXPENSE_DEBIT),
    )
    for key, allowed in pairs:
        if key not in body:
            continue
        rid, err = parse_optional_chart_account_id(
            company_id,
            body.get(key),
            allowed_normalized_types=allowed,
            field_label=key,
        )
        if err:
            return JsonResponse({"detail": err}, status=400)
        setattr(target, key, rid)
    return None


def _item_name_conflict_response(conflict: Item) -> JsonResponse:
    return JsonResponse(
        {
            "detail": item_name_conflict_detail(conflict),
            "conflicting_item_id": conflict.id,
            "conflicting_item_name": conflict.name,
        },
        status=409,
    )


# Liquid / gaseous / petroleum fuels: used to match legacy rows when name or category
# was not tagged with POS category "fuel". Multi-word phrases first (longer matches).
_FUEL_ASSIGNMENT_HINT_TERMS = (
    "natural gas",
    "petroleum gas",
    "liquefied petroleum",
    "marine gas",
    "heating oil",
    "furnace oil",
    "diesel",
    "petrol",
    "gasoline",
    "fuel",
    "octane",
    "kerosene",
    "premium",
    "super",
    "unleaded",
    "mogas",
    "avgas",
    "lpg",
    "cng",
    "lng",
    "biodiesel",
    "adblue",
    "e10",
    "e85",
    "gasoil",
    "hsd",
    "petroleum",
    "propane",
    "butane",
    "liquefied",
    "ngv",
    "autogas",
    "biogas",
    "methanol",
    "ethanol",
    "hydrogen",
    "distillate",
    "naphtha",
    "bunker",
    "bitumen",
)


def _icontains_any_field(field: str, terms: tuple) -> Q:
    q = Q()
    for t in terms:
        q |= Q(**{f"{field}__icontains": t})
    return q


def _fuel_pos_category_q():
    """POS category explicitly marked as fuel (or namespaced e.g. fuel_lpg)."""
    return (
        Q(pos_category__iexact="fuel")
        | Q(pos_category__istartswith="fuel_")
        | Q(pos_category__istartswith="fuel-")
    )


def _legacy_fuel_name_or_category_q():
    """Legacy: product name or category text suggests a tank-stored fuel."""
    return _icontains_any_field("name", _FUEL_ASSIGNMENT_HINT_TERMS) | _icontains_any_field(
        "category", _FUEL_ASSIGNMENT_HINT_TERMS
    )


def _items_queryset_for_tank_assignment(base_qs):
    """
    Products that may be assigned to a fuel tank: active inventory items with fuel POS
    category, or name/category hints (liquid fuels, petroleum gas, LPG/CNG/LNG, etc.).
    """
    return base_qs.filter(
        is_active=True,
        item_type__iexact="inventory",
    ).filter(_fuel_pos_category_q() | _legacy_fuel_name_or_category_q())


def _items_queryset_with_tank_annotations(base_qs):
    """Fuel products use Tank.current_stock; sum active tanks for display quantity."""
    return base_qs.annotate(
        _fuel_tank_stock=Coalesce(
            Sum(
                "tanks__current_stock",
                filter=Q(tanks__is_active=True)
                & Q(tanks__company_id=F("company_id")),
            ),
            Value(Decimal("0")),
            output_field=DecimalField(max_digits=14, decimal_places=4),
        ),
        _has_active_tank=Exists(
            Tank.objects.filter(
                product_id=OuterRef("pk"),
                company_id=OuterRef("company_id"),
                is_active=True,
            )
        ),
    )


def _effective_quantity_on_hand(i: Item) -> Decimal:
    if getattr(i, "_has_active_tank", False):
        return getattr(i, "_fuel_tank_stock", i.quantity_on_hand)
    return i.quantity_on_hand


def _coerce_item_type_for_storage(raw) -> str:
    """Normalize API input (e.g. non-inventory → non_inventory) and cap length."""
    s = _truncate(raw or "inventory", 32) or "inventory"
    nt = normalize_item_type(s)
    if nt in ("inventory", "non_inventory", "service"):
        return nt
    return s


def _item_to_json(i, *, company_id: int | None = None, include_location_stocks: bool = False):
    row = {
        "id": i.id,
        "item_number": i.item_number or "",
        "name": i.name,
        "description": i.description or "",
        "item_type": _coerce_item_type_for_storage(i.item_type),
        "tracks_inventory": item_tracks_physical_stock(i),
        "unit_price": _serialize_decimal(i.unit_price),
        "cost": _serialize_decimal(i.cost),
        "quantity_on_hand": _serialize_decimal(_effective_quantity_on_hand(i)),
        "unit": i.unit or "piece",
        "pos_category": i.pos_category or "general",
        "content_weight_kg": (
            _serialize_decimal(i.content_weight_kg)
            if getattr(i, "content_weight_kg", None) is not None
            else None
        ),
        "pieces_per_kg": (
            _serialize_decimal(i.pieces_per_kg)
            if getattr(i, "pieces_per_kg", None) is not None
            else None
        ),
        "category": i.category or "",
        "barcode": i.barcode or "",
        "is_taxable": i.is_taxable,
        "is_pos_available": i.is_pos_available,
        "is_active": i.is_active,
        "image_url": i.image_url or "",
        "revenue_account_id": int(i.revenue_account_id) if getattr(i, "revenue_account_id", None) else None,
        "cogs_account_id": int(i.cogs_account_id) if getattr(i, "cogs_account_id", None) else None,
        "inventory_account_id": int(i.inventory_account_id) if getattr(i, "inventory_account_id", None) else None,
        "expense_account_id": int(i.expense_account_id) if getattr(i, "expense_account_id", None) else None,
        **item_opening_fields_for_api(i),
    }
    cid = company_id if company_id is not None else getattr(i, "company_id", None)
    if include_location_stocks and cid:
        if item_uses_station_bins(int(cid), i):
            row["location_stocks"] = per_station_quantities(int(cid), i.id)
        elif (i.pos_category or "").strip().lower() == "fish" and item_tracks_physical_stock(i):
            row["pond_stocks"] = per_pond_quantities(int(cid), i.id)
    return row


def _items_apply_q(qs, raw_q: str):
    q = (raw_q or "").strip()
    if not q:
        return qs
    return qs.filter(
        Q(name__icontains=q) | Q(item_number__icontains=q) | Q(description__icontains=q)
    )


def _items_apply_sort(qs, request):
    sort_key = (request.GET.get("sort") or "id").strip()
    desc = (request.GET.get("dir") or "asc").strip().lower() == "desc"
    prefix = "-" if desc else ""
    mapping = {
        "id": "id",
        "name": "name",
        "item_number": "item_number",
        "item_type": "item_type",
    }
    field = mapping.get(sort_key, "id")
    order = [f"{prefix}{field}"]
    if sort_key != "id":
        order.append("id")
    return qs.order_by(*order)


def _items_type_breakdown(qs):
    rows = qs.values("item_type").annotate(c=Count("id"))
    out = {"inventory": 0, "non_inventory": 0, "service": 0}
    for r in rows:
        t = (r["item_type"] or "").lower()
        if t in out:
            out[t] = r["c"]
    return out


@csrf_exempt
@auth_required
@require_company_id
def items_list_or_create(request):
    if request.method == "GET":
        qs = (
            Item.objects.filter(company_id=request.company_id)
            .select_related("revenue_account", "cogs_account", "inventory_account", "expense_account")
            .order_by("id")
        )
        if request.GET.get("for_tanks") in ("true", "1", "yes"):
            qs = _items_queryset_for_tank_assignment(qs)
        elif request.GET.get("pos_only") in ("true", "1", "yes"):
            qs = qs.filter(is_pos_available=True, is_active=True)
        qs = _items_queryset_with_tank_annotations(qs)
        want_loc = request.GET.get("location_stocks") in ("1", "true", "yes")
        cid = int(request.company_id)

        base_qs = qs
        qs = _items_apply_q(qs, request.GET.get("q", ""))
        it = (request.GET.get("item_type") or "").strip().lower()
        if it in ("inventory", "non_inventory", "service"):
            qs = qs.filter(item_type=it)
        qs = _items_apply_sort(qs, request)

        def _row(i):
            return _item_to_json(i, company_id=cid, include_location_stocks=want_loc)

        if wants_paged_response(request):
            skip, limit = parse_skip_limit(request, default_limit=50, max_limit=200)
            total = qs.count()
            stats = {
                "by_type": _items_type_breakdown(base_qs),
                "catalog_total": base_qs.count(),
            }
            page = qs[skip : skip + limit]
            return json_paged(
                [_row(i) for i in page],
                total=total,
                skip=skip,
                limit=limit,
                extras={"stats": stats},
            )

        return JsonResponse([_row(i) for i in qs], safe=False)

    if request.method == "POST":
        body, err = parse_json_body(request)
        if err:
            return err
        name = normalize_item_name_for_storage(body.get("name"))
        if not name:
            return JsonResponse({"detail": "name is required"}, status=400)
        unit_price = _parse_decimal(body.get("unit_price"), "0")
        cost = _parse_decimal(body.get("cost"), "0")
        qty = _parse_decimal(body.get("quantity_on_hand"), "0")
        if unit_price is None:
            return JsonResponse({"detail": "Invalid unit_price"}, status=400)
        if cost is None:
            return JsonResponse({"detail": "Invalid cost"}, status=400)
        if qty is None:
            return JsonResponse({"detail": "Invalid quantity_on_hand"}, status=400)
        if unit_price < 0:
            return JsonResponse({"detail": "unit_price cannot be negative"}, status=400)
        if cost < 0:
            return JsonResponse({"detail": "cost cannot be negative"}, status=400)
        if qty < 0:
            return JsonResponse({"detail": "quantity_on_hand cannot be negative"}, status=400)
        conflict = find_item_name_conflict(request.company_id, name)
        if conflict:
            return _item_name_conflict_response(conflict)
        bc = _truncate(body.get("barcode"), 64).strip()
        if bc and Item.objects.filter(company_id=request.company_id, barcode__iexact=bc).exists():
            return JsonResponse(
                {"detail": f"Another item already uses barcode '{bc}' in this company."},
                status=409,
            )
        inum, ierr = user_supplied_code_or_auto(
            request.company_id,
            Item,
            "item_number",
            "ITM",
            (body.get("item_number") or "").strip() or None,
            None,
        )
        if ierr:
            return JsonResponse({"detail": ierr}, status=400)
        content_weight_kg = None
        if "content_weight_kg" in body:
            content_weight_kg, cw_err = _parse_optional_content_weight_kg(body.get("content_weight_kg"))
            if cw_err:
                return JsonResponse({"detail": cw_err}, status=400)
        pieces_per_kg = None
        if "pieces_per_kg" in body:
            pieces_per_kg, ppk_err = _parse_optional_pieces_per_kg(body.get("pieces_per_kg"))
            if ppk_err:
                return JsonResponse({"detail": ppk_err}, status=400)
        cat = normalize_item_reporting_category(body.get("category"))
        if not cat:
            return JsonResponse(
                {
                    "detail": (
                        "Item category is required. Pick a reporting category (e.g. General, Fuel, "
                        "Fish feed, Aquaculture, Poultry feed) so item and category reports stay accurate."
                    )
                },
                status=400,
            )
        pos_cat_pre = _truncate(body.get("pos_category") or "general", 64) or "general"
        itype_pre = _coerce_item_type_for_storage(body.get("item_type"))
        if (
            pos_cat_pre.strip().lower() == "fish"
            and normalize_item_type(itype_pre) == "inventory"
            and qty > 0
        ):
            n_ponds_chk = AquaculturePond.objects.filter(
                company_id=request.company_id, is_active=True
            ).count()
            if n_ponds_chk > 1:
                raw_pid = body.get("pond_id")
                if raw_pid is None or raw_pid == "":
                    return JsonResponse(
                        {
                            "detail": (
                                "This company has multiple aquaculture ponds. Send pond_id so initial "
                                "fish stock is recorded on the correct pond."
                            )
                        },
                        status=400,
                    )
                try:
                    pid_chk = int(raw_pid)
                except (TypeError, ValueError):
                    return JsonResponse({"detail": "Invalid pond_id"}, status=400)
                if not AquaculturePond.objects.filter(
                    pk=pid_chk, company_id=request.company_id, is_active=True
                ).exists():
                    return JsonResponse(
                        {"detail": "Unknown pond_id for this company"},
                        status=404,
                    )
        i = Item(
            company_id=request.company_id,
            name=name,
            description=_truncate(body.get("description"), 10000) or "",
            item_type=_coerce_item_type_for_storage(body.get("item_type")),
            unit_price=unit_price,
            cost=cost,
            quantity_on_hand=qty,
            unit=_truncate(body.get("unit") or "piece", 20) or "piece",
            pos_category=_truncate(body.get("pos_category") or "general", 64) or "general",
            content_weight_kg=content_weight_kg,
            pieces_per_kg=pieces_per_kg,
            category=cat,
            barcode=bc,
            is_taxable=body.get("is_taxable", True),
            is_pos_available=body.get("is_pos_available", True),
            is_active=body.get("is_active", True),
            image_url=_truncate(body.get("image_url"), 500),
            item_number=inum or "",
        )
        gl_err = _apply_item_gl_accounts_from_body(request.company_id, body, i)
        if gl_err:
            return gl_err
        if (i.pos_category or "").strip().lower() in ("non_pos", "fish"):
            i.is_pos_available = False
        try:
            i.save()
        except ValidationError as e:
            return JsonResponse({"detail": "Validation failed", "errors": e.message_dict if hasattr(e, "message_dict") else str(e)}, status=400)
        ensure_item_station_row_for_new_shop_item(
            request.company_id,
            i,
            station_id=resolve_active_station_id(request.company_id, body.get("station_id")),
            move_all=_body_flag(body, "move_all_shop_stock"),
        )
        if (
            (i.pos_category or "").strip().lower() == "fish"
            and item_tracks_physical_stock(i)
            and qty > 0
        ):
            n_ponds = AquaculturePond.objects.filter(company_id=request.company_id, is_active=True).count()
            if n_ponds >= 1:
                if n_ponds == 1:
                    pid = (
                        AquaculturePond.objects.filter(company_id=request.company_id, is_active=True)
                        .order_by("sort_order", "id")
                        .values_list("id", flat=True)
                        .first()
                    )
                else:
                    pid = int(body.get("pond_id"))
                try:
                    set_pond_stock(request.company_id, int(pid), i.pk, qty)
                except ValueError as e:
                    return JsonResponse({"detail": str(e)}, status=400)
                i.refresh_from_db()
        if (
            item_tracks_physical_stock(i)
            and (i.pos_category or "").strip().lower() != "fish"
            and qty > 0
            and cost > 0
        ):
            ob_raw = (body.get("opening_balance_date") or "").strip()
            ob_date = None
            if ob_raw:
                try:
                    ob_date = datetime.strptime(ob_raw, "%Y-%m-%d").date()
                except ValueError:
                    ob_date = None
            i.opening_stock_quantity = qty
            i.opening_stock_unit_cost = cost
            i.opening_balance_date = ob_date or timezone.localdate()
            i.save(
                update_fields=[
                    "opening_stock_quantity",
                    "opening_stock_unit_cost",
                    "opening_balance_date",
                ]
            )
            post_item_opening_stock_gl(request.company_id, i)
        if not i.item_number:
            assigned, aerr = assign_string_code_if_empty(
                request.company_id, Item, "item_number", "ITM", i.pk, None, None
            )
            if aerr:
                i.delete()
                return JsonResponse({"detail": aerr}, status=400)
            i.item_number = assigned
        i2 = _items_queryset_with_tank_annotations(Item.objects.filter(pk=i.pk)).first()
        return JsonResponse(
            _item_to_json(i2 or i, company_id=request.company_id, include_location_stocks=True),
            status=201,
        )

    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def item_detail(request, item_id: int):
    i = (
        _items_queryset_with_tank_annotations(
            Item.objects.filter(id=item_id, company_id=request.company_id).select_related(
                "revenue_account", "cogs_account", "inventory_account", "expense_account"
            )
        ).first()
    )
    if not i:
        return JsonResponse({"detail": "Item not found"}, status=404)

    if request.method == "GET":
        return JsonResponse(
            _item_to_json(
                i,
                company_id=request.company_id,
                include_location_stocks=True,
            )
        )

    if request.method == "PUT":
        body, err = parse_json_body(request)
        if err:
            return err
        gl_err = _apply_item_gl_accounts_from_body(request.company_id, body, i)
        if gl_err:
            return gl_err
        if body.get("name") is not None:
            nm = normalize_item_name_for_storage(body.get("name"))
            if nm:
                conflict = find_item_name_conflict(request.company_id, nm, exclude_pk=i.pk)
                if conflict:
                    return _item_name_conflict_response(conflict)
                i.name = nm
            # empty / whitespace-only keeps existing name
        if "description" in body:
            i.description = _truncate(body.get("description"), 10000) or ""
        if "item_type" in body:
            i.item_type = _coerce_item_type_for_storage(body.get("item_type") or i.item_type)
        if "unit_price" in body and body["unit_price"] is not None:
            up = _parse_decimal(body["unit_price"])
            if up is None:
                return JsonResponse({"detail": "Invalid unit_price"}, status=400)
            if up < 0:
                return JsonResponse({"detail": "unit_price cannot be negative"}, status=400)
            i.unit_price = up
        if "cost" in body and body["cost"] is not None:
            c = _parse_decimal(body["cost"])
            if c is None:
                return JsonResponse({"detail": "Invalid cost"}, status=400)
            if c < 0:
                return JsonResponse({"detail": "cost cannot be negative"}, status=400)
            i.cost = c
        # Catalog / pricing fields must persist even when quantity rules fail below (e.g. missing
        # station_id for multi-site shop stock, or tank_id for multi-tank fuel). Previously quantity
        # validation returned 400 before any save(), so unit_price/cost updates were silently dropped.
        if "unit" in body:
            i.unit = _truncate(body.get("unit") or i.unit, 20) or i.unit
        if "pos_category" in body:
            i.pos_category = _truncate(body.get("pos_category") or "general", 64) or "general"
        if "content_weight_kg" in body:
            raw_cw = body.get("content_weight_kg")
            if raw_cw is None or (isinstance(raw_cw, str) and not str(raw_cw).strip()):
                i.content_weight_kg = None
            else:
                cw_dec, cw_err = _parse_optional_content_weight_kg(raw_cw)
                if cw_err:
                    return JsonResponse({"detail": cw_err}, status=400)
                i.content_weight_kg = cw_dec
        if "pieces_per_kg" in body:
            raw_ppk = body.get("pieces_per_kg")
            if raw_ppk is None or (isinstance(raw_ppk, str) and not str(raw_ppk).strip()):
                i.pieces_per_kg = None
            else:
                ppk_dec, ppk_err = _parse_optional_pieces_per_kg(raw_ppk)
                if ppk_err:
                    return JsonResponse({"detail": ppk_err}, status=400)
                i.pieces_per_kg = ppk_dec
        if "category" in body:
            cat = normalize_item_reporting_category(body.get("category"))
            if not cat:
                return JsonResponse(
                    {
                        "detail": (
                            "Item category cannot be empty. Set a reporting category for this product."
                        )
                    },
                    status=400,
                )
            i.category = cat
        if "barcode" in body:
            bc = _truncate(body.get("barcode"), 64).strip()
            if bc and Item.objects.filter(company_id=request.company_id, barcode__iexact=bc).exclude(
                pk=i.pk
            ).exists():
                return JsonResponse(
                    {"detail": f"Another item already uses barcode '{bc}' in this company."},
                    status=409,
                )
            i.barcode = bc
        if "is_taxable" in body:
            i.is_taxable = bool(body["is_taxable"])
        if "is_pos_available" in body:
            i.is_pos_available = bool(body["is_pos_available"])
        if (i.pos_category or "").strip().lower() in ("non_pos", "fish"):
            i.is_pos_available = False
        if "is_active" in body:
            i.is_active = bool(body["is_active"])
        if "image_url" in body:
            i.image_url = _truncate(body.get("image_url"), 500)
        try:
            i.save()
        except ValidationError as e:
            return JsonResponse(
                {
                    "detail": "Validation failed",
                    "errors": e.message_dict if hasattr(e, "message_dict") else str(e),
                },
                status=400,
            )
        if "quantity_on_hand" in body and body["quantity_on_hand"] is not None:
            q = _parse_decimal(body["quantity_on_hand"])
            if q is None:
                return JsonResponse({"detail": "Invalid quantity_on_hand"}, status=400)
            if q < 0:
                return JsonResponse({"detail": "quantity_on_hand cannot be negative"}, status=400)
            tank_qs = Tank.objects.filter(
                product_id=i.pk, company_id=i.company_id, is_active=True
            ).order_by("id")
            tanks = list(tank_qs)
            if not tanks and item_uses_station_bins(i.company_id, i):
                n_st = Station.objects.filter(company_id=i.company_id, is_active=True).count()
                raw_sid = body.get("station_id")
                if n_st > 1:
                    if raw_sid is None or raw_sid == "":
                        return JsonResponse(
                            {
                                "detail": (
                                    "This company has multiple stations. Send station_id to set on-hand "
                                    "quantity for that location, or use inventory transfer to move between stations."
                                )
                            },
                            status=400,
                        )
                    try:
                        target_sid = int(raw_sid)
                    except (TypeError, ValueError):
                        return JsonResponse({"detail": "Invalid station_id"}, status=400)
                    if not Station.objects.filter(
                        pk=target_sid, company_id=i.company_id, is_active=True
                    ).exists():
                        return JsonResponse({"detail": "Unknown station_id for this company"}, status=404)
                else:
                    target_sid = get_or_create_default_station(i.company_id).id
                    if raw_sid is not None and raw_sid != "":
                        try:
                            target_sid = int(raw_sid)
                        except (TypeError, ValueError):
                            return JsonResponse({"detail": "Invalid station_id"}, status=400)
                        if not Station.objects.filter(
                            pk=target_sid, company_id=i.company_id, is_active=True
                        ).exists():
                            return JsonResponse(
                                {"detail": "Unknown station_id for this company"}, status=404
                            )
                if _body_flag(body, "move_all_shop_stock"):
                    move_shop_stock_to_station(i.company_id, target_sid, i.pk, q)
                else:
                    set_station_stock(i.company_id, target_sid, i.pk, q)
                i.refresh_from_db()
            elif not tanks:
                pos_fish = (i.pos_category or "").strip().lower() == "fish" and item_tracks_physical_stock(i)
                if pos_fish:
                    n_ponds = AquaculturePond.objects.filter(
                        company_id=i.company_id, is_active=True
                    ).count()
                    if n_ponds > 1:
                        raw_pid = body.get("pond_id")
                        if raw_pid is None or raw_pid == "":
                            return JsonResponse(
                                {
                                    "detail": (
                                        "This company has multiple aquaculture ponds. Send pond_id with "
                                        "quantity_on_hand to set stock for that pond."
                                    )
                                },
                                status=400,
                            )
                        try:
                            target_pid = int(raw_pid)
                        except (TypeError, ValueError):
                            return JsonResponse({"detail": "Invalid pond_id"}, status=400)
                        if not AquaculturePond.objects.filter(
                            pk=target_pid, company_id=i.company_id, is_active=True
                        ).exists():
                            return JsonResponse(
                                {"detail": "Unknown pond_id for this company"},
                                status=404,
                            )
                        try:
                            set_pond_stock(i.company_id, target_pid, i.pk, q)
                        except ValueError as e:
                            return JsonResponse({"detail": str(e)}, status=400)
                        i.refresh_from_db()
                    elif n_ponds == 1:
                        only = (
                            AquaculturePond.objects.filter(
                                company_id=i.company_id, is_active=True
                            )
                            .order_by("sort_order", "id")
                            .first()
                        )
                        if only is None:
                            i.quantity_on_hand = q
                        else:
                            try:
                                set_pond_stock(i.company_id, only.id, i.pk, q)
                            except ValueError as e:
                                return JsonResponse({"detail": str(e)}, status=400)
                            i.refresh_from_db()
                    else:
                        i.quantity_on_hand = q
                else:
                    i.quantity_on_hand = q
            elif len(tanks) == 1:
                Tank.objects.filter(pk=tanks[0].pk).update(current_stock=q)
                i.quantity_on_hand = q
            else:
                raw_tid = body.get("tank_id")
                if raw_tid is None or raw_tid == "":
                    return JsonResponse(
                        {
                            "detail": (
                                "This product has multiple active fuel tanks. Send tank_id with "
                                "quantity_on_hand to set that tank's stock, or adjust tanks on the Tanks page."
                            )
                        },
                        status=400,
                    )
                try:
                    tid = int(raw_tid)
                except (TypeError, ValueError):
                    return JsonResponse({"detail": "Invalid tank_id"}, status=400)
                match = next((t for t in tanks if t.pk == tid), None)
                if not match:
                    return JsonResponse(
                        {"detail": "tank_id does not match an active tank for this product"},
                        status=400,
                    )
                Tank.objects.filter(pk=match.pk).update(current_stock=q)
                total = (
                    Tank.objects.filter(
                        product_id=i.pk, company_id=i.company_id, is_active=True
                    ).aggregate(s=Sum("current_stock"))["s"]
                    or Decimal("0")
                )
                i.quantity_on_hand = total
        try:
            i.save()
        except ValidationError as e:
            return JsonResponse(
                {
                    "detail": "Validation failed",
                    "errors": e.message_dict if hasattr(e, "message_dict") else str(e),
                },
                status=400,
            )
        i2 = _items_queryset_with_tank_annotations(Item.objects.filter(pk=i.pk)).first()
        return JsonResponse(
            _item_to_json(
                i2 or i,
                company_id=request.company_id,
                include_location_stocks=True,
            )
        )

    if request.method == "DELETE":
        if i.tanks.exists():
            return JsonResponse(
                {
                    "detail": (
                        "Cannot delete this item: it is linked to one or more fuel tanks. "
                        "Reassign or remove those tanks first."
                    )
                },
                status=400,
            )
        if i.nozzles.exists():
            return JsonResponse(
                {
                    "detail": (
                        "Cannot delete this item: it is linked to dispenser nozzles. "
                        "Reassign or remove those nozzles first."
                    )
                },
                status=400,
            )
        try:
            with transaction.atomic():
                i.delete()
        except IntegrityError:
            return JsonResponse(
                {
                    "detail": (
                        "Delete was rolled back: this item is still referenced elsewhere. "
                        "Remove related records and try again."
                    )
                },
                status=400,
            )
        return JsonResponse({"detail": "Deleted"}, status=200)

    return JsonResponse({"detail": "Method not allowed"}, status=405)


@require_GET
@auth_required
@require_company_id
def item_reporting_category_suggestions(request):
    """
    Preset reporting labels plus any category strings already in use for this company
    (for dropdowns; users may still type a new value when creating an item).
    """
    in_use = (
        Item.objects.filter(company_id=request.company_id)
        .values_list("category", flat=True)
        .distinct()
    )
    custom = sorted(
        {str(c).strip() for c in in_use if c and str(c).strip()},
        key=str.lower,
    )
    suggested_set = set(SUGGESTED_ITEM_REPORTING_CATEGORIES)
    only_custom = [c for c in custom if c not in suggested_set]
    return JsonResponse(
        {
            "presets": list(SUGGESTED_ITEM_REPORTING_CATEGORIES),
            "custom_in_use": only_custom,
        }
    )


@csrf_exempt
@auth_required
@require_company_id
def upload_item_image(request):
    """POST /api/upload/items/image - multipart file or base64; returns image_url."""
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    # Support multipart file
    file = request.FILES.get("file") or request.FILES.get("image")
    if file:
        ext = os.path.splitext(file.name)[1] or ".png"
        name = f"items/{uuid.uuid4().hex}{ext}"
        base_dir = getattr(settings, "MEDIA_ROOT", None) or os.path.join(settings.BASE_DIR, "media")
        os.makedirs(os.path.join(base_dir, "items"), exist_ok=True)
        path = os.path.join(base_dir, name)
        with open(path, "wb") as f:
            for chunk in file.chunks():
                f.write(chunk)
        url = f"/media/{name}"
        return JsonResponse({"image_url": url, "url": url})
    # JSON body with base64
    body, err = parse_json_body(request)
    if err:
        return err
    import base64
    data = body.get("data") or body.get("image_data") or body.get("base64")
    if not data:
        return JsonResponse({"detail": "file or data/base64 required"}, status=400)
    try:
        raw = base64.b64decode(data.split(",")[-1] if "," in data else data)
    except Exception:
        return JsonResponse({"detail": "Invalid base64"}, status=400)
    ext = ".png"
    name = f"items/{uuid.uuid4().hex}{ext}"
    base_dir = getattr(settings, "MEDIA_ROOT", None) or os.path.join(settings.BASE_DIR, "media")
    os.makedirs(os.path.join(base_dir, "items"), exist_ok=True)
    path = os.path.join(base_dir, name)
    with open(path, "wb") as f:
        f.write(raw)
    url = f"/media/{name}"
    return JsonResponse({"image_url": url, "url": url})
