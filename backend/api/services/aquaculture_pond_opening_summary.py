"""Per-pond opening balance rollup: P&L by category + balance-sheet parties (not landlords)."""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from api.models import (
    AquaculturePond,
    Customer,
    Employee,
    Loan,
    LoanCounterparty,
    Vendor,
)
from api.services.aquaculture_pond_pl_opening import pl_opening_rows_for_pond
from api.services.aquaculture_pond_pl_opening_gl import pl_opening_gl_fields_for_api
from api.services.party_opening_gl import (
    customer_opening_fields_for_api,
    employee_opening_fields_for_api,
    vendor_opening_fields_for_api,
)

_MONEY = Decimal("0.01")

# Party kinds on balance_sheet_lines (advanced except customer)
BS_KINDS = frozenset({"customer", "vendor", "employee", "loan"})


def _q(d: Decimal | None) -> Decimal:
    return (d or Decimal("0")).quantize(_MONEY, rounding=ROUND_HALF_UP)


def _str_money(d: Decimal) -> str:
    return str(_q(d))


def _employee_display_name(emp: Employee) -> str:
    name = f"{emp.first_name or ''} {emp.last_name or ''}".strip()
    if name:
        return name
    code = (emp.employee_code or emp.employee_number or "").strip()
    return code or f"Employee #{emp.id}"


def _loan_opening_signed(cp: LoanCounterparty) -> Decimal:
    if cp.opening_balance_type == LoanCounterparty.OPENING_ZERO:
        return Decimal("0")
    amt = _q(cp.opening_balance)
    if cp.opening_balance_type == LoanCounterparty.OPENING_RECEIVABLE:
        return amt
    if cp.opening_balance_type == LoanCounterparty.OPENING_PAYABLE:
        return -amt
    return Decimal("0")


def _line(
    *,
    kind: str,
    party_id: int,
    name: str,
    code: str,
    opening_balance: Decimal,
    opening_balance_date,
    signed: Decimal,
    track: str,
    locked: bool = False,
    extra: dict | None = None,
) -> dict:
    row = {
        "kind": kind,
        "track": track,
        "party_id": party_id,
        "name": name,
        "code": code or "",
        "opening_balance": _str_money(opening_balance),
        "opening_balance_date": opening_balance_date.isoformat() if opening_balance_date else None,
        "signed_contribution": _str_money(signed),
        "side": "receivable" if signed > 0 else ("payable" if signed < 0 else "clear"),
        "locked": locked,
    }
    if extra:
        row.update(extra)
    return row


