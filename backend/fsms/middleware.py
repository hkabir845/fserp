"""Cross-cutting HTTP middleware."""
from __future__ import annotations

import uuid


class CorrelationIdMiddleware:
    """
    Propagate or assign X-Request-ID for tracing across logs and proxies.
    Accepts incoming X-Request-ID from clients; otherwise generates a UUID.
    """

    HEADER = "HTTP_X_REQUEST_ID"
    OUT = "X-Request-ID"

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        raw = request.META.get(self.HEADER) or ""
        cid = (raw.strip()[:128] or str(uuid.uuid4()))
        request.correlation_id = cid
        response = self.get_response(request)
        response[self.OUT] = cid
        return response
