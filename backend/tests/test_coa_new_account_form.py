"""
New Account form behaviour, modelled on the QuickBooks account dialog.

Covers the three things that dialog does beyond a plain create: examples to pick a name from,
"Subaccount of" with same-type parents only, and an account code the user never has to type.
"""
from __future__ import annotations

import json

import pytest

from api.models import ChartOfAccount


def _headers(auth_super_headers, company_master):
    from tests.test_api_production_audit import _audit_master_headers

    return _audit_master_headers(auth_super_headers, company_master)


# ------------------------------------------------------------- select from examples


@pytest.mark.django_db
def test_examples_are_listed_for_the_selected_account_type(
    api_client, auth_super_headers, company_master
):
    h = _headers(auth_super_headers, company_master)
    r = api_client.get("/api/chart-of-accounts/examples/", {"account_type": "expense"}, **h)
    assert r.status_code == 200, r.content.decode()
    body = json.loads(r.content.decode())

    assert body["account_type"] == "expense"
    assert body["examples"], "expense should offer example accounts"
    for ex in body["examples"]:
        assert {"account_code", "account_name", "account_sub_type", "description", "already_in_chart"} <= set(ex)
    names = [e["account_name"] for e in body["examples"]]
    assert any("Salaries" in n or "Wages" in n for n in names), names


@pytest.mark.django_db
def test_examples_are_scoped_to_the_type_asked_for(api_client, auth_super_headers, company_master):
    """Picking Income must not offer expense accounts - that is the whole point of the filter."""
    h = _headers(auth_super_headers, company_master)
    income = json.loads(
        api_client.get("/api/chart-of-accounts/examples/", {"account_type": "income"}, **h).content
    )
    expense = json.loads(
        api_client.get("/api/chart-of-accounts/examples/", {"account_type": "expense"}, **h).content
    )
    income_names = {e["account_name"] for e in income["examples"]}
    expense_names = {e["account_name"] for e in expense["examples"]}
    assert income_names and expense_names
    assert not (income_names & expense_names)


@pytest.mark.django_db
def test_examples_flag_accounts_the_company_already_has(
    api_client, auth_super_headers, company_master
):
    h = _headers(auth_super_headers, company_master)
    ChartOfAccount.objects.create(
        company_id=company_master.id,
        account_code="6400",
        account_name="Salaries & Wages",
        account_type="expense",
        is_active=True,
    )
    body = json.loads(
        api_client.get("/api/chart-of-accounts/examples/", {"account_type": "expense"}, **h).content
    )
    by_code = {e["account_code"]: e for e in body["examples"]}
    assert by_code["6400"]["already_in_chart"] is True
    assert any(e["already_in_chart"] is False for e in body["examples"])


@pytest.mark.django_db
def test_examples_reject_an_unknown_account_type(api_client, auth_super_headers, company_master):
    h = _headers(auth_super_headers, company_master)
    r = api_client.get("/api/chart-of-accounts/examples/", {"account_type": "nonsense"}, **h)
    assert r.status_code == 400
    assert "Invalid account_type" in json.loads(r.content.decode())["detail"]


# ------------------------------------------------------------- automatic account code


