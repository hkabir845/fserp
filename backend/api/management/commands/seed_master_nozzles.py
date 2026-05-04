"""
Seed Master Filling Station with stations, tanks, fuel items, islands, dispensers, meters, and nozzles.
Usage: python manage.py seed_master_nozzles
"""
from decimal import Decimal
from django.core.management.base import BaseCommand
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
from api.services.station_capabilities import reconcile_station_fuel_flags_for_company


class Command(BaseCommand):
    help = "Create stations, tanks, fuel items, islands, dispensers, meters, and nozzles for Master Filling Station."

    def add_arguments(self, parser):
        parser.add_argument(
            "--replace",
            action="store_true",
            help="Delete existing nozzles/meters/dispensers/islands/tanks/station/items for Master Filling Station before seeding.",
        )

    def handle(self, *args, **options):
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
        if created:
            self.stdout.write(self.style.SUCCESS("Created company: Master Filling Station"))
        else:
            master.is_master = "true"
            master.save()
            self.stdout.write("Using company: Master Filling Station")

        cid = master.id
        if options.get("replace"):
            Nozzle.objects.filter(company_id=cid).delete()
            Meter.objects.filter(company_id=cid).delete()
            Dispenser.objects.filter(company_id=cid).delete()
            Island.objects.filter(company_id=cid).delete()
            Tank.objects.filter(company_id=cid).delete()
            Station.objects.filter(company_id=cid).delete()
            Item.objects.filter(company_id=cid, pos_category="fuel").delete()
            self.stdout.write(self.style.WARNING("Cleared existing nozzles hierarchy for Master Filling Station."))

        # Fuel products
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
        self.stdout.write(f"  Items: Diesel (id={diesel.id}), Petrol (id={petrol.id})")

        # Station
        station, created = Station.objects.get_or_create(
            company_id=cid,
            station_name="Main Station",
            defaults={
                "address_line1": "Mouchak-Fulbaria Road",
                "city": "Gazipur",
                "is_active": True,
                "operates_fuel_retail": True,
            },
        )
        if not station.station_number:
            station.station_number = f"STN-{station.id}"
            station.save(update_fields=["station_number"])
        self.stdout.write(f"  Station: {station.station_name} (id={station.id})")

        # Tanks (one per product)
        tank_diesel, _ = Tank.objects.get_or_create(
            company_id=cid,
            station_id=station.id,
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
        tank_petrol, _ = Tank.objects.get_or_create(
            company_id=cid,
            station_id=station.id,
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
        self.stdout.write(f"  Tanks: {tank_diesel.tank_name}, {tank_petrol.tank_name}")

        # Island
        island, _ = Island.objects.get_or_create(
            company_id=cid,
            station_id=station.id,
            island_name="Island 1",
            defaults={"island_code": "ISL-1", "is_active": True},
        )
        self.stdout.write(f"  Island: {island.island_name} (id={island.id})")

        # Dispenser
        dispenser, _ = Dispenser.objects.get_or_create(
            company_id=cid,
            island_id=island.id,
            dispenser_name="Dispenser 1",
            defaults={"dispenser_code": "DSP-1", "is_active": True},
        )
        self.stdout.write(f"  Dispenser: {dispenser.dispenser_name} (id={dispenser.id})")

        # Meters (one per fuel type)
        meter_diesel, _ = Meter.objects.get_or_create(
            company_id=cid,
            dispenser_id=dispenser.id,
            meter_name="Diesel Meter",
            defaults={
                "meter_number": "M-D-01",
                "current_reading": Decimal("0"),
                "is_active": True,
            },
        )
        meter_petrol, _ = Meter.objects.get_or_create(
            company_id=cid,
            dispenser_id=dispenser.id,
            meter_name="Petrol Meter",
            defaults={
                "meter_number": "M-P-01",
                "current_reading": Decimal("0"),
                "is_active": True,
            },
        )
        self.stdout.write(f"  Meters: {meter_diesel.meter_name}, {meter_petrol.meter_name}")

        # Nozzles
        n1, c1 = Nozzle.objects.get_or_create(
            company_id=cid,
            meter_id=meter_diesel.id,
            tank_id=tank_diesel.id,
            defaults={
                "product_id": diesel.id,
                "nozzle_number": "NZ-D-01",
                "nozzle_name": "Diesel Meter - Diesel",
                "color_code": "#EAB308",
                "is_operational": True,
                "is_active": True,
            },
        )
        n2, c2 = Nozzle.objects.get_or_create(
            company_id=cid,
            meter_id=meter_petrol.id,
            tank_id=tank_petrol.id,
            defaults={
                "product_id": petrol.id,
                "nozzle_number": "NZ-P-01",
                "nozzle_name": "Petrol Meter - Petrol",
                "color_code": "#DC2626",
                "is_operational": True,
                "is_active": True,
            },
        )
        created_nozzles = sum([c1, c2])
        fixed = reconcile_station_fuel_flags_for_company(cid)
        if fixed:
            self.stdout.write(self.style.WARNING(f"  Reconciled operates_fuel_retail for {fixed} station(s) with forecourt assets."))
        self.stdout.write(self.style.SUCCESS(
            f"Done. Nozzles for Master Filling Station: {Nozzle.objects.filter(company_id=cid).count()} total ({created_nozzles} created this run)."
        ))
