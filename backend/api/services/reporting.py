"""
Company-scoped report payloads matching frontend /reports/* expectations.
"""
from __future__ import annotations

from calendar import monthrange
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Optional

from django.db.models import Count, Q, Sum, Value
from django.db.models.functions import Coalesce, Trim
from django.utils import timezone

from api.models import (
    AquacultureFishSale,
    AquaculturePond,
    Bill,
    BillLine,
    ChartOfAccount,
    Customer,
    Invoice,
    InvoiceLine,
    Item,
    JournalEntryLine,
    Loan,
    LoanDisbursement,
    LoanRepayment,
    Meter,
    Nozzle,
    Payment,
    PaymentBillAllocation,
    ShiftSession,
    Station,
    Tank,
    TankDip,
    Vendor,
)
from api.services.gl_posting import (
    backfill_invoice_cogs_journals,
    item_cogs_unit_cost,
    item_inventory_unit_cost,
    item_should_relieve_cogs,
)
from api.services.payment_allocation import bill_open_amount, invoice_open_amount
from api.utils.pos_payment import is_on_account_payment
from api.services.aquaculture_pond_pos_customer import pond_pos_customer_ids

# Vendor bills included in purchase / movement reports (exclude draft and void).
_BILL_LINE_POSTED_STATUSES = ("open", "paid", "partial", "overdue")


def _bill_lines_in_period(
    company_id: int,
    start: date,
    end: date,
    *,
    require_item: bool = False,
):
    qs = BillLine.objects.filter(
        bill__company_id=company_id,
        bill__bill_date__gte=start,
        bill__bill_date__lte=end,
        bill__status__in=_BILL_LINE_POSTED_STATUSES,
    )
    if require_item:
        qs = qs.filter(item_id__isnull=False)
    return qs


def _filter_bill_lines_for_station(qs, station_id: int):
    return qs.filter(
        Q(bill__receipt_station_id=station_id) | Q(receipt_station_id=station_id)
    )
from api.services.item_catalog import item_tracks_physical_stock
from api.services.station_stock import get_station_stock, item_uses_station_bins, tanks_exist_for_item
from api.services.coa_constants import (
    is_debit_normal_chart_type,
    normalize_chart_account_type,
    pl_bucket_for_coa,
)


def _pl_bucket(coa: ChartOfAccount) -> str | None:
    return pl_bucket_for_coa(coa.account_type, coa.account_sub_type, coa.account_code)


def _pl_amount_from_movement(coa: ChartOfAccount, debit: Decimal, credit: Decimal) -> Decimal:
    """Signed P&L amount from debits/credits (income = credit-normal; COGS/expense = debit-normal)."""
    bucket = _pl_bucket(coa)
    if bucket == "income":
        return credit - debit
    if bucket in ("cost_of_goods_sold", "expense"):
        return debit - credit
    return Decimal("0")


def _period_pl_totals_from_line_qs(
    company_id: int, start: date, end: date, line_qs
) -> dict[str, Decimal]:
    """Income, COGS, and expense totals for a journal-line slice (uses _pl_bucket for classification)."""
    ti = tcogs = te = Decimal("0")
    for coa in ChartOfAccount.objects.filter(company_id=company_id).order_by("account_code"):
        bucket = _pl_bucket(coa)
        if bucket is None:
            continue
        amt = _period_pl_amount_lines(coa, company_id, start, end, line_qs)
        if bucket == "income":
            ti += amt
        elif bucket == "cost_of_goods_sold":
            tcogs += amt
        else:
            te += amt
    gross = ti - tcogs
    return {
        "income": ti,
        "cogs": tcogs,
        "expenses": te,
        "gross_profit": gross,
        "net_income": gross - te,
    }


def _estimated_cogs_from_invoice_lines(
    company_id: int,
    start: date,
    end: date,
    *,
    station_id: int | None = None,
    pond_id: int | None = None,
) -> Decimal:
    """
    Subledger COGS estimate (qty × item unit cost) for posted invoices in range.
    Used to hint when GL COGS journals are missing; does not replace posted GL on P&L.
    """
    if pond_id is not None:
        # Invoices are not pond-tagged at document level; skip subledger estimate for pond scope.
        return Decimal("0")
    qs = InvoiceLine.objects.filter(
        invoice__company_id=company_id,
        invoice__invoice_date__gte=start,
        invoice__invoice_date__lte=end,
        invoice__status__in=("paid", "partial", "sent", "overdue"),
        item_id__isnull=False,
    ).select_related("item", "invoice")
    if station_id is not None:
        qs = qs.filter(invoice__station_id=station_id)
    total = Decimal("0")
    for line in qs:
        it = line.item
        if not it or not item_should_relieve_cogs(company_id, it):
            continue
        cost = item_cogs_unit_cost(company_id, it)
        qty = line.quantity or Decimal("0")
        if cost <= 0 or qty <= 0:
            continue
        total += (qty * cost).quantize(Decimal("0.01"))
    return total


def _d(v: Any) -> Decimal:
    if v is None:
        return Decimal("0")
    return Decimal(str(v))


def _f(d: Decimal | int | float | str | None) -> float:
    return float(_d(d).quantize(Decimal("0.01")))


def _item_qoh_at_station(company_id: int, item: Item, station_id: int) -> Decimal:
    """Shop bin or tank stock at one site; company-level QOH when the SKU is not split per site."""
    if not item_tracks_physical_stock(item):
        return Decimal("0")
    if tanks_exist_for_item(company_id, item.id):
        agg = Tank.objects.filter(
            company_id=company_id, product_id=item.id, station_id=station_id
        ).aggregate(s=Coalesce(Sum("current_stock"), Decimal("0")))
        return _d(agg["s"])
    if item_uses_station_bins(company_id, item):
        return get_station_stock(company_id, station_id, item.id)
    return _d(getattr(item, "quantity_on_hand", None) or 0)


def parse_report_dates(request) -> tuple[date, date]:
    today = timezone.localdate()
    end_s = request.GET.get("end_date")
    start_s = request.GET.get("start_date")
    try:
        end_d = date.fromisoformat(str(end_s).split("T")[0]) if end_s else today
    except Exception:
        end_d = today
    try:
        start_d = (
            date.fromisoformat(str(start_s).split("T")[0])
            if start_s
            else (end_d - timedelta(days=30))
        )
    except Exception:
        start_d = end_d - timedelta(days=30)
    if start_d > end_d:
        start_d, end_d = end_d, start_d
    return start_d, end_d


def _je_lines_base(company_id: int, station_id: int | None = None):
    qs = JournalEntryLine.objects.filter(
        journal_entry__company_id=company_id,
        journal_entry__is_posted=True,
    )
    if station_id is not None:
        # Line tag wins; untagged lines inherit the journal header station (legacy rows).
        # Exclude pond-tagged lines: aquaculture costs belong on pond P&L even when the
        # vendor bill receipt station is this site (e.g. feed bought at Main for a pond).
        qs = qs.filter(
            Q(station_id=station_id)
            | Q(
                station_id__isnull=True,
                journal_entry__station_id=station_id,
            )
        ).filter(aquaculture_pond_id__isnull=True)
    return qs


def _je_lines_pl_scope(
    company_id: int,
    station_id: int | None = None,
    pond_id: int | None = None,
    *,
    unscoped_dims: bool = False,
):
    """Posted journal lines for P&L / GL entity scope (pond, head office, station, or company)."""
    if pond_id is not None:
        return _je_lines_pond(company_id, pond_id)
    if unscoped_dims:
        return _je_lines_unscoped_dims(company_id)
    return _je_lines_base(company_id, station_id)


def _je_lines_pond(company_id: int, pond_id: int):
    return JournalEntryLine.objects.filter(
        journal_entry__company_id=company_id,
        journal_entry__is_posted=True,
        aquaculture_pond_id=pond_id,
    )


def _je_lines_unscoped_dims(company_id: int):
    """Posted lines with no station and no pond tag (company-wide / head office slice)."""
    return JournalEntryLine.objects.filter(
        journal_entry__company_id=company_id,
        journal_entry__is_posted=True,
        station_id__isnull=True,
        aquaculture_pond_id__isnull=True,
    )


def report_trial_balance(
    company_id: int,
    start: date,
    end: date,
    station_id: int | None = None,
    pond_id: int | None = None,
    *,
    unscoped_dims: bool = False,
) -> dict[str, Any]:
    """
    Period activity trial balance: sums posted journal lines with entry_date in [start, end].
    Total debits must equal total credits (double-entry). COA opening balances are not included.

    When ``station_id`` is set, only lines tagged with that site are included (company-wide / untagged
    lines are excluded). When ``pond_id`` is set, only lines tagged with that pond are included (each
    pond is reported as an individual entity); ``station_id`` is ignored in that case.
    """
    if pond_id is not None:
        station_id = None
        unscoped_dims = False
        base_lines = _je_lines_pond(company_id, pond_id)
    elif unscoped_dims:
        station_id = None
        base_lines = _je_lines_unscoped_dims(company_id)
    else:
        base_lines = _je_lines_base(company_id, station_id)
    period_lines = base_lines.filter(
        journal_entry__entry_date__gte=start,
        journal_entry__entry_date__lte=end,
    )
    agg_all = period_lines.aggregate(
        td=Coalesce(Sum("debit"), Decimal("0")),
        tc=Coalesce(Sum("credit"), Decimal("0")),
    )
    total_d = agg_all["td"]
    total_c = agg_all["tc"]

    qs = period_lines.values("account_id").annotate(
        td=Coalesce(Sum("debit"), Decimal("0")),
        tc=Coalesce(Sum("credit"), Decimal("0")),
    )
    by_acc = {row["account_id"]: (row["td"], row["tc"]) for row in qs}
    accounts_out: list[dict[str, Any]] = []
    seen_ids: set[int] = set()

    for coa in ChartOfAccount.objects.filter(company_id=company_id).order_by("account_code"):
        d, c = by_acc.get(coa.id, (Decimal("0"), Decimal("0")))
        if d == 0 and c == 0:
            continue
        seen_ids.add(coa.id)
        nm = coa.account_name
        if not coa.is_active:
            nm = f"{nm} (inactive)"
        accounts_out.append(
            {
                "account_id": coa.id,
                "account_code": coa.account_code,
                "account_name": nm,
                "account_type": normalize_chart_account_type(coa.account_type),
                "debit": _f(d),
                "credit": _f(c),
                "balance": _f(d - c),
            }
        )

    for aid, (d, c) in sorted(by_acc.items(), key=lambda x: x[0]):
        if aid in seen_ids or (d == 0 and c == 0):
            continue
        accounts_out.append(
            {
                "account_id": aid,
                "account_code": f"?{aid}",
                "account_name": "Journal lines on missing or other-company chart row — reconcile COA",
                "account_type": "unknown",
                "debit": _f(d),
                "credit": _f(c),
                "balance": _f(d - c),
            }
        )

    diff = total_d - total_c
    out: dict[str, Any] = {
        "report_id": "trial-balance",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "accounts": accounts_out,
        "total_debit": _f(total_d),
        "total_credit": _f(total_c),
        "debits_equal_credits": abs(diff) <= Decimal("0.02"),
        "debit_credit_difference": _f(diff),
        "accounting_note": (
            "Posted activity only between start and end dates; chart opening balances are not included. "
            "Total debit and total credit must match for a balanced GL period."
        ),
    }
    if pond_id is not None:
        out["filter_pond_id"] = pond_id
        out["accounting_note"] = (
            out["accounting_note"]
            + " Pond filter: only journal lines tagged to this pond are included (pond as individual entity); "
            "chart opening balances and untagged lines (e.g. shared A/P) are not included."
        )
    elif station_id is not None:
        out["filter_station_id"] = station_id
        out["accounting_note"] = (
            out["accounting_note"]
            + " Site filter: only journal lines for this station (line tag or journal header) are included."
        )
    elif unscoped_dims:
        out["filter_head_office"] = True
        out["accounting_note"] = (
            out["accounting_note"]
            + " Head office filter: only journal lines with no station or pond tag are included."
        )
    return out


def _movement_through(
    company_id: int, account_id: int, as_of: date, station_id: int | None = None
) -> tuple[Decimal, Decimal]:
    agg = (
        _je_lines_base(company_id, station_id)
        .filter(
            account_id=account_id,
            journal_entry__entry_date__lte=as_of,
        )
        .aggregate(
            td=Coalesce(Sum("debit"), Decimal("0")),
            tc=Coalesce(Sum("credit"), Decimal("0")),
        )
    )
    return agg["td"], agg["tc"]


def _ending_balance(coa: ChartOfAccount, company_id: int, as_of: date) -> Decimal:
    ob = coa.opening_balance or Decimal("0")
    d, c = _movement_through(company_id, coa.id, as_of)
    if is_debit_normal_chart_type(coa.account_type, coa.account_sub_type):
        return ob + d - c
    return ob + c - d


def _balance_sheet_balance_from_site_activity(
    coa: ChartOfAccount, company_id: int, as_of: date, station_id: int
) -> Decimal:
    """
    BS account balance from posted lines tagged with ``station_id`` only (no chart opening).
    Matches site-scoped trial balance / P&L basis.
    """
    d, c = _movement_through(company_id, coa.id, as_of, station_id)
    if is_debit_normal_chart_type(coa.account_type, coa.account_sub_type):
        return d - c
    return c - d


def _movement_through_pond(
    company_id: int, account_id: int, as_of: date, pond_id: int
) -> tuple[Decimal, Decimal]:
    """Posted debit/credit totals through ``as_of`` on lines tagged to one pond."""
    agg = (
        _je_lines_pond(company_id, pond_id)
        .filter(account_id=account_id, journal_entry__entry_date__lte=as_of)
        .aggregate(
            td=Coalesce(Sum("debit"), Decimal("0")),
            tc=Coalesce(Sum("credit"), Decimal("0")),
        )
    )
    return agg["td"], agg["tc"]


def _balance_sheet_balance_from_pond_activity(
    coa: ChartOfAccount, company_id: int, as_of: date, pond_id: int
) -> Decimal:
    """
    BS account balance from posted lines tagged with ``pond_id`` only (no chart opening).
    Pond analogue of ``_balance_sheet_balance_from_site_activity``.
    """
    d, c = _movement_through_pond(company_id, coa.id, as_of, pond_id)
    if is_debit_normal_chart_type(coa.account_type, coa.account_sub_type):
        return d - c
    return c - d


def _cumulative_net_income_through(company_id: int, as_of: date) -> Decimal:
    """
    P&L rolled to equity for balance-sheet balancing when income/expense/COSG
    are not yet closed to retained earnings. Net = income balances − COGS − expenses
    (each balance as-of `as_of`, including opening_balance on COA rows).
    """
    ni = Decimal("0")
    for coa in ChartOfAccount.objects.filter(company_id=company_id).order_by(
        "account_code"
    ):
        bucket = _pl_bucket(coa)
        if bucket is None:
            continue
        bal = _ending_balance(coa, company_id, as_of)
        if bucket == "income":
            ni += bal
        else:
            ni -= bal
    return ni


def _site_pl_activity_balance(
    coa: ChartOfAccount, company_id: int, as_of: date, station_id: int
) -> Decimal:
    """P&L movement through ``as_of`` on one site (posted lines only; no chart opening balance)."""
    d, c = _movement_through(company_id, coa.id, as_of, station_id)
    return _pl_amount_from_movement(coa, d, c)


def _cumulative_net_income_site_through(
    company_id: int, as_of: date, station_id: int
) -> Decimal:
    """Same sign convention as ``_cumulative_net_income_through`` but journal lines for one site only."""
    ni = Decimal("0")
    for coa in ChartOfAccount.objects.filter(company_id=company_id).order_by("account_code"):
        bucket = _pl_bucket(coa)
        if bucket is None:
            continue
        bal = _site_pl_activity_balance(coa, company_id, as_of, station_id)
        if bucket == "income":
            ni += bal
        else:
            ni -= bal
    return ni


def _cumulative_net_income_pond_through(
    company_id: int, as_of: date, pond_id: int
) -> Decimal:
    """Same sign convention as ``_cumulative_net_income_site_through`` but for one pond's tagged lines."""
    ni = Decimal("0")
    for coa in ChartOfAccount.objects.filter(company_id=company_id).order_by("account_code"):
        bucket = _pl_bucket(coa)
        if bucket is None:
            continue
        d, c = _movement_through_pond(company_id, coa.id, as_of, pond_id)
        bal = _pl_amount_from_movement(coa, d, c)
        if bucket == "income":
            ni += bal
        else:
            ni -= bal
    return ni


def _unknown_type_balance_sheet_bucket(
    account_type: str | None,
) -> str | None:
    """
    Return 'asset', 'liability', or 'equity' for legacy/unknown COA types so every
    balance sheet account contributes to one side (else the sheet cannot tie).
    """
    t = (account_type or "").strip().lower()[:32]
    if not t or t in (
        "asset",
        "bank_account",
        "liability",
        "equity",
        "loan",
        "income",
        "cost_of_goods_sold",
        "expense",
    ):
        return None
    # QuickBooks-ish fallbacks
    if "liabilit" in t or "payable" in t or "payroll_tax" in t:
        return "liability"
    if "equity" in t or "capital" in t or "retained" in t:
        return "equity"
    if "asset" in t or "receivable" in t or "inventory" in t or "bank" in t:
        return "asset"
    return "equity"


def _balance_sheet_bucket_for_coa(coa: ChartOfAccount) -> str | None:
    """
    Classify a chart row to a balance-sheet side. None means P&L (excluded).
    """
    t = normalize_chart_account_type(coa.account_type)
    st = (coa.account_sub_type or "").strip().lower()
    if t in ("income", "cost_of_goods_sold", "expense"):
        return None
    if t in ("asset", "bank_account") or (t == "loan" and st != "loan_payable"):
        return "asset"
    if t == "liability" or (t == "loan" and st == "loan_payable"):
        return "liability"
    if t == "equity":
        return "equity"
    ub = _unknown_type_balance_sheet_bucket(coa.account_type)
    if ub == "asset":
        return "asset"
    if ub == "liability":
        return "liability"
    return "equity"


def _balance_sheet_balance_from_line_qs(
    coa: ChartOfAccount, company_id: int, as_of: date, line_qs
) -> Decimal:
    """BS balance from a filtered journal-line queryset (pond or head-office slice)."""
    bucket = _balance_sheet_bucket_for_coa(coa)
    if not bucket:
        return Decimal("0")
    agg = line_qs.filter(
        account_id=coa.id,
        journal_entry__entry_date__lte=as_of,
    ).aggregate(
        td=Coalesce(Sum("debit"), Decimal("0")),
        tc=Coalesce(Sum("credit"), Decimal("0")),
    )
    d, c = agg["td"], agg["tc"]
    if bucket == "asset":
        return d - c
    return c - d


def report_balance_sheet(
    company_id: int,
    start: date,
    end: date,
    station_id: int | None = None,
    pond_id: int | None = None,
    *,
    unscoped_dims: bool = False,
) -> dict[str, Any]:
    _ = start
    # station_id, pond_id, and unscoped_dims are mutually exclusive; pond scope wins if set.
    if pond_id is not None:
        station_id = None
        unscoped_dims = False
    elif unscoped_dims:
        station_id = None
    unscoped_lines = (
        _je_lines_unscoped_dims(company_id) if unscoped_dims else None
    )
    assets: list[dict[str, Any]] = []
    liabilities: list[dict[str, Any]] = []
    equity: list[dict[str, Any]] = []
    ta = tl = te_plain = Decimal("0")
    for coa in ChartOfAccount.objects.filter(company_id=company_id).order_by(
        "account_code"
    ):
        t = normalize_chart_account_type(coa.account_type)
        st = (coa.account_sub_type or "").strip().lower()
        if t in ("income", "cost_of_goods_sold", "expense"):
            continue
        if pond_id is not None:
            bal = _balance_sheet_balance_from_pond_activity(coa, company_id, end, pond_id)
        elif unscoped_dims and unscoped_lines is not None:
            bal = _balance_sheet_balance_from_line_qs(coa, company_id, end, unscoped_lines)
        elif station_id is not None:
            bal = _balance_sheet_balance_from_site_activity(coa, company_id, end, station_id)
        else:
            bal = _ending_balance(coa, company_id, end)
        if bal == 0:
            continue

        if t in ("asset", "bank_account") or (t == "loan" and st != "loan_payable"):
            bucket = "asset"
        elif t == "liability" or (t == "loan" and st == "loan_payable"):
            bucket = "liability"
        elif t == "equity":
            bucket = "equity"
        else:
            ub = _unknown_type_balance_sheet_bucket(coa.account_type)
            if ub == "asset":
                bucket = "asset"
            elif ub == "liability":
                bucket = "liability"
            else:
                bucket = "equity"

        display_name = coa.account_name
        if not coa.is_active:
            display_name = f"{display_name} (inactive)"

        row = {
            "account_id": coa.id,
            "account_code": coa.account_code,
            "account_name": display_name,
            "balance": _f(bal),
        }
        if t not in ("asset", "bank_account", "liability", "equity", "loan"):
            row["is_nonstandard_type"] = True

        if bucket == "asset":
            assets.append(row)
            ta += bal
        elif bucket == "liability":
            liabilities.append(row)
            tl += bal
        else:
            equity.append(row)
            te_plain += bal

    if pond_id is not None:
        ni_cum = _cumulative_net_income_pond_through(company_id, end, pond_id)
    elif unscoped_dims and unscoped_lines is not None:
        ni_cum = _cumulative_net_income_lines_through(company_id, end, unscoped_lines)
    elif station_id is not None:
        ni_cum = _cumulative_net_income_site_through(company_id, end, station_id)
    else:
        ni_cum = _cumulative_net_income_through(company_id, end)
    if ni_cum != 0:
        equity.append(
            {
                "account_code": "Σ-P&L",
                "account_name": "Net income (cumulative P&L — unclosed to equity)",
                "balance": _f(ni_cum),
                "is_rollup": True,
            }
        )

    te_total = te_plain + ni_cum
    diff = ta - tl - te_total
    auto_plug = Decimal("0")
    if abs(diff) > Decimal("0.02"):
        auto_plug = diff
        equity.append(
            {
                "account_code": "Σ-ADJ",
                "account_name": (
                    "Statement tie-out (rounding, one-sided openings, or unclassified activity)"
                ),
                "balance": _f(auto_plug),
                "is_rollup": True,
                "is_auto_plug": True,
            }
        )
        te_total = te_plain + ni_cum + auto_plug

    tle = tl + te_total
    final_diff = ta - tle
    note = (
        "Point-in-time as of end date. Unclosed P&L is included in equity as Σ-P&L; Σ-ADJ is an automatic tie-out if a small residual remains."
    )
    if pond_id is not None:
        note = (
            note
            + " Pond filter: balances use only posted journal lines tagged to this pond_id (chart opening balances are excluded); Σ-P&L uses the same pond-tagged activity."
        )
    elif station_id is not None:
        note = (
            note
            + " Site filter: balances use only posted journal lines with this station_id (chart opening balances are excluded); Σ-P&L uses the same site-tagged activity."
        )
    elif unscoped_dims:
        note = (
            note
            + " Head office filter: balances use only posted journal lines with no station or pond tag (chart opening balances are excluded)."
        )
    out_bs: dict[str, Any] = {
        "report_id": "balance-sheet",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "assets": {"accounts": assets, "total": _f(ta)},
        "liabilities": {"accounts": liabilities, "total": _f(tl)},
        "equity": {
            "accounts": equity,
            "total": _f(te_total),
            "from_chart_accounts": _f(te_plain),
        },
        "total_liabilities_and_equity": _f(tle),
        "net_income_cumulative": _f(ni_cum),
        "auto_plug_amount": _f(auto_plug) if auto_plug != 0 else 0.0,
        "is_balanced": abs(final_diff) <= Decimal("0.02"),
        "assets_minus_liabilities_equity": _f(final_diff),
        "accounting_note": note,
    }
    if station_id is not None:
        out_bs["filter_station_id"] = station_id
    if pond_id is not None:
        out_bs["filter_pond_id"] = pond_id
    if unscoped_dims:
        out_bs["filter_head_office"] = True
    return out_bs


def report_liabilities_detail(
    company_id: int, start: date, end: date, station_id: int | None = None
) -> dict[str, Any]:
    """
    All liability-bucket chart accounts with balance as of ``end`` (same basis as balance sheet).
    Includes ``account_id`` for linking to the GL account statement.
    """
    _ = start
    rows: list[dict[str, Any]] = []
    total = Decimal("0")
    for coa in ChartOfAccount.objects.filter(company_id=company_id).order_by("account_code"):
        if _balance_sheet_bucket_for_coa(coa) != "liability":
            continue
        if station_id is not None:
            bal = _balance_sheet_balance_from_site_activity(coa, company_id, end, station_id)
        else:
            bal = _ending_balance(coa, company_id, end)
        if bal == 0:
            continue
        total += bal
        display_name = coa.account_name
        if not coa.is_active:
            display_name = f"{display_name} (inactive)"
        rows.append(
            {
                "account_id": coa.id,
                "account_code": coa.account_code,
                "account_name": display_name,
                "account_type": normalize_chart_account_type(coa.account_type),
                "balance": _f(bal),
            }
        )
    note = (
        "Point-in-time liability balances as of the report end date (same classification as the balance sheet)."
    )
    if station_id is not None:
        note += (
            " Site filter: balances use only posted journal lines with this station_id "
            "(chart opening balances are excluded)."
        )
    out: dict[str, Any] = {
        "report_id": "liabilities-detail",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "accounts": rows,
        "total_liabilities": _f(total),
        "accounting_note": note,
        "summary": {
            "total_liabilities": _f(total),
            "account_count": len(rows),
        },
    }
    if station_id is not None:
        out["filter_station_id"] = station_id
    return out


def report_loan_receivable_gl(
    company_id: int, start: date, end: date, station_id: int | None = None
) -> dict[str, Any]:
    """
    Chart accounts classified as loans receivable (loan type, sub-type other than loan_payable).
    """
    _ = start
    rows: list[dict[str, Any]] = []
    total = Decimal("0")
    for coa in ChartOfAccount.objects.filter(company_id=company_id).order_by("account_code"):
        if _balance_sheet_bucket_for_coa(coa) != "asset":
            continue
        t = normalize_chart_account_type(coa.account_type)
        st = (coa.account_sub_type or "").strip().lower()
        if not (t == "loan" and st != "loan_payable"):
            continue
        if station_id is not None:
            bal = _balance_sheet_balance_from_site_activity(coa, company_id, end, station_id)
        else:
            bal = _ending_balance(coa, company_id, end)
        if bal == 0:
            continue
        total += bal
        display_name = coa.account_name
        if not coa.is_active:
            display_name = f"{display_name} (inactive)"
        rows.append(
            {
                "account_id": coa.id,
                "account_code": coa.account_code,
                "account_name": display_name,
                "account_sub_type": st or "",
                "balance": _f(bal),
            }
        )
    note = (
        "Loans receivable — asset-side principal accounts (chart type loan, sub-type not loan payable). "
        "Balance as of end date."
    )
    if station_id is not None:
        note += (
            " Site filter: balances use only posted journal lines with this station_id "
            "(chart opening balances are excluded)."
        )
    out: dict[str, Any] = {
        "report_id": "loan-receivable-gl",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "accounts": rows,
        "total_loan_receivable_gl": _f(total),
        "accounting_note": note,
        "summary": {
            "total_loan_receivable_gl": _f(total),
            "account_count": len(rows),
        },
    }
    if station_id is not None:
        out["filter_station_id"] = station_id
    return out


def report_loan_payable_gl(
    company_id: int, start: date, end: date, station_id: int | None = None
) -> dict[str, Any]:
    """
    Chart accounts classified as loans payable (loan type, sub-type loan_payable).
    """
    _ = start
    rows: list[dict[str, Any]] = []
    total = Decimal("0")
    for coa in ChartOfAccount.objects.filter(company_id=company_id).order_by("account_code"):
        if _balance_sheet_bucket_for_coa(coa) != "liability":
            continue
        t = normalize_chart_account_type(coa.account_type)
        st = (coa.account_sub_type or "").strip().lower()
        if not (t == "loan" and st == "loan_payable"):
            continue
        if station_id is not None:
            bal = _balance_sheet_balance_from_site_activity(coa, company_id, end, station_id)
        else:
            bal = _ending_balance(coa, company_id, end)
        if bal == 0:
            continue
        total += bal
        display_name = coa.account_name
        if not coa.is_active:
            display_name = f"{display_name} (inactive)"
        rows.append(
            {
                "account_id": coa.id,
                "account_code": coa.account_code,
                "account_name": display_name,
                "account_sub_type": st or "",
                "balance": _f(bal),
            }
        )
    note = (
        "Loans payable — liability-side principal accounts (chart type loan, sub-type loan payable). "
        "Balance as of end date."
    )
    if station_id is not None:
        note += (
            " Site filter: balances use only posted journal lines with this station_id "
            "(chart opening balances are excluded)."
        )
    out: dict[str, Any] = {
        "report_id": "loan-payable-gl",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "accounts": rows,
        "total_loan_payable_gl": _f(total),
        "accounting_note": note,
        "summary": {
            "total_loan_payable_gl": _f(total),
            "account_count": len(rows),
        },
    }
    if station_id is not None:
        out["filter_station_id"] = station_id
    return out


