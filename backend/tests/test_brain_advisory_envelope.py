"""Tests for optional Brain advisory envelope."""
from __future__ import annotations

from api.services.brain.advisory_envelope import (
    build_advisory_appendix,
    enrich_structured_reply,
    merge_advisory_into_answer,
    should_attach_advisory,
)


def test_should_skip_greeting_and_plain_factual():
    assert not should_attach_advisory({"intents": ["greeting"]})
    assert not should_attach_advisory({"intents": ["profit", "sales"], "user_question": "profit koto"})
    assert should_attach_advisory(
        {
            "intents": ["profit"],
            "user_question": "profit er sathe industry compare koro",
            "user_wants_advisory": True,
        }
    )


def test_build_advisory_appendix_has_required_sections():
    ctx = {
        "intents": ["fcr", "density"],
        "user_wants_advisory": True,
        "decision_brief": {
            "comparisons": [{"insight_bn": "FCR 1.8 — WorldFish সীমার উপরে"}],
            "risk_flags": [{"message_bn": "ঘনত্ব বেশি"}],
            "projections": [{"label_bn": "অনুমানিত মাস শেষ বিক্রি", "value_bdt": "100,000", "method_bn": "run-rate"}],
            "decision_options": [{"label_bn": "আংশিক হারভেস্ট করুন"}],
            "disclaimer_bn": "নির্দেশনামূলক।",
        },
    }
    appendix = build_advisory_appendix(ctx)
    assert "### বিশ্ব/গ্লোবাল তুলনা" in appendix
    assert "### সুপারিশ ও পরামর্শ" in appendix
    assert "### ⚠️ সতর্কতা" in appendix
    assert "পূর্বাভাস" in appendix


def test_merge_advisory_skips_duplicate():
    answer = "### সারাংশ\n\nউত্তর\n\n### বিশ্ব/গ্লোবাল তুলনা\n\n- test"
    appendix = "### বিশ্ব/গ্লোবাল তুলনা\n\n- dup\n\n### সুপারিশ ও পরামর্শ\n\n- rec"
    merged = merge_advisory_into_answer(answer, appendix)
    assert merged.count("### বিশ্ব/গ্লোবাল তুলনা") == 1
    assert "### সুপারিশ ও পরামর্শ" in merged


def test_enrich_structured_reply_only_when_requested():
    ctx = {
        "intents": ["profit"],
        "user_question": "profit koto",
        "business_snapshot": {"financials_mtd": {"company_total": {"net_income": "5000"}}},
    }
    out = enrich_structured_reply(
        {"answer_bn": "### সারাংশ\n\nলাভ ভালো", "suggested_actions": [{"action": "x"}]},
        ctx,
    )
    assert "বিশ্ব" not in out["answer_bn"] and "গ্লোবাল" not in out["answer_bn"]
    assert out.get("suggested_actions") == []

    ctx_adv = {
        **ctx,
        "user_question": "profit compare with industry and recommend",
        "user_wants_advisory": True,
    }
    out_adv = enrich_structured_reply({"answer_bn": "### সারাংশ\n\nলাভ ভালো"}, ctx_adv)
    assert "বিশ্ব" in out_adv["answer_bn"] or "গ্লোবাল" in out_adv["answer_bn"]
