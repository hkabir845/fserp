"""GET suggested reference codes (gap-aware) for master data create forms."""
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from api.utils.auth import auth_required
from api.views.common import require_company_id
from api.models import Customer, Employee, Item, Nozzle, Tank, Vendor
from api.services.reference_code import suggest_payload

_KINDS = {
    "nozzle": (Nozzle, "nozzle_number", "NZL", None),
    "customer": (Customer, "customer_number", "CUST", None),
    "vendor": (Vendor, "vendor_number", "VND", None),
    "item": (Item, "item_number", "ITM", None),
    "tank": (Tank, "tank_number", "TNK", None),
    "employee": (Employee, "employee_code", "EMP", 5),
}


@require_http_methods(["GET"])
@auth_required
@require_company_id
def suggested_reference_codes(request):
    kind = (request.GET.get("kind") or "").strip().lower()
    if kind not in _KINDS:
        return JsonResponse(
            {"detail": f"Invalid kind. Use one of: {', '.join(sorted(_KINDS.keys()))}"},
            status=400,
        )
    model, field, prefix, width = _KINDS[kind]
    return JsonResponse(suggest_payload(request.company_id, model, field, prefix, width))
