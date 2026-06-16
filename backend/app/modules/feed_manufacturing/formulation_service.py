"""
Formulation Service - Least-cost formulation solver
Uses linear programming or heuristic fallback
"""
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Dict, Optional, Tuple
from sqlalchemy.orm import Session
from app.modules.feed_manufacturing.models import Ingredient, FeedProduct
from app.modules.catalog.models import Item
from app.modules.inventory.models import StockBalance

try:
    from scipy.optimize import linprog
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False

try:
    import pulp
    PULP_AVAILABLE = True
except ImportError:
    PULP_AVAILABLE = False

class FormulationService:
    """Least-cost formulation solver"""
    
    @staticmethod
    def solve_least_cost(
        db: Session,
        tenant_id: int,
        allowed_ingredient_ids: List[int],
        constraints: Dict[int, Dict],  # {ingredient_id: {'min_pct': Decimal, 'max_pct': Decimal}}
        nutrition_targets: Dict,  # {'protein_min': Decimal, 'fiber_max': Decimal, etc.}
        price_overrides: Dict[int, Decimal] = None,  # {ingredient_id: price_per_kg}
        group_constraints: List[Dict] = None  # [{'ingredient_ids': [1,2,3], 'max_total_pct': Decimal}]
    ) -> Dict:
        """
        Solve least-cost formulation
        Returns: {
            'success': bool,
            'solution': Dict[int, Decimal],  # {ingredient_id: percent}
            'cost_per_ton': Decimal,
            'nutrition': Dict,
            'errors': List[str],
            'warnings': List[str]
        }
        """
        if price_overrides is None:
            price_overrides = {}
        
        if group_constraints is None:
            group_constraints = []
        
        # Get ingredients
        ingredients = db.query(Ingredient).filter(
            Ingredient.id.in_(allowed_ingredient_ids),
            Ingredient.tenant_id == tenant_id
        ).all()
        
        if len(ingredients) < 2:
            return {
                'success': False,
                'errors': ['Need at least 2 ingredients'],
                'solution': {}
            }
        
        # Build cost vector
        costs = []
        ingredient_map = {}  # index -> ingredient_id
        
        for idx, ingredient in enumerate(ingredients):
            ingredient_map[idx] = ingredient.id
            
            # Get price
            if ingredient.id in price_overrides:
                price = price_overrides[ingredient.id]
            else:
                item = db.query(Item).filter(Item.id == ingredient.item_id).first()
                if item:
                    stock = db.query(StockBalance).filter(
                        StockBalance.item_id == item.id,
                        StockBalance.tenant_id == tenant_id
                    ).first()
                    if stock and stock.qty_kg > 0:
                        price = stock.unit_cost
                    else:
                        price = item.standard_cost or Decimal("100")  # Default
                else:
                    price = Decimal("100")
            
            costs.append(float(price))
        
        n = len(ingredients)
        
        # Try scipy first
        if SCIPY_AVAILABLE:
            try:
                return FormulationService._solve_scipy(
                    ingredients, costs, ingredient_map, constraints, nutrition_targets, group_constraints
                )
            except Exception as e:
                pass  # Fall back to heuristic
        
        # Try PuLP
        if PULP_AVAILABLE:
            try:
                return FormulationService._solve_pulp(
                    ingredients, costs, ingredient_map, constraints, nutrition_targets, group_constraints
                )
            except Exception as e:
                pass  # Fall back to heuristic
        
        # Fallback: Greedy heuristic
        return FormulationService._solve_heuristic(
            ingredients, costs, ingredient_map, constraints, nutrition_targets, group_constraints
        )
    
    @staticmethod
    def _solve_scipy(ingredients, costs, ingredient_map, constraints, nutrition_targets, group_constraints):
        """Solve using scipy.optimize.linprog"""
        n = len(ingredients)
        
        # Objective: minimize cost
        c = costs
        
        # Constraints: sum of percentages = 100%
        A_eq = [[1.0] * n]
        b_eq = [100.0]
        
        # Bounds: 0 <= x <= 100 for each ingredient
        bounds = []
        A_ub = []
        b_ub = []
        
        for idx, ingredient in enumerate(ingredients):
            ing_id = ingredient_map[idx]
            min_pct = constraints.get(ing_id, {}).get('min_pct', Decimal("0"))
            max_pct = constraints.get(ing_id, {}).get('max_pct', Decimal("100"))
            
            # Also check ingredient-level constraints
            if ingredient.min_inclusion_pct:
                min_pct = max(min_pct, ingredient.min_inclusion_pct)
            if ingredient.max_inclusion_pct:
                max_pct = min(max_pct, ingredient.max_inclusion_pct)
            
            bounds.append((float(min_pct), float(max_pct)))
        
        # Nutrition constraints
        if nutrition_targets.get('protein_min'):
            # Sum(protein_pct[i] * x[i]) >= protein_min
            protein_row = []
            for ingredient in ingredients:
                protein_pct = float(ingredient.protein_pct or 0)
                protein_row.append(protein_pct)
            A_ub.append([-p for p in protein_row])  # Negative for >= constraint
            b_ub.append(-float(nutrition_targets['protein_min']))
        
        if nutrition_targets.get('fiber_max'):
            fiber_row = []
            for ingredient in ingredients:
                fiber_pct = float(ingredient.fiber_pct or 0)
                fiber_row.append(fiber_pct)
            A_ub.append(fiber_row)
            b_ub.append(float(nutrition_targets['fiber_max']))
        
        # Solve
        result = linprog(c, A_ub=A_ub if A_ub else None, b_ub=b_ub if b_ub else None,
                        A_eq=A_eq, b_eq=b_eq, bounds=bounds, method='highs')
        
        if result.success:
            solution = {}
            for idx, ingredient in enumerate(ingredients):
                ing_id = ingredient_map[idx]
                solution[ing_id] = Decimal(str(result.x[idx])).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
            
            # Calculate cost and nutrition
            cost_per_ton = sum(costs[i] * result.x[i] * 10 for i in range(n))  # kg/ton * price/kg
            nutrition = FormulationService._calculate_nutrition(ingredients, result.x)
            
            return {
                'success': True,
                'solution': solution,
                'cost_per_ton': Decimal(str(cost_per_ton)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP),
                'nutrition': nutrition,
                'errors': [],
                'warnings': []
            }
        else:
            return {
                'success': False,
                'errors': [f'Solver failed: {result.message}'],
                'solution': {}
            }
    
    @staticmethod
    def _solve_pulp(ingredients, costs, ingredient_map, constraints, nutrition_targets, group_constraints):
        """Solve using PuLP"""
        prob = pulp.LpProblem("LeastCostFormulation", pulp.LpMinimize)
        
        # Variables
        x = {}
        for idx, ingredient in enumerate(ingredients):
            ing_id = ingredient_map[idx]
            min_pct = float(constraints.get(ing_id, {}).get('min_pct', Decimal("0")))
            max_pct = float(constraints.get(ing_id, {}).get('max_pct', Decimal("100")))
            x[idx] = pulp.LpVariable(f"x_{idx}", lowBound=min_pct, upBound=max_pct)
        
        # Objective
        prob += pulp.lpSum([costs[idx] * x[idx] * 10 for idx in range(len(ingredients))])
        
        # Constraint: sum = 100%
        prob += pulp.lpSum([x[idx] for idx in range(len(ingredients))]) == 100.0
        
        # Nutrition constraints
        if nutrition_targets.get('protein_min'):
            prob += pulp.lpSum([
                float(ingredients[idx].protein_pct or 0) * x[idx] 
                for idx in range(len(ingredients))
            ]) >= float(nutrition_targets['protein_min'])
        
        if nutrition_targets.get('fiber_max'):
            prob += pulp.lpSum([
                float(ingredients[idx].fiber_pct or 0) * x[idx] 
                for idx in range(len(ingredients))
            ]) <= float(nutrition_targets['fiber_max'])
        
        # Solve
        prob.solve(pulp.PULP_CBC_CMD(msg=0))
        
        if prob.status == pulp.LpStatusOptimal:
            solution = {}
            for idx, ingredient in enumerate(ingredients):
                ing_id = ingredient_map[idx]
                solution[ing_id] = Decimal(str(x[idx].varValue)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
            
            cost_per_ton = pulp.value(prob.objective)
            nutrition = FormulationService._calculate_nutrition(
                ingredients, [x[idx].varValue for idx in range(len(ingredients))]
            )
            
            return {
                'success': True,
                'solution': solution,
                'cost_per_ton': Decimal(str(cost_per_ton)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP),
                'nutrition': nutrition,
                'errors': [],
                'warnings': []
            }
        else:
            return {
                'success': False,
                'errors': ['Solver could not find optimal solution'],
                'solution': {}
            }
    
    @staticmethod
    def _solve_heuristic(ingredients, costs, ingredient_map, constraints, nutrition_targets, group_constraints):
        """
        Greedy heuristic fallback
        Tries to minimize cost while meeting constraints
        """
        n = len(ingredients)
        solution = {}
        remaining = Decimal("100")
        
        # Sort by cost (ascending)
        sorted_indices = sorted(range(n), key=lambda i: costs[i])
        
        # Allocate minimums first
        for idx in sorted_indices:
            ingredient = ingredients[idx]
            ing_id = ingredient_map[idx]
            min_pct = constraints.get(ing_id, {}).get('min_pct', Decimal("0"))
            if ingredient.min_inclusion_pct:
                min_pct = max(min_pct, ingredient.min_inclusion_pct)
            
            if min_pct > 0 and remaining >= min_pct:
                solution[ing_id] = min_pct
                remaining -= min_pct
            else:
                solution[ing_id] = Decimal("0")
        
        # Fill remaining with cheapest ingredients
        for idx in sorted_indices:
            if remaining <= 0:
                break
            
            ingredient = ingredients[idx]
            ing_id = ingredient_map[idx]
            max_pct = constraints.get(ing_id, {}).get('max_pct', Decimal("100"))
            if ingredient.max_inclusion_pct:
                max_pct = min(max_pct, ingredient.max_inclusion_pct)
            
            current = solution.get(ing_id, Decimal("0"))
            available = max_pct - current
            
            if available > 0:
                add = min(remaining, available)
                solution[ing_id] = current + add
                remaining -= add
        
        # Normalize to 100%
        if remaining > 0:
            # Distribute remaining proportionally
            total = sum(solution.values())
            if total > 0:
                for ing_id in solution:
                    solution[ing_id] = (solution[ing_id] / total * Decimal("100")).quantize(
                        Decimal("0.0001"), rounding=ROUND_HALF_UP
                    )
        
        # Calculate cost and nutrition
        cost_per_ton = Decimal("0")
        nutrition_values = [0.0] * n
        
        for idx, ingredient in enumerate(ingredients):
            ing_id = ingredient_map[idx]
            pct = float(solution.get(ing_id, Decimal("0")))
            cost_per_ton += Decimal(str(costs[idx])) * Decimal(str(pct)) * Decimal("10")
            nutrition_values[idx] = pct
        
        nutrition = FormulationService._calculate_nutrition(ingredients, nutrition_values)
        
        # Check constraints
        errors = []
        warnings = []
        
        # Check nutrition targets
        if nutrition_targets.get('protein_min') and nutrition['protein_pct'] < nutrition_targets['protein_min']:
            errors.append(f"Protein {nutrition['protein_pct']:.2f}% is below target {nutrition_targets['protein_min']}%")
        
        if nutrition_targets.get('fiber_max') and nutrition['fiber_pct'] > nutrition_targets['fiber_max']:
            errors.append(f"Fiber {nutrition['fiber_pct']:.2f}% exceeds target {nutrition_targets['fiber_max']}%")
        
        return {
            'success': len(errors) == 0,
            'solution': solution,
            'cost_per_ton': cost_per_ton.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP),
            'nutrition': nutrition,
            'errors': errors,
            'warnings': warnings
        }
    
    @staticmethod
    def _calculate_nutrition(ingredients, percentages) -> Dict:
        """Calculate nutrition from solution percentages"""
        total_protein = Decimal("0")
        total_fat = Decimal("0")
        total_fiber = Decimal("0")
        total_moisture = Decimal("0")
        total_ash = Decimal("0")
        total_energy = Decimal("0")
        
        for idx, ingredient in enumerate(ingredients):
            pct = Decimal(str(percentages[idx]))
            if ingredient.protein_pct:
                total_protein += (ingredient.protein_pct / Decimal("100")) * pct
            if ingredient.fat_pct:
                total_fat += (ingredient.fat_pct / Decimal("100")) * pct
            if ingredient.fiber_pct:
                total_fiber += (ingredient.fiber_pct / Decimal("100")) * pct
            if ingredient.moisture_pct:
                total_moisture += (ingredient.moisture_pct / Decimal("100")) * pct
            if ingredient.ash_pct:
                total_ash += (ingredient.ash_pct / Decimal("100")) * pct
            if ingredient.energy_kcal:
                total_energy += ingredient.energy_kcal * (pct / Decimal("100"))
        
        return {
            'protein_pct': total_protein.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP),
            'fat_pct': total_fat.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP),
            'fiber_pct': total_fiber.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP),
            'moisture_pct': total_moisture.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP),
            'ash_pct': total_ash.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP),
            'energy_kcal': total_energy.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        }





