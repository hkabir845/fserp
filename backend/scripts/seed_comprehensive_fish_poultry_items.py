"""
Comprehensive Seed Script for Fish and Poultry Items (A to Z)
Creates all types of items from ingredients to finished goods for Master Company
These items will be available for all tenant companies
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
# Import all models to ensure relationships are configured
from app.db.base import init_db

def seed_comprehensive_items():
    """Seed comprehensive Fish and Poultry items for Master Company"""
    # Ensure all models are imported
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
        print(f"SEEDING COMPREHENSIVE FISH & POULTRY ITEMS FOR MASTER COMPANY")
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
        bag_uom = db.query(UOM).filter(
            UOM.tenant_id == master_tenant.id,
            UOM.code == 'BAG'
        ).first() or nos_uom
        
        if not kg_uom or not l_uom or not nos_uom:
            print("ERROR: Required UOMs (KG, L, NOS) not found!")
            return
        
        # Get or create categories
        categories = {}
        category_names = [
            "Grains & Cereals", "Protein Sources", "Fats & Oils", 
            "Vitamins & Minerals", "Additives", "Packaging",
            "Fish Feeds", "Poultry Feeds"
        ]
        for cat_name in category_names:
            cat = db.query(ItemCategory).filter(
                ItemCategory.tenant_id == master_tenant.id,
                ItemCategory.name == cat_name
            ).first()
            if not cat:
                cat = ItemCategory(
                    tenant_id=master_tenant.id,
                    name=cat_name,
                    created_by=admin.id
                )
                db.add(cat)
                db.flush()
            categories[cat_name] = cat
        
        created_items = 0
        created_ingredients = 0
        created_products = 0
        
        # ========== RAW MATERIALS - INGREDIENTS (A to Z) ==========
        print("Step 1: Creating Raw Materials (Ingredients)...")
        
        raw_materials = [
            # Grains & Cereals
            {"sku": "ING-A-001", "name": "Maize (Yellow Corn)", "type": "raw_material", "category": "Grains & Cereals",
             "uom": kg_uom, "cost": 35.50, "ingredient_type": "macro",
             "protein": 8.5, "fat": 3.5, "fiber": 2.5, "moisture": 12.0, "ash": 1.5, "energy": 3350},
            {"sku": "ING-B-001", "name": "Broken Rice", "type": "raw_material", "category": "Grains & Cereals",
             "uom": kg_uom, "cost": 42.00, "ingredient_type": "macro",
             "protein": 7.5, "fat": 0.8, "fiber": 0.5, "moisture": 12.0, "ash": 0.5, "energy": 3500},
            {"sku": "ING-C-001", "name": "Corn Gluten Meal", "type": "raw_material", "category": "Grains & Cereals",
             "uom": kg_uom, "cost": 55.00, "ingredient_type": "macro",
             "protein": 60.0, "fat": 2.0, "fiber": 1.0, "moisture": 10.0, "ash": 1.0, "energy": 3800},
            {"sku": "ING-D-001", "name": "Dehulled Soybean Meal", "type": "raw_material", "category": "Protein Sources",
             "uom": kg_uom, "cost": 90.00, "ingredient_type": "macro",
             "protein": 48.0, "fat": 1.5, "fiber": 7.0, "moisture": 12.0, "ash": 6.5, "energy": 2400},
            {"sku": "ING-E-001", "name": "Expanded Soybean", "type": "raw_material", "category": "Protein Sources",
             "uom": kg_uom, "cost": 75.00, "ingredient_type": "macro",
             "protein": 36.0, "fat": 18.0, "fiber": 5.0, "moisture": 10.0, "ash": 5.0, "energy": 4200},
            {"sku": "ING-F-001", "name": "Fish Meal (60% Protein)", "type": "raw_material", "category": "Protein Sources",
             "uom": kg_uom, "cost": 120.00, "ingredient_type": "macro",
             "protein": 60.0, "fat": 8.0, "fiber": 1.0, "moisture": 10.0, "ash": 20.0, "energy": 2800},
            {"sku": "ING-F-002", "name": "Fish Meal (65% Protein)", "type": "raw_material", "category": "Protein Sources",
             "uom": kg_uom, "cost": 135.00, "ingredient_type": "macro",
             "protein": 65.0, "fat": 7.0, "fiber": 1.0, "moisture": 10.0, "ash": 18.0, "energy": 2900},
            {"sku": "ING-F-003", "name": "Fish Oil", "type": "raw_material", "category": "Fats & Oils",
             "uom": l_uom, "cost": 160.00, "ingredient_type": "additive",
             "protein": 0, "fat": 100.0, "fiber": 0, "moisture": 0, "ash": 0, "energy": 9000},
            {"sku": "ING-G-001", "name": "Groundnut Cake", "type": "raw_material", "category": "Protein Sources",
             "uom": kg_uom, "cost": 70.00, "ingredient_type": "macro",
             "protein": 45.0, "fat": 7.0, "fiber": 8.0, "moisture": 10.0, "ash": 5.5, "energy": 3600},
            {"sku": "ING-H-001", "name": "Hydrolyzed Feather Meal", "type": "raw_material", "category": "Protein Sources",
             "uom": kg_uom, "cost": 65.00, "ingredient_type": "macro",
             "protein": 85.0, "fat": 2.5, "fiber": 0.5, "moisture": 8.0, "ash": 3.0, "energy": 3200},
            {"sku": "ING-L-001", "name": "L-Lysine HCl", "type": "raw_material", "category": "Additives",
             "uom": kg_uom, "cost": 300.00, "ingredient_type": "additive",
             "protein": 0, "fat": 0, "fiber": 0, "moisture": 1.0, "ash": 0, "energy": 0},
            {"sku": "ING-L-002", "name": "Limestone Powder (Calcium)", "type": "raw_material", "category": "Additives",
             "uom": kg_uom, "cost": 12.00, "ingredient_type": "additive",
             "protein": 0, "fat": 0, "fiber": 0, "moisture": 1.0, "ash": 95.0, "energy": 0},
            {"sku": "ING-M-001", "name": "Meat & Bone Meal", "type": "raw_material", "category": "Protein Sources",
             "uom": kg_uom, "cost": 95.00, "ingredient_type": "macro",
             "protein": 50.0, "fat": 10.0, "fiber": 2.0, "moisture": 8.0, "ash": 28.0, "energy": 2600},
            {"sku": "ING-M-002", "name": "Mustard Oil Cake", "type": "raw_material", "category": "Protein Sources",
             "uom": kg_uom, "cost": 55.00, "ingredient_type": "macro",
             "protein": 38.0, "fat": 8.0, "fiber": 12.0, "moisture": 10.0, "ash": 8.0, "energy": 2500},
            {"sku": "ING-M-003", "name": "DL-Methionine", "type": "raw_material", "category": "Additives",
             "uom": kg_uom, "cost": 450.00, "ingredient_type": "additive",
             "protein": 0, "fat": 0, "fiber": 0, "moisture": 0.5, "ash": 0, "energy": 0},
            {"sku": "ING-P-001", "name": "Palm Kernel Cake", "type": "raw_material", "category": "Protein Sources",
             "uom": kg_uom, "cost": 40.00, "ingredient_type": "macro",
             "protein": 18.0, "fat": 8.0, "fiber": 15.0, "moisture": 11.0, "ash": 4.5, "energy": 2200},
            {"sku": "ING-P-002", "name": "Dicalcium Phosphate (DCP)", "type": "raw_material", "category": "Additives",
             "uom": kg_uom, "cost": 65.00, "ingredient_type": "additive",
             "protein": 0, "fat": 0, "fiber": 0, "moisture": 1.0, "ash": 80.0, "energy": 0},
            {"sku": "ING-R-001", "name": "Rice Bran", "type": "raw_material", "category": "Grains & Cereals",
             "uom": kg_uom, "cost": 28.00, "ingredient_type": "macro",
             "protein": 12.5, "fat": 15.0, "fiber": 11.0, "moisture": 11.0, "ash": 10.0, "energy": 3200},
            {"sku": "ING-R-002", "name": "Rice Polish", "type": "raw_material", "category": "Grains & Cereals",
             "uom": kg_uom, "cost": 35.00, "ingredient_type": "macro",
             "protein": 13.0, "fat": 12.0, "fiber": 2.0, "moisture": 11.0, "ash": 8.0, "energy": 3400},
            {"sku": "ING-S-001", "name": "Soybean Meal (48%)", "type": "raw_material", "category": "Protein Sources",
             "uom": kg_uom, "cost": 85.00, "ingredient_type": "macro",
             "protein": 48.0, "fat": 1.5, "fiber": 7.0, "moisture": 12.0, "ash": 6.5, "energy": 2400},
            {"sku": "ING-S-002", "name": "Sunflower Meal", "type": "raw_material", "category": "Protein Sources",
             "uom": kg_uom, "cost": 45.00, "ingredient_type": "macro",
             "protein": 28.0, "fat": 1.5, "fiber": 25.0, "moisture": 10.0, "ash": 6.5, "energy": 1800},
            {"sku": "ING-S-003", "name": "Sorghum (Jowar)", "type": "raw_material", "category": "Grains & Cereals",
             "uom": kg_uom, "cost": 32.00, "ingredient_type": "macro",
             "protein": 10.0, "fat": 3.0, "fiber": 2.5, "moisture": 12.0, "ash": 1.8, "energy": 3300},
            {"sku": "ING-S-004", "name": "Salt (NaCl)", "type": "raw_material", "category": "Additives",
             "uom": kg_uom, "cost": 12.00, "ingredient_type": "additive",
             "protein": 0, "fat": 0, "fiber": 0, "moisture": 0.5, "ash": 99.0, "energy": 0},
            {"sku": "ING-T-001", "name": "Til Oil Cake (Sesame)", "type": "raw_material", "category": "Protein Sources",
             "uom": kg_uom, "cost": 50.00, "ingredient_type": "macro",
             "protein": 35.0, "fat": 6.0, "fiber": 10.0, "moisture": 10.0, "ash": 7.5, "energy": 2400},
            {"sku": "ING-V-001", "name": "Vitamin-Mineral Premix (Fish)", "type": "raw_material", "category": "Vitamins & Minerals",
             "uom": kg_uom, "cost": 250.00, "ingredient_type": "micro", "is_premix": True,
             "protein": 0, "fat": 0, "fiber": 0, "moisture": 5.0, "ash": 0, "energy": 0},
            {"sku": "ING-V-002", "name": "Vitamin-Mineral Premix (Poultry)", "type": "raw_material", "category": "Vitamins & Minerals",
             "uom": kg_uom, "cost": 280.00, "ingredient_type": "micro", "is_premix": True,
             "protein": 0, "fat": 0, "fiber": 0, "moisture": 5.0, "ash": 0, "energy": 0},
            {"sku": "ING-W-001", "name": "Wheat Bran", "type": "raw_material", "category": "Grains & Cereals",
             "uom": kg_uom, "cost": 32.00, "ingredient_type": "macro",
             "protein": 15.5, "fat": 4.0, "fiber": 9.5, "moisture": 11.0, "ash": 5.5, "energy": 1800},
            {"sku": "ING-W-002", "name": "Wheat Flour (Binder)", "type": "raw_material", "category": "Grains & Cereals",
             "uom": kg_uom, "cost": 38.00, "ingredient_type": "macro",
             "protein": 12.0, "fat": 1.5, "fiber": 2.5, "moisture": 13.0, "ash": 0.8, "energy": 3400},
            {"sku": "ING-W-003", "name": "Wheat Middlings", "type": "raw_material", "category": "Grains & Cereals",
             "uom": kg_uom, "cost": 30.00, "ingredient_type": "macro",
             "protein": 16.0, "fat": 4.5, "fiber": 7.0, "moisture": 11.0, "ash": 4.5, "energy": 2000},
            {"sku": "ING-X-001", "name": "Xanthan Gum (Binder)", "type": "raw_material", "category": "Additives",
             "uom": kg_uom, "cost": 380.00, "ingredient_type": "binder",
             "protein": 0, "fat": 0, "fiber": 0, "moisture": 8.0, "ash": 0, "energy": 0},
            {"sku": "ING-Y-001", "name": "Yeast Extract", "type": "raw_material", "category": "Additives",
             "uom": kg_uom, "cost": 220.00, "ingredient_type": "additive",
             "protein": 45.0, "fat": 1.0, "fiber": 0, "moisture": 5.0, "ash": 8.0, "energy": 1800},
            {"sku": "ING-Z-001", "name": "Zinc Oxide", "type": "raw_material", "category": "Additives",
             "uom": kg_uom, "cost": 280.00, "ingredient_type": "additive",
             "protein": 0, "fat": 0, "fiber": 0, "moisture": 0.5, "ash": 0, "energy": 0},
            
            # Additional common ingredients
            {"sku": "ING-ADD-001", "name": "Antioxidant (BHT)", "type": "raw_material", "category": "Additives",
             "uom": kg_uom, "cost": 450.00, "ingredient_type": "additive", "is_premix": True,
             "protein": 0, "fat": 0, "fiber": 0, "moisture": 5.0, "ash": 0, "energy": 0},
            {"sku": "ING-ADD-002", "name": "Binder (CMC)", "type": "raw_material", "category": "Additives",
             "uom": kg_uom, "cost": 180.00, "ingredient_type": "binder",
             "protein": 0, "fat": 0, "fiber": 0, "moisture": 8.0, "ash": 0, "energy": 0},
            {"sku": "ING-ADD-003", "name": "Choline Chloride (60%)", "type": "raw_material", "category": "Additives",
             "uom": kg_uom, "cost": 180.00, "ingredient_type": "additive",
             "protein": 0, "fat": 0, "fiber": 0, "moisture": 1.0, "ash": 0, "energy": 0},
            {"sku": "ING-ADD-004", "name": "Toxin Binder", "type": "raw_material", "category": "Additives",
             "uom": kg_uom, "cost": 95.00, "ingredient_type": "additive",
             "protein": 0, "fat": 0, "fiber": 0, "moisture": 8.0, "ash": 0, "energy": 0},
            {"sku": "ING-ADD-005", "name": "Enzyme (Phytase)", "type": "raw_material", "category": "Additives",
             "uom": kg_uom, "cost": 320.00, "ingredient_type": "additive",
             "protein": 0, "fat": 0, "fiber": 0, "moisture": 5.0, "ash": 0, "energy": 0},
            {"sku": "ING-ADD-006", "name": "Probiotic Mix", "type": "raw_material", "category": "Additives",
             "uom": kg_uom, "cost": 450.00, "ingredient_type": "additive",
             "protein": 0, "fat": 0, "fiber": 0, "moisture": 5.0, "ash": 0, "energy": 0},
            {"sku": "ING-ADD-007", "name": "Vegetable Oil", "type": "raw_material", "category": "Fats & Oils",
             "uom": l_uom, "cost": 140.00, "ingredient_type": "additive",
             "protein": 0, "fat": 100.0, "fiber": 0, "moisture": 0, "ash": 0, "energy": 9000},
            {"sku": "ING-ADD-008", "name": "Palm Oil", "type": "raw_material", "category": "Fats & Oils",
             "uom": l_uom, "cost": 130.00, "ingredient_type": "additive",
             "protein": 0, "fat": 100.0, "fiber": 0, "moisture": 0, "ash": 0, "energy": 9000},
            
            # Packaging
            {"sku": "PKG-001", "name": "PP Bag 25kg", "type": "raw_material", "category": "Packaging",
             "uom": nos_uom, "cost": 6.00, "ingredient_type": None},
            {"sku": "PKG-002", "name": "PP Bag 50kg", "type": "raw_material", "category": "Packaging",
             "uom": nos_uom, "cost": 8.50, "ingredient_type": None},
            {"sku": "PKG-003", "name": "Label/Sticker", "type": "raw_material", "category": "Packaging",
             "uom": nos_uom, "cost": 0.20, "ingredient_type": None},
        ]
        
        for rm in raw_materials:
            # Check if item exists by SKU or by name (to avoid duplicates)
            item = db.query(Item).filter(
                Item.tenant_id == master_tenant.id,
                Item.sku == rm["sku"]
            ).first()
            
            # If not found by SKU, check by name
            if not item:
                item = db.query(Item).filter(
                    Item.tenant_id == master_tenant.id,
                    Item.name == rm["name"],
                    Item.type == rm["type"]
                ).first()
            
            if not item:
                item = Item(
                    tenant_id=master_tenant.id,
                    sku=rm["sku"],
                    name=rm["name"],
                    type=rm["type"],
                    uom_id=rm["uom"].id,
                    category_id=categories[rm["category"]].id if rm.get("category") else None,
                    is_stock_tracked=True,
                    is_active=True,
                    standard_cost=Decimal(str(rm["cost"])),
                    created_by=admin.id
                )
                db.add(item)
                db.flush()
                created_items += 1
                print(f"  [OK] Created item: {rm['sku']} - {rm['name']}")
            else:
                print(f"  [SKIP] Item exists: {rm['sku']} - {rm['name']}")
            
            # Create ingredient if it's an ingredient type (even if item already exists)
            if rm.get("ingredient_type") and item:
                ingredient = db.query(Ingredient).filter(
                    Ingredient.item_id == item.id,
                    Ingredient.tenant_id == master_tenant.id
                ).first()
                
                if not ingredient:
                    ingredient = Ingredient(
                        tenant_id=master_tenant.id,
                        item_id=item.id,
                        ingredient_type=rm["ingredient_type"],
                        protein_pct=Decimal(str(rm.get("protein", 0))),
                        fat_pct=Decimal(str(rm.get("fat", 0))),
                        fiber_pct=Decimal(str(rm.get("fiber", 0))),
                        moisture_pct=Decimal(str(rm.get("moisture", 0))),
                        ash_pct=Decimal(str(rm.get("ash", 0))),
                        energy_kcal=Decimal(str(rm.get("energy", 0))),
                        is_premix=rm.get("is_premix", False),
                        premix_unit="g_per_ton" if rm.get("is_premix") else None,
                        created_by=admin.id
                    )
                    db.add(ingredient)
                    db.flush()
                    created_ingredients += 1
                    print(f"    [OK] Created ingredient for: {rm['name']}")
        
        db.commit()
        print(f"\n  Summary: {created_items} items, {created_ingredients} ingredients created\n")
        
        # ========== FINISHED GOODS - FISH FEEDS ==========
        print("Step 2: Creating Finished Goods - Fish Feeds...")
        
        fish_feeds = [
            # Starter feeds
            {"sku": "FF-FISH-STR-0.8", "name": "Fish Starter Feed 0.8mm (Floating)", "category": "Fish", 
             "subtype": "Floating", "stage": "starter", "pellet_size": 0.8, "cost": 58.00},
            {"sku": "FF-FISH-STR-1.0", "name": "Fish Starter Feed 1.0mm (Floating)", "category": "Fish",
             "subtype": "Floating", "stage": "starter", "pellet_size": 1.0, "cost": 57.00},
            {"sku": "FF-FISH-STR-1.2", "name": "Fish Starter Feed 1.2mm (Floating)", "category": "Fish",
             "subtype": "Floating", "stage": "starter", "pellet_size": 1.2, "cost": 56.00},
            
            # Grower feeds
            {"sku": "FF-FISH-GRW-1.5", "name": "Fish Grower Feed 1.5mm (Floating)", "category": "Fish",
             "subtype": "Floating", "stage": "grower", "pellet_size": 1.5, "cost": 52.00},
            {"sku": "FF-FISH-GRW-2.0", "name": "Fish Grower Feed 2.0mm (Floating)", "category": "Fish",
             "subtype": "Floating", "stage": "grower", "pellet_size": 2.0, "cost": 50.00},
            {"sku": "FF-FISH-GRW-2.5", "name": "Fish Grower Feed 2.5mm (Floating)", "category": "Fish",
             "subtype": "Floating", "stage": "grower", "pellet_size": 2.5, "cost": 49.00},
            
            # Finisher feeds
            {"sku": "FF-FISH-FIN-3.0", "name": "Fish Finisher Feed 3.0mm (Floating)", "category": "Fish",
             "subtype": "Floating", "stage": "finisher", "pellet_size": 3.0, "cost": 48.00},
            {"sku": "FF-FISH-FIN-4.0", "name": "Fish Finisher Feed 4.0mm (Floating)", "category": "Fish",
             "subtype": "Floating", "stage": "finisher", "pellet_size": 4.0, "cost": 47.00},
            {"sku": "FF-FISH-FIN-5.0", "name": "Fish Finisher Feed 5.0mm (Floating)", "category": "Fish",
             "subtype": "Floating", "stage": "finisher", "pellet_size": 5.0, "cost": 46.00},
            
            # Sinking feeds
            {"sku": "FF-FISH-SNK-2.0", "name": "Fish Sinking Feed 2.0mm", "category": "Fish",
             "subtype": "Sinking", "stage": "grower", "pellet_size": 2.0, "cost": 49.00},
            {"sku": "FF-FISH-SNK-3.0", "name": "Fish Sinking Feed 3.0mm", "category": "Fish",
             "subtype": "Sinking", "stage": "finisher", "pellet_size": 3.0, "cost": 47.00},
            {"sku": "FF-FISH-SNK-4.0", "name": "Fish Sinking Feed 4.0mm", "category": "Fish",
             "subtype": "Sinking", "stage": "finisher", "pellet_size": 4.0, "cost": 46.00},
        ]
        
        for feed in fish_feeds:
            item = db.query(Item).filter(
                Item.tenant_id == master_tenant.id,
                Item.sku == feed["sku"]
            ).first()
            
            if not item:
                item = Item(
                    tenant_id=master_tenant.id,
                    sku=feed["sku"],
                    name=feed["name"],
                    type="finished_good",
                    uom_id=kg_uom.id,
                    category_id=categories["Fish Feeds"].id,
                    is_stock_tracked=True,
                    is_active=True,
                    standard_cost=Decimal(str(feed["cost"])),
                    created_by=admin.id
                )
                db.add(item)
                db.flush()
                created_items += 1
                
                # Create FeedProduct
                product = db.query(FeedProduct).filter(
                    FeedProduct.item_id == item.id,
                    FeedProduct.tenant_id == master_tenant.id
                ).first()
                
                if not product:
                    product = FeedProduct(
                        tenant_id=master_tenant.id,
                        item_id=item.id,
                        category=feed["category"],
                        subtype=feed.get("subtype"),
                        stage=feed.get("stage"),
                        pellet_size_mm=Decimal(str(feed["pellet_size"])),
                        requires_grinding=True,
                        requires_extrusion=True,
                        requires_drying=True,
                        requires_coating=feed.get("subtype") == "Floating",
                        created_by=admin.id
                    )
                    db.add(product)
                    db.flush()
                    created_products += 1
                
                print(f"  [OK] Created: {feed['sku']} - {feed['name']}")
        
        db.commit()
        print(f"\n  Summary: {created_items} items, {created_products} feed products created\n")
        
        # ========== FINISHED GOODS - POULTRY FEEDS ==========
        print("Step 3: Creating Finished Goods - Poultry Feeds...")
        
        poultry_feeds = [
            # Broiler feeds
            {"sku": "FF-PLT-BRL-PRE", "name": "Broiler Pre-Starter Feed (Crumble)", "category": "Poultry",
             "subtype": None, "stage": "pre-starter", "pellet_size": None, "cost": 52.00},
            {"sku": "FF-PLT-BRL-STR", "name": "Broiler Starter Feed (Crumble)", "category": "Poultry",
             "subtype": None, "stage": "starter", "pellet_size": None, "cost": 50.00},
            {"sku": "FF-PLT-BRL-GRW", "name": "Broiler Grower Feed (Pellet)", "category": "Poultry",
             "subtype": None, "stage": "grower", "pellet_size": 3.0, "cost": 48.00},
            {"sku": "FF-PLT-BRL-FIN", "name": "Broiler Finisher Feed (Pellet)", "category": "Poultry",
             "subtype": None, "stage": "finisher", "pellet_size": 3.5, "cost": 46.00},
            
            # Layer feeds
            {"sku": "FF-PLT-LYR-STR", "name": "Layer Starter Feed (Crumble)", "category": "Poultry",
             "subtype": None, "stage": "starter", "pellet_size": None, "cost": 49.00},
            {"sku": "FF-PLT-LYR-GRW", "name": "Layer Grower Feed (Pellet)", "category": "Poultry",
             "subtype": None, "stage": "grower", "pellet_size": 3.0, "cost": 47.00},
            {"sku": "FF-PLT-LYR-LAY", "name": "Layer Feed (Pellet)", "category": "Poultry",
             "subtype": None, "stage": "laying", "pellet_size": 3.5, "cost": 45.00},
            
            # Breeder feeds
            {"sku": "FF-PLT-BRD-STR", "name": "Breeder Starter Feed (Crumble)", "category": "Poultry",
             "subtype": None, "stage": "starter", "pellet_size": None, "cost": 51.00},
            {"sku": "FF-PLT-BRD-GRW", "name": "Breeder Grower Feed (Pellet)", "category": "Poultry",
             "subtype": None, "stage": "grower", "pellet_size": 3.0, "cost": 49.00},
            {"sku": "FF-PLT-BRD-BRD", "name": "Breeder Feed (Pellet)", "category": "Poultry",
             "subtype": None, "stage": "breeding", "pellet_size": 3.5, "cost": 47.00},
            
            # Duck feeds
            {"sku": "FF-PLT-DCK-STR", "name": "Duck Starter Feed (Crumble)", "category": "Poultry",
             "subtype": None, "stage": "starter", "pellet_size": None, "cost": 48.00},
            {"sku": "FF-PLT-DCK-GRW", "name": "Duck Grower Feed (Pellet)", "category": "Poultry",
             "subtype": None, "stage": "grower", "pellet_size": 3.0, "cost": 46.00},
            {"sku": "FF-PLT-DCK-FIN", "name": "Duck Finisher Feed (Pellet)", "category": "Poultry",
             "subtype": None, "stage": "finisher", "pellet_size": 3.5, "cost": 44.00},
        ]
        
        for feed in poultry_feeds:
            item = db.query(Item).filter(
                Item.tenant_id == master_tenant.id,
                Item.sku == feed["sku"]
            ).first()
            
            if not item:
                item = Item(
                    tenant_id=master_tenant.id,
                    sku=feed["sku"],
                    name=feed["name"],
                    type="finished_good",
                    uom_id=kg_uom.id,
                    category_id=categories["Poultry Feeds"].id,
                    is_stock_tracked=True,
                    is_active=True,
                    standard_cost=Decimal(str(feed["cost"])),
                    created_by=admin.id
                )
                db.add(item)
                db.flush()
                created_items += 1
                
                # Create FeedProduct
                product = db.query(FeedProduct).filter(
                    FeedProduct.item_id == item.id,
                    FeedProduct.tenant_id == master_tenant.id
                ).first()
                
                if not product:
                    product = FeedProduct(
                        tenant_id=master_tenant.id,
                        item_id=item.id,
                        category=feed["category"],
                        subtype=feed.get("subtype"),
                        stage=feed.get("stage"),
                        pellet_size_mm=Decimal(str(feed["pellet_size"])) if feed.get("pellet_size") else None,
                        requires_grinding=True,
                        requires_pelleting=True,
                        requires_drying=True,
                        created_by=admin.id
                    )
                    db.add(product)
                    db.flush()
                    created_products += 1
                
                print(f"  [OK] Created: {feed['sku']} - {feed['name']}")
        
        db.commit()
        
        print(f"\n{'='*70}")
        print(f"SUCCESS: Comprehensive Fish & Poultry Items Created")
        print(f"{'='*70}")
        print(f"  Total Items Created: {created_items}")
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
    seed_comprehensive_items()
