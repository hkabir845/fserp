"""Malformed requests must fail cleanly before changing business records."""
import json

import pytest
from django.test import RequestFactory

from api.views.common import parse_json_body


@pytest.mark.parametrize("payload", [b'\xff', b'{', b'[]', b'null', b'42', b'"text"'])
def test_json_body_rejects_invalid_encoding_and_non_objects(payload):
    request = RequestFactory().post("/", data=payload, content_type="application/json")
    body, error = parse_json_body(request)
    assert body is None
    assert error.status_code == 400


@pytest.mark.parametrize("payload", [b'', b'{}', b'{"name":"Example"}'])
def test_json_body_accepts_objects_and_empty_requests(payload):
    request = RequestFactory().post("/", data=payload, content_type="application/json")
    body, error = parse_json_body(request)
    assert error is None
    assert body == (json.loads(payload) if payload else {})


@pytest.mark.django_db
@pytest.mark.parametrize("rate", ["bad", "NaN", "Infinity", "-1", "100.0001", None, ""])
def test_tax_rate_rejects_invalid_amounts(api_client, auth_admin_headers, company_tenant, rate):
    from api.models import Tax, TaxRate

    tax = Tax.objects.create(company=company_tenant, name="Test tax")
    response = api_client.post("/api/taxes/rates/", data=json.dumps({"tax_id": tax.id, "rate": rate}),
                               content_type="application/json", **auth_admin_headers)
    assert response.status_code == 400, response.content
    assert not TaxRate.objects.filter(tax=tax).exists()


@pytest.mark.django_db
@pytest.mark.parametrize("rate", ["0", "15.1250", "100"])
def test_tax_rate_accepts_full_ui_range(api_client, auth_admin_headers, company_tenant, rate):
    from decimal import Decimal
    from api.models import Tax, TaxRate

    tax = Tax.objects.create(company=company_tenant, name="Test tax")
    response = api_client.post("/api/taxes/rates/", data=json.dumps({"tax_id": tax.id, "rate": rate}),
                               content_type="application/json", **auth_admin_headers)
    assert response.status_code == 201, response.content
    assert TaxRate.objects.get(tax=tax).rate == Decimal(rate)


@pytest.mark.django_db
@pytest.mark.parametrize("dates", [
    {"effective_from": "not-a-date"},
    {"effective_to": "2026-02-30"},
    {"effective_from": "2026-09-12", "effective_to": "2026-09-11"},
])
def test_tax_rate_rejects_invalid_dates(api_client, auth_admin_headers, company_tenant, dates):
    from api.models import Tax, TaxRate

    tax = Tax.objects.create(company=company_tenant, name="Test tax")
    response = api_client.post("/api/taxes/rates/", data=json.dumps({"tax_id": tax.id, "rate": "15", **dates}),
                               content_type="application/json", **auth_admin_headers)
    assert response.status_code == 400, response.content
    assert not TaxRate.objects.filter(tax=tax).exists()


@pytest.mark.django_db
def test_tax_rate_rejects_invalid_and_foreign_tax_ids(api_client, auth_admin_headers, company_master):
    from api.models import Tax, TaxRate

    tax = Tax.objects.create(company=company_master, name="Other tenant tax")
    for tax_id in ("bad", [], True, 1.5, tax.id):
        response = api_client.post("/api/taxes/rates/", data=json.dumps({"tax_id": tax_id, "rate": "15"}),
                                   content_type="application/json", **auth_admin_headers)
        assert response.status_code == 400, response.content
    assert not TaxRate.objects.filter(tax=tax).exists()
