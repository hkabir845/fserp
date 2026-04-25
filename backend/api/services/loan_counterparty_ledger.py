"""Merge opening balance and all loans for one counterparty into a single subledger view."""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

from django.utils import timezone

from api.models import Loan, LoanCounterparty
from api.services.loan_islamic import loan_uses_islamic_terminology
from api.services.loan_interest_basis import interest_basis_label, loan_interest_basis_key

# Local copies to avoid importing api.views (circular import risk)
def _ser_date(d) -> str | None:
    if d is None:
        return None
    return d.isoformat() if hasattr(d, "isoformat") else str(d)


def _q2(x: Decimal) -> Decimal:
    return x.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _statement_kind_label(kind: str, isl: bool) -> str:
    if isl:
        return {
            "disbursement": "Financing disbursement",
            "repayment": "Payment (principal & profit)",
            "repayment_reversal": "Payment reversal",
            "interest_accrual": "Profit accrual",
            "interest_accrual_reversal": "Profit accrual reversal",
        }.get(kind, kind.replace("_", " ").title())
    return {
        "disbursement": "Disbursement",
        "repayment": "Repayment",
        "repayment_reversal": "Repayment reversal",
        "interest_accrual": "Interest accrual",
        "interest_accrual_reversal": "Accrual reversal",
    }.get(kind, kind.replace("_", " ").title())


def _iter_loan_events(lo: Loan):
    stmt_islamic = loan_uses_islamic_terminology(lo)
    d_events = [
        {"kind": "disbursement", "sort_key": (d.disbursement_date, 0, d.id, 0), "obj": d}
        for d in lo.disbursements.all()
    ]
    r_events = []
    for r in lo.repayments.select_related("reversal_journal_entry").order_by("repayment_date", "id"):
        r_events.append(
            {"kind": "repayment", "sort_key": (r.repayment_date, 1, r.id, 0), "obj": r}
        )
        if r.reversal_journal_entry_id:
            rje = r.reversal_journal_entry
            rdate = rje.entry_date if rje else r.repayment_date
            r_events.append(
                {"kind": "repayment_reversal", "sort_key": (rdate, 1, r.id, 1), "obj": r}
            )
    ac_events = []
    for a in lo.interest_accruals.select_related("reversal_journal_entry").order_by("accrual_date", "id"):
        ac_events.append(
            {"kind": "interest_accrual", "sort_key": (a.accrual_date, 2, a.id, 0), "obj": a}
        )
        if a.reversal_journal_entry_id:
            rje = a.reversal_journal_entry
            rdate = rje.entry_date if rje else a.accrual_date
            ac_events.append(
                {
                    "kind": "interest_accrual_reversal",
                    "sort_key": (rdate, 2, a.id, 1),
                    "obj": a,
                }
            )
    merged = sorted(d_events + r_events + ac_events, key=lambda x: x["sort_key"])
    return merged, stmt_islamic


