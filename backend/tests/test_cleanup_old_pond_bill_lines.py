"""Cleanup of legacy pond bill lines without reporting categories."""
from __future__ import annotations

import json
from decimal import Decimal

import pytest

from api.models import AquaculturePond, Bill, BillLine, Company, Vendor
from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts
from api.services.aquaculture_pond_bill_line_cleanup import cleanup_old_uncategorized_pond_bill_lines
from tests.conftest import seed_min_gl_accounts


@pytest.mark.django_db
def test_cleanup_removes_uncategorized_pond_bill_lines(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    ensure_aquaculture_chart_accounts(company_tenant.id)
    seed_min_gl_accounts(company_tenant)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="Legacy Pond", is_active=True)
    vendor = Vendor.objects.create(
        company_id=company_tenant.id,
        vendor_number="V-LEG-1",
        company_name="Legacy Vendor",
        is_active=True,
    )

    bill = Bill.objects.create(
        company_id=company_tenant.id,
        vendor=vendor,
        bill_number="BILL-LEG-1",
        bill_date="2025-12-01",
        status="open",
        subtotal=Decimal("50"),
        tax_total=Decimal("0"),
        total=Decimal("50"),
    )
    BillLine.objects.create(
        bill=bill,
        description="Old pond cost without category",
        quantity=1,
        unit_price=Decimal("50"),
        amount=Decimal("50"),
        aquaculture_pond=pond,
        aquaculture_cost_bucket="electricity",
        tenant_reporting_category_id=None,
    )

    dry = cleanup_old_uncategorized_pond_bill_lines(company_tenant.id, dry_run=True)
    assert dry["lines_matched"] == 1

    stats = cleanup_old_uncategorized_pond_bill_lines(company_tenant.id, dry_run=False)
    assert stats["lines_removed"] == 1
    assert stats["bills_deleted"] == 1
    assert not Bill.objects.filter(pk=bill.id).exists()
    assert not BillLine.objects.filter(bill_id=bill.id).exists()


@pytest.mark.django_db
def test_cleanup_keeps_categorized_pond_bill_lines(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    ensure_aquaculture_chart_accounts(company_tenant.id)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="P1", is_active=True)
    vendor = Vendor.objects.create(
        company_id=company_tenant.id,
        vendor_number="V-LEG-2",
        company_name="Vendor",
        is_active=True,
    )

    create = api_client.post(
        "/api/reporting-categories/",
        data=json.dumps(
            {
                "application": "aquaculture",
                "kind": "expense",
                "label": "Site security",
                "maps_to_code": "electricity",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert create.status_code == 201
    cat_id = json.loads(create.content.decode())["id"]

    bill = Bill.objects.create(
        company_id=company_tenant.id,
        vendor=vendor,
        bill_number="BILL-LEG-2",
        bill_date="2025-12-01",
        status="draft",
        subtotal=Decimal("30"),
        tax_total=Decimal("0"),
        total=Decimal("30"),
    )
    BillLine.objects.create(
        bill=bill,
        description="Categorized pond line",
        quantity=1,
        unit_price=Decimal("30"),
        amount=Decimal("30"),
        aquaculture_pond=pond,
        aquaculture_cost_bucket="electricity",
        tenant_reporting_category_id=cat_id,
    )

    stats = cleanup_old_uncategorized_pond_bill_lines(company_tenant.id, dry_run=False)
    assert stats["lines_matched"] == 0
    assert BillLine.objects.filter(bill_id=bill.id).count() == 1
