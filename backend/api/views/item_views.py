"""Items (products) API: list, create, get, update, delete (company-scoped)."""
import json
import os
import uuid
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import DecimalField, Exists, F, OuterRef, Q, Sum, Value
from django.db.models.functions import Coalesce
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from api.utils.auth import auth_required
from api.views.common import parse_json_body, require_company_id, _serialize_decimal
from api.models import Item, Tank


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


def _truncate(val, max_len):
    if val is None:
        return ""
    return (str(val) or "")[:max_len]


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


def _item_to_json(i):
    return {
        "id": i.id,
        "item_number": i.item_number or "",
        "name": i.name,
        "description": i.description or "",
        "item_type": i.item_type or "inventory",
        "unit_price": _serialize_decimal(i.unit_price),
        "cost": _serialize_decimal(i.cost),
        "quantity_on_hand": _serialize_decimal(_effective_quantity_on_hand(i)),
        "unit": i.unit or "piece",
        "pos_category": i.pos_category or "general",
        "category": i.category or "",
        "barcode": i.barcode or "",
        "is_taxable": i.is_taxable,
        "is_pos_available": i.is_pos_available,
        "is_active": i.is_active,
        "image_url": i.image_url or "",
    }


@csrf_exempt
@auth_required
@require_company_id
def items_list_or_create(request):
    if request.method == "GET":
        qs = Item.objects.filter(company_id=request.company_id).order_by("id")
        if request.GET.get("for_tanks") in ("true", "1", "yes"):
            qs = _items_queryset_for_tank_assignment(qs)
        elif request.GET.get("pos_only") in ("true", "1", "yes"):
            qs = qs.filter(is_pos_available=True, is_active=True)
        qs = _items_queryset_with_tank_annotations(qs)
        return JsonResponse([_item_to_json(i) for i in qs], safe=False)

    if request.method == "POST":
        body, err = parse_json_body(request)
        if err:
            return err
        name = _truncate((body.get("name") or "").strip(), 200)
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
        bc = _truncate(body.get("barcode"), 64).strip()
        if bc and Item.objects.filter(company_id=request.company_id, barcode__iexact=bc).exists():
            return JsonResponse(
                {"detail": f"Another item already uses barcode '{bc}' in this company."},
                status=409,
            )
        i = Item(
            company_id=request.company_id,
            name=name,
            description=_truncate(body.get("description"), 10000) or "",
            item_type=_truncate(body.get("item_type") or "inventory", 32) or "inventory",
            unit_price=unit_price,
            cost=cost,
            quantity_on_hand=qty,
            unit=_truncate(body.get("unit") or "piece", 20) or "piece",
            pos_category=_truncate(body.get("pos_category") or "general", 64) or "general",
            category=_truncate(body.get("category"), 100),
            barcode=bc,
            is_taxable=body.get("is_taxable", True),
            is_pos_available=body.get("is_pos_available", True),
            is_active=body.get("is_active", True),
            image_url=_truncate(body.get("image_url"), 500),
        )
        try:
            i.save()
        except ValidationError as e:
            return JsonResponse({"detail": "Validation failed", "errors": e.message_dict if hasattr(e, "message_dict") else str(e)}, status=400)
        if not i.item_number:
            i.item_number = f"ITM-{i.id}"
            Item.objects.filter(pk=i.pk).update(item_number=i.item_number)
        i2 = _items_queryset_with_tank_annotations(Item.objects.filter(pk=i.pk)).first()
        return JsonResponse(_item_to_json(i2 or i), status=201)

    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def item_detail(request, item_id: int):
    i = (
        _items_queryset_with_tank_annotations(
            Item.objects.filter(id=item_id, company_id=request.company_id)
        ).first()
    )
    if not i:
        return JsonResponse({"detail": "Item not found"}, status=404)

    if request.method == "GET":
        return JsonResponse(_item_to_json(i))

    if request.method == "PUT":
        body, err = parse_json_body(request)
        if err:
            return err
        if body.get("name") is not None:
            nm = _truncate((body.get("name") or "").strip(), 200)
            i.name = nm or i.name
        if "description" in body:
            i.description = _truncate(body.get("description"), 10000) or ""
        if "item_type" in body:
            i.item_type = _truncate(body.get("item_type") or i.item_type, 32) or i.item_type
        if "unit_price" in body and body["unit_price"] is not None:
            up = _parse_decimal(body["unit_price"])
            if up is None:
                return JsonResponse({"detail": "Invalid unit_price"}, status=400)
            i.unit_price = up
        if "cost" in body and body["cost"] is not None:
            c = _parse_decimal(body["cost"])
            if c is None:
                return JsonResponse({"detail": "Invalid cost"}, status=400)
            i.cost = c
        if "quantity_on_hand" in body and body["quantity_on_hand"] is not None:
            q = _parse_decimal(body["quantity_on_hand"])
            if q is None:
                return JsonResponse({"detail": "Invalid quantity_on_hand"}, status=400)
            tank_qs = Tank.objects.filter(
                product_id=i.pk, company_id=i.company_id, is_active=True
            ).order_by("id")
            tanks = list(tank_qs)
            if not tanks:
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
        if "unit" in body:
            i.unit = _truncate(body.get("unit") or i.unit, 20) or i.unit
        if "pos_category" in body:
            i.pos_category = _truncate(body.get("pos_category") or "general", 64) or "general"
        if "category" in body:
            i.category = _truncate(body.get("category"), 100)
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
        if "is_active" in body:
            i.is_active = bool(body["is_active"])
        if "image_url" in body:
            i.image_url = _truncate(body.get("image_url"), 500)
        try:
            i.save()
        except ValidationError as e:
            return JsonResponse({"detail": "Validation failed", "errors": e.message_dict if hasattr(e, "message_dict") else str(e)}, status=400)
        i2 = _items_queryset_with_tank_annotations(Item.objects.filter(pk=i.pk)).first()
        return JsonResponse(_item_to_json(i2 or i))

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