def report_loans_borrow_and_lent(
    company_id: int,
    start: date,
    end: date,
    station_id: int | None = None,
    *,
    strict_site: bool = False,
) -> dict[str, Any]:
    """
    Operational loan facilities (borrowed vs lent) with GL keys for drill-down.
    Period columns aggregate disbursements and repayments between start and end (inclusive).
    When ``station_id`` is set, ``strict_site`` excludes company-wide loans (no site tag).
    """
    qs = (
        Loan.objects.filter(company_id=company_id)
        .select_related(
            "counterparty",
            "principal_account",
            "settlement_account",
            "interest_account",
            "interest_accrual_account",
            "station",
            "parent_loan",
        )
        .order_by("direction", "loan_no")
    )
    if station_id is not None:
        if strict_site:
            qs = qs.filter(station_id=station_id)
        else:
            qs = qs.filter(Q(station_id=station_id) | Q(station_id__isnull=True))

    loan_ids = list(qs.values_list("id", flat=True))
    disb_by_loan: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    rep_by_loan: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    if loan_ids:
        for row in (
            LoanDisbursement.objects.filter(
                loan_id__in=loan_ids,
                disbursement_date__gte=start,
                disbursement_date__lte=end,
            )
            .values("loan_id")
            .annotate(s=Coalesce(Sum("amount"), Decimal("0")))
        ):
            disb_by_loan[row["loan_id"]] = _d(row["s"])
        for row in (
            LoanRepayment.objects.filter(
                loan_id__in=loan_ids,
                repayment_date__gte=start,
                repayment_date__lte=end,
            )
            .values("loan_id")
            .annotate(s=Coalesce(Sum("amount"), Decimal("0")))
        ):
            rep_by_loan[row["loan_id"]] = _d(row["s"])

    borrowed: list[dict[str, Any]] = []
    lent: list[dict[str, Any]] = []
    ob = ol = Decimal("0")
    pd_tot = pr_tot = Decimal("0")

    for ln in qs:
        pd = disb_by_loan.get(ln.id, Decimal("0"))
        pr = rep_by_loan.get(ln.id, Decimal("0"))
        pd_tot += pd
        pr_tot += pr
        op = _d(ln.outstanding_principal)
        cp = ln.counterparty
        row = {
            "id": ln.id,
            "loan_no": ln.loan_no,
            "direction": ln.direction,
            "status": ln.status,
            "title": (ln.title or "").strip(),
            "counterparty_code": cp.code if cp else "",
            "counterparty_name": cp.name if cp else "",
            "banking_model": ln.banking_model,
            "product_type": ln.product_type,
            "sanction_amount": _f(_d(ln.sanction_amount)),
            "outstanding_principal": _f(op),
            "total_disbursed": _f(_d(ln.total_disbursed)),
            "total_repaid_principal": _f(_d(ln.total_repaid_principal or 0)),
            "annual_interest_rate": _f(_d(ln.annual_interest_rate)),
            "start_date": ln.start_date.isoformat() if ln.start_date else None,
            "maturity_date": ln.maturity_date.isoformat() if ln.maturity_date else None,
            "term_months": ln.term_months,
            "station_id": ln.station_id,
            "station_name": (ln.station.station_name if getattr(ln, "station", None) else None),
            "parent_loan_id": ln.parent_loan_id,
            "parent_loan_no": (ln.parent_loan.loan_no if ln.parent_loan_id else None),
            "deal_reference": (ln.deal_reference or "").strip(),
            "period_disbursements": _f(pd),
            "period_repayments": _f(pr),
            "principal_account_id": ln.principal_account_id,
            "settlement_account_id": ln.settlement_account_id,
            "interest_account_id": ln.interest_account_id,
            "interest_accrual_account_id": ln.interest_accrual_account_id,
        }
        if ln.direction == Loan.DIRECTION_BORROWED:
            borrowed.append(row)
            ob += op
        else:
            lent.append(row)
            ol += op

    note = (
        "Facilities from the loan register. Outstanding principal is the stored facility balance; "
        "period columns sum disbursements and repayments dated within the selected range."
    )
    if station_id is not None:
        if strict_site:
            note += " Site filter: this station only (company-wide loans excluded)."
        else:
            note += (
                " Site filter: includes loans tagged to this station or with no station (company-wide)."
            )
    out = {
        "report_id": "loans-borrow-and-lent",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "borrowed": borrowed,
        "lent": lent,
        "summary": {
            "borrowed_count": len(borrowed),
            "lent_count": len(lent),
            "outstanding_borrowed_principal": _f(ob),
            "outstanding_lent_principal": _f(ol),
            "period_disbursements_total": _f(pd_tot),
            "period_repayments_total": _f(pr_tot),
        },
        "accounting_note": note,
    }
    if station_id is not None:
        out["filter_station_id"] = station_id
        out["filter_strict_site"] = bool(strict_site)
    return out


def _period_pl_amount(
    coa: ChartOfAccount,
    company_id: int,
    start: date,
    end: date,
    station_id: int | None = None,
    pond_id: int | None = None,
) -> Decimal:
    line_qs = _je_lines_pl_scope(company_id, station_id, pond_id)
    return _period_pl_amount_lines(coa, company_id, start, end, line_qs)


def _period_income_statement_totals(
    company_id: int,
    start: date,
    end: date,
    station_id: int | None = None,
    pond_id: int | None = None,
) -> dict[str, Decimal]:
    """
    P&L totals for [start, end] from posted journal lines (same basis as income statement).
    """
    if pond_id is not None:
        return _period_pl_totals_from_line_qs(
            company_id, start, end, _je_lines_pond(company_id, pond_id)
        )
    return _period_pl_totals_from_line_qs(
        company_id, start, end, _je_lines_pl_scope(company_id, station_id)
    )


def _period_income_statement_totals_pond(
    company_id: int, start: date, end: date, pond_id: int
) -> dict[str, Decimal]:
    """P&L totals for [start, end] from posted journal lines tagged to one aquaculture pond."""
    return _period_pl_totals_from_line_qs(
        company_id, start, end, _je_lines_pond(company_id, pond_id)
    )


def _sum_invoice_totals(
    company_id: int, start: date, end: date, station_id: int | None = None
) -> Decimal:
    qs = Invoice.objects.filter(
        company_id=company_id,
        invoice_date__gte=start,
        invoice_date__lte=end,
    )
    if station_id is not None:
        qs = qs.filter(station_id=station_id)
    r = qs.aggregate(t=Coalesce(Sum("total"), Decimal("0")))
    return _d(r["t"])


def _sum_bill_totals(
    company_id: int, start: date, end: date, station_id: int | None = None
) -> Decimal:
    qs = Bill.objects.filter(
        company_id=company_id,
        bill_date__gte=start,
        bill_date__lte=end,
    )
    if station_id is not None:
        qs = qs.filter(
            Q(receipt_station_id=station_id) | Q(lines__receipt_station_id=station_id)
        ).distinct()
    r = qs.aggregate(t=Coalesce(Sum("total"), Decimal("0")))
    return _d(r["t"])


def _sum_invoice_totals_non_draft(
    company_id: int, start: date, end: date, station_id: int | None = None
) -> Decimal:
    qs = Invoice.objects.filter(
        company_id=company_id,
        invoice_date__gte=start,
        invoice_date__lte=end,
    ).exclude(status="draft")
    if station_id is not None:
        qs = qs.filter(station_id=station_id)
    r = qs.aggregate(t=Coalesce(Sum("total"), Decimal("0")))
    return _d(r["t"])


def _sum_invoice_totals_non_draft_all_time(company_id: int) -> Decimal:
    r = Invoice.objects.filter(company_id=company_id).exclude(status="draft").aggregate(
        t=Coalesce(Sum("total"), Decimal("0"))
    )
    return _d(r["t"])


def _sum_bill_totals_non_draft(
    company_id: int, start: date, end: date, station_id: int | None = None
) -> Decimal:
    qs = Bill.objects.filter(
        company_id=company_id,
        bill_date__gte=start,
        bill_date__lte=end,
    ).exclude(status="draft")
    if station_id is not None:
        qs = qs.filter(
            Q(receipt_station_id=station_id) | Q(lines__receipt_station_id=station_id)
        ).distinct()
    r = qs.aggregate(t=Coalesce(Sum("total"), Decimal("0")))
    return _d(r["t"])


def _count_invoices_non_draft(
    company_id: int, start: date, end: date, station_id: int | None = None
) -> int:
    qs = Invoice.objects.filter(
        company_id=company_id,
        invoice_date__gte=start,
        invoice_date__lte=end,
    ).exclude(status="draft")
    if station_id is not None:
        qs = qs.filter(station_id=station_id)
    return qs.count()


def _iter_month_periods_in_range(start: date, end: date) -> list[tuple[date, date, str]]:
    """Clipped calendar months within [start, end], each (seg_start, seg_end, 'YYYY-MM')."""
    if start > end:
        start, end = end, start
    out: list[tuple[date, date, str]] = []
    cur = date(start.year, start.month, 1)
    end_marker = date(end.year, end.month, 1)
    while cur <= end_marker:
        y, m = cur.year, cur.month
        last_d = monthrange(y, m)[1]
        ms = date(y, m, 1)
        me = date(y, m, last_d)
        seg_s = max(ms, start)
        seg_e = min(me, end)
        if seg_s <= seg_e:
            out.append((seg_s, seg_e, f"{y:04d}-{m:02d}"))
        if m == 12:
            cur = date(y + 1, 1, 1)
        else:
            cur = date(y, m + 1, 1)
    return out


def _pl_scope_accounting_note(
    station_id: int | None,
    pond_id: int | None,
    *,
    pond_name: str | None = None,
    unscoped_dims: bool = False,
) -> str:
    if pond_id is not None:
        label = (pond_name or "").strip() or f"Pond #{pond_id}"
        return (
            f" Pond filter ({label}): amounts use only posted journal lines tagged to this pond. "
            "Company-wide or other-pond lines are excluded."
        )
    if unscoped_dims:
        return (
            " Head office filter: amounts use only posted journal lines with no station or pond tag. "
            "Site-tagged and pond-tagged lines are excluded."
        )
    if station_id is not None:
        return (
            " Site filter: amounts use only posted journal lines for this station "
            "(line station_id or, when the line is untagged, the journal header station). "
            "Lines tagged to an aquaculture pond are excluded (use Pond scope or All Ponds — P&L). "
            "Company-wide untagged lines on other journals are excluded."
        )
    return ""


def report_income_statement(
    company_id: int,
    start: date,
    end: date,
    station_id: int | None = None,
    pond_id: int | None = None,
    *,
    unscoped_dims: bool = False,
) -> dict[str, Any]:
    income_rows: list[dict[str, Any]] = []
    cogs_rows: list[dict[str, Any]] = []
    exp_rows: list[dict[str, Any]] = []
    ti = tcogs = te = Decimal("0")
    if pond_id is not None:
        station_id = None
        unscoped_dims = False
    elif unscoped_dims:
        station_id = None
    line_qs = _je_lines_pl_scope(
        company_id, station_id, pond_id, unscoped_dims=unscoped_dims
    )
    pond_name: str | None = None
    if pond_id is not None:
        pond = AquaculturePond.objects.filter(
            pk=pond_id, company_id=company_id, is_active=True
        ).only("name").first()
        pond_name = (pond.name or "").strip() if pond else None
    # Cost of the goods actually sold in this period (subledger: qty x best-available unit cost).
    est_cogs = _estimated_cogs_from_invoice_lines(
        company_id, start, end, station_id=station_id, pond_id=pond_id
    )
    # Self-heal: every sale must show COGS. If the sold-goods cost exceeds the COGS already posted
    # to the GL for this scope, post the missing AUTO-INV-*-COGS journals (idempotent, dated at the
    # sale date) so the P&L never shows goods sold without matching Cost of Goods Sold. Keeping it in
    # the GL means the Balance Sheet and Trial Balance stay consistent with the P&L.
    if est_cogs > 0 and pond_id is None:
        posted_cogs_pre = _period_income_statement_totals(
            company_id, start, end, station_id
        )["cogs"]
        if est_cogs > posted_cogs_pre + Decimal("0.02"):
            backfill_invoice_cogs_journals(company_id, start, end)
    # Include inactive accounts: journals may still post to them; omitting them understates P&L.
    for coa in ChartOfAccount.objects.filter(company_id=company_id).order_by(
        "account_code"
    ):
        bucket = _pl_bucket(coa)
        if bucket is None:
            continue
        amt = _period_pl_amount_lines(coa, company_id, start, end, line_qs)
        if amt == 0:
            continue
        display_name = coa.account_name
        if not coa.is_active:
            display_name = f"{display_name} (inactive)"
        row = {
            "account_id": coa.id,
            "account_code": coa.account_code,
            "account_name": display_name,
            "balance": _f(amt),
        }
        if bucket == "income":
            income_rows.append(row)
            ti += amt
        elif bucket == "cost_of_goods_sold":
            cogs_rows.append(row)
            tcogs += amt
        else:
            exp_rows.append(row)
            te += amt
    gross = ti - tcogs
    net = gross - te
    # Posted activity in [start, end] should match Δ cumulative P&L unless COA opening balances exist on P&L rows.
    day_before = start - timedelta(days=1)
    if pond_id is not None or station_id is not None:
        ni_before = _cumulative_net_income_lines_through(company_id, day_before, line_qs)
        ni_end = _cumulative_net_income_lines_through(company_id, end, line_qs)
    else:
        ni_before = _cumulative_net_income_through(company_id, day_before)
        ni_end = _cumulative_net_income_through(company_id, end)
    cumulative_change = ni_end - ni_before
    period_matches_cumulative = abs(cumulative_change - net) <= Decimal("0.02")
    note = (
        "Posted journal activity in the date range only; opening balances on income/COGS/expense accounts are not added here. "
        "Income includes sales revenue from posted invoices and other income accounts; COGS includes cost relieved on sales "
        "(e.g. AUTO-INV-*-COGS) and other cost_of_goods_sold accounts; expenses are operating and other expense accounts. "
        "Gross profit = income − COGS; net income = gross profit − expenses. "
        "Cumulative change vs net income flags unusual opening-balance or dating issues."
    )
    note += _pl_scope_accounting_note(
        station_id, pond_id, pond_name=pond_name, unscoped_dims=unscoped_dims
    )
    if tcogs <= 0 and est_cogs > 0:
        note += (
            f" Inventory sales in this period imply about {_f(est_cogs)} in cost (qty × item cost) "
            "but no COGS journal could be posted — check that the items have COGS (5xxx) and "
            "inventory (12xx) accounts configured so AUTO-INV-*-COGS journals can be created."
        )
    out_is: dict[str, Any] = {
        "report_id": "income-statement",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "income": {"accounts": income_rows, "total": _f(ti)},
        "cost_of_goods_sold": {"accounts": cogs_rows, "total": _f(tcogs)},
        "expenses": {"accounts": exp_rows, "total": _f(te)},
        "gross_profit": _f(gross),
        "net_income": _f(net),
        "cumulative_net_income_change": _f(cumulative_change),
        "period_matches_cumulative_change": period_matches_cumulative,
        "cumulative_vs_period_difference": _f(cumulative_change - net),
        "accounting_note": note,
    }
    if pond_id is not None:
        out_is["filter_pond_id"] = pond_id
        if pond_name:
            out_is["filter_pond_name"] = pond_name
        out_is["aquaculture_management"] = _aquaculture_management_snapshot(
            company_id, start, end, pond_id
        )
    elif station_id is not None:
        out_is["filter_station_id"] = station_id
    if unscoped_dims:
        out_is["filter_head_office"] = True
    return out_is


def _invoices_for_subledger_scope(
    company_id: int, station_id: int | None = None, pond_id: int | None = None
):
    qs = Invoice.objects.filter(company_id=company_id)
    if pond_id is not None:
        pond = AquaculturePond.objects.filter(pk=pond_id, company_id=company_id).first()
        if pond and pond.pos_customer_id:
            qs = qs.filter(customer_id=pond.pos_customer_id)
        else:
            qs = qs.none()
    elif station_id is not None:
        qs = qs.filter(station_id=station_id)
    return qs


def _bills_for_subledger_scope(
    company_id: int, station_id: int | None = None, pond_id: int | None = None
):
    qs = Bill.objects.filter(company_id=company_id)
    if pond_id is not None:
        qs = qs.filter(lines__aquaculture_pond_id=pond_id).distinct()
    elif station_id is not None:
        qs = qs.filter(
            Q(receipt_station_id=station_id) | Q(lines__receipt_station_id=station_id)
        ).distinct()
    return qs


def _customer_open_balance_at_station(
    company_id: int, customer_id: int, station_id: int
) -> Decimal:
    total = Decimal("0")
    for inv in _invoices_for_subledger_scope(company_id, station_id).filter(customer_id=customer_id):
        total += invoice_open_amount(inv, company_id)
    return total


def _vendor_open_balance_at_station(
    company_id: int, vendor_id: int, station_id: int
) -> Decimal:
    total = Decimal("0")
    for bill in _bills_for_subledger_scope(company_id, station_id).filter(vendor_id=vendor_id):
        total += bill_open_amount(bill, company_id)
    return total


def report_customer_balances(
    company_id: int,
    start: date,
    end: date,
    station_id: int | None = None,
    pond_id: int | None = None,
) -> dict[str, Any]:
    _ = start
    rows: list[dict[str, Any]] = []
    total_ar = Decimal("0")
    for c in Customer.objects.filter(company_id=company_id, is_active=True).order_by(
        "display_name"
    ):
        if pond_id is not None:
            bal = Decimal("0")
            for inv in _invoices_for_subledger_scope(company_id, pond_id=pond_id).filter(
                customer_id=c.id
            ):
                bal += invoice_open_amount(inv, company_id)
        elif station_id is not None:
            bal = _customer_open_balance_at_station(company_id, c.id, station_id)
        else:
            bal = c.current_balance or Decimal("0")
        if (station_id is not None or pond_id is not None) and bal == 0:
            continue
        rows.append(
            {
                "customer_id": c.id,
                "customer_number": c.customer_number or "",
                "display_name": c.display_name or c.company_name or "",
                "company_name": c.company_name or "",
                "email": c.email or "",
                "phone": c.phone or "",
                "balance": _f(bal),
            }
        )
        if bal > 0:
            total_ar += bal
    net_sum = sum((_d(r["balance"]) for r in rows), start=Decimal("0"))
    note = (
        "Subledger current_balance per customer. total_ar is the sum of positive balances only "
        "(typical receivable exposure); credit balances are customer prepayments."
    )
    if pond_id is not None:
        note += (
            " Pond filter: balance is open invoice exposure for this pond's POS customer only "
            "(AquaculturePond.pos_customer); other customers are excluded."
        )
    elif station_id is not None:
        note += (
            " Site filter: balance is open invoice exposure at this station only "
            "(invoice.station_id); company-wide customer opening balances without invoices are excluded."
        )
    out: dict[str, Any] = {
        "report_id": "customer-balances",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "customers": rows,
        "total_ar": _f(total_ar),
        "total_net_balance": _f(net_sum),
        "accounting_note": note,
    }
    if pond_id is not None:
        out["filter_pond_id"] = pond_id
    elif station_id is not None:
        out["filter_station_id"] = station_id
    return out


def report_vendor_balances(
    company_id: int,
    start: date,
    end: date,
    station_id: int | None = None,
    pond_id: int | None = None,
) -> dict[str, Any]:
    _ = start
    rows: list[dict[str, Any]] = []
    total_ap = Decimal("0")
    for v in Vendor.objects.filter(company_id=company_id, is_active=True).order_by(
        "company_name"
    ):
        if pond_id is not None:
            bal = Decimal("0")
            bill_ids = (
                BillLine.objects.filter(
                    bill__company_id=company_id,
                    aquaculture_pond_id=pond_id,
                    bill__vendor_id=v.id,
                )
                .values_list("bill_id", flat=True)
                .distinct()
            )
            for bill in Bill.objects.filter(pk__in=bill_ids).exclude(
                status__in=("draft", "paid", "void")
            ):
                bal += bill_open_amount(bill, company_id)
        elif station_id is not None:
            bal = _vendor_open_balance_at_station(company_id, v.id, station_id)
        else:
            bal = v.current_balance or Decimal("0")
        if (station_id is not None or pond_id is not None) and bal == 0:
            continue
        rows.append(
            {
                "vendor_id": v.id,
                "vendor_number": v.vendor_number or "",
                "display_name": v.display_name or v.company_name or "",
                "company_name": v.company_name or "",
                "email": v.email or "",
                "phone": v.phone or "",
                "balance": _f(bal),
            }
        )
        if bal > 0:
            total_ap += bal
    net_sum = sum((_d(r["balance"]) for r in rows), start=Decimal("0"))
    note = (
        "Subledger current_balance per vendor. total_ap is the sum of positive balances owed to vendors; "
        "negative balances may indicate vendor credits."
    )
    if pond_id is not None:
        note += (
            " Pond filter: balance is open bill exposure with at least one line tagged to this pond "
            "(BillLine.aquaculture_pond_id); company-wide vendor opening balances without bills are excluded."
        )
    elif station_id is not None:
        note += (
            " Site filter: balance is open bill exposure received at this station "
            "(bill or line receipt_station_id); company-wide vendor opening balances without bills are excluded."
        )
    out: dict[str, Any] = {
        "report_id": "vendor-balances",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "vendors": rows,
        "total_ap": _f(total_ap),
        "total_net_balance": _f(net_sum),
        "accounting_note": note,
    }
    if pond_id is not None:
        out["filter_pond_id"] = pond_id
    elif station_id is not None:
        out["filter_station_id"] = station_id
    return out


_AGING_BUCKET_KEYS = ("current", "days_1_30", "days_31_60", "days_61_90", "days_over_90")


def _empty_aging_buckets() -> dict[str, Decimal]:
    return {k: Decimal("0") for k in _AGING_BUCKET_KEYS}


def _aging_bucket_key(days_past_due: int) -> str:
    if days_past_due <= 0:
        return "current"
    if days_past_due <= 30:
        return "days_1_30"
    if days_past_due <= 60:
        return "days_31_60"
    if days_past_due <= 90:
        return "days_61_90"
    return "days_over_90"


def _aging_row_from_buckets(buckets: dict[str, Decimal]) -> dict[str, Any]:
    total = sum(buckets.values(), start=Decimal("0"))
    out = {k: _f(buckets[k]) for k in _AGING_BUCKET_KEYS}
    out["total"] = _f(total)
    return out


def report_ar_aging(
    company_id: int,
    start: date,
    end: date,
    station_id: int | None = None,
    pond_id: int | None = None,
) -> dict[str, Any]:
    """Open invoice balances by customer, bucketed by days past due as of period end."""
    _ = start
    as_of = end
    customers_out: list[dict[str, Any]] = []
    totals = _empty_aging_buckets()

    for c in Customer.objects.filter(company_id=company_id, is_active=True).order_by(
        "display_name", "company_name"
    ):
        buckets = _empty_aging_buckets()
        documents: list[dict[str, Any]] = []
        for inv in (
            _invoices_for_subledger_scope(company_id, station_id=station_id, pond_id=pond_id)
            .filter(customer_id=c.id)
            .exclude(status__in=("draft", "paid", "void"))
            .order_by("due_date", "invoice_date", "id")
        ):
            open_amt = invoice_open_amount(inv, company_id)
            if open_amt <= 0:
                continue
            due = inv.due_date or inv.invoice_date
            days_past = (as_of - due).days
            bucket = _aging_bucket_key(days_past)
            buckets[bucket] += open_amt
            totals[bucket] += open_amt
            documents.append(
                {
                    "document_type": "invoice",
                    "invoice_id": inv.id,
                    "document_number": inv.invoice_number,
                    "document_date": inv.invoice_date.isoformat(),
                    "due_date": due.isoformat() if due else None,
                    "days_past_due": days_past,
                    "bucket": bucket,
                    "amount": _f(open_amt),
                    "status": inv.status,
                }
            )
        if sum(buckets.values(), start=Decimal("0")) <= 0:
            continue
        row = {
            "customer_id": c.id,
            "customer_number": c.customer_number or "",
            "display_name": c.display_name or c.company_name or "",
            "company_name": c.company_name or "",
            **_aging_row_from_buckets(buckets),
            "documents": documents,
        }
        customers_out.append(row)

    note = (
        "Aging uses open invoice balances (total minus payment allocations) as of the end date. "
        "Days past due = end date minus due date (or invoice date when due date is blank). "
        "Customer opening balances without invoices are not aged here — see Customer Balances."
    )
    if pond_id is not None:
        note += " Pond filter: only invoices for this pond's POS customer are included."
    elif station_id is not None:
        note += " Site filter: only invoices with this station_id are included."
    out: dict[str, Any] = {
        "report_id": "ar-aging",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "as_of_date": as_of.isoformat(),
        "customers": customers_out,
        "totals": _aging_row_from_buckets(totals),
        "accounting_note": note,
    }
    if pond_id is not None:
        out["filter_pond_id"] = pond_id
    elif station_id is not None:
        out["filter_station_id"] = station_id
    return out


def report_ap_aging(
    company_id: int,
    start: date,
    end: date,
    station_id: int | None = None,
    pond_id: int | None = None,
) -> dict[str, Any]:
    """Open vendor bill balances by vendor, bucketed by days past due as of period end."""
    _ = start
    as_of = end
    vendors_out: list[dict[str, Any]] = []
    totals = _empty_aging_buckets()

    for v in Vendor.objects.filter(company_id=company_id, is_active=True).order_by(
        "company_name", "display_name"
    ):
        buckets = _empty_aging_buckets()
        documents: list[dict[str, Any]] = []
        for bill in (
            _bills_for_subledger_scope(company_id, station_id=station_id, pond_id=pond_id)
            .filter(vendor_id=v.id)
            .exclude(status__in=("draft", "paid", "void"))
            .order_by("due_date", "bill_date", "id")
        ):
            open_amt = bill_open_amount(bill, company_id)
            if open_amt <= 0:
                continue
            due = bill.due_date or bill.bill_date
            days_past = (as_of - due).days
            bucket = _aging_bucket_key(days_past)
            buckets[bucket] += open_amt
            totals[bucket] += open_amt
            documents.append(
                {
                    "document_type": "bill",
                    "bill_id": bill.id,
                    "document_number": bill.bill_number,
                    "document_date": bill.bill_date.isoformat(),
                    "due_date": due.isoformat() if due else None,
                    "days_past_due": days_past,
                    "bucket": bucket,
                    "amount": _f(open_amt),
                    "status": bill.status,
                }
            )
        if sum(buckets.values(), start=Decimal("0")) <= 0:
            continue
        vendors_out.append(
            {
                "vendor_id": v.id,
                "vendor_number": v.vendor_number or "",
                "display_name": v.display_name or v.company_name or "",
                "company_name": v.company_name or "",
                **_aging_row_from_buckets(buckets),
                "documents": documents,
            }
        )

    note = (
        "Aging uses open bill balances (total minus vendor payment allocations) as of the end date. "
        "Days past due = end date minus due date (or bill date when due date is blank)."
    )
    if pond_id is not None:
        note += " Pond filter: only bills with at least one line tagged to this pond are included."
    elif station_id is not None:
        note += " Site filter: only bills received at this station (header or line receipt_station_id)."
    out: dict[str, Any] = {
        "report_id": "ap-aging",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "as_of_date": as_of.isoformat(),
        "vendors": vendors_out,
        "totals": _aging_row_from_buckets(totals),
        "accounting_note": note,
    }
    if pond_id is not None:
        out["filter_pond_id"] = pond_id
    elif station_id is not None:
        out["filter_station_id"] = station_id
    return out


def report_expense_detail(
    company_id: int,
    start: date,
    end: date,
    station_id: int | None = None,
    pond_id: int | None = None,
    *,
    unscoped_dims: bool = False,
) -> dict[str, Any]:
    """Operating and other expense accounts from posted GL activity (P&L expense section only)."""
    exp_rows: list[dict[str, Any]] = []
    te = Decimal("0")
    if pond_id is not None:
        station_id = None
        unscoped_dims = False
    elif unscoped_dims:
        station_id = None
    line_qs = _je_lines_pl_scope(
        company_id, station_id, pond_id, unscoped_dims=unscoped_dims
    )
    pond_name: str | None = None
    if pond_id is not None:
        pond = AquaculturePond.objects.filter(
            pk=pond_id, company_id=company_id, is_active=True
        ).only("name").first()
        pond_name = (pond.name or "").strip() if pond else None
    for coa in ChartOfAccount.objects.filter(company_id=company_id).order_by("account_code"):
        if _pl_bucket(coa) != "expense":
            continue
        amt = _period_pl_amount_lines(coa, company_id, start, end, line_qs)
        if amt == 0:
            continue
        display_name = coa.account_name
        if not coa.is_active:
            display_name = f"{display_name} (inactive)"
        exp_rows.append(
            {
                "account_id": coa.id,
                "account_code": coa.account_code,
                "account_name": display_name,
                "balance": _f(amt),
            }
        )
        te += amt
    note = (
        "Posted journal activity on expense-type chart accounts in the date range "
        "(same basis as the Income Statement expense section). "
        "Cost of goods sold (e.g. fuel 5100, shop 5120) is on Profit & Loss under "
        "Cost of Goods Sold, not in this report."
    )
    note += _pl_scope_accounting_note(
        station_id, pond_id, pond_name=pond_name, unscoped_dims=unscoped_dims
    )
    out: dict[str, Any] = {
        "report_id": "expense-detail",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "expenses": {"accounts": exp_rows, "total": _f(te)},
        "accounting_note": note,
    }
    if pond_id is not None:
        out["filter_pond_id"] = pond_id
        if pond_name:
            out["filter_pond_name"] = pond_name
        out["aquaculture_management"] = _aquaculture_management_snapshot(
            company_id, start, end, pond_id
        )
    elif station_id is not None:
        out["filter_station_id"] = station_id
    if unscoped_dims:
        out["filter_head_office"] = True
    return out


