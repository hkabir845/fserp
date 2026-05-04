"""
Add missing infrastructure data (Stations, Islands, Dispensers, Meters, Nozzles)
to existing company without duplicating data
"""
import sys
from datetime import datetime, date
from decimal import Decimal

from sqlalchemy.orm import Session
from app.database import SessionLocal, engine
from app.models.base import Base
from app.models.company import Company
from app.models.station import Station
from app.models.island import Island
from app.models.dispenser import Dispenser
from app.models.meter import Meter
from app.models.nozzle import Nozzle
from app.models.tank import Tank
from app.models.item import Item, ItemType

def add_infrastructure():
    """Add missing infrastructure data to existing company"""
    
    print("\n" + "="*80)
    print("ADDING INFRASTRUCTURE DATA")
    print("="*80 + "\n")
    
    db = SessionLocal()
    
    try:
        # Get existing company
        company = db.query(Company).first()
        if not company:
            print("ERROR: No company found. Please run init_comprehensive_data.py first.")
            return
        
        company_id = company.id
        print(f"Found company: {company.name} (ID: {company_id})\n")
        
        # Check if station exists
        station = db.query(Station).filter(Station.company_id == company_id).first()
        if not station:
            print("Creating Station...")
            station = Station(
                station_number="STN-0001",
                station_name="Main Station - Highway 101",
                address_line1="101 Highway Road",
                city="Metro City",
                state="State Province",
                postal_code="12345",
                phone="+1-555-0101",
                company_id=company_id,
                is_active=True
            )
            db.add(station)
            db.flush()
            print(f"[OK] Station created: {station.station_name}\n")
        else:
            print(f"[SKIP] Station already exists: {station.station_name}\n")
        
        # Get or create products
        products = db.query(Item).filter(
            Item.company_id == company_id,
            Item.item_type == ItemType.INVENTORY
        ).all()
        
        if len(products) < 3:
            print("Creating Products...")
            products_data = [
                {
                    "item_number": "FUEL-001",
                    "name": "Premium Octane 95",
                    "description": "High-grade premium octane fuel 95 RON",
                    "item_type": ItemType.INVENTORY,
                    "unit_price": Decimal("4.50"),
                    "cost": Decimal("3.20"),
                    "quantity_on_hand": Decimal("35000.00"),
                    "unit": "Liters"
                },
                {
                    "item_number": "FUEL-002",
                    "name": "Regular Diesel",
                    "description": "Standard diesel fuel",
                    "item_type": ItemType.INVENTORY,
                    "unit_price": Decimal("3.80"),
                    "cost": Decimal("2.80"),
                    "quantity_on_hand": Decimal("42000.00"),
                    "unit": "Liters"
                },
                {
                    "item_number": "FUEL-003",
                    "name": "LPG (Liquefied Petroleum Gas)",
                    "description": "Autogas LPG for vehicles",
                    "item_type": ItemType.INVENTORY,
                    "unit_price": Decimal("2.50"),
                    "cost": Decimal("1.80"),
                    "quantity_on_hand": Decimal("18000.00"),
                    "unit": "Liters"
                }
            ]
            
            for prod_data in products_data:
                existing = db.query(Item).filter(
                    Item.item_number == prod_data["item_number"],
                    Item.company_id == company_id
                ).first()
                if not existing:
                    product = Item(**prod_data, company_id=company_id, is_active=True)
                    db.add(product)
                    print(f"  [OK] Created: {prod_data['name']}")
            
            db.flush()
            products = db.query(Item).filter(
                Item.company_id == company_id,
                Item.item_type == ItemType.INVENTORY
            ).all()
        
        if len(products) < 3:
            print("[ERROR] Need at least 3 fuel products. Please check products.")
            return
        
        # Create tanks
        tanks = db.query(Tank).filter(Tank.company_id == company_id).all()
        if len(tanks) < 3:
            print("Creating Tanks...")
            tanks_data = [
                {
                    "tank_number": "TNK-0001",
                    "tank_name": "Octane Storage Tank",
                    "product": products[0],
                    "capacity": Decimal("50000.00"),
                    "current_stock": Decimal("35000.00"),
                    "min_level": Decimal("5000.00")
                },
                {
                    "tank_number": "TNK-0002",
                    "tank_name": "Diesel Storage Tank",
                    "product": products[1] if len(products) > 1 else products[0],
                    "capacity": Decimal("60000.00"),
                    "current_stock": Decimal("42000.00"),
                    "min_level": Decimal("8000.00")
                },
                {
                    "tank_number": "TNK-0003",
                    "tank_name": "LPG Storage Tank",
                    "product": products[2] if len(products) > 2 else products[0],
                    "capacity": Decimal("30000.00"),
                    "current_stock": Decimal("18000.00"),
                    "min_level": Decimal("3000.00")
                }
            ]
            
            for tank_data in tanks_data:
                existing = db.query(Tank).filter(
                    Tank.tank_number == tank_data["tank_number"],
                    Tank.company_id == company_id
                ).first()
                if not existing:
                    product = tank_data.pop("product")
                    tank = Tank(
                        **tank_data,
                        station_id=station.id,
                        product_id=product.id,
                        company_id=company_id,
                        is_active=1
                    )
                    db.add(tank)
                    print(f"  [OK] Created: {tank_data['tank_name']}")
            
            db.flush()
            tanks = db.query(Tank).filter(Tank.company_id == company_id).all()
        
        print(f"[OK] Tanks: {len(tanks)} tanks\n")
        
        # Create islands
        islands = db.query(Island).filter(Island.company_id == company_id).all()
        if len(islands) < 2:
            print("Creating Islands...")
            islands_data = [
                {
                    "island_number": "ISL-0001",
                    "island_name": "Island 1 - North Side",
                    "location_description": "North side of station, near entrance"
                },
                {
                    "island_number": "ISL-0002",
                    "island_name": "Island 2 - South Side",
                    "location_description": "South side of station, near exit"
                }
            ]
            
            for island_data in islands_data:
                existing = db.query(Island).filter(
                    Island.island_number == island_data["island_number"],
                    Island.company_id == company_id
                ).first()
                if not existing:
                    island = Island(
                        **island_data,
                        station_id=station.id,
                        company_id=company_id,
                        is_active=True
                    )
                    db.add(island)
                    print(f"  [OK] Created: {island_data['island_name']}")
            
            db.flush()
            islands = db.query(Island).filter(Island.company_id == company_id).all()
        
        print(f"[OK] Islands: {len(islands)} islands\n")
        
        # Create dispensers
        dispensers = db.query(Dispenser).filter(Dispenser.company_id == company_id).all()
        if len(dispensers) < 4:
            print("Creating Dispensers...")
            dispensers_data = [
                {"dispenser_number": "DSP-0001", "dispenser_name": "Dispenser 1A", "island": islands[0], "model": "Wayne Vista", "serial_number": "WV-2024-001"},
                {"dispenser_number": "DSP-0002", "dispenser_name": "Dispenser 1B", "island": islands[0], "model": "Wayne Vista", "serial_number": "WV-2024-002"},
                {"dispenser_number": "DSP-0003", "dispenser_name": "Dispenser 2A", "island": islands[1] if len(islands) > 1 else islands[0], "model": "Gilbarco Encore", "serial_number": "GE-2024-003"},
                {"dispenser_number": "DSP-0004", "dispenser_name": "Dispenser 2B", "island": islands[1] if len(islands) > 1 else islands[0], "model": "Gilbarco Encore", "serial_number": "GE-2024-004"},
            ]
            
            for disp_data in dispensers_data:
                existing = db.query(Dispenser).filter(
                    Dispenser.dispenser_number == disp_data["dispenser_number"],
                    Dispenser.company_id == company_id
                ).first()
                if not existing:
                    island = disp_data.pop("island")
                    dispenser = Dispenser(
                        **disp_data,
                        island_id=island.id,
                        company_id=company_id,
                        is_active=True,
                        manufacturer="Wayne/Gilbarco"
                    )
                    db.add(dispenser)
                    print(f"  [OK] Created: {disp_data['dispenser_name']}")
            
            db.flush()
            dispensers = db.query(Dispenser).filter(Dispenser.company_id == company_id).all()
        
        print(f"[OK] Dispensers: {len(dispensers)} dispensers\n")
        
        # Create meters
        meters = db.query(Meter).filter(Meter.company_id == company_id).all()
        if len(meters) < 12:
            print("Creating Meters...")
            meters_data = [
                # Dispenser 1A (DSP-0001) - 3 meters
                {"meter_number": "MTR-0001", "meter_name": "Meter 1A-Octane", "dispenser": dispensers[0], "opening_reading": Decimal("10000.00")},
                {"meter_number": "MTR-0002", "meter_name": "Meter 1A-Diesel", "dispenser": dispensers[0], "opening_reading": Decimal("8500.00")},
                {"meter_number": "MTR-0003", "meter_name": "Meter 1A-LPG", "dispenser": dispensers[0], "opening_reading": Decimal("5200.00")},
                
                # Dispenser 1B (DSP-0002) - 3 meters
                {"meter_number": "MTR-0004", "meter_name": "Meter 1B-Octane", "dispenser": dispensers[1] if len(dispensers) > 1 else dispensers[0], "opening_reading": Decimal("9800.00")},
                {"meter_number": "MTR-0005", "meter_name": "Meter 1B-Diesel", "dispenser": dispensers[1] if len(dispensers) > 1 else dispensers[0], "opening_reading": Decimal("11200.00")},
                {"meter_number": "MTR-0006", "meter_name": "Meter 1B-LPG", "dispenser": dispensers[1] if len(dispensers) > 1 else dispensers[0], "opening_reading": Decimal("4800.00")},
                
                # Dispenser 2A (DSP-0003) - 3 meters
                {"meter_number": "MTR-0007", "meter_name": "Meter 2A-Octane", "dispenser": dispensers[2] if len(dispensers) > 2 else dispensers[0], "opening_reading": Decimal("7500.00")},
                {"meter_number": "MTR-0008", "meter_name": "Meter 2A-Diesel", "dispenser": dispensers[2] if len(dispensers) > 2 else dispensers[0], "opening_reading": Decimal("9300.00")},
                {"meter_number": "MTR-0009", "meter_name": "Meter 2A-LPG", "dispenser": dispensers[2] if len(dispensers) > 2 else dispensers[0], "opening_reading": Decimal("6100.00")},
                
                # Dispenser 2B (DSP-0004) - 3 meters
                {"meter_number": "MTR-0010", "meter_name": "Meter 2B-Octane", "dispenser": dispensers[3] if len(dispensers) > 3 else dispensers[0], "opening_reading": Decimal("8900.00")},
                {"meter_number": "MTR-0011", "meter_name": "Meter 2B-Diesel", "dispenser": dispensers[3] if len(dispensers) > 3 else dispensers[0], "opening_reading": Decimal("10500.00")},
                {"meter_number": "MTR-0012", "meter_name": "Meter 2B-LPG", "dispenser": dispensers[3] if len(dispensers) > 3 else dispensers[0], "opening_reading": Decimal("5500.00")},
            ]
            
            for meter_data in meters_data:
                existing = db.query(Meter).filter(
                    Meter.meter_number == meter_data["meter_number"],
                    Meter.company_id == company_id
                ).first()
                if not existing:
                    dispenser = meter_data.pop("dispenser")
                    meter = Meter(
                        **meter_data,
                        dispenser_id=dispenser.id,
                        current_reading=meter_data["opening_reading"],
                        company_id=company_id
                    )
                    db.add(meter)
                    print(f"  [OK] Created: {meter_data['meter_name']}")
            
            db.flush()
            meters = db.query(Meter).filter(Meter.company_id == company_id).all()
        
        print(f"[OK] Meters: {len(meters)} meters\n")
        
        # Create nozzles
        nozzles = db.query(Nozzle).filter(Nozzle.company_id == company_id).all()
        if len(nozzles) < 12:
            print("Creating Nozzles...")
            nozzles_data = [
                # Octane nozzles
                {"nozzle_name": "Premium Octane Nozzle 1", "meter": meters[0], "tank": tanks[0], "color": "#FF6B35"},
                {"nozzle_name": "Premium Octane Nozzle 2", "meter": meters[3] if len(meters) > 3 else meters[0], "tank": tanks[0], "color": "#FF6B35"},
                {"nozzle_name": "Premium Octane Nozzle 3", "meter": meters[6] if len(meters) > 6 else meters[0], "tank": tanks[0], "color": "#FF6B35"},
                {"nozzle_name": "Premium Octane Nozzle 4", "meter": meters[9] if len(meters) > 9 else meters[0], "tank": tanks[0], "color": "#FF6B35"},
                
                # Diesel nozzles
                {"nozzle_name": "Diesel Nozzle 1", "meter": meters[1] if len(meters) > 1 else meters[0], "tank": tanks[1] if len(tanks) > 1 else tanks[0], "color": "#4ECDC4"},
                {"nozzle_name": "Diesel Nozzle 2", "meter": meters[4] if len(meters) > 4 else meters[0], "tank": tanks[1] if len(tanks) > 1 else tanks[0], "color": "#4ECDC4"},
                {"nozzle_name": "Diesel Nozzle 3", "meter": meters[7] if len(meters) > 7 else meters[0], "tank": tanks[1] if len(tanks) > 1 else tanks[0], "color": "#4ECDC4"},
                {"nozzle_name": "Diesel Nozzle 4", "meter": meters[10] if len(meters) > 10 else meters[0], "tank": tanks[1] if len(tanks) > 1 else tanks[0], "color": "#4ECDC4"},
                
                # LPG nozzles
                {"nozzle_name": "LPG Nozzle 1", "meter": meters[2] if len(meters) > 2 else meters[0], "tank": tanks[2] if len(tanks) > 2 else tanks[0], "color": "#FFE66D"},
                {"nozzle_name": "LPG Nozzle 2", "meter": meters[5] if len(meters) > 5 else meters[0], "tank": tanks[2] if len(tanks) > 2 else tanks[0], "color": "#FFE66D"},
                {"nozzle_name": "LPG Nozzle 3", "meter": meters[8] if len(meters) > 8 else meters[0], "tank": tanks[2] if len(tanks) > 2 else tanks[0], "color": "#FFE66D"},
                {"nozzle_name": "LPG Nozzle 4", "meter": meters[11] if len(meters) > 11 else meters[0], "tank": tanks[2] if len(tanks) > 2 else tanks[0], "color": "#FFE66D"},
            ]
            
            for idx, nozzle_data in enumerate(nozzles_data):
                meter = nozzle_data.get("meter")
                tank = nozzle_data.get("tank")
                color = nozzle_data.get("color")
                nozzle_name = nozzle_data.get("nozzle_name")
                
                if not meter or not tank:
                    continue
                
                # Check if nozzle already exists for this meter
                existing = db.query(Nozzle).filter(
                    Nozzle.meter_id == meter.id,
                    Nozzle.company_id == company_id
                ).first()
                
                if not existing:
                    # Auto-generate nozzle number based on meter
                    meter_seq = meter.meter_number.split('-')[-1]
                    nozzle_number = f"NOZ-{meter_seq}-A"
                    
                    nozzle = Nozzle(
                        nozzle_number=nozzle_number,
                        nozzle_name=nozzle_name,
                        meter_id=meter.id,
                        tank_id=tank.id,
                        color_code=color,
                        company_id=company_id,
                        is_operational="Y"
                    )
                    db.add(nozzle)
                    print(f"  [OK] Created: {nozzle_name} ({nozzle_number})")
            
            db.flush()
            nozzles = db.query(Nozzle).filter(Nozzle.company_id == company_id).all()
        
        print(f"[OK] Nozzles: {len(nozzles)} nozzles\n")
        
        # Commit all changes
        db.commit()
        
        print("="*80)
        print("INFRASTRUCTURE DATA ADDED SUCCESSFULLY!")
        print("="*80)
        print(f"\nSummary:")
        print(f"  Stations:    {db.query(Station).filter(Station.company_id == company_id).count()}")
        print(f"  Tanks:       {len(tanks)}")
        print(f"  Islands:     {len(islands)}")
        print(f"  Dispensers:  {len(dispensers)}")
        print(f"  Meters:      {len(meters)}")
        print(f"  Nozzles:     {len(nozzles)}")
        print("\n" + "="*80 + "\n")
        
    except Exception as e:
        print(f"\nERROR: {str(e)}")
        db.rollback()
        raise
    finally:
        db.close()

if __name__ == "__main__":
    add_infrastructure()

