"""
Production-oriented API audit: auth, tenant headers, admin gates, core CRUD smoke tests.
Run: cd backend && pip install -r requirements-dev.txt && pytest
"""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest
from django.test import Client, override_settings


pytestmark = pytest.mark.django_db


# --- Infrastructure ---


def test_health(api_client: Client):
    r = api_client.get("/health/")
    assert r.status_code == 200
    data = json.loads(r.content)
    assert data["status"] == "healthy"
    assert data.get("backend") == "django"
    assert "version" in data and data["version"]


def test_version_endpoint(api_client: Client):
    r = api_client.get("/api/version/")
    assert r.status_code == 200
    data = json.loads(r.content)
    assert data.get("application") == "FSERP"
    assert "version" in data
    assert "time_utc" in data
    assert r.headers.get("X-Request-ID")


@override_settings(DEBUG=True)
def test_api_docs_stub(api_client: Client):
    r = api_client.get("/api/docs/")
    assert r.status_code == 200
    body = json.loads(r.content)
    assert "endpoints" in body


@override_settings(DEBUG=False)
def test_api_docs_not_exposed_when_debug_off(api_client: Client):
    r = api_client.get("/api/docs/")
    assert r.status_code == 404


# --- Auth ---


def test_login_invalid_password(api_client: Client, user_super):
    r = api_client.post(
        "/api/auth/login/",
        data=json.dumps({"username": user_super.username, "password": "wrong"}),
        content_type="application/json",
    )
    assert r.status_code == 401


def test_login_success_super(api_client: Client, user_super):
    r = api_client.post(
        "/api/auth/login/",
        data=json.dumps({"username": user_super.username, "password": "AuditTest#99"}),
        content_type="application/json",
    )
    assert r.status_code == 200
    data = json.loads(r.content)
    assert "access_token" in data and "refresh_token" in data
    assert data["user"]["role"] == "super_admin"


def test_refresh_token(api_client: Client, user_super):
    login = api_client.post(
        "/api/auth/login/",
        data=json.dumps({"username": user_super.username, "password": "AuditTest#99"}),
        content_type="application/json",
    )
    refresh = json.loads(login.content)["refresh_token"]
    r = api_client.post(
        "/api/auth/refresh/",
        data=json.dumps({"refresh_token": refresh}),
        content_type="application/json",
    )
    assert r.status_code == 200
    assert "access_token" in json.loads(r.content)


# --- Super admin vs company admin ---


def test_admin_companies_forbidden_for_company_admin(api_client: Client, auth_admin_headers):
    r = api_client.get("/api/admin/companies/", **auth_admin_headers)
    assert r.status_code == 403


def test_admin_companies_ok_for_super(api_client: Client, auth_super_headers, company_master, company_tenant):
    r = api_client.get("/api/admin/companies/", **auth_super_headers)
    assert r.status_code == 200
    rows = json.loads(r.content)
    ids = {c["id"] for c in rows}
    assert company_master.id in ids
    assert company_tenant.id in ids


# --- Tenant isolation (X-Selected-Company-Id) ---


def test_companies_current_follows_selected_company_header(
    api_client: Client, auth_super_headers, company_master, company_tenant
):
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_tenant.id)}
    r = api_client.get("/api/companies/current/", **h)
    assert r.status_code == 200
    data = json.loads(r.content)
    assert data["id"] == company_tenant.id
    assert data["name"] == company_tenant.name


def test_superadmin_invalid_company_header_falls_back_to_resolved_company(
    api_client: Client, auth_super_headers, company_master
):
    """Stale X-Selected-Company-Id must not hard-fail; fall back like no header."""
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": "99999999"}
    r = api_client.get("/api/stations/", **h)
    assert r.status_code == 200


def test_stations_isolated_between_companies(
    api_client: Client, auth_super_headers, company_master, company_tenant
):
    hm = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}
    ht = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_tenant.id)}

    rm = api_client.post(
        "/api/stations/",
        data=json.dumps({"station_name": "Master Station Audit"}),
        content_type="application/json",
        **hm,
    )
    assert rm.status_code == 201

    rt = api_client.post(
        "/api/stations/",
        data=json.dumps({"station_name": "Tenant Station Audit"}),
        content_type="application/json",
        **ht,
    )
    assert rt.status_code == 201

    lm = api_client.get("/api/stations/", **hm)
    names_m = {s["station_name"] for s in json.loads(lm.content)}
    assert "Master Station Audit" in names_m
    assert "Tenant Station Audit" not in names_m

    lt = api_client.get("/api/stations/", **ht)
    names_t = {s["station_name"] for s in json.loads(lt.content)}
    assert "Tenant Station Audit" in names_t
    assert "Master Station Audit" not in names_t


def test_company_admin_stations_only_their_tenant(
    api_client: Client, auth_admin_headers, company_tenant, company_master
):
    """Admin user is tied to company_tenant — cannot see master's stations."""
    from api.models import Station

    Station.objects.create(
        company_id=company_master.id,
        station_name="Master Only Station",
    )
    Station.objects.create(
        company_id=company_tenant.id,
        station_name="Tenant Visible Station",
    )
    r = api_client.get("/api/stations/", **auth_admin_headers)
    assert r.status_code == 200
    names = {s["station_name"] for s in json.loads(r.content)}
    assert "Tenant Visible Station" in names
    assert "Master Only Station" not in names


# --- Dashboard / customers smoke ---


def test_dashboard_stats_requires_auth(api_client: Client):
    r = api_client.get("/api/dashboard/stats/")
    assert r.status_code == 401


def test_dashboard_stats_ok(api_client: Client, auth_super_headers, company_master):
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}
    r = api_client.get("/api/dashboard/stats/", **h)
    assert r.status_code == 200
    data = json.loads(r.content)
    for key in ("today_sales", "total_customers", "total_invoices", "total_revenue"):
        assert key in data


def test_customers_list_empty(api_client: Client, auth_super_headers, company_master):
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}
    r = api_client.get("/api/customers/", **h)
    assert r.status_code == 200
    assert json.loads(r.content) == []


def test_customers_add_dummy(api_client: Client, auth_super_headers, company_master):
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}
    r = api_client.post("/api/customers/add-dummy/", **h)
    assert r.status_code == 201
    rows = json.loads(r.content)
    assert len(rows) == 1

    r2 = api_client.get("/api/customers/", **h)
    assert len(json.loads(r2.content)) == 1


# --- Trailing slash: list endpoints accept slash form (client uses /api/.../) ---


def test_items_list_with_trailing_slash(api_client: Client, auth_super_headers, company_master):
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}
    r = api_client.get("/api/items/", **h)
    assert r.status_code == 200
    assert isinstance(json.loads(r.content), list)


def test_items_reject_duplicate_name_same_company(
    api_client: Client, auth_super_headers, company_master
):
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}
    payload = {"name": "Audit Dup Product", "unit_price": "10", "cost": "5"}
    r1 = api_client.post(
        "/api/items/",
        data=json.dumps(payload),
        content_type="application/json",
        **h,
    )
    assert r1.status_code == 201
    r2 = api_client.post(
        "/api/items/",
        data=json.dumps({**payload, "name": "  audit dup  product "}),
        content_type="application/json",
        **h,
    )
    assert r2.status_code == 409
    assert b"already exists" in r2.content