def report_income_detail(
    company_id: int,
    start: date,
    end: date,
    station_id: int | None = None,
    pond_id: int | None = None,
    *,
    unscoped_dims: bool = False,
) -> dict[str, Any]:
    """Income accounts from posted GL activity (P&L income section only)."""
    income_rows: list[dict[str, Any]] = []
    ti = Decimal("0")
    if pond_id is not None:
        station_id = None
        unscoped_dims = False
    elif unscoped_dims:
        station_id = None
    line_qs = _je_lines_pl_scope(
        company_id, station_id, pond_id, unscoped_dims=unscoped_dims
    )
    pond_name: str | None = None
    if pond_id is not None:
        pond = AquaculturePond.objects.filter(
            pk=pond_id, company_id=company_id, is_active=True
        ).only("name").first()
        pond_name = (pond.name or "").strip() if pond else None
    for coa in ChartOfAccount.objects.filter(company_id=company_id).order_by("account_code"):
        if normalize_chart_account_type(coa.account_type) != "income":
            continue
        amt = _period_pl_amount_lines(coa, company_id, start, end, line_qs)
        if amt == 0:
            continue
        display_name = coa.account_name
        if not coa.is_active:
            display_name = f"{display_name} (inactive)"
        income_rows.append(
            {
                "account_id": coa.id,
                "account_code": coa.account_code,
                "account_name": display_name,
                "balance": _f(amt),
            }
        )
        ti += amt
    note = (
        "Posted journal activity on income-type chart accounts in the date range "
        "(same basis as the Income Statement income section). "
        "Cost of goods sold and operating expenses are on Profit & Loss, not in this report."
    )
    note += _pl_scope_accounting_note(
        station_id, pond_id, pond_name=pond_name, unscoped_dims=unscoped_dims
    )
    out: dict[str, Any] = {
        "report_id": "income-detail",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "income": {"accounts": income_rows, "total": _f(ti)},
        "accounting_note": note,
    }
    if pond_id is not None:
        out["filter_pond_id"] = pond_id
        if pond_name:
            out["filter_pond_name"] = pond_name
        out["aquaculture_management"] = _aquaculture_management_snapshot(
            company_id, start, end, pond_id
        )
    elif station_id is not None:
        out["filter_station_id"] = station_id
    if unscoped_dims:
        out["filter_head_office"] = True
    return out


def _bank_cash_balance_as_of(
    coa: ChartOfAccount, company_id: int, as_of: date, station_id: int | None
) -> Decimal:
    if station_id is not None:
        return _balance_sheet_balance_from_site_activity(coa, company_id, as_of, station_id)
    return _ending_balance(coa, company_id, as_of)


def _bank_slice_balance_as_of(
    coa: ChartOfAccount, company_id: int, as_of: date, line_qs
) -> Decimal:
    """Bank register balance from a filtered journal-line queryset (pond or unscoped slice)."""
    agg = line_qs.filter(
        account_id=coa.id,
        journal_entry__entry_date__lte=as_of,
    ).aggregate(
        td=Coalesce(Sum("debit"), Decimal("0")),
        tc=Coalesce(Sum("credit"), Decimal("0")),
    )
    return agg["td"] - agg["tc"]


def _bank_period_flow(
    coa: ChartOfAccount, company_id: int, start: date, end: date, station_id: int | None
) -> tuple[Decimal, Decimal, Decimal, Decimal]:
    """Return beginning, deposits (debits), withdrawals (credits), ending for a bank register account."""
    day_before = start - timedelta(days=1)
    beginning = _bank_cash_balance_as_of(coa, company_id, day_before, station_id)
    agg = (
        _je_lines_base(company_id, station_id)
        .filter(
            account_id=coa.id,
            journal_entry__entry_date__gte=start,
            journal_entry__entry_date__lte=end,
        )
        .aggregate(
            td=Coalesce(Sum("debit"), Decimal("0")),
            tc=Coalesce(Sum("credit"), Decimal("0")),
        )
    )
    deposits = agg["td"]
    withdrawals = agg["tc"]
    ending = _bank_cash_balance_as_of(coa, company_id, end, station_id)
    return beginning, deposits, withdrawals, ending


def _bank_period_flow_lines(
    coa: ChartOfAccount,
    company_id: int,
    start: date,
    end: date,
    line_qs,
) -> tuple[Decimal, Decimal, Decimal, Decimal]:
    day_before = start - timedelta(days=1)
    beginning = _bank_slice_balance_as_of(coa, company_id, day_before, line_qs)
    agg = line_qs.filter(
        account_id=coa.id,
        journal_entry__entry_date__gte=start,
        journal_entry__entry_date__lte=end,
    ).aggregate(
        td=Coalesce(Sum("debit"), Decimal("0")),
        tc=Coalesce(Sum("credit"), Decimal("0")),
    )
    deposits = agg["td"]
    withdrawals = agg["tc"]
    ending = _bank_slice_balance_as_of(coa, company_id, end, line_qs)
    return beginning, deposits, withdrawals, ending


def _period_pl_amount_lines(
    coa: ChartOfAccount, company_id: int, start: date, end: date, line_qs
) -> Decimal:
    agg = line_qs.filter(
        account_id=coa.id,
        journal_entry__entry_date__gte=start,
        journal_entry__entry_date__lte=end,
    ).aggregate(
        td=Coalesce(Sum("debit"), Decimal("0")),
        tc=Coalesce(Sum("credit"), Decimal("0")),
    )
    d, c = agg["td"], agg["tc"]
    return _pl_amount_from_movement(coa, d, c)


def _period_net_income_from_lines(company_id: int, start: date, end: date, line_qs) -> Decimal:
    return _period_pl_totals_from_line_qs(company_id, start, end, line_qs)["net_income"]


def _summarize_bank_accounts_for_scope(
    company_id: int,
    start: date,
    end: date,
    *,
    station_id: int | None = None,
    pond_id: int | None = None,
    unscoped_dims: bool = False,
) -> dict[str, Decimal]:
    begin_total = end_total = period_in = period_out = Decimal("0")
    for coa in ChartOfAccount.objects.filter(company_id=company_id).order_by("account_code"):
        if normalize_chart_account_type(coa.account_type) != "bank_account":
            continue
        if pond_id is not None:
            b0, dep, wit, bend = _bank_period_flow_lines(
                coa, company_id, start, end, _je_lines_pond(company_id, pond_id)
            )
        elif unscoped_dims:
            b0, dep, wit, bend = _bank_period_flow_lines(
                coa, company_id, start, end, _je_lines_unscoped_dims(company_id)
            )
        else:
            b0, dep, wit, bend = _bank_period_flow(coa, company_id, start, end, station_id)
        if b0 == 0 and dep == 0 and wit == 0 and bend == 0:
            continue
        begin_total += b0
        end_total += bend
        period_in += dep
        period_out += wit
    return {
        "beginning": begin_total,
        "ending": end_total,
        "deposits": period_in,
        "withdrawals": period_out,
        "net_change": end_total - begin_total,
    }


def _cash_flow_entity_row(
    company_id: int,
    start: date,
    end: date,
    *,
    entity_type: str,
    entity_id: int | None,
    entity_name: str,
    station_id: int | None = None,
    pond_id: int | None = None,
    unscoped_dims: bool = False,
) -> dict[str, Any]:
    if pond_id is not None:
        line_qs = _je_lines_pond(company_id, pond_id)
        net_income = _period_net_income_from_lines(company_id, start, end, line_qs)
        pay_recv = _d(
            AquacultureFishSale.objects.filter(
                company_id=company_id,
                pond_id=pond_id,
                sale_date__gte=start,
                sale_date__lte=end,
            ).aggregate(t=Coalesce(Sum("total_amount"), Decimal("0")))["t"]
        )
        pay_made = Decimal("0")
    elif unscoped_dims:
        line_qs = _je_lines_unscoped_dims(company_id)
        net_income = _period_net_income_from_lines(company_id, start, end, line_qs)
        pay_recv = _d(
            Payment.objects.filter(
                company_id=company_id,
                payment_type=Payment.PAYMENT_TYPE_RECEIVED,
                payment_date__gte=start,
                payment_date__lte=end,
                station_id__isnull=True,
            ).aggregate(t=Coalesce(Sum("amount"), Decimal("0")))["t"]
        )
        pay_made = _d(
            Payment.objects.filter(
                company_id=company_id,
                payment_type=Payment.PAYMENT_TYPE_MADE,
                payment_date__gte=start,
                payment_date__lte=end,
                station_id__isnull=True,
            ).aggregate(t=Coalesce(Sum("amount"), Decimal("0")))["t"]
        )
    else:
        net_income = _period_income_statement_totals(company_id, start, end, station_id)["net_income"]
        pay_q = Payment.objects.filter(
            company_id=company_id,
            payment_date__gte=start,
            payment_date__lte=end,
        )
        if station_id is not None:
            pay_q = pay_q.filter(station_id=station_id)
        pay_recv = _d(
            pay_q.filter(payment_type=Payment.PAYMENT_TYPE_RECEIVED).aggregate(
                t=Coalesce(Sum("amount"), Decimal("0"))
            )["t"]
        )
        pay_made = _d(
            pay_q.filter(payment_type=Payment.PAYMENT_TYPE_MADE).aggregate(
                t=Coalesce(Sum("amount"), Decimal("0"))
            )["t"]
        )

    cash = _summarize_bank_accounts_for_scope(
        company_id,
        start,
        end,
        station_id=station_id,
        pond_id=pond_id,
        unscoped_dims=unscoped_dims,
    )
    row: dict[str, Any] = {
        "entity_type": entity_type,
        "entity_id": entity_id,
        "entity_name": entity_name,
        "net_income": _f(net_income),
        "customer_payments_received": _f(pay_recv),
        "vendor_payments_made": _f(pay_made),
        "beginning_cash": _f(cash["beginning"]),
        "ending_cash": _f(cash["ending"]),
        "net_change_in_cash": _f(cash["net_change"]),
        "total_deposits": _f(cash["deposits"]),
        "total_withdrawals": _f(cash["withdrawals"]),
    }
    if pond_id is not None:
        row["aquaculture_sales_in_period"] = _f(pay_recv)
    return row


def report_cash_flow(
    company_id: int, start: date, end: date, station_id: int | None = None,
    pond_id: int | None = None,
    *,
    unscoped_dims: bool = False,
) -> dict[str, Any]:
    """
    Cash flow summary: bank register activity, customer/vendor payments, and P&L net income.
    When not site-filtered, includes by_station, by_pond, and unscoped (head office) entity rows.

    When ``pond_id`` is set, the report is scoped to that pond as an individual entity: net income,
    bank activity, and cash use pond-tagged GL only, with registered pond fish sales (BDT) as the
    cash-in proxy (payments are not pond-tagged). ``station_id`` is ignored in that case.
    """
    if pond_id is not None:
        station_id = None
        unscoped_dims = False
    elif unscoped_dims:
        station_id = None
    pond_lines = _je_lines_pond(company_id, pond_id) if pond_id is not None else None
    unscoped_lines = _je_lines_unscoped_dims(company_id) if unscoped_dims else None
    if pond_id is not None:
        pl = _period_pl_totals_from_line_qs(company_id, start, end, pond_lines)
        pay_recv = _d(
            AquacultureFishSale.objects.filter(
                company_id=company_id,
                pond_id=pond_id,
                sale_date__gte=start,
                sale_date__lte=end,
            ).aggregate(t=Coalesce(Sum("total_amount"), Decimal("0")))["t"]
        )
        pay_made = Decimal("0")
    elif unscoped_dims and unscoped_lines is not None:
        pl = _period_pl_totals_from_line_qs(company_id, start, end, unscoped_lines)
        pay_recv = _d(
            Payment.objects.filter(
                company_id=company_id,
                payment_type=Payment.PAYMENT_TYPE_RECEIVED,
                payment_date__gte=start,
                payment_date__lte=end,
                station_id__isnull=True,
            ).aggregate(t=Coalesce(Sum("amount"), Decimal("0")))["t"]
        )
        pay_made = _d(
            Payment.objects.filter(
                company_id=company_id,
                payment_type=Payment.PAYMENT_TYPE_MADE,
                payment_date__gte=start,
                payment_date__lte=end,
                station_id__isnull=True,
            ).aggregate(t=Coalesce(Sum("amount"), Decimal("0")))["t"]
        )
    else:
        pl = _period_income_statement_totals(company_id, start, end, station_id)
        pay_recv = _d(
            Payment.objects.filter(
                company_id=company_id,
                payment_type=Payment.PAYMENT_TYPE_RECEIVED,
                payment_date__gte=start,
                payment_date__lte=end,
            ).aggregate(t=Coalesce(Sum("amount"), Decimal("0")))["t"]
        )
        pay_made = _d(
            Payment.objects.filter(
                company_id=company_id,
                payment_type=Payment.PAYMENT_TYPE_MADE,
                payment_date__gte=start,
                payment_date__lte=end,
            ).aggregate(t=Coalesce(Sum("amount"), Decimal("0")))["t"]
        )

    bank_rows: list[dict[str, Any]] = []
    begin_total = end_total = period_in = period_out = Decimal("0")
    for coa in ChartOfAccount.objects.filter(company_id=company_id).order_by("account_code"):
        if normalize_chart_account_type(coa.account_type) != "bank_account":
            continue
        if pond_id is not None:
            b0, dep, wit, bend = _bank_period_flow_lines(coa, company_id, start, end, pond_lines)
        elif unscoped_dims and unscoped_lines is not None:
            b0, dep, wit, bend = _bank_period_flow_lines(
                coa, company_id, start, end, unscoped_lines
            )
        else:
            b0, dep, wit, bend = _bank_period_flow(coa, company_id, start, end, station_id)
        if b0 == 0 and dep == 0 and wit == 0 and bend == 0:
            continue
        nm = coa.account_name
        if not coa.is_active:
            nm = f"{nm} (inactive)"
        bank_rows.append(
            {
                "account_id": coa.id,
                "account_code": coa.account_code,
                "account_name": nm,
                "beginning_balance": _f(b0),
                "deposits": _f(dep),
                "withdrawals": _f(wit),
                "ending_balance": _f(bend),
                "net_change": _f(bend - b0),
            }
        )
        begin_total += b0
        end_total += bend
        period_in += dep
        period_out += wit

    net_bank_change = end_total - begin_total
    out_cf: dict[str, Any] = {
        "report_id": "cash-flow",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "operating": {
            "net_income": _f(pl["net_income"]),
            "customer_payments_received": _f(pay_recv),
            "vendor_payments_made": _f(pay_made),
        },
        "bank_accounts": bank_rows,
        "cash_summary": {
            "beginning_cash": _f(begin_total),
            "ending_cash": _f(end_total),
            "net_change_in_cash": _f(net_bank_change),
            "total_deposits": _f(period_in),
            "total_withdrawals": _f(period_out),
        },
        "accounting_note": (
            "Bank accounts use chart type bank_account from posted journals. "
            "Payment totals are from the Payments module. "
            "When viewing all entities, each station uses GL lines tagged to that site; "
            "each pond uses pond-tagged GL bank activity plus registered pond sales (BDT) as cash-in proxy; "
            "Unscoped is GL and payments without a station tag."
        ),
    }
    if pond_id is not None:
        out_cf["filter_pond_id"] = pond_id
        out_cf["operating"]["aquaculture_sales_in_period"] = _f(pay_recv)
        out_cf["accounting_note"] = (
            out_cf["accounting_note"]
            + " Pond filter: this pond is reported as an individual entity using pond-tagged GL "
            "(net income and bank activity) plus registered pond fish sales as the cash-in proxy."
        )
    elif station_id is not None:
        out_cf["filter_station_id"] = station_id
        out_cf["accounting_note"] = (
            out_cf["accounting_note"]
            + " Site filter: company header and bank detail for this station only."
        )
    elif unscoped_dims:
        out_cf["filter_head_office"] = True
        out_cf["accounting_note"] = (
            out_cf["accounting_note"]
            + " Head office filter: GL and payments without a station or pond tag only."
        )
    else:
        by_station: list[dict[str, Any]] = []
        for st in Station.objects.filter(company_id=company_id, is_active=True).order_by(
            "station_name", "id"
        ):
            row = _cash_flow_entity_row(
                company_id,
                start,
                end,
                entity_type="station",
                entity_id=st.id,
                entity_name=(st.station_name or "").strip() or f"Station #{st.id}",
                station_id=st.id,
            )
            by_station.append(row)
        by_pond: list[dict[str, Any]] = []
        for pond in AquaculturePond.objects.filter(company_id=company_id, is_active=True).order_by(
            "sort_order", "name", "id"
        ):
            row = _cash_flow_entity_row(
                company_id,
                start,
                end,
                entity_type="pond",
                entity_id=pond.id,
                entity_name=(pond.name or "").strip() or f"Pond #{pond.id}",
                pond_id=pond.id,
            )
            by_pond.append(row)
        unscoped = _cash_flow_entity_row(
            company_id,
            start,
            end,
            entity_type="unscoped",
            entity_id=None,
            entity_name="Head office / unassigned (no site or pond tag)",
            unscoped_dims=True,
        )
        out_cf["by_station"] = by_station
        out_cf["by_pond"] = by_pond
        out_cf["unscoped"] = unscoped
        out_cf["entities"] = by_station + by_pond + [unscoped]
        _enrich_cash_flow_entity_splits(out_cf)
    return out_cf


def _cumulative_net_income_lines_through(company_id: int, as_of: date, line_qs) -> Decimal:
    """Cumulative P&L through ``as_of`` on a filtered journal-line queryset (pond or unscoped slice)."""
    ni = Decimal("0")
    for coa in ChartOfAccount.objects.filter(company_id=company_id).order_by("account_code"):
        bucket = _pl_bucket(coa)
        if bucket is None:
            continue
        agg = line_qs.filter(
            account_id=coa.id,
            journal_entry__entry_date__lte=as_of,
        ).aggregate(
            td=Coalesce(Sum("debit"), Decimal("0")),
            tc=Coalesce(Sum("credit"), Decimal("0")),
        )
        bal = _pl_amount_from_movement(coa, agg["td"], agg["tc"])
        if bucket == "income":
            ni += bal
        else:
            ni -= bal
    return ni


def _bs_totals_from_line_qs(company_id: int, as_of: date, line_qs) -> dict[str, Decimal]:
    """Balance sheet side totals from posted lines only (no chart opening balances)."""
    ta = tl = te_plain = Decimal("0")
    for coa in ChartOfAccount.objects.filter(company_id=company_id).order_by("account_code"):
        bucket = _balance_sheet_bucket_for_coa(coa)
        if not bucket:
            continue
        agg = line_qs.filter(
            account_id=coa.id,
            journal_entry__entry_date__lte=as_of,
        ).aggregate(
            td=Coalesce(Sum("debit"), Decimal("0")),
            tc=Coalesce(Sum("credit"), Decimal("0")),
        )
        d, c = agg["td"], agg["tc"]
        if bucket == "asset":
            bal = d - c
        else:
            bal = c - d
        if bal == 0:
            continue
        if bucket == "asset":
            ta += bal
        elif bucket == "liability":
            tl += bal
        else:
            te_plain += bal
    ni_cum = _cumulative_net_income_lines_through(company_id, as_of, line_qs)
    te_total = te_plain + ni_cum
    return {
        "total_assets": ta,
        "total_liabilities": tl,
        "total_equity": te_total,
        "total_liabilities_and_equity": tl + te_total,
        "cumulative_net_income_in_equity": ni_cum,
    }


def _bs_totals_station(company_id: int, as_of: date, station_id: int) -> dict[str, Decimal]:
    ta = tl = te_plain = Decimal("0")
    for coa in ChartOfAccount.objects.filter(company_id=company_id).order_by("account_code"):
        bucket = _balance_sheet_bucket_for_coa(coa)
        if not bucket:
            continue
        bal = _balance_sheet_balance_from_site_activity(coa, company_id, as_of, station_id)
        if bal == 0:
            continue
        if bucket == "asset":
            ta += bal
        elif bucket == "liability":
            tl += bal
        else:
            te_plain += bal
    ni_cum = _cumulative_net_income_site_through(company_id, as_of, station_id)
    te_total = te_plain + ni_cum
    return {
        "total_assets": ta,
        "total_liabilities": tl,
        "total_equity": te_total,
        "total_liabilities_and_equity": tl + te_total,
        "cumulative_net_income_in_equity": ni_cum,
    }


def _bs_totals_company(company_id: int, as_of: date) -> dict[str, Decimal]:
    ta = tl = te_plain = Decimal("0")
    for coa in ChartOfAccount.objects.filter(company_id=company_id).order_by("account_code"):
        bucket = _balance_sheet_bucket_for_coa(coa)
        if not bucket:
            continue
        bal = _ending_balance(coa, company_id, as_of)
        if bal == 0:
            continue
        if bucket == "asset":
            ta += bal
        elif bucket == "liability":
            tl += bal
        else:
            te_plain += bal
    ni_cum = _cumulative_net_income_through(company_id, as_of)
    te_total = te_plain + ni_cum
    return {
        "total_assets": ta,
        "total_liabilities": tl,
        "total_equity": te_total,
        "total_liabilities_and_equity": tl + te_total,
        "cumulative_net_income_in_equity": ni_cum,
    }


def _trial_balance_period_totals(
    company_id: int,
    start: date,
    end: date,
    *,
    station_id: int | None = None,
    pond_id: int | None = None,
    unscoped_dims: bool = False,
) -> tuple[Decimal, Decimal]:
    if pond_id is not None:
        qs = _je_lines_pond(company_id, pond_id)
    elif unscoped_dims:
        qs = _je_lines_unscoped_dims(company_id)
    else:
        qs = _je_lines_base(company_id, station_id)
    agg = qs.filter(
        journal_entry__entry_date__gte=start,
        journal_entry__entry_date__lte=end,
    ).aggregate(
        td=Coalesce(Sum("debit"), Decimal("0")),
        tc=Coalesce(Sum("credit"), Decimal("0")),
    )
    return agg["td"], agg["tc"]


def _entity_financial_summary_row(
    company_id: int,
    start: date,
    end: date,
    *,
    entity_type: str,
    entity_id: int | None,
    entity_name: str,
    station_id: int | None = None,
    pond_id: int | None = None,
    unscoped_dims: bool = False,
) -> dict[str, Any]:
    if pond_id is not None:
        line_qs = _je_lines_pond(company_id, pond_id)
        pl = _period_pl_totals_from_line_qs(company_id, start, end, line_qs)
        bs = _bs_totals_from_line_qs(company_id, end, line_qs)
        td, tc = _trial_balance_period_totals(
            company_id, start, end, pond_id=pond_id
        )
    elif unscoped_dims:
        line_qs = _je_lines_unscoped_dims(company_id)
        pl = _period_pl_totals_from_line_qs(company_id, start, end, line_qs)
        bs = _bs_totals_from_line_qs(company_id, end, line_qs)
        td, tc = _trial_balance_period_totals(
            company_id, start, end, unscoped_dims=True
        )
    elif station_id is not None:
        pl = _period_income_statement_totals(company_id, start, end, station_id)
        bs = _bs_totals_station(company_id, end, station_id)
        td, tc = _trial_balance_period_totals(
            company_id, start, end, station_id=station_id
        )
    else:
        pl = _period_income_statement_totals(company_id, start, end, None)
        bs = _bs_totals_company(company_id, end)
        td, tc = _trial_balance_period_totals(company_id, start, end, station_id=None)

    row: dict[str, Any] = {
        "entity_type": entity_type,
        "entity_id": entity_id,
        "entity_name": entity_name,
        "income": _f(pl["income"]),
        "cost_of_goods_sold": _f(pl["cogs"]),
        "expenses": _f(pl["expenses"]),
        "gross_profit": _f(pl["gross_profit"]),
        "net_income": _f(pl["net_income"]),
        "total_assets": _f(bs["total_assets"]),
        "total_liabilities": _f(bs["total_liabilities"]),
        "total_equity": _f(bs["total_equity"]),
        "total_liabilities_and_equity": _f(bs["total_liabilities_and_equity"]),
        "trial_balance_debit": _f(td),
        "trial_balance_credit": _f(tc),
        "trial_balance_balanced": abs(td - tc) <= Decimal("0.02"),
    }
    if station_id is not None:
        row["station_id"] = station_id
        row["station_name"] = entity_name
    if pond_id is not None:
        row["pond_id"] = pond_id
        row["pond_name"] = entity_name
        from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict

        mgmt = compute_aquaculture_pl_summary_dict(
            company_id, start, end, pond_id, None, None, False
        )
        ponds = mgmt.get("ponds") or []
        if ponds:
            p0 = ponds[0]
            row["management_revenue_bdt"] = _f(_d(p0.get("income_total") or p0.get("revenue")))
            row["management_profit_bdt"] = _f(_d(p0.get("profit")))
            row["management_total_costs_bdt"] = _f(_d(p0.get("total_costs")))
            row["management_feed_consumption_bdt"] = _f(_d(p0.get("feed_consumption_cost")))
            row["management_medicine_consumption_bdt"] = _f(_d(p0.get("medicine_consumption_cost")))
            row["management_other_consumption_bdt"] = _f(_d(p0.get("other_consumption_cost")))
            row["management_other_operating_bdt"] = _f(_d(p0.get("other_operating_expenses")))
    return row


_FINANCIAL_PL_SUM_KEYS: tuple[str, ...] = (
    "income",
    "cost_of_goods_sold",
    "expenses",
    "gross_profit",
    "net_income",
)
_FINANCIAL_BS_SUM_KEYS: tuple[str, ...] = (
    "total_assets",
    "total_liabilities",
    "total_equity",
    "total_liabilities_and_equity",
)
_FINANCIAL_TB_SUM_KEYS: tuple[str, ...] = ("trial_balance_debit", "trial_balance_credit")
_FINANCIAL_ALL_SUM_KEYS: tuple[str, ...] = (
    _FINANCIAL_PL_SUM_KEYS + _FINANCIAL_BS_SUM_KEYS + _FINANCIAL_TB_SUM_KEYS
)
_CASH_FLOW_ENTITY_SUM_KEYS: tuple[str, ...] = (
    "net_income",
    "customer_payments_received",
    "vendor_payments_made",
    "net_change_in_cash",
    "ending_cash",
)


