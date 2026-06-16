"""
Production Service - Material issue, yield tracking, packing, costing
"""
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Dict, Optional
from sqlalchemy.orm import Session
from datetime import datetime
from app.modules.feed_manufacturing.models import (
    ProductionOrder, ProductionOrderLine, ProductionStep, ProductionOutput, PackingOperation,
    FeedBom, FeedBomLine, ProductionStatus
)
from app.modules.inventory.models import StockLedger, StockBalance, InventoryLot, Warehouse
from app.modules.catalog.models import Item
from app.modules.feed_manufacturing.bom_service import BomService

class ProductionService:
    """Service for production order execution"""
    
    @staticmethod
    def create_production_order(db: Session, bom_id: int, batch_size_kg: Decimal,
                               warehouse_id: int, order_number: str = None,
                               batch_no: str = None) -> ProductionOrder:
        """
        Create production order from approved BOM
        Computes all material requirements
        """
        bom = db.query(FeedBom).filter(FeedBom.id == bom_id).first()
        if not bom:
            raise ValueError("BOM not found")
        
        if bom.status != BOMStatus.APPROVED:
            raise ValueError(f"BOM must be approved. Current status: {bom.status}")
        
        # Generate order number if not provided
        if not order_number:
            # Get next order number
            last_order = db.query(ProductionOrder).filter(
                ProductionOrder.tenant_id == bom.tenant_id
            ).order_by(ProductionOrder.id.desc()).first()
            if last_order:
                try:
                    last_num = int(last_order.order_number.split('-')[-1])
                    order_number = f"PO-{datetime.now().year}-{last_num + 1:04d}"
                except:
                    order_number = f"PO-{datetime.now().year}-0001"
            else:
                order_number = f"PO-{datetime.now().year}-0001"
        
        # Generate batch number if not provided
        if not batch_no:
            last_batch = db.query(ProductionOrder).filter(
                ProductionOrder.tenant_id == bom.tenant_id
            ).order_by(ProductionOrder.id.desc()).first()
            if last_batch:
                try:
                    last_num = int(last_batch.batch_no.split('-')[-1])
                    batch_no = f"BATCH-{datetime.now().year}-{last_num + 1:04d}"
                except:
                    batch_no = f"BATCH-{datetime.now().year}-0001"
            else:
                batch_no = f"BATCH-{datetime.now().year}-0001"
        
        # Normalize BOM lines
        BomService.normalize_bom_lines(db, bom_id)
        
        # Create production order
        order = ProductionOrder(
            tenant_id=bom.tenant_id,
            order_number=order_number,
            batch_no=batch_no,
            bom_id=bom_id,
            batch_size_kg=batch_size_kg,
            warehouse_id=warehouse_id,
            status=ProductionStatus.DRAFT,
            planned_output_kg=batch_size_kg,  # Default, can be adjusted
            planned_date=datetime.utcnow()
        )
        db.add(order)
        db.flush()
        
        # Create production order lines from BOM
        bom_lines = db.query(FeedBomLine).filter(FeedBomLine.bom_id == bom_id).all()
        
        for bom_line in bom_lines:
            ingredient = db.query(Item).join(
                'ingredient', Item.id == 'ingredient.item_id'
            ).filter('ingredient.id' == bom_line.ingredient_id).first()
            
            if not ingredient:
                continue
            
            # Calculate required qty
            required_kg = BomService.grams_per_ton_to_kg(bom_line.grams_per_ton, batch_size_kg)
            
            # Apply loss factor
            if bom_line.loss_factor_pct > 0:
                required_with_loss = required_kg * (Decimal("1") + (bom_line.loss_factor_pct / Decimal("100")))
            else:
                required_with_loss = required_kg
            
            order_line = ProductionOrderLine(
                tenant_id=bom.tenant_id,
                order_id=order.id,
                ingredient_id=bom_line.ingredient_id,
                bom_line_id=bom_line.id,
                required_qty_kg=required_kg.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP),
                required_qty_with_loss_kg=required_with_loss.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
            )
            db.add(order_line)
        
        db.flush()
        return order
    
    @staticmethod
    def issue_materials(db: Session, order_id: int, material_issues: List[Dict]) -> Dict:
        """
        Issue materials for production
        material_issues: [{
            'order_line_id': int,
            'consumed_qty_kg': Decimal,
            'lot_id': Optional[int]  # For traceability
        }]
        Returns: {
            'success': bool,
            'errors': List[str],
            'transactions': List[StockLedger]
        }
        """
        order = db.query(ProductionOrder).filter(ProductionOrder.id == order_id).first()
        if not order:
            return {'success': False, 'errors': ['Production order not found']}
        
        if order.status not in [ProductionStatus.DRAFT, ProductionStatus.PLANNED]:
            return {'success': False, 'errors': [f'Cannot issue materials. Order status: {order.status}']}
        
        errors = []
        transactions = []
        
        for issue in material_issues:
            order_line = db.query(ProductionOrderLine).filter(
                ProductionOrderLine.id == issue['order_line_id'],
                ProductionOrderLine.order_id == order_id
            ).first()
            
            if not order_line:
                errors.append(f"Order line {issue['order_line_id']} not found")
                continue
            
            consumed_qty = Decimal(str(issue['consumed_qty_kg']))
            
            # Validate quantity
            if consumed_qty > order_line.required_qty_with_loss_kg * Decimal("1.1"):  # 10% tolerance
                errors.append(
                    f"Consumed qty {consumed_qty} kg exceeds required {order_line.required_qty_with_loss_kg} kg "
                    f"for ingredient {order_line.ingredient.item.name if order_line.ingredient.item else 'Unknown'}"
                )
                continue
            
            # Get ingredient and item
            ingredient = order_line.ingredient
            item = db.query(Item).filter(Item.id == ingredient.item_id).first()
            
            # Get stock balance
            stock = db.query(StockBalance).filter(
                StockBalance.item_id == item.id,
                StockBalance.warehouse_id == order.warehouse_id,
                StockBalance.tenant_id == order.tenant_id
            ).first()
            
            if not stock or stock.qty_kg < consumed_qty:
                errors.append(
                    f"Insufficient stock for {item.name}. Available: {stock.qty_kg if stock else 0} kg, "
                    f"Required: {consumed_qty} kg"
                )
                continue
            
            # Get unit cost
            unit_cost = stock.unit_cost
            
            # Update order line
            order_line.consumed_qty_kg = consumed_qty
            order_line.unit_cost = unit_cost
            order_line.total_cost = (consumed_qty * unit_cost).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
            
            if 'lot_id' in issue and issue['lot_id']:
                order_line.lot_id = issue['lot_id']
            
            # Create stock ledger entry
            ledger = StockLedger(
                tenant_id=order.tenant_id,
                item_id=item.id,
                warehouse_id=order.warehouse_id,
                lot_id=issue.get('lot_id'),
                txn_type='issue',
                txn_date=datetime.utcnow(),
                qty_out_kg=consumed_qty,
                unit_cost=unit_cost,
                total_cost=order_line.total_cost,
                ref_type='production_order',
                ref_id=order.id,
                ref_number=order.order_number,
                batch_no=order.batch_no,
                notes=f"Production issue for {order.batch_no}"
            )
            db.add(ledger)
            
            # Update stock balance
            stock.qty_kg -= consumed_qty
            stock.total_cost -= order_line.total_cost
            if stock.qty_kg > 0:
                stock.unit_cost = (stock.total_cost / stock.qty_kg).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
            else:
                stock.unit_cost = Decimal("0")
                stock.total_cost = Decimal("0")
            
            stock.last_txn_date = datetime.utcnow()
            
            transactions.append(ledger)
        
        if errors:
            db.rollback()
            return {'success': False, 'errors': errors}
        
        # Update order status
        order.status = ProductionStatus.IN_PROGRESS
        if not order.start_date:
            order.start_date = datetime.utcnow()
        
        # Calculate material cost
        order.material_cost = sum(
            (line.total_cost or Decimal("0")) for line in order.order_lines
        ).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
        
        db.flush()
        return {'success': True, 'errors': [], 'transactions': transactions}
    
    @staticmethod
    def complete_production(db: Session, order_id: int, actual_output_kg: Decimal,
                           finished_item_id: int, lot_id: Optional[int] = None) -> Dict:
        """
        Complete production batch - produce finished goods
        """
        order = db.query(ProductionOrder).filter(ProductionOrder.id == order_id).first()
        if not order:
            return {'success': False, 'errors': ['Production order not found']}
        
        if order.status != ProductionStatus.IN_PROGRESS:
            return {'success': False, 'errors': [f'Order must be in progress. Current: {order.status}']}
        
        # Calculate yield
        if order.planned_output_kg > 0:
            yield_pct = (actual_output_kg / order.planned_output_kg * Decimal("100")).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
            loss_kg = order.planned_output_kg - actual_output_kg
        else:
            yield_pct = Decimal("100")
            loss_kg = Decimal("0")
        
        # Get finished item
        finished_item = db.query(Item).filter(Item.id == finished_item_id).first()
        if not finished_item:
            return {'success': False, 'errors': ['Finished item not found']}
        
        # Calculate unit cost (material + overhead)
        total_material_cost = order.material_cost or Decimal("0")
        total_cost = total_material_cost + (order.overhead_cost or Decimal("0"))
        unit_cost = (total_cost / actual_output_kg).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP) if actual_output_kg > 0 else Decimal("0")
        
        # Create production output
        output = ProductionOutput(
            tenant_id=order.tenant_id,
            order_id=order.id,
            finished_item_id=finished_item_id,
            warehouse_id=order.warehouse_id,
            produced_qty_kg=actual_output_kg,
            lot_id=lot_id
        )
        db.add(output)
        
        # Create stock ledger entry (receipt)
        ledger = StockLedger(
            tenant_id=order.tenant_id,
            item_id=finished_item_id,
            warehouse_id=order.warehouse_id,
            lot_id=lot_id,
            txn_type='produce',
            txn_date=datetime.utcnow(),
            qty_in_kg=actual_output_kg,
            unit_cost=unit_cost,
            total_cost=total_cost,
            ref_type='production_order',
            ref_id=order.id,
            ref_number=order.order_number,
            batch_no=order.batch_no,
            notes=f"Production output for {order.batch_no}"
        )
        db.add(ledger)
        
        # Update or create stock balance
        stock = db.query(StockBalance).filter(
            StockBalance.item_id == finished_item_id,
            StockBalance.warehouse_id == order.warehouse_id,
            StockBalance.lot_id == lot_id,
            StockBalance.tenant_id == order.tenant_id
        ).first()
        
        if stock:
            # Weighted average cost
            total_qty = stock.qty_kg + actual_output_kg
            total_cost_new = stock.total_cost + total_cost
            stock.qty_kg = total_qty
            stock.total_cost = total_cost_new
            stock.unit_cost = (total_cost_new / total_qty).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP) if total_qty > 0 else Decimal("0")
        else:
            stock = StockBalance(
                tenant_id=order.tenant_id,
                item_id=finished_item_id,
                warehouse_id=order.warehouse_id,
                lot_id=lot_id,
                qty_kg=actual_output_kg,
                unit_cost=unit_cost,
                total_cost=total_cost,
                last_txn_date=datetime.utcnow()
            )
            db.add(stock)
        
        # Update order
        order.actual_output_kg = actual_output_kg
        order.yield_pct = yield_pct
        order.loss_kg = loss_kg if loss_kg > 0 else None
        order.total_cost = total_cost
        order.cost_per_kg = unit_cost
        order.end_date = datetime.utcnow()
        order.status = ProductionStatus.COMPLETED
        
        db.flush()
        return {'success': True, 'output': output, 'stock_ledger': ledger}
    
    @staticmethod
    def pack_batch(db: Session, order_id: int, bag_item_id: int, pack_size_kg: Decimal,
                   bags_count: int) -> Dict:
        """
        Pack finished feed into bags
        """
        order = db.query(ProductionOrder).filter(ProductionOrder.id == order_id).first()
        if not order:
            return {'success': False, 'errors': ['Production order not found']}
        
        if order.status != ProductionStatus.COMPLETED:
            return {'success': False, 'errors': ['Order must be completed before packing']}
        
        # Calculate quantities
        net_kg = (pack_size_kg * bags_count).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
        
        # Get bag item
        bag_item = db.query(Item).filter(Item.id == bag_item_id).first()
        if not bag_item:
            return {'success': False, 'errors': ['Bag item not found']}
        
        # Get bag weight (assume standard bag weight or from item)
        bag_weight_kg = Decimal("0.05")  # Default 50g per bag, can be configured
        gross_kg = net_kg + (bag_weight_kg * bags_count)
        
        # Create packing operation
        packing = PackingOperation(
            tenant_id=order.tenant_id,
            order_id=order.id,
            bag_item_id=bag_item_id,
            pack_size_kg=pack_size_kg,
            bags_count=bags_count,
            net_kg=net_kg,
            gross_kg=gross_kg
        )
        db.add(packing)
        
        # Consume packaging material
        bag_stock = db.query(StockBalance).filter(
            StockBalance.item_id == bag_item_id,
            StockBalance.warehouse_id == order.warehouse_id,
            StockBalance.tenant_id == order.tenant_id
        ).first()
        
        if not bag_stock or bag_stock.qty_kg < (bag_weight_kg * bags_count):
            return {'success': False, 'errors': ['Insufficient packaging material']}
        
        # Create ledger entry for bag consumption
        bag_qty = bag_weight_kg * bags_count
        bag_cost = bag_stock.unit_cost * bag_qty
        
        bag_ledger = StockLedger(
            tenant_id=order.tenant_id,
            item_id=bag_item_id,
            warehouse_id=order.warehouse_id,
            txn_type='issue',
            txn_date=datetime.utcnow(),
            qty_out_kg=bag_qty,
            unit_cost=bag_stock.unit_cost,
            total_cost=bag_cost,
            ref_type='packing',
            ref_id=packing.id,
            ref_number=order.order_number,
            batch_no=order.batch_no,
            notes=f"Packaging for {order.batch_no}"
        )
        db.add(bag_ledger)
        
        # Update bag stock
        bag_stock.qty_kg -= bag_qty
        bag_stock.total_cost -= bag_cost
        if bag_stock.qty_kg > 0:
            bag_stock.unit_cost = (bag_stock.total_cost / bag_stock.qty_kg).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
        else:
            bag_stock.unit_cost = Decimal("0")
            bag_stock.total_cost = Decimal("0")
        bag_stock.last_txn_date = datetime.utcnow()
        
        # Update order packaging cost
        order.packaging_cost = (order.packaging_cost or Decimal("0")) + bag_cost
        order.total_cost = (order.material_cost or Decimal("0")) + order.packaging_cost + (order.overhead_cost or Decimal("0"))
        order.cost_per_kg = (order.total_cost / (order.actual_output_kg or Decimal("1"))).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
        
        db.flush()
        return {'success': True, 'packing': packing}





