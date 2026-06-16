"""
Seed Test BOMs for Master Company (R&D Testing)
Creates comprehensive BOMs with ingredients for testing all functionality
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import Session
from datetime import datetime
from decimal import Decimal
from app.db.session import SessionLocal
from app.modules.tenancy.models import Tenant, User
from app.modules.catalog.models import UOM, Item
from app.modules.feed_manufacturing.models import (
    FeedProduct, Ingredient, FeedBom, FeedBomLine, BOMStatus, InclusionBasis
)
from app.modules.feed_manufacturing.bom_service import BomService

def seed_master_company_boms():
    """Seed test BOMs for Master Company (tenant_id=4, domain='master')"""
    db = SessionLocal()
    try:
        # Get Master Company tenant
        master_tenant = db.query(Tenant).filter(Tenant.domain == 'master').first()
        if not master_tenant:
            print("ERROR: Master Company tenant not found!")
            return
        
        print(f"\n{'='*70}")
        print(f"SEEDING TEST BOMs FOR MASTER COMPANY (Tenant ID: {master_tenant.id})")
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
        
        # Get KG UOM
        kg_uom = db.query(UOM).filter(
            UOM.tenant_id == master_tenant.id,
            UOM.code == 'KG'
        ).first()
        if not kg_uom:
            print("ERROR: KG UOM not found!")
            return
        
        # ========== Ensure Ingredients Exist ==========
        print("Step 1: Ensuring ingredients exist...")
        ingredients_map = {}
        
        ingredient_data = [
            {"sku": "RM-MC-001", "name": "Maize (Yellow Corn)", "ingredient_type": "macro",
             "protein_pct": 8.5, "fat_pct": 3.5, "fiber_pct": 2.5, "moisture_pct": 12.0, "ash_pct": 1.5, "energy_kcal": 3350},
            {"sku": "RM-MC-002", "name": "Soybean Meal (48%)", "ingredient_type": "macro",
             "protein_pct": 48.0, "fat_pct": 1.5, "fiber_pct": 7.0, "moisture_pct": 12.0, "ash_pct": 6.5, "energy_kcal": 2400},
            {"sku": "RM-MC-003", "name": "Rice Bran", "ingredient_type": "macro",
             "protein_pct": 12.5, "fat_pct": 15.0, "fiber_pct": 11.0, "moisture_pct": 11.0, "ash_pct": 10.0, "energy_kcal": 3200},
            {"sku": "RM-MC-004", "name": "Fish Meal (60%)", "ingredient_type": "macro",
             "protein_pct": 60.0, "fat_pct": 8.0, "fiber_pct": 1.0, "moisture_pct": 10.0, "ash_pct": 20.0, "energy_kcal": 2800},
            {"sku": "RM-MC-005", "name": "Wheat Flour", "ingredient_type": "macro",
             "protein_pct": 12.0, "fat_pct": 1.5, "fiber_pct": 2.5, "moisture_pct": 13.0, "ash_pct": 0.8, "energy_kcal": 3400},
            {"sku": "RM-MC-006", "name": "Fish Oil", "ingredient_type": "additive",
             "protein_pct": 0, "fat_pct": 100.0, "fiber_pct": 0, "moisture_pct": 0, "ash_pct": 0, "energy_kcal": 9000},
            {"sku": "RM-MC-007", "name": "Vitamin-Mineral Premix (Fish)", "ingredient_type": "micro",
             "protein_pct": 0, "fat_pct": 0, "fiber_pct": 0, "moisture_pct": 5.0, "ash_pct": 0, "energy_kcal": 0, "is_premix": True},
            {"sku": "RM-MC-008", "name": "Binder (CMC)", "ingredient_type": "binder",
             "protein_pct": 0, "fat_pct": 0, "fiber_pct": 0, "moisture_pct": 8.0, "ash_pct": 0, "energy_kcal": 0},
            {"sku": "RM-MC-009", "name": "Limestone (Calcium)", "ingredient_type": "additive",
             "protein_pct": 0, "fat_pct": 0, "fiber_pct": 0, "moisture_pct": 1.0, "ash_pct": 95.0, "energy_kcal": 0},
            {"sku": "RM-MC-010", "name": "Dicalcium Phosphate", "ingredient_type": "additive",
             "protein_pct": 0, "fat_pct": 0, "fiber_pct": 0, "moisture_pct": 1.0, "ash_pct": 80.0, "energy_kcal": 0},
        ]
        
        for ing_data in ingredient_data:
            # Get or create item
            item = db.query(Item).filter(
                Item.sku == ing_data["sku"],
                Item.tenant_id == master_tenant.id
            ).first()
            
            if not item:
                item = Item(
                    tenant_id=master_tenant.id,
                    sku=ing_data["sku"],
                    name=ing_data["name"],
                    type="raw_material",
                    uom_id=kg_uom.id,
                    is_stock_tracked=True,
                    is_active=True,
                    created_by=admin.id
                )
                db.add(item)
                db.flush()
            
            # Get or create ingredient
            ingredient = db.query(Ingredient).filter(
                Ingredient.item_id == item.id,
                Ingredient.tenant_id == master_tenant.id
            ).first()
            
            if not ingredient:
                ingredient = Ingredient(
                    tenant_id=master_tenant.id,
                    item_id=item.id,
                    ingredient_type=ing_data["ingredient_type"],
                    protein_pct=Decimal(str(ing_data.get("protein_pct", 0))),
                    fat_pct=Decimal(str(ing_data.get("fat_pct", 0))),
                    fiber_pct=Decimal(str(ing_data.get("fiber_pct", 0))),
                    moisture_pct=Decimal(str(ing_data.get("moisture_pct", 0))),
                    ash_pct=Decimal(str(ing_data.get("ash_pct", 0))),
                    energy_kcal=Decimal(str(ing_data.get("energy_kcal", 0))),
                    is_premix=ing_data.get("is_premix", False),
                    premix_unit="g_per_ton" if ing_data.get("is_premix") else None,
                    created_by=admin.id
                )
                db.add(ingredient)
                db.flush()
            
            ingredients_map[ing_data["sku"]] = ingredient
        
        db.commit()
        print(f"  [OK] Ensured {len(ingredients_map)} ingredients exist\n")
        
        # ========== Ensure Feed Products Exist ==========
        print("Step 2: Ensuring feed products exist...")
        products_map = {}
        
        product_data = [
            {"sku": "FF-MC-001", "name": "Fish Floating Feed 2mm", "category": "Fish", "subtype": "Floating",
             "stage": "grower", "pellet_size_mm": 2.0},
            {"sku": "FF-MC-002", "name": "Fish Floating Feed 4mm", "category": "Fish", "subtype": "Floating",
             "stage": "finisher", "pellet_size_mm": 4.0},
            {"sku": "FF-MC-003", "name": "Poultry Starter Crumble", "category": "Poultry", "subtype": None,
             "stage": "starter", "pellet_size_mm": None},
            {"sku": "FF-MC-004", "name": "Cattle Pellet Feed", "category": "Cattle", "subtype": None,
             "stage": "grower", "pellet_size_mm": 6.0},
        ]
        
        for prod_data in product_data:
            # Get or create item
            item = db.query(Item).filter(
                Item.sku == prod_data["sku"],
                Item.tenant_id == master_tenant.id
            ).first()
            
            if not item:
                item = Item(
                    tenant_id=master_tenant.id,
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
            
            # Get or create feed product
            product = db.query(FeedProduct).filter(
                FeedProduct.item_id == item.id,
                FeedProduct.tenant_id == master_tenant.id
            ).first()
            
            if not product:
                product = FeedProduct(
                    tenant_id=master_tenant.id,
                    item_id=item.id,
                    category=prod_data["category"],
                    subtype=prod_data.get("subtype"),
                    stage=prod_data.get("stage"),
                    pellet_size_mm=Decimal(str(prod_data["pellet_size_mm"])) if prod_data.get("pellet_size_mm") else None,
                    requires_grinding=True,
                    requires_extrusion=prod_data["category"] == "Fish",
                    requires_pelleting=prod_data["category"] in ["Poultry", "Cattle"],
                    created_by=admin.id
                )
                db.add(product)
                db.flush()
            
            products_map[prod_data["sku"]] = product
        
        db.commit()
        print(f"  [OK] Ensured {len(products_map)} feed products exist\n")
        
        # ========== Create Test BOMs ==========
        print("Step 3: Creating test BOMs...")
        
        bom_definitions = [
            {
                "bom_code": "FISH-FLOAT-2MM-RD-001",
                "product_sku": "FF-MC-001",
                "version": "1.0",
                "status": "approved",
                "process_type": "Extruded floating",
                "pellet_size_mm": 2.0,
                "is_floating": True,
                "batch_size_ton": 1.0,
                "target_protein_pct": 30.0,
                "target_fat_pct": 6.0,
                "target_fiber_pct": 6.0,
                "target_moisture_pct": 10.0,
                "notes": "R&D Test BOM - Fish Floating Feed 2mm for grower stage",
                "lines": [
                    {"ingredient_sku": "RM-MC-001", "sequence": 1, "inclusion_basis": "percent", "inclusion_value": 35.0, "phase": "mixing"},
                    {"ingredient_sku": "RM-MC-002", "sequence": 2, "inclusion_basis": "percent", "inclusion_value": 25.0, "phase": "mixing"},
                    {"ingredient_sku": "RM-MC-003", "sequence": 3, "inclusion_basis": "percent", "inclusion_value": 15.0, "phase": "mixing"},
                    {"ingredient_sku": "RM-MC-004", "sequence": 4, "inclusion_basis": "percent", "inclusion_value": 12.0, "phase": "mixing"},
                    {"ingredient_sku": "RM-MC-005", "sequence": 5, "inclusion_basis": "percent", "inclusion_value": 8.0, "phase": "mixing"},
                    {"ingredient_sku": "RM-MC-006", "sequence": 6, "inclusion_basis": "percent", "inclusion_value": 3.0, "phase": "coating"},
                    {"ingredient_sku": "RM-MC-007", "sequence": 7, "inclusion_basis": "g_per_ton", "inclusion_value": 2000.0, "phase": "mixing"},
                    {"ingredient_sku": "RM-MC-008", "sequence": 8, "inclusion_basis": "percent", "inclusion_value": 1.5, "phase": "mixing"},
                    {"ingredient_sku": "RM-MC-009", "sequence": 9, "inclusion_basis": "percent", "inclusion_value": 0.3, "phase": "mixing"},
                    {"ingredient_sku": "RM-MC-010", "sequence": 10, "inclusion_basis": "percent", "inclusion_value": 0.2, "phase": "mixing"},
                ]
            },
            {
                "bom_code": "FISH-FLOAT-4MM-RD-001",
                "product_sku": "FF-MC-002",
                "version": "1.0",
                "status": "approved",
                "process_type": "Extruded floating",
                "pellet_size_mm": 4.0,
                "is_floating": True,
                "batch_size_ton": 2.0,
                "target_protein_pct": 28.0,
                "target_fat_pct": 7.0,
                "target_fiber_pct": 7.0,
                "target_moisture_pct": 10.0,
                "notes": "R&D Test BOM - Fish Floating Feed 4mm for finisher stage",
                "lines": [
                    {"ingredient_sku": "RM-MC-001", "sequence": 1, "inclusion_basis": "percent", "inclusion_value": 40.0, "phase": "mixing"},
                    {"ingredient_sku": "RM-MC-002", "sequence": 2, "inclusion_basis": "percent", "inclusion_value": 22.0, "phase": "mixing"},
                    {"ingredient_sku": "RM-MC-003", "sequence": 3, "inclusion_basis": "percent", "inclusion_value": 18.0, "phase": "mixing"},
                    {"ingredient_sku": "RM-MC-004", "sequence": 4, "inclusion_basis": "percent", "inclusion_value": 10.0, "phase": "mixing"},
                    {"ingredient_sku": "RM-MC-005", "sequence": 5, "inclusion_basis": "percent", "inclusion_value": 6.0, "phase": "mixing"},
                    {"ingredient_sku": "RM-MC-006", "sequence": 6, "inclusion_basis": "percent", "inclusion_value": 3.5, "phase": "coating"},
                    {"ingredient_sku": "RM-MC-007", "sequence": 7, "inclusion_basis": "g_per_ton", "inclusion_value": 2000.0, "phase": "mixing"},
                    {"ingredient_sku": "RM-MC-008", "sequence": 8, "inclusion_basis": "percent", "inclusion_value": 1.8, "phase": "mixing"},
                    {"ingredient_sku": "RM-MC-009", "sequence": 9, "inclusion_basis": "percent", "inclusion_value": 0.4, "phase": "mixing"},
                    {"ingredient_sku": "RM-MC-010", "sequence": 10, "inclusion_basis": "percent", "inclusion_value": 0.3, "phase": "mixing"},
                ]
            },
            {
                "bom_code": "POULTRY-STARTER-RD-001",
                "product_sku": "FF-MC-003",
                "version": "1.0",
                "status": "draft",
                "process_type": "Pelleted",
                "pellet_size_mm": None,
                "is_floating": False,
                "batch_size_ton": 1.5,
                "target_protein_pct": 22.0,
                "target_fat_pct": 4.0,
                "target_fiber_pct": 5.0,
                "target_moisture_pct": 12.0,
                "notes": "R&D Test BOM - Poultry Starter Crumble (Draft for testing)",
                "lines": [
                    {"ingredient_sku": "RM-MC-001", "sequence": 1, "inclusion_basis": "percent", "inclusion_value": 50.0, "phase": "mixing"},
                    {"ingredient_sku": "RM-MC-002", "sequence": 2, "inclusion_basis": "percent", "inclusion_value": 30.0, "phase": "mixing"},
                    {"ingredient_sku": "RM-MC-003", "sequence": 3, "inclusion_basis": "percent", "inclusion_value": 12.0, "phase": "mixing"},
                    {"ingredient_sku": "RM-MC-005", "sequence": 4, "inclusion_basis": "percent", "inclusion_value": 5.0, "phase": "mixing"},
                    {"ingredient_sku": "RM-MC-008", "sequence": 5, "inclusion_basis": "percent", "inclusion_value": 2.0, "phase": "mixing"},
                    {"ingredient_sku": "RM-MC-009", "sequence": 6, "inclusion_basis": "percent", "inclusion_value": 0.8, "phase": "mixing"},
                    {"ingredient_sku": "RM-MC-010", "sequence": 7, "inclusion_basis": "percent", "inclusion_value": 0.2, "phase": "mixing"},
                ]
            },
            {
                "bom_code": "CATTLE-PELLET-RD-001",
                "product_sku": "FF-MC-004",
                "version": "1.0",
                "status": "approved",
                "process_type": "Pelleted",
                "pellet_size_mm": 6.0,
                "is_floating": False,
                "batch_size_ton": 2.5,
                "target_protein_pct": 16.0,
                "target_fat_pct": 3.0,
                "target_fiber_pct": 18.0,
                "target_moisture_pct": 12.0,
                "notes": "R&D Test BOM - Cattle Pellet Feed 6mm",
                "lines": [
                    {"ingredient_sku": "RM-MC-001", "sequence": 1, "inclusion_basis": "percent", "inclusion_value": 45.0, "phase": "mixing"},
                    {"ingredient_sku": "RM-MC-002", "sequence": 2, "inclusion_basis": "percent", "inclusion_value": 15.0, "phase": "mixing"},
                    {"ingredient_sku": "RM-MC-003", "sequence": 3, "inclusion_basis": "percent", "inclusion_value": 25.0, "phase": "mixing"},
                    {"ingredient_sku": "RM-MC-005", "sequence": 4, "inclusion_basis": "percent", "inclusion_value": 12.0, "phase": "mixing"},
                    {"ingredient_sku": "RM-MC-008", "sequence": 5, "inclusion_basis": "percent", "inclusion_value": 2.0, "phase": "mixing"},
                    {"ingredient_sku": "RM-MC-009", "sequence": 6, "inclusion_basis": "percent", "inclusion_value": 0.8, "phase": "mixing"},
                    {"ingredient_sku": "RM-MC-010", "sequence": 7, "inclusion_basis": "percent", "inclusion_value": 0.2, "phase": "mixing"},
                ]
            },
        ]
        
        created_count = 0
        for bom_def in bom_definitions:
            # Check if BOM already exists
            existing = db.query(FeedBom).filter(
                FeedBom.tenant_id == master_tenant.id,
                FeedBom.bom_code == bom_def["bom_code"],
                FeedBom.version == bom_def["version"]
            ).first()
            
            if existing:
                print(f"  [SKIP] BOM {bom_def['bom_code']} v{bom_def['version']} already exists, skipping...")
                continue
            
            # Get product
            product = products_map.get(bom_def["product_sku"])
            if not product:
                print(f"  [ERROR] Product {bom_def['product_sku']} not found, skipping BOM {bom_def['bom_code']}")
                continue
            
            # Create BOM
            bom = FeedBom(
                tenant_id=master_tenant.id,
                bom_code=bom_def["bom_code"],
                product_id=product.id,
                version=bom_def["version"],
                status=bom_def["status"],
                default_batch_size_ton=Decimal(str(bom_def["batch_size_ton"])),
                process_type=bom_def["process_type"],
                pellet_size_mm=Decimal(str(bom_def["pellet_size_mm"])) if bom_def.get("pellet_size_mm") else None,
                is_floating=bom_def["is_floating"],
                target_protein_pct=Decimal(str(bom_def["target_protein_pct"])),
                target_fat_pct=Decimal(str(bom_def["target_fat_pct"])),
                target_fiber_pct=Decimal(str(bom_def["target_fiber_pct"])),
                target_moisture_pct=Decimal(str(bom_def["target_moisture_pct"])),
                target_ash_pct=None,
                notes=bom_def.get("notes"),
                created_by=admin.id
            )
            db.add(bom)
            db.flush()
            
            # Create BOM lines
            for line_def in bom_def["lines"]:
                ingredient = ingredients_map.get(line_def["ingredient_sku"])
                if not ingredient:
                    print(f"  [ERROR] Ingredient {line_def['ingredient_sku']} not found for BOM {bom_def['bom_code']}")
                    continue
                
                line = FeedBomLine(
                    tenant_id=master_tenant.id,
                    bom_id=bom.id,
                    ingredient_id=ingredient.id,
                    sequence=line_def["sequence"],
                    inclusion_basis=line_def["inclusion_basis"],
                    inclusion_value=Decimal(str(line_def["inclusion_value"])),
                    loss_factor_pct=Decimal("0"),
                    phase=line_def.get("phase"),
                    created_by=admin.id
                )
                db.add(line)
            
            db.flush()
            
            # Compute totals
            try:
                BomService.compute_bom_totals(db, bom.id, bom.default_batch_size_ton)
            except Exception as e:
                print(f"  [WARN] Could not compute totals for {bom_def['bom_code']}: {e}")
            
            db.commit()
            created_count += 1
            print(f"  [OK] Created BOM: {bom_def['bom_code']} v{bom_def['version']} ({bom_def['status']}) - {len(bom_def['lines'])} lines")
        
        print(f"\n{'='*70}")
        print(f"SUCCESS: Created {created_count} test BOMs for Master Company")
        print(f"{'='*70}\n")
        
    except Exception as e:
        db.rollback()
        print(f"\nERROR: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    seed_master_company_boms()
