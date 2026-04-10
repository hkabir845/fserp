"""
Script to create dummy tank dip data for testing the tank dip variance report
"""
import sys
from datetime import datetime, timedelta, date
from decimal import Decimal

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.tank import Tank
from app.models.tank_dip import TankDip
from app.models.user import User, UserRole
from app.models.item import Item

def create_dummy_tank_dips():
    """Create dummy tank dip readings for testing"""
    db: Session = SessionLocal()
    try:
        # Get first admin user for recorded_by
        admin_user = db.query(User).filter(User.role == UserRole.ADMIN).first()
        if not admin_user:
            print("Error: No admin user found. Please create an admin user first.")
            return
        
        # Get all tanks
        tanks = db.query(Tank).all()
        if not tanks:
            print("Error: No tanks found. Please create tanks first.")
            return
        
        print(f"Found {len(tanks)} tanks")
        
        # Get products to calculate unit prices
        products = {tank.product_id: tank.product for tank in tanks if tank.product}
        
        # Create dummy dips for the last 30 days
        today = date.today()
        dips_created = 0
        
        for tank in tanks:
            print(f"Processing tank: {tank.tank_name}")
            
            # Get product unit price for value calculation
            product = products.get(tank.product_id)
            unit_price = Decimal("100.00")  # Default unit price
            if product and product.unit_price:
                unit_price = Decimal(str(product.unit_price))
            
            # Create 2-3 dips per tank over the last 30 days
            num_dips = 3
            for i in range(num_dips):
                # Random date within last 30 days
                days_ago = (num_dips - i) * 10  # Spread out over 30 days
                reading_date = today - timedelta(days=days_ago)
                
                # Current system quantity (use tank's current_stock as base, with some variation)
                base_quantity = Decimal(str(tank.current_stock or 5000))
                
                # Simulate measured quantity with variance
                # For some dips, create GAIN, for others create LOSS
                if i % 2 == 0:
                    # GAIN: measured is higher than system (maybe due to delivery)
                    variance_quantity = Decimal("50.00") + Decimal(str(i * 10))
                    variance_type = "GAIN"
                else:
                    # LOSS: measured is lower than system (evaporation, leakage, etc.)
                    variance_quantity = Decimal("-30.00") - Decimal(str(i * 5))
                    variance_type = "LOSS"
                
                # For GAIN: measured > system, variance is positive
                # For LOSS: measured < system, variance is negative
                if variance_type == "GAIN":
                    measured_quantity = base_quantity + abs(variance_quantity)
                    system_quantity = base_quantity
                else:  # LOSS
                    measured_quantity = base_quantity - abs(variance_quantity)
                    system_quantity = base_quantity
                    # Variance quantity should be negative for LOSS
                    variance_quantity = -abs(variance_quantity)
                
                # Calculate variance value (always positive for reporting)
                variance_value = abs(variance_quantity) * unit_price
                
                # Check if dip already exists for this tank and date
                existing = db.query(TankDip).filter(
                    TankDip.tank_id == tank.id,
                    TankDip.reading_date >= datetime.combine(reading_date, datetime.min.time()),
                    TankDip.reading_date < datetime.combine(reading_date + timedelta(days=1), datetime.min.time())
                ).first()
                
                if existing:
                    print(f"  Dip already exists for {tank.tank_name} on {reading_date}")
                    continue
                
                # Create tank dip
                tank_dip = TankDip(
                    tank_id=tank.id,
                    measured_quantity=measured_quantity,
                    reading_date=datetime.combine(reading_date, datetime.min.time()),
                    recorded_by=admin_user.id,
                    system_quantity=system_quantity,
                    variance_quantity=variance_quantity,
                    variance_value=variance_value,
                    variance_type=variance_type,
                    adjustment_posted=False,
                    notes=f"Dummy dip reading for testing - {variance_type.lower()}"
                )
                
                db.add(tank_dip)
                dips_created += 1
                print(f"  Created dip for {tank.tank_name} on {reading_date}: {variance_type} {abs(variance_quantity)}L (৳{variance_value:.2f})")
        
        db.commit()
        print(f"\n✓ Successfully created {dips_created} tank dip readings")
        print(f"  Total tanks: {len(tanks)}")
        print(f"  Date range: {(today - timedelta(days=30)).isoformat()} to {today.isoformat()}")
        
    except Exception as e:
        db.rollback()
        print(f"Error creating dummy tank dips: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    create_dummy_tank_dips()

