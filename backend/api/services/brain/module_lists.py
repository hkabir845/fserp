"""Fetch full record lists for Brain — every sidebar module the owner can ask about."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from django.db.models import Sum
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
    JournalEntry,
    Loan,
    Meter,
    Nozzle,
    Payment,
    PayrollRun,
    ShiftSession,
    Station,
    Tank,
    TankDip,
    Tax,
    TenantReportingCategory,
    Vendor,
)
from api.services.aquaculture_medicine_catalog_seed import MEDICINE_CATALOG_ITEM_PREFIX
from api.services.aquaculture_pond_display import pond_operational_display_name
from api.services.brain.analytics import find_employees
from api.services.brain.module_registry import SIDEBAR_MODULES


def _money(val) -> str:
    try:
        return f"{Decimal(str(val or 0)):,.2f}"
    except Exception:
        return "0.00"


MODULE_LIST_TITLES: dict[str, str] = {
    "employees": "কর্মচারী তালিকা",
    "customers": "গ্রাহক তালিকা",
    "vendors": "সরবরাহকারী তালিকা",
    "invoices": "ইনভয়েস তালিকা",
    "bills": "বিল তালিকা",
    "payments": "পেমেন্ট তালিকা",
    "items": "পণ্য ও সেবা তালিকা",
    "stations": "স্টেশন তালিকা",
    "tanks": "ট্যাংক তালিকা",
    "nozzles": "নজল তালিকা",
    "islands": "আইল্যান্ড তালিকা",
    "dispensers": "ডিসপেনসার তালিকা",
    "meters": "মিটার তালিকা",
    "tank_dips": "ট্যাংক ডিপ তালিকা",
    "shift_management": "শিফট সেশন তালিকা",
    "chart_of_accounts": "চার্ট অফ অ্যাকাউন্ট",
    "journal_entries": "জার্নাল এন্ট্রি তালিকা",
    "fund_transfers": "ফান্ড ট্রান্সফার তালিকা",
    "loans": "ঋণ তালিকা",
    "fixed_assets": "স্থায়ী সম্পদ তালিকা",
    "payroll": "পে-রোল রান তালিকা",
    "tax": "ট্যাক্স তালিকা",
    "inventory_transfers": "ইনভেন্টরি ট্রান্সফার তালিকা",
    "ponds": "পোন্ড তালিকা",
    "landlords": "জমিদার তালিকা",
    "production_cycles": "স্টকিং ব্যাচ তালিকা",
    "fish_transfers": "মাছ স্থানান্তর তালিকা",
    "biomass_sampling": "বায়োমাস স্যাম্পল তালিকা",
    "feeding_advice": "ফিডিং পরামর্শ তালিকা",
    "fish_sales": "পোন্ড মাছ বিক্রি তালিকা",
    "pond_expenses": "পোন্ড খরচ তালিকা",
    "pond_stock": "পোন্ড স্টক তালিকা",
    "aquaculture_medicine": "ঔষধ ও চিকিৎসা তালিকা",
    "aquaculture_financing": "মৎস্য ফাইন্যান্সিং তালিকা",
    "reporting_categories": "রিপোর্টিং ক্যাটাগরি তালিকা",
}


def _customer_label(c: Customer) -> str:
    return (c.display_name or c.company_name or c.first_name or c.customer_number or f"#{c.id}").strip()


def _vendor_label(v: Vendor) -> str:
    return (v.display_name or v.company_name or v.vendor_number or f"#{v.id}").strip()


def fetch_module_list(
    company_id: int,
    module_key: str,
    *,
    limit: int = 200,
    month_start: date | None = None,
    today: date | None = None,
) -> dict[str, Any]:
    """Return {module, title_bn, count, rows, path} for direct Brain answers."""
    today = today or timezone.localdate()
    month_start = month_start or today.replace(day=1)
    path = next((m["path"] for m in SIDEBAR_MODULES if m["key"] == module_key), "")
    title = MODULE_LIST_TITLES.get(module_key, module_key)
    rows: list[dict[str, Any]] = []

    if module_key == "employees":
        rows = find_employees(company_id, "", limit=limit)
    elif module_key == "customers":
        for c in Customer.objects.filter(company_id=company_id, is_active=True).order_by("display_name", "id")[:limit]:
            rows.append(
                {
                    "id": c.id,
                    "name": _customer_label(c),
                    "phone": c.phone or "",
                    "balance_bdt": _money(c.current_balance),
                }
            )
    elif module_key == "vendors":
        for v in Vendor.objects.filter(company_id=company_id, is_active=True).order_by("company_name", "id")[:limit]:
            rows.append(
                {
                    "id": v.id,
                    "name": _vendor_label(v),
                    "phone": v.phone or "",
                    "balance_bdt": _money(v.current_balance),
                }
            )
    elif module_key == "invoices":
        for inv in (
            Invoice.objects.filter(company_id=company_id)
            .exclude(status__in=("draft", "void"))
            .select_related("customer", "station")
            .order_by("-invoice_date", "-id")[:limit]
        ):
            rows.append(
                {
                    "id": inv.id,
                    "number": inv.invoice_number,
                    "date": inv.invoice_date.isoformat() if inv.invoice_date else "",
                    "customer": _customer_label(inv.customer) if inv.customer_id else "",
                    "total_bdt": _money(inv.total),
                    "status": inv.status,
                    "station": inv.station.station_name if inv.station_id else "",
                }
            )
    elif module_key == "bills":
        for b in (
            Bill.objects.filter(company_id=company_id)
            .exclude(status="draft")
            .select_related("vendor")
            .order_by("-bill_date", "-id")[:limit]
        ):
            rows.append(
                {
                    "id": b.id,
                    "number": b.bill_number,
                    "date": b.bill_date.isoformat() if b.bill_date else "",
                    "vendor": _vendor_label(b.vendor) if b.vendor_id else "",
                    "total_bdt": _money(b.total),
                    "status": b.status,
                }
            )
    elif module_key == "payments":
        for p in (
            Payment.objects.filter(company_id=company_id)
            .select_related("customer", "vendor")
            .order_by("-payment_date", "-id")[:limit]
        ):
            party = (
                _customer_label(p.customer)
                if p.customer_id
                else (_vendor_label(p.vendor) if p.vendor_id else "")
            )
            rows.append(
                {
                    "id": p.id,
                    "type": p.payment_type,
                    "date": p.payment_date.isoformat() if p.payment_date else "",
                    "party": party,
                    "amount_bdt": _money(p.amount),
                    "method": p.payment_method or "",
                }
            )
    elif module_key == "items":
        for it in Item.objects.filter(company_id=company_id, is_active=True).order_by("name", "id")[:limit]:
            rows.append(
                {
                    "id": it.id,
                    "item_number": it.item_number,
                    "name": it.name,
                    "quantity_on_hand": str(it.quantity_on_hand),
                    "unit": it.unit or "",
                    "item_type": it.item_type or "",
                }
            )
    elif module_key == "stations":
        for st in Station.objects.filter(company_id=company_id, is_active=True).order_by("station_name", "id")[:limit]:
            rows.append(
                {
                    "id": st.id,
                    "name": st.station_name,
                    "number": st.station_number,
                    "city": st.city or "",
                }
            )
    elif module_key == "tanks":
        for t in (
            Tank.objects.filter(company_id=company_id, is_active=True)
            .select_related("station", "product")
            .order_by("station__station_name", "tank_name")[:limit]
        ):
            rows.append(
                {
                    "id": t.id,
                    "name": t.tank_name,
                    "station": t.station.station_name if t.station_id else "",
                    "product": t.product.name if t.product_id else "",
                    "current_stock": str(t.current_stock),
                    "unit": t.unit_of_measure,
                }
            )
    elif module_key == "nozzles":
        for n in (
            Nozzle.objects.filter(company_id=company_id, is_active=True)
            .select_related("tank", "product")
            .order_by("nozzle_number", "id")[:limit]
        ):
            rows.append(
                {
                    "id": n.id,
                    "number": n.nozzle_number or n.nozzle_code,
                    "name": n.nozzle_name or "",
                    "tank": n.tank.tank_name if n.tank_id else "",
                    "product": n.product.name if n.product_id else "",
                }
            )
    elif module_key == "islands":
        for isl in (
            Island.objects.filter(company_id=company_id, is_active=True)
            .select_related("station")
            .order_by("station__station_name", "island_name")[:limit]
        ):
            rows.append(
                {
                    "id": isl.id,
                    "name": isl.island_name,
                    "station": isl.station.station_name if isl.station_id else "",
                }
            )
    elif module_key == "dispensers":
        for d in (
            Dispenser.objects.filter(company_id=company_id, is_active=True)
            .select_related("island", "island__station")
            .order_by("dispenser_name", "id")[:limit]
        ):
            rows.append(
                {
                    "id": d.id,
                    "name": d.dispenser_name,
                    "island": d.island.island_name if d.island_id else "",
                    "station": d.island.station.station_name if d.island_id and d.island.station_id else "",
                }
            )
    elif module_key == "meters":
        for m in (
            Meter.objects.filter(company_id=company_id, is_active=True)
            .select_related("dispenser")
            .order_by("meter_number", "id")[:limit]
        ):
            rows.append(
                {
                    "id": m.id,
                    "number": m.meter_number or m.meter_code,
                    "name": m.meter_name or "",
                    "reading": str(m.current_reading),
                }
            )
    elif module_key == "tank_dips":
        for d in (
            TankDip.objects.filter(company_id=company_id)
            .select_related("tank")
            .order_by("-dip_date", "-id")[:limit]
        ):
            rows.append(
                {
                    "id": d.id,
                    "tank": d.tank.tank_name if d.tank_id else "",
                    "date": d.dip_date.isoformat() if d.dip_date else "",
                    "volume": str(d.volume),
                }
            )
    elif module_key == "shift_management":
        for s in (
            ShiftSession.objects.filter(company_id=company_id)
            .select_related("station")
            .order_by("-opened_at")[:limit]
        ):
            rows.append(
                {
                    "id": s.id,
                    "station": s.station.station_name if s.station_id else "",
                    "opened_at": s.opened_at.isoformat() if s.opened_at else "",
                    "sales_bdt": _money(s.total_sales_amount),
                    "transactions": s.sale_transaction_count,
                }
            )
    elif module_key == "chart_of_accounts":
        for a in ChartOfAccount.objects.filter(company_id=company_id, is_active=True).order_by("account_code")[:limit]:
            rows.append(
                {
                    "id": a.id,
                    "code": a.account_code,
                    "name": a.account_name,
                    "type": a.account_type,
                }
            )
    elif module_key == "journal_entries":
        for je in JournalEntry.objects.filter(company_id=company_id).order_by("-entry_date", "-id")[:limit]:
            rows.append(
                {
                    "id": je.id,
                    "number": je.entry_number,
                    "date": je.entry_date.isoformat() if je.entry_date else "",
                    "description": (je.description or "")[:80],
                    "posted": je.is_posted,
                }
            )
    elif module_key == "fund_transfers":
        for ft in FundTransfer.objects.filter(company_id=company_id).order_by("-transfer_date", "-id")[:limit]:
            rows.append(
                {
                    "id": ft.id,
                    "date": ft.transfer_date.isoformat() if ft.transfer_date else "",
                    "amount_bdt": _money(ft.amount),
                    "reference": ft.reference or "",
                }
            )
    elif module_key == "loans":
        for loan in (
            Loan.objects.filter(company_id=company_id, status="active")
            .select_related("counterparty")
            .order_by("-outstanding_principal")[:limit]
        ):
            rows.append(
                {
                    "id": loan.id,
                    "loan_no": loan.loan_no,
                    "title": loan.title or "",
                    "counterparty": loan.counterparty.name if loan.counterparty_id else "",
                    "outstanding_bdt": _money(loan.outstanding_principal),
                }
            )
    elif module_key == "fixed_assets":
        for a in FixedAsset.objects.filter(company_id=company_id).order_by("-id")[:limit]:
            rows.append(
                {
                    "id": a.id,
                    "number": a.asset_number,
                    "name": a.name,
                    "status": a.status,
                    "cost_bdt": _money(a.acquisition_cost),
                }
            )
    elif module_key == "payroll":
        for pr in PayrollRun.objects.filter(company_id=company_id).order_by("-payment_date", "-id")[:limit]:
            rows.append(
                {
                    "id": pr.id,
                    "number": pr.payroll_number,
                    "payment_date": pr.payment_date.isoformat() if pr.payment_date else "",
                    "gross_bdt": _money(pr.total_gross),
                    "net_bdt": _money(pr.total_net),
                    "status": pr.status,
                }
            )
    elif module_key == "tax":
        for t in Tax.objects.filter(company_id=company_id, is_active=True).order_by("name")[:limit]:
            rows.append({"id": t.id, "name": t.name, "description": (t.description or "")[:80]})
    elif module_key == "inventory_transfers":
        for tr in (
            InventoryTransfer.objects.filter(company_id=company_id)
            .select_related("from_station", "to_station")
            .order_by("-transfer_date", "-id")[:limit]
        ):
            rows.append(
                {
                    "id": tr.id,
                    "number": tr.transfer_number,
                    "date": tr.transfer_date.isoformat() if tr.transfer_date else "",
                    "from": tr.from_station.station_name if tr.from_station_id else "",
                    "to": tr.to_station.station_name if tr.to_station_id else "",
                    "status": tr.status,
                }
            )
    elif module_key == "ponds":
        for p in AquaculturePond.objects.filter(company_id=company_id, is_active=True).order_by("sort_order", "id")[:limit]:
            rows.append(
                {
                    "id": p.id,
                    "name": pond_operational_display_name(p),
                    "water_area_decimal": str(p.water_area_decimal or ""),
                    "species": p.fish_species or "",
                }
            )
    elif module_key == "landlords":
        for ll in AquacultureLandlord.objects.filter(company_id=company_id, is_active=True).order_by("name")[:limit]:
            rows.append(
                {
                    "id": ll.id,
                    "name": ll.name,
                    "code": ll.code or "",
                    "phone": ll.phone or "",
                    "opening_balance_bdt": _money(ll.opening_balance),
                }
            )
    elif module_key == "production_cycles":
        for c in (
            AquacultureProductionCycle.objects.filter(company_id=company_id, is_active=True)
            .select_related("pond")
            .order_by("-start_date", "-id")[:limit]
        ):
            rows.append(
                {
                    "id": c.id,
                    "name": c.name,
                    "pond": pond_operational_display_name(c.pond) if c.pond_id else "",
                    "species": c.fish_species or "",
                    "start_date": c.start_date.isoformat() if c.start_date else "",
                    "open": c.end_date is None,
                }
            )
    elif module_key == "fish_transfers":
        for tr in (
            AquacultureFishPondTransfer.objects.filter(company_id=company_id)
            .select_related("from_pond")
            .prefetch_related("lines__to_pond")
            .order_by("-transfer_date", "-id")[:limit]
        ):
            dest_lines = list(tr.lines.all())
            to_label = (
                pond_operational_display_name(dest_lines[0].to_pond)
                if dest_lines and dest_lines[0].to_pond_id
                else "—"
            )
            if len(dest_lines) > 1:
                to_label += f" (+{len(dest_lines) - 1})"
            rows.append(
                {
                    "id": tr.id,
                    "date": tr.transfer_date.isoformat() if tr.transfer_date else "",
                    "from_pond": pond_operational_display_name(tr.from_pond) if tr.from_pond_id else "",
                    "to_pond": to_label,
                    "species": tr.fish_species or "",
                }
            )
    elif module_key == "biomass_sampling":
        for s in (
            AquacultureBiomassSample.objects.filter(company_id=company_id)
            .select_related("pond")
            .order_by("-sample_date", "-id")[:limit]
        ):
            rows.append(
                {
                    "id": s.id,
                    "pond": pond_operational_display_name(s.pond) if s.pond_id else "",
                    "date": s.sample_date.isoformat() if s.sample_date else "",
                    "fish_count": s.estimated_fish_count,
                    "avg_weight_kg": str(s.avg_weight_kg or ""),
                }
            )
    elif module_key == "feeding_advice":
        for fa in (
            AquacultureFeedingAdvice.objects.filter(company_id=company_id)
            .select_related("pond")
            .order_by("-target_date", "-id")[:limit]
        ):
            rows.append(
                {
                    "id": fa.id,
                    "pond": pond_operational_display_name(fa.pond) if fa.pond_id else "",
                    "target_date": fa.target_date.isoformat() if fa.target_date else "",
                    "status": fa.status,
                    "suggested_feed_kg": str(fa.suggested_feed_kg or ""),
                }
            )
    elif module_key == "fish_sales":
        for fs in (
            AquacultureFishSale.objects.filter(company_id=company_id)
            .select_related("pond")
            .order_by("-sale_date", "-id")[:limit]
        ):
            rows.append(
                {
                    "id": fs.id,
                    "pond": pond_operational_display_name(fs.pond) if fs.pond_id else "",
                    "date": fs.sale_date.isoformat() if fs.sale_date else "",
                    "weight_kg": str(fs.weight_kg or ""),
                    "amount_bdt": _money(fs.total_amount),
                }
            )
    elif module_key == "pond_expenses":
        for ex in (
            AquacultureExpense.objects.filter(company_id=company_id)
            .select_related("pond")
            .order_by("-expense_date", "-id")[:limit]
        ):
            rows.append(
                {
                    "id": ex.id,
                    "pond": pond_operational_display_name(ex.pond) if ex.pond_id else "",
                    "date": ex.expense_date.isoformat() if ex.expense_date else "",
                    "category": ex.expense_category or "",
                    "amount_bdt": _money(ex.amount),
                }
            )
    elif module_key == "pond_stock":
        for row in (
            ItemPondStock.objects.filter(company_id=company_id, quantity__gt=0)
            .select_related("item", "pond")
            .order_by("pond__sort_order", "item__name")[:limit]
        ):
            rows.append(
                {
                    "id": row.id,
                    "pond": pond_operational_display_name(row.pond) if row.pond_id else "",
                    "item": row.item.name if row.item_id else "",
                    "item_number": row.item.item_number if row.item_id else "",
                    "quantity": str(row.quantity),
                    "unit": row.item.unit if row.item_id else "",
                }
            )
    elif module_key == "aquaculture_medicine":
        for it in Item.objects.filter(
            company_id=company_id,
            is_active=True,
            item_number__startswith=MEDICINE_CATALOG_ITEM_PREFIX,
        ).order_by("name", "id")[:limit]:
            rows.append(
                {
                    "id": it.id,
                    "item_number": it.item_number,
                    "name": it.name,
                    "quantity_on_hand": str(it.quantity_on_hand),
                    "unit": it.unit or "",
                }
            )
    elif module_key == "aquaculture_financing":
        for loan in (
            Loan.objects.filter(company_id=company_id, aquaculture_financing=True)
            .select_related("counterparty")
            .order_by("-outstanding_principal", "-id")[:limit]
        ):
            rows.append(
                {
                    "id": loan.id,
                    "loan_no": loan.loan_no,
                    "title": loan.title or "",
                    "counterparty": loan.counterparty.name if loan.counterparty_id else "",
                    "status": loan.status,
                    "outstanding_bdt": _money(loan.outstanding_principal),
                    "sanction_bdt": _money(loan.sanction_amount),
                }
            )
    elif module_key == "reporting_categories":
        for rc in TenantReportingCategory.objects.filter(company_id=company_id, is_active=True).order_by("code")[:limit]:
            rows.append(
                {
                    "id": rc.id,
                    "code": rc.code,
                    "label": rc.label,
                    "application": rc.application,
                }
            )

    return {
        "module": module_key,
        "title_bn": title,
        "path": path,
        "count": len(rows),
        "rows": rows,
    }


def format_module_list_answer(data: dict[str, Any]) -> str:
    """Turn fetch_module_list output into Bangla text for the owner."""
    module = data.get("module") or ""
    title = data.get("title_bn") or module
    rows = data.get("rows") or []
    if not rows:
        return f"**{title}:** কোনো রেকর্ড পাওয়া যায়নি।"

    lines: list[str] = []
    for i, row in enumerate(rows, 1):
        if module == "employees":
            lines.append(
                f"{i}. **{row.get('name')}** — বেতন **৳{row.get('monthly_salary_bdt')}**/মাস"
                + (f" ({row.get('job_title')})" if row.get("job_title") else "")
            )
        elif module == "customers":
            lines.append(
                f"{i}. **{row.get('name')}** — ব্যালেন্স ৳{row.get('balance_bdt')}"
                + (f", ফোন: {row.get('phone')}" if row.get("phone") else "")
            )
        elif module == "vendors":
            lines.append(
                f"{i}. **{row.get('name')}** — ব্যালেন্স ৳{row.get('balance_bdt')}"
                + (f", ফোন: {row.get('phone')}" if row.get("phone") else "")
            )
        elif module == "invoices":
            lines.append(
                f"{i}. **{row.get('number')}** — {row.get('customer')}, ৳{row.get('total_bdt')}, "
                f"{row.get('date')}, {row.get('status')}"
            )
        elif module == "bills":
            lines.append(
                f"{i}. **{row.get('number')}** — {row.get('vendor')}, ৳{row.get('total_bdt')}, {row.get('date')}"
            )
        elif module == "payments":
            lines.append(
                f"{i}. {row.get('type')} — {row.get('party') or '—'}, ৳{row.get('amount_bdt')}, {row.get('date')}"
            )
        elif module == "items":
            lines.append(
                f"{i}. **{row.get('name')}** ({row.get('item_number')}) — স্টক {row.get('quantity_on_hand')} {row.get('unit')}"
            )
        elif module == "stations":
            lines.append(f"{i}. **{row.get('name')}** ({row.get('number')}) — {row.get('city') or '—'}")
        elif module == "tanks":
            lines.append(
                f"{i}. **{row.get('name')}** @ {row.get('station')} — {row.get('product')}: "
                f"{row.get('current_stock')} {row.get('unit')}"
            )
        elif module == "ponds":
            lines.append(
                f"{i}. **{row.get('name')}** — {row.get('water_area_decimal')} ডেসিমাল, {row.get('species') or '—'}"
            )
        elif module == "payroll":
            lines.append(
                f"{i}. **{row.get('number')}** — {row.get('payment_date')}, নেট ৳{row.get('net_bdt')}, {row.get('status')}"
            )
        elif module == "loans":
            lines.append(
                f"{i}. **{row.get('loan_no')}** — {row.get('counterparty')}, বকেয়া ৳{row.get('outstanding_bdt')}"
            )
        elif module == "landlords":
            lines.append(f"{i}. **{row.get('name')}** — {row.get('phone') or '—'}")
        elif module == "production_cycles":
            lines.append(
                f"{i}. **{row.get('name')}** @ {row.get('pond')} — {row.get('species')}, {row.get('start_date')}"
            )
        elif module == "pond_stock":
            lines.append(
                f"{i}. **{row.get('pond')}** — {row.get('item')} ({row.get('item_number')}): "
                f"{row.get('quantity')} {row.get('unit')}"
            )
        elif module == "aquaculture_medicine":
            lines.append(
                f"{i}. **{row.get('name')}** ({row.get('item_number')}) — স্টক {row.get('quantity_on_hand')} {row.get('unit')}"
            )
        elif module == "aquaculture_financing":
            lines.append(
                f"{i}. **{row.get('loan_no')}** — {row.get('counterparty') or row.get('title')}, "
                f"বকেয়া ৳{row.get('outstanding_bdt')}, {row.get('status')}"
            )
        else:
            label = (
                row.get("name")
                or row.get("number")
                or row.get("loan_no")
                or row.get("title")
                or f"#{row.get('id')}"
            )
            extra = row.get("amount_bdt") or row.get("total_bdt") or row.get("outstanding_bdt") or row.get("cost_bdt")
            suffix = f" — ৳{extra}" if extra else ""
            lines.append(f"{i}. **{label}**{suffix}")

    return f"**{title} ({len(rows)}টি):**\n" + "\n".join(lines)
