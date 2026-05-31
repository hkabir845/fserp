"""Opening balance for aquaculture landlords: subledger adjustment and optional G/L."""
from __future__ import annotations

import logging
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction

from api.models import AquacultureLandlord, AquacultureLandlordLedgerEntry
from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts
from api.services.aquaculture_cutover import validate_opening_as_of
from api.services.gl_posting import CODE_AQ_LEASE_EXPENSE, _coa, _create_posted_entry
from api.services.loan_counterparty_opening import resolve_opening_balance_equity

logger = logging.getLogger(__name__)

OPENING_REFERENCE = "OPENING"


def _decimal(val, default="0") -> Decimal:
    if val is None:
        return Decimal(default)
    try:
        return Decimal(str(val).strip().replace(",", "") or default)
    except Exception:
        return Decimal(default)


def _parse_date(val) -> date | None:
    if val in (None, ""):
        return None
    if isinstance(val, date):
        return val
    s = str(val).strip()[:10]
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def _money_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def landlord_opening_fields_for_api(ll: AquacultureLandlord) -> dict:
    locked = bool(ll.opening_balance_journal_id) or _landlord_has_non_opening_ledger_activity(ll)
    je_num = ""
    if ll.opening_balance_journal_id and ll.opening_balance_journal:
        je_num = (ll.opening_balance_journal.entry_number or "").strip()
    return {
        "opening_balance": str(ll.opening_balance or Decimal("0")),
        "opening_balance_date": (
            ll.opening_balance_date.isoformat() if ll.opening_balance_date else None
        ),
        "opening_balance_locked": locked,
        "opening_balance_journal_id": ll.opening_balance_journal_id,
        "opening_balance_journal_number": je_num,
    }


def _landlord_has_non_opening_ledger_activity(ll: AquacultureLandlord) -> bool:
    qs = AquacultureLandlordLedgerEntry.objects.filter(landlord_id=ll.id)
    if ll.opening_balance_ledger_entry_id:
        qs = qs.exclude(pk=ll.opening_balance_ledger_entry_id)
    return qs.exists()


def parse_landlord_opening_from_body(body: dict) -> tuple[Decimal, date | None, bool, str | None]:
    """Return (amount, as_of, post_to_gl, error_message)."""
    ob_amt = _money_q(_decimal(body.get("opening_balance")))
    as_of = _parse_date(body.get("opening_balance_date"))
    post_gl = bool(body.get("post_opening_to_gl", True))
    if abs(ob_amt) <= Decimal("0.005"):
        return Decimal("0"), None, post_gl, None
    if not as_of:
        return ob_amt, None, post_gl, "opening_balance_date is required for a non-zero opening balance"
    return ob_amt, as_of, post_gl, None


def sync_landlord_opening_ledger(ll: AquacultureLandlord) -> None:
    """Create, update, or remove the OPENING adjustment row from opening_balance fields."""
    amt = ll.opening_balance or Decimal("0")
    as_of = ll.opening_balance_date
    ent_id = ll.opening_balance_ledger_entry_id

    if abs(amt) <= Decimal("0.005"):
        if ent_id:
            AquacultureLandlordLedgerEntry.objects.filter(pk=ent_id).delete()
            AquacultureLandlord.objects.filter(pk=ll.pk).update(opening_balance_ledger_entry_id=None)
            ll.opening_balance_ledger_entry_id = None
        return

    if not as_of:
        raise ValueError("opening_balance_date is required for a non-zero opening balance")

    memo = "Opening balance"
    if ent_id:
        AquacultureLandlordLedgerEntry.objects.filter(pk=ent_id).update(
            entry_date=as_of,
            amount_signed=amt,
            memo=memo,
            reference=OPENING_REFERENCE,
        )
        return

    ent = AquacultureLandlordLedgerEntry.objects.create(
        landlord_id=ll.id,
        pond_id=None,
        entry_date=as_of,
        kind=AquacultureLandlordLedgerEntry.KIND_ADJUSTMENT,
        amount_signed=amt,
        memo=memo,
        reference=OPENING_REFERENCE,
    )
    AquacultureLandlord.objects.filter(pk=ll.pk).update(opening_balance_ledger_entry_id=ent.id)
    ll.opening_balance_ledger_entry_id = ent.id