def test_items_same_name_allowed_in_different_companies(
    api_client: Client, auth_super_headers, company_master, company_tenant
):
    body = {"name": "Shared Label OK", "unit_price": "1", "cost": "0"}
    h_m = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}
    h_t = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_tenant.id)}
    r1 = api_client.post(
        "/api/items/", data=json.dumps(body), content_type="application/json", **h_m
    )
    r2 = api_client.post(
        "/api/items/", data=json.dumps(body), content_type="application/json", **h_t
    )
    assert r1.status_code == 201
    assert r2.status_code == 201


def test_items_reject_negative_unit_price(api_client: Client, auth_super_headers, company_master):
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}
    r = api_client.post(
        "/api/items/",
        data=json.dumps({"name": "Neg price item", "unit_price": "-1", "cost": "0"}),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 400


def test_items_list_quantity_is_sum_of_active_tanks_for_fuel_products(
    api_client: Client, auth_super_headers, company_master
):
    """Items page shows tank stock for products linked to tanks, not Item.quantity_on_hand alone."""
    from api.models import Item, Tank

    nozzle = _audit_fuel_nozzle(company_master)
    product_id = nozzle.product_id
    Item.objects.filter(pk=product_id).update(quantity_on_hand=Decimal("0"))
    station = nozzle.tank.station
    Tank.objects.create(
        company=company_master,
        station=station,
        product_id=product_id,
        tank_name="T-extra",
        capacity=Decimal("50000"),
        current_stock=Decimal("3500"),
    )
    # Original tank 10000 + new 3500
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}
    r = api_client.get("/api/items/", **h)
    assert r.status_code == 200
    rows = json.loads(r.content)
    row = next((x for x in rows if x["id"] == product_id), None)
    assert row is not None
    assert Decimal(str(row["quantity_on_hand"])) == Decimal("13500")


def test_items_for_tanks_query_includes_fuel_category_and_legacy_fuel_names(
    api_client: Client, auth_super_headers, company_master
):
    """Tank/nozzle UIs use ?for_tanks=1: fuel POS category, names, or category-field hints."""
    from api.models import Item

    Item.objects.create(
        company=company_master,
        name="Octane 95",
        item_type="inventory",
        pos_category="general",
        is_active=True,
    )
    Item.objects.create(
        company=company_master,
        name="Snacks Bar",
        item_type="inventory",
        pos_category="general",
        is_active=True,
    )
    Item.objects.create(
        company=company_master,
        name="Marked Fuel Row",
        item_type="inventory",
        pos_category="fuel",
        is_active=True,
    )
    Item.objects.create(
        company=company_master,
        name="SKU-Plain",
        item_type="inventory",
        pos_category="general",
        category="Petroleum gas retail",
        is_active=True,
    )
    Item.objects.create(
        company=company_master,
        name="LPG-Auto",
        item_type="inventory",
        pos_category="fuel_lpg",
        is_active=True,
    )
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}
    r = api_client.get("/api/items/?for_tanks=1", **h)
    assert r.status_code == 200
    rows = json.loads(r.content)
    names = {x["name"] for x in rows}
    assert "Octane 95" in names
    assert "Marked Fuel Row" in names
    assert "SKU-Plain" in names
    assert "LPG-Auto" in names
    assert "Snacks Bar" not in names


# --- Chart of accounts, invoices, payments, cashier ---


def test_chart_of_accounts_template_fuel_station_meta(
    api_client: Client, auth_super_headers, company_master
):
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}
    r = api_client.get("/api/chart-of-accounts/templates/fuel-station/", **h)
    assert r.status_code == 200
    body = json.loads(r.content)
    assert body.get("id") == "fuel_station_v1"
    assert "account_counts" in body
    guide = body.get("erp_automation_guide") or []
    assert isinstance(guide, list) and len(guide) >= 5
    assert any(x.get("account_code") == "1010" for x in guide)

    r2 = api_client.get(
        "/api/chart-of-accounts/templates/fuel-station/?include_rows=1&profile=retail",
        **h,
    )
    assert r2.status_code == 200
    b2 = json.loads(r2.content)
    assert b2.get("profile") == "retail"
    rows = b2.get("rows") or []
    assert len(rows) > 10
    assert all("description" in x and "account_code" in x for x in rows)


def test_chart_of_accounts_seed_retail_then_list(
    api_client: Client, auth_super_headers, company_master
):
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}
    seed = api_client.post(
        "/api/chart-of-accounts/seed-template/",
        data=json.dumps({"template_id": "fuel_station_v1", "profile": "retail"}),
        content_type="application/json",
        **h,
    )
    assert seed.status_code == 200
    seeded = json.loads(seed.content)
    assert "added" in seeded or "skipped" in seeded

    r = api_client.get("/api/chart-of-accounts/", **h)
    assert r.status_code == 200
    rows = json.loads(r.content)
    assert len(rows) >= 1
    assert all("account_code" in a and "account_name" in a for a in rows)


