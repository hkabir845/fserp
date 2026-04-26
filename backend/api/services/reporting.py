"""
Company-scoped report payloads matching frontend /reports/* expectations.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Optional

from django.db.models import Count, Q, Sum, Value
from django.db.models.functions import Coalesce, Trim
from django.utils import timezone

from api.models import (
    BillLine,
    ChartOfAccount,
    Customer,
    Invoice,
    InvoiceLine,
    Item,
    JournalEntryLine,
    Meter,
    Nozzle,
    ShiftSession,
    Tank,
    TankDip,
    Vendor,
)
from api.services.gl_posting import item_inventory_unit_cost
from api.services.item_catalog import item_tracks_physical_stock
from api.services.coa_constants import (
    is_debit_normal_chart_type,
    is_pl_credit_normal_type,
    normalize_chart_account_type,
)


def _d(v: Any) -> Decimal:
    if v is None:
        return Decimal("0")
    return Decimal(str(v))


def _f(d: Decimal) -> float:
    return float(d.quantize(Decimal("0.01")))


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


def _je_lines_base(company_id: int):
    return JournalEntryLine.objects.filter(
        journal_entry__company_id=company_id,
        journal_entry__is_posted=True,
    )


def report_trial_balance(company_id: int, start: date, end: date) -> dict[str, Any]:
    """
    Period activity trial balance: sums posted journal lines with entry_date in [start, end].
    Total debits must equal total credits (double-entry). COA opening balances are not included.
    """
    period_lines = _je_lines_base(company_id).filter(
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
                "account_code": f"?{aid}",
                "account_name": "Journal lines on missing or other-company chart row — reconcile COA",
                "account_type": "unknown",
                "debit": _f(d),
                "credit": _f(c),
                "balance": _f(d - c),
            }
        )

    diff = total_d - total_c
    return {
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


def _movement_through(company_id: int, account_id: int, as_of: date) -> tuple[Decimal, Decimal]:
    agg = (
        _je_lines_base(company_id)
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


def _cumulative_net_income_through(company_id: int, as_of: date) -> Decimal:
    """
    P&L rolled to equity for balance-sheet balancing when income/expense/COSG
    are not yet closed to retained earnings. Net = income balances − COGS − expenses
    (each balance as-of `as_of`, including opening_balance on COA rows).
    """
    ni = Decimal("0")
    # Include inactive accounts: they can still hold JE balances and would otherwise
    # break Assets = L + E + NI.
    for coa in ChartOfAccount.objects.filter(company_id=company_id).order_by(
        "account_code"
    ):
        t = normalize_chart_account_type(coa.account_type)
        if t not in ("income", "cost_of_goods_sold", "expense"):
            continue
        bal = _ending_balance(coa, company_id, as_of)
        if t == "income":
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


def report_balance_sheet(company_id: int, start: date, end: date) -> dict[str, Any]:
    _ = start
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
    return {
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
        "accounting_note": (
            "Point-in-time as of end date. Unclosed P&L is included in equity as Σ-P&L; Σ-ADJ is an automatic tie-out if a small residual remains."
        ),
    }


def _period_pl_amount(coa: ChartOfAccount, company_id: int, start: date, end: date) -> Decimal:
    agg = (
        _je_lines_base(company_id)
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
    d, c = agg["td"], agg["tc"]
    if is_pl_credit_normal_type(coa.account_type):
        return c - d
    return d - c


def report_income_statement(company_id: int, start: date, end: date) -> dict[str, Any]:
    income_rows: list[dict[str, Any]] = []
    cogs_rows: list[dict[str, Any]] = []
    exp_rows: list[dict[str, Any]] = []
    ti = tcogs = te = Decimal("0")
    # Include inactive accounts: journals may still post to them; omitting them understates P&L.
    for coa in ChartOfAccount.objects.filter(company_id=company_id).order_by(
        "account_code"
    ):
        t = normalize_chart_account_type(coa.account_type)
        if t not in ("income", "cost_of_goods_sold", "expense"):
            continue
        amt = _period_pl_amount(coa, company_id, start, end)
        if amt == 0:
            continue
        display_name = coa.account_name
        if not coa.is_active:
            display_name = f"{display_name} (inactive)"
        row = {
            "account_code": coa.account_code,
            "account_name": display_name,
            "balance": _f(amt),
        }
        if t == "income":
            income_rows.append(row)
            ti += amt
        elif t == "cost_of_goods_sold":
            cogs_rows.append(row)
            tcogs += amt
        else:
            exp_rows.append(row)
            te += amt
    gross = ti - tcogs
    net = gross - te
    # Posted activity in [start, end] should match Δ cumulative P&L unless COA opening balances exist on P&L rows.
    day_before = start - timedelta(days=1)
    ni_before = _cumulative_net_income_through(company_id, day_before)
    ni_end = _cumulative_net_income_through(company_id, end)
    cumulative_change = ni_end - ni_before
    period_matches_cumulative = abs(cumulative_change - net) <= Decimal("0.02")
    return {
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
        "accounting_note": (
            "Posted journal activity in the date range only; opening balances on income/COGS/expense accounts are not added here. "
            "Cumulative change vs net income flags unusual opening-balance or dating issues."
        ),
    }


def report_customer_balances(company_id: int, start: date, end: date) -> dict[str, Any]:
    _ = start
    rows: list[dict[str, Any]] = []
    total_ar = Decimal("0")
    for c in Customer.objects.filter(company_id=company_id, is_active=True).order_by(
        "display_name"
    ):
        bal = c.current_balance or Decimal("0")
        rows.append(
            {
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
    return {
        "report_id": "customer-balances",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "customers": rows,
        "total_ar": _f(total_ar),
        "accounting_note": (
            "Subledger current_balance per customer. total_ar is the sum of positive balances only "
            "(typical receivable exposure); credit balances are customer prepayments."
        ),
    }


def report_vendor_balances(company_id: int, start: date, end: date) -> dict[str, Any]:
    _ = start
    rows: list[dict[str, Any]] = []
    total_ap = Decimal("0")
    for v in Vendor.objects.filter(company_id=company_id, is_active=True).order_by(
        "company_name"
    ):
        bal = v.current_balance or Decimal("0")
        rows.append(
            {
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
    return {
        "report_id": "vendor-balances",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "vendors": rows,
        "total_ap": _f(total_ap),
        "accounting_note": (
            "Subledger current_balance per vendor. total_ap is the sum of positive balances owed to vendors; "
            "negative balances may indicate vendor credits."
        ),
    }


def _is_fuel_line(line: InvoiceLine) -> bool:
    it = line.item
    if not it:
        return False
    u = (it.unit or "").lower()
    if u in ("l", "liter", "litre", "gal", "gallon"):
        return True
    return "fuel" in (it.pos_category or "").lower() or "fuel" in (it.category or "").lower()


def report_fuel_sales(company_id: int, start: date, end: date) -> dict[str, Any]:
    inv_ids = list(
        Invoice.objects.filter(
            company_id=company_id,
            invoice_date__gte=start,
            invoice_date__lte=end,
        ).values_list("id", flat=True)
    )
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
    return {
        "report_id": "fuel-sales",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "fuel_line_count": n,
        "total_sales": n,
        "invoice_count": len(inv_with_fuel),
        "total_quantity_liters": _f(total_qty),
        "total_amount": _f(total_amt),
        "average_sale_amount": _f(avg),
        "accounting_note": (
            "Fuel lines from invoice line items (liter/gallon unit or fuel category). "
            "Amounts are line extensions, not audited cash — use GL / payments for settlement."
        ),
    }


def report_tank_inventory(company_id: int, start: date, end: date) -> dict[str, Any]:
    _ = start
    out: list[dict[str, Any]] = []
    for tank in (
        Tank.objects.filter(company_id=company_id, is_active=True)
        .select_related("station", "product")
        .order_by("tank_name")
    ):
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
    return {
        "report_id": "tank-inventory",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "inventory": out,
        "alerts": {"low_stock_tanks": low[:20]},
    }


def report_shift_summary(company_id: int, start: date, end: date) -> dict[str, Any]:
    # Include shifts opened in the period and shifts that have invoices in the period (overnight shifts).
    shift_ids_with_sales = (
        Invoice.objects.filter(
            company_id=company_id,
            invoice_date__gte=start,
            invoice_date__lte=end,
            shift_session_id__isnull=False,
        )
        .values_list("shift_session_id", flat=True)
        .distinct()
    )
    qs = ShiftSession.objects.filter(company_id=company_id).filter(
        Q(opened_at__date__gte=start, opened_at__date__lte=end)
        | Q(pk__in=shift_ids_with_sales)
    ).select_related("station")
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

        sessions.append(
            {
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
            }
        )
    bc_out = {
        k: {
            "sessions": v["sessions"],
            "total_sales": _f(v["total_sales"]),
            "total_liters": _f(v["total_liters"]),
            "cash_variance": _f(v["cash_variance"]),
        }
        for k, v in by_cashier.items()
    }
    return {
        "report_id": "shift-summary",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "summary": {
            "total_sessions": len(sessions),
            "total_cash_variance": _f(total_var),
        },
        "sessions": sessions,
        "by_cashier": bc_out,
    }


def report_sales_by_nozzle(company_id: int, start: date, end: date) -> dict[str, Any]:
    inv_lines = (
        InvoiceLine.objects.filter(
            invoice__company_id=company_id,
            invoice__invoice_date__gte=start,
            invoice__invoice_date__lte=end,
        )
        .select_related("item")
        .values("item_id")
        .annotate(
            tx=Count("id"),
            liters=Coalesce(Sum("quantity"), Decimal("0")),
            amt=Coalesce(Sum("amount"), Decimal("0")),
        )
    )
    by_product = {row["item_id"]: row for row in inv_lines if row["item_id"]}

    nozzles = (
        Nozzle.objects.filter(company_id=company_id, is_active=True)
        .select_related("product", "meter__dispenser__island__station")
        .order_by("id")
    )
    out: list[dict[str, Any]] = []
    tot_tx = tot_l = tot_a = Decimal("0")
    for nz in nozzles:
        pid = nz.product_id
        row = by_product.get(pid, {})
        tx = int(row.get("tx") or 0)
        liters = _d(row.get("liters"))
        amt = _d(row.get("amt"))
        tot_tx += tx
        tot_l += liters
        tot_a += amt
        st_name = ""
        if nz.meter_id and nz.meter.dispenser_id:
            isl = nz.meter.dispenser.island
            if isl and isl.station:
                st_name = isl.station.station_name
        avg = (amt / tx) if tx else Decimal("0")
        out.append(
            {
                "nozzle_number": nz.nozzle_code or str(nz.id),
                "nozzle_name": nz.nozzle_name or nz.nozzle_code or str(nz.id),
                "product_name": nz.product.name if nz.product_id else "",
                "station_name": st_name,
                "total_transactions": tx,
                "total_liters": _f(liters),
                "total_amount": _f(amt),
                "average_sale_amount": _f(avg),
            }
        )
    n_nz = len(out) or 1
    return {
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


def report_tank_dip_variance(company_id: int, start: date, end: date) -> dict[str, Any]:
    """
    Gain/loss style report. Payload keys match frontend /reports (reading_date, system_quantity, etc.).
    Book at dip = book_stock_when saved; else fallback to current tank book (legacy rows).
    """
    dips = (
        TankDip.objects.filter(
            company_id=company_id,
            dip_date__gte=start,
            dip_date__lte=end,
        )
        .select_related("tank", "tank__product", "tank__station")
        .order_by("-dip_date", "-id")
    )
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

    return {
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


def report_tank_dip_register(company_id: int, start: date, end: date) -> dict[str, Any]:
    """
    Chronological tank dip register: book-at-dip vs stick reading, variance, optional value estimate.
    Complements tank-dip-variance (which compares stick to current book for analytics).
    """
    dips = (
        TankDip.objects.filter(
            company_id=company_id,
            dip_date__gte=start,
            dip_date__lte=end,
        )
        .select_related("tank", "tank__product", "tank__station")
        .order_by("dip_date", "id")
    )
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

    return {
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


def report_meter_readings(company_id: int, start: date, end: date) -> dict[str, Any]:
    inv_lines = (
        InvoiceLine.objects.filter(
            invoice__company_id=company_id,
            invoice__invoice_date__gte=start,
            invoice__invoice_date__lte=end,
        )
        .select_related("item")
        .values("item_id")
        .annotate(
            tx=Count("id"),
            liters=Coalesce(Sum("quantity"), Decimal("0")),
            amt=Coalesce(Sum("amount"), Decimal("0")),
        )
    )
    by_product = {row["item_id"]: row for row in inv_lines if row["item_id"]}

    meters = (
        Meter.objects.filter(company_id=company_id)
        .select_related("dispenser__island__station")
        .prefetch_related("nozzles", "nozzles__product")
        .order_by("meter_number", "id")
    )
    meters_out: list[dict[str, Any]] = []
    tot_sales = tot_liters = tot_amt = Decimal("0")
    for m in meters:
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
            }
        )
    avg_sale = (tot_amt / tot_sales) if tot_sales else Decimal("0")
    return {
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
        "accounting_note": (
            "Opening reading is derived as current meter reading minus period sales liters (approximation), "
            "not a physical opening stick. Amounts come from invoice lines by product linked to each meter."
        ),
    }


def report_daily_summary(company_id: int, start: date, end: date) -> dict[str, Any]:
    invs = Invoice.objects.filter(
        company_id=company_id,
        invoice_date__gte=start,
        invoice_date__lte=end,
    )
    n_inv = invs.count()
    lines = InvoiceLine.objects.filter(invoice__in=invs).select_related("item")
    total_liters = Decimal("0")
    total_amt = Decimal("0")
    by_product: dict[str, dict[str, Decimal]] = {}
    for line in lines:
        amt = line.amount or Decimal("0")
        total_amt += amt
        if line.item_id:
            key = line.item.name or str(line.item_id)
            if key not in by_product:
                by_product[key] = {
                    "liters": Decimal("0"),
                    "amount": Decimal("0"),
                    "line_count": Decimal("0"),
                }
            by_product[key]["line_count"] += Decimal("1")
            by_product[key]["amount"] += amt
            if _is_fuel_line(line):
                q = line.quantity or Decimal("0")
                by_product[key]["liters"] += q
                total_liters += q
    avg = (total_amt / n_inv) if n_inv else Decimal("0")

    shift_ids_with_sales = (
        Invoice.objects.filter(
            company_id=company_id,
            invoice_date__gte=start,
            invoice_date__lte=end,
            shift_session_id__isnull=False,
        )
        .values_list("shift_session_id", flat=True)
        .distinct()
    )
    dip_qs = TankDip.objects.filter(
        company_id=company_id,
        dip_date__gte=start,
        dip_date__lte=end,
    )
    dip_count = dip_qs.count()
    net_dip_liters = Decimal("0")
    for d in dip_qs.iterator():
        if d.book_stock_before is not None:
            net_dip_liters += _d(d.volume) - _d(d.book_stock_before)

    shift_sessions_qs = (
        ShiftSession.objects.filter(company_id=company_id)
        .filter(
            Q(opened_at__date__gte=start, opened_at__date__lte=end)
            | Q(pk__in=shift_ids_with_sales)
        )
        .distinct()
    )
    cash_var_agg = shift_sessions_qs.filter(closed_at__isnull=False).aggregate(
        sv=Coalesce(Sum("cash_variance"), Decimal("0"))
    )
    total_cash_var = cash_var_agg["sv"] or Decimal("0")

    tanks = Tank.objects.filter(company_id=company_id, is_active=True).select_related(
        "product", "station"
    )
    tank_rows: list[dict[str, Any]] = []
    for t in tanks:
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

    bp_out = {
        k: {
            "liters": _f(v["liters"]),
            "amount": _f(v["amount"]),
            "line_count": int(v["line_count"]),
        }
        for k, v in by_product.items()
    }

    return {
        "report_id": "daily-summary",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "sales": {
            "total_transactions": n_inv,
            "total_liters": _f(total_liters),
            "total_amount": _f(total_amt),
            "average_sale": _f(avg),
            "by_product": bp_out,
        },
        "shifts": {
            "total_shifts": shift_sessions_qs.count(),
            "total_cash_variance": _f(total_cash_var),
        },
        "dips": {
            "total_readings": dip_count,
            "net_variance_liters": _f(net_dip_liters),
            "net_variance": _f(net_dip_liters),
        },
        "tanks": tank_rows,
        "accounting_note": (
            "Sales from invoices in range; liters only on fuel-classified lines. "
            "Meter/nozzle reports allocate by product. Dip net variance is liters (stick − book at dip), not currency."
        ),
    }


def report_inventory_sku_valuation(company_id: int, start: date, end: date) -> dict[str, Any]:
    """
    Per-SKU: on-hand, cost & list extension, period sales, velocity, days of cover.
    Uses Item.cost (fallback per gl_posting) and invoice lines in [start, end] for the selected company.
    """
    period_days = (end - start).days + 1
    if period_days < 1:
        period_days = 1
    period_days_dec = Decimal(str(period_days))

    inv_ids = Invoice.objects.filter(
        company_id=company_id,
        invoice_date__gte=start,
        invoice_date__lte=end,
    ).values_list("id", flat=True)
    inv_id_set = set(inv_ids)
    line_agg: dict[int, dict[str, Decimal]] = {}
    for row in (
        InvoiceLine.objects.filter(
            invoice_id__in=inv_id_set, item_id__isnull=False
        )
        .values("item_id")
        .annotate(
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

    for item in (
        Item.objects.filter(company_id=company_id, is_active=True)
        .order_by("item_number", "name")
    ):
        if not item_tracks_physical_stock(item):
            continue
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

    return {
        "report_id": "inventory-sku-valuation",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
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


def report_item_master_by_category(company_id: int, start: date, end: date) -> dict[str, Any]:
    """
    Full catalog with reporting category, POS class, and stock value — grouped summary + detail rows.
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
        qoh = _d(getattr(it, "quantity_on_hand", None) or 0)
        if qoh < 0:
            qoh = Decimal("0")
        uc = item_inventory_unit_cost(it)
        lp = _d(getattr(it, "unit_price", None) or 0)
        rc = (getattr(it, "category", None) or "").strip() or "General"
        detail.append(
            {
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

    return {
        "report_id": "item-master-by-category",
        "period": {
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "note": "Catalog snapshot (current). Dates label the printout only.",
        },
        "summary": {
            "total_items": len(items),
            "distinct_categories": len(by_cat),
        },
        "by_category": cat_summary,
        "rows": detail,
        "accounting_note": (
            "Every product should have a reporting category on the item form. "
            "Values use live quantity on hand and item cost (with list fallback) for extension."
        ),
    }


def report_item_sales_by_category(company_id: int, start: date, end: date) -> dict[str, Any]:
    """
    Invoiced quantity and revenue by item reporting category (invoice lines with catalog items only).
    """
    base = InvoiceLine.objects.filter(
        invoice__company_id=company_id,
        invoice__invoice_date__gte=start,
        invoice__invoice_date__lte=end,
        item_id__isnull=False,
    )
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
    return {
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


def report_item_sales_custom(
    company_id: int,
    start: date,
    end: date,
    category: str | None = None,
    item_id: int | None = None,
    item_ids: list[int] | None = None,
) -> dict[str, Any]:
    """
    Period sales by SKU with optional reporting category and/or product filter.
    ``item_ids`` (one or more) restricts to those products; if set, rows include
    selected items even when period sales are zero. ``item_id`` is legacy single-id.
    """
    base = InvoiceLine.objects.filter(
        invoice__company_id=company_id,
        invoice__invoice_date__gte=start,
        invoice__invoice_date__lte=end,
        item_id__isnull=False,
    )
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
    return {
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
) -> dict[str, Any]:
    """
    Purchase quantities (vendor bills) vs sales (invoices) in the period, by item.
    """
    inv_base = InvoiceLine.objects.filter(
        invoice__company_id=company_id,
        invoice__invoice_date__gte=start,
        invoice__invoice_date__lte=end,
        item_id__isnull=False,
    )
    bill_base = BillLine.objects.filter(
        bill__company_id=company_id,
        bill__bill_date__gte=start,
        bill__bill_date__lte=end,
        item_id__isnull=False,
    )
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
    return {
        "report_id": "item-stock-movement",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "summary": {
            "line_count": len(rows_out),
            "total_qty_purchased": _f(sum((v["q"] for v in purch_m.values()), start=Decimal("0"))),
            "total_qty_sold": _f(sum((v["q"] for v in sales_m.values()), start=Decimal("0"))),
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


def report_item_velocity_analysis(
    company_id: int,
    start: date,
    end: date,
    category: str | None = None,
    item_ids: list[int] | None = None,
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
        return {
            "report_id": "item-velocity-analysis",
            "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
            "summary": {"line_count": 0, "fast": 0, "medium": 0, "slow": 0, "no_period_sales": 0},
            "filters": {"category": category or "", "item_ids": list(item_ids) if item_ids else None},
            "rows": [],
            "accounting_note": "No active items match the filter.",
        }

    rows: list[dict[str, Any]] = []
    for it in scope:
        iid = int(it.id)
        pq = qty_by.get(iid) or Decimal("0")
        pa = rev_by.get(iid) or Decimal("0")
        qoh = _d(getattr(it, "quantity_on_hand", None) or 0)
        if qoh < 0:
            qoh = Decimal("0")
        daily = (pq / pdd) if pdd else Decimal("0")
        rows.append(
            {
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
    return {
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
