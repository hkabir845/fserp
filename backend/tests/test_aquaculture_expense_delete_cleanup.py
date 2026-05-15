"""Aquaculture expense delete: cleanup rolls back stock/GL and keeps feeding advice state consistent."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.models import AquacultureExpense, AquacultureFeedingAdvice, AquaculturePond, Company


def _enable_aq(c: Company) -> None:
    Company.objects.filter(pk=c.id).update(aquaculture_enabled=True, aquaculture_licensed=True)


@pytest.mark.django_db
def test_delete_expense_reverts_linked_applied_feeding_advice(api_client, company_tenant, auth_admin_headers):
    _enable_aq(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="P-del", is_active=True)
    exp = AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_category="feed_consumed",
        expense_date=date(2026, 5, 10),
        amount=Decimal("100.00"),
        feed_weight_kg=Decimal("5.0000"),
        memo="from advice",
    )
    advice = AquacultureFeedingAdvice.objects.create(
        company_id=cid,
        pond=pond,
        target_date=date(2026, 5, 10),
        status=AquacultureFeedingAdvice.STATUS_APPLIED,
        ai_advice_text="apply 5kg",
        suggested_feed_kg=Decimal("5.0000"),
        applied_feed_kg=Decimal("5.0000"),
        linked_expense=exp,
    )

    r = api_client.delete(f"/api/aquaculture/expenses/{exp.id}/", **auth_admin_headers)
    assert r.status_code == 200, r.content.decode()

    assert not AquacultureExpense.objects.filter(pk=exp.id).exists()

    advice.refresh_from_db()
    assert advice.linked_expense_id is None
    assert advice.status == AquacultureFeedingAdvice.STATUS_APPROVED
    assert advice.applied_feed_kg is None
    assert advice.applied_at is None
    assert advice.applied_by_id is None