def _append_balance_sheet_lines(company_id: int, pond: AquaculturePond) -> list[dict]:
    lines: list[dict] = []

    if pond.pos_customer_id:
        cust = Customer.objects.filter(pk=pond.pos_customer_id, company_id=company_id).first()
        if cust:
            ob = _q(cust.opening_balance)
            lines.append(
                _line(
                    kind="customer",
                    party_id=cust.id,
                    name=(cust.company_name or cust.display_name or "").strip()
                    or f"Customer #{cust.id}",
                    code=(cust.customer_number or "").strip(),
                    opening_balance=ob,
                    opening_balance_date=cust.opening_balance_date,
                    signed=ob,
                    track="balance_sheet",
                    locked=bool(cust.opening_balance_journal_id),
                    extra={
                        "label": "A/R — on-account (unpaid past sales)",
                        "current_balance": _str_money(cust.current_balance),
                        **customer_opening_fields_for_api(cust),
                    },
                )
            )

    for v in Vendor.objects.filter(company_id=company_id, default_aquaculture_pond_id=pond.id):
        ob = _q(v.opening_balance)
        lines.append(
            _line(
                kind="vendor",
                party_id=v.id,
                name=(v.company_name or v.display_name or "").strip() or f"Vendor #{v.id}",
                code=(v.vendor_number or "").strip(),
                opening_balance=ob,
                opening_balance_date=v.opening_balance_date,
                signed=-ob,
                track="advanced",
                locked=bool(v.opening_balance_journal_id),
                extra={
                    "label": "A/P — vendor",
                    "current_balance": _str_money(v.current_balance),
                    **vendor_opening_fields_for_api(v),
                },
            )
        )

    for emp in Employee.objects.filter(company_id=company_id, home_aquaculture_pond_id=pond.id):
        ob = _q(emp.opening_balance)
        lines.append(
            _line(
                kind="employee",
                party_id=emp.id,
                name=_employee_display_name(emp),
                code="",
                opening_balance=ob,
                opening_balance_date=emp.opening_balance_date,
                signed=-ob,
                track="advanced",
                locked=bool(emp.opening_balance_journal_id),
                extra={
                    "label": "A/P — employee",
                    "current_balance": _str_money(emp.current_balance),
                    **employee_opening_fields_for_api(emp),
                },
            )
        )

    seen_cp: set[int] = set()
    cp_filters: list[tuple[str, int]] = []
    if pond.pos_customer_id:
        cp_filters.append(("customer_id", pond.pos_customer_id))
    for vid in Vendor.objects.filter(
        company_id=company_id, default_aquaculture_pond_id=pond.id
    ).values_list("id", flat=True):
        cp_filters.append(("vendor_id", vid))
    for eid in Employee.objects.filter(
        company_id=company_id, home_aquaculture_pond_id=pond.id
    ).values_list("id", flat=True):
        cp_filters.append(("employee_id", eid))

    for field, fk in cp_filters:
        for cp in LoanCounterparty.objects.filter(company_id=company_id, **{field: fk}):
            if cp.id in seen_cp:
                continue
            seen_cp.add(cp.id)
            signed = _loan_opening_signed(cp)
            lines.append(
                _line(
                    kind="loan",
                    party_id=cp.id,
                    name=(cp.name or "").strip(),
                    code=(cp.code or "").strip(),
                    opening_balance=_q(cp.opening_balance),
                    opening_balance_date=cp.opening_balance_as_of,
                    signed=signed,
                    track="advanced",
                    locked=bool(cp.opening_balance_journal_id),
                    extra={
                        "label": "Loan counterparty",
                        "opening_balance_type": cp.opening_balance_type,
                    },
                )
            )

    financing_loan_ids = (
        Loan.objects.filter(
            company_id=company_id,
            aquaculture_financing=True,
            aquaculture_financing_allocations__pond_id=pond.id,
        )
        .values_list("counterparty_id", flat=True)
        .distinct()
    )
    for cp_id in financing_loan_ids:
        if cp_id in seen_cp:
            continue
        cp = LoanCounterparty.objects.filter(pk=cp_id, company_id=company_id).first()
        if not cp:
            continue
        seen_cp.add(cp.id)
        signed = _loan_opening_signed(cp)
        lines.append(
            _line(
                kind="loan",
                party_id=cp.id,
                name=(cp.name or "").strip(),
                code=(cp.code or "").strip(),
                opening_balance=_q(cp.opening_balance),
                opening_balance_date=cp.opening_balance_as_of,
                signed=signed,
                track="advanced",
                locked=bool(cp.opening_balance_journal_id),
                extra={
                    "label": "Loan — aquaculture financing",
                    "opening_balance_type": cp.opening_balance_type,
                },
            )
        )

    return lines


def build_pond_opening_summary(company_id: int, pond: AquaculturePond) -> dict[str, Any]:
    balance_sheet_lines = _append_balance_sheet_lines(company_id, pond)
    pl = pl_opening_rows_for_pond(company_id, pond.id)
    pl.update(pl_opening_gl_fields_for_api(pond))

    bs_ar = Decimal("0")
    bs_ap = Decimal("0")
    for ln in balance_sheet_lines:
        signed = Decimal(ln["signed_contribution"])
        if signed > 0:
            bs_ar += signed
        elif signed < 0:
            bs_ap += abs(signed)

    pl_income = Decimal(pl["totals"]["income_signed"])
    pl_expense = Decimal(pl["totals"]["expense_signed"])
    pl_net = Decimal(pl["totals"]["net_pl_signed"])

    pc = pond.pos_customer if pond.pos_customer_id else None
    pc_disp = ""
    if pc:
        pc_disp = (pc.company_name or pc.display_name or "").strip() or f"Customer #{pc.id}"

    return {
        "pond_id": pond.id,
        "pond_name": pond.name or "",
        "pond_code": pond.code or "",
        "is_active": pond.is_active,
        "pos_customer_id": pond.pos_customer_id,
        "pos_customer_display": pc_disp or None,
        "lease_paid_to_landlord": _str_money(pond.lease_paid_to_landlord),
        "prior_pl_zero_confirmed_at": (
            pond.prior_pl_zero_confirmed_at.isoformat() if pond.prior_pl_zero_confirmed_at else None
        ),
        "balance_sheet_lines": balance_sheet_lines,
        "pl_openings": pl,
        "totals": {
            "balance_sheet_receivable_signed": _str_money(bs_ar),
            "balance_sheet_payable_signed": _str_money(bs_ap),
            "net_balance_sheet_signed": _str_money(_q(bs_ar - bs_ap)),
            "pl_income_signed": _str_money(pl_income),
            "pl_expense_signed": _str_money(pl_expense),
            "net_pl_signed": _str_money(pl_net),
        },
        "landlord_note": (
            "Landlord / lease rent opening is managed on Aquaculture → Landlords, not in this screen."
        ),
    }


def build_all_pond_opening_summaries(company_id: int) -> list[dict]:
    ponds = (
        AquaculturePond.objects.filter(company_id=company_id)
        .select_related("pos_customer")
        .order_by("sort_order", "id")
    )
    return [build_pond_opening_summary(company_id, p) for p in ponds]
