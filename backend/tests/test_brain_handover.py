"""Brain onboarding, handover, and owner-concern routing."""
from __future__ import annotations

import pytest

from api.models import Employee, EmployeeHandoverProfile
from api.services.brain.handover import build_erp_activity_summary, generate_handover_profile
from api.services.brain.intents import is_new_in_role_question, is_owner_concern_question
from api.services.brain.question_router import TYPE_ADVISORY, TYPE_ONBOARDING, classify_question, route_question


def test_is_new_in_role_question():
    assert is_new_in_role_question("I am new in this role — catch me up")
    assert is_new_in_role_question("handover from previous pond supervisor")


def test_is_owner_concern_question():
    assert is_owner_concern_question("I am worried about my business")
    assert is_owner_concern_question("amader business bachate ki korbo")


def test_classify_onboarding_before_conversational():
    assert classify_question("hello there") != TYPE_ONBOARDING
    assert classify_question("I am new in this role") == TYPE_ONBOARDING
    assert classify_question("I am worried about my business") == TYPE_ADVISORY


def test_route_onboarding_includes_advisory():
    route = route_question("I am new in this role — catch me up", plan="growth")
    assert route.question_type == TYPE_ONBOARDING
    assert route.include_advisory is True
    assert route.model_role == "research"


@pytest.mark.django_db
def test_generate_handover_profile(company_master):
    emp = Employee.objects.create(
        company_id=company_master.id,
        first_name="Karim",
        last_name="Uddin",
        job_title="Pond Supervisor",
        department="Aquaculture",
        email="karim@example.com",
    )
    profile = generate_handover_profile(emp, handover_notes_bn="Main contact: supplier X")
    assert profile.status == EmployeeHandoverProfile.STATUS_PUBLISHED
    assert profile.job_title_snapshot == "Pond Supervisor"
    assert profile.erp_activity_summary.get("period_days") == 90
    assert EmployeeHandoverProfile.objects.filter(company_id=company_master.id).count() == 1


@pytest.mark.django_db
def test_brain_handover_api(api_client, auth_admin_headers, company_tenant):
    emp = Employee.objects.create(
        company_id=company_tenant.id,
        first_name="Rahim",
        job_title="Accountant",
    )
    h = {**auth_admin_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_tenant.id)}
    r = api_client.post(
        "/api/brain/handover/",
        {"employee_id": emp.id, "handover_notes_bn": "Month-end checklist in Drive"},
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201
    data = r.json()
    assert data["employee_id"] == emp.id
    assert data["job_title"] == "Accountant"

    listing = api_client.get("/api/brain/handover/", **h)
    assert listing.status_code == 200
    assert len(listing.json()["results"]) >= 1


@pytest.mark.django_db
def test_build_activity_summary_no_linked_user(company_master):
    emp = Employee.objects.create(
        company_id=company_master.id,
        first_name="No",
        last_name="Login",
        job_title="Helper",
    )
    summary = build_erp_activity_summary(emp)
    assert summary["linked_user_ids"] == []
    assert summary["brain_conversations"] == 0
