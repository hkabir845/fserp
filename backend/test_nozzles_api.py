"""
Test script to verify nozzles API endpoint
"""
from app.database import SessionLocal
from app.models.nozzle import Nozzle
from app.models.meter import Meter
from app.models.dispenser import Dispenser
from app.models.island import Island
from app.models.station import Station
from app.models.tank import Tank
from app.models.item import Item
from app.models.user import User
from app.models.company import Company

def test_nozzles_data():
    db = SessionLocal()
    try:
        # Get first company
        company = db.query(Company).first()
        if not company:
            print("ERROR: No company found!")
            return
        
        print(f"Company: {company.name} (ID: {company.id})")
        
        # Get nozzles for this company
        nozzles = db.query(Nozzle).filter(Nozzle.company_id == company.id).all()
        print(f"\nTotal nozzles: {len(nozzles)}")
        
        if len(nozzles) == 0:
            print("ERROR: No nozzles found!")
            return
        
        # Check first nozzle's relationships
        nozzle = nozzles[0]
        print(f"\nFirst nozzle: {nozzle.nozzle_number}")
        print(f"  Meter ID: {nozzle.meter_id}")
        print(f"  Tank ID: {nozzle.tank_id}")
        print(f"  Operational: {nozzle.is_operational}")
        
        # Check meter
        meter = db.query(Meter).filter(Meter.id == nozzle.meter_id).first()
        if meter:
            print(f"  Meter: {meter.meter_number} (reading: {meter.current_reading})")
            
            # Check dispenser
            dispenser = db.query(Dispenser).filter(Dispenser.id == meter.dispenser_id).first()
            if dispenser:
                print(f"  Dispenser: {dispenser.dispenser_number}")
                
                # Check island
                island = db.query(Island).filter(Island.id == dispenser.island_id).first()
                if island:
                    print(f"  Island: {island.island_number}")
                else:
                    print("  ERROR: No island found!")
            else:
                print("  ERROR: No dispenser found!")
        else:
            print("  ERROR: No meter found!")
        
        # Check tank
        tank = db.query(Tank).filter(Tank.id == nozzle.tank_id).first()
        if tank:
            print(f"  Tank: {tank.tank_number} (stock: {tank.current_stock}L)")
            
            # Check product
            product = db.query(Item).filter(Item.id == tank.product_id).first()
            if product:
                print(f"  Product: {product.name} (price: ${product.unit_price})")
            else:
                print("  ERROR: No product found!")
        else:
            print("  ERROR: No tank found!")
        
        # Check all nozzles
        print("\nAll nozzles:")
        for n in nozzles:
            meter = db.query(Meter).filter(Meter.id == n.meter_id).first()
            tank = db.query(Tank).filter(Tank.id == n.tank_id).first()
            print(f"  {n.nozzle_number}: Meter={meter.meter_number if meter else 'N/A'}, Tank={tank.tank_number if tank else 'N/A'}, Op={n.is_operational}")
        
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    test_nozzles_data()

