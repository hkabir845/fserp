"""
BOM Service - Comprehensive business logic for BOM calculations, validation, and nutrition
"""
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Dict, Optional, Tuple
from sqlalchemy.orm import Session
from app.modules.feed_manufacturing.models import (
    FeedBom, FeedBomLine, Ingredient, FeedProduct, BOMStatus, InclusionBasis
)
from app.modules.catalog.models import Item
from app.modules.inventory.models import StockBalance

class BomService:
    """Service for BOM calculations, validation, and nutrition computation"""
    
    # Constants
    KG_PER_TON = Decimal("1000")
    G_PER_KG = Decimal("1000")
    G_PER_TON = Decimal("1000000")  # 1000 kg * 1000 g
    
    @staticmethod
    def normalize_to_grams_per_ton(inclusion_basis: str, inclusion_value: Decimal) -> Decimal:
        """
        Normalize any inclusion basis to grams per ton
        This ensures premix accuracy (integer grams)
        """
        if inclusion_basis == InclusionBasis.PERCENT:
            # percent * 10 = kg/ton, then * 1000 = g/ton
            return (inclusion_value * Decimal("10") * G_PER_KG).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        elif inclusion_basis == InclusionBasis.KG_PER_TON:
            # kg/ton * 1000 = g/ton
            return (inclusion_value * G_PER_KG).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        elif inclusion_basis == InclusionBasis.G_PER_TON:
            # Already in g/ton
            return inclusion_value.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        else:
            raise ValueError(f"Invalid inclusion basis: {inclusion_basis}")
    
    @staticmethod
    def grams_per_ton_to_kg(grams_per_ton: Decimal, batch_size_kg: Decimal) -> Decimal:
        """Convert grams/ton to kg for a given batch size"""
        # grams_per_ton is for 1 ton (1000 kg)
        # For batch_size_kg: (grams_per_ton / 1000) * (batch_size_kg / 1000)
        return (grams_per_ton / G_PER_KG) * (batch_size_kg / KG_PER_TON)
    
    @staticmethod
    def grams_per_ton_to_percent(grams_per_ton: Decimal, total_grams_per_ton: Decimal) -> Decimal:
        """Convert grams/ton to percent of total (excluding process aids)"""
        if total_grams_per_ton == 0:
            return Decimal("0")
        return (grams_per_ton / total_grams_per_ton * Decimal("100")).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
    
    @staticmethod
    def normalize_bom_lines(db: Session, bom_id: int) -> Dict:
        """
        Normalize all BOM lines to grams_per_ton and compute kg/percent
        Returns: {
            'total_grams_per_ton': Decimal (excluding process aids),
            'total_percent': Decimal,
            'errors': List[str]
        }
        """
        bom = db.query(FeedBom).filter(FeedBom.id == bom_id).first()
        if not bom:
            return {'errors': ['BOM not found']}
        
        lines = db.query(FeedBomLine).filter(
            FeedBomLine.bom_id == bom_id
        ).order_by(FeedBomLine.sequence).all()
        
        errors = []
        total_grams_per_ton = Decimal("0")  # Excluding process aids
        
        for line in lines:
            ingredient = db.query(Ingredient).filter(Ingredient.id == line.ingredient_id).first()
            if not ingredient:
                errors.append(f"Line {line.sequence}: Ingredient not found")
                continue
            
            # Normalize to grams/ton
            try:
                grams_per_ton = BomService.normalize_to_grams_per_ton(
                    line.inclusion_basis, 
                    line.inclusion_value
                )
                line.grams_per_ton = grams_per_ton
            except ValueError as e:
                errors.append(f"Line {line.sequence}: {str(e)}")
                continue
            
            # Compute kg/ton (for 1 ton batch)
            kg_per_ton = grams_per_ton / G_PER_KG
            line.kg_per_ton = kg_per_ton.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
            
            # Add to total (excluding process aids)
            if not line.is_process_aid:
                total_grams_per_ton += grams_per_ton
        
        # Compute percent for each line (excluding process aids from denominator)
        for line in lines:
            if not line.is_process_aid and total_grams_per_ton > 0:
                percent = BomService.grams_per_ton_to_percent(line.grams_per_ton, total_grams_per_ton)
                line.percent = percent
            else:
                line.percent = Decimal("0")
        
        db.flush()
        
        # Convert total to percent (should be 100%)
        total_percent = Decimal("100") if total_grams_per_ton > 0 else Decimal("0")
        
        return {
            'total_grams_per_ton': total_grams_per_ton,
            'total_percent': total_percent,
            'errors': errors
        }
    
    @staticmethod
    def validate_bom_totals(db: Session, bom_id: int, tolerance_pct: Decimal = Decimal("0.01")) -> Dict:
        """
        Validate BOM totals = 100% (excluding process aids)
        Returns: {
            'is_valid': bool,
            'total_percent': Decimal,
            'deviation': Decimal,
            'errors': List[str],
            'warnings': List[str]
        }
        """
        result = BomService.normalize_bom_lines(db, bom_id)
        if result.get('errors'):
            return {'is_valid': False, 'errors': result['errors']}
        
        bom = db.query(FeedBom).filter(FeedBom.id == bom_id).first()
        if bom:
            tolerance = bom.total_tolerance_pct or tolerance_pct
        else:
            tolerance = tolerance_pct
        
        total_percent = result['total_percent']
        deviation = abs(total_percent - Decimal("100"))
        is_valid = deviation <= tolerance
        
        errors = []
        warnings = []
        
        if not is_valid:
            errors.append(
                f"Total percentage is {total_percent:.4f}%, must be 100% ± {tolerance:.4f}% "
                f"(deviation: {deviation:.4f}%)"
            )
        
        # Check individual line constraints
        lines = db.query(FeedBomLine).filter(FeedBomLine.bom_id == bom_id).all()
        for line in lines:
            ingredient = db.query(Ingredient).filter(Ingredient.id == line.ingredient_id).first()
            if not ingredient:
                continue
            
            if line.min_percent and line.percent < line.min_percent:
                errors.append(
                    f"{ingredient.item.name}: {line.percent:.4f}% is below minimum {line.min_percent}%"
                )
            if line.max_percent and line.percent > line.max_percent:
                errors.append(
                    f"{ingredient.item.name}: {line.percent:.4f}% exceeds maximum {line.max_percent}%"
                )
            
            # Check ingredient-level constraints
            if ingredient.min_inclusion_pct and line.percent < ingredient.min_inclusion_pct:
                warnings.append(
                    f"{ingredient.item.name}: {line.percent:.4f}% is below ingredient minimum {ingredient.min_inclusion_pct}%"
                )
            if ingredient.max_inclusion_pct and line.percent > ingredient.max_inclusion_pct:
                errors.append(
                    f"{ingredient.item.name}: {line.percent:.4f}% exceeds ingredient maximum {ingredient.max_inclusion_pct}%"
                )
        
        return {
            'is_valid': is_valid and len(errors) == 0,
            'total_percent': total_percent,
            'deviation': deviation,
            'errors': errors,
            'warnings': warnings
        }
    
    @staticmethod
    def compute_nutrition(db: Session, bom_id: int, batch_size_kg: Decimal = None) -> Dict:
        """
        Compute formula nutrition from ingredient nutrient profiles
        Returns: {
            'protein_pct': Decimal,
            'fat_pct': Decimal,
            'fiber_pct': Decimal,
            'moisture_pct': Decimal,
            'ash_pct': Decimal,
            'energy_kcal': Decimal,
            'warnings': List[str]  # vs targets
        }
        """
        bom = db.query(FeedBom).filter(FeedBom.id == bom_id).first()
        if not bom:
            return {}
        
        if batch_size_kg is None:
            batch_size_kg = bom.default_batch_size_kg
        
        # Normalize lines first
        BomService.normalize_bom_lines(db, bom_id)
        
        lines = db.query(FeedBomLine).filter(FeedBomLine.bom_id == bom_id).all()
        
        total_protein = Decimal("0")
        total_fat = Decimal("0")
        total_fiber = Decimal("0")
        total_moisture = Decimal("0")
        total_ash = Decimal("0")
        total_energy = Decimal("0")
        total_kg = Decimal("0")
        
        for line in lines:
            ingredient = db.query(Ingredient).filter(Ingredient.id == line.ingredient_id).first()
            if not ingredient:
                continue
            
            # Get quantity in kg for this batch
            kg = BomService.grams_per_ton_to_kg(line.grams_per_ton, batch_size_kg)
            total_kg += kg
            
            # Add nutrient contributions (per kg of ingredient * kg used)
            if ingredient.protein_pct:
                total_protein += (ingredient.protein_pct / Decimal("100")) * kg
            if ingredient.fat_pct:
                total_fat += (ingredient.fat_pct / Decimal("100")) * kg
            if ingredient.fiber_pct:
                total_fiber += (ingredient.fiber_pct / Decimal("100")) * kg
            if ingredient.moisture_pct:
                total_moisture += (ingredient.moisture_pct / Decimal("100")) * kg
            if ingredient.ash_pct:
                total_ash += (ingredient.ash_pct / Decimal("100")) * kg
            if ingredient.energy_kcal:
                total_energy += ingredient.energy_kcal * kg
        
        # Convert to percentages (per kg of finished feed)
        if total_kg > 0:
            protein_pct = (total_protein / total_kg * Decimal("100")).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
            fat_pct = (total_fat / total_kg * Decimal("100")).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
            fiber_pct = (total_fiber / total_kg * Decimal("100")).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
            moisture_pct = (total_moisture / total_kg * Decimal("100")).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
            ash_pct = (total_ash / total_kg * Decimal("100")).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
            energy_kcal = (total_energy / total_kg).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        else:
            protein_pct = fat_pct = fiber_pct = moisture_pct = ash_pct = energy_kcal = Decimal("0")
        
        # Compare with targets
        warnings = []
        product = db.query(FeedProduct).filter(FeedProduct.id == bom.product_id).first()
        
        if product:
            if product.target_protein_min_pct and protein_pct < product.target_protein_min_pct:
                warnings.append(f"Protein {protein_pct:.2f}% is below target minimum {product.target_protein_min_pct}%")
            if product.target_protein_max_pct and protein_pct > product.target_protein_max_pct:
                warnings.append(f"Protein {protein_pct:.2f}% exceeds target maximum {product.target_protein_max_pct}%")
            if product.target_fat_min_pct and fat_pct < product.target_fat_min_pct:
                warnings.append(f"Fat {fat_pct:.2f}% is below target minimum {product.target_fat_min_pct}%")
            if product.target_fiber_max_pct and fiber_pct > product.target_fiber_max_pct:
                warnings.append(f"Fiber {fiber_pct:.2f}% exceeds target maximum {product.target_fiber_max_pct}%")
            if product.target_moisture_max_pct and moisture_pct > product.target_moisture_max_pct:
                warnings.append(f"Moisture {moisture_pct:.2f}% exceeds target maximum {product.target_moisture_max_pct}%")
            if product.target_energy_min_kcal and energy_kcal < product.target_energy_min_kcal:
                warnings.append(f"Energy {energy_kcal:.2f} kcal/kg is below target minimum {product.target_energy_min_kcal} kcal/kg")
        
        return {
            'protein_pct': protein_pct,
            'fat_pct': fat_pct,
            'fiber_pct': fiber_pct,
            'moisture_pct': moisture_pct,
            'ash_pct': ash_pct,
            'energy_kcal': energy_kcal,
            'warnings': warnings
        }
    
    @staticmethod
    def calculate_bom_cost(db: Session, bom_id: int, batch_size_kg: Decimal = None,
                          price_overrides: Dict[int, Decimal] = None) -> Dict:
        """
        Calculate BOM cost breakdown with what-if scenario pricing
        price_overrides: {ingredient_id: unit_price_per_kg} for scenario analysis
        Returns: {
            'total_cost': Decimal,
            'cost_per_ton': Decimal,
            'cost_per_kg': Decimal,
            'ingredients': List[Dict]  # Sorted by cost contribution
        }
        """
        if price_overrides is None:
            price_overrides = {}
        
        bom = db.query(FeedBom).filter(FeedBom.id == bom_id).first()
        if not bom:
            return {'total_cost': Decimal("0"), 'ingredients': []}
        
        if batch_size_kg is None:
            batch_size_kg = bom.default_batch_size_kg
        
        # Normalize lines
        BomService.normalize_bom_lines(db, bom_id)
        
        lines = db.query(FeedBomLine).filter(FeedBomLine.bom_id == bom_id).all()
        
        total_cost = Decimal("0")
        ingredients = []
        
        for line in lines:
            ingredient = db.query(Ingredient).filter(Ingredient.id == line.ingredient_id).first()
            if not ingredient:
                continue
            
            # Get unit price (BDT per kg)
            if line.ingredient_id in price_overrides:
                unit_price = price_overrides[line.ingredient_id]
            else:
                # Get from inventory weighted average cost
                item = db.query(Item).filter(Item.id == ingredient.item_id).first()
                if item:
                    # Try to get from stock balance
                    stock = db.query(StockBalance).filter(
                        StockBalance.item_id == item.id,
                        StockBalance.tenant_id == bom.tenant_id
                    ).first()
                    if stock and stock.qty_kg > 0:
                        unit_price = stock.unit_cost
                    else:
                        unit_price = item.standard_cost or Decimal("0")
                else:
                    unit_price = Decimal("0")
            
            # Calculate required qty in kg
            required_kg = BomService.grams_per_ton_to_kg(line.grams_per_ton, batch_size_kg)
            
            # Apply loss factor
            if line.loss_factor_pct > 0:
                required_kg = required_kg * (Decimal("1") + (line.loss_factor_pct / Decimal("100")))
            
            required_kg = required_kg.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
            line_cost = (required_kg * unit_price).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
            total_cost += line_cost
            
            ingredients.append({
                'ingredient_id': ingredient.id,
                'ingredient_name': ingredient.item.name if ingredient.item else 'Unknown',
                'required_kg': float(required_kg),
                'unit_price': float(unit_price),
                'total_cost': float(line_cost),
            })
        
        # Calculate percentages
        for ing in ingredients:
            if total_cost > 0:
                ing['cost_percent'] = float((Decimal(str(ing['total_cost'])) / total_cost * Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
            else:
                ing['cost_percent'] = 0.0
        
        # Sort by cost (descending)
        ingredients.sort(key=lambda x: x['total_cost'], reverse=True)
        
        # Calculate per ton and per kg
        batch_size_ton = batch_size_kg / KG_PER_TON
        cost_per_ton = (total_cost / batch_size_ton).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP) if batch_size_ton > 0 else Decimal("0")
        cost_per_kg = (total_cost / batch_size_kg).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP) if batch_size_kg > 0 else Decimal("0")
        
        return {
            'total_cost': total_cost,
            'cost_per_ton': cost_per_ton,
            'cost_per_kg': cost_per_kg,
            'ingredients': ingredients
        }
    
    @staticmethod
    def compute_for_batch_size(db: Session, bom_id: int, batch_size_kg: Decimal) -> Dict:
        """
        Compute all values (kg, percent, cost) for a specific batch size
        Returns comprehensive breakdown
        """
        # Normalize first
        normalize_result = BomService.normalize_bom_lines(db, bom_id)
        
        lines = db.query(FeedBomLine).filter(FeedBomLine.bom_id == bom_id).order_by(FeedBomLine.sequence).all()
        
        line_details = []
        total_kg = Decimal("0")
        total_kg_excluding_aids = Decimal("0")
        
        for line in lines:
            ingredient = db.query(Ingredient).filter(Ingredient.id == line.ingredient_id).first()
            if not ingredient:
                continue
            
            # Compute kg for this batch
            kg = BomService.grams_per_ton_to_kg(line.grams_per_ton, batch_size_kg)
            kg = kg.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
            
            total_kg += kg
            if not line.is_process_aid:
                total_kg_excluding_aids += kg
            
            line_details.append({
                'line_id': line.id,
                'sequence': line.sequence,
                'ingredient_id': ingredient.id,
                'ingredient_name': ingredient.item.name if ingredient.item else 'Unknown',
                'inclusion_basis': line.inclusion_basis,
                'inclusion_value': float(line.inclusion_value),
                'grams_per_ton': float(line.grams_per_ton),
                'kg_per_ton': float(line.kg_per_ton),
                'percent': float(line.percent),
                'kg_for_batch': float(kg),
                'is_process_aid': line.is_process_aid,
                'phase': line.phase,
                'loss_factor_pct': float(line.loss_factor_pct),
            })
        
        return {
            'batch_size_kg': float(batch_size_kg),
            'total_kg': float(total_kg),
            'total_kg_excluding_aids': float(total_kg_excluding_aids),
            'total_percent': float(normalize_result['total_percent']),
            'lines': line_details,
            'errors': normalize_result.get('errors', [])
        }