def _split_stations_by_business_kind(
    by_station: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    from api.services.station_business_kind import KIND_SHOP_HUB

    fuel: list[dict[str, Any]] = []
    shop: list[dict[str, Any]] = []
    for row in by_station:
        if row.get("business_kind") == KIND_SHOP_HUB:
            shop.append(row)
        else:
            fuel.append(row)
    return fuel, shop


def _category_total_row(
    rows: list[dict[str, Any]],
    *,
    label: str,
    entity_type: str,
    sum_keys: tuple[str, ...],
) -> dict[str, Any]:
    acc = {k: Decimal("0") for k in sum_keys}
    for row in rows:
        for key in sum_keys:
            acc[key] += _d(row.get(key))
    out: dict[str, Any] = {
        "entity_type": entity_type,
        "entity_id": None,
        "entity_name": label,
    }
    for key in sum_keys:
        out[key] = _f(acc[key])
    if "trial_balance_debit" in sum_keys:
        td, tc = acc["trial_balance_debit"], acc["trial_balance_credit"]
        out["trial_balance_balanced"] = abs(td - tc) <= Decimal("0.02")
    return out


def _enrich_entity_bundle_splits(bundle: dict[str, Any]) -> None:
    """Add fuel vs shop-hub station slices and category subtotals (individual + total)."""
    fuel, shop = _split_stations_by_business_kind(bundle["by_station"])
    bundle["by_fuel_station"] = fuel
    bundle["by_shop_hub"] = shop
    bundle["fuel_stations_total"] = _category_total_row(
        fuel,
        label="Total — all fuel filling stations",
        entity_type="fuel_stations_total",
        sum_keys=_FINANCIAL_ALL_SUM_KEYS,
    )
    bundle["shop_hubs_total"] = _category_total_row(
        shop,
        label="Total — all shop / agro hubs (no fuel)",
        entity_type="shop_hubs_total",
        sum_keys=_FINANCIAL_ALL_SUM_KEYS,
    )
    bundle["stations_total"] = _category_total_row(
        bundle["by_station"],
        label="Total — all stations (fuel + shop)",
        entity_type="stations_total",
        sum_keys=_FINANCIAL_ALL_SUM_KEYS,
    )
    bundle["ponds_total"] = _category_total_row(
        bundle["by_pond"],
        label="Total — all ponds",
        entity_type="ponds_total",
        sum_keys=_FINANCIAL_ALL_SUM_KEYS,
    )


def _enrich_cash_flow_entity_splits(out_cf: dict[str, Any]) -> None:
    by_station = out_cf.get("by_station") or []
    if not by_station:
        return
    from api.services.station_business_kind import station_business_kind, station_business_kind_label

    for row in by_station:
        st = Station.objects.filter(pk=row.get("entity_id")).first()
        if st:
            kind = station_business_kind(st)
            row["business_kind"] = kind
            row["business_kind_label"] = station_business_kind_label(kind)
    fuel, shop = _split_stations_by_business_kind(by_station)
    out_cf["by_fuel_station"] = fuel
    out_cf["by_shop_hub"] = shop
    out_cf["fuel_stations_total"] = _category_total_row(
        fuel,
        label="Total — all fuel filling stations",
        entity_type="fuel_stations_total",
        sum_keys=_CASH_FLOW_ENTITY_SUM_KEYS,
    )
    out_cf["shop_hubs_total"] = _category_total_row(
        shop,
        label="Total — all shop / agro hubs (no fuel)",
        entity_type="shop_hubs_total",
        sum_keys=_CASH_FLOW_ENTITY_SUM_KEYS,
    )
    out_cf["stations_total"] = _category_total_row(
        by_station,
        label="Total — all stations (fuel + shop)",
        entity_type="stations_total",
        sum_keys=_CASH_FLOW_ENTITY_SUM_KEYS,
    )
    by_pond = out_cf.get("by_pond") or []
    out_cf["ponds_total"] = _category_total_row(
        by_pond,
        label="Total — all ponds",
        entity_type="ponds_total",
        sum_keys=_CASH_FLOW_ENTITY_SUM_KEYS,
    )


def _pl_company_total(co: dict[str, Any]) -> dict[str, float]:
    return {
        "income": co["income"],
        "cost_of_goods_sold": co["cost_of_goods_sold"],
        "expenses": co["expenses"],
        "gross_profit": co["gross_profit"],
        "net_income": co["net_income"],
    }


def _pl_category_total(co: dict[str, Any]) -> dict[str, float]:
    return _pl_company_total(co)


def _collect_all_entity_financial_rows(
    company_id: int, start: date, end: date
) -> dict[str, Any]:
    """Build full financial rows for every station, pond, unscoped slice, and company total."""
    from api.services.entity_financial_metrics import enrich_pond_entity_row, enrich_station_entity_row

    by_station: list[dict[str, Any]] = []
    for st in Station.objects.filter(company_id=company_id, is_active=True).order_by(
        "station_name", "id"
    ):
        row = _entity_financial_summary_row(
            company_id,
            start,
            end,
            entity_type="station",
            entity_id=st.id,
            entity_name=(st.station_name or "").strip() or f"Station #{st.id}",
            station_id=st.id,
        )
        enrich_station_entity_row(company_id, st, row, start=start, end=end)
        by_station.append(row)

    by_pond: list[dict[str, Any]] = []
    for pond in AquaculturePond.objects.filter(company_id=company_id, is_active=True).order_by(
        "sort_order", "name", "id"
    ):
        row = _entity_financial_summary_row(
            company_id,
            start,
            end,
            entity_type="pond",
            entity_id=pond.id,
            entity_name=(pond.name or "").strip() or f"Pond #{pond.id}",
            pond_id=pond.id,
        )
        enrich_pond_entity_row(company_id, pond.id, row)
        by_pond.append(row)

    unscoped = _entity_financial_summary_row(
        company_id,
        start,
        end,
        entity_type="unscoped",
        entity_id=None,
        entity_name="Head office / unassigned (no site or pond tag)",
        unscoped_dims=True,
    )
    company_total = _entity_financial_summary_row(
        company_id,
        start,
        end,
        entity_type="company",
        entity_id=None,
        entity_name="Company total (all GL)",
    )
    bundle = {
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "balance_sheet_as_of": end.isoformat(),
        "by_station": by_station,
        "by_pond": by_pond,
        "unscoped": unscoped,
        "company_total": company_total,
    }
    _enrich_entity_bundle_splits(bundle)
    return bundle


_ENTITY_SCOPE_NOTE = (
    "Fuel filling stations, shop/agro hubs (stations without fuel), and ponds are separate entities — "
    "each row is that entity's own P&L from posted GL. Fuel and shop-hub stations use site-tagged "
    "journal lines; pond rows use pond-tagged lines; head office uses lines with no site or pond tag. "
    "Category totals sum individual rows; company total is all GL. For account-level detail, open "
    "Profit & Loss with Site scope set to that station or pond."
)


def _entity_pl_row(row: dict[str, Any]) -> dict[str, Any]:
    out = {
        "entity_type": row["entity_type"],
        "entity_id": row.get("entity_id"),
        "entity_name": row["entity_name"],
        "income": row["income"],
        "cost_of_goods_sold": row["cost_of_goods_sold"],
        "expenses": row["expenses"],
        "gross_profit": row["gross_profit"],
        "net_income": row["net_income"],
    }
    if row.get("station_id") is not None:
        out["station_id"] = row["station_id"]
        out["station_name"] = row.get("station_name")
        for key in (
            "business_kind",
            "business_kind_label",
            "shop_inventory_value_bdt",
            "shop_sales_to_ponds_income",
            "shop_sales_to_ponds_cogs",
            "shop_sales_to_ponds_gross_profit",
            "shop_sales_to_ponds_net_income",
            "combined_shop_income",
            "combined_shop_cogs",
            "combined_shop_gross_profit",
            "combined_shop_net_income",
        ):
            if key in row:
                out[key] = row[key]
    if row.get("pond_id") is not None:
        out["pond_id"] = row["pond_id"]
        out["pond_name"] = row.get("pond_name")
        if "management_revenue_bdt" in row:
            out["management_revenue_bdt"] = row["management_revenue_bdt"]
        if "management_profit_bdt" in row:
            out["management_profit_bdt"] = row["management_profit_bdt"]
        for key in (
            "management_total_costs_bdt",
            "management_feed_consumption_bdt",
            "management_medicine_consumption_bdt",
            "management_other_consumption_bdt",
            "management_other_operating_bdt",
            "pond_warehouse_inventory_value_bdt",
            "pond_open_ar_bdt",
            "pond_open_ap_bdt",
        ):
            if key in row:
                out[key] = row[key]
    return out


def _entity_bs_row(row: dict[str, Any]) -> dict[str, Any]:
    out = {
        "entity_type": row["entity_type"],
        "entity_id": row.get("entity_id"),
        "entity_name": row["entity_name"],
        "total_assets": row["total_assets"],
        "total_liabilities": row["total_liabilities"],
        "total_equity": row["total_equity"],
        "total_liabilities_and_equity": row["total_liabilities_and_equity"],
    }
    if row.get("station_id") is not None:
        out["station_id"] = row["station_id"]
        out["station_name"] = row.get("station_name")
    if row.get("pond_id") is not None:
        out["pond_id"] = row["pond_id"]
        out["pond_name"] = row.get("pond_name")
    return out


def _entity_tb_row(row: dict[str, Any]) -> dict[str, Any]:
    out = {
        "entity_type": row["entity_type"],
        "entity_id": row.get("entity_id"),
        "entity_name": row["entity_name"],
        "trial_balance_debit": row["trial_balance_debit"],
        "trial_balance_credit": row["trial_balance_credit"],
        "trial_balance_balanced": row["trial_balance_balanced"],
    }
    if row.get("station_id") is not None:
        out["station_id"] = row["station_id"]
        out["station_name"] = row.get("station_name")
    if row.get("pond_id") is not None:
        out["pond_id"] = row["pond_id"]
        out["pond_name"] = row.get("pond_name")
    return out


def _entity_report_payload(
    report_id: str,
    bundle: dict[str, Any],
    row_mapper,
    *,
    accounting_note: str,
    segment_totals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    co = bundle["company_total"]
    payload: dict[str, Any] = {
        "report_id": report_id,
        "period": bundle["period"],
        "balance_sheet_as_of": bundle.get("balance_sheet_as_of"),
        "by_station": [row_mapper(r) for r in bundle["by_station"]],
        "by_fuel_station": [row_mapper(r) for r in bundle.get("by_fuel_station") or []],
        "by_shop_hub": [row_mapper(r) for r in bundle.get("by_shop_hub") or []],
        "by_pond": [row_mapper(r) for r in bundle["by_pond"]],
        "unscoped": row_mapper(bundle["unscoped"]),
        "fuel_stations_total": row_mapper(bundle["fuel_stations_total"]),
        "shop_hubs_total": row_mapper(bundle["shop_hubs_total"]),
        "stations_total": row_mapper(bundle["stations_total"]),
        "ponds_total": row_mapper(bundle["ponds_total"]),
        "company_total": row_mapper(co),
        "accounting_note": accounting_note,
    }
    if segment_totals is not None:
        payload["segment_totals"] = segment_totals
    return payload


_PL_METRIC_KEYS: tuple[str, ...] = (
    "income",
    "cost_of_goods_sold",
    "expenses",
    "gross_profit",
    "net_income",
)


def _sum_metric_rows(rows: list[dict[str, Any]], keys: tuple[str, ...]) -> dict[str, float]:
    totals = {k: Decimal("0") for k in keys}
    for r in rows:
        for k in keys:
            totals[k] += _d(r.get(k))
    return {k: _f(totals[k]) for k in keys}


def _entity_pl_segment_totals(bundle: dict[str, Any]) -> dict[str, Any]:
    """Roll up P&L by entity class: fuel stations, shop hubs (no fuel), all stations, ponds."""
    unscoped = bundle.get("unscoped")
    return {
        "fuel_stations": _pl_category_total(bundle["fuel_stations_total"]),
        "shop_hubs": _pl_category_total(bundle["shop_hubs_total"]),
        "all_stations": _pl_category_total(bundle["stations_total"]),
        "ponds": _pl_category_total(bundle["ponds_total"]),
        "unscoped": _sum_metric_rows([unscoped] if unscoped else [], _PL_METRIC_KEYS),
    }


def report_entities_pl_summary(company_id: int, start: date, end: date) -> dict[str, Any]:
    """P&L per station, pond, head office, and company total."""
    bundle = _collect_all_entity_financial_rows(company_id, start, end)
    payload = _entity_report_payload(
        "entities-pl-summary",
        bundle,
        _entity_pl_row,
        accounting_note=(
            "Posted journal P&L for the date range. Each row is one entity (fuel station, shop hub, or pond). "
            + _ENTITY_SCOPE_NOTE
            + " Category totals sum fuel stations, shop hubs (no fuel), and ponds separately. "
            "Company total is all GL. Pond management_revenue_bdt / management_profit_bdt are aquaculture register totals (BDT)."
        ),
        segment_totals=_entity_pl_segment_totals(bundle),
    )
    payload["fuel_stations"] = payload["by_fuel_station"]
    payload["shop_hubs"] = payload["by_shop_hub"]
    payload["aquaculture_management"] = _aquaculture_management_snapshot(
        company_id, start, end
    )
    return payload


def report_entities_balance_sheet_summary(
    company_id: int, start: date, end: date
) -> dict[str, Any]:
    """Balance sheet totals per station, pond, head office, and company (as of period end)."""
    bundle = _collect_all_entity_financial_rows(company_id, start, end)
    return _entity_report_payload(
        "entities-balance-sheet-summary",
        bundle,
        _entity_bs_row,
        accounting_note=(
            "Balances as of the period end date. Station/pond/unscoped slices exclude chart opening balances "
            "(posted tagged lines only). Company total includes openings and full chart. "
            + _ENTITY_SCOPE_NOTE
        ),
    )


def report_entities_trial_balance_summary(
    company_id: int, start: date, end: date
) -> dict[str, Any]:
    """Trial balance period activity per station, pond, head office, and company."""
    bundle = _collect_all_entity_financial_rows(company_id, start, end)
    return _entity_report_payload(
        "entities-trial-balance-summary",
        bundle,
        _entity_tb_row,
        accounting_note=(
            "Posted debits and credits in the date range only (not opening balances). "
            + _ENTITY_SCOPE_NOTE
        ),
    )


def report_entities_financial_summary(
    company_id: int, start: date, end: date
) -> dict[str, Any]:
    """Combined P&L + BS + TB (legacy); prefer the three separate entity reports."""
    bundle = _collect_all_entity_financial_rows(company_id, start, end)
    return {
        "report_id": "entities-financial-summary",
        "period": bundle["period"],
        "balance_sheet_as_of": bundle["balance_sheet_as_of"],
        "by_station": bundle["by_station"],
        "by_fuel_station": bundle["by_fuel_station"],
        "by_shop_hub": bundle["by_shop_hub"],
        "by_pond": bundle["by_pond"],
        "unscoped": bundle["unscoped"],
        "fuel_stations_total": bundle["fuel_stations_total"],
        "shop_hubs_total": bundle["shop_hubs_total"],
        "stations_total": bundle["stations_total"],
        "ponds_total": bundle["ponds_total"],
        "company_total": bundle["company_total"],
        "entities": bundle["by_station"] + bundle["by_pond"] + [bundle["unscoped"]],
        "accounting_note": (
            "Combined view. Fuel stations, shop hubs (no fuel), and ponds are separate entity groups "
            "with category subtotals. For separate reports use: All Entities — P&L, "
            "All Entities — Balance Sheet, and All Entities — Trial Balance."
        ),
    }


_STATION_PL_EXTRA_KEYS: tuple[str, ...] = (
    "business_kind",
    "business_kind_label",
    "shop_inventory_value_bdt",
    "shop_sales_to_ponds_income",
    "shop_sales_to_ponds_cogs",
    "shop_sales_to_ponds_gross_profit",
    "shop_sales_to_ponds_net_income",
    "combined_shop_income",
    "combined_shop_cogs",
    "combined_shop_gross_profit",
    "combined_shop_net_income",
)

_POND_PL_EXTRA_KEYS: tuple[str, ...] = (
    "management_revenue_bdt",
    "management_profit_bdt",
    "management_total_costs_bdt",
    "management_feed_consumption_bdt",
    "management_medicine_consumption_bdt",
    "management_other_consumption_bdt",
    "management_other_operating_bdt",
    "pond_warehouse_inventory_value_bdt",
    "pond_open_ar_bdt",
    "pond_open_ap_bdt",
)


def _aquaculture_management_snapshot(
    company_id: int,
    start: date,
    end: date,
    pond_id: int | None = None,
) -> dict[str, Any]:
    """Aquaculture register totals (feed/medicine consumption, vendor bills, payroll, etc.)."""
    from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict

    mgmt = compute_aquaculture_pl_summary_dict(
        company_id, start, end, pond_id, None, None, False
    )
    return {
        "totals": mgmt.get("totals") or {},
        "ponds": mgmt.get("ponds") or [],
        "expenses_by_category": mgmt.get("expenses_by_category") or [],
        "expenses_by_pond": mgmt.get("expenses_by_pond") or [],
        "income_by_pond": mgmt.get("income_by_pond") or [],
        "income_by_category": mgmt.get("income_by_category") or [],
    }


def _station_pl_summary_row(r: dict[str, Any]) -> dict[str, Any]:
    row = {
        "station_id": r["station_id"],
        "station_name": r["station_name"],
        "entity_type": r.get("entity_type", "station"),
        "entity_id": r.get("entity_id"),
        "entity_name": r.get("entity_name") or r.get("station_name"),
        "income": r["income"],
        "cost_of_goods_sold": r["cost_of_goods_sold"],
        "expenses": r["expenses"],
        "gross_profit": r["gross_profit"],
        "net_income": r["net_income"],
    }
    for key in _STATION_PL_EXTRA_KEYS:
        if key in r:
            row[key] = r[key]
    return row


def _pond_pl_summary_row(r: dict[str, Any]) -> dict[str, Any]:
    row = {
        "pond_id": r["pond_id"],
        "pond_name": r["pond_name"],
        "entity_type": r.get("entity_type", "pond"),
        "entity_id": r.get("entity_id"),
        "entity_name": r.get("entity_name") or r.get("pond_name"),
        "income": r["income"],
        "cost_of_goods_sold": r["cost_of_goods_sold"],
        "expenses": r["expenses"],
        "gross_profit": r["gross_profit"],
        "net_income": r["net_income"],
    }
    for key in _POND_PL_EXTRA_KEYS:
        if key in r:
            row[key] = r[key]
    return row


def report_stations_financial_summary(
    company_id: int, start: date, end: date
) -> dict[str, Any]:
    """Individual P&L per station (fuel site / shop) from posted GL."""
    full = report_entities_pl_summary(company_id, start, end)
    rows = [_station_pl_summary_row(r) for r in full["by_station"]]
    fuel_rows = [_station_pl_summary_row(r) for r in full.get("by_fuel_station") or []]
    shop_rows = [_station_pl_summary_row(r) for r in full.get("by_shop_hub") or []]
    seg = full.get("segment_totals") or {}
    co = full["company_total"]
    return {
        "report_id": "stations-financial-summary",
        "period": full["period"],
        "stations": rows,
        "fuel_stations": fuel_rows,
        "shop_hubs": shop_rows,
        "segment_totals": {
            "fuel_stations": seg.get("fuel_stations"),
            "shop_hubs": seg.get("shop_hubs"),
            "all_stations": seg.get("all_stations"),
        },
        "stations_total": seg.get("all_stations") or {},
        "company_total": {
            "income": co["income"],
            "cost_of_goods_sold": co["cost_of_goods_sold"],
            "expenses": co["expenses"],
            "gross_profit": co["gross_profit"],
            "net_income": co["net_income"],
        },
        "accounting_note": (
            "One row per station — each station is its own entity. Fuel filling stations and shop hubs "
            "(stations without fuel forecourt) are listed separately with segment totals. "
            "Stations total sums all station rows; company total is all GL (includes ponds and head office). "
            "Shop hubs also show combined_shop_* columns when POS sales are attributed to ponds. "
            "Use Profit & Loss with Site scope for account-level detail on one station."
        ),
    }


def report_fuel_stations_pl_summary(
    company_id: int, start: date, end: date
) -> dict[str, Any]:
    """Individual P&L per fuel filling station from posted GL."""
    full = report_entities_pl_summary(company_id, start, end)
    rows = [_station_pl_summary_row(r) for r in full["by_fuel_station"]]
    seg = full.get("segment_totals") or {}
    return {
        "report_id": "fuel-stations-pl-summary",
        "period": full["period"],
        "fuel_stations": rows,
        "stations": rows,
        "category_total": seg.get("fuel_stations") or _pl_category_total(full["fuel_stations_total"]),
        "company_total": _pl_company_total(full["company_total"]),
        "accounting_note": (
            "One row per fuel filling station (operates fuel retail). Each station is its own entity. "
            "Category total sums fuel stations only; company total is all GL."
        ),
    }


def report_shop_hubs_pl_summary(
    company_id: int, start: date, end: date
) -> dict[str, Any]:
    """Individual P&L per shop/agro hub (station without fuel) from posted GL."""
    full = report_entities_pl_summary(company_id, start, end)
    rows = [_station_pl_summary_row(r) for r in full["by_shop_hub"]]
    seg = full.get("segment_totals") or {}
    return {
        "report_id": "shop-hubs-pl-summary",
        "period": full["period"],
        "shop_hubs": rows,
        "stations": rows,
        "category_total": seg.get("shop_hubs") or _pl_category_total(full["shop_hubs_total"]),
        "company_total": _pl_company_total(full["company_total"]),
        "accounting_note": (
            "One row per shop/agro hub (station without fuel forecourt). Each hub is its own entity. "
            "combined_shop_* columns include sales/COGS attributed to ponds from that shop. "
            "Category total sums shop hubs only; company total is all GL."
        ),
    }


def report_ponds_pl_summary(company_id: int, start: date, end: date) -> dict[str, Any]:
    """Individual P&L per aquaculture pond from posted GL (pond-tagged journal lines)."""
    full = report_entities_pl_summary(company_id, start, end)
    rows = [_pond_pl_summary_row(r) for r in full["by_pond"]]
    seg = full.get("segment_totals") or {}
    co = full["company_total"]
    return {
        "report_id": "ponds-pl-summary",
        "period": full["period"],
        "ponds": rows,
        "segment_totals": {"ponds": seg.get("ponds")},
        "ponds_total": seg.get("ponds") or {},
        "company_total": {
            "income": co["income"],
            "cost_of_goods_sold": co["cost_of_goods_sold"],
            "expenses": co["expenses"],
            "gross_profit": co["gross_profit"],
            "net_income": co["net_income"],
        },
        "accounting_note": (
            "One row per pond — each pond is its own entity from posted GL lines tagged to that pond. "
            "Ponds total sums all pond rows; company total is all GL (includes stations and head office). "
            "pond_open_ar_bdt / pond_open_ap_bdt are open balances for the pond POS customer and pond-tagged "
            "vendor bills. pond_warehouse_inventory_value_bdt is feed/medicine/supplies on hand at the pond. "
            "Management revenue/profit/cost columns are aquaculture register totals in BDT (includes feed and medicine "
            "consumption, vendor bills, payroll, lease, and all other pond expenses) and may differ from GL. "
            "The consumption & expense section below matches Aquaculture — Pond P&L. "
            "Use GL P&L with Site scope = pond for account-level journal lines."
        ),
        "aquaculture_management": full.get("aquaculture_management"),
    }


def _is_fuel_line(line: InvoiceLine) -> bool:
    it = line.item
    if not it:
        return False
    u = (it.unit or "").lower()
    if u in ("l", "liter", "litre", "gal", "gallon"):
        return True
    return "fuel" in (it.pos_category or "").lower() or "fuel" in (it.category or "").lower()


def report_fuel_sales(
    company_id: int, start: date, end: date, station_id: int | None = None
) -> dict[str, Any]:
    inv_qs = Invoice.objects.filter(
        company_id=company_id,
        invoice_date__gte=start,
        invoice_date__lte=end,
    )
    if station_id is not None:
        inv_qs = inv_qs.filter(station_id=station_id)
    inv_ids = list(inv_qs.values_list("id", flat=True))
    lines = InvoiceLine.objects.filter(invoice_id__in=inv_ids).select_related(
        "item", "invoice"
    )
    total_qty = Decimal("0")
    total_amt = Decimal("0")
    n = 0
    inv_with_fuel: set[int] = set()
    for line in lines:
        if not _is_fuel_line(line):
            continue
        n += 1
        inv_with_fuel.add(line.invoice_id)
        total_qty += line.quantity or Decimal("0")
        total_amt += line.amount or Decimal("0")
    avg = (total_amt / n) if n else Decimal("0")
    fuel_invs = inv_qs.filter(pk__in=list(inv_with_fuel)).order_by("invoice_date", "id")
    fuel_docs = _documents_from_invoices(fuel_invs)
    out = {
        "report_id": "fuel-sales",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "fuel_line_count": n,
        "total_sales": n,
        "invoice_count": len(inv_with_fuel),
        "total_quantity_liters": _f(total_qty),
        "total_amount": _f(total_amt),
        "average_sale_amount": _f(avg),
        "documents": fuel_docs,
        "accounting_note": (
            "Fuel lines from invoice line items (liter/gallon unit or fuel category). "
            "Amounts are line extensions, not audited cash — use GL / payments for settlement."
        ),
    }
    _attach_row_document_drills(
        out,
        {
            "total_amount": (fuel_docs, "Fuel sales", "customers"),
            "average_sale_amount": (fuel_docs, "Fuel sales (average basis)", "customers"),
        },
    )
    if station_id is not None:
        out["filter_station_id"] = station_id
    return out


def report_tank_inventory(
    company_id: int, start: date, end: date, station_id: int | None = None
) -> dict[str, Any]:
    _ = start
    out: list[dict[str, Any]] = []
    tank_qs = Tank.objects.filter(company_id=company_id, is_active=True).select_related("station", "product")
    if station_id is not None:
        tank_qs = tank_qs.filter(station_id=station_id)
    for tank in tank_qs.order_by("tank_name"):
        cap = tank.capacity or Decimal("0")
        stock = tank.current_stock or Decimal("0")
        pct = Decimal("0")
        if cap > 0:
            pct = (stock / cap) * Decimal("100")
        reorder = tank.reorder_level or Decimal("0")
        out.append(
            {
                "tank_name": tank.tank_name,
                "station_name": tank.station.station_name if tank.station_id else "",
                "product_name": tank.product.name if tank.product_id else "",
                "capacity": _f(cap),
                "current_stock": _f(stock),
                "fill_percentage": _f(pct),
                "needs_refill": bool(reorder and stock <= reorder),
            }
        )
    low = [x for x in out if x["needs_refill"]]
    tot_cap = sum((_d(x["capacity"]) for x in out), start=Decimal("0"))
    tot_stock = sum((_d(x["current_stock"]) for x in out), start=Decimal("0"))
    tinv: dict[str, Any] = {
        "report_id": "tank-inventory",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "inventory": out,
        "summary": {
            "tank_count": len(out),
            "total_capacity_liters": _f(tot_cap),
            "total_current_stock_liters": _f(tot_stock),
        },
        "alerts": {"low_stock_tanks": low[:20]},
    }
    if station_id is not None:
        tinv["filter_station_id"] = station_id
    return tinv


def report_shift_summary(company_id: int, start: date, end: date, station_id: int | None = None) -> dict[str, Any]:
    # Include shifts opened in the period and shifts that have invoices in the period (overnight shifts).
    inv_for_shifts = Invoice.objects.filter(
        company_id=company_id,
        invoice_date__gte=start,
        invoice_date__lte=end,
        shift_session_id__isnull=False,
    )
    if station_id is not None:
        inv_for_shifts = inv_for_shifts.filter(station_id=station_id)
    shift_ids_with_sales = inv_for_shifts.values_list("shift_session_id", flat=True).distinct()
    qs = ShiftSession.objects.filter(company_id=company_id).filter(
        Q(opened_at__date__gte=start, opened_at__date__lte=end)
        | Q(pk__in=shift_ids_with_sales)
    ).select_related("station")
    if station_id is not None:
        qs = qs.filter(station_id=station_id)
    sessions: list[dict[str, Any]] = []
    total_var = Decimal("0")
    by_cashier: dict[str, dict[str, Any]] = {}
    for s in qs.order_by("-opened_at"):
        period_invs = Invoice.objects.filter(
            shift_session_id=s.id,
            company_id=company_id,
            invoice_date__gte=start,
            invoice_date__lte=end,
        )
        inv_ids = list(period_invs.values_list("id", flat=True))
        period_sales_sum = period_invs.aggregate(s=Sum("total"))["s"] or Decimal("0")
        period_tx_count = period_invs.count()
        liters = Decimal("0")
        for line in InvoiceLine.objects.filter(invoice_id__in=inv_ids).select_related("item"):
            if _is_fuel_line(line):
                liters += line.quantity or Decimal("0")
        expected_cash = (s.opening_cash_float or Decimal("0")) + (
            s.expected_cash_total or Decimal("0")
        )
        counted = s.closing_cash_counted or Decimal("0")
        var = s.cash_variance or Decimal("0")
        if s.closed_at:
            total_var += var
        uid = str(s.opened_by_user_id or "-")
        if uid not in by_cashier:
            by_cashier[uid] = {
                "sessions": 0,
                "total_sales": Decimal("0"),
                "total_liters": Decimal("0"),
                "cash_variance": Decimal("0"),
            }
        by_cashier[uid]["sessions"] += 1
        by_cashier[uid]["total_sales"] += period_sales_sum
        by_cashier[uid]["total_liters"] += liters
        by_cashier[uid]["cash_variance"] += var if s.closed_at else Decimal("0")

        period_invs_list = list(period_invs.order_by("invoice_date", "id"))
        session_docs = _documents_from_invoices(period_invs_list)

        session_row: dict[str, Any] = {
            "id": s.id,
            "cashier_name": f"User #{s.opened_by_user_id or '-'}",
            "station_name": s.station.station_name if s.station_id else "",
            "opened_at": s.opened_at.isoformat() if s.opened_at else None,
            "closed_at": s.closed_at.isoformat() if s.closed_at else None,
            "transaction_count": period_tx_count,
            "total_sales": _f(period_sales_sum),
            "total_liters": _f(liters),
            "cash_expected": _f(expected_cash),
            "cash_counted": _f(counted) if s.closing_cash_counted is not None else 0.0,
            "variance": _f(var),
            "status": "closed" if s.closed_at else "open",
            "documents": session_docs,
        }
        if session_docs:
            _attach_row_document_drills(
                session_row,
                {
                    "total_sales": (session_docs, f"Shift #{s.id} sales", "customers"),
                },
            )
        meter_rec = _shift_meter_reconciliation(s, inv_ids)
        if meter_rec:
            session_row["meter_reconciliation"] = meter_rec
        sessions.append(session_row)
    sum_tx = sum(int(x["transaction_count"] or 0) for x in sessions)
    sum_sales = sum((_d(x["total_sales"]) for x in sessions), start=Decimal("0"))
    sum_liters = sum((_d(x["total_liters"]) for x in sessions), start=Decimal("0"))
    sum_exp = sum((_d(x["cash_expected"]) for x in sessions), start=Decimal("0"))
    sum_cnt = sum((_d(x["cash_counted"]) for x in sessions), start=Decimal("0"))
    sum_var = sum((_d(x["variance"]) for x in sessions), start=Decimal("0"))
    bc_out = {
        k: {
            "sessions": v["sessions"],
            "total_sales": _f(v["total_sales"]),
            "total_liters": _f(v["total_liters"]),
            "cash_variance": _f(v["cash_variance"]),
        }
        for k, v in by_cashier.items()
    }
    sh_out: dict[str, Any] = {
        "report_id": "shift-summary",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "summary": {
            "total_sessions": len(sessions),
            "total_cash_variance": _f(total_var),
            "total_transactions": sum_tx,
            "total_sales": _f(sum_sales),
            "total_liters": _f(sum_liters),
            "total_cash_expected": _f(sum_exp),
            "total_cash_counted": _f(sum_cnt),
            "total_variance": _f(sum_var),
        },
        "sessions": sessions,
        "by_cashier": bc_out,
    }
    _attach_summary_document_drills(
        sh_out["summary"],
        {
            "total_sales": (sessions, "Shift sales", "customers"),
        },
    )
    if station_id is not None:
        sh_out["filter_station_id"] = station_id
    return sh_out


def _shift_meter_reconciliation(session: ShiftSession, inv_ids: list[int]) -> list[dict[str, Any]] | None:
    opening_map: dict[int, Decimal] = {}
    for row in session.opening_meters or []:
        if not isinstance(row, dict) or row.get("meter_id") is None:
            continue
        opening_map[int(row["meter_id"])] = _d(row.get("reading"))

    closing_map: dict[int, Decimal] = {}
    for row in session.closing_meters or []:
        if not isinstance(row, dict) or row.get("meter_id") is None:
            continue
        closing_map[int(row["meter_id"])] = _d(row.get("reading"))

    if not opening_map and not closing_map:
        return None

    liters_by_meter: dict[int, Decimal] = defaultdict(Decimal)
    for line in (
        InvoiceLine.objects.filter(invoice_id__in=inv_ids, nozzle_id__isnull=False)
        .select_related("nozzle")
        .only("quantity", "nozzle_id", "nozzle__meter_id")
    ):
        mid = line.nozzle.meter_id if line.nozzle_id and line.nozzle else None
        if mid:
            liters_by_meter[int(mid)] += line.quantity or Decimal("0")

    meter_names: dict[int, str] = {}
    for row in (session.opening_meters or []) + (session.closing_meters or []):
        if isinstance(row, dict) and row.get("meter_id"):
            meter_names[int(row["meter_id"])] = str(row.get("meter_name") or f"Meter #{row['meter_id']}")

    out: list[dict[str, Any]] = []
    for mid in sorted(set(opening_map) | set(closing_map) | set(liters_by_meter)):
        opening = opening_map.get(mid, Decimal("0"))
        closing = closing_map.get(mid, Decimal("0"))
        sold = liters_by_meter.get(mid, Decimal("0"))
        meter_delta = closing - opening if mid in closing_map and mid in opening_map else Decimal("0")
        variance = meter_delta - sold if mid in closing_map and mid in opening_map else Decimal("0")
        out.append(
            {
                "meter_id": mid,
                "meter_name": meter_names.get(mid, f"Meter #{mid}"),
                "opening_reading": _f(opening),
                "closing_reading": _f(closing) if mid in closing_map else None,
                "invoice_liters": _f(sold),
                "meter_delta": _f(meter_delta) if mid in closing_map and mid in opening_map else None,
                "variance_liters": _f(variance) if mid in closing_map and mid in opening_map else None,
            }
        )
    return out


def report_sales_by_nozzle(company_id: int, start: date, end: date, station_id: int | None = None) -> dict[str, Any]:
    inv_line_qs = InvoiceLine.objects.filter(
        invoice__company_id=company_id,
        invoice__invoice_date__gte=start,
        invoice__invoice_date__lte=end,
    )
    if station_id is not None:
        inv_line_qs = inv_line_qs.filter(invoice__station_id=station_id)

    # Prefer nozzle-level attribution when POS persisted nozzle_id on the line.
    by_nozzle: dict[int, dict[str, Any]] = {}
    for row in (
        inv_line_qs.filter(nozzle_id__isnull=False)
        .values("nozzle_id")
        .annotate(
            tx=Count("id"),
            liters=Coalesce(Sum("quantity"), Decimal("0")),
            amt=Coalesce(Sum("amount"), Decimal("0")),
        )
    ):
        by_nozzle[int(row["nozzle_id"])] = row

    # Legacy rows without nozzle_id: allocate by product across nozzles selling that grade.
    legacy_lines = inv_line_qs.filter(nozzle_id__isnull=True).values("item_id").annotate(
        tx=Count("id"),
        liters=Coalesce(Sum("quantity"), Decimal("0")),
        amt=Coalesce(Sum("amount"), Decimal("0")),
    )
    by_product = {row["item_id"]: row for row in legacy_lines if row["item_id"]}

    nz_qs = Nozzle.objects.filter(company_id=company_id, is_active=True).select_related(
        "product", "meter__dispenser__island__station"
    )
    if station_id is not None:
        nz_qs = nz_qs.filter(meter__dispenser__island__station_id=station_id)
    nozzles = nz_qs.order_by("id")
    out: list[dict[str, Any]] = []
    tot_tx = tot_l = tot_a = Decimal("0")
    nozzle_doc_cache: dict[int, list[dict[str, Any]]] = {}

    def _nozzle_invoice_documents(nozzle_id: int) -> list[dict[str, Any]]:
        if nozzle_id in nozzle_doc_cache:
            return nozzle_doc_cache[nozzle_id]
        line_qs = inv_line_qs.filter(nozzle_id=nozzle_id).select_related("invoice").order_by(
            "invoice__invoice_date", "invoice_id"
        )
        seen: dict[int, Invoice] = {}
        for line in line_qs:
            inv = line.invoice
            if inv and inv.id not in seen:
                seen[inv.id] = inv
        docs = _documents_from_invoices(seen.values())
        nozzle_doc_cache[nozzle_id] = docs
        return docs

    for nz in nozzles:
        row = by_nozzle.get(nz.id)
        if row:
            tx = int(row.get("tx") or 0)
            liters = _d(row.get("liters"))
            amt = _d(row.get("amt"))
        else:
            pid = nz.product_id
            prow = by_product.get(pid, {})
            tx = int(prow.get("tx") or 0)
            liters = _d(prow.get("liters"))
            amt = _d(prow.get("amt"))
        tot_tx += tx
        tot_l += liters
        tot_a += amt
        st_name = ""
        if nz.meter_id and nz.meter.dispenser_id:
            isl = nz.meter.dispenser.island
            if isl and isl.station:
                st_name = isl.station.station_name
        avg = (amt / tx) if tx else Decimal("0")
        nz_docs = _nozzle_invoice_documents(nz.id) if tx and nz.id in by_nozzle else []
        nz_row: dict[str, Any] = {
            "nozzle_id": nz.id,
            "nozzle_number": nz.nozzle_code or str(nz.id),
            "nozzle_name": nz.nozzle_name or nz.nozzle_code or str(nz.id),
            "product_name": nz.product.name if nz.product_id else "",
            "station_name": st_name,
            "total_transactions": tx,
            "total_liters": _f(liters),
            "total_amount": _f(amt),
            "average_sale_amount": _f(avg),
            "attribution": "nozzle" if nz.id in by_nozzle else ("product_legacy" if tx else "none"),
            "documents": nz_docs,
        }
        if nz_docs:
            _attach_row_document_drills(
                nz_row,
                {
                    "total_amount": (nz_docs, f"Nozzle {nz_row['nozzle_name']} sales", "customers"),
                    "average_sale_amount": (nz_docs, f"Nozzle {nz_row['nozzle_name']} average basis", "customers"),
                },
            )
        out.append(nz_row)
    snz: dict[str, Any] = {
        "report_id": "sales-by-nozzle",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "summary": {
            "total_nozzles": len(out),
            "total_transactions": int(tot_tx),
            "total_liters": _f(tot_l),
            "total_amount": _f(tot_a),
            "average_sale_amount": _f(tot_a / tot_tx) if tot_tx else 0.0,
        },
        "nozzles": out,
    }
    _attach_summary_document_drills(
        snz["summary"],
        {
            "total_amount": (out, "Nozzle sales", "customers"),
            "average_sale_amount": (out, "Nozzle sales (average basis)", "customers"),
        },
    )
    if station_id is not None:
        snz["filter_station_id"] = station_id
    return snz


def report_tank_dip_variance(
    company_id: int, start: date, end: date, station_id: int | None = None
) -> dict[str, Any]:
    """
    Gain/loss style report. Payload keys match frontend /reports (reading_date, system_quantity, etc.).
    Book at dip = book_stock_when saved; else fallback to current tank book (legacy rows).
    """
    dip_qs = TankDip.objects.filter(
        company_id=company_id,
        dip_date__gte=start,
        dip_date__lte=end,
    ).select_related("tank", "tank__product", "tank__station")
    if station_id is not None:
        dip_qs = dip_qs.filter(tank__station_id=station_id)
    dips = dip_qs.order_by("-dip_date", "-id")
    rows: list[dict[str, Any]] = []
    total_gain_l = total_loss_l = Decimal("0")
    total_gain_v = total_loss_v = Decimal("0")
    net_q = net_v = Decimal("0")
    by_tank: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "product": "",
            "total_gain_qty": Decimal("0"),
            "total_loss_qty": Decimal("0"),
            "total_gain_value": Decimal("0"),
            "total_loss_value": Decimal("0"),
            "net_variance_qty": Decimal("0"),
            "net_variance_value": Decimal("0"),
        }
    )

    for d in dips:
        tank = d.tank
        phy = _d(d.volume)
        if d.book_stock_before is not None:
            book = _d(d.book_stock_before)
        else:
            book = _d(tank.current_stock)
        var = phy - book
        prod = tank.product if tank.product_id else None
        rate = item_inventory_unit_cost(prod)
        var_val = var * rate
        if prod is not None and (prod.cost or Decimal("0")) > 0:
            v_basis = "cost"
        elif prod is not None and (prod.unit_price or Decimal("0")) > 0:
            v_basis = "sale_price"
        else:
            v_basis = "none"

        if var > 0:
            vtype = "GAIN"
            total_gain_l += var
            total_gain_v += var_val
        elif var < 0:
            vtype = "LOSS"
            total_loss_l += -var
            total_loss_v += abs(var_val)
        else:
            vtype = "EVEN"

        net_q += var
        net_v += var_val

        tname = tank.tank_name or f"Tank #{tank.id}"
        pname = prod.name if prod else ""
        agg = by_tank[tname]
        agg["product"] = pname or agg["product"]
        if var > 0:
            agg["total_gain_qty"] += var
            agg["total_gain_value"] += var_val
        elif var < 0:
            agg["total_loss_qty"] += -var
            agg["total_loss_value"] += abs(var_val)
        agg["net_variance_qty"] += var
        agg["net_variance_value"] += var_val

        rows.append(
            {
                "id": d.id,
                "reading_date": d.dip_date.isoformat(),
                "dip_date": d.dip_date.isoformat(),
                "tank_name": tname,
                "station_name": tank.station.station_name if tank.station_id else "",
                "product_name": pname,
                "system_quantity": _f(book),
                "measured_quantity": _f(phy),
                "variance_quantity": _f(var),
                "variance_value": _f(var_val),
                "valuation_rate_per_liter": _f(rate),
                "valuation_basis": v_basis,
                "variance_type": vtype,
                "recorded_by": "",
                "book_volume": _f(book),
                "dip_volume": _f(phy),
                "variance": _f(var),
            }
        )

    by_tank_out = {
        name: {
            "product": v["product"],
            "total_gain_qty": _f(v["total_gain_qty"]),
            "total_loss_qty": _f(v["total_loss_qty"]),
            "total_gain_value": _f(v["total_gain_value"]),
            "total_loss_value": _f(v["total_loss_value"]),
            "net_variance_qty": _f(v["net_variance_qty"]),
            "net_variance_value": _f(v["net_variance_value"]),
        }
        for name, v in sorted(by_tank.items(), key=lambda x: x[0].lower())
    }

    tdv: dict[str, Any] = {
        "report_id": "tank-dip-variance",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "summary": {
            "total_dips": len(rows),
            "total_readings": len(rows),
            "total_gain_quantity_liters": _f(total_gain_l),
            "total_loss_quantity_liters": _f(total_loss_l),
            "total_gain_value": _f(total_gain_v),
            "total_loss_value": _f(total_loss_v),
            "net_variance_quantity": _f(net_q),
            "net_variance_value": _f(net_v),
            "total_variance": _f(net_q),
            "variance_percentage": 0.0,
        },
        "by_tank": by_tank_out,
        "dips": rows,
        "accounting_note": (
            "Value columns use inventory unit cost (Item.cost) when set, else Item.unit_price. "
            "Selling those liters still flows through normal POS revenue; dip gain lowers future COGS at sale. "
            "GL: saving a dip can post AUTO-TANKDIP-{id}-VAR — gain Dr 1200 / Cr 5100; loss Dr 5200 / Cr 1200 (when COA exists)."
        ),
    }
    if station_id is not None:
        tdv["filter_station_id"] = station_id
    return tdv


