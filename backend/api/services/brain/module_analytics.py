"""Per-module ERP summaries for Company Brain — every major FSERP area in one snapshot."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, Callable

from django.db.models import Count, Q, Sum
from django.utils import timezone

from api.models import (
    AquacultureBiomassSample,
    AquacultureExpense,
    AquacultureFeedingAdvice,
    AquacultureFishPondTransfer,
    AquacultureFishSale,
    AquacultureLandlord,
    AquaculturePond,
    AquacultureProductionCycle,
    Bill,
    ChartOfAccount,
    Customer,
    Dispenser,
    Employee,
    FixedAsset,
    FundTransfer,
    InventoryTransfer,
    Invoice,
    Island,
    Item,
    ItemPondStock,
    ItemStationStock,
    JournalEntry,
    Loan,
    Meter,
    Nozzle,
    Payment,
    PayrollRun,
    PondWarehouseInterPondTransfer,
    PondWarehouseStockReceipt,
    ShiftSession,
    Station,
    Tank,
    TankDip,
    Tax,
    TenantReportingCategory,
    Vendor,
)
from api.services.aquaculture_pond_display import pond_operational_display_name
from api.services.brain.module_registry import SIDEBAR_MODULES


def _money(val) -> str:
    try:
        return f"{Decimal(str(val or 0)):,.2f}"
    except Exception:
        return "0.00"


def _d(val) -> Decimal:
    try:
        return Decimal(str(val or 0))
    except Exception:
        return Decimal("0")


def _customer_label(c: Customer) -> str:
    return (c.display_name or c.company_name or c.first_name or c.customer_number or f"Customer #{c.id}").strip()


def _vendor_label(v: Vendor) -> str:
    return (v.display_name or v.company_name or v.vendor_number or f"Vendor #{v.id}").strip()


MODULE_INDEX: list[dict[str, str]] = [
    {**m, "module": m["key"]} for m in SIDEBAR_MODULES
]


def _sales_customers_ar(company_id: int, *, month_start: date, today: date) -> dict[str, Any]:
    open_status = ("sent", "partial", "overdue")
    overdue_qs = (
        Invoice.objects.filter(company_id=company_id, status__in=open_status)
        .exclude(status="draft")
        .filter(Q(status="overdue") | Q(due_date__lt=today, due_date__isnull=False))
        .select_related("customer")
        .order_by("due_date", "-total")[:12]
    )
    top_customers = (
        Invoice.objects.filter(
            company_id=company_id,
            invoice_date__gte=month_start,
            invoice_date__lte=today,
        )
        .exclude(status__in=("draft", "void"))
        .values("customer_id", "customer__display_name", "customer__company_name", "customer__first_name")
        .annotate(mtd_sales=Sum("total"), invoice_count=Count("id"))
        .order_by("-mtd_sales")[:8]
    )
    ar_balance = Customer.objects.filter(company_id=company_id, is_active=True).aggregate(
        total=Sum("current_balance")
    )["total"]
    return {
        "active_customers": Customer.objects.filter(company_id=company_id, is_active=True).count(),
        "ar_balance_total_bdt": _money(ar_balance),
        "open_invoices_count": Invoice.objects.filter(company_id=company_id, status__in=open_status).count(),
        "overdue_invoices": [
            {
                "id": inv.id,
                "number": inv.invoice_number,
                "customer": _customer_label(inv.customer) if inv.customer_id else "",
                "due_date": inv.due_date.isoformat() if inv.due_date else None,
                "total_bdt": _money(inv.total),
                "status": inv.status,
            }
            for inv in overdue_qs
        ],
        "top_customers_mtd": [
            {
                "customer_id": row["customer_id"],
                "name": (
                    row["customer__display_name"]
                    or row["customer__company_name"]
                    or row["customer__first_name"]
                    or ""
                ),
                "mtd_sales_bdt": _money(row["mtd_sales"]),
                "invoice_count": row["invoice_count"],
            }
            for row in top_customers
        ],
    }


def _purchases_vendors_ap(company_id: int, *, month_start: date, today: date) -> dict[str, Any]:
    open_bills = (
        Bill.objects.filter(company_id=company_id)
        .exclude(status__in=("draft", "void", "paid"))
        .select_related("vendor")
        .order_by("due_date", "-total")[:12]
    )
    top_vendors = (
        Bill.objects.filter(company_id=company_id, bill_date__gte=month_start, bill_date__lte=today)
        .exclude(status="draft")
        .values("vendor_id", "vendor__display_name", "vendor__company_name")
        .annotate(mtd_purchases=Sum("total"), bill_count=Count("id"))
        .order_by("-mtd_purchases")[:8]
    )
    ap_balance = Vendor.objects.filter(company_id=company_id, is_active=True).aggregate(
        total=Sum("current_balance")
    )["total"]
    return {
        "active_vendors": Vendor.objects.filter(company_id=company_id, is_active=True).count(),
        "ap_balance_total_bdt": _money(ap_balance),
        "open_bills_count": Bill.objects.filter(company_id=company_id).exclude(
            status__in=("draft", "void", "paid")
        ).count(),
        "open_bills": [
            {
                "id": b.id,
                "number": b.bill_number,
                "vendor": _vendor_label(b.vendor) if b.vendor_id else "",
                "due_date": b.due_date.isoformat() if b.due_date else None,
                "total_bdt": _money(b.total),
                "status": b.status,
            }
            for b in open_bills
        ],
        "top_vendors_mtd": [
            {
                "vendor_id": row["vendor_id"],
                "name": row["vendor__display_name"] or row["vendor__company_name"] or "",
                "mtd_purchases_bdt": _money(row["mtd_purchases"]),
                "bill_count": row["bill_count"],
            }
            for row in top_vendors
        ],
    }


def _payments_cash(company_id: int, *, month_start: date, today: date) -> dict[str, Any]:
    base = Payment.objects.filter(
        company_id=company_id,
        payment_date__gte=month_start,
        payment_date__lte=today,
    )
    received = base.filter(payment_type=Payment.PAYMENT_TYPE_RECEIVED).aggregate(
        total=Sum("amount"), count=Count("id")
    )
    made = base.filter(payment_type=Payment.PAYMENT_TYPE_MADE).aggregate(total=Sum("amount"), count=Count("id"))
    deposit = base.filter(payment_type=Payment.PAYMENT_TYPE_DEPOSIT).aggregate(
        total=Sum("amount"), count=Count("id")
    )
    recent = list(
        base.select_related("customer", "vendor", "station")
        .order_by("-payment_date", "-id")[:10]
    )
    return {
        "mtd_received_bdt": _money(received["total"]),
        "mtd_received_count": received["count"] or 0,
        "mtd_paid_out_bdt": _money(made["total"]),
        "mtd_paid_out_count": made["count"] or 0,
        "mtd_deposits_bdt": _money(deposit["total"]),
        "recent_payments": [
            {
                "id": p.id,
                "type": p.payment_type,
                "date": p.payment_date.isoformat() if p.payment_date else None,
                "amount_bdt": _money(p.amount),
                "party": (
                    _customer_label(p.customer)
                    if p.customer_id
                    else (_vendor_label(p.vendor) if p.vendor_id else "")
                ),
                "method": p.payment_method or "",
                "station": p.station.station_name if p.station_id else None,
            }
            for p in recent
        ],
    }


def _inventory_stock(company_id: int, *, month_start: date, today: date) -> dict[str, Any]:
    items_qs = Item.objects.filter(company_id=company_id, is_active=True, item_type="inventory")
    ordered = list(items_qs.order_by("quantity_on_hand", "name")[:30])
    zero_or_negative = [it for it in ordered if _d(it.quantity_on_hand) <= 0]
    low_items = zero_or_negative[:10] if zero_or_negative else ordered[:8]
    low_stock = [
        {
            "item_id": it.id,
            "item_number": it.item_number,
            "name": it.name,
            "quantity_on_hand": str(it.quantity_on_hand),
            "unit": it.unit or "",
        }
        for it in low_items
    ]

    station_stock_rows = (
        ItemStationStock.objects.filter(company_id=company_id, quantity__gt=0)
        .select_related("item", "station")
        .order_by("-quantity")[:8]
    )
    pond_stock_rows = (
        ItemPondStock.objects.filter(company_id=company_id, quantity__gt=0)
        .select_related("item", "pond")
        .order_by("-quantity")[:8]
    )
    return {
        "active_items": Item.objects.filter(company_id=company_id, is_active=True).count(),
        "inventory_items": items_qs.count(),
        "low_stock_items": low_stock,
        "top_station_stock": [
            {
                "station": row.station.station_name if row.station_id else "",
                "item": row.item.name if row.item_id else "",
                "quantity": str(row.quantity),
            }
            for row in station_stock_rows
        ],
        "top_pond_stock": [
            {
                "pond": pond_operational_display_name(row.pond) if row.pond_id else "",
                "item": row.item.name if row.item_id else "",
                "quantity": str(row.quantity),
            }
            for row in pond_stock_rows
        ],
    }


def _fuel_forecourt(company_id: int, *, month_start: date, today: date) -> dict[str, Any]:
    tanks = list(
        Tank.objects.filter(company_id=company_id, is_active=True)
        .select_related("station", "product")
        .order_by("station__station_name", "tank_name")[:20]
    )
    low_tanks = [
        {
            "tank_id": t.id,
            "name": t.tank_name,
            "station": t.station.station_name if t.station_id else "",
            "product": t.product.name if t.product_id else "",
            "current_stock": str(t.current_stock),
            "reorder_level": str(t.reorder_level),
            "capacity": str(t.capacity),
            "unit": t.unit_of_measure,
        }
        for t in tanks
        if _d(t.reorder_level) > 0 and _d(t.current_stock) <= _d(t.reorder_level)
    ][:8]
    recent_shifts = list(
        ShiftSession.objects.filter(company_id=company_id, opened_at__date__gte=month_start)
        .select_related("station")
        .order_by("-opened_at")[:6]
    )
    recent_dips = list(
        TankDip.objects.filter(company_id=company_id, dip_date__gte=month_start)
        .select_related("tank")
        .order_by("-dip_date", "-id")[:6]
    )
    return {
        "active_tanks": Tank.objects.filter(company_id=company_id, is_active=True).count(),
        "active_nozzles": Nozzle.objects.filter(company_id=company_id, is_active=True).count(),
        "tanks_low_stock": low_tanks,
        "recent_shift_sessions": [
            {
                "id": s.id,
                "station": s.station.station_name if s.station_id else "",
                "opened_at": s.opened_at.isoformat() if s.opened_at else None,
                "closed_at": s.closed_at.isoformat() if s.closed_at else None,
                "total_sales_bdt": _money(s.total_sales_amount),
                "sale_count": s.sale_transaction_count,
                "cash_variance_bdt": _money(s.cash_variance),
            }
            for s in recent_shifts
        ],
        "recent_tank_dips": [
            {
                "id": d.id,
                "tank": d.tank.tank_name if d.tank_id else "",
                "date": d.dip_date.isoformat() if d.dip_date else None,
                "volume": str(d.volume),
                "book_stock_before": str(d.book_stock_before or ""),
            }
            for d in recent_dips
        ],
    }


def _accounting_gl(company_id: int, *, month_start: date, today: date) -> dict[str, Any]:
    je_mtd = JournalEntry.objects.filter(
        company_id=company_id,
        entry_date__gte=month_start,
        entry_date__lte=today,
    )
    transfers = list(
        FundTransfer.objects.filter(company_id=company_id, transfer_date__gte=month_start)
        .order_by("-transfer_date", "-id")[:6]
    )
    recent_je = list(je_mtd.order_by("-entry_date", "-id")[:6])
    return {
        "journal_entries_mtd": je_mtd.count(),
        "fund_transfers_mtd": FundTransfer.objects.filter(
            company_id=company_id, transfer_date__gte=month_start, transfer_date__lte=today
        ).count(),
        "recent_journal_entries": [
            {
                "id": je.id,
                "number": je.entry_number,
                "date": je.entry_date.isoformat() if je.entry_date else None,
                "description": (je.description or "")[:120],
                "is_posted": je.is_posted,
            }
            for je in recent_je
        ],
        "recent_fund_transfers": [
            {
                "id": ft.id,
                "date": ft.transfer_date.isoformat() if ft.transfer_date else None,
                "amount_bdt": _money(ft.amount),
                "reference": (ft.reference or "")[:80],
            }
            for ft in transfers
        ],
    }


def _loans_financing(company_id: int, *, month_start: date, today: date) -> dict[str, Any]:
    active = list(
        Loan.objects.filter(company_id=company_id, status="active")
        .select_related("counterparty")
        .order_by("-outstanding_principal")[:10]
    )
    borrowed_out = sum(_d(l.outstanding_principal) for l in active if l.direction == Loan.DIRECTION_BORROWED)
    lent_out = sum(_d(l.outstanding_principal) for l in active if l.direction == Loan.DIRECTION_LENT)
    return {
        "active_loans_count": len(active),
        "outstanding_borrowed_bdt": _money(borrowed_out),
        "outstanding_lent_bdt": _money(lent_out),
        "active_loans": [
            {
                "id": loan.id,
                "loan_no": loan.loan_no,
                "title": loan.title or "",
                "direction": loan.direction,
                "counterparty": loan.counterparty.name if loan.counterparty_id else "",
                "outstanding_principal_bdt": _money(loan.outstanding_principal),
                "sanction_bdt": _money(loan.sanction_amount),
                "maturity_date": loan.maturity_date.isoformat() if loan.maturity_date else None,
                "aquaculture_financing": loan.aquaculture_financing,
            }
            for loan in active
        ],
    }


def _hr_payroll_summary(company_id: int, *, month_start: date, today: date) -> dict[str, Any]:
    emps = Employee.objects.filter(company_id=company_id, is_active=True)
    payroll_total = emps.aggregate(total=Sum("salary"))["total"]
    by_station = (
        emps.filter(home_station_id__isnull=False)
        .values("home_station__station_name")
        .annotate(headcount=Count("id"), payroll=Sum("salary"))
        .order_by("-headcount")[:8]
    )
    return {
        "active_employees": emps.count(),
        "monthly_payroll_commitment_bdt": _money(payroll_total),
        "by_home_station": [
            {
                "station": row["home_station__station_name"] or "",
                "headcount": row["headcount"],
                "monthly_salary_bdt": _money(row["payroll"]),
            }
            for row in by_station
        ],
    }


def _aquaculture_ops(company_id: int, *, month_start: date, today: date) -> dict[str, Any]:
    expense_by_cat = (
        AquacultureExpense.objects.filter(
            company_id=company_id,
            expense_date__gte=month_start,
            expense_date__lte=today,
        )
        .values("expense_category")
        .annotate(total=Sum("amount"), count=Count("id"))
        .order_by("-total")[:8]
    )
    fish_sales_mtd = AquacultureFishSale.objects.filter(
        company_id=company_id,
        sale_date__gte=month_start,
        sale_date__lte=today,
    ).aggregate(total=Sum("total_amount"), weight_kg=Sum("weight_kg"), count=Count("id"))
    feeding_recent = list(
        AquacultureFeedingAdvice.objects.filter(company_id=company_id)
        .select_related("pond")
        .order_by("-target_date", "-id")[:6]
    )
    return {
        "active_ponds": AquaculturePond.objects.filter(company_id=company_id, is_active=True).count(),
        "active_cycles": AquacultureProductionCycle.objects.filter(
            company_id=company_id, is_active=True, end_date__isnull=True
        ).count(),
        "landlords": AquacultureLandlord.objects.filter(company_id=company_id, is_active=True).count(),
        "stock_receipts_mtd": PondWarehouseStockReceipt.objects.filter(
            company_id=company_id, created_at__date__gte=month_start
        ).count(),
        "inter_pond_transfers_mtd": PondWarehouseInterPondTransfer.objects.filter(
            company_id=company_id, created_at__date__gte=month_start
        ).count(),
        "expenses_mtd_by_category": [
            {
                "category": row["expense_category"] or "other",
                "total_bdt": _money(row["total"]),
                "count": row["count"],
            }
            for row in expense_by_cat
        ],
        "fish_sales_mtd": {
            "count": fish_sales_mtd["count"] or 0,
            "total_bdt": _money(fish_sales_mtd["total"]),
            "weight_kg": str(fish_sales_mtd["weight_kg"] or 0),
        },
        "recent_feeding_advice": [
            {
                "id": fa.id,
                "pond": pond_operational_display_name(fa.pond) if fa.pond_id else "",
                "target_date": fa.target_date.isoformat() if fa.target_date else None,
                "status": fa.status or "",
                "suggested_feed_kg": str(fa.suggested_feed_kg or ""),
            }
            for fa in feeding_recent
        ],
    }


def _fixed_assets_summary(company_id: int, *, month_start: date, today: date) -> dict[str, Any]:
    assets = FixedAsset.objects.filter(company_id=company_id)
    active = assets.filter(status=FixedAsset.STATUS_ACTIVE)
    return {
        "total_assets": assets.count(),
        "active_assets": active.count(),
        "active_acquisition_cost_bdt": _money(
            active.aggregate(total=Sum("acquisition_cost"))["total"]
        ),
        "recent_assets": [
            {
                "id": a.id,
                "asset_number": a.asset_number,
                "name": a.name,
                "status": a.status,
                "acquisition_cost_bdt": _money(a.acquisition_cost),
                "in_service_date": a.in_service_date.isoformat() if a.in_service_date else None,
            }
            for a in assets.order_by("-id")[:6]
        ],
    }


def _station_equipment(company_id: int, *, month_start: date, today: date) -> dict[str, Any]:
    return {
        "islands": Island.objects.filter(company_id=company_id, is_active=True).count(),
        "dispensers": Dispenser.objects.filter(company_id=company_id, is_active=True).count(),
        "meters": Meter.objects.filter(company_id=company_id, is_active=True).count(),
        "nozzles": Nozzle.objects.filter(company_id=company_id, is_active=True).count(),
    }


def _operations_summary(company_id: int, *, month_start: date, today: date) -> dict[str, Any]:
    open_shifts = ShiftSession.objects.filter(company_id=company_id, closed_at__isnull=True).count()
    dips_mtd = TankDip.objects.filter(company_id=company_id, dip_date__gte=month_start).count()
    inv_xfer_mtd = InventoryTransfer.objects.filter(
        company_id=company_id, transfer_date__gte=month_start
    ).count()
    return {
        "open_shift_sessions": open_shifts,
        "tank_dips_mtd": dips_mtd,
        "inventory_transfers_mtd": inv_xfer_mtd,
    }


def _chart_of_accounts_summary(company_id: int, *, month_start: date, today: date) -> dict[str, Any]:
    qs = ChartOfAccount.objects.filter(company_id=company_id, is_active=True)
    by_type = qs.values("account_type").annotate(count=Count("id")).order_by("-count")[:8]
    return {
        "active_accounts": qs.count(),
        "by_type": [{"type": r["account_type"], "count": r["count"]} for r in by_type],
    }


def _management_settings(company_id: int, *, month_start: date, today: date) -> dict[str, Any]:
    taxes = list(Tax.objects.filter(company_id=company_id, is_active=True).order_by("name")[:12])
    categories = TenantReportingCategory.objects.filter(company_id=company_id, is_active=True).count()
    return {
        "active_taxes": len(taxes),
        "taxes": [{"id": t.id, "name": t.name} for t in taxes],
        "reporting_categories": categories,
    }


def _payroll_runs_summary(company_id: int, *, month_start: date, today: date) -> dict[str, Any]:
    recent = list(
        PayrollRun.objects.filter(company_id=company_id)
        .order_by("-payment_date", "-id")[:8]
    )
    mtd = PayrollRun.objects.filter(
        company_id=company_id, payment_date__gte=month_start, payment_date__lte=today
    ).aggregate(gross=Sum("total_gross"), net=Sum("total_net"), count=Count("id"))
    return {
        "runs_mtd": mtd["count"] or 0,
        "gross_mtd_bdt": _money(mtd["gross"]),
        "net_mtd_bdt": _money(mtd["net"]),
        "recent_runs": [
            {
                "id": pr.id,
                "number": pr.payroll_number,
                "payment_date": pr.payment_date.isoformat() if pr.payment_date else None,
                "net_bdt": _money(pr.total_net),
                "status": pr.status,
            }
            for pr in recent
        ],
    }


def _aquaculture_extended(company_id: int, *, month_start: date, today: date) -> dict[str, Any]:
    landlords = list(
        AquacultureLandlord.objects.filter(company_id=company_id, is_active=True).order_by("name")[:10]
    )
    cycles = AquacultureProductionCycle.objects.filter(
        company_id=company_id, is_active=True, end_date__isnull=True
    ).count()
    fish_xfers_mtd = AquacultureFishPondTransfer.objects.filter(
        company_id=company_id, transfer_date__gte=month_start
    ).count()
    samples_mtd = AquacultureBiomassSample.objects.filter(
        company_id=company_id, sample_date__gte=month_start
    ).count()
    return {
        "active_landlords": len(landlords),
        "landlords": [{"id": ll.id, "name": ll.name, "phone": ll.phone or ""} for ll in landlords],
        "open_production_cycles": cycles,
        "fish_transfers_mtd": fish_xfers_mtd,
        "biomass_samples_mtd": samples_mtd,
    }


def _stations_sites(company_id: int, *, month_start: date, today: date) -> dict[str, Any]:
    stations = list(
        Station.objects.filter(company_id=company_id, is_active=True).order_by("station_name", "id")[:20]
    )
    return {
        "active_stations": len(stations),
        "stations": [
            {
                "id": st.id,
                "name": st.station_name,
                "number": st.station_number,
                "city": st.city or "",
            }
            for st in stations
        ],
    }


_BUILDERS: list[tuple[str, Callable[..., dict[str, Any]]]] = [
    ("sales_customers_ar", _sales_customers_ar),
    ("purchases_vendors_ap", _purchases_vendors_ap),
    ("payments_cash", _payments_cash),
    ("inventory_stock", _inventory_stock),
    ("fuel_forecourt", _fuel_forecourt),
    ("station_equipment", _station_equipment),
    ("operations_summary", _operations_summary),
    ("chart_of_accounts", _chart_of_accounts_summary),
    ("accounting_gl", _accounting_gl),
    ("loans_financing", _loans_financing),
    ("hr_payroll", _hr_payroll_summary),
    ("payroll_runs", _payroll_runs_summary),
    ("aquaculture_ops", _aquaculture_ops),
    ("aquaculture_extended", _aquaculture_extended),
    ("fixed_assets", _fixed_assets_summary),
    ("management_settings", _management_settings),
    ("stations_sites", _stations_sites),
]


def build_erp_module_summaries(
    company_id: int,
    *,
    month_start: date | None = None,
    today: date | None = None,
    lang: str = "bn",
) -> dict[str, Any]:
    """Aggregate every major ERP module — each block is independent and failure-safe."""
    today = today or timezone.localdate()
    month_start = month_start or today.replace(day=1)
    out: dict[str, Any] = {
        "generated_at": timezone.now().isoformat(),
        "period": {"start": month_start.isoformat(), "end": today.isoformat()},
        "module_index": MODULE_INDEX,
        "human_analysis_note_bn": (
            "প্রতিটি মডিউলের সংখ্যা, ব্যালেন্স, সাম্প্রতিক লেনদেন ও সতর্কতা একসাথে — "
            "মালিকের প্রশ্নের উত্তর মানুষের মতো সংশ্লেষ করুন (শুধু একটি রিপোর্ট নয়)।"
        ),
    }
    for key, fn in _BUILDERS:
        try:
            out[key] = fn(company_id, month_start=month_start, today=today)
        except Exception as exc:
            out[key] = {"unavailable": True, "error": str(exc)[:160]}
    return out
