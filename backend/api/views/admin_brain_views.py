"""Super Admin — platform-wide Company Brain API configuration."""
from __future__ import annotations

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from api.services.brain import config as brain_config
from api.utils.auth import auth_required, get_user_from_request
from api.views.admin_views import _super_admin_required
from api.views.common import parse_json_body


@csrf_exempt
@require_http_methods(["GET", "PUT"])
@auth_required
@_super_admin_required
def admin_brain_config(request):
    """GET/PUT /api/admin/brain-config/ — OpenRouter keys for free vs paid Brain tiers."""
    if request.method == "GET":
        return JsonResponse(brain_config.serialize_brain_config_for_admin())

    body, err_resp = parse_json_body(request)
    if err_resp:
        return err_resp
    user = get_user_from_request(request)
    brain_config.update_brain_config_from_admin(body or {}, user_id=user.id if user else None)
    return JsonResponse(brain_config.serialize_brain_config_for_admin())
