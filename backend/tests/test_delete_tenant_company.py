"""Permanent tenant purge: delete_tenant_company_data leaves no scoped or orphan rows."""

from __future__ import annotations

import pytest

from api.models import (
    Broadcast,
    BroadcastRead,
    Company,
    Customer,
    TenantPlatformReleaseEvent,
    User,
)
from api.services.tenant_backup import delete_tenant_company_data


@pytest.mark.django_db
def test_delete_tenant_clears_global_broadcast_reads_and_release_events():
    co = Company.objects.create(
        name="Purge Test Co",
        currency="BDT",
        is_master="false",
        is_deleted=False,
        is_active=True,
    )
    u = User(
        username="purgetest@example.com",
        email="purgetest@example.com",
        full_name="Purge Test",
        role="admin",
        company_id=co.id,
    )
    u.set_password("Test#99ab")
    u.save()

    global_bc = Broadcast.objects.create(company_id=None, title="All tenants", message="hi")
    br = BroadcastRead.objects.create(user_id=u.id, broadcast=global_bc)
    tenant_bc = Broadcast.objects.create(company_id=co.id, title="One tenant", message="x")
    TenantPlatformReleaseEvent.objects.create(company=co, category="apply_release")
    Customer.objects.create(company=co, display_name="C1", company_name="C1")

    delete_tenant_company_data(co.id)

    assert not Company.objects.filter(pk=co.pk).exists()
    assert not User.objects.filter(pk=u.pk).exists()
    assert not Customer.objects.filter(company_id=co.id).exists()
    assert not BroadcastRead.objects.filter(pk=br.pk).exists()
    assert Broadcast.objects.filter(pk=global_bc.pk).exists()
    assert not Broadcast.objects.filter(pk=tenant_bc.pk).exists()
    assert not TenantPlatformReleaseEvent.objects.filter(company_id=co.id).exists()
