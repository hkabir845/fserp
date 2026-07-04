"""External knowledge comparison — industry benchmarks + curated knowledge sources."""
from __future__ import annotations

from typing import Any

from api.models import BrainKnowledgeSource
from api.services.brain import analytics
from api.services.brain.advisory_envelope import global_benchmark_notes
from api.services.brain.decision_intelligence import INDUSTRY_BENCHMARKS, build_decision_brief


def fetch_knowledge_sources(*, tags: list[str] | None = None, limit: int = 8) -> list[dict[str, Any]]:
    qs = BrainKnowledgeSource.objects.filter(is_active=True)
    if tags:
        # Simple tag filter — JSON contains any tag
        ids = []
        for row in qs[:50]:
            row_tags = set(row.tags or [])
            if row_tags & set(tags):
                ids.append(row.id)
        qs = qs.filter(pk__in=ids) if ids else qs.none()
    return [
        {
            "slug": r.slug,
            "title": r.title,
            "category": r.category,
            "content_bn": (r.content_bn or "")[:2000],
            "source_url": r.source_url,
            "kind": "knowledge_base",
        }
        for r in qs[:limit]
    ]


def build_external_comparison_context(
    company_id: int,
    *,
    intents: list[str] | None = None,
    include_web_note: bool = True,
) -> dict[str, Any]:
    """
    Separate external/general knowledge from internal ERP data.
    Used in LLM payload as EXTERNAL_KNOWLEDGE block.
    """
    intent_set = set(intents or [])
    snap = analytics.build_company_knowledge_snapshot(company_id)
    brief = build_decision_brief(snap or {}, message="")
    benchmark_notes = global_benchmark_notes(intent_set)
    sources = fetch_knowledge_sources(
        tags=list(intent_set)[:5] if intent_set else None,
    )

    web_note = ""
    if include_web_note:
        web_note = (
            "External comparison may use training knowledge and (on Growth/Enterprise) live web research. "
            "Clearly label external vs internal ERP figures. Cite source_url when available."
        )

    return {
        "industry_benchmarks": {
            k: {
                "label_bn": v.get("label_bn"),
                "note_bn": v.get("note_bn"),
                "source": v.get("source"),
            }
            for k, v in list(INDUSTRY_BENCHMARKS.items())[:12]
        },
        "erp_vs_industry": (brief.get("comparisons") or [])[:10],
        "benchmark_notes_bn": benchmark_notes,
        "curated_sources": sources,
        "web_research_enabled": include_web_note,
        "web_note": web_note,
        "disclaimer_bn": (
            "বাইরের তুলনা সাধারণ industry best practice — আপনার কোম্পানির ERP সংখ্যা authoritative।"
        ),
    }