def _emit_loan_lines(lo: Loan, merged, stmt_islamic: bool) -> list[dict]:
    bal = Decimal("0")
    stmt_ib = loan_interest_basis_key(lo)
    out: list[dict] = []
    for e in merged:
        if e["kind"] == "disbursement":
            d = e["obj"]
            amt = d.amount or Decimal("0")
            bal = _q2(bal + amt)
            out.append(
                {
                    "date": _ser_date(d.disbursement_date),
                    "sort_key": (d.disbursement_date, 0, 0, lo.id, 0, d.id, 0),
                    "kind": "disbursement",
                    "kind_label": _statement_kind_label("disbursement", stmt_islamic),
                    "loan_id": lo.id,
                    "loan_no": lo.loan_no,
                    "loan_direction": lo.direction,
                    "product_type": lo.product_type,
                    "reference": d.reference or "",
                    "memo": (d.memo or "")[:200],
                    "disbursement": str(amt),
                    "repayment_total": "",
                    "principal": "",
                    "interest": "",
                    "outstanding_principal_after_loan": str(bal),
                    "journal_entry_id": d.journal_entry_id,
                    "interest_basis": stmt_ib,
                    "interest_basis_label": interest_basis_label(stmt_ib),
                }
            )
        elif e["kind"] == "repayment":
            r = e["obj"]
            p = r.principal_amount or Decimal("0")
            iamt = r.interest_amount or Decimal("0")
            tot = r.amount or _q2(p + iamt)
            bal = _q2(bal - p)
            out.append(
                {
                    "date": _ser_date(r.repayment_date),
                    "sort_key": (r.repayment_date, 1, 0, lo.id, 0, r.id, 0),
                    "kind": "repayment",
                    "kind_label": _statement_kind_label("repayment", stmt_islamic),
                    "loan_id": lo.id,
                    "loan_no": lo.loan_no,
                    "loan_direction": lo.direction,
                    "product_type": lo.product_type,
                    "reference": r.reference or "",
                    "memo": (r.memo or "")[:200],
                    "disbursement": "",
                    "repayment_total": str(tot),
                    "principal": str(p),
                    "interest": str(iamt),
                    "outstanding_principal_after_loan": str(max(bal, Decimal("0"))),
                    "journal_entry_id": r.journal_entry_id,
                    "interest_basis": stmt_ib,
                    "interest_basis_label": interest_basis_label(stmt_ib),
                }
            )
        elif e["kind"] == "repayment_reversal":
            r = e["obj"]
            p = r.principal_amount or Decimal("0")
            iamt = r.interest_amount or Decimal("0")
            tot = r.amount or _q2(p + iamt)
            bal = _q2(bal + p)
            rev = r.reversal_journal_entry
            rev_date = rev.entry_date if rev else r.repayment_date
            out.append(
                {
                    "date": _ser_date(rev_date),
                    "sort_key": (rev_date, 1, 1, lo.id, 0, r.id, 0),
                    "kind": "repayment_reversal",
                    "kind_label": _statement_kind_label("repayment_reversal", stmt_islamic),
                    "loan_id": lo.id,
                    "loan_no": lo.loan_no,
                    "loan_direction": lo.direction,
                    "product_type": lo.product_type,
                    "reference": r.reference or "",
                    "memo": f"Reversal of repayment #{r.id}"[:200],
                    "disbursement": "",
                    "repayment_total": str(-tot),
                    "principal": str(-p),
                    "interest": str(-iamt),
                    "outstanding_principal_after_loan": str(max(bal, Decimal("0"))),
                    "journal_entry_id": r.reversal_journal_entry_id,
                    "interest_basis": stmt_ib,
                    "interest_basis_label": interest_basis_label(stmt_ib),
                }
            )
        elif e["kind"] == "interest_accrual":
            a = e["obj"]
            amt = a.amount or Decimal("0")
            out.append(
                {
                    "date": _ser_date(a.accrual_date),
                    "sort_key": (a.accrual_date, 2, 0, lo.id, 0, a.id, 0),
                    "kind": "interest_accrual",
                    "kind_label": _statement_kind_label("interest_accrual", stmt_islamic),
                    "loan_id": lo.id,
                    "loan_no": lo.loan_no,
                    "loan_direction": lo.direction,
                    "product_type": lo.product_type,
                    "reference": "",
                    "memo": (a.memo or "")[:200],
                    "disbursement": "",
                    "repayment_total": "",
                    "principal": "",
                    "interest": str(amt),
                    "outstanding_principal_after_loan": str(max(bal, Decimal("0"))),
                    "journal_entry_id": a.journal_entry_id,
                    "interest_basis": stmt_ib,
                    "interest_basis_label": interest_basis_label(stmt_ib),
                }
            )
        else:  # interest_accrual_reversal
            a = e["obj"]
            amt = a.amount or Decimal("0")
            rje = a.reversal_journal_entry
            rdate = rje.entry_date if rje and a.reversal_journal_entry_id else a.accrual_date
            out.append(
                {
                    "date": _ser_date(rdate),
                    "sort_key": (rdate, 2, 1, lo.id, 0, a.id, 0),
                    "kind": "interest_accrual_reversal",
                    "kind_label": _statement_kind_label("interest_accrual_reversal", stmt_islamic),
                    "loan_id": lo.id,
                    "loan_no": lo.loan_no,
                    "loan_direction": lo.direction,
                    "product_type": lo.product_type,
                    "reference": "",
                    "memo": f"Reversal of accrual #{a.id}"[:200],
                    "disbursement": "",
                    "repayment_total": "",
                    "principal": "",
                    "interest": str(-amt),
                    "outstanding_principal_after_loan": str(max(bal, Decimal("0"))),
                    "journal_entry_id": a.reversal_journal_entry_id,
                    "interest_basis": stmt_ib,
                    "interest_basis_label": interest_basis_label(stmt_ib),
                }
            )
    return out


def _parse_row_date(s: str | None) -> date:
    if not s:
        return date.min
    try:
        return date.fromisoformat(str(s).split("T")[0])
    except Exception:
        return date.min


