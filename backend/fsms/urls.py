"""FSMS URL Configuration."""
from django.contrib import admin
from django.conf import settings
from django.conf.urls.static import static
from django.http import JsonResponse
from django.urls import path, include

from fsms.release_info import health_payload, version_payload


def health(request):
    """Health check for frontend and load balancers. No auth required."""
    return JsonResponse(health_payload())


def version_info(request):
    """Deploy verification: build version, commit, environment flags (no secrets)."""
    return JsonResponse(version_payload())


def api_root(request):
    payload = {"message": "FSMS API"}
    if settings.DEBUG:
        payload["docs"] = "/api/docs/"
    return JsonResponse(payload)

urlpatterns = [
    path("admin/", admin.site.urls),
    path("health", health),
    path("health/", health),
    path("version/", version_info),
    path("version", version_info),
    path("", api_root),
    path("api/", include("api.urls")),
]
if getattr(settings, "DEBUG", False):
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
