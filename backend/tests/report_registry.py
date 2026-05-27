"""Canonical list of GET /api/reports/<id>/ handlers (keep smoke tests in sync)."""
from __future__ import annotations

from api.services.permission_service import REPORT_PERMISSION_DEFINITIONS
from api.views import reports_views as reports_views

_ITEM_SCOPED_REPORT_IDS: tuple[str, ...] = (
    "item-sales-custom",
    "item-purchases-custom",
    "item-stock-movement",
    "item-velocity-analysis",
    "item-purchase-velocity-analysis",
)

# Client-only / wrapper UIs (no direct GET /api/reports/<id>/)
UI_ONLY_REPORT_IDS: frozenset[str] = frozenset(
    {
        "analytics-kpi",  # FinancialAnalyticsPanel -> financial-analytics API
        "aquaculture-pl-management",
    }
)

ALL_API_REPORT_IDS: tuple[str, ...] = tuple(
    sorted(
        set(reports_views._REPORT_HANDLERS.keys())
        | set(_ITEM_SCOPED_REPORT_IDS)
        | set(reports_views.AQUACULTURE_REPORT_IDS)
    )
)

PERMISSION_REPORT_IDS: frozenset[str] = frozenset(
    d["report_id"] for d in REPORT_PERMISSION_DEFINITIONS
)
