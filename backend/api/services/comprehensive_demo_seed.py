"""
Rich sandbox data for end-to-end testing (fuel, shop, aquaculture, HR, AR/AP).

Idempotent via COMP-DEMO-* keys and tagged notes/memos. Called from
`python manage.py seed_comprehensive_demo`.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, TextIO

from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone as django_timezone

from api.models import (
    AquacultureBiomassSample,
    AquacultureExpense,
    AquacultureExpensePondShare,
    AquacultureFishSale,
    AquacultureFishStockLedger,
    AquacultureLandlord,
    AquacultureLandlordLedgerEntry,
    AquacultureLandlordPondShare,
    AquaculturePond,
    AquacultureProductionCycle,
    BankAccount,
    BankDeposit,
    Bill,
    BillLine,
    Customer,
    Dispenser,
    Employee,
    FundTransfer,
    InventoryTransfer,
    InventoryTransferLine,
    Invoice,
    InvoiceLine,
    Item,
    ItemStationStock,
    Loan,
    LoanDisbursement,
    LoanRepayment,
    Meter,
    Nozzle,
    Payment,
    PaymentBillAllocation,
    PaymentInvoiceAllocation,
    PayrollRun,
    PayrollRunPondAllocation,
    ShiftSession,
    ShiftTemplate,
    Station,
    Tank,
    TankDip,
    Vendor,
)
from api.services.aquaculture_constants import AQUACULTURE_FISH_SPECIES_CHOICES
from api.services.aquaculture_medicine_catalog_seed import ensure_aquaculture_medicine_catalog_items
from api.services.aquaculture_pond_stock_service import (
    consume_pond_warehouse_stock,
    transfer_pond_warehouse_between_ponds,
    transfer_station_stock_to_pond_warehouse,
)
from api.services.employee_payroll_subledger import sync_payroll_run_to_employee_ledgers
from api.services.gl_posting import (
    post_bill_journal,
    post_bank_deposit_journal,
    post_fund_transfer_journal,
    post_inventory_transfer_journal,
    post_payment_made_journal,
    post_payment_received_journal,
    post_payroll_salary,
    sync_invoice_gl,
)
from api.services.loan_posting import post_loan_disbursement, post_loan_repayment
from api.services.payment_allocation import refresh_bill_from_allocations, refresh_invoice_from_allocations
from api.services.payment_station import apply_payment_register_station
from api.services.station_stock import add_station_stock

logger = logging.getLogger(__name__)

TAG = "[COMP-DEMO]"

# One fry SKU per species (typical hatchery grade ~86 pcs/kg).
FRY_SPECS: tuple[tuple[str, str, str], ...] = tuple(
    (code, label, "86")
    for code, label in AQUACULTURE_FISH_SPECIES_CHOICES
    if code not in ("not_applicable", "other")
)

FINGERLING_SAMPLE_SPECS: tuple[tuple[str, int, str], ...] = (
    ("0.020", 86, "tilapia"),
    ("0.018", 86, "tilapia"),
    ("0.120", 6, "tilapia"),
    ("0.165", 4, "rui"),
    ("0.200", 3, "pangas"),
    ("0.250", 3, "catla"),
)

FEED_SPECS: tuple[tuple[str, str, str, str, str], ...] = (
    ("COMP-DEMO-FEED-STARTER", "AquaGrow Starter 1mm (25kg sack)", "feed", "25", "Starter"),
    ("COMP-DEMO-FEED-GROWER", "AquaGrow Grower 2mm (25kg sack)", "feed", "25", "Grower"),
    ("COMP-DEMO-FEED-FINISHER", "AquaGrow Finisher 4mm (25kg sack)", "feed", "25", "Finisher"),
    ("COMP-DEMO-FEED-TILAPIA", "Premium Tilapia Float (25kg sack)", "feed", "25", "Tilapia"),
    ("COMP-DEMO-FEED-PANGAS", "Pangas sinking pellet (25kg sack)", "feed", "25", "Pangas"),
)

FUEL_EXTRA: tuple[tuple[str, str, str], ...] = (
    ("Octane", "L", "135.00"),
)

SHOP_EXTRA: tuple[tuple[str, str, str, str, str], ...] = (
    ("COMP-DEMO-OIL-1L", "Engine Oil (1L can)", "850.00", "620.00", "Lubricants"),
    ("COMP-DEMO-OIL-4L", "Engine Oil (4L can)", "3200.00", "2400.00", "Lubricants"),
    ("COMP-DEMO-OIL-5L", "Engine Oil (5L can)", "3850.00", "2900.00", "Lubricants"),
    ("COMP-DEMO-DIESEL-ADD", "Diesel Additive (250ml)", "180.00", "95.00", "Lubricants"),
    ("COMP-DEMO-WIPER", "Wiper Fluid (1L)", "120.00", "70.00", "Accessories"),
)

CUSTOMER_SPECS: tuple[tuple[str, str], ...] = (
    ("COMP-CUST-FUEL-01", "Metro Transport Ltd"),
    ("COMP-CUST-FUEL-02", "Green Line Paribahan"),
    ("COMP-CUST-AQ-01", "Ashari Fish Traders"),
    ("COMP-CUST-AQ-02", "Dhaka Live Fish Market"),
    ("COMP-CUST-SHOP-01", "Walk-in Retail"),
)

VENDOR_EXTRA: tuple[tuple[str, str], ...] = (
    ("COMP-VND-FEED", "National Fish Feed Ltd"),
    ("COMP-VND-FRY", "Southeast Hatchery Co."),
    ("COMP-VND-MED", "Aqua Pharma Distributors"),
    ("COMP-VND-LAND", "Mynuddin Family Estate"),
)


def _get_or_create_item(
    company_id: int,
    item_number: str,
    *,
    name: str,
    unit: str,
    unit_price: str,
    cost: str,
    pos_category: str,
    category: str = "General",
    pieces_per_kg: str | None = None,
    content_weight_kg: str | None = None,
) -> Item:
    from api.services.item_name_uniqueness import find_item_name_conflict, normalize_item_name_for_storage

    item = Item.objects.filter(company_id=company_id, item_number=item_number).first()
    price = Decimal(unit_price)
    c = Decimal(cost)
    if item:
        dirty: list[str] = []
        canonical = normalize_item_name_for_storage(name)
        conflict = find_item_name_conflict(company_id, canonical, exclude_pk=item.pk)
        if conflict:
            item = conflict
        elif canonical and canonical != normalize_item_name_for_storage(item.name):
            item.name = canonical
            dirty.append("name")
        if item.pos_category != pos_category:
            item.pos_category = pos_category
            dirty.append("pos_category")
        if dirty:
            item.save(update_fields=dirty + ["updated_at"])
        return item
    existing_by_name = find_item_name_conflict(company_id, name)
    if existing_by_name:
        if not (existing_by_name.item_number or "").strip():
            existing_by_name.item_number = item_number
            existing_by_name.save(update_fields=["item_number", "updated_at"])
        return existing_by_name
    return Item.objects.create(
        company_id=company_id,
        item_number=item_number,
        name=name,
        description=f"{TAG} {item_number}",
        item_type="inventory",
        unit_price=price,
        cost=c,
        quantity_on_hand=Decimal("0"),
        unit=unit[:20],
        pos_category=pos_category,
        category=category[:100],
        is_taxable=True,
        is_pos_available=True,
        is_active=True,
        pieces_per_kg=Decimal(pieces_per_kg) if pieces_per_kg else None,
        content_weight_kg=Decimal(content_weight_kg) if content_weight_kg else None,
    )


def _ensure_fuel_products(company_id: int, stdout: TextIO, style: Any) -> None:
    for label, unit, price in FUEL_EXTRA:
        inum = f"COMP-DEMO-FUEL-{label.upper().replace(' ', '-')[:20]}"
        _get_or_create_item(
            company_id,
            inum,
            name=label,
            unit=unit,
            unit_price=price,
            cost=str(Decimal(price) * Decimal("0.72")),
            pos_category="fuel",
            category="Fuel",
        )
    nozzles = Nozzle.objects.filter(company_id=company_id, is_active=True).count()
    stdout.write(style.SUCCESS(f"  + Fuel SKUs (Diesel, Petrol, Octane); active nozzles: {nozzles}"))


def _ensure_octane_forecourt(company_id: int, stdout: TextIO, style: Any) -> None:
    """Add Octane tank + nozzle on Main Station (3 fuel products on forecourt)."""
    station = Station.objects.filter(company_id=company_id, station_name="Main Station").first()
    octane = Item.objects.filter(company_id=company_id, name__iexact="Octane").first()
    if not station or not octane:
        stdout.write(style.WARNING("  (skip Octane nozzle — station or Octane item missing)"))
        return
    if Nozzle.objects.filter(company_id=company_id, product_id=octane.id).exists():
        stdout.write("  . Octane nozzle already present.")
        return
    tank, _ = Tank.objects.get_or_create(
        company_id=company_id,
        station_id=station.id,
        tank_name="Octane Tank 1",
        defaults={
            "product_id": octane.id,
            "tank_number": "T-O-01",
            "capacity": Decimal("12000"),
            "current_stock": Decimal("2500"),
            "unit_of_measure": "L",
            "is_active": True,
        },
    )
    dispenser = Dispenser.objects.filter(
        company_id=company_id, island__station_id=station.id, is_active=True
    ).first()
    if not dispenser:
        stdout.write(style.WARNING("  (skip Octane nozzle — no dispenser)"))
        return
    meter, _ = Meter.objects.get_or_create(
        company_id=company_id,
        dispenser_id=dispenser.id,
        meter_name="Octane Meter",
        defaults={
            "meter_number": "M-O-01",
            "current_reading": Decimal("0"),
            "is_active": True,
        },
    )
    Nozzle.objects.create(
        company_id=company_id,
        meter_id=meter.id,
        tank_id=tank.id,
        product_id=octane.id,
        nozzle_number="NZ-O-01",
        nozzle_name="Octane Meter - Octane",
        color_code="#7C3AED",
        is_operational=True,
        is_active=True,
    )
    stdout.write(style.SUCCESS("  + Octane tank + nozzle on Main Station"))


def _ensure_shop_products(company_id: int, stdout: TextIO, style: Any) -> None:
    n = 0
    for inum, name, price, cost, cat in SHOP_EXTRA:
        _get_or_create_item(
            company_id,
            inum,
            name=name,
            unit="piece",
            unit_price=price,
            cost=cost,
            pos_category="general",
            category=cat,
        )
        n += 1
    stdout.write(style.SUCCESS(f"  + Shop SKUs (engine oil 1L/4L/5L, etc.): {n}"))


def _ensure_fry_and_feed_items(company_id: int, stdout: TextIO, style: Any) -> None:
    n_fry = 0
    for code, label, pcs in FRY_SPECS:
        inum = f"COMP-DEMO-FRY-{code.upper()}"
        _get_or_create_item(
            company_id,
            inum,
            name=f"Fry — {label} ({pcs} pcs/kg)",
            unit="thousand",
            unit_price="450.00",
            cost="320.00",
            pos_category="fish",
            category="Fry",
            pieces_per_kg=pcs,
        )
        n_fry += 1
    n_feed = 0
    for inum, name, pos_cat, sack_kg, cat in FEED_SPECS:
        _get_or_create_item(
            company_id,
            inum,
            name=name,
            unit="sack",
            unit_price="2850.00",
            cost="2100.00",
            pos_category=pos_cat,
            category=cat,
            content_weight_kg=sack_kg,
        )
        n_feed += 1
    med = ensure_aquaculture_medicine_catalog_items(company_id)
    stdout.write(
        style.SUCCESS(
            f"  + Fry SKUs (all species): {n_fry}; feed SKUs: {n_feed}; "
            f"medicine catalog (+{med.get('created', 0)} new, {med.get('total', 0)} total)"
        )
    )


def _ensure_station_stock(company_id: int, stdout: TextIO, style: Any) -> None:
    premium = Station.objects.filter(company_id=company_id, station_name__iexact="Premium Agro").first()
    main = Station.objects.filter(company_id=company_id, station_name="Main Station").first()
    if not premium:
        stdout.write(style.WARNING("  (skip station stock — Premium Agro station missing)"))
        return
    feed_items = Item.objects.filter(company_id=company_id, pos_category="feed", is_active=True)[:8]
    med_items = Item.objects.filter(
        company_id=company_id, item_number__startswith="AQ-MED-", is_active=True
    )[:10]
    shop_items = (
        Item.objects.filter(company_id=company_id, is_active=True)
        .filter(Q(item_number__startswith="COMP-DEMO-OIL") | Q(pos_category="general"))
        .order_by("id")[:12]
    )
    n = 0
    for it in list(feed_items) + list(med_items) + list(shop_items):
        _, created = ItemStationStock.objects.get_or_create(
            company_id=company_id,
            station_id=premium.id,
            item_id=it.id,
            defaults={"quantity": Decimal("80.0000")},
        )
        if created:
            n += 1
    if main:
        for it in Item.objects.filter(company_id=company_id, pos_category="general", is_active=True)[:6]:
            _, created = ItemStationStock.objects.get_or_create(
                company_id=company_id,
                station_id=main.id,
                item_id=it.id,
                defaults={"quantity": Decimal("40.0000")},
            )
            if created:
                n += 1
    stdout.write(style.SUCCESS(f"  + Station bin stock rows created: {n}"))


def _ensure_customers_vendors(company_id: int, stdout: TextIO, style: Any) -> None:
    nc = nv = 0
    for num, name in CUSTOMER_SPECS:
        _, created = Customer.objects.get_or_create(
            company_id=company_id,
            customer_number=num,
            defaults={
                "display_name": name,
                "company_name": name,
                "is_active": True,
            },
        )
        if created:
            nc += 1
    for num, name in VENDOR_EXTRA:
        _, created = Vendor.objects.get_or_create(
            company_id=company_id,
            vendor_number=num,
            defaults={
                "company_name": name,
                "display_name": name,
                "is_active": True,
            },
        )
        if created:
            nv += 1
    stdout.write(style.SUCCESS(f"  + Customers: {nc}; vendors: {nv}"))


def _ensure_landlords(company_id: int, stdout: TextIO, style: Any) -> None:
    if AquacultureLandlord.objects.filter(company_id=company_id, code="COMP-LL-MYNUDDIN").exists():
        stdout.write("  . Landlords already seeded (COMP-LL-*).")
        return
    ponds = {p.name: p for p in AquaculturePond.objects.filter(company_id=company_id, is_active=True)}
    specs = [
        ("COMP-LL-MYNUDDIN", "Mynuddin Family Estate", "Mynuddin", Decimal("2.6500")),
        ("COMP-LL-ASHARI", "Ashari Pond Owners Assoc.", "Ashari-1", Decimal("3.3500")),
        ("COMP-LL-DIGONTA", "Digonta Canal Lease", "Digonta", Decimal("0.8000")),
    ]
    n = 0
    for code, lname, pond_name, area in specs:
        pond = ponds.get(pond_name)
        if not pond:
            continue
        ll, created = AquacultureLandlord.objects.get_or_create(
            company_id=company_id,
            code=code,
            defaults={
                "name": lname,
                "phone": "+880-171-5550100",
                "is_active": True,
                "opening_balance": Decimal("0"),
            },
        )
        if created:
            n += 1
        AquacultureLandlordPondShare.objects.get_or_create(
            landlord=ll,
            pond=pond,
            defaults={"land_area_decimal": area, "notes": TAG},
        )
    stdout.write(style.SUCCESS(f"  + Landlords + pond shares: {n}"))


def _ensure_fingerling_and_samples(company_id: int, stdout: TextIO, style: Any) -> None:
    if AquacultureBiomassSample.objects.filter(notes__contains="COMP-DEMO-FINGERLING-SAMPLE").exists():
        stdout.write("  . Fingerling samples already present.")
        return
    nursery = (
        AquaculturePond.objects.filter(company_id=company_id, pond_role="nursing", is_active=True)
        .order_by("sort_order", "id")
        .first()
    )
    if not nursery:
        nursery = AquaculturePond.objects.filter(company_id=company_id, name__iexact="Digonta").first()
    if not nursery:
        nursery = AquaculturePond.objects.filter(company_id=company_id, is_active=True).first()
    if not nursery:
        stdout.write(style.WARNING("  (skip fingerling — no pond)"))
        return
    cy, _ = AquacultureProductionCycle.objects.get_or_create(
        company_id=company_id,
        pond=nursery,
        code="COMP-DEMO-NURSERY-CY",
        defaults={
            "name": "Fingerling nursery batch",
            "start_date": date.today() - timedelta(days=90),
            "is_active": True,
            "notes": TAG,
        },
    )
    today = date.today()
    n = 0
    for avg_kg, pcs, species in FINGERLING_SAMPLE_SPECS:
        avg = Decimal(avg_kg)
        count = max(1, int(avg * Decimal(pcs) * Decimal("1000")))
        AquacultureBiomassSample.objects.create(
            company_id=company_id,
            pond=nursery,
            production_cycle=cy,
            sample_date=today - timedelta(days=7 + n),
            estimated_fish_count=count,
            estimated_total_weight_kg=(avg * Decimal(count)).quantize(Decimal("0.0001")),
            avg_weight_kg=avg,
            fish_species=species,
            notes=f"{TAG} COMP-DEMO-FINGERLING-SAMPLE — {pcs} pcs/kg, ~{avg_kg} kg/fish",
        )
        n += 1
    AquacultureExpense.objects.create(
        company_id=company_id,
        pond=nursery,
        production_cycle=cy,
        expense_category="fry_stocking",
        expense_date=today - timedelta(days=85),
        amount=Decimal("385000.00"),
        memo=f"{TAG} Tilapia fry stocking — nursery (500k fry)",
        vendor_name="Southeast Hatchery Co.",
    )
    AquacultureFishStockLedger.objects.create(
        company_id=company_id,
        pond=nursery,
        production_cycle=cy,
        entry_date=today - timedelta(days=84),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=480000,
        weight_kg_delta=Decimal("5581.0000"),
        book_value=Decimal("385000.00"),
        post_to_books=False,
        memo=f"{TAG} Fingerling in nursery — post-stocking count",
    )
    stdout.write(style.SUCCESS(f"  + Nursery fingerling: {n} biomass samples + fry stocking row"))


def _ensure_extra_harvests(company_id: int, stdout: TextIO, style: Any) -> None:
    if AquacultureFishSale.objects.filter(memo__contains="COMP-DEMO-HARVEST").exists():
        stdout.write("  . COMP-DEMO harvests already present.")
        return
    ponds = list(AquaculturePond.objects.filter(company_id=company_id, is_active=True).order_by("id")[:6])
    if not ponds:
        return
    today = date.today()
    harvests = [
        ("tilapia", "2800", "9200", "248.00", 0),
        ("rui", "1200", "4800", "265.00", 5),
        ("pangas", "950", "4100", "235.00", 12),
        ("catla", "800", "3500", "240.00", 18),
        ("silver_carp", "600", "2200", "220.00", 25),
        ("tilapia", "1500", "5500", "252.00", 35),
    ]
    n = 0
    for species, w, cnt, price, days_ago in harvests:
        p = ponds[n % len(ponds)]
        cy = AquacultureProductionCycle.objects.filter(company_id=company_id, pond=p, is_active=True).first()
        w_d = Decimal(w)
        AquacultureFishSale.objects.create(
            company_id=company_id,
            pond=p,
            production_cycle=cy,
            income_type="fish_harvest_sale",
            fish_species=species,
            sale_date=today - timedelta(days=days_ago),
            weight_kg=w_d,
            fish_count=int(cnt),
            total_amount=(w_d * Decimal(price)).quantize(Decimal("0.01")),
            buyer_name="COMP-DEMO Wholesale Buyer",
            memo=f"{TAG} COMP-DEMO-HARVEST — {species}",
        )
        n += 1
    stdout.write(style.SUCCESS(f"  + Extra harvest sales: {n}"))


def _ensure_aquaculture_expenses(company_id: int, stdout: TextIO, style: Any) -> None:
    if AquacultureExpense.objects.filter(memo__contains="COMP-DEMO-OPEX").exists():
        stdout.write("  . COMP-DEMO aquaculture expenses already present.")
        return
    ponds = list(AquaculturePond.objects.filter(company_id=company_id, is_active=True).order_by("id")[:4])
    if not ponds:
        return
    today = date.today()
    rows = [
        ("electricity", "4500.00", "Aerator meter — pond"),
        ("medicine_purchase", "12500.00", "Oxytetracycline + probiotic"),
        ("feed_purchase", "57000.00", "Grower feed delivery"),
        ("equipment", "22000.00", "Net repair + bamboo sluice"),
        ("worker_salary", "18000.00", "Pond helper wages"),
    ]
    for idx, (cat, amt, memo) in enumerate(rows):
        p = ponds[idx % len(ponds)]
        cy = AquacultureProductionCycle.objects.filter(company_id=company_id, pond=p, is_active=True).first()
        AquacultureExpense.objects.create(
            company_id=company_id,
            pond=p,
            production_cycle=cy,
            expense_category=cat,
            expense_date=today - timedelta(days=14 + idx * 3),
            amount=Decimal(amt),
            memo=f"{TAG} COMP-DEMO-OPEX — {memo}",
            vendor_name="Premium Agro Suppliers",
        )
    share_total = Decimal("36000.00")
    shared = AquacultureExpense.objects.create(
        company_id=company_id,
        pond=None,
        production_cycle=None,
        expense_category="electricity",
        expense_date=today - timedelta(days=20),
        amount=share_total,
        memo=f"{TAG} COMP-DEMO-OPEX — Site generator + yard lighting",
        vendor_name="Rural Power Co-op",
    )
    n_share = min(len(ponds), 3)
    base = (share_total / Decimal(n_share)).quantize(Decimal("0.01"))
    running = Decimal("0")
    for i, p in enumerate(ponds[:n_share]):
        slice_amt = base if i < n_share - 1 else (share_total - running).quantize(Decimal("0.01"))
        running += slice_amt
        AquacultureExpensePondShare.objects.create(expense=shared, pond=p, amount=slice_amt)
    stdout.write(style.SUCCESS(f"  + Aquaculture opex lines: {len(rows)} direct + 1 shared"))


def _ensure_invoices(company_id: int, stdout: TextIO, style: Any) -> None:
    if Invoice.objects.filter(company_id=company_id, invoice_number="COMP-DEMO-INV-FUEL-001").exists():
        stdout.write("  . COMP-DEMO invoices already present.")
        return
    main = Station.objects.filter(company_id=company_id, station_name="Main Station").first()
    premium = Station.objects.filter(company_id=company_id, station_name__iexact="Premium Agro").first()
    cust_fuel = Customer.objects.filter(company_id=company_id, customer_number="COMP-CUST-FUEL-01").first()
    cust_shop = Customer.objects.filter(company_id=company_id, customer_number="COMP-CUST-SHOP-01").first()
    if not main or not cust_fuel:
        stdout.write(style.WARNING("  (skip invoices — missing station/customer)"))
        return
    diesel = Item.objects.filter(company_id=company_id, name__iexact="Diesel").first()
    oil_4l = Item.objects.filter(company_id=company_id, item_number="COMP-DEMO-OIL-4L").first()
    oil_1l = Item.objects.filter(company_id=company_id, item_number="COMP-DEMO-OIL-1L").first()
    today = date.today()
    with transaction.atomic():
        inv_fuel = Invoice.objects.create(
            company_id=company_id,
            customer=cust_fuel,
            station=main,
            invoice_number="COMP-DEMO-INV-FUEL-001",
            invoice_date=today - timedelta(days=2),
            status="paid",
            subtotal=Decimal("11400.00"),
            tax_total=Decimal("0"),
            total=Decimal("11400.00"),
            payment_method="cash",
        )
        if diesel:
            InvoiceLine.objects.create(
                invoice=inv_fuel,
                item=diesel,
                nozzle=Nozzle.objects.filter(company_id=company_id, product_id=diesel.id).first(),
                quantity=Decimal("100"),
                unit_price=Decimal("114.00"),
                amount=Decimal("11400.00"),
            )
        sync_invoice_gl(company_id, inv_fuel, payment_method="cash")

        if premium and cust_shop and oil_4l:
            inv_shop = Invoice.objects.create(
                company_id=company_id,
                customer=cust_shop,
                station=premium,
                invoice_number="COMP-DEMO-INV-SHOP-001",
                invoice_date=today - timedelta(days=1),
                status="paid",
                subtotal=Decimal("9600.00"),
                tax_total=Decimal("1440.00"),
                total=Decimal("11040.00"),
                payment_method="cash",
            )
            InvoiceLine.objects.create(
                invoice=inv_shop,
                item=oil_4l,
                quantity=Decimal("2"),
                unit_price=Decimal("3200.00"),
                amount=Decimal("6400.00"),
            )
            if oil_1l:
                InvoiceLine.objects.create(
                    invoice=inv_shop,
                    item=oil_1l,
                    quantity=Decimal("4"),
                    unit_price=Decimal("850.00"),
                    amount=Decimal("3400.00"),
                )
            sync_invoice_gl(company_id, inv_shop, payment_method="cash")
    stdout.write(style.SUCCESS("  + Posted invoices: fuel (Main) + shop (Premium Agro)"))


def _ensure_posted_bills(company_id: int, stdout: TextIO, style: Any) -> None:
    if Bill.objects.filter(company_id=company_id, bill_number="COMP-DEMO-BILL-FEED-001").exists():
        stdout.write("  . COMP-DEMO bills already present.")
        return
    vendor = Vendor.objects.filter(company_id=company_id, vendor_number="COMP-VND-FEED").first()
    if not vendor:
        vendor = Vendor.objects.filter(company_id=company_id).first()
    premium = Station.objects.filter(company_id=company_id, station_name__iexact="Premium Agro").first()
    feed = Item.objects.filter(company_id=company_id, item_number="COMP-DEMO-FEED-GROWER").first()
    med = Item.objects.filter(company_id=company_id, item_number="AQ-MED-oxytetracycline").first()
    if not vendor or not feed:
        stdout.write(style.WARNING("  (skip bills — vendor/feed item missing)"))
        return
    today = date.today()
    with transaction.atomic():
        b1 = Bill(
            company_id=company_id,
            vendor_id=vendor.id,
            receipt_station_id=premium.id if premium else None,
            bill_number="COMP-DEMO-BILL-FEED-001",
            bill_date=today - timedelta(days=10),
            due_date=today + timedelta(days=4),
            status="open",
            subtotal=Decimal("142500.00"),
            tax_total=Decimal("0"),
            total=Decimal("142500.00"),
            memo=f"{TAG} Feed delivery — 50 sacks",
        )
        b1.save()
        BillLine.objects.create(
            bill=b1,
            item_id=feed.id,
            description="Grower feed 25kg sacks",
            quantity=Decimal("50"),
            unit_price=Decimal("2850.00"),
            amount=Decimal("142500.00"),
        )
        try:
            post_bill_journal(company_id, b1, acknowledge_tank_overfill=True)
        except Exception as exc:
            logger.warning("COMP-DEMO bill feed post: %s", exc)

        if med:
            b2 = Bill(
                company_id=company_id,
                vendor_id=vendor.id,
                receipt_station_id=premium.id if premium else None,
                bill_number="COMP-DEMO-BILL-MED-001",
                bill_date=today - timedelta(days=8),
                due_date=today + timedelta(days=6),
                status="open",
                subtotal=Decimal("18500.00"),
                tax_total=Decimal("0"),
                total=Decimal("18500.00"),
                memo=f"{TAG} Medicine top-up",
            )
            b2.save()
            BillLine.objects.create(
                bill=b2,
                item_id=med.id,
                description=med.name,
                quantity=Decimal("10"),
                unit_price=Decimal("1850.00"),
                amount=Decimal("18500.00"),
            )
            try:
                post_bill_journal(company_id, b2, acknowledge_tank_overfill=True)
            except Exception as exc:
                logger.warning("COMP-DEMO bill med post: %s", exc)
    stdout.write(style.SUCCESS("  + Posted vendor bills: feed + medicine"))


def _ensure_payroll(company_id: int, stdout: TextIO, style: Any) -> None:
    pr = PayrollRun.objects.filter(company_id=company_id, payroll_number="COMP-DEMO-PAY-001").first()
    if pr:
        if not pr.salary_journal_id:
            bank = BankAccount.objects.filter(company_id=company_id, is_active=True).order_by("id").first()
            try:
                post_payroll_salary(company_id, pr, bank_account_id=bank.id if bank else None)
                sync_payroll_run_to_employee_ledgers(company_id, pr)
                stdout.write(style.SUCCESS("  + Payroll COMP-DEMO-PAY-001 GL + employee ledger backfilled"))
            except Exception as exc:
                logger.warning("COMP-DEMO payroll backfill: %s", exc)
        else:
            stdout.write("  . COMP-DEMO payroll already present.")
        return
    employees = list(Employee.objects.filter(company_id=company_id, is_active=True).order_by("id")[:5])
    if len(employees) < 2:
        stdout.write(style.WARNING("  (skip payroll — need employees from seed_master_employees)"))
        return
    main = Station.objects.filter(company_id=company_id, station_name="Main Station").first()
    ponds = list(AquaculturePond.objects.filter(company_id=company_id, is_active=True).order_by("id")[:3])
    today = date.today()
    period_end = today.replace(day=1) - timedelta(days=1)
    period_start = period_end.replace(day=1)
    gross = sum((e.salary or Decimal("0")) for e in employees)
    deductions = (gross * Decimal("0.07")).quantize(Decimal("0.01"))
    net = (gross - deductions).quantize(Decimal("0.01"))
    pr = PayrollRun.objects.create(
        company_id=company_id,
        payroll_number="COMP-DEMO-PAY-001",
        pay_period_start=period_start,
        pay_period_end=period_end,
        payment_date=today - timedelta(days=3),
        status="posted",
        station_id=main.id if main else None,
        total_gross=gross,
        total_deductions=deductions,
        total_net=net,
        notes=f"{TAG} Monthly payroll sample",
    )
    if ponds:
        weights = [Decimal("0.40"), Decimal("0.35"), Decimal("0.25")][: len(ponds)]
        allocated = Decimal("0")
        for i, pond in enumerate(ponds):
            if i == len(ponds) - 1:
                amt = (net - allocated).quantize(Decimal("0.01"))
            else:
                amt = (net * weights[i]).quantize(Decimal("0.01"))
                allocated += amt
            PayrollRunPondAllocation.objects.create(payroll_run=pr, pond=pond, amount=amt)
    bank = BankAccount.objects.filter(company_id=company_id, is_active=True).order_by("id").first()
    try:
        post_payroll_salary(
            company_id,
            pr,
            bank_account_id=bank.id if bank else None,
        )
    except Exception as exc:
        logger.warning("COMP-DEMO payroll GL: %s", exc)
    pr.refresh_from_db()
    if pr.salary_journal_id:
        sync_payroll_run_to_employee_ledgers(company_id, pr)
    stdout.write(style.SUCCESS(f"  + Payroll run COMP-DEMO-PAY-001 ({len(employees)} employees, GL + HR ledger)"))


def _ensure_payments_and_deposits(company_id: int, stdout: TextIO, style: Any) -> None:
    if Payment.objects.filter(company_id=company_id, reference="COMP-DEMO-RCV-001").exists():
        stdout.write("  . COMP-DEMO payments already present.")
        return
    main = Station.objects.filter(company_id=company_id, station_name="Main Station").first()
    cust = Customer.objects.filter(company_id=company_id, customer_number="COMP-CUST-FUEL-02").first()
    vendor = Vendor.objects.filter(company_id=company_id, vendor_number="COMP-VND-FEED").first()
    diesel = Item.objects.filter(company_id=company_id, name__iexact="Diesel").first()
    bank = BankAccount.objects.filter(company_id=company_id, is_active=True).order_by("id").first()
    if not main or not cust or not diesel:
        stdout.write(style.WARNING("  (skip payments — missing station/customer/diesel)"))
        return
    today = date.today()
    with transaction.atomic():
        inv_ar = Invoice.objects.create(
            company_id=company_id,
            customer=cust,
            station=main,
            invoice_number="COMP-DEMO-INV-AR-001",
            invoice_date=today - timedelta(days=5),
            due_date=today + timedelta(days=10),
            status="sent",
            subtotal=Decimal("22800.00"),
            tax_total=Decimal("0"),
            total=Decimal("22800.00"),
            payment_method="",
        )
        InvoiceLine.objects.create(
            invoice=inv_ar,
            item=diesel,
            quantity=Decimal("200"),
            unit_price=Decimal("114.00"),
            amount=Decimal("22800.00"),
        )
        sync_invoice_gl(company_id, inv_ar, payment_method="cash")

        pay_rcv = Payment.objects.create(
            company_id=company_id,
            payment_type=Payment.PAYMENT_TYPE_RECEIVED,
            customer_id=cust.id,
            station_id=main.id,
            amount=Decimal("15000.00"),
            payment_date=today - timedelta(days=4),
            payment_method="cash",
            reference="COMP-DEMO-RCV-001",
            memo=f"{TAG} Partial AR receipt — Metro Transport",
        )
        PaymentInvoiceAllocation.objects.create(
            payment=pay_rcv, invoice=inv_ar, amount=Decimal("15000.00")
        )
        post_payment_received_journal(company_id, pay_rcv)
        apply_payment_register_station(company_id, pay_rcv)
        refresh_invoice_from_allocations(inv_ar, company_id)

        pay_dep = Payment.objects.create(
            company_id=company_id,
            payment_type=Payment.PAYMENT_TYPE_RECEIVED,
            customer_id=cust.id,
            station_id=main.id,
            amount=Decimal("8500.00"),
            payment_date=today - timedelta(days=3),
            payment_method="cash",
            reference="COMP-DEMO-RCV-DEP",
            memo=f"{TAG} Undeposited cash for bank deposit batch",
        )
        post_payment_received_journal(company_id, pay_dep)
        apply_payment_register_station(company_id, pay_dep)

        if bank:
            dep = BankDeposit.objects.create(
                company_id=company_id,
                bank_account_id=bank.id,
                deposit_date=today - timedelta(days=2),
                total_amount=Decimal("8500.00"),
                memo=f"{TAG} COMP-DEMO-DEP-001 — till to operating bank",
            )
            BankDeposit.objects.filter(pk=dep.pk).update(deposit_number="COMP-DEMO-DEP-001")
            dep.refresh_from_db()
            post_bank_deposit_journal(company_id, dep.id, bank, [pay_dep], dep.deposit_date, dep.memo)
            Payment.objects.filter(pk=pay_dep.pk).update(bank_deposit_id=dep.id)
            BankAccount.objects.filter(pk=bank.id).update(
                current_balance=F("current_balance") + Decimal("8500.00")
            )

        if vendor:
            bill = Bill.objects.filter(company_id=company_id, bill_number="COMP-DEMO-BILL-MED-001").first()
            if bill and bill.status == "open":
                pay_made = Payment.objects.create(
                    company_id=company_id,
                    payment_type=Payment.PAYMENT_TYPE_MADE,
                    vendor_id=vendor.id,
                    station_id=main.id,
                    amount=Decimal("10000.00"),
                    payment_date=today - timedelta(days=6),
                    payment_method="transfer",
                    reference="COMP-DEMO-MADE-001",
                    memo=f"{TAG} Partial vendor payment — medicine bill",
                    bank_account_id=bank.id if bank else None,
                )
                PaymentBillAllocation.objects.create(
                    payment=pay_made, bill=bill, amount=Decimal("10000.00")
                )
                post_payment_made_journal(company_id, pay_made)
                apply_payment_register_station(company_id, pay_made)
                refresh_bill_from_allocations(bill, company_id)
    stdout.write(style.SUCCESS("  + Payments: AR receipt, bank deposit, vendor payment"))


def _ensure_shift_sessions(company_id: int, stdout: TextIO, style: Any) -> None:
    if ShiftSession.objects.filter(
        company_id=company_id, opening_cash_float=Decimal("5000.00"), closed_at__isnull=False
    ).exists():
        stdout.write("  . COMP-DEMO shift sessions already present.")
        return
    main = Station.objects.filter(company_id=company_id, station_name="Main Station").first()
    tmpl = ShiftTemplate.objects.filter(company_id=company_id).order_by("id").first()
    emp = Employee.objects.filter(company_id=company_id, is_active=True).order_by("id").first()
    if not main:
        stdout.write(style.WARNING("  (skip shifts — Main Station missing)"))
        return
    now = django_timezone.now()
    opened = now - timedelta(hours=14)
    closed = now - timedelta(hours=2)
    sched = []
    if emp:
        sched = [
            {
                "employee_id": emp.id,
                "first_name": emp.first_name,
                "last_name": emp.last_name or "",
                "scheduled_start": opened.isoformat(),
                "scheduled_end": closed.isoformat(),
                "notes": f"{TAG} Day shift attendant",
            }
        ]
    ShiftSession.objects.create(
        company_id=company_id,
        station_id=main.id,
        template_id=tmpl.id if tmpl else None,
        opened_at=opened,
        closed_at=closed,
        opening_cash_float=Decimal("5000.00"),
        expected_cash_total=Decimal("18450.00"),
        closing_cash_counted=Decimal("18420.00"),
        cash_variance=Decimal("-30.00"),
        total_sales_amount=Decimal("13450.00"),
        sale_transaction_count=47,
        employee_schedule=sched,
    )
    ShiftSession.objects.create(
        company_id=company_id,
        station_id=main.id,
        template_id=tmpl.id if tmpl else None,
        opened_at=now - timedelta(hours=6),
        closed_at=None,
        opening_cash_float=Decimal("5000.00"),
        expected_cash_total=Decimal("6200.00"),
        total_sales_amount=Decimal("1200.00"),
        sale_transaction_count=8,
        employee_schedule=sched,
    )
    stdout.write(style.SUCCESS("  + Shift sessions: 1 closed + 1 open on Main Station"))


def _ensure_inventory_transfer(company_id: int, stdout: TextIO, style: Any) -> None:
    if InventoryTransfer.objects.filter(company_id=company_id, memo__contains="COMP-DEMO-ISTR").exists():
        stdout.write("  . COMP-DEMO inventory transfer already present.")
        return
    main = Station.objects.filter(company_id=company_id, station_name="Main Station").first()
    premium = Station.objects.filter(company_id=company_id, station_name__iexact="Premium Agro").first()
    item = Item.objects.filter(company_id=company_id, item_number="COMP-DEMO-OIL-1L").first()
    if not main or not premium or not item:
        stdout.write(style.WARNING("  (skip inventory transfer — stations or shop SKU missing)"))
        return
    add_station_stock(company_id, main.id, item.id, Decimal("20"))
    today = date.today()
    with transaction.atomic():
        tr = InventoryTransfer.objects.create(
            company_id=company_id,
            from_station_id=main.id,
            to_station_id=premium.id,
            transfer_number="COMP-DEMO-ISTR-001",
            transfer_date=today - timedelta(days=4),
            status=InventoryTransfer.STATUS_POSTED,
            memo=f"{TAG} COMP-DEMO-ISTR — engine oil to Premium Agro",
            posted_at=django_timezone.now(),
        )
        InventoryTransferLine.objects.create(transfer=tr, item=item, quantity=Decimal("12"))
        add_station_stock(company_id, main.id, item.id, Decimal("-12"))
        add_station_stock(company_id, premium.id, item.id, Decimal("12"))
    post_inventory_transfer_journal(company_id, tr.id)
    stdout.write(style.SUCCESS("  + Posted inventory transfer Main → Premium Agro"))


def _ensure_pond_warehouse_flow(company_id: int, stdout: TextIO, style: Any) -> None:
    from api.models import PondWarehouseStockReceipt

    if PondWarehouseStockReceipt.objects.filter(receipt_number="COMP-DEMO-PWR-001").exists():
        stdout.write("  . COMP-DEMO pond warehouse flow already present.")
        return
    premium = Station.objects.filter(company_id=company_id, station_name__iexact="Premium Agro").first()
    pond = AquaculturePond.objects.filter(company_id=company_id, name__iexact="Ashari-1").first()
    pond2 = AquaculturePond.objects.filter(company_id=company_id, name__iexact="Ashari-2").first()
    if not pond:
        pond = AquaculturePond.objects.filter(company_id=company_id, name__iexact="Mynuddin").first()
    feed = Item.objects.filter(company_id=company_id, item_number="COMP-DEMO-FEED-GROWER").first()
    med = Item.objects.filter(company_id=company_id, item_number="AQ-MED-salt").first()
    if not premium or not pond or not feed:
        stdout.write(style.WARNING("  (skip pond warehouse — station/pond/feed missing)"))
        return
    if med and (med.cost or Decimal("0")) <= 0:
        Item.objects.filter(pk=med.id).update(cost=Decimal("45.00"), unit_price=Decimal("65.00"))
        med.refresh_from_db()
    cy = AquacultureProductionCycle.objects.filter(company_id=company_id, pond=pond, is_active=True).first()
    today = date.today()
    ok_parts: list[str] = []
    try:
        with transaction.atomic():
            transfer_station_stock_to_pond_warehouse(
                company_id=company_id,
                station_id=premium.id,
                pond_id=pond.id,
                items=[{"item_id": feed.id, "quantity": "8"}],
            )
            PondWarehouseStockReceipt.objects.filter(
                company_id=company_id, pond_id=pond.id
            ).order_by("-id").update(receipt_number="COMP-DEMO-PWR-001")
            ok_parts.append("receipt")
            if med:
                transfer_station_stock_to_pond_warehouse(
                    company_id=company_id,
                    station_id=premium.id,
                    pond_id=pond.id,
                    items=[{"item_id": med.id, "quantity": "5"}],
                )
                consume_pond_warehouse_stock(
                    company_id=company_id,
                    pond=pond,
                    production_cycle_id=cy.id if cy else None,
                    expense_category="medicine_consumed",
                    expense_date=today - timedelta(days=3),
                    item=med,
                    quantity=Decimal("2"),
                    memo=f"{TAG} Salt bath treatment",
                )
                ok_parts.append("medicine consumed")
            consume_pond_warehouse_stock(
                company_id=company_id,
                pond=pond,
                production_cycle_id=cy.id if cy else None,
                expense_category="feed_consumed",
                expense_date=today - timedelta(days=2),
                item=feed,
                quantity=Decimal("3"),
                memo=f"{TAG} Grower feed application",
                feed_sack_count=Decimal("3"),
                feed_weight_kg=Decimal("75"),
            )
            ok_parts.append("feed consumed")
    except Exception as exc:
        stdout.write(style.WARNING(f"  (pond warehouse partial: {exc})"))
        if ok_parts:
            stdout.write(style.SUCCESS(f"  + Pond warehouse partial: {', '.join(ok_parts)}"))
        return
    if pond2 and med and pond.id != pond2.id:
        try:
            transfer_pond_warehouse_between_ponds(
                company_id=company_id,
                from_pond_id=pond.id,
                to_pond_id=pond2.id,
                items=[{"item_id": med.id, "quantity": "1"}],
                memo=f"{TAG} Medicine reallocation between Ashari ponds",
            )
            ok_parts.append("inter-pond move")
        except Exception as exc:
            logger.warning("COMP-DEMO inter-pond warehouse: %s", exc)
    stdout.write(style.SUCCESS(f"  + Pond warehouse: {', '.join(ok_parts)}"))


def _ensure_landlord_ledger(company_id: int, stdout: TextIO, style: Any) -> None:
    if AquacultureLandlordLedgerEntry.objects.filter(memo__contains="COMP-DEMO-LL").exists():
        stdout.write("  . COMP-DEMO landlord ledger already present.")
        return
    ll = AquacultureLandlord.objects.filter(company_id=company_id, code="COMP-LL-MYNUDDIN").first()
    pond = AquaculturePond.objects.filter(company_id=company_id, name__iexact="Mynuddin").first()
    if not ll or not pond:
        stdout.write(style.WARNING("  (skip landlord ledger — landlord/pond missing)"))
        return
    today = date.today()
    AquacultureLandlordLedgerEntry.objects.create(
        landlord=ll,
        pond=pond,
        entry_date=today - timedelta(days=30),
        kind=AquacultureLandlordLedgerEntry.KIND_RENT_CHARGE,
        amount_signed=Decimal("49025.00"),
        memo=f"{TAG} COMP-DEMO-LL — Annual lease accrual (Q1 share)",
        reference="COMP-DEMO-LL-RENT-001",
    )
    AquacultureLandlordLedgerEntry.objects.create(
        landlord=ll,
        pond=pond,
        entry_date=today - timedelta(days=10),
        kind=AquacultureLandlordLedgerEntry.KIND_PAYMENT,
        amount_signed=Decimal("-35000.00"),
        memo=f"{TAG} COMP-DEMO-LL — Lease payment to Mynuddin estate",
        reference="COMP-DEMO-LL-PAY-001",
        applies_to_lease_paid=True,
    )
    stdout.write(style.SUCCESS("  + Landlord ledger: rent charge + payment"))


def _ensure_loan_activity(company_id: int, stdout: TextIO, style: Any) -> None:
    if LoanDisbursement.objects.filter(memo__contains="COMP-DEMO-LOAN").exists():
        stdout.write("  . COMP-DEMO loan activity already present.")
        return
    lo = Loan.objects.filter(company_id=company_id, loan_no="LOAN-DEMO-001").first()
    if not lo:
        stdout.write(style.WARNING("  (skip loan — LOAN-DEMO-001 missing; run seed_application_full_demo)"))
        return
    today = date.today()
    amt = Decimal("1500000.00")
    with transaction.atomic():
        d = LoanDisbursement.objects.create(
            loan=lo,
            disbursement_date=today - timedelta(days=45),
            amount=amt,
            reference="COMP-DEMO-DISP-001",
            memo=f"{TAG} COMP-DEMO-LOAN — Initial drawdown",
        )
        if post_loan_disbursement(company_id, d):
            Loan.objects.filter(pk=lo.pk).update(
                total_disbursed=amt,
                outstanding_principal=amt,
                status="active",
            )
        lo.refresh_from_db()
        principal = Decimal("200000.00")
        interest = Decimal("18750.00")
        r = LoanRepayment.objects.create(
            loan=lo,
            repayment_date=today - timedelta(days=15),
            amount=principal + interest,
            principal_amount=principal,
            interest_amount=interest,
            reference="COMP-DEMO-REP-001",
            memo=f"{TAG} COMP-DEMO-LOAN — First instalment",
        )
        if post_loan_repayment(company_id, r):
            Loan.objects.filter(pk=lo.pk).update(
                total_repaid_principal=F("total_repaid_principal") + principal,
                outstanding_principal=F("outstanding_principal") - principal,
            )
    stdout.write(style.SUCCESS("  + Loan LOAN-DEMO-001: disbursement + repayment posted"))


def _ensure_fish_mortality(company_id: int, stdout: TextIO, style: Any) -> None:
    if AquacultureFishStockLedger.objects.filter(memo__contains="COMP-DEMO-MORTALITY").exists():
        stdout.write("  . COMP-DEMO mortality rows already present.")
        return
    pond = AquaculturePond.objects.filter(company_id=company_id, name__iexact="Ashari-2").first()
    if not pond:
        pond = AquaculturePond.objects.filter(company_id=company_id, is_active=True).first()
    if not pond:
        return
    cy = AquacultureProductionCycle.objects.filter(company_id=company_id, pond=pond, is_active=True).first()
    today = date.today()
    rows = [
        ("predator_other", 120, Decimal("18.0000"), "tilapia"),
        ("disease", 85, Decimal("12.5000"), "tilapia"),
        ("mortality", 40, Decimal("6.2000"), "rui"),
    ]
    for reason, cnt, kg, species in rows:
        AquacultureFishStockLedger.objects.create(
            company_id=company_id,
            pond=pond,
            production_cycle=cy,
            entry_date=today - timedelta(days=9),
            entry_kind="loss",
            loss_reason=reason,
            fish_species=species,
            fish_count_delta=-cnt,
            weight_kg_delta=-kg,
            book_value=Decimal("0"),
            post_to_books=False,
            memo=f"{TAG} COMP-DEMO-MORTALITY — {reason}",
        )
    stdout.write(style.SUCCESS(f"  + Fish mortality / loss ledger: {len(rows)} rows"))


def _ensure_fund_transfer(company_id: int, stdout: TextIO, style: Any) -> None:
    if FundTransfer.objects.filter(reference__contains="COMP-DEMO-FT").exists():
        stdout.write("  . COMP-DEMO fund transfer already present.")
        return
    banks = list(BankAccount.objects.filter(company_id=company_id, is_active=True).order_by("id")[:2])
    if len(banks) < 2:
        stdout.write(style.WARNING("  (skip fund transfer — need 2 bank accounts)"))
        return
    today = date.today()
    ft = FundTransfer.objects.create(
        company_id=company_id,
        from_bank_id=banks[0].id,
        to_bank_id=banks[1].id,
        amount=Decimal("75000.00"),
        transfer_date=today - timedelta(days=7),
        reference=f"{TAG} COMP-DEMO-FT — Operating to till float",
        is_posted=True,
        posted_at=django_timezone.now(),
    )
    if not banks[0].chart_account_id:
        BankAccount.objects.filter(pk=banks[0].id).update(
            current_balance=F("current_balance") - Decimal("75000.00")
        )
    if not banks[1].chart_account_id:
        BankAccount.objects.filter(pk=banks[1].id).update(
            current_balance=F("current_balance") + Decimal("75000.00")
        )
    post_fund_transfer_journal(company_id, ft)
    stdout.write(style.SUCCESS("  + Posted fund transfer between bank registers"))


def _ensure_tank_dip_history(company_id: int, stdout: TextIO, style: Any) -> None:
    if TankDip.objects.filter(notes__contains="COMP-DEMO-DIP").exists():
        stdout.write("  . COMP-DEMO tank dip history already present.")
        return
    tanks = list(Tank.objects.filter(company_id=company_id, is_active=True).order_by("id")[:3])
    if not tanks:
        return
    today = date.today()
    n = 0
    for t in tanks:
        base = t.current_stock or Decimal("4000")
        for days_ago in (7, 5, 3, 1):
            d = today - timedelta(days=days_ago)
            if TankDip.objects.filter(tank_id=t.id, dip_date=d).exists():
                continue
            vol = (base - Decimal(days_ago * 35)).quantize(Decimal("0.0001"))
            TankDip.objects.create(
                company_id=company_id,
                tank_id=t.id,
                dip_date=d,
                volume=max(vol, Decimal("500")),
                book_stock_before=vol + Decimal("25"),
                notes=f"{TAG} COMP-DEMO-DIP — weekly stick reading",
            )
            n += 1
    stdout.write(style.SUCCESS(f"  + Tank dip history rows: {n}"))


def _ensure_pl_openings_and_data_bank(company_id: int, stdout: TextIO, style: Any) -> None:
    from api.models import AquacultureDataBankPondClose, AquaculturePondPlOpening

    pond = AquaculturePond.objects.filter(company_id=company_id, name__iexact="Digonta").first()
    if not pond:
        return
    today = date.today()
    n_open = 0
    for kind, code, amt in (
        (AquaculturePondPlOpening.KIND_INCOME, "fish_harvest_sale", "125000.00"),
        (AquaculturePondPlOpening.KIND_EXPENSE, "feed_purchase", "88000.00"),
        (AquaculturePondPlOpening.KIND_EXPENSE, "fry_stocking", "420000.00"),
    ):
        _, created = AquaculturePondPlOpening.objects.get_or_create(
            company_id=company_id,
            pond=pond,
            pl_kind=kind,
            category_code=code,
            defaults={
                "amount": Decimal(amt),
                "as_of_date": today.replace(month=1, day=1),
                "memo": f"{TAG} Go-live opening balance",
            },
        )
        if created:
            n_open += 1
    _, created_close = AquacultureDataBankPondClose.objects.get_or_create(
        company_id=company_id,
        pond=pond,
        label="Digonta — prior season archive",
        defaults={
            "period_start": today.replace(year=today.year - 1, month=6, day=1),
            "period_end": today.replace(year=today.year - 1, month=12, day=31),
            "status": AquacultureDataBankPondClose.STATUS_CLOSED,
            "is_data_locked": False,
            "reference_access_enabled": True,
            "notes": f"{TAG} Sample archived season for Data Bank UI",
        },
    )
    parts = []
    if n_open:
        parts.append(f"{n_open} P&L openings")
    if created_close:
        parts.append("1 data-bank close")
    if parts:
        stdout.write(style.SUCCESS(f"  + Aquaculture go-live / data bank: {', '.join(parts)}"))
    elif AquaculturePondPlOpening.objects.filter(company_id=company_id, memo__contains=TAG).exists():
        stdout.write("  . COMP-DEMO P&L openings / data bank already present.")


def run_comprehensive_demo(company_id: int, stdout: TextIO, style: Any) -> None:
    """Layer rich COMP-DEMO data on an already-seeded Master company."""
    stdout.write(style.NOTICE("==> Comprehensive demo layer (COMP-DEMO)"))
    _ensure_fuel_products(company_id, stdout, style)
    _ensure_octane_forecourt(company_id, stdout, style)
    _ensure_shop_products(company_id, stdout, style)
    _ensure_fry_and_feed_items(company_id, stdout, style)
    _ensure_station_stock(company_id, stdout, style)
    _ensure_customers_vendors(company_id, stdout, style)
    _ensure_landlords(company_id, stdout, style)
    _ensure_fingerling_and_samples(company_id, stdout, style)
    _ensure_extra_harvests(company_id, stdout, style)
    _ensure_aquaculture_expenses(company_id, stdout, style)
    _ensure_invoices(company_id, stdout, style)
    _ensure_posted_bills(company_id, stdout, style)
    _ensure_payments_and_deposits(company_id, stdout, style)
    _ensure_shift_sessions(company_id, stdout, style)
    _ensure_inventory_transfer(company_id, stdout, style)
    _ensure_pond_warehouse_flow(company_id, stdout, style)
    _ensure_landlord_ledger(company_id, stdout, style)
    _ensure_loan_activity(company_id, stdout, style)
    _ensure_fish_mortality(company_id, stdout, style)
    _ensure_fund_transfer(company_id, stdout, style)
    _ensure_tank_dip_history(company_id, stdout, style)
    _ensure_pl_openings_and_data_bank(company_id, stdout, style)
    _ensure_payroll(company_id, stdout, style)
