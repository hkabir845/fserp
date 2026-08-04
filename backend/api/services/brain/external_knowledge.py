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


def build_worldfish_species_pack(message: str = "") -> dict[str, Any]:
    """Reference pack so Brain answers species questions from WorldFish/FAO + web."""
    return {
        "mode": "fish_species_research",
        "instruction_bn": (
            "এই প্রশ্ন মাছ/চিংড়ির প্রজাতি সম্পর্কিত। WorldFish, FAO ও ওয়েব গবেষণা দিয়ে উত্তর দিন — "
            "শুধু ERP পোন্ড ডেটায় সীমাবদ্ধ থাকবেন না। বাংলাদেশ/দক্ষিণ এশিয়া চাষ প্রেক্ষাপট যোগ করুন। "
            "কোম্পানির পোন্ডে সেই প্রজাতি থাকলে ERP সংখ্যা আলাদা লেবেল করুন।"
        ),
        "user_question": (message or "")[:500],
        "primary_sources": [
            {
                "label": "WorldFish",
                "url": "https://www.worldfishcenter.org/",
                "kind": "web",
            },
            {
                "label": "WorldFish Digital Archive",
                "url": "https://digitalarchive.worldfishcenter.org/",
                "kind": "web",
            },
            {
                "label": "FAO Aquaculture / Fisheries",
                "url": "https://www.fao.org/fishery/en",
                "kind": "web",
            },
            {
                "label": "FAO FishStat / species fact sheets",
                "url": "https://www.fao.org/fishery/en/collection/culturespecies",
                "kind": "web",
            },
        ],
        "answer_topics_bn": [
            "প্রজাতির পরিচিতি ও বৈজ্ঞানিক নাম",
            "চাষ পদ্ধতি (নার্সারি → গ্রো-আউট)",
            "স্টকিং ঘনত্ব / পানির মান / তাপমাত্রা",
            "ফিড ও আনুমানিক FCR (WorldFish/FAO রেঞ্জ)",
            "সাধারণ রোগ ও প্রতিরোধ",
            "বাংলাদেশে বাজার/চাষ প্রাসঙ্গিকতা",
        ],
        "disclaimer_bn": (
            "WorldFish/FAO/ওয়েব রেফারেন্স সাধারণ জ্ঞান — আপনার পোন্ডের ERP সংখ্যা আলাদা এবং authoritative।"
        ),
    }


def build_external_comparison_context(
    company_id: int,
    *,
    intents: list[str] | None = None,
    include_web_note: bool = True,
    message: str = "",
) -> dict[str, Any]:
    """
    Separate external/general knowledge from internal ERP data.
    Used in LLM payload as EXTERNAL_KNOWLEDGE block.
    """
    intent_set = set(intents or [])
    snap = analytics.build_company_knowledge_snapshot(company_id)
    brief = build_decision_brief(snap or {}, message="")
    benchmark_notes = global_benchmark_notes(intent_set)
    tags = list(intent_set)[:5] if intent_set else None
    if "fish_species" in intent_set:
        tags = list({*(tags or []), "fish", "aquaculture", "worldfish", "species"})
    sources = fetch_knowledge_sources(tags=tags)

    web_note = ""
    if include_web_note:
        web_note = (
            "External comparison may use training knowledge and (on Growth/Enterprise) live web research. "
            "Clearly label external vs internal ERP figures. Cite source_url when available."
        )
        if "fish_species" in intent_set:
            web_note = (
                "FISH SPECIES question: use WorldFish + FAO + live web research for the named species. "
                "Cite WorldFish/FAO/web URLs (kind=web). Label ERP pond figures separately if present."
            )

    out: dict[str, Any] = {
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
    if "fish_species" in intent_set:
        out["worldfish_species_pack"] = build_worldfish_species_pack(message)
    return out