def delete_landlord_opening_journal(company_id: int, landlord_id: int) -> int:
    from api.models import JournalEntry

    deleted, _ = JournalEntry.objects.filter(
        company_id=company_id,
        entry_number=f"AUTO-LL-OB-{landlord_id}",
    ).delete()
    return deleted


def post_landlord_opening_gl(company_id: int, ll: AquacultureLandlord, *, post_to_gl: bool = True) -> bool:
    """
    Positive opening (we owe): Dr 6711 lease expense, Cr opening balance equity.
    Negative opening (credit): Dr opening balance equity, Cr 6711.
    """
    if ll.opening_balance_journal_id:
        return True

    amt = ll.opening_balance or Decimal("0")
    if abs(amt) <= Decimal("0.005"):
        return True
    if not ll.opening_balance_date:
        return False
    if not post_to_gl:
        return True

    ensure_aquaculture_chart_accounts(company_id)
    lease_acc = _coa(company_id, CODE_AQ_LEASE_EXPENSE)
    equity = resolve_opening_balance_equity(company_id)
    if not lease_acc or not equity:
        logger.warning(
            "company %s landlord %s: missing 6711 or opening balance equity for opening G/L",
            company_id,
            ll.id,
        )
        return False

    mag = abs(amt).quantize(Decimal("0.01"))
    ll_name = (ll.name or f"Landlord #{ll.id}").strip()[:120]
    memo = f"Landlord opening balance — {ll_name}"[:280]
    if amt > 0:
        lines = [
            (lease_acc, mag, Decimal("0"), memo),
            (equity, Decimal("0"), mag, memo),
        ]
        desc = f"Aquaculture landlord opening payable — {ll_name}"[:500]
    else:
        lines = [
            (equity, mag, Decimal("0"), memo),
            (lease_acc, Decimal("0"), mag, memo),
        ]
        desc = f"Aquaculture landlord opening credit — {ll_name}"[:500]

    entry_number = f"AUTO-LL-OB-{ll.id}"
    with transaction.atomic():
        delete_landlord_opening_journal(company_id, ll.id)
        je = _create_posted_entry(company_id, ll.opening_balance_date, entry_number, desc, lines)
        if not je:
            return False
        AquacultureLandlord.objects.filter(pk=ll.pk, company_id=company_id).update(
            opening_balance_journal_id=je.id
        )
    ll.opening_balance_journal_id = je.id
    return True


def apply_landlord_opening_from_body(
    ll: AquacultureLandlord, company_id: int, body: dict, *, allow_when_locked: bool = False
) -> str | None:
    """Update opening fields and sync subledger + G/L. Returns error message or None."""
    if not any(k in body for k in ("opening_balance", "opening_balance_date", "post_opening_to_gl")):
        return None

    locked = bool(ll.opening_balance_journal_id) or _landlord_has_non_opening_ledger_activity(ll)
    if locked and not allow_when_locked:
        return "Opening balance cannot be changed after other ledger activity or after it is posted to the G/L."

    merged = {
        "opening_balance": body.get("opening_balance", ll.opening_balance),
        "opening_balance_date": body.get(
            "opening_balance_date",
            ll.opening_balance_date.isoformat() if ll.opening_balance_date else None,
        ),
        "post_opening_to_gl": body.get("post_opening_to_gl", True),
    }
    ob_amt, as_of, post_gl, err = parse_landlord_opening_from_body(merged)
    if err:
        return err
    if as_of:
        cut_err = validate_opening_as_of(company_id, as_of)
        if cut_err:
            return cut_err

    ll.opening_balance = ob_amt
    ll.opening_balance_date = as_of
    ll.save(update_fields=["opening_balance", "opening_balance_date", "updated_at"])

    try:
        with transaction.atomic():
            sync_landlord_opening_ledger(ll)
            ll.refresh_from_db()
            if not post_landlord_opening_gl(company_id, ll, post_to_gl=post_gl):
                if post_gl and abs(ob_amt) > Decimal("0.005"):
                    return (
                        "Could not post opening balance to the general ledger. "
                        "Ensure accounts 6711 and 3200 exist, or set post_opening_to_gl to false."
                    )
    except ValueError as ex:
        return str(ex)
    return None
