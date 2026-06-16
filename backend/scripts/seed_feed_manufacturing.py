"""
Seed script for Feed Manufacturing demo data
Creates feed products, ingredients, and sample BOMs
"""
import sys
import os

# Add parent directory to path so we can import app
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import Session
from datetime import datetime
from decimal import Decimal
from app.db.session import SessionLocal
from app.modules.tenancy.models import Tenant, User
from app.modules.catalog.models import UOM, Item
from app.modules.inventory.models import Warehouse
from app.modules.feed_manufacturing.models import FeedProduct, Ingredient, FeedBom, FeedBomLine
from app.shared.enums import InclusionBasis

def seed_feed_manufacturing(domain: str | None = None):
    """Seed feed manufacturing demo data"""
    db = SessionLocal()
    try:
        # Get tenant and admin user
        domain = domain or os.environ.get("TENANT_DOMAIN") or "localhost"
        tenant = db.query(Tenant).filter(Tenant.domain == domain).first()
        if not tenant:
            print(f"Tenant '{domain}' not found. Please run seed.py first.")
            return
        
        admin = (
            db.query(User)
            .filter(User.tenant_id == tenant.id)
            .order_by(User.id.asc())
            .first()
        )
        if not admin:
            print("Admin user not found. Please run seed.py first.")
            return
        
        # Get UOMs
        kg_uom = db.query(UOM).filter(UOM.tenant_id == tenant.id, UOM.code == "KG").first()
        if not kg_uom:
            print("KG UOM not found. Please run seed.py first.")
            return
        
        # Get warehouse
        warehouse = db.query(Warehouse).filter(
            Warehouse.tenant_id == tenant.id,
            Warehouse.name == "Main Warehouse"
        ).first()
        if not warehouse:
            print("Warehouse not found. Please run seed.py first.")
            return
        
        print("\n=== Seeding Feed Manufacturing Data ===\n")
        
        # ========== Create Ingredients (Raw Materials) ==========
        print("Creating ingredients...")
        
        ingredients_data = [
            # Macro ingredients
            {"name": "Fish Meal", "sku": "ING-FM-001", "type": "macro", "protein": 60.0, "fat": 8.0, "fiber": 1.0, "ash": 15.0, "moisture": 10.0, "cost": 80.0},
            {"name": "Soybean Meal", "sku": "ING-SBM-001", "type": "macro", "protein": 45.0, "fat": 2.0, "fiber": 7.0, "ash": 6.0, "moisture": 12.0, "cost": 45.0},
            {"name": "Wheat Flour", "sku": "ING-WF-001", "type": "macro", "protein": 12.0, "fat": 1.5, "fiber": 2.5, "ash": 0.8, "moisture": 13.0, "cost": 25.0},
            {"name": "Corn Meal", "sku": "ING-CM-001", "type": "macro", "protein": 8.5, "fat": 3.5, "fiber": 2.3, "ash": 1.2, "moisture": 13.0, "cost": 20.0},
            {"name": "Rice Bran", "sku": "ING-RB-001", "type": "macro", "protein": 13.0, "fat": 15.0, "fiber": 11.0, "ash": 8.0, "moisture": 12.0, "cost": 18.0},
            {"name": "Fish Oil", "sku": "ING-FO-001", "type": "macro", "protein": 0.0, "fat": 99.0, "fiber": 0.0, "ash": 0.0, "moisture": 0.5, "cost": 120.0},
            {"name": "Palm Oil", "sku": "ING-PO-001", "type": "macro", "protein": 0.0, "fat": 99.5, "fiber": 0.0, "ash": 0.0, "moisture": 0.2, "cost": 65.0},
            # Micro ingredients / Premix
            {"name": "Vitamin Premix", "sku": "ING-VP-001", "type": "micro", "is_premix": True, "premix_unit": "g_per_ton", "cost": 500.0},
            {"name": "Mineral Premix", "sku": "ING-MP-001", "type": "micro", "is_premix": True, "premix_unit": "g_per_ton", "cost": 400.0},
            {"name": "Antioxidant", "sku": "ING-AO-001", "type": "additive", "is_premix": True, "premix_unit": "g_per_ton", "cost": 300.0},
            # Binders
            {"name": "CMC (Binder)", "sku": "ING-CMC-001", "type": "binder", "cost": 150.0},
        ]
        
        created_ingredients = {}
        
        for ing_data in ingredients_data:
            # Check if item already exists
            item = db.query(Item).filter(
                Item.tenant_id == tenant.id,
                Item.sku == ing_data["sku"]
            ).first()
            
            if not item:
                # Create item first
                item = Item(
                    tenant_id=tenant.id,
                    sku=ing_data["sku"],
                    name=ing_data["name"],
                    type="raw_material",
                    uom_id=kg_uom.id,
                    is_stock_tracked=True,
                    is_active=True,
                    standard_cost=Decimal(str(ing_data.get("cost", 0))),
                    created_by=admin.id
                )
                db.add(item)
                db.flush()
            
            # Check if ingredient already exists
            ingredient = db.query(Ingredient).filter(
                Ingredient.tenant_id == tenant.id,
                Ingredient.item_id == item.id
            ).first()
            
            if not ingredient:
                ingredient = Ingredient(
                    tenant_id=tenant.id,
                    item_id=item.id,
                    ingredient_type=ing_data["type"],
                    cost_method="weighted_average",
                    protein_pct=Decimal(str(ing_data.get("protein", 0))) if ing_data.get("protein") else None,
                    fat_pct=Decimal(str(ing_data.get("fat", 0))) if ing_data.get("fat") else None,
                    fiber_pct=Decimal(str(ing_data.get("fiber", 0))) if ing_data.get("fiber") else None,
                    ash_pct=Decimal(str(ing_data.get("ash", 0))) if ing_data.get("ash") else None,
                    moisture_pct=Decimal(str(ing_data.get("moisture", 0))) if ing_data.get("moisture") else None,
                    is_premix=ing_data.get("is_premix", False),
                    premix_unit=ing_data.get("premix_unit"),
                    created_by=admin.id
                )
                db.add(ingredient)
                db.flush()
                created_ingredients[ing_data["name"]] = ingredient
                print(f"  Created ingredient: {ing_data['name']}")
        
        db.flush()
        
        # ========== Create Feed Products ==========
        print("\nCreating feed products...")
        
        products_data = [
            {
                "name": "Fish Floating Feed - Grower",
                "sku": "FEED-FISH-GR-001",
                "category": "Fish",
                "subtype": "Floating",
                "stage": "grower",
                "pellet_size_mm": 2.0,
                "packaging": "25kg",
                "target_protein": 32.0,
                "target_fat": 6.0,
                "target_fiber": 5.0,
                "target_moisture": 10.0,
                "target_ash": 12.0,
                "requires_extrusion": True,
                "requires_drying": True,
                "requires_coating": True,
            },
            {
                "name": "Poultry Starter Feed",
                "sku": "FEED-POULTRY-ST-001",
                "category": "Poultry",
                "stage": "starter",
                "pellet_size_mm": 2.5,
                "packaging": "50kg",
                "target_protein": 22.0,
                "target_fat": 4.0,
                "target_fiber": 4.5,
                "target_moisture": 12.0,
                "target_ash": 7.0,
                "requires_grinding": True,
                "requires_pelleting": True,
            },
            {
                "name": "Cattle Pellet Feed",
                "sku": "FEED-CATTLE-PL-001",
                "category": "Cattle",
                "stage": "grower",
                "pellet_size_mm": 6.0,
                "packaging": "50kg",
                "target_protein": 16.0,
                "target_fat": 3.0,
                "target_fiber": 18.0,
                "target_moisture": 12.0,
                "target_ash": 8.0,
                "requires_grinding": True,
                "requires_pelleting": True,
            },
        ]
        
        created_products = {}
        
        for prod_data in products_data:
            # Check if item already exists
            item = db.query(Item).filter(
                Item.tenant_id == tenant.id,
                Item.sku == prod_data["sku"]
            ).first()
            
            if not item:
                # Create item first
                item = Item(
                    tenant_id=tenant.id,
                    sku=prod_data["sku"],
                    name=prod_data["name"],
                    type="finished_good",
                    uom_id=kg_uom.id,
                    is_stock_tracked=True,
                    is_active=True,
                    created_by=admin.id
                )
                db.add(item)
                db.flush()
            
            # Check if feed product already exists
            feed_product = db.query(FeedProduct).filter(
                FeedProduct.tenant_id == tenant.id,
                FeedProduct.item_id == item.id
            ).first()
            
            if not feed_product:
                feed_product = FeedProduct(
                    tenant_id=tenant.id,
                    item_id=item.id,
                    category=prod_data["category"],
                    subtype=prod_data.get("subtype"),
                    stage=prod_data.get("stage"),
                    pellet_size_mm=Decimal(str(prod_data.get("pellet_size_mm"))) if prod_data.get("pellet_size_mm") else None,
                    packaging=prod_data.get("packaging"),
                    target_protein_pct=Decimal(str(prod_data.get("target_protein"))) if prod_data.get("target_protein") else None,
                    target_fat_pct=Decimal(str(prod_data.get("target_fat"))) if prod_data.get("target_fat") else None,
                    target_fiber_pct=Decimal(str(prod_data.get("target_fiber"))) if prod_data.get("target_fiber") else None,
                    target_moisture_pct=Decimal(str(prod_data.get("target_moisture"))) if prod_data.get("target_moisture") else None,
                    target_ash_pct=Decimal(str(prod_data.get("target_ash"))) if prod_data.get("target_ash") else None,
                    requires_grinding=prod_data.get("requires_grinding", False),
                    requires_extrusion=prod_data.get("requires_extrusion", False),
                    requires_pelleting=prod_data.get("requires_pelleting", False),
                    requires_drying=prod_data.get("requires_drying", False),
                    requires_coating=prod_data.get("requires_coating", False),
                    created_by=admin.id
                )
                db.add(feed_product)
                db.flush()
                created_products[prod_data["name"]] = feed_product
                print(f"  Created feed product: {prod_data['name']}")
        
        db.flush()
        
        # ========== Create Sample BOMs ==========
        print("\nCreating sample BOMs...")
        
        # Fish Floating Feed BOM
        fish_product = created_products.get("Fish Floating Feed - Grower")
        if fish_product:
            bom_code = "FISH-001"
            existing_bom = db.query(FeedBom).filter(
                FeedBom.tenant_id == tenant.id,
                FeedBom.bom_code == bom_code,
                FeedBom.version == "1.0"
            ).first()
            
            if not existing_bom:
                fish_bom = FeedBom(
                    tenant_id=tenant.id,
                    bom_code=bom_code,
                    product_id=fish_product.id,
                    version="1.0",
                    status="approved",
                    default_batch_size_ton=Decimal("1.0"),
                    process_type="Extruded floating",
                    pellet_size_mm=Decimal("2.0"),
                    is_floating=True,
                    target_protein_pct=Decimal("32.0"),
                    target_fat_pct=Decimal("6.0"),
                    target_fiber_pct=Decimal("5.0"),
                    target_moisture_pct=Decimal("10.0"),
                    target_ash_pct=Decimal("12.0"),
                    effective_from=datetime.utcnow(),
                    notes="Fish floating feed for grower stage",
                    created_by=admin.id
                )
                db.add(fish_bom)
                db.flush()
                
                # Add BOM lines
                bom_lines_data = [
                    {"ingredient": "Fish Meal", "basis": "percent", "value": 30.0, "sequence": 1, "phase": "mixing"},
                    {"ingredient": "Soybean Meal", "basis": "percent", "value": 25.0, "sequence": 2, "phase": "mixing"},
                    {"ingredient": "Wheat Flour", "basis": "percent", "value": 20.0, "sequence": 3, "phase": "mixing"},
                    {"ingredient": "Rice Bran", "basis": "percent", "value": 15.0, "sequence": 4, "phase": "mixing"},
                    {"ingredient": "Fish Oil", "basis": "percent", "value": 5.0, "sequence": 5, "phase": "mixing"},
                    {"ingredient": "Palm Oil", "basis": "percent", "value": 4.0, "sequence": 6, "phase": "mixing"},
                    {"ingredient": "Vitamin Premix", "basis": "g_per_ton", "value": 500.0, "sequence": 7, "phase": "mixing"},
                    {"ingredient": "Mineral Premix", "basis": "g_per_ton", "value": 300.0, "sequence": 8, "phase": "mixing"},
                    {"ingredient": "Antioxidant", "basis": "g_per_ton", "value": 100.0, "sequence": 9, "phase": "mixing"},
                    {"ingredient": "CMC (Binder)", "basis": "percent", "value": 1.0, "sequence": 10, "phase": "mixing"},
                ]
                
                for line_data in bom_lines_data:
                    ingredient = created_ingredients.get(line_data["ingredient"])
                    if ingredient:
                        line = FeedBomLine(
                            tenant_id=tenant.id,
                            bom_id=fish_bom.id,
                            ingredient_id=ingredient.id,
                            sequence=line_data["sequence"],
                            inclusion_basis=line_data["basis"],
                            inclusion_value=Decimal(str(line_data["value"])),
                            loss_factor_pct=Decimal("0"),
                            phase=line_data.get("phase"),
                            created_by=admin.id
                        )
                        db.add(line)
                
                db.flush()
                
                # Compute totals
                # Totals are computed on-demand in API; keep seed script compatible
                # with older/newer BomService implementations.
                try:
                    from app.modules.feed_manufacturing.bom_service import BomService
                    if hasattr(BomService, "compute_bom_totals"):
                        BomService.compute_bom_totals(db, fish_bom.id, fish_bom.default_batch_size_ton)
                    elif hasattr(BomService, "validate_bom_totals"):
                        BomService.validate_bom_totals(db, fish_bom.id)
                except Exception:
                    pass
                
                print(f"  Created BOM: {bom_code} v1.0 (Fish Floating Feed)")
        
        # Poultry Starter Feed BOM
        poultry_product = created_products.get("Poultry Starter Feed")
        if poultry_product:
            bom_code = "POULTRY-001"
            existing_bom = db.query(FeedBom).filter(
                FeedBom.tenant_id == tenant.id,
                FeedBom.bom_code == bom_code,
                FeedBom.version == "1.0"
            ).first()
            
            if not existing_bom:
                poultry_bom = FeedBom(
                    tenant_id=tenant.id,
                    bom_code=bom_code,
                    product_id=poultry_product.id,
                    version="1.0",
                    status="approved",
                    default_batch_size_ton=Decimal("1.0"),
                    process_type="Pelleted",
                    pellet_size_mm=Decimal("2.5"),
                    is_floating=False,
                    target_protein_pct=Decimal("22.0"),
                    target_fat_pct=Decimal("4.0"),
                    target_fiber_pct=Decimal("4.5"),
                    target_moisture_pct=Decimal("12.0"),
                    target_ash_pct=Decimal("7.0"),
                    effective_from=datetime.utcnow(),
                    notes="Poultry starter feed",
                    created_by=admin.id
                )
                db.add(poultry_bom)
                db.flush()
                
                # Add BOM lines
                bom_lines_data = [
                    {"ingredient": "Corn Meal", "basis": "percent", "value": 50.0, "sequence": 1, "phase": "mixing"},
                    {"ingredient": "Soybean Meal", "basis": "percent", "value": 30.0, "sequence": 2, "phase": "mixing"},
                    {"ingredient": "Wheat Flour", "basis": "percent", "value": 10.0, "sequence": 3, "phase": "mixing"},
                    {"ingredient": "Fish Meal", "basis": "percent", "value": 5.0, "sequence": 4, "phase": "mixing"},
                    {"ingredient": "Palm Oil", "basis": "percent", "value": 3.0, "sequence": 5, "phase": "mixing"},
                    {"ingredient": "Vitamin Premix", "basis": "g_per_ton", "value": 500.0, "sequence": 6, "phase": "mixing"},
                    {"ingredient": "Mineral Premix", "basis": "g_per_ton", "value": 300.0, "sequence": 7, "phase": "mixing"},
                    {"ingredient": "Antioxidant", "basis": "g_per_ton", "value": 100.0, "sequence": 8, "phase": "mixing"},
                    {"ingredient": "CMC (Binder)", "basis": "percent", "value": 2.0, "sequence": 9, "phase": "mixing"},
                ]
                
                for line_data in bom_lines_data:
                    ingredient = created_ingredients.get(line_data["ingredient"])
                    if ingredient:
                        line = FeedBomLine(
                            tenant_id=tenant.id,
                            bom_id=poultry_bom.id,
                            ingredient_id=ingredient.id,
                            sequence=line_data["sequence"],
                            inclusion_basis=line_data["basis"],
                            inclusion_value=Decimal(str(line_data["value"])),
                            loss_factor_pct=Decimal("0"),
                            phase=line_data.get("phase"),
                            created_by=admin.id
                        )
                        db.add(line)
                
                db.flush()
                
                # Compute totals
                try:
                    from app.modules.feed_manufacturing.bom_service import BomService
                    if hasattr(BomService, "compute_bom_totals"):
                        BomService.compute_bom_totals(db, poultry_bom.id, poultry_bom.default_batch_size_ton)
                    elif hasattr(BomService, "validate_bom_totals"):
                        BomService.validate_bom_totals(db, poultry_bom.id)
                except Exception:
                    pass
                
                print(f"  Created BOM: {bom_code} v1.0 (Poultry Starter Feed)")
        
        # Cattle Pellet Feed BOM
        cattle_product = created_products.get("Cattle Pellet Feed")
        if cattle_product:
            bom_code = "CATTLE-001"
            existing_bom = db.query(FeedBom).filter(
                FeedBom.tenant_id == tenant.id,
                FeedBom.bom_code == bom_code,
                FeedBom.version == "1.0"
            ).first()
            
            if not existing_bom:
                cattle_bom = FeedBom(
                    tenant_id=tenant.id,
                    bom_code=bom_code,
                    product_id=cattle_product.id,
                    version="1.0",
                    status="approved",
                    default_batch_size_ton=Decimal("1.0"),
                    process_type="Pelleted",
                    pellet_size_mm=Decimal("6.0"),
                    is_floating=False,
                    target_protein_pct=Decimal("16.0"),
                    target_fat_pct=Decimal("3.0"),
                    target_fiber_pct=Decimal("18.0"),
                    target_moisture_pct=Decimal("12.0"),
                    target_ash_pct=Decimal("8.0"),
                    effective_from=datetime.utcnow(),
                    notes="Cattle pellet feed for grower stage",
                    created_by=admin.id
                )
                db.add(cattle_bom)
                db.flush()
                
                # Add BOM lines
                bom_lines_data = [
                    {"ingredient": "Corn Meal", "basis": "percent", "value": 40.0, "sequence": 1, "phase": "mixing"},
                    {"ingredient": "Rice Bran", "basis": "percent", "value": 25.0, "sequence": 2, "phase": "mixing"},
                    {"ingredient": "Soybean Meal", "basis": "percent", "value": 20.0, "sequence": 3, "phase": "mixing"},
                    {"ingredient": "Wheat Flour", "basis": "percent", "value": 10.0, "sequence": 4, "phase": "mixing"},
                    {"ingredient": "Palm Oil", "basis": "percent", "value": 3.0, "sequence": 5, "phase": "mixing"},
                    {"ingredient": "Vitamin Premix", "basis": "g_per_ton", "value": 400.0, "sequence": 6, "phase": "mixing"},
                    {"ingredient": "Mineral Premix", "basis": "g_per_ton", "value": 250.0, "sequence": 7, "phase": "mixing"},
                    {"ingredient": "Antioxidant", "basis": "g_per_ton", "value": 100.0, "sequence": 8, "phase": "mixing"},
                    {"ingredient": "CMC (Binder)", "basis": "percent", "value": 2.0, "sequence": 9, "phase": "mixing"},
                ]
                
                for line_data in bom_lines_data:
                    ingredient = created_ingredients.get(line_data["ingredient"])
                    if ingredient:
                        line = FeedBomLine(
                            tenant_id=tenant.id,
                            bom_id=cattle_bom.id,
                            ingredient_id=ingredient.id,
                            sequence=line_data["sequence"],
                            inclusion_basis=line_data["basis"],
                            inclusion_value=Decimal(str(line_data["value"])),
                            loss_factor_pct=Decimal("0"),
                            phase=line_data.get("phase"),
                            created_by=admin.id
                        )
                        db.add(line)
                
                db.flush()
                
                # Compute totals
                try:
                    from app.modules.feed_manufacturing.bom_service import BomService
                    if hasattr(BomService, "compute_bom_totals"):
                        BomService.compute_bom_totals(db, cattle_bom.id, cattle_bom.default_batch_size_ton)
                    elif hasattr(BomService, "validate_bom_totals"):
                        BomService.validate_bom_totals(db, cattle_bom.id)
                except Exception:
                    pass
                
                print(f"  Created BOM: {bom_code} v1.0 (Cattle Pellet Feed)")
        
        db.commit()
        print("\n[SUCCESS] Feed manufacturing demo data created successfully!")
        print("\nCreated:")
        print(f"  - {len(created_ingredients)} ingredients")
        print(f"  - {len(created_products)} feed products")
        print("  - 3 sample BOMs (Fish, Poultry, Cattle)")
        
    except Exception as e:
        db.rollback()
        print(f"\n[ERROR] Error seeding feed manufacturing data: {e}")
        import traceback
        traceback.print_exc()
        raise
    finally:
        db.close()

if __name__ == "__main__":
    seed_feed_manufacturing()

