"""Access profile upsert + job-type allow-list approval."""

from api.services.tenant_job_types import approve_access_profile_for_job_type


def test_approve_noop_when_no_allow_list(company_tenant):
    from api.models import CompanyJobType, CompanyRole

    company = company_tenant
    role = CompanyRole.objects.create(
        company=company, name="Temp profile", permissions=["app.pos"]
    )
    jt = CompanyJobType.objects.create(
        company=company,
        key="cashier",
        label="Cashier",
        inherits_from="cashier",
        is_custom=False,
        access_profile_enabled=True,
    )
    assert approve_access_profile_for_job_type(company.id, "cashier", role.id) is False
    assert jt.allowed_roles.count() == 0


def test_approve_extends_existing_allow_list(company_tenant):
    from api.models import CompanyJobType, CompanyRole

    company = company_tenant
    approved = CompanyRole.objects.create(
        company=company, name="Approved", permissions=["app.pos"]
    )
    newbie = CompanyRole.objects.create(
        company=company, name="Newbie", permissions=["app.launcher", "app.pos"]
    )
    jt = CompanyJobType.objects.create(
        company=company,
        key="cashier",
        label="Cashier",
        inherits_from="cashier",
        is_custom=False,
        access_profile_enabled=True,
    )
    jt.allowed_roles.add(approved)
    assert approve_access_profile_for_job_type(company.id, "cashier", newbie.id) is True
    assert set(jt.allowed_roles.values_list("id", flat=True)) == {approved.id, newbie.id}
