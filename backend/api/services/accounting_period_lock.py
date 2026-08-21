"""
Accounting period close (the "closing date" control every ledger needs).

Once a period is reported on — VAT filed, statements issued, a year signed off — its numbers
must stop moving. Without a lock, a backdated invoice edit, a re-posted bill, or an unposted
journal silently restates a period someone has already acted on, and nobody finds out until
the next reconciliation fails.

``Company.books_locked_through`` is that line. GL activity dated on or before it is final:

* nothing new posts into it (every AUTO-* journal goes through ``gl_posting._create_posted_entry``),
* documents dated in it cannot be edited, re-posted, or deleted,
* posted journals in it cannot be edited, unposted, or removed.

Blank means the books are open, which is the default — a tenant opts in by setting a date.
Moving the date is a deliberate company-settings change, not something a posting path can do.

Reads are never blocked, and never fail because of the lock: a report that self-heals postings
(see ``backfill_invoice_cogs_journals``) must skip locked periods rather than raise.
"""
from __future__ import annotations

from datetime import date

from api.exceptions import GlPostingError
from api.models import Company


def books_lock_date(company_id: int | None) -> date | None:
    """The company's closing date, or None when the books are open."""
    if not company_id:
        return None
    return (
        Company.objects.filter(pk=company_id)
        .values_list("books_locked_through", flat=True)
        .first()
    )


def is_period_locked(company_id: int | None, on_date: date | None) -> bool:
    """True when ``on_date`` falls in a closed period."""
    if on_date is None:
        return False
    lock = books_lock_date(company_id)
    return lock is not None and on_date <= lock


def period_lock_error(
    company_id: int | None, on_date: date | None, *, action: str = "post"
) -> str | None:
    """Message to show the user, or None when the date is in an open period."""
    if not is_period_locked(company_id, on_date):
        return None
    lock = books_lock_date(company_id)
    return (
        "The accounting period is closed: the books are locked through %s, so you cannot %s "
        "anything dated %s. Ask an administrator to move the closing date in Company settings, "
        "or record the correction in an open period instead."
        % (lock.isoformat(), action, on_date.isoformat())
    )


def assert_period_open(
    company_id: int | None, on_date: date | None, *, action: str = "post"
) -> None:
    """Raise GlPostingError (HTTP 400 at the view layer) when the date sits in a closed period."""
    err = period_lock_error(company_id, on_date, action=action)
    if err:
        raise GlPostingError(err)
