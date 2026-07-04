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
    assert snap.get("erp_modules")
    assert snap["erp_modules"].get("module_index")
    assert "sales_customers_ar" in snap["erp_modules"]


@pytest.mark.django_db
def test_build_erp_module_summaries(company_master):
    from api.services.brain.module_analytics import build_erp_module_summaries

    mods = build_erp_module_summaries(company_master.id)
    assert mods.get("module_index")
    assert "payments_cash" in mods
    assert "inventory_stock" in mods
    assert mods["payments_cash"].get("mtd_received_bdt") is not None


@pytest.mark.django_db
def test_detect_intents_customer_and_inventory():
    assert "customer_ar" in detect_intents("কোন গ্রাহকের বকেয়া বেশি?")
    assert "inventory" in detect_intents("low stock item ache ki?")
    assert "fuel" in detect_intents("ট্যাংকে ডিজেল কত আছে?")


def test_is_employee_list_request():
    from api.services.brain.list_requests import detect_list_module, is_employee_list_request

    assert is_employee_list_request("list my all employees their names and salary")
    assert detect_list_module("সব কর্মচারীর নাম ও বেতন দাও") == "employees"
    assert detect_list_module("list all customers") == "customers"
    assert detect_list_module("সব পোন্ডের তালিকা দাও") == "ponds"
    assert detect_list_module("show all tanks") == "tanks"
    assert not detect_list_module("Karim er bheton koto?")


@pytest.mark.django_db
def test_build_decision_brief(company_master):
    from api.services.brain.analytics import build_company_knowledge_snapshot
    from api.services.brain.decision_intelligence import build_decision_brief

    snap = build_company_knowledge_snapshot(company_master.id, lang="bn")
    brief = build_decision_brief(snap, message="compare my business with world standard")
    assert brief.get("benchmarks_reference")
    assert "comparisons" in brief
    assert "projections" in brief
    assert "decision_options" in brief
    assert brief.get("disclaimer_bn")


def test_wants_benchmark_or_decision_research():
    from api.services.brain.intents import wants_benchmark_or_decision_research

    assert wants_benchmark_or_decision_research("compare my FCR with world standard")
    assert wants_benchmark_or_decision_research("আগামী মাসে কি হবে predict koro")
    assert "benchmark" in detect_intents("should I cut staff? recommend decision")


@pytest.mark.django_db
def test_module_list_customers(company_master):
    from api.services.brain.module_lists import fetch_module_list

    data = fetch_module_list(company_master.id, "customers", limit=50)
    assert data.get("module") == "customers"
    assert "rows" in data


@pytest.mark.django_db
def test_gather_context_includes_decision_brief(company_master):
    ctx, _ = gather_context(
        company_master.id, "compare my profit with industry standard and predict next month"
    )
    assert ctx.get("decision_brief")
    assert ctx.get("advisory_mode")


@pytest.mark.django_db
def test_employee_list_direct_answer(company_master):
    from api.models import Employee
    from api.services.brain.direct_answer import compose_direct_answer

    cid = company_master.id
    if not Employee.objects.filter(company_id=cid, is_active=True).exists():
        pytest.skip("No employees in test company")
    ctx, _ = gather_context(cid, "list my all employees their names and salary")
    ctx["user_question"] = "list my all employees their names and salary"
    ans = compose_direct_answer(ctx)
    assert ans is not None
    assert "কর্মচারী তালিকা" in ans["answer_bn"]
    assert "৳" in ans["answer_bn"]


@pytest.mark.django_db
def test_gather_context_includes_full_snapshot(company_master):
    ctx, refs = gather_context(company_master.id, "আমার ব্যবসা কেমন চলছে?")
    assert "business_snapshot" in ctx
    assert ctx["business_snapshot"].get("financials_mtd")
    assert refs


@pytest.mark.django_db
def test_direct_answer_list_intents_with_pond(company_master):
    """intents are stored as list in context — must not crash set & list."""
    cid = company_master.id
    from api.models import AquaculturePond

    pond = AquaculturePond.objects.filter(company_id=cid, is_active=True).first()
    if not pond:
        pytest.skip("No pond")
    ctx, _ = gather_context(
        cid,
        f"পোন্ড {pond.name} FCR কত?",
        context_entity_type="pond",
        context_entity_id=pond.id,
    )
    assert isinstance(ctx.get("intents"), list)
    ans = compose_direct_answer(ctx)
    assert ans is not None
    assert ans.get("answer_bn")


@pytest.mark.django_db
def test_workforce_analysis_returns_advisory(company_master):
    out = workforce_retention_analysis(company_master.id, lang="bn")
    assert "release_candidates_advisory" in out
    assert "disclaimer_bn" in out