def report_tank_dip_register(company_id: int, start: date, end: date, station_id: int | None = None) -> dict[str, Any]:
    """
    Chronological tank dip register: book-at-dip vs stick reading, variance, optional value estimate.
    Complements tank-dip-variance (which compares stick to current book for analytics).
    """
    dipr_qs = TankDip.objects.filter(
        company_id=company_id,
        dip_date__gte=start,
        dip_date__lte=end,
    ).select_related("tank", "tank__product", "tank__station")
    if station_id is not None:
        dipr_qs = dipr_qs.filter(tank__station_id=station_id)
    dips = dipr_qs.order_by("dip_date", "id")
    entries: list[dict[str, Any]] = []
    net_var = Decimal("0")
    gain_ev = loss_ev = 0
    tank_ids: set[int] = set()
    by_tank: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"readings": 0, "net_variance_liters": Decimal("0")}
    )

    for d in dips:
        tank = d.tank
        tank_ids.add(tank.id)
        book_raw = d.book_stock_before
        book = _d(book_raw) if book_raw is not None else None
        measured = _d(d.volume)
        var: Optional[Decimal] = (measured - book) if book is not None else None
        if var is not None:
            net_var += var
            if var > 0:
                gain_ev += 1
            elif var < 0:
                loss_ev += 1
        cap = _d(tank.capacity)
        pct_cap: Optional[float] = None
        if var is not None and cap > 0:
            pct_cap = float((var / cap * Decimal("100")).quantize(Decimal("0.01")))
        prod = tank.product if tank.product_id else None
        rate = item_inventory_unit_cost(prod)
        var_val: Optional[float] = None
        if var is not None:
            var_val = _f(var * rate)

        tkey = tank.tank_name or f"Tank #{tank.id}"
        by_tank[tkey]["readings"] += 1
        if var is not None:
            by_tank[tkey]["net_variance_liters"] += var

        wl = d.water_level
        entries.append(
            {
                "id": d.id,
                "dip_date": d.dip_date.isoformat(),
                "tank_id": tank.id,
                "tank_name": tank.tank_name,
                "station_name": tank.station.station_name if tank.station_id else "",
                "product_name": tank.product.name if tank.product_id else "",
                "capacity_liters": _f(cap),
                "book_before_liters": _f(book) if book is not None else None,
                "measured_liters": _f(measured),
                "variance_liters": _f(var) if var is not None else None,
                "variance_pct_of_capacity": pct_cap,
                "variance_value_estimate": var_val,
                "water_level_liters": _f(_d(wl)) if wl is not None else None,
                "notes": (d.notes or "")[:500],
            }
        )

    by_tank_list = [
        {
            "tank_name": name,
            "readings": v["readings"],
            "net_variance_liters": _f(v["net_variance_liters"]),
        }
        for name, v in sorted(by_tank.items(), key=lambda x: x[0].lower())
    ]

    tdr: dict[str, Any] = {
        "report_id": "tank-dip-register",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "summary": {
            "readings_count": len(entries),
            "tanks_with_readings": len(tank_ids),
            "net_variance_liters": _f(net_var),
            "gain_events": gain_ev,
            "loss_events": loss_ev,
        },
        "by_tank": by_tank_list,
        "entries": entries,
    }
    if station_id is not None:
        tdr["filter_station_id"] = station_id
    return tdr


def report_meter_readings(company_id: int, start: date, end: date, station_id: int | None = None) -> dict[str, Any]:
    inv_line_m = InvoiceLine.objects.filter(
        invoice__company_id=company_id,
        invoice__invoice_date__gte=start,
        invoice__invoice_date__lte=end,
    )
    if station_id is not None:
        inv_line_m = inv_line_m.filter(invoice__station_id=station_id)

    by_meter_nozzle: dict[int, dict[str, Decimal]] = {}
    for row in (
        inv_line_m.filter(nozzle_id__isnull=False)
        .values("nozzle__meter_id")
        .annotate(
            tx=Count("id"),
            liters=Coalesce(Sum("quantity"), Decimal("0")),
            amt=Coalesce(Sum("amount"), Decimal("0")),
        )
    ):
        mid = row.get("nozzle__meter_id")
        if mid:
            by_meter_nozzle[int(mid)] = {
                "tx": Decimal(str(row.get("tx") or 0)),
                "liters": _d(row.get("liters")),
                "amt": _d(row.get("amt")),
            }

    inv_lines = inv_line_m.filter(nozzle_id__isnull=True).select_related("item").values("item_id").annotate(
        tx=Count("id"),
        liters=Coalesce(Sum("quantity"), Decimal("0")),
        amt=Coalesce(Sum("amount"), Decimal("0")),
    )
    by_product = {row["item_id"]: row for row in inv_lines if row["item_id"]}

    mtr_qs = Meter.objects.filter(company_id=company_id).select_related("dispenser__island__station")
    if station_id is not None:
        mtr_qs = mtr_qs.filter(dispenser__island__station_id=station_id)
    meters = mtr_qs.prefetch_related("nozzles", "nozzles__product").order_by("meter_number", "id")
    meters_out: list[dict[str, Any]] = []
    tot_sales = tot_liters = tot_amt = Decimal("0")
    uses_nozzle_attribution = bool(by_meter_nozzle)
    for m in meters:
        nm = by_meter_nozzle.get(m.id)
        if nm:
            tx = int(nm["tx"])
            liters = nm["liters"]
            amt = nm["amt"]
        else:
            product_ids = list({n.product_id for n in m.nozzles.all() if n.product_id})
            tx = liters = amt = Decimal("0")
            for pid in product_ids:
                r = by_product.get(pid)
                if not r:
                    continue
                tx += int(r.get("tx") or 0)
                liters += _d(r.get("liters"))
                amt += _d(r.get("amt"))
        cur = m.current_reading or Decimal("0")
        opening = cur - liters
        if opening < 0:
            opening = Decimal("0")
        tot_sales += tx
        tot_liters += liters
        tot_amt += amt
        st_name = ""
        if m.dispenser_id and m.dispenser.island and m.dispenser.island.station:
            st_name = m.dispenser.island.station.station_name
        meters_out.append(
            {
                "meter_number": m.meter_number or m.meter_code or str(m.id),
                "meter_name": m.meter_name or m.meter_number or str(m.id),
                "opening_reading": _f(opening),
                "closing_reading": _f(cur),
                "period_dispensed": _f(liters),
                "total_sales": int(tx),
                "total_liters": _f(liters),
                "total_amount": _f(amt),
                "is_active": m.is_active,
                "opening_reading_date": start.isoformat(),
                "closing_reading_date": end.isoformat(),
                "station_name": st_name,
                "attribution": "nozzle" if nm else "product_legacy",
            }
        )
    avg_sale = (tot_amt / tot_sales) if tot_sales else Decimal("0")
    note = (
        "Sales liters are attributed by nozzle on invoice lines when available; otherwise by product linked to each meter."
        if uses_nozzle_attribution
        else (
            "Opening reading is derived as current meter reading minus period sales liters (approximation). "
            "Amounts come from invoice lines by product linked to each meter."
        )
    )
    mtr_out: dict[str, Any] = {
        "report_id": "meter-readings",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "summary": {
            "total_meters": len(meters_out),
            "total_sales": int(tot_sales),
            "total_liters_dispensed": _f(tot_liters),
            "total_amount": _f(tot_amt),
            "average_sale": _f(avg_sale),
        },
        "meters": meters_out,
        "accounting_note": note,
    }
    if station_id is not None:
        mtr_out["filter_station_id"] = station_id
    return mtr_out


def _pos_category_label(raw: str) -> str:
    s = (raw or "general").strip().lower().replace("_", " ")
    labels = {
        "feed": "Feed",
        "medicine": "Medicine & treatments",
        "fish": "Fish & fry",
        "supplies": "Supplies",
        "equipment": "Equipment",
        "general": "General retail",
        "fuel": "Fuel",
        "non_pos": "Non-POS",
    }
    return labels.get(s, s.title() or "General")


def _daily_summary_shift_dip_tank_blocks(
    company_id: int,
    start: date,
    end: date,
    station_ids: list[int],
) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    """Forecourt ops: shifts, tank dips, tank levels (fuel sites only)."""
    s_inv = Invoice.objects.filter(
        company_id=company_id,
        invoice_date__gte=start,
        invoice_date__lte=end,
        shift_session_id__isnull=False,
        station_id__in=station_ids,
    )
    shift_ids_with_sales = s_inv.values_list("shift_session_id", flat=True).distinct()
    shift_sessions_qs = (
        ShiftSession.objects.filter(company_id=company_id, station_id__in=station_ids)
        .filter(
            Q(opened_at__date__gte=start, opened_at__date__lte=end)
            | Q(pk__in=shift_ids_with_sales)
        )
        .distinct()
    )
    cash_var_agg = shift_sessions_qs.filter(closed_at__isnull=False).aggregate(
        sv=Coalesce(Sum("cash_variance"), Decimal("0"))
    )
    shifts_block = {
        "total_shifts": shift_sessions_qs.count(),
        "total_cash_variance": _f(cash_var_agg["sv"] or Decimal("0")),
    }

    dip_qs = TankDip.objects.filter(
        company_id=company_id,
        dip_date__gte=start,
        dip_date__lte=end,
        tank__station_id__in=station_ids,
    )
    dip_count = dip_qs.count()
    net_dip_liters = Decimal("0")
    for d in dip_qs.iterator():
        if d.book_stock_before is not None:
            net_dip_liters += _d(d.volume) - _d(d.book_stock_before)
    dips_block = {
        "total_readings": dip_count,
        "net_variance_liters": _f(net_dip_liters),
        "net_variance": _f(net_dip_liters),
    }

    tank_rows: list[dict[str, Any]] = []
    for t in Tank.objects.filter(
        company_id=company_id, is_active=True, station_id__in=station_ids
    ).select_related("product", "station"):
        cap = t.capacity or Decimal("0")
        stock = t.current_stock or Decimal("0")
        pct = (stock / cap * Decimal("100")) if cap > 0 else Decimal("0")
        tank_rows.append(
            {
                "tank_name": t.tank_name,
                "station_name": t.station.station_name if t.station_id else "",
                "product": t.product.name if t.product_id else "",
                "capacity": _f(cap),
                "current_stock": _f(stock),
                "fill_percentage": _f(pct),
            }
        )
    return shifts_block, dips_block, tank_rows


def _compute_daily_summary_block(
    company_id: int,
    start: date,
    end: date,
    station_ids: list[int],
    *,
    site_kind: str,
    line_label: str,
    station_names: list[str],
) -> dict[str, Any]:
    """Sales + ops snapshot for one business line (fuel forecourt or aquaculture shop hub)."""
    if not station_ids:
        return {
            "line": site_kind,
            "label": line_label,
            "station_names": station_names,
            "sales": {
                "total_transactions": 0,
                "total_liters": _f(Decimal("0")),
                "total_amount": _f(Decimal("0")),
                "fuel_amount": _f(Decimal("0")),
                "shop_amount": _f(Decimal("0")),
                "cash_sales_total": _f(Decimal("0")),
                "credit_sales_total": _f(Decimal("0")),
                "cash_transaction_count": 0,
                "credit_transaction_count": 0,
                "average_sale": _f(Decimal("0")),
            },
            "by_product_fuel": {},
            "by_pos_category": {},
            "shifts": {"total_shifts": 0, "total_cash_variance": _f(Decimal("0"))},
            "dips": {"total_readings": 0, "net_variance_liters": _f(Decimal("0")), "net_variance": _f(Decimal("0"))},
            "tanks": [],
            "aquaculture": {"pond_pos_invoice_count": 0, "pond_pos_sales_total": _f(Decimal("0"))},
        }

    invs = (
        Invoice.objects.filter(
            company_id=company_id,
            invoice_date__gte=start,
            invoice_date__lte=end,
            station_id__in=station_ids,
        )
        .exclude(status="draft")
        .select_related("customer")
    )
    n_inv = invs.count()
    inv_ids = list(invs.values_list("id", flat=True))
    lines = InvoiceLine.objects.filter(invoice_id__in=inv_ids).select_related("item")

    total_amt = Decimal("0")
    fuel_liters = Decimal("0")
    fuel_amt = Decimal("0")
    shop_amt = Decimal("0")
    cash_amt = credit_amt = Decimal("0")
    cash_tx = credit_tx = 0
    pond_pos_amt = Decimal("0")
    pond_pos_tx = 0
    pond_pos_ids = pond_pos_customer_ids(company_id)

    by_product_fuel: dict[str, dict[str, Any]] = {}
    by_pos_category: dict[str, dict[str, Any]] = {}
    fuel_inv_ids: set[int] = set()
    shop_inv_ids: set[int] = set()
    cash_inv_ids: set[int] = set()
    credit_inv_ids: set[int] = set()
    pond_pos_inv_ids: set[int] = set()

    for inv in invs:
        amt = inv.total or Decimal("0")
        if is_on_account_payment(inv.payment_method):
            credit_amt += amt
            credit_tx += 1
            credit_inv_ids.add(inv.id)
        else:
            cash_amt += amt
            cash_tx += 1
            cash_inv_ids.add(inv.id)
        if inv.customer_id and int(inv.customer_id) in pond_pos_ids:
            pond_pos_amt += amt
            pond_pos_tx += 1
            pond_pos_inv_ids.add(inv.id)

    for line in lines:
        amt = line.amount or Decimal("0")
        total_amt += amt
        inv_id = line.invoice_id
        if _is_fuel_line(line):
            fuel_amt += amt
            if inv_id:
                fuel_inv_ids.add(inv_id)
            q = line.quantity or Decimal("0")
            fuel_liters += q
            key = (line.item.name if line.item_id else "Fuel").strip() or "Fuel"
            if key not in by_product_fuel:
                by_product_fuel[key] = {
                    "liters": Decimal("0"),
                    "amount": Decimal("0"),
                    "line_count": 0,
                }
            by_product_fuel[key]["line_count"] += 1
            by_product_fuel[key]["amount"] += amt
            by_product_fuel[key]["liters"] += q
        else:
            shop_amt += amt
            if inv_id:
                shop_inv_ids.add(inv_id)
            raw_cat = (line.item.pos_category if line.item_id else "general") or "general"
            cat_key = _pos_category_label(raw_cat)
            if cat_key not in by_pos_category:
                by_pos_category[cat_key] = {
                    "amount": Decimal("0"),
                    "quantity": Decimal("0"),
                    "line_count": 0,
                }
            by_pos_category[cat_key]["line_count"] += 1
            by_pos_category[cat_key]["amount"] += amt
            by_pos_category[cat_key]["quantity"] += line.quantity or Decimal("0")

    avg = (total_amt / n_inv) if n_inv else Decimal("0")

    inv_by_id = {inv.id: inv for inv in invs}
    all_docs = _documents_from_invoices(invs)
    sales_block: dict[str, Any] = {
        "total_transactions": n_inv,
        "total_liters": _f(fuel_liters),
        "total_amount": _f(total_amt),
        "fuel_amount": _f(fuel_amt),
        "shop_amount": _f(shop_amt),
        "cash_sales_total": _f(cash_amt),
        "credit_sales_total": _f(credit_amt),
        "cash_transaction_count": cash_tx,
        "credit_transaction_count": credit_tx,
        "average_sale": _f(avg),
        "documents": all_docs,
    }
    _attach_row_document_drills(
        sales_block,
        {
            "total_amount": (all_docs, f"{line_label} — total sales", "customers"),
            "average_sale": (all_docs, f"{line_label} — average sale basis", "customers"),
            "fuel_amount": (
                _documents_from_invoices([inv_by_id[i] for i in fuel_inv_ids if i in inv_by_id]),
                f"{line_label} — fuel sales",
                "customers",
            ),
            "shop_amount": (
                _documents_from_invoices([inv_by_id[i] for i in shop_inv_ids if i in inv_by_id]),
                f"{line_label} — shop sales",
                "customers",
            ),
            "cash_sales_total": (
                _documents_from_invoices([inv_by_id[i] for i in cash_inv_ids if i in inv_by_id]),
                f"{line_label} — cash sales",
                "customers",
            ),
            "credit_sales_total": (
                _documents_from_invoices([inv_by_id[i] for i in credit_inv_ids if i in inv_by_id]),
                f"{line_label} — credit sales",
                "customers",
            ),
        },
    )

    pond_pos_docs = _documents_from_invoices([inv_by_id[i] for i in pond_pos_inv_ids if i in inv_by_id])
    aq_block: dict[str, Any] = {
        "pond_pos_invoice_count": pond_pos_tx,
        "pond_pos_sales_total": _f(pond_pos_amt),
        "documents": pond_pos_docs,
    }
    if pond_pos_docs:
        _attach_row_document_drills(
            aq_block,
            {
                "pond_pos_sales_total": (pond_pos_docs, f"{line_label} — pond POS", "customers"),
            },
        )

    bp_fuel_out = {
        k: {
            "liters": _f(v["liters"]),
            "amount": _f(v["amount"]),
            "line_count": v["line_count"],
        }
        for k, v in sorted(by_product_fuel.items(), key=lambda x: x[0].lower())
    }
    bp_cat_out = {
        k: {
            "amount": _f(v["amount"]),
            "quantity": _f(v["quantity"]),
            "line_count": v["line_count"],
        }
        for k, v in sorted(by_pos_category.items(), key=lambda x: (-x[1]["amount"], x[0].lower()))
    }

    block: dict[str, Any] = {
        "line": site_kind,
        "label": line_label,
        "station_names": station_names,
        "sales": sales_block,
        "by_product_fuel": bp_fuel_out,
        "by_pos_category": bp_cat_out,
        "aquaculture": aq_block,
    }

    if site_kind == "fuel":
        shifts, dips, tanks = _daily_summary_shift_dip_tank_blocks(
            company_id, start, end, station_ids
        )
        block["shifts"] = shifts
        block["dips"] = dips
        block["tanks"] = tanks
    else:
        block["shifts"] = {"total_shifts": 0, "total_cash_variance": _f(Decimal("0"))}
        block["dips"] = {
            "total_readings": 0,
            "net_variance_liters": _f(Decimal("0")),
            "net_variance": _f(Decimal("0")),
        }
        block["tanks"] = []

    return block


