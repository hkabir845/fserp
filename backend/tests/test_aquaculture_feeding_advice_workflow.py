"""Feeding advice: revoke approval and cancel while approved (not applied)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.models import AquacultureFeedingAdvice, AquaculturePond, Company


def _enable_aq(c: Company) -> None:
    Company.objects.filter(pk=c.id).update(aquaculture_enabled=True, aquaculture_licensed=True)


@pytest.mark.django_db
def test_disapprove_approved_feeding_advice(api_client, company_tenant, auth_admin_headers):
    _enable_aq(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="P-wf", is_active=True)
    advice = AquacultureFeedingAdvice.objects.create(
        company_id=cid,
        pond=pond,
        target_date=date(2026, 5, 20),
        status=AquacultureFeedingAdvice.STATUS_APPROVED,
        ai_advice_text="Feed 10kg",
        suggested_feed_kg=Decimal("10.0000"),
        approved_advice_text="Feed 10kg",
    )

    r = api_client.post(
        f"/api/aquaculture/feeding-advice/{advice.id}/disapprove/",
        {},
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    data = r.json()
    assert data["status"] == AquacultureFeedingAdvice.STATUS_PENDING_REVIEW

    advice.refresh_from_db()
    assert advice.status == AquacultureFeedingAdvice.STATUS_PENDING_REVIEW
    assert advice.approved_at is None
    assert advice.approved_by_id is None
    assert advice.approved_advice_text == ""


@pytest.mark.django_db
def test_cancel_approved_feeding_advice(api_client, company_tenant, auth_admin_headers):
    _enable_aq(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="P-wf2", is_active=True)
    advice = AquacultureFeedingAdvice.objects.create(
        company_id=cid,
        pond=pond,
        target_date=date(2026, 5, 21),
        status=AquacultureFeedingAdvice.STATUS_APPROVED,
        ai_advice_text="Feed 5kg",
        suggested_feed_kg=Decimal("5.0000"),
        approved_advice_text="Feed 5kg",
    )

    r = api_client.post(
        f"/api/aquaculture/feeding-advice/{advice.id}/cancel/",
        {},
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    assert r.json()["status"] == AquacultureFeedingAdvice.STATUS_CANCELLED

    advice.refresh_from_db()
    assert advice.status == AquacultureFeedingAdvice.STATUS_CANCELLED
    assert advice.approved_at is None


@pytest.mark.django_db
def test_cancel_applied_feeding_advice_rejected(api_client, company_tenant, auth_admin_headers):
    _enable_aq(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="P-wf3", is_active=True)
    advice = AquacultureFeedingAdvice.objects.create(
        company_id=cid,
        pond=pond,
        target_date=date(2026, 5, 22),
        status=AquacultureFeedingAdvice.STATUS_APPLIED,
        ai_advice_text="Done",
        applied_feed_kg=Decimal("5.0000"),
    )

    r = api_client.post(
        f"/api/aquaculture/feeding-advice/{advice.id}/cancel/",
        {},
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 400
