"""
Assign ALL existing Stations, Tanks, Islands, Dispensers, Meters, and Nozzles
in the database to Master Filling Station. If none exist, seed comprehensive sample data.
Usage: python manage.py pull_master_station_data
"""
from decimal import Decimal
from django.core.management.base import BaseCommand
from django.db import transaction
from api.models import (
    Company,
    Station,
    Item,
    Tank,
    Island,
    Dispenser,
    Meter,
    Nozzle,
)


def get_or_create_master():
    master, created = Company.objects.get_or_create(
        name="Master Filling Station",
        is_deleted=False,
        defaults={
            "legal_name": "Master Filling Station (Development)",
            "currency": "BDT",
            "is_active": True,
            "is_master": "true",
        },
    )
    if not created:
        master.is_master = "true"
        master.save()
    return master


def seed_full_sample(cid):
    """Create comprehensive sample: 2 stations, islands, dispensers, tanks, meters, nozzles."""
    # Fuel items
    diesel, _ = Item.objects.get_or_create(
        company_id=cid,
        name="Diesel",
        defaults={
            "item_type": "inventory",
            "unit": "L",
            "pos_category": "fuel",
            "unit_price": Decimal("114.00"),
            "quantity_on_hand": Decimal("0"),
            "is_pos_available": True,
            "is_active": True,
        },
    )
    if not (diesel.item_number or "").strip():
        diesel.item_number = f"ITM-{diesel.id}"
        diesel.save(update_fields=["item_number"])
    petrol, _ = Item.objects.get_or_create(
        company_id=cid,
        name="Petrol",
        defaults={
            "item_type": "inventory",
            "unit": "L",
            "pos_category": "fuel",
            "unit_price": Decimal("135.00"),
            "quantity_on_hand": Decimal("0"),
            "is_pos_available": True,
            "is_active": True,
        },
    )
    if not (petrol.item_number or "").strip():
        petrol.item_number = f"ITM-{petrol.id}"
        petrol.save(update_fields=["item_number"])

    created = []

    # Station 1 + Island 1 + Dispenser 1 + 2 Meters + 2 Tanks + 2 Nozzles
    s1, _ = Station.objects.get_or_create(
        company_id=cid,
        station_name="Main Station",
        defaults={
            "address_line1": "Mouchak-Fulbaria Road",
            "city": "Gazipur",
            "is_active": True,
        },
    )
    if not s1.station_number:
        s1.station_number = f"STN-{s1.id}"
        s1.save(update_fields=["station_number"])
    created.append(f"Station: {s1.station_name}")

    t1d, _ = Tank.objects.get_or_create(
        company_id=cid,
        station_id=s1.id,
        tank_name="Diesel Tank 1",
        defaults={
            "product_id": diesel.id,
            "tank_number": "T-D-01",
            "capacity": Decimal("20000"),
            "current_stock": Decimal("5000"),
            "unit_of_measure": "L",
            "is_active": True,
        },
    )
    t1p, _ = Tank.objects.get_or_create(
        company_id=cid,
        station_id=s1.id,
        tank_name="Petrol Tank 1",
        defaults={
            "product_id": petrol.id,
            "tank_number": "T-P-01",
            "capacity": Decimal("15000"),
            "current_stock": Decimal("3000"),
            "unit_of_measure": "L",
            "is_active": True,
        },
    )
    created.append("Tanks: Diesel Tank 1, Petrol Tank 1")

    i1, _ = Island.objects.get_or_create(
        company_id=cid,
        station_id=s1.id,
        island_name="Island 1",
        defaults={"island_code": "ISL-1", "is_active": True},
    )
    created.append("Island 1")

    d1, _ = Dispenser.objects.get_or_create(
        company_id=cid,
        island_id=i1.id,
        dispenser_name="Dispenser 1",
        defaults={"dispenser_code": "DSP-1", "is_active": True},
    )
    created.append("Dispenser 1")

    m1d, _ = Meter.objects.get_or_create(
        company_id=cid,
        dispenser_id=d1.id,
        meter_name="Diesel Meter",
        defaults={"meter_number": "M-D-01", "current_reading": Decimal("0"), "is_active": True},
    )
    m1p, _ = Meter.objects.get_or_create(
        company_id=cid,
        dispenser_id=d1.id,
        meter_name="Petrol Meter",
        defaults={"meter_number": "M-P-01", "current_reading": Decimal("0"), "is_active": True},
    )
    created.append("Meters: Diesel Meter, Petrol Meter")

    Nozzle.objects.get_or_create(
        company_id=cid,
        meter_id=m1d.id,
        tank_id=t1d.id,
        defaults={
            "product_id": diesel.id,
            "nozzle_number": "NZ-D-01",
            "nozzle_name": "Diesel Meter - Diesel",
            "color_code": "#EAB308",
            "is_operational": True,
            "is_active": True,
        },
    )
    Nozzle.objects.get_or_create(
        company_id=cid,
        meter_id=m1p.id,
        tank_id=t1p.id,
        defaults={
            "product_id": petrol.id,
            "nozzle_number": "NZ-P-01",
            "nozzle_name": "Petrol Meter - Petrol",
            "color_code": "#DC2626",
            "is_operational": True,
            "is_active": True,
        },
    )
    created.append("Nozzles: NZ-D-01, NZ-P-01")

    # Station 2 + Island 2 + Dispenser 2 + 2 Meters + 2 Tanks + 2 Nozzles
    s2, _ = Station.objects.get_or_create(
        company_id=cid,
        station_name="North Station",
        defaults={
            "address_line1": "Kaliakoir",
            "city": "Gazipur",
            "is_active": True,
        },
    )
    if not s2.station_number:
        s2.station_number = f"STN-{s2.id}"
        s2.save(update_fields=["station_number"])
    created.append("Station: North Station")

    t2d, _ = Tank.objects.get_or_create(
        company_id=cid,
        station_id=s2.id,
        tank_name="Diesel Tank 2",
        defaults={
            "product_id": diesel.id,
            "tank_number": "T-D-02",
            "capacity": Decimal("18000"),
            "current_stock": Decimal("4000"),
            "unit_of_measure": "L",
            "is_active": True,
        },
    )
    t2p, _ = Tank.objects.get_or_create(
        company_id=cid,
        station_id=s2.id,
        tank_name="Petrol Tank 2",
        defaults={
            "product_id": petrol.id,
            "tank_number": "T-P-02",
            "capacity": Decimal("12000"),
            "current_stock": Decimal("2500"),
            "unit_of_measure": "L",
            "is_active": True,
        },
    )

    i2, _ = Island.objects.get_or_create(
        company_id=cid,
        station_id=s2.id,
        island_name="Island 2",
        defaults={"island_code": "ISL-2", "is_active": True},
    )
    d2, _ = Dispenser.objects.get_or_create(
        company_id=cid,
        island_id=i2.id,
        dispenser_name="Dispenser 2",
        defaults={"dispenser_code": "DSP-2", "is_active": True},
    )
    m2d, _ = Meter.objects.get_or_create(
        company_id=cid,
        dispenser_id=d2.id,
        meter_name="Diesel Meter 2",
        defaults={"meter_number": "M-D-02", "current_reading": Decimal("0"), "is_active": True},
    )
    m2p, _ = Meter.objects.get_or_create(
        company_id=cid,
        dispenser_id=d2.id,
        meter_name="Petrol Meter 2",
        defaults={"meter_number": "M-P-02", "current_reading": Decimal("0"), "is_active": True},
    )
    Nozzle.objects.get_or_create(
        company_id=cid,
        meter_id=m2d.id,
        tank_id=t2d.id,
        defaults={
            "product_id": diesel.id,
            "nozzle_number": "NZ-D-02",
            "nozzle_name": "Diesel Meter 2 - Diesel",
            "color_code": "#EAB308",
            "is_operational": True,
            "is_active": True,
        },
    )
    Nozzle.objects.get_or_create(
        company_id=cid,
        meter_id=m2p.id,
        tank_id=t2p.id,
        defaults={
            "product_id": petrol.id,
            "nozzle_number": "NZ-P-02",
            "nozzle_name": "Petrol Meter 2 - Petrol",
            "color_code": "#DC2626",
            "is_operational": True,
            "is_active": True,
        },
    )
    created.append("North Station: Island 2, Dispenser 2, 2 Meters, 2 Tanks, 2 Nozzles")
    return created