def _merge_daily_summary_sales(blocks: list[dict[str, Any]]) -> dict[str, Any]:
    """Company-wide sales totals from one or more line blocks."""
    tx = sum(int(b["sales"].get("total_transactions") or 0) for b in blocks)
    total_amt = sum(Decimal(str(b["sales"].get("total_amount") or 0)) for b in blocks)
    fuel_liters = sum(Decimal(str(b["sales"].get("total_liters") or 0)) for b in blocks)
    avg = (total_amt / tx) if tx else Decimal("0")
    by_product: dict[str, dict[str, Any]] = {}
    for b in blocks:
        for name, m in (b.get("by_product_fuel") or {}).items():
            if name not in by_product:
                by_product[name] = {"liters": Decimal("0"), "amount": Decimal("0"), "line_count": 0}
            by_product[name]["liters"] += Decimal(str(m.get("liters") or 0))
            by_product[name]["amount"] += Decimal(str(m.get("amount") or 0))
            by_product[name]["line_count"] += int(m.get("line_count") or 0)
        for name, m in (b.get("by_pos_category") or {}).items():
            if name not in by_product:
                by_product[name] = {"liters": Decimal("0"), "amount": Decimal("0"), "line_count": 0}
            by_product[name]["amount"] += Decimal(str(m.get("amount") or 0))
            by_product[name]["line_count"] += int(m.get("line_count") or 0)
            by_product[name]["liters"] += Decimal(str(m.get("quantity") or 0))
    bp_out = {
        k: {
            "liters": _f(v["liters"]),
            "amount": _f(v["amount"]),
            "line_count": v["line_count"],
        }
        for k, v in by_product.items()
    }
    return {
        "total_transactions": tx,
        "total_liters": _f(fuel_liters),
        "total_amount": _f(total_amt),
        "average_sale": _f(avg),
        "by_product": bp_out,
    }


def report_daily_summary(
    company_id: int,
    start: date,
    end: date,
    station_id: int | None = None,
    *,
    business_segment: str = "all",
) -> dict[str, Any]:
    """
    Operations snapshot by business line: fuel forecourt (Main Station) vs aquaculture shop hub (Premium Agro).
    Fuel sites include shifts, dips, and tanks; shop hubs emphasize POS category sales and pond on-account POS.
    """
    station_ids, scope_meta = _resolve_report_station_scope(
        company_id, station_id=station_id, business_segment=business_segment
    )
    segment = scope_meta.get("business_segment") or "all"
    station_names = scope_meta.get("business_segment_station_names") or []

    business_lines: list[dict[str, Any]] = []

    if segment == "all" and station_id is None:
        fuel_ids, fuel_meta = _resolve_report_station_scope(
            company_id, station_id=None, business_segment="fuel"
        )
        agro_ids, agro_meta = _resolve_report_station_scope(
            company_id, station_id=None, business_segment="aquaculture"
        )
        if fuel_ids:
            business_lines.append(
                _compute_daily_summary_block(
                    company_id,
                    start,
                    end,
                    fuel_ids,
                    site_kind="fuel",
                    line_label=str(fuel_meta.get("business_segment_label") or "Fuel Station"),
                    station_names=list(fuel_meta.get("business_segment_station_names") or []),
                )
            )
        if agro_ids:
            business_lines.append(
                _compute_daily_summary_block(
                    company_id,
                    start,
                    end,
                    agro_ids,
                    site_kind="shop",
                    line_label=str(agro_meta.get("business_segment_label") or "Aquaculture (Premium Agro)"),
                    station_names=list(agro_meta.get("business_segment_station_names") or []),
                )
            )
    elif station_ids is not None and not station_ids:
        business_lines = []
    else:
        ids = station_ids if station_ids is not None else []
        if station_id is not None and not ids:
            ids = [station_id]
        if not ids and station_id is None:
            ids = list(
                Station.objects.filter(company_id=company_id, is_active=True).values_list("id", flat=True)
            )
        fuel_count = Station.objects.filter(
            pk__in=ids, company_id=company_id, operates_fuel_retail=True
        ).count()
        shop_count = Station.objects.filter(
            pk__in=ids, company_id=company_id, operates_fuel_retail=False
        ).count()
        if fuel_count and not shop_count:
            kind = "fuel"
        elif shop_count and not fuel_count:
            kind = "shop"
        elif segment == "aquaculture":
            kind = "shop"
        elif segment == "fuel":
            kind = "fuel"
        else:
            kind = "shop" if scope_meta.get("filter_station_is_shop_hub") else "fuel"
        label = str(scope_meta.get("business_segment_label") or ("Aquaculture (Premium Agro)" if kind == "shop" else "Fuel Station"))
        business_lines.append(
            _compute_daily_summary_block(
                company_id,
                start,
                end,
                ids,
                site_kind=kind,
                line_label=label,
                station_names=station_names,
            )
        )

    primary = business_lines[0] if len(business_lines) == 1 else None
    merged_sales = _merge_daily_summary_sales(business_lines) if business_lines else {
        "total_transactions": 0,
        "total_liters": _f(Decimal("0")),
        "total_amount": _f(Decimal("0")),
        "average_sale": _f(Decimal("0")),
        "by_product": {},
    }

    shifts_agg = {"total_shifts": 0, "total_cash_variance": _f(Decimal("0"))}
    dips_agg = {"total_readings": 0, "net_variance_liters": _f(Decimal("0")), "net_variance": _f(Decimal("0"))}
    tanks_agg: list[dict[str, Any]] = []
    for bl in business_lines:
        if bl.get("line") == "fuel":
            sh = bl.get("shifts") or {}
            shifts_agg["total_shifts"] += int(sh.get("total_shifts") or 0)
            shifts_agg["total_cash_variance"] = _f(
                Decimal(str(shifts_agg["total_cash_variance"])) + Decimal(str(sh.get("total_cash_variance") or 0))
            )
            dp = bl.get("dips") or {}
            dips_agg["total_readings"] += int(dp.get("total_readings") or 0)
            dips_agg["net_variance_liters"] = _f(
                Decimal(str(dips_agg["net_variance_liters"]))
                + Decimal(str(dp.get("net_variance_liters") or 0))
            )
            dips_agg["net_variance"] = dips_agg["net_variance_liters"]
            tanks_agg.extend(bl.get("tanks") or [])

    shop_note = ""
    if segment == "aquaculture" or (primary and primary.get("line") == "shop"):
        shop_note = (
            " Aquaculture shop hub: sales by POS category (feed, medicine, fish, supplies). "
            "Pond on-account POS appears under credit sales. No fuel tanks or dips at this site."
        )
    elif segment == "fuel" or (primary and primary.get("line") == "fuel"):
        shop_note = (
            " Fuel forecourt: liters on fuel-classified lines, shift cash variance, tank dips, and tank levels."
        )
    elif segment == "all":
        shop_note = (
            " Combined view: fuel forecourt ops (Main Station) and aquaculture shop sales (Premium Agro) "
            "are broken out under Business lines below."
        )

    dsum: dict[str, Any] = {
        "report_id": "daily-summary",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "sales": merged_sales,
        "shifts": shifts_agg if business_lines else (primary or {}).get("shifts", shifts_agg),
        "dips": dips_agg if len(business_lines) != 1 else (primary or {}).get("dips", dips_agg),
        "tanks": tanks_agg if business_lines else (primary or {}).get("tanks", []),
        "business_lines": business_lines,
        "accounting_note": (
            "Daily summary splits fuel forecourt (Main Station) from aquaculture shop hub (Premium Agro). "
            "Use the business line filter to focus one side. Sales exclude draft invoices."
            + shop_note
        ),
    }
    dsum.update(scope_meta)
    return dsum


def report_sales_by_station(company_id: int, start: date, end: date, station_id: int | None = None) -> dict[str, Any]:
    """
    Invoice totals grouped by selling station (Invoice.station). Excludes draft invoices.
    Rows with no station_id are rolled into "unspecified" for legacy data.
    """
    inv_qs = (
        Invoice.objects.filter(
            company_id=company_id,
            invoice_date__gte=start,
            invoice_date__lte=end,
        )
        .exclude(status="draft")
        .select_related("station")
    )
    if station_id is not None:
        inv_qs = inv_qs.filter(station_id=station_id)
    by_key: dict[tuple[int | None, str], dict[str, Any]] = {}
    for inv in inv_qs:
        sid = inv.station_id
        st = inv.station
        if sid is None:
            name = "— (unspecified)"
        else:
            name = (st.station_name or f"Station {sid}").strip() if st else f"Station {sid}"
        k = (sid, name)
        if k not in by_key:
            by_key[k] = {
                "station_id": sid,
                "station_name": name,
                "invoice_count": 0,
                "total": Decimal("0"),
                "documents": [],
            }
        by_key[k]["invoice_count"] += 1
        amt = inv.total or Decimal("0")
        by_key[k]["total"] += amt
        by_key[k]["documents"].append(
            {
                "document_type": "invoice",
                "invoice_id": inv.id,
                "document_number": inv.invoice_number,
                "document_date": inv.invoice_date.isoformat(),
                "amount": _f(amt),
                "status": inv.status,
            }
        )
    rows = sorted(by_key.values(), key=lambda r: (r["station_name"], r["station_id"] or 0))
    for r in rows:
        r["total"] = _f(r["total"])
    grand = sum(Decimal(str(x["total"])) for x in rows)
    sbs: dict[str, Any] = {
        "report_id": "sales-by-station",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "summary": {
            "stations_with_sales": len([x for x in rows if x["station_id"] is not None]),
            "total_invoices": sum(x["invoice_count"] for x in rows),
            "grand_total": _f(grand),
        },
        "rows": rows,
    }
    _attach_summary_document_drills(
        sbs["summary"],
        {"grand_total": (rows, "Sales by station", "customers")},
    )
    if station_id is not None:
        sbs["filter_station_id"] = station_id
    return sbs


def _sales_by_product_bucket_row(item: Item) -> dict[str, Any]:
    return {
        "item_id": item.id,
        "_item": item,
        "sku": (item.item_number or "").strip() or f"#{item.id}",
        "name": (item.name or "")[:200],
        "reporting_category": (item.category or "").strip() or "General",
        "unit": (item.unit or "")[:24],
        "line_count": 0,
        "_qty": Decimal("0"),
        "_revenue": Decimal("0"),
    }


def _accumulate_sales_by_product_line(
    bucket: dict[int, dict[str, Any]],
    line: InvoiceLine,
) -> None:
    item = line.item
    if not item or not line.item_id:
        return
    iid = int(line.item_id)
    if iid not in bucket:
        bucket[iid] = _sales_by_product_bucket_row(item)
    row = bucket[iid]
    row["line_count"] += 1
    row["_qty"] += line.quantity or Decimal("0")
    row["_revenue"] += line.amount or Decimal("0")


