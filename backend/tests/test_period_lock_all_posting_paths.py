"""Every path that posts a journal must respect the closed-period lock.

`assert_period_open` was enforced in exactly one place — `gl_posting._create_posted_entry`.
Two aquaculture paths build a `JournalEntry` by hand and set `is_posted = True` themselves,
so a backdated pond profit transfer silently restated closed books and the whole period-lock
suite stayed green. See `docs/APPLICATION_AUDIT_FINDINGS.md`.

The guard test at the end is the one that matters long-term: it fails when a *new* posting path
is added without the lock.
"""
from __future__ import annotations

import json
import re
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

pytestmark = pytest.mark.django_db

LOCKED_THROUGH = date(2026, 6, 30)
INSIDE_LOCK = date(2026, 5, 15)


def _acc(company_id, code, name, typ, sub=""):
    from api.models import ChartOfAccount

    return ChartOfAccount.objects.get_or_create(
        company_id=company_id,
        account_code=code,
        defaults={
            "account_name": name,
            "account_type": typ,
            "account_sub_type": sub,
            "is_active": True,
        },
    )[0]


def test_a_backdated_pond_profit_transfer_cannot_post_into_closed_books(
    api_client, auth_super_headers, company_master
):
    from api.models import AquaculturePond, Company, JournalEntry
    from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts
    from tests.test_api_production_audit import (
        _audit_master_headers,
        _audit_seed_min_gl_accounts,
    )

    cid = company_master.id
    _audit_seed_min_gl_accounts(company_master)
    Company.objects.filter(pk=cid).update(
        aquaculture_enabled=True,
        aquaculture_licensed=True,
        books_locked_through=LOCKED_THROUGH,
    )
    ensure_aquaculture_chart_accounts(cid)
    h = _audit_master_headers(auth_super_headers, company_master)

    pond = AquaculturePond.objects.create(
        company_id=cid, name="Locked Pond", pond_role="grow_out", is_active=True
    )
    debit = _acc(cid, "3000", "Owner Capital", "equity", "owners_equity")
    credit = _acc(cid, "1010", "Cash", "asset", "cash_on_hand")

    before = JournalEntry.objects.filter(company_id=cid, is_posted=True).count()
    r = api_client.post(
        "/api/aquaculture/pond-profit-transfers/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "transfer_date": INSIDE_LOCK.isoformat(),
                "amount": "5000.00",
                "debit_account_id": debit.id,
                "credit_account_id": credit.id,
                "post": True,
                "memo": "backdated into a closed period",
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 400, (
        "a profit transfer dated inside books_locked_through must be refused, not posted: "
        + r.content.decode()
    )
    assert "closed" in r.content.decode().lower()
    assert JournalEntry.objects.filter(company_id=cid, is_posted=True).count() == before, (
        "nothing may reach the ledger for a rejected backdated transfer"
    )


def test_the_same_transfer_posts_normally_in_an_open_period(
    api_client, auth_super_headers, company_master
):
    """The guard must refuse the closed period without blocking ordinary work."""
    from api.models import AquaculturePond, Company
    from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts
    from tests.test_api_production_audit import (
        _audit_master_headers,
        _audit_seed_min_gl_accounts,
    )

    cid = company_master.id
    _audit_seed_min_gl_accounts(company_master)
    Company.objects.filter(pk=cid).update(
        aquaculture_enabled=True,
        aquaculture_licensed=True,
        books_locked_through=LOCKED_THROUGH,
    )
    ensure_aquaculture_chart_accounts(cid)
    h = _audit_master_headers(auth_super_headers, company_master)

    pond = AquaculturePond.objects.create(
        company_id=cid, name="Open Pond", pond_role="grow_out", is_active=True
    )
    debit = _acc(cid, "3000", "Owner Capital", "equity", "owners_equity")
    credit = _acc(cid, "1010", "Cash", "asset", "cash_on_hand")

    r = api_client.post(
        "/api/aquaculture/pond-profit-transfers/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "transfer_date": date(2026, 8, 1).isoformat(),
                "amount": "5000.00",
                "debit_account_id": debit.id,
                "credit_account_id": credit.id,
                "post": True,
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code in (200, 201), r.content.decode()


def test_no_posting_path_sets_is_posted_without_the_period_lock():
    """Guard: a new hand-rolled posting path must not reintroduce the bypass.

    Any module that sets ``is_posted = True`` on a JournalEntry outside gl_posting must also
    reference the period lock. This is the check that would have caught the original defect.
    """
    api_dir = Path(__file__).resolve().parent.parent / "api"
    allowed = {
        # The single chokepoint that owns the lock, and the manual-journal endpoint that
        # calls period_lock_error itself before flipping the flag.
        "gl_posting.py",
        "journal_entries_views.py",
        # Test/bootstrap seeding, never a user-facing posting path.
        "comprehensive_demo_seed.py",
    }
    offenders: list[str] = []
    for path in api_dir.rglob("*.py"):
        if path.name in allowed or "migrations" in path.parts:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        # Only an *attribute assignment* flips an existing row to posted;
        # `filter(is_posted=True)` is a read. And a module must build a JournalEntry of
        # its own to be a posting path — `FundTransfer.is_posted` is a document flag whose
        # journal goes through gl_posting, where the lock already lives.
        if not re.search(r"\.is_posted\s*=\s*True", text):
            continue
        if "JournalEntry(" not in text:
            continue
        if "assert_period_open" in text or "period_lock_error" in text:
            continue
        offenders.append(str(path.relative_to(api_dir)))
    assert not offenders, (
        "these modules post a journal without enforcing the accounting period lock: "
        + ", ".join(sorted(offenders))
    )
