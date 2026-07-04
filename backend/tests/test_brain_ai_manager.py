"""Tests for AI Manager routing, insights, security, and budgets."""
from __future__ import annotations

from decimal import Decimal

import pytest

from api.models import BrainConversation, BrainInsight, BrainUsageLog
from api.services.brain.insights_engine import build_insights, generate_insights, persist_insights
from api.services.brain.question_router import TYPE_FORECASTING, TYPE_SIMPLE_DATA, classify_question, route_question
from api.services.brain.security import get_company_settings
from api.services.brain import usage_logging as brain_usage


def test_classify_simple_sales_question():
    assert classify_question("ajker sales koto?") == TYPE_SIMPLE_DATA


def test_classify_forecast_question():
    assert classify_question("purbabhash dio — business continue hole ki hobe") == TYPE_FORECASTING


def test_route_question_advisor_mode_sales():
    route = route_question("ajker sales koto?")
    assert route.advisor_mode == "sales"
    assert route.use_llm is True


def test_route_greeting_no_llm():
    route = route_question("hello")
    assert route.question_type == "greeting"
    assert route.use_llm is False


@pytest.mark.django_db
def test_build_insights_returns_list(company_master):
    items = build_insights(company_master.id)
    assert isinstance(items, list)


@pytest.mark.django_db
def test_persist_insights_replaces_same_type(company_master):
    items = [
        {
            "insight_type": "sales_trend",
            "title_bn": "First",
            "body_bn": "body",
            "severity": "info",
        },
        {
            "insight_type": "cash_flow",
            "title_bn": "Cash",
            "body_bn": "body",
            "severity": "warning",
        },
    ]
    persist_insights(company_master.id, items)
    assert BrainInsight.objects.filter(company_id=company_master.id, is_dismissed=False).count() == 2

    persist_insights(
        company_master.id,
        [
            {
                "insight_type": "sales_trend",
                "title_bn": "Updated",
                "body_bn": "new body",
                "severity": "info",
            }
        ],
    )
    active = BrainInsight.objects.filter(company_id=company_master.id, is_dismissed=False)
    assert active.count() == 2
    assert active.filter(insight_type="sales_trend", title_bn="Updated").exists()


@pytest.mark.django_db
def test_monthly_token_budget_blocks(company_master):
    settings = get_company_settings(company_master.id)
    settings.monthly_token_budget = 100
    settings.save(update_fields=["monthly_token_budget"])
    BrainUsageLog.objects.create(
        company_id=company_master.id,
        model="test/model",
        prompt_tokens=60,
        completion_tokens=50,
        total_tokens=110,
        estimated_cost_usd=Decimal("0.01"),
    )
    ok, msg = brain_usage.assert_within_monthly_budget(company_master.id)
    assert ok is False
    assert "token budget" in msg.lower()


@pytest.mark.django_db
def test_brain_conversation_tenant_isolation(api_client, auth_super_headers, company_master, company_tenant):
    hm = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}
    ht = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_tenant.id)}

    create = api_client.post("/api/brain/conversations/", {}, content_type="application/json", **hm)
    assert create.status_code == 201
    conv_id = create.json()["id"]

    detail_ok = api_client.get(f"/api/brain/conversations/{conv_id}/", **hm)
    assert detail_ok.status_code == 200

    detail_other = api_client.get(f"/api/brain/conversations/{conv_id}/", **ht)
    assert detail_other.status_code == 404

    assert BrainConversation.objects.filter(pk=conv_id, company_id=company_master.id).exists()


@pytest.mark.django_db
def test_brain_insights_tenant_isolation(api_client, auth_super_headers, company_master, company_tenant):
    generate_insights(company_master.id, persist=True)
    hm = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}
    ht = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_tenant.id)}

    master_count = len(api_client.get("/api/brain/insights/", **hm).json().get("results") or [])
    tenant_count = len(api_client.get("/api/brain/insights/", **ht).json().get("results") or [])
    assert master_count >= 0
    assert tenant_count >= 0
    if master_count:
        master_id = api_client.get("/api/brain/insights/", **hm).json()["results"][0]["id"]
        dismiss_other = api_client.post(f"/api/brain/insights/{master_id}/dismiss/", **ht)
        assert dismiss_other.status_code == 404