def _finalize_sales_by_product_rows(rows_map: dict[int, dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for iid in sorted(rows_map.keys(), key=lambda x: (rows_map[x]["name"].lower(), x)):
        row = rows_map[iid]
        item = row.pop("_item")
        qty = _d(row.pop("_qty"))
        revenue = _d(row.pop("_revenue"))
        uc = item_inventory_unit_cost(item)
        total_cost = qty * uc
        profit = revenue - total_cost
        avg_price = (revenue / qty) if qty else Decimal("0")
        row.update(
            {
                "quantity": _f(qty),
                "unit_cost": _f(uc),
                "avg_unit_price": _f(avg_price),
                "revenue": _f(revenue),
                "total_cost": _f(total_cost),
                "profit": _f(profit),
            }
        )
        out.append(row)
    return out


def _sales_by_product_section_summary(rows_map: dict[int, dict[str, Any]]) -> dict[str, Any]:
    line_count = 0
    qty = revenue = cost = profit = Decimal("0")
    for row in rows_map.values():
        line_count += int(row.get("line_count") or 0)
        q = _d(row.get("_qty"))
        r = _d(row.get("_revenue"))
        uc = item_inventory_unit_cost(row.get("_item"))
        c = q * uc
        qty += q
        revenue += r
        cost += c
        profit += r - c
    return {
        "line_count": line_count,
        "quantity": _f(qty),
        "revenue": _f(revenue),
        "total_cost": _f(cost),
        "profit": _f(profit),
    }


def report_sales_by_products(
    company_id: int, start: date, end: date, station_id: int | None = None
) -> dict[str, Any]:
    """
    Invoice line totals grouped by catalog product, split cash vs credit (on-account).
    Includes quantity, average selling price, unit cost, revenue, COGS, and gross profit.
    Excludes draft invoices and lines without a linked item.
    """
    line_qs = (
        InvoiceLine.objects.filter(
            invoice__company_id=company_id,
            invoice__invoice_date__gte=start,
            invoice__invoice_date__lte=end,
            item_id__isnull=False,
        )
        .exclude(invoice__status="draft")
        .select_related("invoice", "item")
    )
    if station_id is not None:
        line_qs = line_qs.filter(invoice__station_id=station_id)

    cash_by_item: dict[int, dict[str, Any]] = {}
    credit_by_item: dict[int, dict[str, Any]] = {}
    for line in line_qs:
        is_credit = is_on_account_payment(line.invoice.payment_method)
        bucket = credit_by_item if is_credit else cash_by_item
        _accumulate_sales_by_product_line(bucket, line)

    cash_sum = _sales_by_product_section_summary(cash_by_item)
    credit_sum = _sales_by_product_section_summary(credit_by_item)
    cash_products = _finalize_sales_by_product_rows(cash_by_item)
    credit_products = _finalize_sales_by_product_rows(credit_by_item)

    grand_qty = _d(cash_sum["quantity"]) + _d(credit_sum["quantity"])
    grand_rev = _d(cash_sum["revenue"]) + _d(credit_sum["revenue"])
    grand_cost = _d(cash_sum["total_cost"]) + _d(credit_sum["total_cost"])
    grand_profit = _d(cash_sum["profit"]) + _d(credit_sum["profit"])

    payload: dict[str, Any] = {
        "report_id": "sales-by-products",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "summary": {
            "cash_line_count": cash_sum["line_count"],
            "cash_quantity": cash_sum["quantity"],
            "cash_revenue": cash_sum["revenue"],
            "cash_total_cost": cash_sum["total_cost"],
            "cash_profit": cash_sum["profit"],
            "credit_line_count": credit_sum["line_count"],
            "credit_quantity": credit_sum["quantity"],
            "credit_revenue": credit_sum["revenue"],
            "credit_total_cost": credit_sum["total_cost"],
            "credit_profit": credit_sum["profit"],
            "total_line_count": cash_sum["line_count"] + credit_sum["line_count"],
            "grand_quantity": _f(grand_qty),
            "grand_revenue": _f(grand_rev),
            "grand_total_cost": _f(grand_cost),
            "grand_profit": _f(grand_profit),
        },
        "cash_products": cash_products,
        "credit_products": credit_products,
        "accounting_note": (
            "Cash products: invoice lines on immediate-tender sales (cash, card, transfer, etc.). "
            "Credit products: on-account / A/R invoice lines. "
            "Revenue and quantity come from invoice lines in the period (non-draft). "
            "Unit cost uses the item inventory cost; profit is revenue minus cost × quantity sold."
        ),
    }
    if station_id is not None:
        payload["filter_station_id"] = station_id
    return payload


def _report_filter_station_meta(company_id: int, station_id: int | None) -> dict[str, Any]:
    if station_id is None:
        return {}
    st = Station.objects.filter(pk=station_id, company_id=company_id).only(
        "station_name", "operates_fuel_retail"
    ).first()
    if not st:
        return {"filter_station_id": station_id}
    meta: dict[str, Any] = {
        "filter_station_id": station_id,
        "filter_station_name": (st.station_name or f"Station {station_id}").strip(),
        "filter_station_is_shop_hub": not bool(st.operates_fuel_retail),
    }
    return meta


def _resolve_report_station_scope(
    company_id: int,
    *,
    station_id: int | None,
    business_segment: str,
) -> tuple[list[int] | None, dict[str, Any]]:
    """
    Resolve station filter for Sales / Purchase reports.
    Returns (station_ids, meta). station_ids None = all sites; [] = no matching sites.
    Explicit station_id (home station or single-site pick) wins over business_segment.
    """
    segment = (business_segment or "all").strip().lower()
    meta: dict[str, Any] = {"business_segment": "all"}

    if station_id is not None:
        meta["business_segment"] = "single"
        meta.update(_report_filter_station_meta(company_id, station_id))
        name = meta.get("filter_station_name") or f"Station {station_id}"
        meta["business_segment_label"] = name
        meta["business_segment_station_names"] = [name]
        meta["business_segment_station_ids"] = [station_id]
        return [station_id], meta

    if segment in ("", "all"):
        return None, meta

    meta["business_segment"] = segment
    qs = Station.objects.filter(company_id=company_id, is_active=True).order_by("station_name", "id")

    if segment == "fuel":
        scoped = qs.filter(operates_fuel_retail=True)
        ids = list(scoped.values_list("id", flat=True))
        names = [(n or "").strip() for n in scoped.values_list("station_name", flat=True)]
        meta["business_segment_label"] = "Fuel Station"
        meta["business_segment_station_ids"] = ids
        meta["business_segment_station_names"] = names
        return ids, meta

    if segment == "aquaculture":
        scoped = qs.filter(operates_fuel_retail=False)
        ids = list(scoped.values_list("id", flat=True))
        names = [(n or "").strip() for n in scoped.values_list("station_name", flat=True)]
        if not ids:
            premium = qs.filter(station_name__iexact="Premium Agro")
            ids = list(premium.values_list("id", flat=True))
            names = [(n or "").strip() for n in premium.values_list("station_name", flat=True)]
        has_premium = any(n.lower() == "premium agro" for n in names)
        meta["business_segment_label"] = (
            "Aquaculture (Premium Agro)" if has_premium else "Aquaculture (Shop hub)"
        )
        meta["business_segment_station_ids"] = ids
        meta["business_segment_station_names"] = names
        meta["filter_station_is_shop_hub"] = bool(ids)
        if len(ids) == 1:
            meta.update(_report_filter_station_meta(company_id, ids[0]))
        return ids, meta

    return None, meta


def _empty_sales_report_payload(
    _company_id: int,
    start: date,
    end: date,
    scope_meta: dict[str, Any],
) -> dict[str, Any]:
    note = "No active sites match the selected business line filter."
    payload: dict[str, Any] = {
        "report_id": "sales-report",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "summary": {
            "cash_invoice_count": 0,
            "cash_sales_total": _f(Decimal("0")),
            "credit_invoice_count": 0,
            "credit_sales_total": _f(Decimal("0")),
            "total_invoices": 0,
            "grand_total": _f(Decimal("0")),
            "pond_pos_customer_count": 0,
        },
        "cash_customers": [],
        "credit_customers": [],
        "accounting_note": note,
    }
    payload.update(scope_meta)
    return payload


def _empty_purchase_report_payload(
    start: date,
    end: date,
    scope_meta: dict[str, Any],
) -> dict[str, Any]:
    note = "No active sites match the selected business line filter."
    payload: dict[str, Any] = {
        "report_id": "purchase-report",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "summary": {
            "cash_bill_count": 0,
            "cash_purchase_total": _f(Decimal("0")),
            "credit_bill_count": 0,
            "credit_purchase_total": _f(Decimal("0")),
            "total_bills": 0,
            "grand_total": _f(Decimal("0")),
        },
        "cash_vendors": [],
        "credit_vendors": [],
        "accounting_note": note,
    }
    payload.update(scope_meta)
    return payload


def _apply_invoice_station_scope(qs, station_ids: list[int] | None, station_id: int | None):
    if station_id is not None:
        return qs.filter(station_id=station_id)
    if station_ids is not None:
        if not station_ids:
            return qs.none()
        return qs.filter(station_id__in=station_ids)
    return qs


def _apply_bill_station_scope(qs, station_ids: list[int] | None, station_id: int | None):
    if station_id is not None:
        return qs.filter(
            Q(receipt_station_id=station_id) | Q(lines__receipt_station_id=station_id)
        ).distinct()
    if station_ids is not None:
        if not station_ids:
            return qs.none()
        return qs.filter(
            Q(receipt_station_id__in=station_ids) | Q(lines__receipt_station_id__in=station_ids)
        ).distinct()
    return qs


def _sales_report_customer_row(
    customer_id: int | None,
    customer: Customer | None,
    *,
    pond_pos_customer_ids: frozenset[int],
) -> dict[str, Any]:
    if customer_id is None:
        return {
            "customer_id": None,
            "customer_number": "",
            "display_name": "— (no customer)",
            "is_pond_pos_customer": False,
            "invoice_count": 0,
            "total": Decimal("0"),
        }
    name = (customer.display_name or f"Customer {customer_id}").strip() if customer else f"Customer {customer_id}"
    num = (customer.customer_number or "").strip() if customer else ""
    return {
        "customer_id": customer_id,
        "customer_number": num,
        "display_name": name,
        "is_pond_pos_customer": int(customer_id) in pond_pos_customer_ids,
        "invoice_count": 0,
        "total": Decimal("0"),
    }


def report_sales_report(
    company_id: int,
    start: date,
    end: date,
    station_id: int | None = None,
    *,
    business_segment: str = "all",
) -> dict[str, Any]:
    """
    Invoice totals grouped by customer, split into cash (immediate tender) vs credit (on account / A/R).
    Excludes draft invoices. Optional business_segment: all | fuel | aquaculture.
    """
    station_ids, scope_meta = _resolve_report_station_scope(
        company_id, station_id=station_id, business_segment=business_segment
    )
    if station_ids is not None and not station_ids:
        return _empty_sales_report_payload(company_id, start, end, scope_meta)

    inv_qs = (
        Invoice.objects.filter(
            company_id=company_id,
            invoice_date__gte=start,
            invoice_date__lte=end,
        )
        .exclude(status="draft")
        .select_related("customer")
    )
    inv_qs = _apply_invoice_station_scope(inv_qs, station_ids, station_id)

    pond_pos_ids = frozenset(pond_pos_customer_ids(company_id))

    cash_by_cust: dict[int | None, dict[str, Any]] = {}
    credit_by_cust: dict[int | None, dict[str, Any]] = {}

    cash_inv_count = 0
    credit_inv_count = 0
    cash_total = Decimal("0")
    credit_total = Decimal("0")

    for inv in inv_qs:
        cid_c = inv.customer_id
        is_credit = is_on_account_payment(inv.payment_method)
        bucket = credit_by_cust if is_credit else cash_by_cust
        if cid_c not in bucket:
            bucket[cid_c] = _sales_report_customer_row(
                cid_c, inv.customer, pond_pos_customer_ids=pond_pos_ids
            )
        bucket[cid_c]["invoice_count"] += 1
        amt = inv.total or Decimal("0")
        bucket[cid_c]["total"] += amt
        bucket[cid_c].setdefault("documents", []).append(
            {
                "document_type": "invoice",
                "invoice_id": inv.id,
                "document_number": inv.invoice_number,
                "document_date": inv.invoice_date.isoformat(),
                "amount": _f(amt),
                "status": inv.status,
            }
        )
        if is_credit:
            credit_inv_count += 1
            credit_total += amt
        else:
            cash_inv_count += 1
            cash_total += amt

    def _finalize(rows_map: dict[int | None, dict[str, Any]]) -> list[dict[str, Any]]:
        rows = sorted(rows_map.values(), key=lambda r: (r["display_name"], r["customer_id"] or 0))
        for r in rows:
            r["total"] = _f(r["total"])
        return rows

    cash_customers = _finalize(cash_by_cust)
    credit_customers = _finalize(credit_by_cust)
    grand_total = cash_total + credit_total

    shop_note = ""
    if scope_meta.get("filter_station_is_shop_hub") or scope_meta.get("business_segment") == "aquaculture":
        shop_note = (
            " Shop hub (non-fuel site, e.g. Premium Agro): walk-in and counter sales are cash; "
            "aquaculture pond POS customers are on account and appear under Credit customers."
        )
    elif scope_meta.get("business_segment") == "fuel":
        shop_note = " Fuel forecourt POS and on-account fuel customer sales at fuel retail sites."

    payload: dict[str, Any] = {
        "report_id": "sales-report",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "summary": {
            "cash_invoice_count": cash_inv_count,
            "cash_sales_total": _f(cash_total),
            "credit_invoice_count": credit_inv_count,
            "credit_sales_total": _f(credit_total),
            "total_invoices": cash_inv_count + credit_inv_count,
            "grand_total": _f(grand_total),
            "pond_pos_customer_count": len(
                [r for r in credit_customers if r.get("is_pond_pos_customer")]
            ),
        },
        "cash_customers": cash_customers,
        "credit_customers": credit_customers,
        "accounting_note": (
            "Cash customers: invoices with immediate tender (cash, card, transfer, etc.). "
            "Credit customers: on-account / A/R sales (payment_method on_account), including "
            "aquaculture pond POS accounts at the shop station."
            + shop_note
            + " Totals are invoice amounts in the date range (non-draft). "
            "Use the business line filter for Fuel Station vs Aquaculture (Premium Agro)."
        ),
    }
    _attach_summary_document_drills(
        payload["summary"],
        {
            "grand_total": ([cash_customers, credit_customers], "All sales", "customers"),
            "cash_sales_total": ([cash_customers], "Cash sales", "customers"),
            "credit_sales_total": ([credit_customers], "Credit sales", "customers"),
        },
    )
    payload.update(scope_meta)
    return payload


def _bill_paid_through(company_id: int, bill_id: int, through: date) -> Decimal:
    """Vendor payments allocated to this bill with payment_date on or before ``through``."""
    s = (
        PaymentBillAllocation.objects.filter(
            bill_id=bill_id,
            payment__company_id=company_id,
            payment__payment_date__lte=through,
        ).aggregate(total=Sum("amount"))["total"]
    )
    return s or Decimal("0")


def _purchase_report_vendor_row(vendor_id: int | None, vendor: Vendor | None) -> dict[str, Any]:
    if vendor_id is None:
        return {
            "vendor_id": None,
            "vendor_number": "",
            "display_name": "— (no vendor)",
            "bill_count": 0,
            "total": Decimal("0"),
        }
    if vendor:
        name = (vendor.display_name or vendor.company_name or f"Vendor {vendor_id}").strip()
        num = (vendor.vendor_number or "").strip()
    else:
        name = f"Vendor {vendor_id}"
        num = ""
    return {
        "vendor_id": vendor_id,
        "vendor_number": num,
        "display_name": name,
        "bill_count": 0,
        "total": Decimal("0"),
    }


def report_purchase_report(
    company_id: int,
    start: date,
    end: date,
    station_id: int | None = None,
    *,
    business_segment: str = "all",
) -> dict[str, Any]:
    """
    Bill totals grouped by vendor, split into cash (paid through period end) vs credit (A/P balance).
    Excludes draft and void bills. Optional business_segment: all | fuel | aquaculture.
    """
    station_ids, scope_meta = _resolve_report_station_scope(
        company_id, station_id=station_id, business_segment=business_segment
    )
    if station_ids is not None and not station_ids:
        return _empty_purchase_report_payload(start, end, scope_meta)

    bill_qs = (
        Bill.objects.filter(
            company_id=company_id,
            bill_date__gte=start,
            bill_date__lte=end,
            status__in=_BILL_LINE_POSTED_STATUSES,
        )
        .select_related("vendor")
    )
    bill_qs = _apply_bill_station_scope(bill_qs, station_ids, station_id)

    cash_by_vendor: dict[int | None, dict[str, Any]] = {}
    credit_by_vendor: dict[int | None, dict[str, Any]] = {}

    cash_bill_count = 0
    credit_bill_count = 0
    cash_total = Decimal("0")
    credit_total = Decimal("0")

    for bill in bill_qs:
        vid = bill.vendor_id
        total = bill.total or Decimal("0")
        if total <= 0:
            continue
        paid = _bill_paid_through(company_id, bill.id, end)
        cash_amt = min(total, paid)
        credit_amt = max(Decimal("0"), total - cash_amt)

        if cash_amt > 0:
            if vid not in cash_by_vendor:
                cash_by_vendor[vid] = _purchase_report_vendor_row(vid, bill.vendor)
            cash_by_vendor[vid]["bill_count"] += 1
            cash_by_vendor[vid]["total"] += cash_amt
            cash_by_vendor[vid].setdefault("documents", []).append(
                {
                    "document_type": "bill",
                    "bill_id": bill.id,
                    "document_number": bill.bill_number,
                    "document_date": bill.bill_date.isoformat(),
                    "amount": _f(cash_amt),
                    "status": bill.status,
                }
            )
            cash_bill_count += 1
            cash_total += cash_amt

        if credit_amt > 0:
            if vid not in credit_by_vendor:
                credit_by_vendor[vid] = _purchase_report_vendor_row(vid, bill.vendor)
            credit_by_vendor[vid]["bill_count"] += 1
            credit_by_vendor[vid]["total"] += credit_amt
            credit_by_vendor[vid].setdefault("documents", []).append(
                {
                    "document_type": "bill",
                    "bill_id": bill.id,
                    "document_number": bill.bill_number,
                    "document_date": bill.bill_date.isoformat(),
                    "amount": _f(credit_amt),
                    "status": bill.status,
                }
            )
            credit_bill_count += 1
            credit_total += credit_amt

    def _finalize_vendors(rows_map: dict[int | None, dict[str, Any]]) -> list[dict[str, Any]]:
        rows = sorted(rows_map.values(), key=lambda r: (r["display_name"], r["vendor_id"] or 0))
        for r in rows:
            r["total"] = _f(r["total"])
        return rows

    cash_vendors = _finalize_vendors(cash_by_vendor)
    credit_vendors = _finalize_vendors(credit_by_vendor)
    grand_total = cash_total + credit_total

    shop_note = ""
    if scope_meta.get("filter_station_is_shop_hub") or scope_meta.get("business_segment") == "aquaculture":
        shop_note = (
            " Shop hub (non-fuel site, e.g. Premium Agro): feed, medicine, and supplies received "
            "into this station's stock; pond on-account issues are sales, not purchases here."
        )
    elif scope_meta.get("business_segment") == "fuel":
        shop_note = " Fuel-site vendor bills (shop stock, forecourt supplies) received at fuel stations."

    payload: dict[str, Any] = {
        "report_id": "purchase-report",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "summary": {
            "cash_bill_count": cash_bill_count,
            "cash_purchase_total": _f(cash_total),
            "credit_bill_count": credit_bill_count,
            "credit_purchase_total": _f(credit_total),
            "total_bills": cash_bill_count + credit_bill_count,
            "grand_total": _f(grand_total),
        },
        "cash_vendors": cash_vendors,
        "credit_vendors": credit_vendors,
        "accounting_note": (
            "Cash vendors: bill amounts paid through vendor payments on or before the period end date. "
            "Credit vendors: remaining A/P on bills in the date range (unpaid or partially unpaid as of period end). "
            "Partially paid bills may appear in both sections. Draft and void bills are excluded."
            + shop_note
            + " Use the business line filter for Fuel Station vs Aquaculture (Premium Agro). "
            "Bills match when the bill header or any line receipt station is in scope."
        ),
    }
    _attach_summary_document_drills(
        payload["summary"],
        {
            "grand_total": ([cash_vendors, credit_vendors], "All purchases", "vendors"),
            "cash_purchase_total": ([cash_vendors], "Cash purchases", "vendors"),
            "credit_purchase_total": ([credit_vendors], "Credit purchases", "vendors"),
        },
    )
    payload.update(scope_meta)
    return payload


def report_inventory_sku_valuation(
    company_id: int,
    start: date,
    end: date,
    station_id: int | None = None,
    category: str | None = None,
    item_ids: list[int] | None = None,
) -> dict[str, Any]:
    """
    Per-SKU: on-hand, cost & list extension, period sales, velocity, days of cover.
    Uses Item.cost (fallback per gl_posting) and invoice lines in [start, end] for the selected company.
    When ``station_id`` is set, on-hand and period sales are for that site (invoice.station / shop bins / tanks).
    """
    period_days = (end - start).days + 1
    if period_days < 1:
        period_days = 1
    period_days_dec = Decimal(str(period_days))

    inv_q = Invoice.objects.filter(
        company_id=company_id,
        invoice_date__gte=start,
        invoice_date__lte=end,
    )
    if station_id is not None:
        inv_q = inv_q.filter(station_id=station_id)
    inv_ids = inv_q.values_list("id", flat=True)
    inv_id_set = set(inv_ids)
    line_agg: dict[int, dict[str, Decimal]] = {}
    inv_line_q = InvoiceLine.objects.filter(
        invoice_id__in=inv_id_set, item_id__isnull=False
    )
    if category:
        inv_line_q = inv_line_q.filter(item__category=category)
    if item_ids:
        inv_line_q = inv_line_q.filter(item_id__in=item_ids)
    for row in (
        inv_line_q.values("item_id").annotate(
            q=Coalesce(Sum("quantity"), Decimal("0")),
            a=Coalesce(Sum("amount"), Decimal("0")),
        )
    ):
        iid = row.get("item_id")
        if iid:
            line_agg[int(iid)] = {
                "q": _d(row.get("q")),
                "a": _d(row.get("a")),
            }

    rows_out: list[dict[str, Any]] = []
    tot_cost = Decimal("0")
    tot_list = Decimal("0")
    tot_qoh = Decimal("0")
    tot_period_qty = Decimal("0")
    tot_period_rev = Decimal("0")

    scope_items = _item_scope_queryset(company_id, category, item_ids)

    for item in scope_items:
        if not item_tracks_physical_stock(item):
            continue
        if station_id is not None:
            qoh = _item_qoh_at_station(company_id, item, station_id)
        else:
            qoh = _d(getattr(item, "quantity_on_hand", None) or 0)
        if qoh < 0:
            qoh = Decimal("0")
        uc = item_inventory_unit_cost(item)
        list_p = _d(getattr(item, "unit_price", None) or 0)
        ext_cost = qoh * uc
        ext_list = qoh * list_p
        agg = line_agg.get(int(item.id)) or {"q": Decimal("0"), "a": Decimal("0")}
        pq = agg["q"]
        pa = agg["a"]
        daily_avg = pq / period_days_dec
        doc: Optional[float] = None
        if daily_avg and daily_avg > 0 and qoh > 0:
            doc = float(qoh / daily_avg)
        stock_status = "no_period_sales"
        if pq > 0 and qoh <= 0:
            stock_status = "sold_out"
        elif qoh > 0 and (daily_avg is None or daily_avg <= 0):
            stock_status = "static_stock"
        elif doc is not None and doc < 7:
            stock_status = "under_7d_cover"
        elif doc is not None and doc > 60:
            stock_status = "over_60d_cover"
        elif pq > 0 and doc is not None and 7 <= doc <= 60:
            stock_status = "healthy"

        tot_cost += ext_cost
        tot_list += ext_list
        tot_qoh += qoh
        tot_period_qty += pq
        tot_period_rev += pa
        margin_pct: Optional[float] = None
        cogs_est = pq * uc
        if pa > 0:
            margin_pct = float((pa - cogs_est) / pa * Decimal("100"))
        elif pa == 0 and pq == 0:
            margin_pct = None

        rows_out.append(
            {
                "item_id": item.id,
                "sku": (item.item_number or "").strip() or f"#{item.id}",
                "name": (item.name or "")[:200],
                "reporting_category": (getattr(item, "category", None) or "").strip() or "General",
                "item_type": (getattr(item, "item_type", None) or "") or "",
                "unit": (item.unit or "")[:24],
                "quantity_on_hand": _f(qoh),
                "unit_cost": _f(uc),
                "extended_cost_value": _f(ext_cost),
                "list_price": _f(list_p),
                "extended_list_value": _f(ext_list),
                "period_quantity_sold": _f(pq),
                "period_revenue": _f(pa),
                "period_days": int(period_days),
                "velocity_per_day": _f(daily_avg) if daily_avg is not None else 0.0,
                "days_of_cover": None if doc is None else round(doc, 1),
                "gross_margin_pct": None if margin_pct is None else round(margin_pct, 2),
                "stock_status": stock_status,
            }
        )

    # Highest inventory value (cost) first
    rows_out.sort(
        key=lambda r: (float(r.get("extended_cost_value", 0) or 0), r.get("sku") or ""),
        reverse=True,
    )

    out_val: dict[str, Any] = {
        "report_id": "inventory-sku-valuation",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "filters": {
            "category": category or "",
            "item_ids": list(item_ids) if item_ids else None,
        },
        "summary": {
            "line_count": len(rows_out),
            "total_qty_on_hand": _f(tot_qoh),
            "total_cost_value": _f(tot_cost),
            "total_list_value": _f(tot_list),
            "total_period_quantity_sold": _f(tot_period_qty),
            "total_period_revenue": _f(tot_period_rev),
            "period_days": int(period_days),
            "implied_list_minus_cost": _f(tot_list - tot_cost),
        },
        "rows": rows_out,
        "accounting_note": (
            "On-hand is live Item quantity (including tank-synced products). "
            "Cost uses Item.cost with a fallback to list price for zero-cost items. "
            "Velocity = period quantity ÷ day count. Days of cover = on-hand ÷ average daily period sales; "
            "N/A when there is no period movement."
        ),
    }
    if station_id is not None:
        out_val["filter_station_id"] = station_id
        out_val["accounting_note"] += (
            " With a site filter, on-hand is that site’s tank or shop-bin quantity; "
            "period sales are invoice lines on invoices for that site only."
        )
    return out_val


def report_item_master_by_category(
    company_id: int, start: date, end: date, station_id: int | None = None
) -> dict[str, Any]:
    """
    Full catalog with reporting category, POS class, and stock value — grouped summary + detail rows.
    With ``station_id``, quantity and value are for that site’s physical stock (bins / tanks).
    """
    items = list(
        Item.objects.filter(company_id=company_id).order_by("category", "item_number", "name")
    )
    from collections import defaultdict

    by_cat: dict[str, list[Item]] = defaultdict(list)
    for it in items:
        c = (getattr(it, "category", None) or "").strip() or "General"
        by_cat[c].append(it)

    cat_summary: list[dict[str, Any]] = []
    for cat in sorted(by_cat.keys(), key=str.lower):
        group = by_cat[cat]
        qoh_sum = Decimal("0")
        ext_c = Decimal("0")
        ext_l = Decimal("0")
        for it in group:
            if station_id is not None:
                qoh = _item_qoh_at_station(company_id, it, station_id)
            else:
                qoh = _d(getattr(it, "quantity_on_hand", None) or 0)
            if qoh < 0:
                qoh = Decimal("0")
            qoh_sum += qoh
            uc = item_inventory_unit_cost(it)
            lp = _d(getattr(it, "unit_price", None) or 0)
            ext_c += qoh * uc
            ext_l += qoh * lp
        active_n = sum(1 for it in group if it.is_active)
        cat_summary.append(
            {
                "reporting_category": cat,
                "item_count": len(group),
                "active_count": int(active_n),
                "quantity_on_hand": _f(qoh_sum),
                "extended_cost_value": _f(ext_c),
                "extended_list_value": _f(ext_l),
            }
        )

    detail: list[dict[str, Any]] = []
    for it in items:
        if station_id is not None:
            qoh = _item_qoh_at_station(company_id, it, station_id)
        else:
            qoh = _d(getattr(it, "quantity_on_hand", None) or 0)
        if qoh < 0:
            qoh = Decimal("0")
        uc = item_inventory_unit_cost(it)
        lp = _d(getattr(it, "unit_price", None) or 0)
        rc = (getattr(it, "category", None) or "").strip() or "General"
        detail.append(
            {
                "item_id": it.id,
                "sku": (it.item_number or "").strip() or f"#{it.id}",
                "name": (it.name or "")[:200],
                "reporting_category": rc,
                "pos_category": (it.pos_category or "general")[:64],
                "item_type": (it.item_type or "") or "",
                "is_active": bool(it.is_active),
                "unit": (it.unit or "")[:24],
                "quantity_on_hand": _f(qoh),
                "unit_cost": _f(uc),
                "list_price": _f(lp),
                "extended_cost_value": _f(qoh * uc),
                "extended_list_value": _f(qoh * lp),
            }
        )

    g_qoh = sum((_d(c["quantity_on_hand"]) for c in cat_summary), start=Decimal("0"))
    g_cost = sum((_d(c["extended_cost_value"]) for c in cat_summary), start=Decimal("0"))
    g_list = sum((_d(c["extended_list_value"]) for c in cat_summary), start=Decimal("0"))
    out_m: dict[str, Any] = {
        "report_id": "item-master-by-category",
        "period": {
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "note": "Catalog snapshot (current). Dates label the printout only.",
        },
        "summary": {
            "total_items": len(items),
            "distinct_categories": len(by_cat),
            "total_quantity_on_hand": _f(g_qoh),
            "total_extended_cost_value": _f(g_cost),
            "total_extended_list_value": _f(g_list),
        },
        "by_category": cat_summary,
        "rows": detail,
        "accounting_note": (
            "Every product should have a reporting category on the item form. "
            "Values use live quantity on hand and item cost (with list fallback) for extension."
        ),
    }
    if station_id is not None:
        out_m["filter_station_id"] = station_id
    return out_m


def report_item_sales_by_category(
    company_id: int, start: date, end: date, station_id: int | None = None
) -> dict[str, Any]:
    """
    Invoiced quantity and revenue by item reporting category (invoice lines with catalog items only).
    """
    base = InvoiceLine.objects.filter(
        invoice__company_id=company_id,
        invoice__invoice_date__gte=start,
        invoice__invoice_date__lte=end,
        item_id__isnull=False,
    )
    if station_id is not None:
        base = base.filter(invoice__station_id=station_id)
    agg = (
        base.annotate(
            rc=Coalesce(Trim("item__category"), Value("")),
        )
        .values("rc")
        .annotate(
            total_qty=Coalesce(Sum("quantity"), Decimal("0")),
            total_revenue=Coalesce(Sum("amount"), Decimal("0")),
            line_count=Count("id"),
            item_count=Count("item_id", distinct=True),
        )
        .order_by("rc")
    )
    rows_out: list[dict[str, Any]] = []
    tot_q = Decimal("0")
    tot_r = Decimal("0")
    for row in agg:
        label = (row.get("rc") or "").strip() or "General"
        tq = _d(row.get("total_qty"))
        tr = _d(row.get("total_revenue"))
        tot_q += tq
        tot_r += tr
        rows_out.append(
            {
                "reporting_category": label,
                "line_count": int(row.get("line_count") or 0),
                "distinct_items": int(row.get("item_count") or 0),
                "total_quantity": _f(tq),
                "total_revenue": _f(tr),
            }
        )
    out_cat: dict[str, Any] = {
        "report_id": "item-sales-by-category",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "summary": {
            "category_rows": len(rows_out),
            "total_quantity": _f(tot_q),
            "total_revenue": _f(tot_r),
        },
        "rows": rows_out,
        "accounting_note": (
            "Revenue and quantity from posted invoice lines in the period, grouped by each "
            "product's reporting category. Only lines linked to a catalog item are included."
        ),
    }
    if station_id is not None:
        out_cat["filter_station_id"] = station_id
    return out_cat


def report_item_sales_custom(
    company_id: int,
    start: date,
    end: date,
    category: str | None = None,
    item_id: int | None = None,
    item_ids: list[int] | None = None,
    station_id: int | None = None,
) -> dict[str, Any]:
    """
    Period sales by SKU with optional reporting category and/or product filter.
    ``item_ids`` (one or more) restricts to those products; if set, rows include
    selected items even when period sales are zero. ``item_id`` is legacy single-id.
    With ``station_id``, only invoice lines on invoices for that site are included.
    """
    base = InvoiceLine.objects.filter(
        invoice__company_id=company_id,
        invoice__invoice_date__gte=start,
        invoice__invoice_date__lte=end,
        item_id__isnull=False,
    )
    if station_id is not None:
        base = base.filter(invoice__station_id=station_id)
    if item_ids:
        base = base.filter(item_id__in=item_ids)
    elif item_id is not None:
        base = base.filter(item_id=item_id)
    if category:
        base = base.filter(item__category=category)
    line_agg: dict[int, dict[str, Decimal]] = {}
    for row in (
        base.values("item_id")
        .annotate(
            q=Coalesce(Sum("quantity"), Decimal("0")),
            a=Coalesce(Sum("amount"), Decimal("0")),
        )
    ):
        iid = row.get("item_id")
        if iid:
            line_agg[int(iid)] = {"q": _d(row.get("q")), "a": _d(row.get("a"))}
    if item_ids:
        for iid in item_ids:
            if iid not in line_agg:
                line_agg[iid] = {"q": Decimal("0"), "a": Decimal("0")}
        id_list = sorted({int(x) for x in item_ids})
    else:
        id_list = sorted(line_agg.keys())
    items_by_id = {i.id: i for i in Item.objects.filter(company_id=company_id, id__in=id_list)}
    rows_out: list[dict[str, Any]] = []
    tot_q = Decimal("0")
    tot_r = Decimal("0")
    for iid in id_list:
        it = items_by_id.get(iid)
        if not it:
            continue
        agg = line_agg.get(iid) or {"q": Decimal("0"), "a": Decimal("0")}
        pq, pa = agg["q"], agg["a"]
        tot_q += pq
        tot_r += pa
        uc = item_inventory_unit_cost(it)
        cogs = pq * uc
        margin: float | None = None
        if pa > 0:
            margin = float((pa - cogs) / pa * Decimal("100"))
        rows_out.append(
            {
                "item_id": it.id,
                "sku": (it.item_number or "").strip() or f"#{it.id}",
                "name": (it.name or "")[:200],
                "reporting_category": (it.category or "").strip() or "General",
                "pos_category": (it.pos_category or "general")[:64],
                "item_type": (it.item_type or "") or "",
                "unit": (it.unit or "")[:24],
                "period_quantity_sold": _f(pq),
                "period_revenue": _f(pa),
                "est_cogs": _f(cogs),
                "gross_margin_pct": None if margin is None else round(margin, 2),
            }
        )
    rows_out.sort(key=lambda r: (float(r.get("period_revenue", 0) or 0), r.get("sku") or ""), reverse=True)
    out_cust: dict[str, Any] = {
        "report_id": "item-sales-custom",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "summary": {
            "line_count": len(rows_out),
            "total_quantity": _f(tot_q),
            "total_revenue": _f(tot_r),
        },
        "filters": {
            "category": category or "",
            "item_id": item_id if item_id is not None and not item_ids else None,
            "item_ids": list(item_ids) if item_ids else None,
        },
        "rows": rows_out,
        "accounting_note": (
            "Invoiced sales in the period, with optional category and/or multi-select products (item_ids). "
            "Selected products appear even with zero sales in the range. "
            "COGS and margin use item unit cost × period quantity sold."
        ),
    }
    if station_id is not None:
        out_cust["filter_station_id"] = station_id
    return out_cust


def _item_scope_queryset(
    company_id: int,
    category: str | None,
    item_ids: list[int] | None,
) -> list[Item]:
    """Active catalog rows for item-scoped operational reports."""
    q = Item.objects.filter(company_id=company_id, is_active=True)
    if category:
        q = q.filter(category=category)
    if item_ids:
        q = q.filter(id__in=item_ids)
    return list(q.order_by("category", "item_number", "name"))


def report_item_stock_movement(
    company_id: int,
    start: date,
    end: date,
    category: str | None = None,
    item_ids: list[int] | None = None,
    station_id: int | None = None,
) -> dict[str, Any]:
    """
    Purchase quantities (vendor bills) vs sales (invoices) in the period, by item.
    With ``station_id``, sales are that site’s invoices; purchases are bill lines for that receiving site.
    """
    inv_base = InvoiceLine.objects.filter(
        invoice__company_id=company_id,
        invoice__invoice_date__gte=start,
        invoice__invoice_date__lte=end,
        item_id__isnull=False,
    )
    bill_base = _bill_lines_in_period(company_id, start, end, require_item=True)
    if station_id is not None:
        inv_base = inv_base.filter(invoice__station_id=station_id)
        bill_base = _filter_bill_lines_for_station(bill_base, station_id)
    if category:
        inv_base = inv_base.filter(item__category=category)
        bill_base = bill_base.filter(item__category=category)
    if item_ids:
        inv_base = inv_base.filter(item_id__in=item_ids)
        bill_base = bill_base.filter(item_id__in=item_ids)

    sales_m: dict[int, dict[str, Decimal]] = {}
    for row in inv_base.values("item_id").annotate(
        q=Coalesce(Sum("quantity"), Decimal("0")),
        a=Coalesce(Sum("amount"), Decimal("0")),
    ):
        iid = row.get("item_id")
        if iid:
            sales_m[int(iid)] = {"q": _d(row.get("q")), "a": _d(row.get("a"))}
    purch_m: dict[int, dict[str, Decimal]] = {}
    for row in bill_base.values("item_id").annotate(
        q=Coalesce(Sum("quantity"), Decimal("0")),
        a=Coalesce(Sum("amount"), Decimal("0")),
    ):
        iid = row.get("item_id")
        if iid:
            purch_m[int(iid)] = {"q": _d(row.get("q")), "a": _d(row.get("a"))}

    scope = _item_scope_queryset(company_id, category, item_ids)
    if not item_ids and not category:
        # default: all items that had any purchase or sale in range
        touch = set(sales_m) | set(purch_m)
        if touch:
            scope = list(
                Item.objects.filter(company_id=company_id, id__in=touch).order_by(
                    "category", "item_number", "name"
                )
            )
        else:
            scope = []

    rows_out: list[dict[str, Any]] = []
    for it in scope:
        iid = int(it.id)
        sq = sales_m.get(iid, {"q": Decimal("0"), "a": Decimal("0")})
        pq = purch_m.get(iid, {"q": Decimal("0"), "a": Decimal("0")})
        net_q = pq["q"] - sq["q"]
        rows_out.append(
            {
                "item_id": it.id,
                "sku": (it.item_number or "").strip() or f"#{it.id}",
                "name": (it.name or "")[:200],
                "reporting_category": (it.category or "").strip() or "General",
                "unit": (it.unit or "")[:24],
                "quantity_purchased": _f(pq["q"]),
                "purchase_amount": _f(pq["a"]),
                "quantity_sold": _f(sq["q"]),
                "sales_revenue": _f(sq["a"]),
                "net_quantity_in": _f(net_q),
            }
        )
    rows_out.sort(
        key=lambda r: (abs(float(r.get("net_quantity_in", 0) or 0)), r.get("sku") or ""),
        reverse=True,
    )
    tot_purch_a = sum((v["a"] for v in purch_m.values()), start=Decimal("0"))
    tot_sales_a = sum((v["a"] for v in sales_m.values()), start=Decimal("0"))
    out_sm: dict[str, Any] = {
        "report_id": "item-stock-movement",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "summary": {
            "line_count": len(rows_out),
            "total_qty_purchased": _f(sum((v["q"] for v in purch_m.values()), start=Decimal("0"))),
            "total_qty_sold": _f(sum((v["q"] for v in sales_m.values()), start=Decimal("0"))),
            "total_purchase_amount": _f(tot_purch_a),
            "total_sales_revenue": _f(tot_sales_a),
        },
        "filters": {
            "category": category or "",
            "item_ids": list(item_ids) if item_ids else None,
        },
        "rows": rows_out,
        "accounting_note": (
            "Purchases from vendor bill lines; sales from invoice lines, both in the date range. "
            "Net quantity in = purchased − sold (positive means more received than sold in the period). "
            "With no category and no item pick, only items with purchase or sale activity are listed."
        ),
    }
    if station_id is not None:
        out_sm["filter_station_id"] = station_id
    return out_sm


def report_item_velocity_analysis(
    company_id: int,
    start: date,
    end: date,
    category: str | None = None,
    item_ids: list[int] | None = None,
    station_id: int | None = None,
) -> dict[str, Any]:
    """
    Classify products into fast / medium / slow movers from invoiced quantity in the period
    (tertiles among items with period sales &gt; 0). Items with no sales in range are
    ``no_period_sales`` (optionally with stock on hand).
    """
    period_days = (end - start).days + 1
    if period_days < 1:
        period_days = 1
    pdd = Decimal(str(period_days))

    inv_base = InvoiceLine.objects.filter(
        invoice__company_id=company_id,
        invoice__invoice_date__gte=start,
        invoice__invoice_date__lte=end,
        item_id__isnull=False,
    )
    if station_id is not None:
        inv_base = inv_base.filter(invoice__station_id=station_id)
    if category:
        inv_base = inv_base.filter(item__category=category)
    if item_ids:
        inv_base = inv_base.filter(item_id__in=item_ids)

    qty_by: dict[int, Decimal] = {}
    rev_by: dict[int, Decimal] = {}
    for row in inv_base.values("item_id").annotate(
        q=Coalesce(Sum("quantity"), Decimal("0")),
        a=Coalesce(Sum("amount"), Decimal("0")),
    ):
        iid = row.get("item_id")
        if not iid:
            continue
        iid = int(iid)
        qty_by[iid] = _d(row.get("q"))
        rev_by[iid] = _d(row.get("a"))

    scope = _item_scope_queryset(company_id, category, item_ids)
    if not scope:
        empty_vel: dict[str, Any] = {
            "report_id": "item-velocity-analysis",
            "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
            "summary": {"line_count": 0, "fast": 0, "medium": 0, "slow": 0, "no_period_sales": 0},
            "filters": {"category": category or "", "item_ids": list(item_ids) if item_ids else None},
            "rows": [],
            "accounting_note": "No active items match the filter.",
        }
        if station_id is not None:
            empty_vel["filter_station_id"] = station_id
        return empty_vel

    rows: list[dict[str, Any]] = []
    for it in scope:
        iid = int(it.id)
        pq = qty_by.get(iid) or Decimal("0")
        pa = rev_by.get(iid) or Decimal("0")
        if station_id is not None:
            qoh = _item_qoh_at_station(company_id, it, station_id)
        else:
            qoh = _d(getattr(it, "quantity_on_hand", None) or 0)
        if qoh < 0:
            qoh = Decimal("0")
        daily = (pq / pdd) if pdd else Decimal("0")
        rows.append(
            {
                "item_id": it.id,
                "sku": (it.item_number or "").strip() or f"#{it.id}",
                "name": (it.name or "")[:200],
                "reporting_category": (it.category or "").strip() or "General",
                "item_type": (it.item_type or "") or "",
                "unit": (it.unit or "")[:24],
                "quantity_on_hand": _f(qoh),
                "period_quantity_sold": _f(pq),
                "period_revenue": _f(pa),
                "velocity_per_day": _f(daily),
                "velocity_rank": 0,
                "movement_tier": "no_period_sales",
            }
        )

    movers = [r for r in rows if float(r.get("period_quantity_sold", 0) or 0) > 0]
    movers.sort(
        key=lambda r: (
            -float(r.get("period_quantity_sold", 0) or 0),
            (r.get("sku") or "") or "",
        )
    )
    n = len(movers)
    if n:
        k = max(1, (n + 2) // 3)
        for i, r in enumerate(movers):
            r["velocity_rank"] = i + 1
            if i < k:
                r["movement_tier"] = "fast"
            elif i < 2 * k:
                r["movement_tier"] = "medium"
            else:
                r["movement_tier"] = "slow"

    rows.sort(
        key=lambda r: (
            {"fast": 0, "medium": 1, "slow": 2, "no_period_sales": 3}.get(
                str(r.get("movement_tier")), 4
            ),
            -float(r.get("period_quantity_sold", 0) or 0),
        )
    )
    summary = {
        "line_count": len(rows),
        "fast": sum(1 for r in rows if r.get("movement_tier") == "fast"),
        "medium": sum(1 for r in rows if r.get("movement_tier") == "medium"),
        "slow": sum(1 for r in rows if r.get("movement_tier") == "slow"),
        "no_period_sales": sum(1 for r in rows if r.get("movement_tier") == "no_period_sales"),
    }
    out_vel: dict[str, Any] = {
        "report_id": "item-velocity-analysis",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "summary": summary,
        "filters": {
            "category": category or "",
            "item_ids": list(item_ids) if item_ids else None,
        },
        "rows": rows,
        "accounting_note": (
            "Fast / medium / slow are **tertiles by invoiced quantity** in the range among items with sales &gt; 0. "
            "No sales in the period = \"no_period_sales\" (check on-hand for dead stock). "
            "Velocity is units sold ÷ days in range."
        ),
    }
    if station_id is not None:
        out_vel["filter_station_id"] = station_id
    return out_vel


def report_item_purchases_by_category(
    company_id: int, start: date, end: date, station_id: int | None = None
) -> dict[str, Any]:
    """
    Vendor bill line quantity and spend by item reporting category (lines with catalog items only).
    With ``station_id``, only lines on bills with that receiving site.
    """
    base = _bill_lines_in_period(company_id, start, end, require_item=True)
    if station_id is not None:
        base = _filter_bill_lines_for_station(base, station_id)
    agg = (
        base.annotate(
            rc=Coalesce(Trim("item__category"), Value("")),
        )
        .values("rc")
        .annotate(
            total_qty=Coalesce(Sum("quantity"), Decimal("0")),
            total_amount=Coalesce(Sum("amount"), Decimal("0")),
            line_count=Count("id"),
            item_count=Count("item_id", distinct=True),
        )
        .order_by("rc")
    )
    rows_out: list[dict[str, Any]] = []
    tot_q = Decimal("0")
    tot_a = Decimal("0")
    for row in agg:
        label = (row.get("rc") or "").strip() or "General"
        tq = _d(row.get("total_qty"))
        ta = _d(row.get("total_amount"))
        tot_q += tq
        tot_a += ta
        rows_out.append(
            {
                "reporting_category": label,
                "line_count": int(row.get("line_count") or 0),
                "distinct_items": int(row.get("item_count") or 0),
                "total_quantity": _f(tq),
                "total_purchase_amount": _f(ta),
            }
        )
    out_pcat: dict[str, Any] = {
        "report_id": "item-purchases-by-category",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "summary": {
            "category_rows": len(rows_out),
            "total_quantity": _f(tot_q),
            "total_purchase_amount": _f(tot_a),
        },
        "rows": rows_out,
        "accounting_note": (
            "Quantity and amount from vendor bill lines in the period, grouped by each "
            "product's reporting category. Only lines linked to a catalog item are included."
        ),
    }
    if station_id is not None:
        out_pcat["filter_station_id"] = station_id
    return out_pcat


def report_item_purchases_custom(
    company_id: int,
    start: date,
    end: date,
    category: str | None = None,
    item_id: int | None = None,
    item_ids: list[int] | None = None,
    station_id: int | None = None,
) -> dict[str, Any]:
    """
    Period purchases by SKU (vendor bills) with optional category and/or product filter.
    With ``station_id``, only bill lines for that receiving site.
    """
    base = _bill_lines_in_period(company_id, start, end, require_item=True)
    if station_id is not None:
        base = _filter_bill_lines_for_station(base, station_id)
    if item_ids:
        base = base.filter(item_id__in=item_ids)
    elif item_id is not None:
        base = base.filter(item_id=item_id)
    if category:
        base = base.filter(item__category=category)
    line_agg: dict[int, dict[str, Decimal]] = {}
    for row in base.values("item_id").annotate(
        q=Coalesce(Sum("quantity"), Decimal("0")),
        a=Coalesce(Sum("amount"), Decimal("0")),
    ):
        iid = row.get("item_id")
        if iid:
            line_agg[int(iid)] = {"q": _d(row.get("q")), "a": _d(row.get("a"))}
    if item_ids:
        for iid in item_ids:
            if iid not in line_agg:
                line_agg[iid] = {"q": Decimal("0"), "a": Decimal("0")}
        id_list = sorted({int(x) for x in item_ids})
    else:
        id_list = sorted(line_agg.keys())
    items_by_id = {i.id: i for i in Item.objects.filter(company_id=company_id, id__in=id_list)}
    rows_out: list[dict[str, Any]] = []
    tot_q = Decimal("0")
    tot_a = Decimal("0")
    for iid in id_list:
        it = items_by_id.get(iid)
        if not it:
            continue
        agg = line_agg.get(iid) or {"q": Decimal("0"), "a": Decimal("0")}
        pq, pa = agg["q"], agg["a"]
        tot_q += pq
        tot_a += pa
        avg_unit = (pa / pq) if pq > 0 else Decimal("0")
        rows_out.append(
            {
                "item_id": it.id,
                "sku": (it.item_number or "").strip() or f"#{it.id}",
                "name": (it.name or "")[:200],
                "reporting_category": (it.category or "").strip() or "General",
                "pos_category": (it.pos_category or "general")[:64],
                "item_type": (it.item_type or "") or "",
                "unit": (it.unit or "")[:24],
                "period_quantity_purchased": _f(pq),
                "period_purchase_amount": _f(pa),
                "avg_purchase_unit_cost": _f(avg_unit) if pq > 0 else None,
            }
        )
    rows_out.sort(
        key=lambda r: (float(r.get("period_purchase_amount", 0) or 0), r.get("sku") or ""), reverse=True
    )
    out_pc: dict[str, Any] = {
        "report_id": "item-purchases-custom",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "summary": {
            "line_count": len(rows_out),
            "total_quantity": _f(tot_q),
            "total_purchase_amount": _f(tot_a),
        },
        "filters": {
            "category": category or "",
            "item_id": item_id if item_id is not None and not item_ids else None,
            "item_ids": list(item_ids) if item_ids else None,
        },
        "rows": rows_out,
        "accounting_note": (
            "Purchases in the period from bill lines, with optional category and/or product filter. "
            "Selected products appear even with zero purchase quantity in the range. "
            "Average unit cost = line amount ÷ quantity when quantity &gt; 0."
        ),
    }
    if station_id is not None:
        out_pc["filter_station_id"] = station_id
    return out_pc


def report_item_purchase_velocity_analysis(
    company_id: int,
    start: date,
    end: date,
    category: str | None = None,
    item_ids: list[int] | None = None,
    station_id: int | None = None,
) -> dict[str, Any]:
    """
    Classify products into fast / medium / slow purchase volume from bill line quantity
    in the period (tertiles among items with purchases &gt; 0). Items with no bill lines in
    range are ``no_period_purchases``.
    """
    period_days = (end - start).days + 1
    if period_days < 1:
        period_days = 1
    pdd = Decimal(str(period_days))

    bill_base = _bill_lines_in_period(company_id, start, end, require_item=True)
    if station_id is not None:
        bill_base = _filter_bill_lines_for_station(bill_base, station_id)
    if category:
        bill_base = bill_base.filter(item__category=category)
    if item_ids:
        bill_base = bill_base.filter(item_id__in=item_ids)

    qty_by: dict[int, Decimal] = {}
    amt_by: dict[int, Decimal] = {}
    for row in bill_base.values("item_id").annotate(
        q=Coalesce(Sum("quantity"), Decimal("0")),
        a=Coalesce(Sum("amount"), Decimal("0")),
    ):
        iid = row.get("item_id")
        if not iid:
            continue
        iid = int(iid)
        qty_by[iid] = _d(row.get("q"))
        amt_by[iid] = _d(row.get("a"))

    scope = _item_scope_queryset(company_id, category, item_ids)
    if not scope:
        empty_p: dict[str, Any] = {
            "report_id": "item-purchase-velocity-analysis",
            "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
            "summary": {
                "line_count": 0,
                "fast": 0,
                "medium": 0,
                "slow": 0,
                "no_period_purchases": 0,
            },
            "filters": {"category": category or "", "item_ids": list(item_ids) if item_ids else None},
            "rows": [],
            "accounting_note": "No active items match the filter.",
        }
        if station_id is not None:
            empty_p["filter_station_id"] = station_id
        return empty_p

    rows: list[dict[str, Any]] = []
    for it in scope:
        iid = int(it.id)
        pqty = qty_by.get(iid) or Decimal("0")
        pamt = amt_by.get(iid) or Decimal("0")
        if station_id is not None:
            qoh = _item_qoh_at_station(company_id, it, station_id)
        else:
            qoh = _d(getattr(it, "quantity_on_hand", None) or 0)
        if qoh < 0:
            qoh = Decimal("0")
        daily = (pqty / pdd) if pdd else Decimal("0")
        rows.append(
            {
                "item_id": it.id,
                "sku": (it.item_number or "").strip() or f"#{it.id}",
                "name": (it.name or "")[:200],
                "reporting_category": (it.category or "").strip() or "General",
                "item_type": (it.item_type or "") or "",
                "unit": (it.unit or "")[:24],
                "quantity_on_hand": _f(qoh),
                "period_quantity_purchased": _f(pqty),
                "period_purchase_amount": _f(pamt),
                "purchase_velocity_per_day": _f(daily),
                "velocity_rank": 0,
                "movement_tier": "no_period_purchases",
            }
        )

    movers = [r for r in rows if float(r.get("period_quantity_purchased", 0) or 0) > 0]
    movers.sort(
        key=lambda r: (
            -float(r.get("period_quantity_purchased", 0) or 0),
            (r.get("sku") or "") or "",
        )
    )
    n = len(movers)
    if n:
        k = max(1, (n + 2) // 3)
        for i, r in enumerate(movers):
            r["velocity_rank"] = i + 1
            if i < k:
                r["movement_tier"] = "fast"
            elif i < 2 * k:
                r["movement_tier"] = "medium"
            else:
                r["movement_tier"] = "slow"

    rows.sort(
        key=lambda r: (
            {"fast": 0, "medium": 1, "slow": 2, "no_period_purchases": 3}.get(
                str(r.get("movement_tier")), 4
            ),
            -float(r.get("period_quantity_purchased", 0) or 0),
        )
    )
    summary = {
        "line_count": len(rows),
        "fast": sum(1 for r in rows if r.get("movement_tier") == "fast"),
        "medium": sum(1 for r in rows if r.get("movement_tier") == "medium"),
        "slow": sum(1 for r in rows if r.get("movement_tier") == "slow"),
        "no_period_purchases": sum(1 for r in rows if r.get("movement_tier") == "no_period_purchases"),
    }
    out_pvel: dict[str, Any] = {
        "report_id": "item-purchase-velocity-analysis",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "summary": summary,
        "filters": {
            "category": category or "",
            "item_ids": list(item_ids) if item_ids else None,
        },
        "rows": rows,
        "accounting_note": (
            "Fast / medium / slow are **tertiles by purchase quantity** (vendor bill lines) in the range among "
            "items with purchases &gt; 0. No purchases in the period = \"no_period_purchases\". "
            "Velocity is units purchased ÷ days in range."
        ),
    }
    if station_id is not None:
        out_pvel["filter_station_id"] = station_id
    return out_pvel


def _financial_analytics_entity_row(
    company_id: int,
    start: date,
    end: date,
    *,
    entity_type: str,
    entity_id: int,
    entity_name: str,
    station_id: int | None = None,
    pond_id: int | None = None,
) -> dict[str, Any]:
    """Compact KPI row for financial-analytics station/pond comparison charts."""
    row: dict[str, Any] = {
        "entity_type": entity_type,
        "entity_id": entity_id,
        "entity_name": entity_name,
        "document_sales": 0.0,
        "pl_income": 0.0,
        "pl_cogs": 0.0,
        "pl_expenses": 0.0,
        "gross_profit": 0.0,
        "net_income": 0.0,
    }
    if pond_id is not None:
        row["pond_id"] = pond_id
        row["pond_name"] = entity_name
        line_qs = _je_lines_pond(company_id, pond_id)
        pl = _period_pl_totals_from_line_qs(company_id, start, end, line_qs)
        doc_sales = _d(
            AquacultureFishSale.objects.filter(
                company_id=company_id,
                pond_id=pond_id,
                sale_date__gte=start,
                sale_date__lte=end,
            ).aggregate(t=Coalesce(Sum("total_amount"), Decimal("0")))["t"]
        )
        from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict

        mgmt = compute_aquaculture_pl_summary_dict(
            company_id, start, end, pond_id, None, None, False
        )
        ponds = mgmt.get("ponds") or []
        if ponds:
            p0 = ponds[0]
            row["management_revenue_bdt"] = _f(_d(p0.get("income_total") or p0.get("revenue")))
            row["management_profit_bdt"] = _f(_d(p0.get("profit")))
            row["management_total_costs_bdt"] = _f(_d(p0.get("total_costs")))
            row["management_feed_consumption_bdt"] = _f(_d(p0.get("feed_consumption_cost")))
            row["management_medicine_consumption_bdt"] = _f(_d(p0.get("medicine_consumption_cost")))
            row["management_other_consumption_bdt"] = _f(_d(p0.get("other_consumption_cost")))
            row["management_other_operating_bdt"] = _f(_d(p0.get("other_operating_expenses")))
    else:
        row["station_id"] = station_id
        row["station_name"] = entity_name
        pl = _period_income_statement_totals(company_id, start, end, station_id)
        inv_q = Invoice.objects.filter(
            company_id=company_id,
            invoice_date__gte=start,
            invoice_date__lte=end,
            station_id=station_id,
        ).exclude(status="draft")
        doc_sales = _d(inv_q.aggregate(t=Coalesce(Sum("total"), Decimal("0")))["t"])

    row["document_sales"] = _f(doc_sales)
    row["pl_income"] = _f(pl["income"])
    row["pl_cogs"] = _f(pl["cogs"])
    row["pl_expenses"] = _f(pl["expenses"])
    row["gross_profit"] = _f(pl["gross_profit"])
    row["net_income"] = _f(pl["net_income"])
    return row


def report_financial_analytics(
    company_id: int,
    start: date,
    end: date,
    station_id: int | None = None,
    pond_id: int | None = None,
) -> dict[str, Any]:
    """
    KPIs and monthly buckets: invoice sales and bill purchases (subledger documents) vs
    P&L from posted journals (income, COGS, operating expenses) for the same sub-periods.
    When not site-filtered, includes by_station and by_pond comparison rows for charts.
    """
    if start > end:
        start, end = end, start

    if pond_id is not None:
        pl = _period_income_statement_totals_pond(company_id, start, end, pond_id)
    else:
        pl = _period_income_statement_totals(company_id, start, end, station_id)
    sales = _sum_invoice_totals(company_id, start, end, station_id)
    purchases = _sum_bill_totals(company_id, start, end, station_id)
    op_exp = pl["expenses"]  # operating and other P&L expense types

    today = timezone.localdate()
    revenue_nd = _sum_invoice_totals_non_draft(company_id, start, end, station_id)
    purchases_nd = _sum_bill_totals_non_draft(company_id, start, end, station_id)
    inv_period_ct = _count_invoices_non_draft(company_id, start, end, station_id)
    lifetime_rev = _sum_invoice_totals_non_draft_all_time(company_id)
    lifetime_inv_ct = Invoice.objects.filter(company_id=company_id).exclude(status="draft").count()

    today_sales = _sum_invoice_totals_non_draft(company_id, today, today, station_id)
    today_inv_qs = Invoice.objects.filter(company_id=company_id, invoice_date=today).exclude(
        status="draft"
    )
    if station_id is not None:
        today_inv_qs = today_inv_qs.filter(station_id=station_id)
    today_inv_ct = today_inv_qs.count()

    bills_qs = Bill.objects.filter(
        company_id=company_id,
        bill_date__gte=start,
        bill_date__lte=end,
    ).exclude(status="draft")
    if station_id is not None:
        bills_qs = bills_qs.filter(
            Q(receipt_station_id=station_id) | Q(lines__receipt_station_id=station_id)
        ).distinct()
    bills_count_period = bills_qs.count()
    bills_total_period = _d(bills_qs.aggregate(t=Coalesce(Sum("total"), Decimal("0")))["t"])

    pay_recv = (
        Payment.objects.filter(
            company_id=company_id,
            payment_type=Payment.PAYMENT_TYPE_RECEIVED,
            payment_date__gte=start,
            payment_date__lte=end,
        ).aggregate(t=Coalesce(Sum("amount"), Decimal("0")))["t"]
    )
    pay_made = (
        Payment.objects.filter(
            company_id=company_id,
            payment_type=Payment.PAYMENT_TYPE_MADE,
            payment_date__gte=start,
            payment_date__lte=end,
        ).aggregate(t=Coalesce(Sum("amount"), Decimal("0")))["t"]
    )

    avg_inv = Decimal("0")
    if inv_period_ct > 0:
        avg_inv = revenue_nd / inv_period_ct

    def _pct_of_rev(amount: Decimal) -> float:
        if revenue_nd <= 0:
            return 0.0
        return _f(amount / revenue_nd * Decimal("100"))

    profit_mix_components: list[dict[str, Any]] = [
        {
            "key": "period_sales",
            "label": "Total sales",
            "amount": _f(revenue_nd),
            "pct_of_revenue": _pct_of_rev(revenue_nd),
        },
        {
            "key": "cogs",
            "label": "COGS",
            "amount": _f(pl["cogs"]),
            "pct_of_revenue": _pct_of_rev(pl["cogs"]),
        },
        {
            "key": "expenses",
            "label": "Operating expenses",
            "amount": _f(op_exp),
            "pct_of_revenue": _pct_of_rev(op_exp),
        },
        {
            "key": "net_income",
            "label": "Net income",
            "amount": _f(pl["net_income"]),
            "pct_of_revenue": _pct_of_rev(pl["net_income"]),
        },
    ]

    months = _iter_month_periods_in_range(start, end)
    if len(months) > 36:
        months = months[:36]
    timeseries: list[dict[str, Any]] = []
    for seg_s, seg_e, label in months:
        if pond_id is not None:
            pl_m = _period_income_statement_totals_pond(company_id, seg_s, seg_e, pond_id)
        else:
            pl_m = _period_income_statement_totals(company_id, seg_s, seg_e, station_id)
        timeseries.append(
            {
                "label": label,
                "start_date": seg_s.isoformat(),
                "end_date": seg_e.isoformat(),
                "total_sales": _f(_sum_invoice_totals(company_id, seg_s, seg_e, station_id)),
                "total_purchases": _f(_sum_bill_totals(company_id, seg_s, seg_e, station_id)),
                "pl_income": _f(pl_m["income"]),
                "pl_cogs": _f(pl_m["cogs"]),
                "pl_expenses": _f(pl_m["expenses"]),
                "gross_profit": _f(pl_m["gross_profit"]),
                "net_income": _f(pl_m["net_income"]),
            }
        )

    active_customers = Customer.objects.filter(company_id=company_id, is_active=True).count()
    active_vendors = Vendor.objects.filter(company_id=company_id, is_active=True).count()

    out_fa: dict[str, Any] = {
        "report_id": "financial-analytics",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "kpis": {
            "total_sales": _f(sales),
            "total_purchases": _f(purchases),
            "pl_income": _f(pl["income"]),
            "pl_cogs": _f(pl["cogs"]),
            "pl_expenses": _f(op_exp),
            "gross_profit": _f(pl["gross_profit"]),
            "net_income": _f(pl["net_income"]),
            # Dashboard analytics (non-draft revenue, counts, payments — same reporting window)
            "today_sales": _f(today_sales),
            "today_invoice_count": today_inv_ct,
            "revenue_non_draft": _f(revenue_nd),
            "lifetime_revenue_non_draft": _f(lifetime_rev),
            "lifetime_invoice_count": lifetime_inv_ct,
            "active_customers": active_customers,
            "active_vendors": active_vendors,
            "bills_total_period": _f(bills_total_period),
            "bills_count_period": bills_count_period,
            "payments_received_period": _f(_d(pay_recv)),
            "payments_made_period": _f(_d(pay_made)),
            "invoices_period_count": inv_period_ct,
            "invoices_all_time_count": lifetime_inv_ct,
            "avg_invoice_period": _f(avg_inv),
            "total_purchases_non_draft": _f(purchases_nd),
        },
        "profit_mix": {
            "revenue_base": _f(revenue_nd),
            "components": profit_mix_components,
        },
        "timeseries": timeseries,
        "accounting_note": (
            "Sales = sum of invoice totals by invoice date; purchases = sum of vendor bill totals by bill date. "
            "P&L figures are from posted general-ledger activity (same basis as the Income Statement). "
            "Document totals and accrual P&L can differ if invoices/bills are not yet posted. "
            "Trend uses calendar months (partial first/last months are clipped to your selected range)."
        ),
    }
    if pond_id is not None:
        pond = AquaculturePond.objects.filter(
            pk=pond_id, company_id=company_id, is_active=True
        ).only("name").first()
        pname = (pond.name or "").strip() if pond else f"Pond #{pond_id}"
        out_fa["filter_pond_id"] = pond_id
        out_fa["filter_pond_name"] = pname
        row = _financial_analytics_entity_row(
            company_id,
            start,
            end,
            entity_type="pond",
            entity_id=pond_id,
            entity_name=pname,
            pond_id=pond_id,
        )
        out_fa["pond_scope"] = row
        doc_sales = _d(row.get("document_sales"))
        out_fa["aquaculture_summary"] = {
            "active_ponds": 1,
            "total_pond_sales_bdt": _f(doc_sales),
            "total_management_revenue_bdt": _f(_d(row.get("management_revenue_bdt"))),
            "total_management_profit_bdt": _f(_d(row.get("management_profit_bdt"))),
        }
        out_fa["accounting_note"] = (
            out_fa["accounting_note"]
            + f" Pond filter ({pname}): P&L amounts (including timeseries pl_* and net income) use posted journal lines "
            "tagged to this pond only. Invoice/bill/payment KPIs remain company-wide totals. "
            "Station and pond comparison charts are hidden while a pond is selected."
        )
    elif station_id is not None:
        out_fa["filter_station_id"] = station_id
        out_fa["accounting_note"] = (
            out_fa["accounting_note"]
            + " Site filter: P&L and document KPIs (sales, purchases, invoice/bill counts in the period) use this station only. "
            "Entity comparison charts are hidden while a site is selected."
        )
    else:
        by_station: list[dict[str, Any]] = []
        for st in Station.objects.filter(company_id=company_id, is_active=True).order_by(
            "station_name", "id"
        ):
            name = (st.station_name or "").strip() or f"Station #{st.id}"
            by_station.append(
                _financial_analytics_entity_row(
                    company_id,
                    start,
                    end,
                    entity_type="station",
                    entity_id=st.id,
                    entity_name=name,
                    station_id=st.id,
                )
            )
        by_pond: list[dict[str, Any]] = []
        for pond in AquaculturePond.objects.filter(
            company_id=company_id, is_active=True
        ).order_by("sort_order", "name", "id"):
            name = (pond.name or "").strip() or f"Pond #{pond.id}"
            by_pond.append(
                _financial_analytics_entity_row(
                    company_id,
                    start,
                    end,
                    entity_type="pond",
                    entity_id=pond.id,
                    entity_name=name,
                    pond_id=pond.id,
                )
            )
        out_fa["by_station"] = by_station
        out_fa["by_pond"] = by_pond
        mgmt_rev = sum(_d(r.get("management_revenue_bdt")) for r in by_pond)
        mgmt_profit = sum(_d(r.get("management_profit_bdt")) for r in by_pond)
        pond_doc_sales = sum(_d(r.get("document_sales")) for r in by_pond)
        out_fa["aquaculture_summary"] = {
            "active_ponds": len(by_pond),
            "total_pond_sales_bdt": _f(pond_doc_sales),
            "total_management_revenue_bdt": _f(mgmt_rev),
            "total_management_profit_bdt": _f(mgmt_profit),
        }
        if by_pond:
            out_fa["accounting_note"] = (
                out_fa["accounting_note"]
                + " Station rows use site-tagged GL and non-draft invoices for that site. "
                "Pond rows use pond-tagged GL; document_sales is registered fish/sack sales (BDT); "
                "management_* fields are aquaculture pond P&L register totals (may differ from GL)."
            )
    return out_fa


def _invoice_document_payload(inv: Invoice) -> dict[str, Any]:
    amt = inv.total or Decimal("0")
    return {
        "document_type": "invoice",
        "invoice_id": inv.id,
        "document_number": inv.invoice_number,
        "document_date": inv.invoice_date.isoformat(),
        "amount": _f(amt),
        "status": inv.status,
    }


def _documents_from_invoices(invs) -> list[dict[str, Any]]:
    return [_invoice_document_payload(inv) for inv in invs]


def _attach_row_document_drills(
    row: dict[str, Any],
    mapping: dict[str, tuple[list[dict[str, Any]], str, str]],
) -> None:
    """Attach ``_drill`` metadata on row money fields (invoice/bill document lists)."""
    drills: dict[str, Any] = {}
    for field, (docs, title, entity_type) in mapping.items():
        if docs:
            drills[field] = {
                "kind": "aging-documents",
                "title": title,
                "entityType": entity_type,
                "documents": docs,
            }
    if drills:
        row["_drill"] = drills
        row["documents"] = drills[next(iter(drills))]["documents"]


def _merge_row_documents(*row_lists: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Flatten document drill payloads from grouped report rows."""
    out: list[dict[str, Any]] = []
    for rows in row_lists:
        if not rows:
            continue
        for row in rows:
            out.extend(row.get("documents") or [])
    return out


def _attach_summary_document_drills(
    summary: dict[str, Any],
    mapping: dict[str, tuple[list[dict[str, Any]], str, str]],
) -> None:
    """Attach ``_drill`` metadata on summary money fields (invoice/bill document lists)."""
    drills: dict[str, Any] = {}
    for field, (row_lists, title, entity_type) in mapping.items():
        # Callers pass either a flat list of row dicts (nozzle/station/shift rows) or a
        # list of row groups ([cash_rows, credit_rows]). Only unpack when grouped.
        if row_lists and isinstance(row_lists[0], list):
            docs = _merge_row_documents(*row_lists)
        else:
            docs = _merge_row_documents(row_lists)
        if docs:
            drills[field] = {
                "kind": "aging-documents",
                "title": title,
                "entityType": entity_type,
                "documents": docs,
            }
    if drills:
        summary["_drill"] = drills


def report_drill_invoice_documents(
    company_id: int,
    customer_id: int,
    start: date,
    end: date,
    station_id: int | None = None,
) -> dict[str, Any]:
    """Source invoices for a customer in a period (report drill-down)."""
    qs = (
        Invoice.objects.filter(
            company_id=company_id,
            customer_id=customer_id,
            invoice_date__gte=start,
            invoice_date__lte=end,
        )
        .exclude(status="draft")
        .order_by("invoice_date", "id")
    )
    if station_id is not None:
        qs = qs.filter(station_id=station_id)
    customer = Customer.objects.filter(pk=customer_id, company_id=company_id).first()
    documents: list[dict[str, Any]] = []
    total = Decimal("0")
    for inv in qs:
        amt = inv.total or Decimal("0")
        total += amt
        documents.append(
            {
                "document_type": "invoice",
                "invoice_id": inv.id,
                "document_number": inv.invoice_number,
                "document_date": inv.invoice_date.isoformat(),
                "amount": _f(amt),
                "status": inv.status,
            }
        )
    return {
        "customer_id": customer_id,
        "display_name": (customer.display_name or customer.company_name or "") if customer else "",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "documents": documents,
        "total": _f(total),
    }


def report_drill_bill_documents(
    company_id: int,
    vendor_id: int,
    start: date,
    end: date,
    station_id: int | None = None,
) -> dict[str, Any]:
    """Source bills for a vendor in a period (report drill-down)."""
    qs = (
        Bill.objects.filter(
            company_id=company_id,
            vendor_id=vendor_id,
            bill_date__gte=start,
            bill_date__lte=end,
        )
        .exclude(status__in=("draft", "void"))
        .order_by("bill_date", "id")
    )
    if station_id is not None:
        qs = qs.filter(
            Q(receipt_station_id=station_id) | Q(lines__receipt_station_id=station_id)
        ).distinct()
    vendor = Vendor.objects.filter(pk=vendor_id, company_id=company_id).first()
    documents: list[dict[str, Any]] = []
    total = Decimal("0")
    for bill in qs:
        amt = bill.total or Decimal("0")
        total += amt
        documents.append(
            {
                "document_type": "bill",
                "bill_id": bill.id,
                "document_number": bill.bill_number,
                "document_date": bill.bill_date.isoformat(),
                "amount": _f(amt),
                "status": bill.status,
            }
        )
    return {
        "vendor_id": vendor_id,
        "display_name": (vendor.display_name or vendor.company_name or "") if vendor else "",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "documents": documents,
        "total": _f(total),
    }
