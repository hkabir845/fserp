"""
Aquaculture working-capital financing: overview, pond allocations, P&L-based repayment worksheet.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone as django_timezone

from api.models import (
    AquacultureFinancingAllocation,
    AquaculturePond,
    AquaculturePondProfitTransfer,
    ChartOfAccount,
    JournalEntry,
    JournalEntryLine,
    Loan,
    LoanDisbursement,
    LoanRepayment,
)
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.services.loan_posting import post_loan_repayment

METHOD_PROFIT_SHARE = "profit_share"
METHOD_REVENUE_SHARE = "revenue_share"
METHOD_EQUAL = "equal"
REPAYMENT_METHODS = (METHOD_PROFIT_SHARE, METHOD_REVENUE_SHARE, METHOD_EQUAL)


def _money(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _dec(val) -> Decimal:
    if val is None or val == "":
        return Decimal("0")
    return Decimal(str(val))


def _allocate_cents(total: Decimal, weights: list[tuple[int, Decimal]]) -> list[tuple[int, Decimal]]:
    """Split total across ponds; last row absorbs rounding remainder."""
    total = _money(total)
    if total <= 0:
        return [(pid, Decimal("0")) for pid, _ in weights]
    if not weights:
        return []
    wsum = sum((w for _, w in weights), Decimal("0"))
    if wsum <= 0:
        n = len(weights)
        base = _money(total / n)
        out = [(pid, base) for pid, _ in weights]
        rem = total - sum(a for _, a in out)
        if rem != 0 and out:
            pid, amt = out[-1]
            out[-1] = (pid, _money(amt + rem))
        return out
    allocated: list[tuple[int, Decimal]] = []
    running = Decimal("0")
    for i, (pid, w) in enumerate(weights):
        if i == len(weights) - 1:
            amt = _money(total - running)
        else:
            amt = _money(total * w / wsum)
            running += amt
        allocated.append((pid, amt))
    return allocated


def _aquaculture_loans_qs(company_id: int):
    return (
        Loan.objects.filter(
            company_id=company_id,
            aquaculture_financing=True,
            direction=Loan.DIRECTION_BORROWED,
        )
        .select_related("counterparty", "station")
        .order_by("-created_at", "-id")
    )


def build_financing_overview(company_id: int) -> dict[str, Any]:
    loans = list(_aquaculture_loans_qs(company_id))
    loan_payload = []
    total_outstanding = Decimal("0")
    for lo in loans:
        out = lo.outstanding_principal or Decimal("0")
        total_outstanding += out
        loan_payload.append(
            {
                "id": lo.id,
                "loan_no": lo.loan_no,
                "title": lo.title or "",
                "status": lo.status,
                "counterparty_name": (lo.counterparty.name if lo.counterparty_id else "") or "",
                "sanction_amount": str(lo.sanction_amount or 0),
                "outstanding_principal": str(out),
                "total_disbursed": str(lo.total_disbursed or 0),
                "total_repaid_principal": str(lo.total_repaid_principal or 0),
                "start_date": lo.start_date.isoformat() if lo.start_date else None,
                "maturity_date": lo.maturity_date.isoformat() if lo.maturity_date else None,
                "station_id": lo.station_id,
                "station_name": (lo.station.station_name if lo.station_id and lo.station else "") or "",
            }
        )

    recent_disbursements = []
    for d in (
        LoanDisbursement.objects.filter(loan__company_id=company_id, loan__aquaculture_financing=True)
        .select_related("loan")
        .order_by("-disbursement_date", "-id")[:30]
    ):
        recent_disbursements.append(
            {
                "id": d.id,
                "loan_id": d.loan_id,
                "loan_no": d.loan.loan_no,
                "disbursement_date": d.disbursement_date.isoformat(),
                "amount": str(d.amount),
                "reference": d.reference or "",
            }
        )

    allocations_by_loan: dict[int, dict[str, str]] = {}
    for row in (
        AquacultureFinancingAllocation.objects.filter(company_id=company_id)
        .values("loan_id", "allocation_kind")
        .annotate(total=Sum("amount"))
    ):
        lid = int(row["loan_id"])
        kind = row["allocation_kind"] or AquacultureFinancingAllocation.KIND_USE
        allocations_by_loan.setdefault(lid, {})
        allocations_by_loan[lid][kind] = str(_money(Decimal(str(row["total"] or 0))))

    recent_allocations = []
    for a in (
        AquacultureFinancingAllocation.objects.filter(company_id=company_id)
        .select_related("loan", "pond")
        .order_by("-allocation_date", "-id")[:40]
    ):
        recent_allocations.append(_allocation_json(a))

    active_ponds = list(
        AquaculturePond.objects.filter(company_id=company_id, is_active=True)
        .order_by("sort_order", "id")
        .values("id", "name")
    )

    return {
        "loans": loan_payload,
        "totals": {
            "outstanding_principal": str(_money(total_outstanding)),
            "loan_count": len(loans),
        },
        "recent_disbursements": recent_disbursements,
        "allocations_by_loan": allocations_by_loan,
        "recent_allocations": recent_allocations,
        "active_ponds": active_ponds,
        "repayment_methods": [
            {"id": METHOD_PROFIT_SHARE, "label": "By pond profit (positive only)"},
            {"id": METHOD_REVENUE_SHARE, "label": "By pond revenue"},
            {"id": METHOD_EQUAL, "label": "Equal across active ponds"},
        ],
    }


def _allocation_json(a: AquacultureFinancingAllocation) -> dict:
    return {
        "id": a.id,
        "loan_id": a.loan_id,
        "loan_no": a.loan.loan_no if a.loan_id else "",
        "pond_id": a.pond_id,
        "pond_name": (a.pond.name if a.pond_id else "") or "",
        "allocation_date": a.allocation_date.isoformat(),
        "amount": str(a.amount),
        "allocation_kind": a.allocation_kind,
        "disbursement_id": a.disbursement_id,
        "profit_transfer_id": a.profit_transfer_id,
        "memo": a.memo or "",
    }


def compute_repayment_worksheet(
    company_id: int,
    *,
    loan_id: int,
    start: date,
    end: date,
    method: str,
    total_amount: Decimal,
) -> dict[str, Any]:
    if method not in REPAYMENT_METHODS:
        raise ValueError(f"method must be one of: {', '.join(REPAYMENT_METHODS)}")
    lo = Loan.objects.filter(
        id=loan_id, company_id=company_id, aquaculture_financing=True
    ).first()
    if not lo:
        raise LookupError("Aquaculture financing loan not found")
    total_amount = _money(total_amount)
    if total_amount <= 0:
        raise ValueError("total_amount must be positive")

    pl = compute_aquaculture_pl_summary_dict(
        company_id=company_id,
        start=start,
        end=end,
        pond_filter_id=None,
        cycle_filter_id=None,
        scoped_cycle=None,
        include_cycle_breakdown=False,
    )
    pond_rows = pl.get("ponds") or []
    weights: list[tuple[int, Decimal]] = []
    detail: list[dict] = []
    for row in pond_rows:
        pid = int(row["pond_id"])
        profit = _dec(row.get("profit"))
        revenue = _dec(row.get("revenue"))
        if method == METHOD_PROFIT_SHARE:
            w = profit if profit > 0 else Decimal("0")
        elif method == METHOD_REVENUE_SHARE:
            w = revenue if revenue > 0 else Decimal("0")
        else:
            w = Decimal("1")
        weights.append((pid, w))
        detail.append(
            {
                "pond_id": pid,
                "pond_name": row.get("pond_name") or "",
                "revenue": str(revenue),
                "profit": str(profit),
                "weight": str(w),
            }
        )

    amounts = _allocate_cents(total_amount, weights)
    amt_map = {pid: amt for pid, amt in amounts}
    suggested = []
    for d in detail:
        pid = d["pond_id"]
        amt = amt_map.get(pid, Decimal("0"))
        suggested.append(
            {
                **d,
                "suggested_amount": str(amt),
                "selected": amt > 0,
            }
        )

    return {
        "loan_id": lo.id,
        "loan_no": lo.loan_no,
        "outstanding_principal": str(lo.outstanding_principal or 0),
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "method": method,
        "total_amount": str(total_amount),
        "pl_totals": pl.get("totals") or {},
        "ponds": suggested,
        "sum_suggested": str(_money(sum((a for _, a in amounts), Decimal("0")))),
    }


def _create_profit_transfer(
    company_id: int,
    *,
    pond_id: int,
    transfer_date: date,
    amount: Decimal,
    debit_account_id: int,
    credit_account_id: int,
    memo: str,
    post: bool,
) -> AquaculturePondProfitTransfer:
    pond = AquaculturePond.objects.filter(pk=pond_id, company_id=company_id).first()
    if not pond:
        raise ValueError(f"Pond {pond_id} not found")
    amount = _money(amount)
    if amount <= 0:
        raise ValueError("Transfer amount must be positive")
    dr = ChartOfAccount.objects.filter(pk=debit_account_id, company_id=company_id).first()
    cr = ChartOfAccount.objects.filter(pk=credit_account_id, company_id=company_id).first()
    if not dr or not cr:
        raise ValueError("Debit or credit GL account not found")
    if debit_account_id == credit_account_id:
        raise ValueError("Debit and credit accounts must differ")

    pond_label = (pond.name or "").strip() or f"Pond #{pond.id}"
    desc = f"Aquaculture loan repayment contribution — {pond_label}"[:500]
    line_desc = (memo or desc)[:300]

    count = JournalEntry.objects.filter(company_id=company_id).count()
    je = JournalEntry(
        company_id=company_id,
        entry_number=f"JE-{count + 1}",
        entry_date=transfer_date,
        description=desc[:500],
        station_id=None,
        is_posted=False,
        posted_at=None,
    )
    je.save()
    JournalEntryLine.objects.create(
        journal_entry=je,
        account_id=debit_account_id,
        debit=amount,
        credit=Decimal("0"),
        description=line_desc,
        station_id=None,
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account_id=credit_account_id,
        debit=Decimal("0"),
        credit=amount,
        description=line_desc,
        station_id=None,
    )
    xfer = AquaculturePondProfitTransfer(
        company_id=company_id,
        pond=pond,
        production_cycle=None,
        transfer_date=transfer_date,
        amount=amount,
        debit_account_id=debit_account_id,
        credit_account_id=credit_account_id,
        memo=memo[:5000],
        journal_entry=je,
    )
    xfer.save()
    if post:
        je.is_posted = True
        je.posted_at = django_timezone.now()
        je.save(update_fields=["is_posted", "posted_at"])
    return xfer


def apply_repayment_worksheet(
    company_id: int,
    *,
    loan_id: int,
    transfer_date: date,
    rows: list[dict],
    debit_account_id: int,
    credit_account_id: int,
    post_transfers: bool = True,
    loan_repay: dict | None = None,
) -> dict[str, Any]:
    lo = Loan.objects.filter(
        id=loan_id, company_id=company_id, aquaculture_financing=True
    ).first()
    if not lo:
        raise LookupError("Aquaculture financing loan not found")
    if lo.status != "active":
        raise ValueError("Loan must be active")

    created_transfers: list[dict] = []
    created_allocations: list[dict] = []
    repay_result: dict | None = None

    with transaction.atomic():
        for row in rows:
            if not row.get("include", True):
                continue
            try:
                pond_id = int(row["pond_id"])
            except (TypeError, ValueError, KeyError):
                continue
            amt = _money(_dec(row.get("amount")))
            if amt <= 0:
                continue
            memo = (row.get("memo") or "").strip()
            if not memo:
                memo = f"Loan {lo.loan_no} repayment contribution"
            xfer = _create_profit_transfer(
                company_id,
                pond_id=pond_id,
                transfer_date=transfer_date,
                amount=amt,
                debit_account_id=debit_account_id,
                credit_account_id=credit_account_id,
                memo=memo,
                post=post_transfers,
            )
            alloc = AquacultureFinancingAllocation.objects.create(
                company_id=company_id,
                loan=lo,
                pond_id=pond_id,
                allocation_date=transfer_date,
                amount=amt,
                allocation_kind=AquacultureFinancingAllocation.KIND_REPAYMENT,
                profit_transfer=xfer,
                memo=memo,
            )
            created_transfers.append(
                {
                    "pond_id": pond_id,
                    "amount": str(amt),
                    "profit_transfer_id": xfer.id,
                    "journal_entry_id": xfer.journal_entry_id,
                }
            )
            created_allocations.append(_allocation_json(alloc))

        if loan_repay:
            total = _money(_dec(loan_repay.get("amount")))
            principal = _money(_dec(loan_repay.get("principal_amount")))
            interest = _money(_dec(loan_repay.get("interest_amount")))
            if total <= 0:
                raise ValueError("loan_repay.amount must be positive")
            if (principal + interest - total).copy_abs() > Decimal("0.02"):
                raise ValueError("principal_amount + interest_amount must equal amount")
            if principal > lo.outstanding_principal + Decimal("0.01"):
                raise ValueError("principal exceeds outstanding")
            r_date = loan_repay.get("repayment_date")
            if isinstance(r_date, str) and r_date:
                from datetime import datetime

                r_date = datetime.strptime(r_date[:10], "%Y-%m-%d").date()
            elif not isinstance(r_date, date):
                r_date = django_timezone.localdate()
            post_gl = bool(loan_repay.get("post_to_gl", True))
            r = LoanRepayment.objects.create(
                loan=lo,
                repayment_date=r_date,
                amount=total,
                principal_amount=principal,
                interest_amount=interest,
                reference=(loan_repay.get("reference") or "")[:200],
                memo=loan_repay.get("memo") or "",
            )
            if post_gl and not post_loan_repayment(company_id, r):
                raise ValueError("Loan GL posting failed")
            new_out = lo.outstanding_principal - principal
            new_rp = lo.total_repaid_principal + principal
            st = "closed" if new_out <= Decimal("0.005") else "active"
            Loan.objects.filter(pk=lo.pk).update(
                outstanding_principal=max(new_out, Decimal("0")),
                total_repaid_principal=new_rp,
                status=st,
            )
            lo.refresh_from_db()
            repay_result = {
                "repayment_id": r.id,
                "journal_entry_id": r.journal_entry_id,
                "amount": str(total),
                "principal_amount": str(principal),
                "outstanding_principal": str(lo.outstanding_principal),
            }

    return {
        "loan_id": lo.id,
        "profit_transfers": created_transfers,
        "allocations": created_allocations,
        "loan_repayment": repay_result,
    }


def record_financing_allocations(
    company_id: int,
    *,
    loan_id: int,
    allocation_date: date,
    allocation_kind: str,
    rows: list[dict],
    disbursement_id: int | None = None,
) -> list[dict]:
    lo = Loan.objects.filter(
        id=loan_id, company_id=company_id, aquaculture_financing=True
    ).first()
    if not lo:
        raise LookupError("Aquaculture financing loan not found")
    if allocation_kind not in (
        AquacultureFinancingAllocation.KIND_USE,
        AquacultureFinancingAllocation.KIND_REPAYMENT,
    ):
        raise ValueError("Invalid allocation_kind")
    disbursement = None
    if disbursement_id:
        disbursement = LoanDisbursement.objects.filter(
            id=disbursement_id, loan_id=lo.id
        ).first()
        if not disbursement:
            raise ValueError("disbursement_id not found on this loan")

    out: list[dict] = []
    with transaction.atomic():
        for row in rows:
            try:
                pond_id = int(row["pond_id"])
            except (TypeError, ValueError, KeyError):
                raise ValueError("Each row needs pond_id") from None
            if not AquaculturePond.objects.filter(pk=pond_id, company_id=company_id).exists():
                raise ValueError(f"Invalid pond_id {pond_id}")
            amt = _money(_dec(row.get("amount")))
            if amt <= 0:
                raise ValueError("Each amount must be positive")
            memo = (row.get("memo") or "")[:5000]
            a = AquacultureFinancingAllocation.objects.create(
                company_id=company_id,
                loan=lo,
                pond_id=pond_id,
                allocation_date=allocation_date,
                amount=amt,
                allocation_kind=allocation_kind,
                disbursement=disbursement,
                memo=memo,
            )
            out.append(_allocation_json(a))
    return out
