"""
Complete Master Company Items Setup
Ensures all raw materials have ingredients and all finished goods have feed products
Also creates any missing comprehensive items for Fish and Poultry
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import Session
from datetime import datetime
from decimal import Decimal
from app.db.session import SessionLocal
from app.modules.tenancy.models import Tenant, User
from app.modules.catalog.models import UOM, Item, ItemCategory
from app.modules.feed_manufacturing.models import Ingredient, FeedProduct
from sqlalchemy import text

def complete_setup():
    """Complete setup for Master Company items"""
    # Import models to ensure relationships work
    from app.modules.inventory.models import Warehouse
    from app.modules.feed_manufacturing.models import ProductionOrder
    
    db = SessionLocal()
    try:
        # Get Master Company tenant
        master_tenant = db.query(Tenant).filter(Tenant.domain == 'master').first()
        if not master_tenant:
            print("ERROR: Master Company tenant not found!")
            return
        
        print(f"\n{'='*70}")
        print(f"COMPLETING MASTER COMPANY ITEMS SETUP")
        print(f"{'='*70}\n")
        
        # Get admin user
        admin = db.query(User).filter(
            User.tenant_id == master_tenant.id,
            User.email.like('%admin%')
        ).first()
        if not admin:
            admin = db.query(User).filter(User.tenant_id == master_tenant.id).first()
        if not admin:
            print("ERROR: No user found for Master Company!")
            return
        
        # Get UOMs
        kg_uom = db.query(UOM).filter(
            UOM.tenant_id == master_tenant.id,
            UOM.code == 'KG'
        ).first()
        l_uom = db.query(UOM).filter(
            UOM.tenant_id == master_tenant.id,
            UOM.code == 'L'
        ).first()
        nos_uom = db.query(UOM).filter(
            UOM.tenant_id == master_tenant.id,
            UOM.code == 'NOS'
        ).first()
        
        if not kg_uom or not l_uom or not nos_uom:
            print("ERROR: Required UOMs not found!")
            return
        
        created_ingredients = 0
        created_products = 0
        
        # ========== Step 1: Create ingredients for raw materials without ingredients ==========
        print("Step 1: Creating ingredients for raw materials without ingredients...")
        
        result = db.execute(text("""
            SELECT i.id, i.sku, i.name, i.standard_cost
            FROM items i
            LEFT JOIN ingredients ing ON i.id = ing.item_id AND ing.tenant_id = i.tenant_id
            WHERE i.tenant_id = :tenant_id
            AND i.type = 'raw_material'
            AND ing.id IS NULL
            ORDER BY i.sku
        """), {"tenant_id": master_tenant.id})
        
        raw_materials_without_ing = result.fetchall()
        
        # Default nutrition values based on item name patterns
        def guess_ingredient_type(name: str, sku: str) -> dict:
            name_lower = name.lower()
            sku_lower = sku.lower()
            
            # Premixes
            if 'premix' in name_lower or 'vitamin' in name_lower or 'mineral' in name_lower:
                return {
                    "ingredient_type": "micro",
                    "is_premix": True,
                    "protein": 0, "fat": 0, "fiber": 0, "moisture": 5.0, "ash": 0, "energy": 0
                }
            
            # Oils
            if 'oil' in name_lower and 'cake' not in name_lower:
                return {
                    "ingredient_type": "additive",
                    "is_premix": False,
                    "protein": 0, "fat": 100.0, "fiber": 0, "moisture": 0, "ash": 0, "energy": 9000
                }
            
            # Protein sources
            if any(x in name_lower for x in ['meal', 'cake', 'soybean', 'fish meal', 'meat']):
                return {
                    "ingredient_type": "macro",
                    "is_premix": False,
                    "protein": 45.0, "fat": 5.0, "fiber": 5.0, "moisture": 10.0, "ash": 8.0, "energy": 2500
                }
            
            # Grains
            if any(x in name_lower for x in ['corn', 'maize', 'wheat', 'rice', 'sorghum', 'bran']):
                return {
                    "ingredient_type": "macro",
                    "is_premix": False,
                    "protein": 10.0, "fat": 3.0, "fiber": 3.0, "moisture": 12.0, "ash": 2.0, "energy": 3300
                }
            
            # Additives/binders
            if any(x in name_lower for x in ['binder', 'cmc', 'xanthan', 'antioxidant', 'enzyme', 'probiotic']):
                return {
                    "ingredient_type": "additive",
                    "is_premix": False,
                    "protein": 0, "fat": 0, "fiber": 0, "moisture": 5.0, "ash": 0, "energy": 0
                }
            
            # Minerals
            if any(x in name_lower for x in ['limestone', 'calcium', 'phosphate', 'dcp', 'salt']):
                return {
                    "ingredient_type": "additive",
                    "is_premix": False,
                    "protein": 0, "fat": 0, "fiber": 0, "moisture": 1.0, "ash": 80.0, "energy": 0
                }
            
            # Default
            return {
                "ingredient_type": "macro",
                "is_premix": False,
                "protein": 15.0, "fat": 5.0, "fiber": 5.0, "moisture": 10.0, "ash": 5.0, "energy": 2500
            }
        
        for row in raw_materials_without_ing:
            item_id, sku, name, cost = row
            nutrition = guess_ingredient_type(name, sku)
            
            ingredient = Ingredient(
                tenant_id=master_tenant.id,
                item_id=item_id,
                ingredient_type=nutrition["ingredient_type"],
                protein_pct=Decimal(str(nutrition["protein"])),
                fat_pct=Decimal(str(nutrition["fat"])),
                fiber_pct=Decimal(str(nutrition["fiber"])),
                moisture_pct=Decimal(str(nutrition["moisture"])),
                ash_pct=Decimal(str(nutrition["ash"])),
                energy_kcal=Decimal(str(nutrition["energy"])),
                is_premix=nutrition["is_premix"],
                premix_unit="g_per_ton" if nutrition["is_premix"] else None,
                created_by=admin.id
            )
            db.add(ingredient)
            created_ingredients += 1
            print(f"  [OK] Created ingredient for: {sku} - {name}")
        
        db.commit()
        print(f"\n  Created {created_ingredients} ingredients\n")
        
        # ========== Step 2: Create feed products for finished goods without feed products ==========
        print("Step 2: Creating feed products for finished goods without feed products...")
        
        result = db.execute(text("""
            SELECT i.id, i.sku, i.name
            FROM items i
            LEFT JOIN feed_products fp ON i.id = fp.item_id AND fp.tenant_id = i.tenant_id
            WHERE i.tenant_id = :tenant_id
            AND i.type = 'finished_good'
            AND fp.id IS NULL
            ORDER BY i.sku
        """), {"tenant_id": master_tenant.id})
        
        finished_goods_without_product = result.fetchall()
        
        def guess_feed_product(name: str, sku: str) -> dict:
            name_lower = name.lower()
            sku_lower = sku.lower()
            
            # Fish feeds
            if 'fish' in name_lower or 'ff-fish' in sku_lower:
                floating = 'floating' in name_lower or 'float' in name_lower
                sinking = 'sinking' in name_lower or 'sink' in name_lower
                
                # Extract pellet size
                pellet_size = None
                for size in ['0.8', '1.0', '1.2', '1.5', '2.0', '2.5', '3.0', '4.0', '5.0']:
                    if size in sku_lower or size in name_lower:
                        pellet_size = float(size)
                        break
                
                # Determine stage
                stage = "grower"
                if 'starter' in name_lower or 'str' in sku_lower:
                    stage = "starter"
                elif 'finisher' in name_lower or 'fin' in sku_lower:
                    stage = "finisher"
                
                return {
                    "category": "Fish",
                    "subtype": "Floating" if floating else ("Sinking" if sinking else None),
                    "stage": stage,
                    "pellet_size": pellet_size,
                    "requires_extrusion": True,
                    "requires_pelleting": False
                }
            
            # Poultry feeds
            if any(x in name_lower for x in ['poultry', 'broiler', 'layer', 'breeder', 'duck', 'plt']):
                crumble = 'crumble' in name_lower
                
                stage = "grower"
                if 'starter' in name_lower or 'str' in sku_lower:
                    stage = "starter"
                elif 'finisher' in name_lower or 'fin' in sku_lower:
                    stage = "finisher"
                elif 'laying' in name_lower or 'lay' in sku_lower:
                    stage = "laying"
                elif 'breeding' in name_lower or 'brd' in sku_lower:
                    stage = "breeding"
                elif 'pre-starter' in name_lower or 'pre' in sku_lower:
                    stage = "pre-starter"
                
                return {
                    "category": "Poultry",
                    "subtype": None,
                    "stage": stage,
                    "pellet_size": None if crumble else 3.0,
                    "requires_extrusion": False,
                    "requires_pelleting": True
                }
            
            # Default (assume poultry)
            return {
                "category": "Poultry",
                "subtype": None,
                "stage": "grower",
                "pellet_size": 3.0,
                "requires_extrusion": False,
                "requires_pelleting": True
            }
        
        for row in finished_goods_without_product:
            item_id, sku, name = row
            product_data = guess_feed_product(name, sku)
            
            product = FeedProduct(
                tenant_id=master_tenant.id,
                item_id=item_id,
                category=product_data["category"],
                subtype=product_data.get("subtype"),
                stage=product_data.get("stage"),
                pellet_size_mm=Decimal(str(product_data["pellet_size"])) if product_data.get("pellet_size") else None,
                requires_grinding=True,
                requires_extrusion=product_data.get("requires_extrusion", False),
                requires_pelleting=product_data.get("requires_pelleting", False),
                requires_drying=True,
                requires_coating=product_data.get("subtype") == "Floating",
                created_by=admin.id
            )
            db.add(product)
            created_products += 1
            print(f"  [OK] Created feed product for: {sku} - {name}")
        
        db.commit()
        print(f"\n  Created {created_products} feed products\n")
        
        print(f"{'='*70}")
        print(f"SUCCESS: Completed Master Company Items Setup")
        print(f"{'='*70}")
        print(f"  Ingredients Created: {created_ingredients}")
        print(f"  Feed Products Created: {created_products}")
        print(f"{'='*70}\n")
        
    except Exception as e:
        db.rollback()
        print(f"\nERROR: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    complete_setup()
