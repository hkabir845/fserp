"""Stub list endpoints (empty or minimal) for resources not yet migrated from FastAPI."""
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from django.views.decorators.csrf import csrf_exempt
from api.utils.auth import auth_required


def _empty_list(request):
    return JsonResponse([], safe=False)


@csrf_exempt
@require_GET
@auth_required
def customers_list(request):
    """GET /api/customers/ - list customers (stub: empty)."""
    return _empty_list(request)


@csrf_exempt
@require_GET
@auth_required
def tanks_list(request):
    """GET /api/tanks/ - list tanks (stub: empty)."""
    return _empty_list(request)


@csrf_exempt
@require_GET
@auth_required
def stations_list(request):
    """GET /api/stations/ - list stations (stub: empty)."""
    return _empty_list(request)


@csrf_exempt
@require_GET
@auth_required
def items_list(request):
    """GET /api/items/ - list items (stub: empty). pos_only query param ignored."""
    return _empty_list(request)


@csrf_exempt
@require_GET
@auth_required
def nozzles_details(request):
    """GET /api/nozzles/details - nozzle details (stub: empty)."""
    return _empty_list(request)