class Command(BaseCommand):
    help = "Pull all Stations, Tanks, Islands, Dispensers, Meters, Nozzles to Master Filling Station. Seed sample data if none exist."

    def add_arguments(self, parser):
        parser.add_argument(
            "--only-reassign",
            action="store_true",
            help="Only reassign existing records to Master Filling Station; do not seed if empty.",
        )
        parser.add_argument(
            "--only-seed",
            action="store_true",
            help="Only run full seed for Master Filling Station (no reassignment).",
        )

    def handle(self, *args, **options):
        master = get_or_create_master()
        cid = master.id
        self.stdout.write("Using company: Master Filling Station (id={})".format(cid))

        if not options.get("only_seed"):
            with transaction.atomic():
                s = Station.objects.exclude(company_id=cid).update(company_id=cid)
                t = Tank.objects.exclude(company_id=cid).update(company_id=cid)
                i = Island.objects.exclude(company_id=cid).update(company_id=cid)
                d = Dispenser.objects.exclude(company_id=cid).update(company_id=cid)
                m = Meter.objects.exclude(company_id=cid).update(company_id=cid)
                n = Nozzle.objects.exclude(company_id=cid).update(company_id=cid)
            self.stdout.write(
                self.style.SUCCESS(
                    "Reassigned to Master Filling Station: {} stations, {} tanks, {} islands, {} dispensers, {} meters, {} nozzles.".format(
                        s, t, i, d, m, n
                    )
                )
            )

        master_stations = Station.objects.filter(company_id=cid).count()
        master_tanks = Tank.objects.filter(company_id=cid).count()
        master_islands = Island.objects.filter(company_id=cid).count()
        master_dispensers = Dispenser.objects.filter(company_id=cid).count()
        master_meters = Meter.objects.filter(company_id=cid).count()
        master_nozzles = Nozzle.objects.filter(company_id=cid).count()

        self.stdout.write(
            "Master Filling Station now has: {} stations, {} tanks, {} islands, {} dispensers, {} meters, {} nozzles.".format(
                master_stations, master_tanks, master_islands, master_dispensers, master_meters, master_nozzles
            )
        )

        if not options.get("only_reassign") and master_stations == 0:
            self.stdout.write(self.style.WARNING("No stations for Master Filling Station. Seeding full sample data..."))
            created = seed_full_sample(cid)
            for msg in created:
                self.stdout.write("  " + msg)
            self.stdout.write(
                self.style.SUCCESS(
                    "Done. Master Filling Station now has: {} stations, {} tanks, {} islands, {} dispensers, {} meters, {} nozzles.".format(
                        Station.objects.filter(company_id=cid).count(),
                        Tank.objects.filter(company_id=cid).count(),
                        Island.objects.filter(company_id=cid).count(),
                        Dispenser.objects.filter(company_id=cid).count(),
                        Meter.objects.filter(company_id=cid).count(),
                        Nozzle.objects.filter(company_id=cid).count(),
                    )
                )
            )
        elif options.get("only_seed"):
            self.stdout.write(self.style.WARNING("Seeding full sample (--only-seed)..."))
            seed_full_sample(cid)
            self.stdout.write(
                self.style.SUCCESS(
                    "Done. Master Filling Station now has: {} stations, {} tanks, {} islands, {} dispensers, {} meters, {} nozzles.".format(
                        Station.objects.filter(company_id=cid).count(),
                        Tank.objects.filter(company_id=cid).count(),
                        Island.objects.filter(company_id=cid).count(),
                        Dispenser.objects.filter(company_id=cid).count(),
                        Meter.objects.filter(company_id=cid).count(),
                        Nozzle.objects.filter(company_id=cid).count(),
                    )
                )
            )
