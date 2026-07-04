"""Brain analytics and direct answers — FCR, P&L, HR without reports."""
from __future__ import annotations

import pytest

from api.services.brain.analytics import pond_deep_analytics, workforce_retention_analysis
from api.services.brain.direct_answer import compose_direct_answer
from api.services.brain.intents import detect_intents
from api.services.brain.tools import gather_context


def test_detect_intents_fcr_and_density():
    intents = detect_intents("পোন্ড ২ এর FCR এবং ঘনত্ব কত?")
    assert "fcr" in intents
    assert "density" in intents
    assert "pond" in intents


def test_detect_intents_job_cut():
    intents = detect_intents("চাকরি কাটা উচিত কি? কাকে ছাড়ব?")
    assert "job_cut" in intents


@pytest.mark.django_db
def test_gather_context_pond_fcr(company_master):
    cid = company_master.id
    from api.models import AquaculturePond

    pond = AquaculturePond.objects.filter(company_id=cid, is_active=True).first()
    if not pond:
        pytest.skip("No pond in test company")
    ctx, refs = gather_context(cid, f"পোন্ড {pond.name} FCR কত?", context_entity_type="pond", context_entity_id=pond.id)
    assert "pond_analytics" in ctx
    assert ctx["pond_analytics"].get("fcr")
    assert refs


@pytest.mark.django_db
def test_direct_answer_fcr_offline(company_master):
    cid = company_master.id
    from api.models import AquaculturePond

    pond = AquaculturePond.objects.filter(company_id=cid, is_active=True).first()
    if not pond:
        pytest.skip("No pond")
    ctx, _ = gather_context(cid, f"FCR of pond {pond.id}", context_entity_type="pond", context_entity_id=pond.id)
    ans = compose_direct_answer(ctx)
    assert ans is not None
    assert ans.get("answer_bn")
    assert "FCR" in ans["answer_bn"] or "fcr" in ans["answer_bn"].lower()


@pytest.mark.django_db
def test_build_company_knowledge_snapshot(company_master):
    from api.services.brain.analytics import build_company_knowledge_snapshot

    snap = build_company_knowledge_snapshot(company_master.id, lang="bn")
    assert snap.get("financials_mtd")
    assert snap.get("sales_mtd")
    assert snap.get("record_counts")
    assert "active_stations" in snap["record_counts"]


@pytest.mark.django_db
def test_gather_context_includes_full_snapshot(company_master):
    ctx, refs = gather_context(company_master.id, "আমার ব্যবসা কেমন চলছে?")
    assert "business_snapshot" in ctx
    assert ctx["business_snapshot"].get("financials_mtd")
    assert refs


@pytest.mark.django_db
def test_workforce_analysis_returns_advisory(company_master):
    out = workforce_retention_analysis(company_master.id, lang="bn")
    assert "release_candidates_advisory" in out
    assert "disclaimer_bn" in out
