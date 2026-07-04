"""Standard response envelope for Company Brain answers."""
from __future__ import annotations

from typing import Any

from django.utils import timezone


def enrich_response_metadata(
    structured: dict[str, Any],
    *,
    context: dict[str, Any] | None = None,
    route: dict[str, Any] | None = None,
    model_used: str = "",
) -> dict[str, Any]:
    """Add analysis metadata without changing existing answer fields."""
    out = dict(structured)
    ctx = context or {}
    meta = out.get("response_meta") or {}
    if not isinstance(meta, dict):
        meta = {}

    meta.update(
        {
            "analysis_at": ctx.get("analysis_at") or timezone.now().isoformat(),
            "question_type": (route or {}).get("question_type"),
            "advisor_mode": (route or {}).get("advisor_mode"),
            "model_used": model_used,
            "data_sources_used": _collect_sources(out, ctx),
            "confidence": out.get("confidence") or meta.get("confidence") or "medium",
        }
    )
    out["response_meta"] = meta
    return out


def _collect_sources(structured: dict[str, Any], context: dict[str, Any]) -> list[str]:
    labels: list[str] = []
    for s in structured.get("sources") or []:
        if isinstance(s, dict) and s.get("label"):
            labels.append(str(s["label"])[:120])
    summary = context.get("context_summary") or {}
    if summary.get("financials_mtd"):
        labels.append("ERP financials MTD")
    if context.get("forecast_pack"):
        labels.append("Forecast engine")
    if context.get("external_knowledge"):
        labels.append("Industry benchmarks")
    return labels[:12]
