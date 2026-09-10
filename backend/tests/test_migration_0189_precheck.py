"""The 0189 pre-check must catch bad live data before the constraints try to.

A constraint that fails mid-``migrate`` leaves a deploy half-applied. These cover the two
pre-check functions directly, against rows that really violate the constraints — the check
constraint is dropped inside the test transaction so such a row can exist at all, exactly as
it would on a database that predates 0189.
"""
from __future__ import annotations

import importlib
from decimal import Decimal

import pytest
from django.apps import apps as django_apps
from django.core.exceptions import ValidationError
from django.db import connection

from api.models import Customer, Payment

pytestmark = pytest.mark.django_db(transaction=False)

_mig = importlib.import_module("api.migrations.0189_audit_controls_uniques_indexes_meter")


def _drop_constraint(name: str, table: str) -> None:
    """A conditional UniqueConstraint is a partial unique index, not a table constraint."""
    with connection.cursor() as cur:
        cur.execute(f'ALTER TABLE "{table}" DROP CONSTRAINT IF EXISTS "{name}"')
        cur.execute(f'DROP INDEX IF EXISTS "{name}"')


def test_precheck_rejects_a_negative_payment(company_tenant):
    _drop_constraint("payment_nonneg_amount", Payment._meta.db_table)
    Payment.objects.create(
        company=company_tenant,
        payment_type="received",
        payment_date="2026-01-15",
        amount=Decimal("-500.00"),
    )
    with pytest.raises(ValidationError) as exc:
        _mig.assert_no_negative_amounts(django_apps, connection.schema_editor())
    msg = str(exc.value)
    assert "Payment" in msg
    assert "negative" in msg.lower()
    assert "restates the books" in msg, "the message must say why it refuses to auto-correct"


def test_precheck_passes_on_clean_amounts(company_tenant):
    Payment.objects.create(
        company=company_tenant,
        payment_type="received",
        payment_date="2026-01-15",
        amount=Decimal("500.00"),
    )
    _mig.assert_no_negative_amounts(django_apps, connection.schema_editor())


def test_precheck_renames_duplicate_reference_numbers_without_deleting(company_tenant):
    _drop_constraint("customer_company_number_uniq", Customer._meta.db_table)
    first = Customer.objects.create(
        company=company_tenant, display_name="Dup One", customer_number="C-100"
    )
    second = Customer.objects.create(
        company=company_tenant, display_name="Dup Two", customer_number="C-100"
    )
    third = Customer.objects.create(
        company=company_tenant, display_name="Dup Three", customer_number="C-100"
    )

    _mig.rename_duplicate_reference_numbers(django_apps, connection.schema_editor())

    first.refresh_from_db()
    second.refresh_from_db()
    third.refresh_from_db()
    assert first.customer_number == "C-100", "the oldest row keeps the number"
    assert second.customer_number == "C-100~DUP2"
    assert third.customer_number == "C-100~DUP3"
    # Nothing was deleted — the whole point of renaming instead.
    assert Customer.objects.filter(
        id__in=[first.id, second.id, third.id]
    ).count() == 3
