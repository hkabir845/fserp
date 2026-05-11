"""Shared offset pagination for list endpoints.

Contract (opt-in): pass ``paged=1`` (or ``true`` / ``yes``) to receive::

    {
        "count": <total after filters>,
        "skip": <int>,
        "limit": <int>,
        "results": [ ... ],
        ... optional extras (e.g. "stats")
    }

Without ``paged``, list views keep their legacy behaviour (typically a JSON array).
"""
from __future__ import annotations

from typing import Any, Mapping

from django.http import JsonResponse


def wants_paged_response(request) -> bool:
    v = (request.GET.get("paged") or "").strip().lower()
    return v in ("1", "true", "yes")


def parse_skip_limit(
    request,
    *,
    default_skip: int = 0,
    default_limit: int = 50,
    max_limit: int = 500,
) -> tuple[int, int]:
    try:
        skip = int(request.GET.get("skip", default_skip))
    except (TypeError, ValueError):
        skip = default_skip
    try:
        limit = int(request.GET.get("limit", default_limit))
    except (TypeError, ValueError):
        limit = default_limit
    skip = max(0, skip)
    limit = max(1, min(limit, max_limit))
    return skip, limit


def json_paged(
    results: list[Any],
    *,
    total: int,
    skip: int,
    limit: int,
    extras: Mapping[str, Any] | None = None,
) -> JsonResponse:
    body: dict[str, Any] = {
        "count": total,
        "skip": skip,
        "limit": limit,
        "results": results,
    }
    if extras:
        body.update(dict(extras))
    return JsonResponse(body)
