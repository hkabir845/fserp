"""
Seed Production Orders for Master Company (R&D Testing)
Creates diverse production orders with different statuses for testing
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from decimal import Decimal
from app.db.session import SessionLocal
from app.modules.tenancy.models import Tenant, User
from app.modules.catalog.models import Item
from app.modules.inventory.models import Warehouse
from app.modules.feed_manufacturing.models import (
    FeedBom, FeedBomLine, ProductionOrder, ProductionOrderLine,
    ProductionStatus, BOMStatus, Ingredient
)
from app.modules.feed_manufacturing.bom_service import BomService

def seed_master_production_orders():
    """Seed test production orders for Master Company"""
    db = SessionLocal()
    try:
        # Get Master Company tenant
        master_tenant = db.query(Tenant).filter(Tenant.domain == 'master').first()
        if not master_tenant:
            print("ERROR: Master Company tenant not found!")
            return
        
        print(f"\n{'='*70}")
        print(f"SEEDING PRODUCTION ORDERS FOR MASTER COMPANY (Tenant ID: {master_tenant.id})")
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
        
        # Get approved BOMs
        boms = db.query(FeedBom).filter(
            FeedBom.tenant_id == master_tenant.id,
            FeedBom.status == BOMStatus.APPROVED.value
        ).all()
        
        if not boms:
            print("ERROR: No approved BOMs found for Master Company!")
            return
        
        print(f"Found {len(boms)} approved BOMs\n")
        
        # Get warehouse
        warehouse = db.query(Warehouse).filter(
            Warehouse.tenant_id == master_tenant.id
        ).first()
        
        if not warehouse:
            # Create a warehouse if none exists
            warehouse = Warehouse(
                tenant_id=master_tenant.id,
                name="Production Warehouse",
                address="Main Factory",
                is_active=True,
                created_by=admin.id
            )
            db.add(warehouse)
            db.flush()
            print("Created Production Warehouse\n")
        
        # Check existing orders to get next sequence
        year = datetime.utcnow().strftime('%Y')
        prefix = f"BATCH-{year}-"
        last_order = db.query(ProductionOrder).filter(
            ProductionOrder.tenant_id == master_tenant.id,
            ProductionOrder.order_number.like(f"{prefix}%")
        ).order_by(ProductionOrder.order_number.desc()).first()
        
        next_seq = 1
        if last_order and last_order.order_number:
            try:
                next_seq = int(str(last_order.order_number).split('-')[-1]) + 1
            except:
                next_seq = 1
        
        # Production order definitions
        order_definitions = [
            {
                "bom": boms[0] if len(boms) > 0 else None,
                "batch_size_ton": 1.0,
                "status": ProductionStatus.DRAFT.value,
                "planned_date": datetime.utcnow() + timedelta(days=1),
                "notes": "R&D Test Order - Draft status for testing creation workflow"
            },
            {
                "bom": boms[0] if len(boms) > 0 else None,
                "batch_size_ton": 2.0,
                "status": ProductionStatus.PLANNED.value,
                "planned_date": datetime.utcnow() + timedelta(days=2),
                "start_date": datetime.utcnow() + timedelta(days=2),
                "notes": "R&D Test Order - Planned status for testing planning workflow"
            },
            {
                "bom": boms[1] if len(boms) > 1 else boms[0] if len(boms) > 0 else None,
                "batch_size_ton": 1.5,
                "status": ProductionStatus.IN_PROGRESS.value,
                "planned_date": datetime.utcnow() - timedelta(days=1),
                "start_date": datetime.utcnow() - timedelta(hours=2),
                "notes": "R&D Test Order - In Progress for testing production workflow"
            },
            {
                "bom": boms[2] if len(boms) > 2 else boms[0] if len(boms) > 0 else None,
                "batch_size_ton": 2.5,
                "status": ProductionStatus.COMPLETED.value,
                "planned_date": datetime.utcnow() - timedelta(days=3),
                "start_date": datetime.utcnow() - timedelta(days=3),
                "end_date": datetime.utcnow() - timedelta(days=2),
                "actual_output_kg": 2500.0,
                "yield_pct": 100.0,
                "notes": "R&D Test Order - Completed for testing completion and reporting"
            },
        ]
        
        created_count = 0
        for order_def in order_definitions:
            if not order_def["bom"]:
                print(f"  [SKIP] No BOM available for order definition")
                continue
            
            bom = order_def["bom"]
            batch_size_ton = Decimal(str(order_def["batch_size_ton"]))
            batch_size_kg = batch_size_ton * Decimal("1000")
            
            # Generate order number
            order_number = f"{prefix}{next_seq:06d}"
            next_seq += 1
            
            # Check if order already exists
            existing = db.query(ProductionOrder).filter(
                ProductionOrder.tenant_id == master_tenant.id,
                ProductionOrder.order_number == order_number
            ).first()
            
            if existing:
                print(f"  [SKIP] Order {order_number} already exists")
                continue
            
            # Get BOM lines
            bom_lines = db.query(FeedBomLine).filter(
                FeedBomLine.bom_id == bom.id,
                FeedBomLine.tenant_id == master_tenant.id
            ).all()
            
            if not bom_lines:
                print(f"  [SKIP] BOM {bom.bom_code} has no lines")
                continue
            
            # Recompute totals for the batch size
            try:
                BomService.compute_bom_totals(db, bom.id, batch_size_ton)
            except Exception as e:
                print(f"  [WARN] Could not compute totals: {e}")
            
            # Refresh BOM lines to get computed values
            db.refresh(bom)
            bom_lines = db.query(FeedBomLine).filter(
                FeedBomLine.bom_id == bom.id,
                FeedBomLine.tenant_id == master_tenant.id
            ).all()
            
            # Create production order
            order = ProductionOrder(
                tenant_id=master_tenant.id,
                order_number=order_number,
                bom_id=bom.id,
                batch_size_ton=batch_size_ton,
                batch_size_kg=batch_size_kg,
                status=order_def["status"],
                planned_date=order_def.get("planned_date"),
                start_date=order_def.get("start_date"),
                end_date=order_def.get("end_date"),
                planned_output_kg=batch_size_kg,
                actual_output_kg=Decimal(str(order_def.get("actual_output_kg", 0))) if order_def.get("actual_output_kg") else None,
                yield_pct=Decimal(str(order_def.get("yield_pct", 0))) if order_def.get("yield_pct") else None,
                warehouse_id=warehouse.id,
                notes=order_def.get("notes"),
                created_by=admin.id
            )
            db.add(order)
            db.flush()
            
            # Create order lines
            total_material_cost = Decimal("0")
            for bom_line in bom_lines:
                # Get required qty (use computed_kg if available, otherwise calculate)
                if bom_line.computed_kg:
                    required_kg = bom_line.computed_kg
                else:
                    # Calculate from inclusion_value and batch_size
                    if bom_line.inclusion_basis == "percent":
                        required_kg = (bom_line.inclusion_value / Decimal("100")) * batch_size_kg
                    elif bom_line.inclusion_basis == "kg_per_ton":
                        required_kg = (bom_line.inclusion_value / Decimal("1000")) * batch_size_kg
                    else:  # g_per_ton
                        required_kg = (bom_line.inclusion_value / Decimal("1000000")) * batch_size_kg
                
                required_kg = required_kg.quantize(Decimal("0.001"))
                
                # Get unit cost from ingredient's item
                unit_cost = Decimal("0")
                ingredient = db.query(Ingredient).filter(Ingredient.id == bom_line.ingredient_id).first()
                if ingredient:
                    item = db.query(Item).filter(Item.id == ingredient.item_id).first()
                    if item and item.standard_cost:
                        unit_cost = item.standard_cost
                
                line_cost = required_kg * unit_cost
                total_material_cost += line_cost
                
                order_line = ProductionOrderLine(
                    tenant_id=master_tenant.id,
                    order_id=order.id,
                    ingredient_id=bom_line.ingredient_id,
                    bom_line_id=bom_line.id,
                    required_qty_kg=required_kg,
                    required_qty_with_loss_kg=required_kg,  # Assuming loss already included
                    unit_cost=unit_cost,
                    total_cost=line_cost,
                    created_by=admin.id
                )
                db.add(order_line)
            
            # Set costs
            order.material_cost = total_material_cost
            order.overhead_cost = Decimal("0")  # Can be set later
            order.total_cost = total_material_cost
            if batch_size_kg > 0:
                order.cost_per_kg = order.total_cost / batch_size_kg
            
            db.commit()
            created_count += 1
            print(f"  [OK] Created Order: {order_number} ({order_def['status']}) - {batch_size_ton} ton from {bom.bom_code}")
        
        print(f"\n{'='*70}")
        print(f"SUCCESS: Created {created_count} production orders for Master Company")
        print(f"{'='*70}\n")
        
    except Exception as e:
        db.rollback()
        print(f"\nERROR: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    seed_master_production_orders()