@pytest.mark.django_db
def test_account_code_is_assigned_when_the_form_does_not_send_one(
    api_client, auth_super_headers, company_master
):
    """The QuickBooks dialog has no account-number field; the GL still needs a code."""
    h = _headers(auth_super_headers, company_master)
    r = api_client.post(
        "/api/chart-of-accounts/",
        data=json.dumps(
            {
                "account_name": "Pond Aerator Depreciation",
                "account_type": "expense",
                "account_sub_type": "other_business_expenses",
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    body = json.loads(r.content.decode())
    code = body["account_code"]
    assert code, "an account code must be assigned"
    # Expense band, above the seeded template range so AUTO-* lookups are never shadowed.
    assert code.isdigit() and 6900 <= int(code) <= 6999, code


@pytest.mark.django_db
def test_assigned_codes_do_not_collide_with_built_in_template_codes(
    api_client, auth_super_headers, company_master
):
    from api.chart_templates.fuel_station import get_fuel_station_rows

    h = _headers(auth_super_headers, company_master)
    template_codes = {r["account_code"] for r in get_fuel_station_rows("full")}
    made = []
    for i in range(5):
        r = api_client.post(
            "/api/chart-of-accounts/",
            data=json.dumps({"account_name": f"Auto Expense {i}", "account_type": "expense"}),
            content_type="application/json",
            **h,
        )
        assert r.status_code == 201, r.content.decode()
        made.append(json.loads(r.content.decode())["account_code"])
    assert len(set(made)) == 5, made
    assert not (set(made) & template_codes)


@pytest.mark.django_db
def test_a_typed_account_code_is_still_respected(api_client, auth_super_headers, company_master):
    h = _headers(auth_super_headers, company_master)
    r = api_client.post(
        "/api/chart-of-accounts/",
        data=json.dumps(
            {"account_code": "6777", "account_name": "Chosen Code", "account_type": "expense"}
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    assert json.loads(r.content.decode())["account_code"] == "6777"


# ------------------------------------------------------------- subaccount of


@pytest.mark.django_db
def test_subaccount_of_a_same_type_parent_is_accepted(
    api_client, auth_super_headers, company_master
):
    h = _headers(auth_super_headers, company_master)
    parent = ChartOfAccount.objects.create(
        company_id=company_master.id,
        account_code="6800",
        account_name="Depreciation Expense",
        account_type="expense",
        is_active=True,
    )
    r = api_client.post(
        "/api/chart-of-accounts/",
        data=json.dumps(
            {
                "account_name": "Vehicle Depreciation",
                "account_type": "expense",
                "parent_account_id": parent.id,
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    assert json.loads(r.content.decode())["parent_account_id"] == parent.id


@pytest.mark.django_db
def test_subaccount_of_a_different_type_parent_is_rejected(
    api_client, auth_super_headers, company_master
):
    """A child rolls up into its parent, so a cross-type parent would misplace the balance."""
    h = _headers(auth_super_headers, company_master)
    income_parent = ChartOfAccount.objects.create(
        company_id=company_master.id,
        account_code="4900",
        account_name="Other Income",
        account_type="income",
        is_active=True,
    )
    r = api_client.post(
        "/api/chart-of-accounts/",
        data=json.dumps(
            {
                "account_name": "Bad Child",
                "account_type": "expense",
                "parent_account_id": income_parent.id,
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 400
    assert "same account type" in json.loads(r.content.decode())["detail"]


@pytest.mark.django_db
def test_an_account_cannot_be_its_own_parent(api_client, auth_super_headers, company_master):
    h = _headers(auth_super_headers, company_master)
    acc = ChartOfAccount.objects.create(
        company_id=company_master.id,
        account_code="6810",
        account_name="Self Parent",
        account_type="expense",
        is_active=True,
    )
    r = api_client.put(
        f"/api/chart-of-accounts/{acc.id}/",
        data=json.dumps({"parent_account_id": acc.id}),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 400
    assert "subaccount of itself" in json.loads(r.content.decode())["detail"]


@pytest.mark.django_db
def test_subaccount_cycles_are_rejected(api_client, auth_super_headers, company_master):
    h = _headers(auth_super_headers, company_master)
    cid = company_master.id
    top = ChartOfAccount.objects.create(
        company_id=cid, account_code="6820", account_name="Top", account_type="expense", is_active=True
    )
    child = ChartOfAccount.objects.create(
        company_id=cid,
        account_code="6821",
        account_name="Child",
        account_type="expense",
        parent_id=top.id,
        is_active=True,
    )
    # Making the top a subaccount of its own child would close the loop.
    r = api_client.put(
        f"/api/chart-of-accounts/{top.id}/",
        data=json.dumps({"parent_account_id": child.id}),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 400
    assert "already a subaccount" in json.loads(r.content.decode())["detail"]


@pytest.mark.django_db
def test_parent_from_another_company_is_rejected(
    api_client, auth_super_headers, company_master, company_tenant
):
    h = _headers(auth_super_headers, company_master)
    foreign = ChartOfAccount.objects.create(
        company_id=company_tenant.id,
        account_code="6830",
        account_name="Foreign Parent",
        account_type="expense",
        is_active=True,
    )
    r = api_client.post(
        "/api/chart-of-accounts/",
        data=json.dumps(
            {
                "account_name": "Cross Tenant Child",
                "account_type": "expense",
                "parent_account_id": foreign.id,
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 400
    assert "this company" in json.loads(r.content.decode())["detail"]


# ------------------------------------------------------------- optional description / note


@pytest.mark.django_db
def test_description_and_note_round_trip(api_client, auth_super_headers, company_master):
    h = _headers(auth_super_headers, company_master)
    r = api_client.post(
        "/api/chart-of-accounts/",
        data=json.dumps(
            {
                "account_name": "Noted Account",
                "account_type": "expense",
                "description": "Depreciation on delivery vehicles.",
                "note": "Reviewed with the auditor in March.",
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    created = json.loads(r.content.decode())
    assert created["description"] == "Depreciation on delivery vehicles."
    assert created["note"] == "Reviewed with the auditor in March."

    r2 = api_client.put(
        f"/api/chart-of-accounts/{created['id']}/",
        data=json.dumps({"note": "Updated note"}),
        content_type="application/json",
        **h,
    )
    assert r2.status_code == 200, r2.content.decode()
    assert json.loads(r2.content.decode())["note"] == "Updated note"