def test_chart_of_accounts_post_single_account(
    api_client: Client, auth_super_headers, company_master
):
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}
    r = api_client.post(
        "/api/chart-of-accounts/",
        data=json.dumps(
            {
                "account_code": "9999",
                "account_name": "Audit Misc",
                "account_type": "expense",
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201
    body = json.loads(r.content)
    assert body["account_code"] == "9999"


def _audit_master_headers(auth_super_headers, company_master):
    return {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}


def _audit_seed_min_gl_accounts(company):
    """Minimal COA so auto-posting (invoices, payments, bills) can create balanced journals in tests."""
    from api.models import ChartOfAccount

    specs = [
        ("1010", "Cash on Hand", "asset"),
        ("1030", "Bank Operating", "asset"),
        ("1100", "Accounts Receivable", "asset"),
        ("1120", "Card Clearing", "asset"),
        ("1200", "Inventory Fuel", "asset"),
        ("1220", "Inventory Shop", "asset"),
        ("2000", "Accounts Payable", "liability"),
        ("2100", "VAT Payable", "liability"),
        ("4100", "Fuel Sales", "income"),
        ("4200", "Shop Sales", "income"),
        ("5100", "COGS Fuel", "cost_of_goods_sold"),
        ("5120", "COGS Shop", "cost_of_goods_sold"),
        ("6900", "Office Expense", "expense"),
    ]
    for code, name, typ in specs:
        ChartOfAccount.objects.get_or_create(
            company=company,
            account_code=code,
            defaults={"account_name": name, "account_type": typ},
        )


def _audit_fuel_nozzle(company):
    """Minimal station → island → dispenser → meter → tank + product → nozzle graph for cashier/sale."""
    from api.models import Dispenser, Island, Item, Meter, Nozzle, Station, Tank

    station = Station.objects.create(company=company, station_name="Audit Pump Bay")
    product = Item.objects.create(
        company=company,
        name="Audit Petrol",
        unit_price=Decimal("120.50"),
        quantity_on_hand=Decimal("0"),
    )
    tank = Tank.objects.create(
        company=company,
        station=station,
        product=product,
        tank_name="T1",
        capacity=Decimal("50000"),
        current_stock=Decimal("10000"),
    )
    island = Island.objects.create(company=company, station=station, island_name="Island 1")
    dispenser = Dispenser.objects.create(company=company, island=island, dispenser_name="D1")
    meter = Meter.objects.create(
        company=company,
        dispenser=dispenser,
        current_reading=Decimal("1000.0000"),
    )
    return Nozzle.objects.create(
        company=company,
        meter=meter,
        tank=tank,
        product=product,
    )


def test_invoice_list_create_detail_and_status(
    api_client: Client, auth_super_headers, company_master
):
    _audit_seed_min_gl_accounts(company_master)
    h = _audit_master_headers(auth_super_headers, company_master)
    api_client.post("/api/customers/add-dummy/", **h)
    cust_list = json.loads(api_client.get("/api/customers/", **h).content)
    assert len(cust_list) == 1
    customer_id = cust_list[0]["id"]

    item_r = api_client.post(
        "/api/items/",
        data=json.dumps({"name": "Audit Line Item", "unit_price": "10.00"}),
        content_type="application/json",
        **h,
    )
    assert item_r.status_code == 201
    item_id = json.loads(item_r.content)["id"]

    inv_r = api_client.post(
        "/api/invoices/",
        data=json.dumps(
            {
                "customer_id": customer_id,
                "subtotal": "20.00",
                "tax_total": "0",
                "total": "20.00",
                "status": "draft",
                "lines": [
                    {
                        "item_id": item_id,
                        "description": "Test",
                        "quantity": "2",
                        "unit_price": "10.00",
                    }
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert inv_r.status_code == 201
    inv = json.loads(inv_r.content)
    assert inv["customer_id"] == customer_id
    inv_id = inv["id"]

    lst = json.loads(api_client.get("/api/invoices/", **h).content)
    assert any(row["id"] == inv_id for row in lst)

    one = json.loads(api_client.get(f"/api/invoices/{inv_id}/", **h).content)
    assert one["id"] == inv_id
    assert len(one["lines"]) >= 1

    bad = api_client.post(
        "/api/invoices/",
        data=json.dumps({"customer_id": 99999999, "total": "1"}),
        content_type="application/json",
        **h,
    )
    assert bad.status_code == 400

    st = api_client.put(
        f"/api/invoices/{inv_id}/status/",
        data=json.dumps({"status": "sent"}),
        content_type="application/json",
        **h,
    )
    assert st.status_code == 200
    assert json.loads(st.content)["status"] == "sent"

    from api.models import JournalEntry

    assert JournalEntry.objects.filter(company_id=company_master.id, is_posted=True).exists()


def test_invoice_put_and_delete(api_client: Client, auth_super_headers, company_master):
    h = _audit_master_headers(auth_super_headers, company_master)
    api_client.post("/api/customers/add-dummy/", **h)
    customer_id = json.loads(api_client.get("/api/customers/", **h).content)[0]["id"]
    inv_r = api_client.post(
        "/api/invoices/",
        data=json.dumps(
            {
                "customer_id": customer_id,
                "subtotal": "10.00",
                "tax_total": "0",
                "total": "10.00",
                "status": "draft",
            }
        ),
        content_type="application/json",
        **h,
    )
    assert inv_r.status_code == 201
    inv_id = json.loads(inv_r.content)["id"]

    put_r = api_client.put(
        f"/api/invoices/{inv_id}/",
        data=json.dumps({"subtotal": "15.00", "total": "15.00", "status": "sent"}),
        content_type="application/json",
        **h,
    )
    assert put_r.status_code == 200
    assert json.loads(put_r.content)["total"] == "15.00"

    del_r = api_client.delete(f"/api/invoices/{inv_id}/", **h)
    assert del_r.status_code == 200
    gone = api_client.get(f"/api/invoices/{inv_id}/", **h)
    assert gone.status_code == 404


def test_payments_received_and_outstanding(
    api_client: Client, auth_super_headers, company_master
):
    from api.models import ChartOfAccount, JournalEntry, JournalEntryLine

    _audit_seed_min_gl_accounts(company_master)
    h = _audit_master_headers(auth_super_headers, company_master)
    api_client.post("/api/customers/add-dummy/", **h)
    customer_id = json.loads(api_client.get("/api/customers/", **h).content)[0]["id"]

    empty = json.loads(api_client.get("/api/payments/received/", **h).content)
    assert empty == []

    pay = api_client.post(
        "/api/payments/received/",
        data=json.dumps(
            {
                "customer_id": customer_id,
                "amount": "50.00",
                "payment_method": "cash",
            }
        ),
        content_type="application/json",
        **h,
    )
    assert pay.status_code == 201
    pj = json.loads(pay.content)
    assert pj["payment_type"] == "received"
    assert pj["amount"] == "50.00"

    # Cash receipts without a bank register must hit Cash on Hand (1010), not Bank Operating (1030),
    # so the Cash on Hand register statement matches.
    pay_id = pj["id"]
    je = JournalEntry.objects.get(
        company_id=company_master.id, entry_number=f"AUTO-PAY-{pay_id}-RCV"
    )
    cash_1010 = ChartOfAccount.objects.get(
        company_id=company_master.id, account_code="1010"
    )
    assert JournalEntryLine.objects.filter(
        journal_entry=je, account_id=cash_1010.id, debit__gt=0
    ).exists()

    listed = json.loads(api_client.get("/api/payments/received/", **h).content)
    assert len(listed) == 1

    out = json.loads(
        api_client.get("/api/payments/received/outstanding/", **h).content
    )
    assert isinstance(out, list)


def test_payments_received_cash_with_shift_updates_expected_cash_drawer(
    api_client: Client, auth_super_headers, company_master
):
    """Optional shift_session_id on POST /payments/received/ rolls cash into expected_cash_total."""
    from decimal import Decimal

    from api.models import ShiftSession

    _audit_seed_min_gl_accounts(company_master)
    h = _audit_master_headers(auth_super_headers, company_master)
    api_client.post("/api/customers/add-dummy/", **h)
    customer_id = json.loads(api_client.get("/api/customers/", **h).content)[0]["id"]

    active_r = api_client.get("/api/shifts/sessions/active/", **h)
    body_raw = active_r.content.decode().strip()
    if body_raw in ("null", ""):
        open_r = api_client.post(
            "/api/shifts/sessions/open/",
            data=json.dumps({}),
            content_type="application/json",
            **h,
        )
        assert open_r.status_code == 201, open_r.content
        shift_id = json.loads(open_r.content)["id"]
        exp_before = Decimal("0")
    else:
        sess = json.loads(active_r.content)
        shift_id = sess["id"]
        exp_before = Decimal(str(sess.get("expected_cash_total") or "0"))

    pay = api_client.post(
        "/api/payments/received/",
        data=json.dumps(
            {
                "customer_id": customer_id,
                "amount": "40.00",
                "payment_method": "cash",
                "shift_session_id": shift_id,
            }
        ),
        content_type="application/json",
        **h,
    )
    assert pay.status_code == 201, pay.content

    s = ShiftSession.objects.get(pk=shift_id)
    assert s.expected_cash_total == exp_before + Decimal("40.00")


def test_payments_made_create_and_list(
    api_client: Client, auth_super_headers, company_master
):
    h = _audit_master_headers(auth_super_headers, company_master)
    v = api_client.post(
        "/api/vendors/",
        data=json.dumps({"company_name": "Audit Vendor Ltd"}),
        content_type="application/json",
        **h,
    )
    assert v.status_code == 201
    vendor_id = json.loads(v.content)["id"]

    pay = api_client.post(
        "/api/payments/made/",
        data=json.dumps({"vendor_id": vendor_id, "amount": "25.50"}),
        content_type="application/json",
        **h,
    )
    assert pay.status_code == 201
    assert json.loads(pay.content)["payment_type"] == "made"

    listed = json.loads(api_client.get("/api/payments/made/", **h).content)
    assert len(listed) == 1

    out = json.loads(api_client.get("/api/payments/made/outstanding/", **h).content)
    assert isinstance(out, list)


def test_payments_made_partial_accepts_allocations_and_allocated_amount(
    api_client: Client, auth_super_headers, company_master
):
    """UI sends allocations[].allocated_amount; backend must apply to bills (vendor subledger)."""
    from decimal import Decimal

    h = _audit_master_headers(auth_super_headers, company_master)
    v = api_client.post(
        "/api/vendors/",
        data=json.dumps({"company_name": "Partial Pay Vendor"}),
        content_type="application/json",
        **h,
    )
    assert v.status_code == 201
    vendor_id = json.loads(v.content)["id"]

    bill_r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "subtotal": "100.00",
                "tax_total": "0",
                "total": "100.00",
                "status": "open",
                "lines": [
                    {
                        "description": "Service",
                        "quantity": 1,
                        "unit_price": "100.00",
                    }
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert bill_r.status_code == 201
    bill_id = json.loads(bill_r.content)["id"]

    pay = api_client.post(
        "/api/payments/made/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "amount": "40.00",
                "allocations": [
                    {
                        "bill_id": bill_id,
                        "allocated_amount": "40.00",
                        "discount_amount": 0,
                    }
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert pay.status_code == 201, pay.content
    pj = json.loads(pay.content)
    assert pj["amount"] == "40.00"
    assert len(pj.get("bill_allocations") or []) == 1

    one_bill = json.loads(api_client.get(f"/api/bills/{bill_id}/", **h).content)
    assert one_bill["status"] == "partial"

    out = json.loads(
        api_client.get(
            f"/api/payments/made/outstanding/?vendor_id={vendor_id}", **h
        ).content
    )
    bill_row = next((r for r in out if r["id"] == bill_id), None)
    assert bill_row is not None
    assert Decimal(str(bill_row["balance_due"])) == Decimal("60.00")


def test_bills_create_list_get_delete(api_client: Client, auth_super_headers, company_master):
    h = _audit_master_headers(auth_super_headers, company_master)
    v = api_client.post(
        "/api/vendors/",
        data=json.dumps({"company_name": "Bill Vendor Co"}),
        content_type="application/json",
        **h,
    )
    assert v.status_code == 201
    vendor_id = json.loads(v.content)["id"]

    bill_r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "subtotal": "100.00",
                "tax_total": "0",
                "total": "100.00",
                "status": "draft",
            }
        ),
        content_type="application/json",
        **h,
    )
    assert bill_r.status_code == 201
    bill = json.loads(bill_r.content)
    bill_id = bill["id"]
    assert bill["vendor_id"] == vendor_id

    lst = json.loads(api_client.get("/api/bills/", **h).content)
    assert any(b["id"] == bill_id for b in lst)

    one = json.loads(api_client.get(f"/api/bills/{bill_id}/", **h).content)
    assert one["id"] == bill_id

    bad = api_client.post(
        "/api/bills/",
        data=json.dumps({"vendor_id": 99999999, "total": "1"}),
        content_type="application/json",
        **h,
    )
    assert bad.status_code == 400

    api_client.delete(f"/api/bills/{bill_id}/", **h)


def test_vendor_bill_gl_debits_inventory_fuel_not_only_office_expense(
    api_client: Client, auth_super_headers, company_master
):
    """Posted inventory vendor bills debit Inventory (1200/1220 per item) by line amount; Cr AP = total."""
    from django.db.models import Sum

    from api.models import ChartOfAccount, Item, JournalEntry, JournalEntryLine
    from api.services.gl_posting import _inventory_account_for_item

    _audit_seed_min_gl_accounts(company_master)
    h = _audit_master_headers(auth_super_headers, company_master)
    nozzle = _audit_fuel_nozzle(company_master)
    product_id = nozzle.product_id
    Item.objects.filter(pk=product_id).update(unit="L", pos_category="fuel")
    item = Item.objects.get(pk=product_id)
    inv_acc = _inventory_account_for_item(company_master.id, item)
    assert inv_acc is not None

    v = api_client.post(
        "/api/vendors/",
        data=json.dumps({"company_name": "GL Fuel Vendor"}),
        content_type="application/json",
        **h,
    )
    assert v.status_code == 201
    vendor_id = json.loads(v.content)["id"]

    bill_r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "subtotal": "100.00",
                "tax_total": "15.00",
                "total": "115.00",
                "status": "open",
                "lines": [
                    {
                        "item_id": product_id,
                        "description": "Fuel delivery",
                        "quantity": "1",
                        "unit_cost": "100.00",
                        "amount": "100.00",
                    }
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert bill_r.status_code == 201, bill_r.content
    bill_id = json.loads(bill_r.content)["id"]
    je = JournalEntry.objects.get(
        company_id=company_master.id, entry_number=f"AUTO-BILL-{bill_id}"
    )
    inv_debit = (
        JournalEntryLine.objects.filter(journal_entry=je, account_id=inv_acc.id).aggregate(
            s=Sum("debit")
        )["s"]
        or Decimal("0")
    )
    assert inv_debit == Decimal("100.00")
    ap = ChartOfAccount.objects.get(company_id=company_master.id, account_code="2000")
    ap_credit = (
        JournalEntryLine.objects.filter(journal_entry=je, account_id=ap.id).aggregate(
            s=Sum("credit")
        )["s"]
        or Decimal("0")
    )
    assert ap_credit == Decimal("115.00")


def test_vendor_bill_open_increases_tank_and_item_stock_for_fuel(
    api_client: Client, auth_super_headers, company_master
):
    """Posted vendor bills with inventory lines must increase stock (tank for fuel, item QOH)."""
    from api.models import Item, Tank

    _audit_seed_min_gl_accounts(company_master)
    h = _audit_master_headers(auth_super_headers, company_master)
    nozzle = _audit_fuel_nozzle(company_master)
    product_id = nozzle.product_id
    tank_id = nozzle.tank_id
    assert Tank.objects.get(pk=tank_id).current_stock == Decimal("10000")
    assert Item.objects.get(pk=product_id).quantity_on_hand == Decimal("0")

    v = api_client.post(
        "/api/vendors/",
        data=json.dumps({"company_name": "Fuel Supplier"}),
        content_type="application/json",
        **h,
    )
    assert v.status_code == 201
    vendor_id = json.loads(v.content)["id"]

    bill_r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "subtotal": "5000.00",
                "tax_total": "0",
                "total": "5000.00",
                "status": "open",
                "lines": [
                    {
                        "item_id": product_id,
                        "description": "Petrol delivery",
                        "quantity": "500",
                        "unit_cost": "10.00",
                        "amount": "5000.00",
                    }
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert bill_r.status_code == 201, bill_r.content

    tank = Tank.objects.get(pk=tank_id)
    assert tank.current_stock == Decimal("10500")
    item = Item.objects.get(pk=product_id)
    assert item.quantity_on_hand == Decimal("10500")
    bill = json.loads(bill_r.content)
    from api.models import Bill

    assert Bill.objects.get(pk=bill["id"]).stock_receipt_applied is True


def test_vendor_bill_existing_journal_backfills_stock_once(
    api_client: Client, auth_super_headers, company_master
):
    """If AUTO-BILL journal was created without inventory receipt, a later post_bill_journal run receipts once."""
    from api.models import Bill, BillLine, Item, JournalEntry, Tank, Vendor

    _audit_seed_min_gl_accounts(company_master)
    h = _audit_master_headers(auth_super_headers, company_master)
    nozzle = _audit_fuel_nozzle(company_master)
    product_id = nozzle.product_id
    tank_id = nozzle.tank_id
    vendor = Vendor.objects.create(company=company_master, company_name="Backfill Vendor")

    bill = Bill.objects.create(
        company=company_master,
        vendor=vendor,
        bill_number="BILL-BF-1",
        bill_date=date.today(),
        status="open",
        subtotal=Decimal("100.00"),
        tax_total=Decimal("0"),
        total=Decimal("100.00"),
        stock_receipt_applied=False,
    )
    BillLine.objects.create(
        bill=bill,
        item_id=product_id,
        description="Fuel",
        quantity=Decimal("10"),
        unit_price=Decimal("10"),
        amount=Decimal("100.00"),
    )
    from api.models import ChartOfAccount
    from django.utils import timezone

    ap = ChartOfAccount.objects.filter(
        company_id=company_master.id, account_code="2000"
    ).first()
    exp = ChartOfAccount.objects.filter(
        company_id=company_master.id, account_code="6900"
    ).first()
    assert ap and exp
    je = JournalEntry.objects.create(
        company_id=company_master.id,
        entry_number=f"AUTO-BILL-{bill.id}",
        entry_date=bill.bill_date,
        description="Bill posted without receipt",
        is_posted=True,
        posted_at=timezone.now(),
    )
    from api.models import JournalEntryLine

    JournalEntryLine.objects.create(
        journal_entry=je, account=exp, debit=Decimal("100"), credit=Decimal("0"), description=""
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=ap, debit=Decimal("0"), credit=Decimal("100"), description=""
    )

    t0 = Tank.objects.get(pk=tank_id).current_stock

    from api.services.gl_posting import post_bill_journal

    assert post_bill_journal(company_master.id, bill) is True
    assert Tank.objects.get(pk=tank_id).current_stock == t0 + Decimal("10")
    item = Item.objects.get(pk=product_id)
    assert item.quantity_on_hand == t0 + Decimal("10")
    assert Bill.objects.get(pk=bill.id).stock_receipt_applied is True

    post_bill_journal(company_master.id, Bill.objects.get(pk=bill.id))
    assert Tank.objects.get(pk=tank_id).current_stock == t0 + Decimal("10")
    assert Item.objects.get(pk=product_id).quantity_on_hand == t0 + Decimal("10")


def test_vendor_bill_receipt_defaults_tank_by_product_name_order(
    api_client: Client, auth_super_headers, company_master
):
    """Without line.tank_id, receipt picks tank whose name matches product (e.g. Petrol → Petrol Tank-1)."""
    from api.models import Item, Tank, Vendor

    _audit_seed_min_gl_accounts(company_master)
    h = _audit_master_headers(auth_super_headers, company_master)
    nozzle = _audit_fuel_nozzle(company_master)
    product_id = nozzle.product_id
    tank1_id = nozzle.tank_id
    station = nozzle.tank.station
    Tank.objects.filter(pk=tank1_id).update(tank_name="Petrol Tank-1")
    Item.objects.filter(pk=product_id).update(name="Petrol")
    Tank.objects.create(
        company=company_master,
        station=station,
        product_id=product_id,
        tank_name="ZZ Secondary",
        capacity=Decimal("50000"),
        current_stock=Decimal("0"),
    )

    v = api_client.post(
        "/api/vendors/",
        data=json.dumps({"company_name": "Name Pick Vendor"}),
        content_type="application/json",
        **h,
    )
    assert v.status_code == 201
    vendor_id = json.loads(v.content)["id"]

    bill_r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "subtotal": "10.00",
                "tax_total": "0",
                "total": "10.00",
                "status": "open",
                "lines": [
                    {
                        "item_id": product_id,
                        "description": "Petrol",
                        "quantity": "10",
                        "unit_cost": "1.00",
                        "amount": "10.00",
                    }
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert bill_r.status_code == 201, bill_r.content

    t_main = Tank.objects.get(pk=tank1_id)
    t_zz = Tank.objects.get(tank_name="ZZ Secondary", company_id=company_master.id)
    assert t_main.current_stock == Decimal("10010")
    assert t_zz.current_stock == Decimal("0")


def test_vendor_bill_line_tank_id_targets_second_tank(
    api_client: Client, auth_super_headers, company_master
):
    from api.models import Item, Tank

    _audit_seed_min_gl_accounts(company_master)
    h = _audit_master_headers(auth_super_headers, company_master)
    nozzle = _audit_fuel_nozzle(company_master)
    product_id = nozzle.product_id
    tank1_id = nozzle.tank_id
    station = nozzle.tank.station
    tank2 = Tank.objects.create(
        company=company_master,
        station=station,
        product_id=product_id,
        tank_name="T2",
        capacity=Decimal("50000"),
        current_stock=Decimal("2000"),
    )

    v = api_client.post(
        "/api/vendors/",
        data=json.dumps({"company_name": "Two Tank Supplier"}),
        content_type="application/json",
        **h,
    )
    assert v.status_code == 201
    vendor_id = json.loads(v.content)["id"]

    bill_r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "subtotal": "100.00",
                "tax_total": "0",
                "total": "100.00",
                "status": "open",
                "lines": [
                    {
                        "item_id": product_id,
                        "description": "Delivery",
                        "quantity": "100",
                        "unit_cost": "1.00",
                        "amount": "100.00",
                        "tank_id": tank2.id,
                    }
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert bill_r.status_code == 201, bill_r.content

    assert Tank.objects.get(pk=tank1_id).current_stock == Decimal("10000")
    assert Tank.objects.get(pk=tank2.id).current_stock == Decimal("2100")
    assert Item.objects.get(pk=product_id).quantity_on_hand == Decimal("12100")


def test_chart_of_accounts_statement_for_seeded_account(
    api_client: Client, auth_super_headers, company_master
):
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}
    api_client.post(
        "/api/chart-of-accounts/seed-template/",
        data=json.dumps({"template_id": "fuel_station_v1", "profile": "retail"}),
        content_type="application/json",
        **h,
    )
    rows = json.loads(api_client.get("/api/chart-of-accounts/", **h).content)
    assert rows
    aid = rows[0]["id"]
    stmt = api_client.get(f"/api/chart-of-accounts/{aid}/statement/", **h)
    assert stmt.status_code == 200
    body = json.loads(stmt.content)
    assert "account" in body and "transactions" in body
    assert body["account"]["id"] == aid


def test_cashier_pos_general_sale(api_client: Client, auth_super_headers, company_master):
    h = _audit_master_headers(auth_super_headers, company_master)
    item_r = api_client.post(
        "/api/items/",
        data=json.dumps({"name": "POS Snack", "unit_price": "5.00", "quantity_on_hand": "100"}),
        content_type="application/json",
        **h,
    )
    assert item_r.status_code == 201
    item_id = json.loads(item_r.content)["id"]

    pos = api_client.post(
        "/api/cashier/pos/",
        data=json.dumps(
            {"items": [{"item_id": item_id, "quantity": "3", "unit_price": "5.00"}]}
        ),
        content_type="application/json",
        **h,
    )
    assert pos.status_code == 201
    body = json.loads(pos.content)
    assert "invoice_id" in body
    assert body.get("detail") == "Sale recorded"


def test_cashier_pos_empty_items_bad_request(
    api_client: Client, auth_super_headers, company_master
):
    h = _audit_master_headers(auth_super_headers, company_master)
    r = api_client.post(
        "/api/cashier/pos/",
        data=json.dumps({"items": [], "fuel_lines": []}),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 400


def test_cashier_pos_mixed_fuel_and_general(
    api_client: Client, auth_super_headers, company_master
):
    """Single invoice from POST /cashier/pos with fuel_lines and items."""
    from api.models import Invoice, InvoiceLine, Item, Meter, Tank

    _audit_seed_min_gl_accounts(company_master)
    h = _audit_master_headers(auth_super_headers, company_master)
    nozzle = _audit_fuel_nozzle(company_master)
    meter_id = nozzle.meter_id
    tank_id = nozzle.tank_id
    qty_fuel = Decimal("2.0")

    item_r = api_client.post(
        "/api/items/",
        data=json.dumps(
            {
                "name": "Mixed POS Snack",
                "unit_price": "4.00",
                "quantity_on_hand": "50",
            }
        ),
        content_type="application/json",
        **h,
    )
    assert item_r.status_code == 201
    item_id = json.loads(item_r.content)["id"]
    shop_item = Item.objects.get(pk=item_id)

    pos = api_client.post(
        "/api/cashier/pos/",
        data=json.dumps(
            {
                "items": [
                    {
                        "item_id": item_id,
                        "quantity": "2",
                        "unit_price": "4.00",
                    }
                ],
                "fuel_lines": [
                    {"nozzle_id": nozzle.id, "quantity": str(qty_fuel)},
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert pos.status_code == 201, pos.content
    body = json.loads(pos.content)
    inv = Invoice.objects.get(pk=body["invoice_id"])
    # 2 x $4.00 snack + fuel at $120.50/L
    assert inv.total == Decimal("8.00") + (qty_fuel * Decimal("120.50"))
    lines = InvoiceLine.objects.filter(invoice=inv)
    assert lines.count() == 2

    meter = Meter.objects.get(pk=meter_id)
    assert meter.current_reading == Decimal("1000.0000") + qty_fuel

    tank = Tank.objects.get(pk=tank_id)
    assert tank.current_stock == Decimal("10000") - qty_fuel

    shop_item.refresh_from_db()
    assert shop_item.quantity_on_hand == Decimal("48")


def test_cashier_pos_no_valid_items_bad_request(
    api_client: Client, auth_super_headers, company_master
):
    h = _audit_master_headers(auth_super_headers, company_master)
    r = api_client.post(
        "/api/cashier/pos/",
        data=json.dumps({"items": [{"item_id": 99999999, "quantity": "1"}]}),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 400
    assert "valid" in json.loads(r.content).get("detail", "").lower()


def test_cashier_pos_on_account_requires_named_customer(
    api_client: Client, auth_super_headers, company_master
):
    """On-account (A/R) POS must not use Walk-in or missing customer."""
    from api.models import Customer, Item

    h = _audit_master_headers(auth_super_headers, company_master)
    item = Item.objects.create(
        company=company_master,
        name="AR Test SKU",
        unit_price=Decimal("10.00"),
        quantity_on_hand=Decimal("50"),
    )
    r = api_client.post(
        "/api/cashier/pos/",
        data=json.dumps(
            {
                "payment_method": "on_account",
                "items": [{"item_id": item.id, "quantity": "1", "unit_price": "10.00"}],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 400
    assert "customer" in json.loads(r.content).get("detail", "").lower()

    walk = Customer.objects.create(
        company=company_master,
        display_name="Walk-in",
        customer_number="WALK-IN",
        is_active=True,
    )
    r2 = api_client.post(
        "/api/cashier/pos/",
        data=json.dumps(
            {
                "payment_method": "on_account",
                "customer_id": walk.id,
                "items": [{"item_id": item.id, "quantity": "1", "unit_price": "10.00"}],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r2.status_code == 400


def test_cashier_pos_on_account_creates_sent_invoice(
    api_client: Client, auth_super_headers, company_master
):
    from api.models import Customer, Invoice, Item

    _audit_seed_min_gl_accounts(company_master)
    h = _audit_master_headers(auth_super_headers, company_master)
    cust = Customer.objects.create(
        company=company_master,
        display_name="Fleet Credit Customer",
        customer_number="CR-001",
        is_active=True,
    )
    item = Item.objects.create(
        company=company_master,
        name="AR Test SKU 2",
        unit_price=Decimal("4.00"),
        quantity_on_hand=Decimal("20"),
    )
    r = api_client.post(
        "/api/cashier/pos/",
        data=json.dumps(
            {
                "payment_method": "on_account",
                "customer_id": cust.id,
                "items": [{"item_id": item.id, "quantity": "2", "unit_price": "4.00"}],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201
    body = json.loads(r.content)
    assert body.get("invoice_status") == "sent"
    det = (body.get("detail") or "").lower()
    assert "account" in det or "receivable" in det or "a/r" in det
    inv = Invoice.objects.get(pk=body["invoice_id"])
    assert inv.status == "sent"
    assert inv.payment_method == "on_account"
    assert inv.customer_id == cust.id
    cust.refresh_from_db()
    assert cust.current_balance == Decimal("8.00")


def test_cashier_pos_split_tender_cash_and_ar(
    api_client: Client, auth_super_headers, company_master
):
    """POS: pay part now (cash), remainder on A/R — invoice partial + payment allocation."""
    from api.models import Customer, Invoice, Item, Payment

    _audit_seed_min_gl_accounts(company_master)
    h = _audit_master_headers(auth_super_headers, company_master)
    cust = Customer.objects.create(
        company=company_master,
        display_name="Split Tender Customer",
        customer_number="ST-001",
        is_active=True,
    )
    item = Item.objects.create(
        company=company_master,
        name="Split SKU",
        unit_price=Decimal("10.00"),
        quantity_on_hand=Decimal("10"),
    )
    r = api_client.post(
        "/api/cashier/pos/",
        data=json.dumps(
            {
                "payment_method": "cash",
                "customer_id": cust.id,
                "amount_paid_now": "3.00",
                "items": [{"item_id": item.id, "quantity": "1", "unit_price": "10.00"}],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201
    body = json.loads(r.content)
    assert body.get("invoice_status") == "partial"
    assert body.get("billing") == "split_cash_ar"
    assert "payment_id" in body
    inv = Invoice.objects.get(pk=body["invoice_id"])
    assert inv.status == "partial"
    assert inv.payment_method == "mixed"
    assert inv.total == Decimal("10.00")
    cust.refresh_from_db()
    assert cust.current_balance == Decimal("7.00")
    pid = body["payment_id"]
    p = Payment.objects.get(pk=pid)
    assert p.amount == Decimal("3.00")


def test_cashier_sale_fuel_happy_path(api_client: Client, auth_super_headers, company_master):
    from api.models import Meter, Tank

    nozzle = _audit_fuel_nozzle(company_master)
    meter_id = nozzle.meter_id
    tank_id = nozzle.tank_id
    qty = Decimal("2.5")
    h = _audit_master_headers(auth_super_headers, company_master)

    r = api_client.post(
        "/api/cashier/sale/",
        data=json.dumps({"nozzle_id": nozzle.id, "quantity": str(qty)}),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201
    body = json.loads(r.content)
    assert body.get("detail") == "Sale recorded"
    assert "invoice_id" in body

    meter = Meter.objects.get(pk=meter_id)
    assert meter.current_reading == Decimal("1000.0000") + qty

    tank = Tank.objects.get(pk=tank_id)
    assert tank.current_stock == Decimal("10000") - qty


def test_cashier_sale_validation_and_unknown_nozzle(
    api_client: Client, auth_super_headers, company_master
):
    h = _audit_master_headers(auth_super_headers, company_master)
    r400 = api_client.post(
        "/api/cashier/sale/",
        data=json.dumps({"quantity": "1"}),
        content_type="application/json",
        **h,
    )
    assert r400.status_code == 400

    r404 = api_client.post(
        "/api/cashier/sale/",
        data=json.dumps({"nozzle_id": 99999999, "quantity": "1"}),
        content_type="application/json",
        **h,
    )
    assert r404.status_code == 404


def test_reports_trial_balance_ok(api_client: Client, auth_super_headers, company_master):
    h = _audit_master_headers(auth_super_headers, company_master)
    r = api_client.get(
        "/api/reports/trial-balance/?start_date=2026-01-01&end_date=2026-12-31",
        **h,
    )
    assert r.status_code == 200
    data = json.loads(r.content)
    assert data.get("report_id") == "trial-balance"
    assert "accounts" in data and "period" in data


def test_reports_unknown_report_404(api_client: Client, auth_super_headers, company_master):
    h = _audit_master_headers(auth_super_headers, company_master)
    r = api_client.get("/api/reports/not-a-real-report/", **h)
    assert r.status_code == 404


def test_payment_invoice_allocation_clears_outstanding(
    api_client: Client, auth_super_headers, company_master
):
    _audit_seed_min_gl_accounts(company_master)
    h = _audit_master_headers(auth_super_headers, company_master)
    api_client.post("/api/customers/add-dummy/", **h)
    customer_id = json.loads(api_client.get("/api/customers/", **h).content)[0]["id"]
    item_r = api_client.post(
        "/api/items/",
        data=json.dumps({"name": "Alloc Item", "unit_price": "10.00"}),
        content_type="application/json",
        **h,
    )
    assert item_r.status_code == 201
    item_id = json.loads(item_r.content)["id"]
    inv_r = api_client.post(
        "/api/invoices/",
        data=json.dumps(
            {
                "customer_id": customer_id,
                "subtotal": "20.00",
                "tax_total": "0",
                "total": "20.00",
                "status": "sent",
                "lines": [
                    {
                        "item_id": item_id,
                        "quantity": "2",
                        "unit_price": "10.00",
                    }
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert inv_r.status_code == 201
    inv_id = json.loads(inv_r.content)["id"]

    out1 = json.loads(
        api_client.get("/api/payments/received/outstanding/", **h).content
    )
    assert len(out1) == 1

    pay = api_client.post(
        "/api/payments/received/",
        data=json.dumps(
            {
                "customer_id": customer_id,
                "amount": "20.00",
                "invoice_allocations": [
                    {"invoice_id": inv_id, "amount": "20.00"},
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert pay.status_code == 201
    pj = json.loads(pay.content)
    assert len(pj.get("invoice_allocations") or []) == 1

    out2 = json.loads(
        api_client.get("/api/payments/received/outstanding/", **h).content
    )
    assert out2 == []

    inv_one = json.loads(api_client.get(f"/api/invoices/{inv_id}/", **h).content)
    assert inv_one["status"] == "paid"
    assert Decimal(inv_one["balance_due"]) == Decimal("0")


def test_fund_transfer_unpost_removes_auto_gl_entry(
    api_client: Client, auth_super_headers, company_master
):
    from api.models import BankAccount, ChartOfAccount, JournalEntry

    h = _audit_master_headers(auth_super_headers, company_master)
    c1 = ChartOfAccount.objects.create(
        company=company_master,
        account_code="BX1",
        account_name="Bank GL 1",
        account_type="asset",
    )
    c2 = ChartOfAccount.objects.create(
        company=company_master,
        account_code="BX2",
        account_name="Bank GL 2",
        account_type="asset",
    )
    b1 = BankAccount.objects.create(
        company=company_master,
        chart_account=c1,
        account_name="Bank One",
        account_number="001",
        bank_name="Test",
    )
    b2 = BankAccount.objects.create(
        company=company_master,
        chart_account=c2,
        account_name="Bank Two",
        account_number="002",
        bank_name="Test",
    )
    ft_r = api_client.post(
        "/api/fund-transfers/",
        data=json.dumps(
            {
                "from_account_id": b1.id,
                "to_account_id": b2.id,
                "amount": "15.00",
            }
        ),
        content_type="application/json",
        **h,
    )
    assert ft_r.status_code == 201
    ft_id = json.loads(ft_r.content)["id"]
    post_r = api_client.post(f"/api/fund-transfers/{ft_id}/post/", **h)
    assert post_r.status_code == 200
    assert JournalEntry.objects.filter(
        company_id=company_master.id, entry_number=f"AUTO-FT-{ft_id}"
    ).exists()

    unpost_r = api_client.post(f"/api/fund-transfers/{ft_id}/unpost/", **h)
    assert unpost_r.status_code == 200
    assert not JournalEntry.objects.filter(
        company_id=company_master.id, entry_number=f"AUTO-FT-{ft_id}"
    ).exists()


def test_shift_open_sale_close_variance(
    api_client: Client, auth_super_headers, company_master
):
    _audit_seed_min_gl_accounts(company_master)
    h = _audit_master_headers(auth_super_headers, company_master)
    nozzle = _audit_fuel_nozzle(company_master)
    station_id = nozzle.tank.station_id
    product = nozzle.product
    product.cost = Decimal("90.00")
    product.unit = "L"
    product.save(update_fields=["cost", "unit"])

    op = api_client.post(
        "/api/shifts/sessions/open/",
        data=json.dumps(
            {"station_id": station_id, "opening_cash_float": "100.00"},
        ),
        content_type="application/json",
        **h,
    )
    assert op.status_code == 201
    sess = json.loads(op.content)
    sid = sess["id"]
    assert sess.get("opening_cash_float") == "100.00"

    sale = api_client.post(
        "/api/cashier/sale/",
        data=json.dumps(
            {
                "nozzle_id": nozzle.id,
                "quantity": "1",
                "shift_session_id": sid,
                "payment_method": "cash",
            }
        ),
        content_type="application/json",
        **h,
    )
    assert sale.status_code == 201

    active = json.loads(
        api_client.get("/api/shifts/sessions/active/", **h).content
    )
    assert active["id"] == sid
    assert Decimal(active["expected_cash_total"]) == Decimal(str(product.unit_price))

    cl = api_client.post(
        f"/api/shifts/sessions/{sid}/close/",
        data=json.dumps({"closing_cash_counted": "333.00"}),
        content_type="application/json",
        **h,
    )
    assert cl.status_code == 200
    closed = json.loads(cl.content)
    # variance = counted - (opening + expected cash sales)
    exp_end = Decimal("100") + Decimal(str(product.unit_price))
    assert Decimal(closed["cash_variance"]) == Decimal("333.00") - exp_end


def test_balance_sheet_includes_bank_account_chart_type(company_master):
    """bank_account COA lines are assets; they must appear on the balance sheet."""
    from api.models import ChartOfAccount
    from api.services.reporting import report_balance_sheet

    ChartOfAccount.objects.create(
        company_id=company_master.id,
        account_code="9998",
        account_name="Bank GL Type Test",
        account_type="bank_account",
        account_sub_type="checking",
        opening_balance=Decimal("50.00"),
    )
    out = report_balance_sheet(company_master.id, date(2026, 1, 1), date(2026, 12, 31))
    codes = [a["account_code"] for a in out["assets"]["accounts"]]
    assert "9998" in codes


def test_income_statement_treats_revenue_alias_as_income(company_master):
    """Legacy account_type 'revenue' must roll into P&L income section."""
    from api.models import ChartOfAccount, JournalEntry, JournalEntryLine
    from django.utils import timezone

    from api.services.reporting import report_income_statement

    acc = ChartOfAccount.objects.create(
        company_id=company_master.id,
        account_code="9997",
        account_name="Legacy Revenue Label",
        account_type="revenue",
        account_sub_type="other_income",
        opening_balance=Decimal("0"),
    )
    je = JournalEntry.objects.create(
        company_id=company_master.id,
        entry_number="TEST-PL-1",
        entry_date=date(2026, 6, 15),
        description="Test",
        is_posted=True,
        posted_at=timezone.now(),
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=acc, debit=Decimal("0"), credit=Decimal("40.00"), description=""
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=ChartOfAccount.objects.create(
            company_id=company_master.id,
            account_code="9996",
            account_name="Cash offset",
            account_type="asset",
            account_sub_type="cash_on_hand",
            opening_balance=Decimal("0"),
        ),
        debit=Decimal("40.00"),
        credit=Decimal("0"),
        description="",
    )

    pl = report_income_statement(company_master.id, date(2026, 6, 1), date(2026, 6, 30))
    inc_codes = [a["account_code"] for a in pl["income"]["accounts"]]
    assert "9997" in inc_codes


# --- SaaS: station operational purge (super admin) ---


def test_admin_company_stations_forbidden_for_company_admin(api_client, auth_admin_headers, company_tenant):
    r = api_client.get(
        f"/api/admin/companies/{company_tenant.id}/stations/",
        **auth_admin_headers,
    )
    assert r.status_code == 403


def test_admin_company_stations_list_ok(api_client, auth_super_headers, company_tenant):
    from api.models import Station

    Station.objects.create(company_id=company_tenant.id, station_name="Audit Station A")
    r = api_client.get(
        f"/api/admin/companies/{company_tenant.id}/stations/",
        **auth_super_headers,
    )
    assert r.status_code == 200
    data = json.loads(r.content)
    assert data["company_id"] == company_tenant.id
    assert len(data["stations"]) >= 1
    assert data["stations"][0]["station_name"]


def test_admin_station_purge_requires_confirm_phrase(api_client, auth_super_headers, company_tenant):
    from api.models import Item, Station, Tank

    item = Item.objects.create(company_id=company_tenant.id, name="Purge phrase test fuel")
    st = Station.objects.create(company_id=company_tenant.id, station_name="Phrase station")
    Tank.objects.create(company_id=company_tenant.id, station=st, product=item, tank_name="T-phrase")
    r = api_client.post(
        f"/api/admin/companies/{company_tenant.id}/stations/{st.id}/purge/",
        data=json.dumps({"confirm_phrase": "wrong"}),
        content_type="application/json",
        **auth_super_headers,
    )
    assert r.status_code == 400
    assert Station.objects.filter(pk=st.pk).exists()


def test_admin_station_purge_removes_forecourt_keeps_items(api_client, auth_super_headers, company_tenant):
    from api.models import Item, Station, Tank
    from api.services.tenant_backup import RESTORE_CONFIRM_PHRASE

    item = Item.objects.create(company_id=company_tenant.id, name="Keep after purge")
    st_a = Station.objects.create(company_id=company_tenant.id, station_name="Station A")
    st_b = Station.objects.create(company_id=company_tenant.id, station_name="Station B")
    Tank.objects.create(company_id=company_tenant.id, station=st_a, product=item, tank_name="TA")
    Tank.objects.create(company_id=company_tenant.id, station=st_b, product=item, tank_name="TB")

    r = api_client.post(
        f"/api/admin/companies/{company_tenant.id}/stations/{st_a.id}/purge/",
        data=json.dumps({"confirm_phrase": RESTORE_CONFIRM_PHRASE}),
        content_type="application/json",
        **auth_super_headers,
    )
    assert r.status_code == 200, r.content.decode()
    out = json.loads(r.content)
    assert out.get("station_id") == st_a.id

    assert not Station.objects.filter(pk=st_a.pk).exists()
    assert Station.objects.filter(pk=st_b.pk).exists()
    assert Tank.objects.filter(company_id=company_tenant.id).count() == 1
    assert Item.objects.filter(pk=item.pk).exists()


def test_delete_station_operational_data_keeps_station_row(company_tenant):
    from api.models import Item, Station, Tank
    from api.services.tenant_backup import delete_station_operational_data

    item = Item.objects.create(company_id=company_tenant.id, name="Shell row")
    st = Station.objects.create(company_id=company_tenant.id, station_name="Keep row")
    Tank.objects.create(company_id=company_tenant.id, station=st, product=item, tank_name="T1")
    delete_station_operational_data(company_tenant.id, st.id, remove_station_record=False)
    assert Station.objects.filter(pk=st.pk).exists()
    assert Tank.objects.filter(station_id=st.id).count() == 0
