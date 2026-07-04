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


def test_detect_intents_biomass_and_market_value():
    intents = detect_intents("সব পোন্ডের মোট বায়োমাস ও গড় বিক্রয় দরে আনুমানিক মূল্য কত?")
    assert "biomass" in intents
    assert "density" in intents or "pond" in intents


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
    ctx, refs = gather_context(company_master.id, "profit koto this month")
    assert "business_snapshot" in ctx
    assert ctx["business_snapshot"].get("financials_mtd")
    assert refs


@pytest.mark.django_db
def test_gather_context_general_uses_light_snapshot(company_master):
    ctx, _ = gather_context(company_master.id, "আমার ব্যবসা কেমন চলছে?")
    snap = ctx["business_snapshot"]
    assert snap.get("light_mode") is True
    assert "company" in ctx or ctx.get("company")


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


def test_question_resolver_partial_module_match():
    from api.services.brain.question_resolver import match_modules_in_message

    assert "customers" in match_modules_in_message("bokewa grahok ke ke?")
    assert "invoices" in match_modules_in_message("ajker bikri koto")
    assert "ponds" in match_modules_in_message("pukur er obostha")


def test_boost_intents_from_partial_module():
    from api.services.brain.question_resolver import boost_intents_from_modules

    intents = boost_intents_from_modules("grahok er due", {"chat"})
    assert "customer_ar" in intents


def test_build_question_focus_scoped():
    from api.services.brain.question_resolver import build_question_focus

    focus = build_question_focus("profit koto", {"profit"})
    assert focus["answer_scope"] == "focused"
    assert focus["include_related_context"] is False


def test_detect_list_module_aquaculture_modules():
    from api.services.brain.list_requests import detect_list_module

    assert detect_list_module("list all pond stock items") == "pond_stock"
    assert detect_list_module("সব ঔষধের তালিকা দাও") == "aquaculture_medicine"
    assert detect_list_module("show aquaculture financing loans") == "aquaculture_financing"


@pytest.mark.django_db
def test_direct_answer_customer_ar_offline(company_master):
    from api.services.brain.direct_answer import compose_direct_answer

    ctx, _ = gather_context(company_master.id, "কোন গ্রাহকের বকেয়া বেশি?")
    ctx["user_question"] = "কোন গ্রাহকের বকেয়া বেশি?"
    ans = compose_direct_answer(ctx)
    assert ans is not None
    assert ans.get("answer_bn")
    assert "গ্রাহক" in ans["answer_bn"] or "বকেয়া" in ans["answer_bn"]


@pytest.mark.django_db
def test_direct_answer_inventory_offline(company_master):
    from api.services.brain.direct_answer import compose_direct_answer

    ctx, _ = gather_context(company_master.id, "low stock item ache ki?")
    ctx["user_question"] = "low stock item ache ki?"
    ans = compose_direct_answer(ctx)
    assert ans is not None
    assert "ইনভেন্টরি" in ans["answer_bn"] or "স্টক" in ans["answer_bn"]


def test_is_conversational_turn():
    from api.services.brain.intents import is_conversational_turn

    assert is_conversational_turn({"chat"})
    assert is_conversational_turn({"general"})
    assert is_conversational_turn({"chat", "general"})
    assert is_conversational_turn({"pond"})
    assert not is_conversational_turn({"greeting"})
    assert not is_conversational_turn({"profit"})
    assert not is_conversational_turn({"chat", "profit"})
    assert not is_conversational_turn({"sales"})


def test_wants_breakdown():
    from api.services.brain.question_resolver import wants_breakdown

    assert wants_breakdown("station wise profit dao")
    assert not wants_breakdown("profit koto")


def test_is_help_or_howto():
    from api.services.brain.question_resolver import is_help_or_howto_question

    assert is_help_or_howto_question("FCR kivabe komabo?")
    assert is_help_or_howto_question("how to reduce pond density")
    assert not is_help_or_howto_question("profit koto")


@pytest.mark.django_db
def test_all_ponds_summary_includes_biomass_market_totals(company_tenant):
    from datetime import date
    from decimal import Decimal

    from api.models import AquacultureFishSale, AquaculturePond
    from api.services.brain.analytics import all_ponds_summary
    from api.services.aquaculture_sale_reference_service import company_average_fish_sale_price_per_kg

    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="BioPond", is_active=True)
    AquacultureFishSale.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        fish_species="tilapia",
        sale_date=date.today(),
        weight_kg=Decimal("100"),
        fish_count=5000,
        total_amount=Decimal("25000"),
        income_type="fish_harvest_sale",
    )
    avg = company_average_fish_sale_price_per_kg(company_tenant.id)
    assert avg is not None
    assert float(avg["price_per_kg"]) == pytest.approx(250.0)

    summary = all_ponds_summary(company_tenant.id, lang="bn")
    assert summary.get("company_average_sale_price_per_kg") == "250.00"
    assert summary.get("totals", {}).get("pond_count", 0) >= 1
    assert "total_biomass_kg" in summary.get("totals", {})


@pytest.mark.django_db
def test_direct_answer_biomass_all_ponds(company_tenant):
    from datetime import date
    from decimal import Decimal

    from api.models import AquacultureFishSale, AquaculturePond

    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="ValPond", is_active=True)
    AquacultureFishSale.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        fish_species="tilapia",
        sale_date=date.today(),
        weight_kg=Decimal("50"),
        fish_count=2000,
        total_amount=Decimal("15000"),
        income_type="fish_harvest_sale",
    )
    ctx, _ = gather_context(company_tenant.id, "সব পোন্ডের মোট বায়োমাস ও আনুমানিক বাজার মূল্য কত?")
    ans = compose_direct_answer(ctx)
    assert ans is not None
    assert "বায়োমাস" in ans["answer_bn"] or "পোন্ড" in ans["answer_bn"]


@pytest.mark.django_db
def test_worldfish_gap_audit_missing_water_area(company_tenant):
    from api.models import AquaculturePond
    from api.services.brain.worldfish_gap_audit import build_worldfish_gap_audit, wants_worldfish_gap_audit

    AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="NoArea",
        is_active=True,
        water_area_decimal=None,
    )
    assert wants_worldfish_gap_audit("WorldFish gap audit koro")
    audit = build_worldfish_gap_audit(company_tenant.id)
    assert audit.get("gap_count", 0) >= 1
    codes = [g.get("code") for g in audit.get("gaps") or []]
    assert "missing_water_area" in codes
    fixes = audit.get("fixes") or []
    assert any(f.get("erp_path") == "/aquaculture/ponds" for f in fixes)


@pytest.mark.django_db
def test_gather_context_worldfish_audit(company_tenant):
    from api.models import AquaculturePond

    AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="GapPond",
        is_active=True,
    )
    ctx, _ = gather_context(company_tenant.id, "WorldFish standard onujayi gap gulo fix koro")
    assert "worldfish_gap_audit" in ctx
    assert ctx["worldfish_gap_audit"].get("gaps")
    assert ctx.get("suggested_actions")
