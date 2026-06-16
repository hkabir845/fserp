"""
Comprehensive Feed Manufacturing Seed Data
Creates demo products, ingredients, BOMs with all requirements
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
from app.modules.inventory.models import Warehouse, StockBalance
from app.modules.feed_manufacturing.models import (
    FeedProduct, Ingredient, FeedBom, FeedBomLine, BOMStatus, InclusionBasis
)
from app.core.security import get_password_hash

def seed_feed_manufacturing_complete():
    """Seed complete feed manufacturing demo data"""
    db = SessionLocal()
    try:
        print("\n" + "="*60)
        print("Seeding Complete Feed Manufacturing Demo Data")
        print("="*60 + "\n")
        
        # Get tenant
        tenant = db.query(Tenant).filter(Tenant.domain == "localhost").first()
        if not tenant:
            print("ERROR: Tenant 'localhost' not found. Please run seed.py first.")
            return
        
        # Get admin user
        admin = db.query(User).filter(
            User.email == "superadmin@fmerp.com",
            User.tenant_id == tenant.id
        ).first()
        if not admin:
            print("ERROR: Admin user not found. Please run seed.py first.")
            return
        
        # Get UOMs
        kg_uom = db.query(UOM).filter(UOM.tenant_id == tenant.id, UOM.code == "KG").first()
        if not kg_uom:
            print("ERROR: KG UOM not found. Please run seed.py first.")
            return
        
        # Create warehouses
        print("Creating Warehouses...")
        raw_warehouse = db.query(Warehouse).filter(
            Warehouse.tenant_id == tenant.id,
            Warehouse.name == "Raw Material Store"
        ).first()
        if not raw_warehouse:
            raw_warehouse = Warehouse(
                tenant_id=tenant.id,
                name="Raw Material Store",
                address="Building A, Floor 1",
                is_active=True,
                created_by=admin.id
            )
            db.add(raw_warehouse)
            db.flush()
            print("  [OK] Created Raw Material Store")
        
        finished_warehouse = db.query(Warehouse).filter(
            Warehouse.tenant_id == tenant.id,
            Warehouse.name == "Finished Goods Store"
        ).first()
        if not finished_warehouse:
            finished_warehouse = Warehouse(
                tenant_id=tenant.id,
                name="Finished Goods Store",
                address="Building B, Floor 1",
                is_active=True,
                created_by=admin.id
            )
            db.add(finished_warehouse)
            db.flush()
            print("  [OK] Created Finished Goods Store")
        
        # ========== Create Raw Materials (Ingredients) ==========
        print("\nCreating Raw Materials (15+ ingredients)...")
        
        raw_materials_data = [
            # Macro ingredients
            {"sku": "RM-001", "name": "Maize (Yellow Corn)", "type": "raw_material", "ingredient_type": "macro",
             "category": "grain", "protein_pct": 8.5, "fat_pct": 3.5, "fiber_pct": 2.5, "moisture_pct": 12.0,
             "ash_pct": 1.5, "energy_kcal": 3350, "standard_cost": 35.50, "min_inclusion": 0, "max_inclusion": 60},
            
            {"sku": "RM-002", "name": "Soybean Meal (48%)", "type": "raw_material", "ingredient_type": "macro",
             "category": "protein_source", "protein_pct": 48.0, "fat_pct": 1.5, "fiber_pct": 7.0, "moisture_pct": 12.0,
             "ash_pct": 6.5, "energy_kcal": 2400, "standard_cost": 85.00, "min_inclusion": 5, "max_inclusion": 35},
            
            {"sku": "RM-003", "name": "Rice Bran", "type": "raw_material", "ingredient_type": "macro",
             "category": "grain", "protein_pct": 12.5, "fat_pct": 15.0, "fiber_pct": 11.0, "moisture_pct": 11.0,
             "ash_pct": 10.0, "energy_kcal": 3200, "standard_cost": 28.00, "min_inclusion": 0, "max_inclusion": 25},
            
            {"sku": "RM-004", "name": "Wheat Bran", "type": "raw_material", "ingredient_type": "macro",
             "category": "grain", "protein_pct": 15.5, "fat_pct": 4.0, "fiber_pct": 9.5, "moisture_pct": 11.0,
             "ash_pct": 5.5, "energy_kcal": 1800, "standard_cost": 32.00, "min_inclusion": 0, "max_inclusion": 20},
            
            {"sku": "RM-005", "name": "Fish Meal (60%)", "type": "raw_material", "ingredient_type": "macro",
             "category": "protein_source", "protein_pct": 60.0, "fat_pct": 8.0, "fiber_pct": 1.0, "moisture_pct": 10.0,
             "ash_pct": 20.0, "energy_kcal": 2800, "standard_cost": 120.00, "min_inclusion": 0, "max_inclusion": 15},
            
            {"sku": "RM-006", "name": "Sunflower Meal", "type": "raw_material", "ingredient_type": "macro",
             "category": "protein_source", "protein_pct": 28.0, "fat_pct": 1.5, "fiber_pct": 25.0, "moisture_pct": 10.0,
             "ash_pct": 6.5, "energy_kcal": 1800, "standard_cost": 45.00, "min_inclusion": 0, "max_inclusion": 20},
            
            {"sku": "RM-007", "name": "Mustard Oil Cake", "type": "raw_material", "ingredient_type": "macro",
             "category": "protein_source", "protein_pct": 38.0, "fat_pct": 8.0, "fiber_pct": 12.0, "moisture_pct": 10.0,
             "ash_pct": 8.0, "energy_kcal": 2500, "standard_cost": 55.00, "min_inclusion": 0, "max_inclusion": 25},
            
            {"sku": "RM-008", "name": "Wheat Flour", "type": "raw_material", "ingredient_type": "macro",
             "category": "grain", "protein_pct": 12.0, "fat_pct": 1.5, "fiber_pct": 2.5, "moisture_pct": 13.0,
             "ash_pct": 0.8, "energy_kcal": 3400, "standard_cost": 38.00, "min_inclusion": 0, "max_inclusion": 30},
            
            {"sku": "RM-009", "name": "Broken Rice", "type": "raw_material", "ingredient_type": "macro",
             "category": "grain", "protein_pct": 7.5, "fat_pct": 0.8, "fiber_pct": 0.5, "moisture_pct": 12.0,
             "ash_pct": 0.5, "energy_kcal": 3500, "standard_cost": 42.00, "min_inclusion": 0, "max_inclusion": 40},
            
            {"sku": "RM-010", "name": "Til Oil Cake", "type": "raw_material", "ingredient_type": "macro",
             "category": "protein_source", "protein_pct": 35.0, "fat_pct": 6.0, "fiber_pct": 10.0, "moisture_pct": 10.0,
             "ash_pct": 7.5, "energy_kcal": 2400, "standard_cost": 50.00, "min_inclusion": 0, "max_inclusion": 20},
            
            # Premix/Micro
            {"sku": "RM-011", "name": "Vitamin-Mineral Premix (Fish)", "type": "raw_material", "ingredient_type": "micro",
             "category": "premix", "protein_pct": 0, "fat_pct": 0, "fiber_pct": 0, "moisture_pct": 5.0,
             "ash_pct": 0, "energy_kcal": 0, "standard_cost": 250.00, "is_premix": True, "premix_unit": "g_per_ton",
             "min_inclusion": 0, "max_inclusion": 0.5},
            
            {"sku": "RM-012", "name": "Vitamin-Mineral Premix (Poultry)", "type": "raw_material", "ingredient_type": "micro",
             "category": "premix", "protein_pct": 0, "fat_pct": 0, "fiber_pct": 0, "moisture_pct": 5.0,
             "ash_pct": 0, "energy_kcal": 0, "standard_cost": 280.00, "is_premix": True, "premix_unit": "g_per_ton",
             "min_inclusion": 0, "max_inclusion": 0.5},
            
            # Additives
            {"sku": "RM-013", "name": "Binder (CMC)", "type": "raw_material", "ingredient_type": "binder",
             "category": "additive", "protein_pct": 0, "fat_pct": 0, "fiber_pct": 0, "moisture_pct": 8.0,
             "ash_pct": 0, "energy_kcal": 0, "standard_cost": 180.00, "min_inclusion": 0, "max_inclusion": 2},
            
            {"sku": "RM-014", "name": "Antioxidant (BHT)", "type": "raw_material", "ingredient_type": "additive",
             "category": "additive", "protein_pct": 0, "fat_pct": 0, "fiber_pct": 0, "moisture_pct": 5.0,
             "ash_pct": 0, "energy_kcal": 0, "standard_cost": 450.00, "is_premix": True, "premix_unit": "g_per_ton",
             "min_inclusion": 0, "max_inclusion": 0.1},
            
            {"sku": "RM-015", "name": "Fish Oil", "type": "raw_material", "ingredient_type": "additive",
             "category": "fat_source", "protein_pct": 0, "fat_pct": 100.0, "fiber_pct": 0, "moisture_pct": 0,
             "ash_pct": 0, "energy_kcal": 9000, "standard_cost": 95.00, "min_inclusion": 0, "max_inclusion": 5},
            
            {"sku": "RM-016", "name": "Limestone (Calcium)", "type": "raw_material", "ingredient_type": "additive",
             "category": "mineral", "protein_pct": 0, "fat_pct": 0, "fiber_pct": 0, "moisture_pct": 1.0,
             "ash_pct": 95.0, "calcium_pct": 38.0, "energy_kcal": 0, "standard_cost": 12.00, "min_inclusion": 0, "max_inclusion": 3},
            
            {"sku": "RM-017", "name": "Dicalcium Phosphate", "type": "raw_material", "ingredient_type": "additive",
             "category": "mineral", "protein_pct": 0, "fat_pct": 0, "fiber_pct": 0, "moisture_pct": 1.0,
             "ash_pct": 80.0, "calcium_pct": 23.0, "phosphorus_pct": 18.0, "energy_kcal": 0, "standard_cost": 65.00,
             "min_inclusion": 0, "max_inclusion": 2},
        ]
        
        ingredients_map = {}
        for rm_data in raw_materials_data:
            # Create or get item
            item = db.query(Item).filter(
                Item.sku == rm_data["sku"],
                Item.tenant_id == tenant.id
            ).first()
            
            if not item:
                item = Item(
                    tenant_id=tenant.id,
                    sku=rm_data["sku"],
                    name=rm_data["name"],
                    type=rm_data["type"],
                    uom_id=kg_uom.id,
                    is_stock_tracked=True,
                    is_active=True,
                    standard_cost=Decimal(str(rm_data["standard_cost"])),
                    created_by=admin.id
                )
                db.add(item)
                db.flush()
                print(f"  [OK] Created item: {rm_data['name']}")
            
            # Create or get ingredient
            ingredient = db.query(Ingredient).filter(
                Ingredient.item_id == item.id,
                Ingredient.tenant_id == tenant.id
            ).first()
            
            if not ingredient:
                ingredient = Ingredient(
                    tenant_id=tenant.id,
                    item_id=item.id,
                    ingredient_type=rm_data["ingredient_type"],
                    category=rm_data.get("category"),
                    protein_pct=Decimal(str(rm_data.get("protein_pct", 0))),
                    fat_pct=Decimal(str(rm_data.get("fat_pct", 0))),
                    fiber_pct=Decimal(str(rm_data.get("fiber_pct", 0))),
                    moisture_pct=Decimal(str(rm_data.get("moisture_pct", 0))),
                    ash_pct=Decimal(str(rm_data.get("ash_pct", 0))),
                    energy_kcal=Decimal(str(rm_data.get("energy_kcal", 0))),
                    calcium_pct=Decimal(str(rm_data.get("calcium_pct", 0))) if rm_data.get("calcium_pct") else None,
                    phosphorus_pct=Decimal(str(rm_data.get("phosphorus_pct", 0))) if rm_data.get("phosphorus_pct") else None,
                    is_premix=rm_data.get("is_premix", False),
                    premix_unit=rm_data.get("premix_unit"),
                    min_inclusion_pct=Decimal(str(rm_data.get("min_inclusion", 0))),
                    max_inclusion_pct=Decimal(str(rm_data.get("max_inclusion", 100))),
                    created_by=admin.id
                )
                db.add(ingredient)
                db.flush()
                ingredients_map[rm_data["sku"]] = ingredient
                print(f"  [OK] Created ingredient: {rm_data['name']}")
            else:
                ingredients_map[rm_data["sku"]] = ingredient
        
        db.flush()
        
        # ========== Create Finished Feed Products ==========
        print("\nCreating Finished Feed Products...")
        
        # 1. Fish Floating Feed 2mm
        fish_item = db.query(Item).filter(
            Item.sku == "FF-001",
            Item.tenant_id == tenant.id
        ).first()
        if not fish_item:
            fish_item = Item(
                tenant_id=tenant.id,
                sku="FF-001",
                name="Fish Floating Feed 2mm",
                type="finished_good",
                uom_id=kg_uom.id,
                is_stock_tracked=True,
                is_active=True,
                created_by=admin.id
            )
            db.add(fish_item)
            db.flush()
        
        fish_product = db.query(FeedProduct).filter(
            FeedProduct.item_id == fish_item.id,
            FeedProduct.tenant_id == tenant.id
        ).first()
        if not fish_product:
            fish_product = FeedProduct(
                tenant_id=tenant.id,
                item_id=fish_item.id,
                category="Fish",
                subtype="Floating",
                stage="grower",
                pellet_size_mm=Decimal("2.0"),
                pack_size_kg=Decimal("25.0"),
                route_type="extruded_floating",
                target_protein_min_pct=Decimal("28.0"),
                target_protein_max_pct=Decimal("32.0"),
                target_fat_min_pct=Decimal("5.0"),
                target_fiber_max_pct=Decimal("8.0"),
                target_moisture_max_pct=Decimal("12.0"),
                target_energy_min_kcal=Decimal("3000"),
                requires_grinding=True,
                requires_mixing=True,
                requires_extrusion=True,
                requires_drying=True,
                requires_cooling=True,
                requires_coating=True,
                requires_packing=True,
                created_by=admin.id
            )
            db.add(fish_product)
            db.flush()
            print("  [OK] Created Fish Floating Feed 2mm")
        
        # 2. Poultry Starter Crumble
        poultry_item = db.query(Item).filter(
            Item.sku == "PF-001",
            Item.tenant_id == tenant.id
        ).first()
        if not poultry_item:
            poultry_item = Item(
                tenant_id=tenant.id,
                sku="PF-001",
                name="Poultry Starter Crumble",
                type="finished_good",
                uom_id=kg_uom.id,
                is_stock_tracked=True,
                is_active=True,
                created_by=admin.id
            )
            db.add(poultry_item)
            db.flush()
        
        poultry_product = db.query(FeedProduct).filter(
            FeedProduct.item_id == poultry_item.id,
            FeedProduct.tenant_id == tenant.id
        ).first()
        if not poultry_product:
            poultry_product = FeedProduct(
                tenant_id=tenant.id,
                item_id=poultry_item.id,
                category="Poultry",
                subtype="Crumble",
                stage="starter",
                pellet_size_mm=Decimal("2.0"),  # Before crumbling
                pack_size_kg=Decimal("25.0"),
                route_type="crumble",
                target_protein_min_pct=Decimal("20.0"),
                target_protein_max_pct=Decimal("22.0"),
                target_fat_min_pct=Decimal("3.5"),
                target_fiber_max_pct=Decimal("5.0"),
                target_moisture_max_pct=Decimal("13.0"),
                target_energy_min_kcal=Decimal("2900"),
                requires_grinding=True,
                requires_mixing=True,
                requires_conditioning=True,
                requires_pelleting=True,
                requires_cooling=True,
                requires_crumbling=True,
                requires_packing=True,
                created_by=admin.id
            )
            db.add(poultry_product)
            db.flush()
            print("  [OK] Created Poultry Starter Crumble")
        
        # 3. Cattle Pellet Feed
        cattle_item = db.query(Item).filter(
            Item.sku == "CF-001",
            Item.tenant_id == tenant.id
        ).first()
        if not cattle_item:
            cattle_item = Item(
                tenant_id=tenant.id,
                sku="CF-001",
                name="Cattle Pellet Feed",
                type="finished_good",
                uom_id=kg_uom.id,
                is_stock_tracked=True,
                is_active=True,
                created_by=admin.id
            )
            db.add(cattle_item)
            db.flush()
        
        cattle_product = db.query(FeedProduct).filter(
            FeedProduct.item_id == cattle_item.id,
            FeedProduct.tenant_id == tenant.id
        ).first()
        if not cattle_product:
            cattle_product = FeedProduct(
                tenant_id=tenant.id,
                item_id=cattle_item.id,
                category="Cattle",
                stage="lactating",
                pellet_size_mm=Decimal("8.0"),
                pack_size_kg=Decimal("50.0"),
                route_type="pelleted",
                target_protein_min_pct=Decimal("16.0"),
                target_protein_max_pct=Decimal("18.0"),
                target_fiber_max_pct=Decimal("18.0"),
                target_moisture_max_pct=Decimal("13.0"),
                target_energy_min_kcal=Decimal("2500"),
                requires_grinding=True,
                requires_mixing=True,
                requires_conditioning=True,
                requires_pelleting=True,
                requires_cooling=True,
                requires_packing=True,
                created_by=admin.id
            )
            db.add(cattle_product)
            db.flush()
            print("  [OK] Created Cattle Pellet Feed")
        
        db.flush()
        
        # ========== Create BOMs ==========
        print("\nCreating BOMs...")
        
        # BOM 1: Fish Floating Feed 2mm
        fish_bom = db.query(FeedBom).filter(
            FeedBom.bom_code == "FISH-001",
            FeedBom.tenant_id == tenant.id
        ).first()
        if not fish_bom:
            fish_bom = FeedBom(
                tenant_id=tenant.id,
                bom_code="FISH-001",
                product_id=fish_product.id,
                version="1.0",
                status=BOMStatus.APPROVED,
                default_batch_size_kg=Decimal("1000"),  # 1 ton
                route_type="extruded_floating",
                pellet_size_mm=Decimal("2.0"),
                float_type="floating",
                target_protein_pct=Decimal("30.0"),
                target_fat_pct=Decimal("6.0"),
                target_fiber_pct=Decimal("6.0"),
                target_moisture_pct=Decimal("10.0"),
                effective_from=datetime.utcnow(),
                approved_by=admin.id,
                approved_at=datetime.utcnow(),
                created_by=admin.id
            )
            db.add(fish_bom)
            db.flush()
            
            # Add BOM lines (mixed basis: %, kg/ton, g/ton)
            bom_lines_data = [
                {"sku": "RM-001", "basis": "percent", "value": 35.0, "phase": "grinding"},
                {"sku": "RM-002", "basis": "percent", "value": 25.0, "phase": "mixing"},
                {"sku": "RM-005", "basis": "percent", "value": 8.0, "phase": "mixing"},
                {"sku": "RM-003", "basis": "percent", "value": 15.0, "phase": "mixing"},
                {"sku": "RM-008", "basis": "percent", "value": 10.0, "phase": "mixing"},
                {"sku": "RM-009", "basis": "percent", "value": 5.0, "phase": "mixing"},
                {"sku": "RM-011", "basis": "g_per_ton", "value": 2000.0, "phase": "mixing"},  # Premix in g/ton
                {"sku": "RM-013", "basis": "kg_per_ton", "value": 5.0, "phase": "mixing"},  # Binder in kg/ton
                {"sku": "RM-014", "basis": "g_per_ton", "value": 150.0, "phase": "mixing"},  # Antioxidant in g/ton
                {"sku": "RM-015", "basis": "percent", "value": 1.5, "phase": "coating"},  # Fish oil for coating
            ]
            
            sequence = 0
            for line_data in bom_lines_data:
                ingredient = ingredients_map.get(line_data["sku"])
                if not ingredient:
                    continue
                
                line = FeedBomLine(
                    tenant_id=tenant.id,
                    bom_id=fish_bom.id,
                    ingredient_id=ingredient.id,
                    sequence=sequence,
                    inclusion_basis=line_data["basis"],
                    inclusion_value=Decimal(str(line_data["value"])),
                    phase=line_data.get("phase"),
                    is_process_aid=False,
                    created_by=admin.id
                )
                db.add(line)
                sequence += 1
            
            db.flush()
            print("  [OK] Created BOM: FISH-001 (Fish Floating Feed 2mm)")
        
        # BOM 2: Poultry Starter Crumble
        poultry_bom = db.query(FeedBom).filter(
            FeedBom.bom_code == "POULTRY-001",
            FeedBom.tenant_id == tenant.id
        ).first()
        if not poultry_bom:
            poultry_bom = FeedBom(
                tenant_id=tenant.id,
                bom_code="POULTRY-001",
                product_id=poultry_product.id,
                version="1.0",
                status=BOMStatus.APPROVED,
                default_batch_size_kg=Decimal("1000"),
                route_type="crumble",
                pellet_size_mm=Decimal("2.0"),
                target_protein_pct=Decimal("21.0"),
                target_fat_pct=Decimal("4.0"),
                target_fiber_pct=Decimal("4.5"),
                target_moisture_pct=Decimal("12.0"),
                effective_from=datetime.utcnow(),
                approved_by=admin.id,
                approved_at=datetime.utcnow(),
                created_by=admin.id
            )
            db.add(poultry_bom)
            db.flush()
            
            bom_lines_data = [
                {"sku": "RM-001", "basis": "percent", "value": 45.0},
                {"sku": "RM-002", "basis": "percent", "value": 28.0},
                {"sku": "RM-003", "basis": "percent", "value": 12.0},
                {"sku": "RM-004", "basis": "percent", "value": 8.0},
                {"sku": "RM-006", "basis": "percent", "value": 5.0},
                {"sku": "RM-012", "basis": "g_per_ton", "value": 2500.0},  # Premix
                {"sku": "RM-016", "basis": "percent", "value": 1.5},
                {"sku": "RM-017", "basis": "percent", "value": 0.5},
            ]
            
            sequence = 0
            for line_data in bom_lines_data:
                ingredient = ingredients_map.get(line_data["sku"])
                if not ingredient:
                    continue
                
                line = FeedBomLine(
                    tenant_id=tenant.id,
                    bom_id=poultry_bom.id,
                    ingredient_id=ingredient.id,
                    sequence=sequence,
                    inclusion_basis=line_data["basis"],
                    inclusion_value=Decimal(str(line_data["value"])),
                    phase="mixing",
                    is_process_aid=False,
                    created_by=admin.id
                )
                db.add(line)
                sequence += 1
            
            db.flush()
            print("  [OK] Created BOM: POULTRY-001 (Poultry Starter Crumble)")
        
        # BOM 3: Cattle Pellet Feed
        cattle_bom = db.query(FeedBom).filter(
            FeedBom.bom_code == "CATTLE-001",
            FeedBom.tenant_id == tenant.id
        ).first()
        if not cattle_bom:
            cattle_bom = FeedBom(
                tenant_id=tenant.id,
                bom_code="CATTLE-001",
                product_id=cattle_product.id,
                version="1.0",
                status=BOMStatus.APPROVED,
                default_batch_size_kg=Decimal("1000"),
                route_type="pelleted",
                pellet_size_mm=Decimal("8.0"),
                target_protein_pct=Decimal("17.0"),
                target_fiber_pct=Decimal("16.0"),
                target_moisture_pct=Decimal("12.0"),
                effective_from=datetime.utcnow(),
                approved_by=admin.id,
                approved_at=datetime.utcnow(),
                created_by=admin.id
            )
            db.add(cattle_bom)
            db.flush()
            
            bom_lines_data = [
                {"sku": "RM-001", "basis": "percent", "value": 40.0},
                {"sku": "RM-002", "basis": "percent", "value": 15.0},
                {"sku": "RM-003", "basis": "percent", "value": 20.0},
                {"sku": "RM-004", "basis": "percent", "value": 15.0},
                {"sku": "RM-007", "basis": "percent", "value": 8.0},
                {"sku": "RM-010", "basis": "percent", "value": 1.5},
                {"sku": "RM-016", "basis": "percent", "value": 0.5},
            ]
            
            sequence = 0
            for line_data in bom_lines_data:
                ingredient = ingredients_map.get(line_data["sku"])
                if not ingredient:
                    continue
                
                line = FeedBomLine(
                    tenant_id=tenant.id,
                    bom_id=cattle_bom.id,
                    ingredient_id=ingredient.id,
                    sequence=sequence,
                    inclusion_basis=line_data["basis"],
                    inclusion_value=Decimal(str(line_data["value"])),
                    phase="mixing",
                    is_process_aid=False,
                    created_by=admin.id
                )
                db.add(line)
                sequence += 1
            
            db.flush()
            print("  [OK] Created BOM: CATTLE-001 (Cattle Pellet Feed)")
        
        # Normalize all BOMs
        print("\nNormalizing BOM lines...")
        from app.modules.feed_manufacturing.bom_service import BomService
        for bom in [fish_bom, poultry_bom, cattle_bom]:
            if bom:
                BomService.normalize_bom_lines(db, bom.id)
                print(f"  [OK] Normalized {bom.bom_code}")
        
        db.commit()
        print("\n" + "="*60)
        print("[SUCCESS] Feed Manufacturing Demo Data Seeded Successfully!")
        print("="*60 + "\n")
        print("Created:")
        print("  - 17 Raw Materials with nutrient profiles")
        print("  - 3 Finished Feed Products")
        print("  - 3 Approved BOMs with mixed inclusion basis")
        print("\nDemo Products:")
        print("  1. Fish Floating Feed 2mm (FISH-001)")
        print("  2. Poultry Starter Crumble (POULTRY-001)")
        print("  3. Cattle Pellet Feed (CATTLE-001)")
        
    except Exception as e:
        db.rollback()
        print(f"\n[ERROR] Error seeding feed manufacturing data: {e}")
        import traceback
        traceback.print_exc()
        raise
    finally:
        db.close()

if __name__ == "__main__":
    seed_feed_manufacturing_complete()