def build_counterparty_ledger(cp: LoanCounterparty) -> dict:
    t = cp.opening_balance_type or LoanCounterparty.OPENING_ZERO
    ob = cp.opening_balance or Decimal("0")
    ob_recv = ob if t == LoanCounterparty.OPENING_RECEIVABLE else Decimal("0")
    ob_pay = ob if t == LoanCounterparty.OPENING_PAYABLE else Decimal("0")
    as_of = _ser_date(timezone.localdate())

    loan_qs = (
        cp.loans.filter(company_id=cp.company_id)
        .select_related("counterparty")
        .prefetch_related(
            "disbursements",
            "repayments__reversal_journal_entry",
            "interest_accruals__reversal_journal_entry",
        )
    )
    loans = [lo for lo in loan_qs if lo.product_type != Loan.PRODUCT_ISLAMIC_FACILITY]
    all_lines: list[dict] = []
    if t in (LoanCounterparty.OPENING_RECEIVABLE, LoanCounterparty.OPENING_PAYABLE) and ob > Decimal(
        "0.005"
    ) and cp.opening_balance_as_of:
        o_label = (
            "Opening — receivable (they owe you)"
            if t == LoanCounterparty.OPENING_RECEIVABLE
            else "Opening — payable (you owe them)"
        )
        omemo = f"Principal {ob} as of {_ser_date(cp.opening_balance_as_of)}"
        if cp.opening_interest_applicable and cp.opening_annual_interest_rate is not None:
            omemo += f"; quoted annual {cp.opening_annual_interest_rate}% (indicative)"
        elif cp.opening_interest_applicable:
            omemo += "; interest applicable (accrue under loan/GL policy)"
        all_lines.append(
            {
                "date": _ser_date(cp.opening_balance_as_of),
                "sort_key": (cp.opening_balance_as_of, -1, 0, 0, 0, 0, 0, 0),
                "kind": "counterparty_opening",
                "kind_label": o_label,
                "loan_id": None,
                "loan_no": "Opening",
                "loan_direction": "",
                "product_type": "",
                "reference": f"JE ref #{cp.opening_balance_journal_id}" if cp.opening_balance_journal_id else "",
                "memo": omemo,
                "disbursement": str(ob) if t == LoanCounterparty.OPENING_RECEIVABLE else "",
                "repayment_total": "",
                "principal": str(ob),
                "interest": "",
                "outstanding_principal_after_loan": "",
                "journal_entry_id": cp.opening_balance_journal_id,
                "interest_basis": "",
                "interest_basis_label": "",
            }
        )

    for lo in loans:
        merged, stmt_islamic = _iter_loan_events(lo)
        all_lines.extend(_emit_loan_lines(lo, merged, stmt_islamic))

    all_lines.sort(key=lambda r: (r.get("sort_key") or (date.min,)))

    last_loan_prin: dict[int, Decimal] = {lo.id: Decimal("0") for lo in loans}
    for r in all_lines:
        if r.get("kind") == "counterparty_opening":
            r_run = _q2(ob_recv)
            p_run = _q2(ob_pay)
            for lo in loans:
                if lo.direction == Loan.DIRECTION_LENT:
                    r_run = _q2(r_run + last_loan_prin[lo.id])
                else:
                    p_run = _q2(p_run + last_loan_prin[lo.id])
            r["receivable_principal_total"] = str(r_run)
            r["payable_principal_total"] = str(p_run)
            r.pop("sort_key", None)
            continue
        lid = r.get("loan_id")
        if isinstance(lid, int) and r.get("outstanding_principal_after_loan", "") not in (None, ""):
            last_loan_prin[lid] = Decimal(r["outstanding_principal_after_loan"])
        r_run = _q2(
            ob_recv
            + sum(
                (last_loan_prin[lo.id] for lo in loans if lo.direction == Loan.DIRECTION_LENT),
                start=Decimal("0"),
            )
        )
        p_run = _q2(
            ob_pay
            + sum(
                (last_loan_prin[lo.id] for lo in loans if lo.direction == Loan.DIRECTION_BORROWED),
                start=Decimal("0"),
            )
        )
        r["receivable_principal_total"] = str(r_run)
        r["payable_principal_total"] = str(p_run)
        r.pop("sort_key", None)

    tr = _q2(
        ob_recv
        + sum(
            (lo.outstanding_principal or Decimal("0")) for lo in loans if lo.direction == Loan.DIRECTION_LENT
        )
    )
    tp = _q2(
        ob_pay
        + sum(
            (lo.outstanding_principal or Decimal("0"))
            for lo in loans
            if lo.direction == Loan.DIRECTION_BORROWED
        )
    )
    return {
        "counterparty": {
            "id": cp.id,
            "code": cp.code,
            "name": cp.name,
            "party_kind": cp.party_kind,
            "role_type": cp.role_type,
        },
        "lines": all_lines,
        "summary": {
            "total_receivable_principal": str(tr),
            "total_payable_principal": str(tp),
            "opening_receivable": str(_q2(ob_recv)),
            "opening_payable": str(_q2(ob_pay)),
        },
        "as_of": as_of,
    }
