"""Vendor purchase terms, mill credits, and dated rate cards."""
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from api.models import Vendor, VendorCredit, VendorRateCard
from api.services.vendor_purchase_terms import (
    apply_monthly_scheme_credit,
    apply_yearly_scheme_credit,
    create_vendor_credit,
    delete_vendor_credit,
    purchase_terms_payload,
    rate_card_to_json,
    upsert_rate_card_from_body,
    vendor_credit_to_json,
)
from api.utils.auth import auth_required
from api.views.common import parse_json_body, require_company_id


def _vendor(request, vendor_id: int) -> Vendor | None:
    return Vendor.objects.filter(id=vendor_id, company_id=request.company_id).first()


@csrf_exempt
@auth_required
@require_company_id
def vendor_purchase_terms(request, vendor_id: int):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    v = _vendor(request, vendor_id)
    if not v:
        return JsonResponse({"detail": "Vendor not found"}, status=404)
    return JsonResponse(purchase_terms_payload(request.company_id, v))


@csrf_exempt
@auth_required
@require_company_id
def vendor_rate_cards_list_or_create(request, vendor_id: int):
    v = _vendor(request, vendor_id)
    if not v:
        return JsonResponse({"detail": "Vendor not found"}, status=404)
    if request.method == "GET":
        cards = VendorRateCard.objects.filter(
            vendor_id=v.id, company_id=request.company_id
        ).order_by("-effective_from", "-id")
        return JsonResponse([rate_card_to_json(c) for c in cards], safe=False)
    if request.method == "POST":
        body, err = parse_json_body(request)
        if err:
            return err
        card, msg = upsert_rate_card_from_body(v, {"rate_card": body})
        if msg:
            return JsonResponse({"detail": msg}, status=400)
        return JsonResponse(rate_card_to_json(card), status=201)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def vendor_rate_card_detail(request, vendor_id: int, card_id: int):
    v = _vendor(request, vendor_id)
    if not v:
        return JsonResponse({"detail": "Vendor not found"}, status=404)
    card = VendorRateCard.objects.filter(
        pk=card_id, vendor_id=v.id, company_id=request.company_id
    ).first()
    if not card:
        return JsonResponse({"detail": "Rate card not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(rate_card_to_json(card))
    if request.method == "PUT":
        body, err = parse_json_body(request)
        if err:
            return err
        body = dict(body or {})
        if "effective_from" not in body:
            body["effective_from"] = card.effective_from.isoformat()
        updated, msg = upsert_rate_card_from_body(v, {"rate_card": body})
        if msg:
            return JsonResponse({"detail": msg}, status=400)
        if updated and updated.id != card.id:
            # Same from-date upsert; if client changed from-date a new row may appear.
            pass
        return JsonResponse(rate_card_to_json(updated or card))
    if request.method == "DELETE":
        card.is_active = False
        card.save(update_fields=["is_active", "updated_at"])
        return JsonResponse({"detail": "Rate card deactivated", "is_active": False})
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def vendor_credits_list_or_create(request, vendor_id: int):
    v = _vendor(request, vendor_id)
    if not v:
        return JsonResponse({"detail": "Vendor not found"}, status=404)
    if request.method == "GET":
        rows = VendorCredit.objects.filter(company_id=request.company_id, vendor_id=v.id)
        return JsonResponse([vendor_credit_to_json(c) for c in rows], safe=False)
    if request.method == "POST":
        body, err = parse_json_body(request)
        if err:
            return err
        credit, resp = create_vendor_credit(request.company_id, v, body)
        if resp:
            return resp
        return JsonResponse(vendor_credit_to_json(credit), status=201)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def vendor_credit_detail(request, vendor_id: int, credit_id: int):
    v = _vendor(request, vendor_id)
    if not v:
        return JsonResponse({"detail": "Vendor not found"}, status=404)
    credit = VendorCredit.objects.filter(
        pk=credit_id, vendor_id=v.id, company_id=request.company_id
    ).first()
    if not credit:
        return JsonResponse({"detail": "Vendor credit not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(vendor_credit_to_json(credit))
    if request.method == "DELETE":
        delete_vendor_credit(request.company_id, credit)
        return JsonResponse({"detail": "Vendor credit deleted"})
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def vendor_apply_monthly_scheme(request, vendor_id: int):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    v = _vendor(request, vendor_id)
    if not v:
        return JsonResponse({"detail": "Vendor not found"}, status=404)
    body, err = parse_json_body(request)
    if err:
        return err
    credit, resp = apply_monthly_scheme_credit(request.company_id, v, body or {})
    if resp:
        return resp
    return JsonResponse(vendor_credit_to_json(credit), status=201)


@csrf_exempt
@auth_required
@require_company_id
def vendor_apply_yearly_scheme(request, vendor_id: int):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    v = _vendor(request, vendor_id)
    if not v:
        return JsonResponse({"detail": "Vendor not found"}, status=404)
    body, err = parse_json_body(request)
    if err:
        return err
    credit, resp = apply_yearly_scheme_credit(request.company_id, v, body or {})
    if resp:
        return resp
    return JsonResponse(vendor_credit_to_json(credit), status=201)
