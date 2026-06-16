"""
Pre-Formulation Service - Business logic for pre-formulation library
"""
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Dict, Optional, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
from app.modules.feed_manufacturing.preformulation_models import PreFormulation, PreFormulationLine
from app.modules.catalog.models import Item

class PreFormulationService:
    """Service for pre-formulation library operations"""
    
    @staticmethod
    def resolve_library_scope(db: Session, tenant_id: Optional[int]) -> Tuple[List[PreFormulation], List[PreFormulation]]:
        """
        Resolve pre-formulations with tenant priority
        Returns: (tenant_templates, global_templates)
        """
        # Get tenant-specific templates
        if tenant_id:
            tenant_templates = db.query(PreFormulation).filter(
                PreFormulation.tenant_id == tenant_id,
                PreFormulation.is_active == True
            ).all()
        else:
            tenant_templates = []
        
        # Get global templates (tenant_id IS NULL)
        global_templates = db.query(PreFormulation).filter(
            PreFormulation.tenant_id.is_(None),
            PreFormulation.is_active == True
        ).all()
        
        return tenant_templates, global_templates
    
    @staticmethod
    def get_filters(db: Session, tenant_id: Optional[int], category: Optional[str] = None,
                   species: Optional[str] = None, stage: Optional[str] = None,
                   process_type: Optional[str] = None) -> Dict:
        """
        Get distinct filter values for dropdowns
        Returns tenant-specific first, then global
        """
        tenant_templates, global_templates = PreFormulationService.resolve_library_scope(db, tenant_id)
        
        all_templates = tenant_templates + global_templates
        
        # Apply filters
        filtered = all_templates
        if category:
            filtered = [t for t in filtered if t.category == category]
        if species:
            filtered = [t for t in filtered if t.species == species]
        if stage:
            filtered = [t for t in filtered if t.stage == stage]
        if process_type:
            filtered = [t for t in filtered if t.process_type == process_type]
        
        # Extract distinct values
        categories = sorted(set(t.category for t in all_templates))
        species_list = sorted(set(t.species for t in filtered if not category or t.category == category))
        stages = sorted(set(t.stage for t in filtered if not category or t.category == category))
        process_types = sorted(set(t.process_type for t in filtered))
        pellet_sizes = sorted(set(float(t.pellet_mm) for t in filtered if t.pellet_mm), reverse=True)
        float_types = sorted(set(t.float_type for t in filtered if t.float_type))
        
        return {
            'categories': categories,
            'species': species_list,
            'stages': stages,
            'process_types': process_types,
            'pellet_sizes_mm': pellet_sizes,
            'float_types': float_types
        }
    
    @staticmethod
    def list_preformulations(db: Session, tenant_id: Optional[int], category: Optional[str] = None,
                            species: Optional[str] = None, stage: Optional[str] = None,
                            process_type: Optional[str] = None, pellet_mm: Optional[float] = None,
                            float_type: Optional[str] = None, q: Optional[str] = None) -> List[PreFormulation]:
        """
        List pre-formulations with filters
        Returns tenant-specific first, then global (deduplicated by code)
        """
        tenant_templates, global_templates = PreFormulationService.resolve_library_scope(db, tenant_id)
        
        # Build result with tenant priority (deduplicate by code)
        seen_codes = set()
        result = []
        
        # Add tenant templates first
        for template in tenant_templates:
            if template.code not in seen_codes:
                if PreFormulationService._matches_filters(template, category, species, stage, 
                                                         process_type, pellet_mm, float_type, q):
                    result.append(template)
                    seen_codes.add(template.code)
        
        # Add global templates (skip if code already seen)
        for template in global_templates:
            if template.code not in seen_codes:
                if PreFormulationService._matches_filters(template, category, species, stage,
                                                         process_type, pellet_mm, float_type, q):
                    result.append(template)
                    seen_codes.add(template.code)
        
        return result
    
    @staticmethod
    def _matches_filters(template: PreFormulation, category: Optional[str] = None,
                        species: Optional[str] = None, stage: Optional[str] = None,
                        process_type: Optional[str] = None, pellet_mm: Optional[float] = None,
                        float_type: Optional[str] = None, q: Optional[str] = None) -> bool:
        """Check if template matches all filters"""
        if category and template.category != category:
            return False
        if species and template.species != species:
            return False
        if stage and template.stage != stage:
            return False
        if process_type and template.process_type != process_type:
            return False
        if pellet_mm is not None and (not template.pellet_mm or float(template.pellet_mm) != pellet_mm):
            return False
        if float_type and template.float_type != float_type:
            return False
        if q:
            q_lower = q.lower()
            if q_lower not in template.code.lower() and q_lower not in template.title.lower():
                return False
        return True
    
    @staticmethod
    def get_preformulation(db: Session, preform_id: int, tenant_id: Optional[int]) -> Optional[PreFormulation]:
        """
        Get pre-formulation by ID
        Checks tenant-specific first, then global
        """
        # Try tenant-specific first
        if tenant_id:
            template = db.query(PreFormulation).filter(
                PreFormulation.id == preform_id,
                PreFormulation.tenant_id == tenant_id
            ).first()
        else:
            template = None
        
        if not template:
            # Try global
            template = db.query(PreFormulation).filter(
                PreFormulation.id == preform_id,
                PreFormulation.tenant_id.is_(None)
            ).first()
        
        return template
    
    @staticmethod
    def calculate_requirements(db: Session, preform_id: int, tenant_id: Optional[int],
                               output_qty: Decimal, output_uom: str) -> Dict:
        """
        Calculate ingredient requirements for target output
        Returns: {
            'ingredients': List[Dict],
            'totals': Dict,
            'warnings': List[str]
        }
        """
        template = PreFormulationService.get_preformulation(db, preform_id, tenant_id)
        if not template:
            return {'error': 'Pre-formulation not found'}
        
        # Convert to kg
        if output_uom.lower() == 'ton':
            total_kg = output_qty * Decimal("1000")
        else:
            total_kg = output_qty
        
        # Get lines
        lines = db.query(PreFormulationLine).filter(
            PreFormulationLine.pre_formulation_id == preform_id
        ).order_by(PreFormulationLine.sort_order).all()
        
        ingredients = []
        total_percent = Decimal("0")
        total_kg_calc = Decimal("0")
        
        for line in lines:
            ingredient_item = db.query(Item).filter(Item.id == line.ingredient_item_id).first()
            if not ingredient_item:
                continue
            
            percent = line.inclusion_value
            required_kg = (percent / Decimal("100")) * total_kg
            required_g = required_kg * Decimal("1000")
            
            if not line.is_process_aid:
                total_percent += percent
                total_kg_calc += required_kg
            
            ingredients.append({
                'line_id': line.id,
                'ingredient_item_id': ingredient_item.id,
                'ingredient_name': ingredient_item.name,
                'percent': float(percent.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)),
                'required_kg': float(required_kg.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)),
                'required_g': float(required_g.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)),
                'is_process_aid': line.is_process_aid,
                'phase': line.phase
            })
        
        # Validate totals
        warnings = []
        deviation = abs(total_percent - Decimal("100"))
        if deviation > Decimal("0.01"):
            warnings.append(f"Total percentage is {float(total_percent):.4f}%, should be 100% (deviation: {float(deviation):.4f}%)")
        
        return {
            'ingredients': ingredients,
            'totals': {
                'total_percent': float(total_percent.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)),
                'total_kg': float(total_kg_calc.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)),
                'target_output_kg': float(total_kg.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP))
            },
            'warnings': warnings
        }
    
    @staticmethod
    def copy_to_bom(db: Session, preform_id: int, tenant_id: int, bom_data: Dict) -> Dict:
        """
        Copy pre-formulation to draft BOM
        bom_data: {
            'product_name': str OR 'product_item_id': int,
            'bom_code': str,
            'version': int (default 1),
            'default_batch_kg': Decimal (optional),
            'route_type': str (optional),
            'pellet_mm': Decimal (optional),
            'float_type': str (optional),
            'notes': str (optional)
        }
        """
        from app.modules.feed_manufacturing.models import FeedBom, FeedBomLine, BOMStatus, InclusionBasis
        from app.modules.catalog.models import Item, UOM
        
        template = PreFormulationService.get_preformulation(db, preform_id, tenant_id)
        if not template:
            return {'error': 'Pre-formulation not found'}
        
        # Validate template totals before copying
        lines = db.query(PreFormulationLine).filter(
            PreFormulationLine.pre_formulation_id == preform_id
        ).all()
        
        total_percent = sum(line.inclusion_value for line in lines if not line.is_process_aid)
        if abs(total_percent - Decimal("100")) > Decimal("0.01"):
            return {
                'error': f'Cannot copy: Total percentage is {float(total_percent):.4f}%, must be 100% ± 0.01%'
            }
        
        # Get or create product item
        if 'product_item_id' in bom_data and bom_data['product_item_id']:
            product_item = db.query(Item).filter(
                Item.id == bom_data['product_item_id'],
                Item.tenant_id == tenant_id
            ).first()
            if not product_item:
                return {'error': 'Product item not found'}
        else:
            # Create product item
            product_name = bom_data.get('product_name', f'{template.title} - Product')
            kg_uom = db.query(UOM).filter(UOM.tenant_id == tenant_id, UOM.code == "KG").first()
            if not kg_uom:
                return {'error': 'KG UOM not found'}
            
            product_item = Item(
                tenant_id=tenant_id,
                sku=f"PF-{bom_data['bom_code']}",
                name=product_name,
                type="finished_good",
                uom_id=kg_uom.id,
                is_stock_tracked=True,
                is_active=True
            )
            db.add(product_item)
            db.flush()
        
        # Get default batch size
        default_batch_kg = Decimal(str(bom_data.get('default_batch_kg', template.default_batch_kg)))
        
        # Try to find or create FeedProduct
        from app.modules.feed_manufacturing.models import FeedProduct
        feed_product = db.query(FeedProduct).filter(
            FeedProduct.item_id == product_item.id,
            FeedProduct.tenant_id == tenant_id
        ).first()
        
        if not feed_product:
            # Create FeedProduct
            feed_product = FeedProduct(
                tenant_id=tenant_id,
                item_id=product_item.id,
                category=template.category,
                subtype=template.float_type,
                stage=template.stage,
                pellet_size_mm=template.pellet_mm,
                pack_size_kg=Decimal("25.0"),  # Default
                route_type=template.process_type,
                target_protein_min_pct=template.protein_target_min,
                target_protein_max_pct=template.protein_target_max,
                target_fat_min_pct=template.fat_target_min,
                target_fat_max_pct=template.fat_target_max,
                target_fiber_max_pct=template.fiber_target_max,
                target_moisture_max_pct=template.moisture_target_max,
                target_energy_min_kcal=template.energy_target_min,
                requires_grinding=True,
                requires_mixing=True,
                created_by=None
            )
            db.add(feed_product)
            db.flush()
        
        # Create BOM
        bom = FeedBom(
            tenant_id=tenant_id,
            bom_code=bom_data['bom_code'],
            product_id=feed_product.id,
            version=str(bom_data.get('version', 1)),
            status=BOMStatus.DRAFT,
            default_batch_size_kg=default_batch_kg,
            route_type=bom_data.get('route_type', template.process_type),
            pellet_size_mm=Decimal(str(bom_data['pellet_mm'])) if bom_data.get('pellet_mm') else template.pellet_mm,
            float_type=bom_data.get('float_type', template.float_type),
            notes=bom_data.get('notes', f"Copied from pre-formulation: {template.code}"),
            effective_from=datetime.utcnow()
        )
        db.add(bom)
        db.flush()
        
        # Create BOM lines
        sequence = 0
        for line in lines:
            # Convert percent to grams_per_ton
            # 1% of 1 ton (1000 kg) = 10 kg = 10000 g
            grams_per_ton = line.inclusion_value * Decimal("10000")
            
            # Find ingredient by item_id
            from app.modules.feed_manufacturing.models import Ingredient
            ingredient = db.query(Ingredient).filter(
                Ingredient.item_id == line.ingredient_item_id,
                Ingredient.tenant_id == tenant_id
            ).first()
            
            if not ingredient:
                # Create ingredient if it doesn't exist
                ingredient = Ingredient(
                    tenant_id=tenant_id,
                    item_id=line.ingredient_item_id,
                    ingredient_type="macro",  # Default
                    created_by=None  # System created
                )
                db.add(ingredient)
                db.flush()
            
            bom_line = FeedBomLine(
                tenant_id=tenant_id,
                bom_id=bom.id,
                ingredient_id=ingredient.id,
                sequence=sequence,
                inclusion_basis=InclusionBasis.PERCENT,
                inclusion_value=line.inclusion_value,
                grams_per_ton=grams_per_ton.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP),
                kg_per_ton=(line.inclusion_value * Decimal("10")).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP),
                percent=line.inclusion_value,
                phase=line.phase,
                is_process_aid=line.is_process_aid,
                min_percent=line.min_percent,
                max_percent=line.max_percent
            )
            db.add(bom_line)
            sequence += 1
        
        db.flush()
        
        return {
            'bom_id': bom.id,
            'bom_code': bom.bom_code,
            'product_item_id': product_item.id,
            'message': 'BOM created successfully'
        }
    
    @staticmethod
    def get_recommendations(db: Session, tenant_id: Optional[int], species: str, stage: str,
                           process_type: str, pellet_mm: Optional[float] = None) -> List[Dict]:
        """
        Get top 3 closest matching templates
        Priority: exact match > nearest pellet size > same category/species
        """
        tenant_templates, global_templates = PreFormulationService.resolve_library_scope(db, tenant_id)
        all_templates = tenant_templates + global_templates
        
        # Score templates
        scored = []
        for template in all_templates:
            score = 0
            exact_match = True
            
            if template.species == species:
                score += 100
            else:
                exact_match = False
            
            if template.stage == stage:
                score += 50
            else:
                exact_match = False
            
            if template.process_type == process_type:
                score += 30
            else:
                exact_match = False
            
            if pellet_mm and template.pellet_mm:
                diff = abs(float(template.pellet_mm) - pellet_mm)
                if diff == 0:
                    score += 20
                else:
                    score += max(0, 20 - int(diff * 10))  # Closer = higher score
                    exact_match = False
            
            # Bonus for exact match
            if exact_match:
                score += 1000
            
            scored.append({
                'template': template,
                'score': score,
                'exact_match': exact_match
            })
        
        # Sort by score (descending)
        scored.sort(key=lambda x: x['score'], reverse=True)
        
        # Return top 3
        return [
            {
                'id': item['template'].id,
                'code': item['template'].code,
                'title': item['template'].title,
                'category': item['template'].category,
                'species': item['template'].species,
                'stage': item['template'].stage,
                'process_type': item['template'].process_type,
                'pellet_mm': float(item['template'].pellet_mm) if item['template'].pellet_mm else None,
                'float_type': item['template'].float_type,
                'score': item['score'],
                'exact_match': item['exact_match']
            }
            for item in scored[:3]
        ]

