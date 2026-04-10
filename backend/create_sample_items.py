"""
Script to create sample general store items for POS testing
Run this from the backend directory: python create_sample_items.py
"""
import sys
from pathlib import Path

# Add the backend directory to the path
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

from decimal import Decimal
from app.database import SessionLocal
from app.models.item import Item, ItemType
from app.models.company import Company

def create_sample_items():
    db = SessionLocal()
    try:
        # Get the first active company (or use company_id=1)
        company = db.query(Company).filter(Company.is_deleted == False).first()
        
        if not company:
            print("No companies found. Please create a company first.")
            return
        
        company_id = company.id
        print(f"Creating sample items for company: {company.name} (ID: {company_id})")
        
        # Sample general store items
        sample_items = [
            # Snacks
            {
                "name": "Potato Chips",
                "description": "Crispy potato chips - 50g pack",
                "item_type": ItemType.INVENTORY,
                "category": "Snacks",
                "pos_category": "general",
                "unit_price": Decimal("30.00"),
                "cost": Decimal("20.00"),
                "quantity_on_hand": Decimal("100.00"),
                "unit": "pack",
                "barcode": "1234567890123",
                "is_taxable": True,
                "is_pos_available": True
            },
            {
                "name": "Biscuits - Chocolate",
                "description": "Chocolate flavored biscuits - 200g",
                "item_type": ItemType.INVENTORY,
                "category": "Snacks",
                "pos_category": "general",
                "unit_price": Decimal("45.00"),
                "cost": Decimal("30.00"),
                "quantity_on_hand": Decimal("80.00"),
                "unit": "pack",
                "barcode": "1234567890124",
                "is_taxable": True,
                "is_pos_available": True
            },
            {
                "name": "Noodles - Instant",
                "description": "Instant noodles - 70g pack",
                "item_type": ItemType.INVENTORY,
                "category": "Snacks",
                "pos_category": "general",
                "unit_price": Decimal("25.00"),
                "cost": Decimal("15.00"),
                "quantity_on_hand": Decimal("150.00"),
                "unit": "pack",
                "barcode": "1234567890125",
                "is_taxable": True,
                "is_pos_available": True
            },
            # Beverages
            {
                "name": "Coca Cola - 500ml",
                "description": "Carbonated soft drink - 500ml bottle",
                "item_type": ItemType.INVENTORY,
                "category": "Beverages",
                "pos_category": "general",
                "unit_price": Decimal("40.00"),
                "cost": Decimal("28.00"),
                "quantity_on_hand": Decimal("120.00"),
                "unit": "bottle",
                "barcode": "1234567890126",
                "is_taxable": True,
                "is_pos_available": True
            },
            {
                "name": "Pepsi - 500ml",
                "description": "Carbonated soft drink - 500ml bottle",
                "item_type": ItemType.INVENTORY,
                "category": "Beverages",
                "pos_category": "general",
                "unit_price": Decimal("40.00"),
                "cost": Decimal("28.00"),
                "quantity_on_hand": Decimal("100.00"),
                "unit": "bottle",
                "barcode": "1234567890127",
                "is_taxable": True,
                "is_pos_available": True
            },
            {
                "name": "Mineral Water - 500ml",
                "description": "Pure mineral water - 500ml bottle",
                "item_type": ItemType.INVENTORY,
                "category": "Beverages",
                "pos_category": "general",
                "unit_price": Decimal("20.00"),
                "cost": Decimal("12.00"),
                "quantity_on_hand": Decimal("200.00"),
                "unit": "bottle",
                "barcode": "1234567890128",
                "is_taxable": True,
                "is_pos_available": True
            },
            {
                "name": "Energy Drink - 250ml",
                "description": "Energy drink - 250ml can",
                "item_type": ItemType.INVENTORY,
                "category": "Beverages",
                "pos_category": "general",
                "unit_price": Decimal("80.00"),
                "cost": Decimal("55.00"),
                "quantity_on_hand": Decimal("60.00"),
                "unit": "can",
                "barcode": "1234567890129",
                "is_taxable": True,
                "is_pos_available": True
            },
            # Cigarettes
            {
                "name": "Cigarettes - Premium",
                "description": "Premium brand cigarettes - 20 sticks",
                "item_type": ItemType.INVENTORY,
                "category": "Tobacco",
                "pos_category": "general",
                "unit_price": Decimal("120.00"),
                "cost": Decimal("95.00"),
                "quantity_on_hand": Decimal("50.00"),
                "unit": "pack",
                "barcode": "1234567890130",
                "is_taxable": True,
                "is_pos_available": True
            },
            {
                "name": "Cigarettes - Regular",
                "description": "Regular brand cigarettes - 20 sticks",
                "item_type": ItemType.INVENTORY,
                "category": "Tobacco",
                "pos_category": "general",
                "unit_price": Decimal("100.00"),
                "cost": Decimal("80.00"),
                "quantity_on_hand": Decimal("75.00"),
                "unit": "pack",
                "barcode": "1234567890131",
                "is_taxable": True,
                "is_pos_available": True
            },
            # Personal Care
            {
                "name": "Soap - Bath",
                "description": "Bath soap - 100g",
                "item_type": ItemType.INVENTORY,
                "category": "Personal Care",
                "pos_category": "general",
                "unit_price": Decimal("35.00"),
                "cost": Decimal("22.00"),
                "quantity_on_hand": Decimal("90.00"),
                "unit": "piece",
                "barcode": "1234567890132",
                "is_taxable": True,
                "is_pos_available": True
            },
            {
                "name": "Shampoo - 200ml",
                "description": "Hair shampoo - 200ml bottle",
                "item_type": ItemType.INVENTORY,
                "category": "Personal Care",
                "pos_category": "general",
                "unit_price": Decimal("150.00"),
                "cost": Decimal("100.00"),
                "quantity_on_hand": Decimal("40.00"),
                "unit": "bottle",
                "barcode": "1234567890133",
                "is_taxable": True,
                "is_pos_available": True
            },
            {
                "name": "Toothpaste",
                "description": "Toothpaste - 100g tube",
                "item_type": ItemType.INVENTORY,
                "category": "Personal Care",
                "pos_category": "general",
                "unit_price": Decimal("85.00"),
                "cost": Decimal("55.00"),
                "quantity_on_hand": Decimal("55.00"),
                "unit": "tube",
                "barcode": "1234567890134",
                "is_taxable": True,
                "is_pos_available": True
            },
            # Stationery
            {
                "name": "Pen - Ballpoint",
                "description": "Blue ballpoint pen",
                "item_type": ItemType.NON_INVENTORY,
                "category": "Stationery",
                "pos_category": "general",
                "unit_price": Decimal("10.00"),
                "cost": Decimal("5.00"),
                "quantity_on_hand": Decimal("0.00"),
                "unit": "piece",
                "barcode": "1234567890135",
                "is_taxable": True,
                "is_pos_available": True
            },
            {
                "name": "Notebook - A4",
                "description": "A4 size notebook - 100 pages",
                "item_type": ItemType.INVENTORY,
                "category": "Stationery",
                "pos_category": "general",
                "unit_price": Decimal("120.00"),
                "cost": Decimal("75.00"),
                "quantity_on_hand": Decimal("30.00"),
                "unit": "piece",
                "barcode": "1234567890136",
                "is_taxable": True,
                "is_pos_available": True
            },
            # Other
            {
                "name": "Battery - AA",
                "description": "AA size battery - 2 pieces",
                "item_type": ItemType.INVENTORY,
                "category": "Electronics",
                "pos_category": "general",
                "unit_price": Decimal("60.00"),
                "cost": Decimal("40.00"),
                "quantity_on_hand": Decimal("45.00"),
                "unit": "pack",
                "barcode": "1234567890137",
                "is_taxable": True,
                "is_pos_available": True
            },
            {
                "name": "Lighter",
                "description": "Disposable lighter",
                "item_type": ItemType.NON_INVENTORY,
                "category": "Other",
                "pos_category": "general",
                "unit_price": Decimal("15.00"),
                "cost": Decimal("8.00"),
                "quantity_on_hand": Decimal("0.00"),
                "unit": "piece",
                "barcode": "1234567890138",
                "is_taxable": True,
                "is_pos_available": True
            }
        ]
        
        items_created = 0
        
        # Get existing item numbers to avoid duplicates
        existing_items = db.query(Item).filter(Item.company_id == company_id).all()
        existing_names = {item.name.lower() for item in existing_items}
        
        for item_data in sample_items:
            # Check if item with same name already exists
            if item_data["name"].lower() in existing_names:
                print(f"[SKIP] Item '{item_data['name']}' already exists. Skipping...")
                continue
            
            # Generate item number
            existing_count = db.query(Item).filter(Item.company_id == company_id).count()
            item_number = f"ITM-{company_id:03d}-{existing_count + 1:04d}"
            
            # Create item
            item = Item(
                item_number=item_number,
                name=item_data["name"],
                description=item_data.get("description"),
                item_type=item_data["item_type"],
                category=item_data.get("category"),
                pos_category=item_data["pos_category"],
                unit_price=item_data["unit_price"],
                cost=item_data["cost"],
                quantity_on_hand=item_data["quantity_on_hand"],
                unit=item_data["unit"],
                barcode=item_data.get("barcode"),
                is_taxable=item_data["is_taxable"],
                is_pos_available=item_data["is_pos_available"],
                company_id=company_id
            )
            
            db.add(item)
            db.flush()
            items_created += 1
            existing_names.add(item_data["name"].lower())
            print(f"[OK] Created item: {item_data['name']} ({item_number}) - Price: {item_data['unit_price']} BDT")
        
        db.commit()
        print(f"\n[SUCCESS] Successfully created {items_created} sample items!")
        print("These items are now available in POS for testing.")
        
    except Exception as e:
        db.rollback()
        print(f"[ERROR] Error creating items: {str(e)}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    create_sample_items()

