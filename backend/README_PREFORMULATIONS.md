# Pre-Formulation Library Module

## Overview

The Pre-Formulation Library provides world standard pre-formulation templates for feed manufacturing. Users can browse templates, calculate ingredient requirements for target output, and copy templates to editable BOM drafts.

## Features

- **Global Templates**: World standard templates (tenant_id NULL) available to all tenants
- **Tenant Overrides**: Tenants can create their own templates that override global ones
- **Smart Filtering**: Filter by category, species, stage, process type, pellet size, float type
- **Calculate Requirements**: Enter target output (kg or ton) and get ingredient weights
- **Copy to BOM**: Convert templates to editable draft BOMs
- **Recommendations**: Get top 3 closest matching templates based on criteria

## Database Schema

### Tables

- `pre_formulations`: Template headers
  - `tenant_id` NULL for global templates
  - Unique constraint: (tenant_id, code)
  
- `pre_formulation_lines`: Template lines (percent-based)
  - Links to `items` table for ingredients
  - Supports process aids (excluded from 100% total)

## API Endpoints

### GET /preformulations/filters
Get distinct filter values for dropdowns.

Query params: `category`, `species`, `stage`, `process_type`

### GET /preformulations
List pre-formulations with filters.

Query params: `category`, `species`, `stage`, `process_type`, `pellet_mm`, `float_type`, `q` (search)

### GET /preformulations/{id}
Get pre-formulation details with lines.

### POST /preformulations/{id}/calculate
Calculate ingredient requirements.

Body:
```json
{
  "output_qty": 1.0,
  "output_uom": "ton"  // or "kg"
}
```

### POST /preformulations/{id}/copy-to-bom
Copy template to draft BOM.

Body:
```json
{
  "product_name": "Tilapia Fry Feed",
  "bom_code": "BOM-2024-001",
  "version": 1,
  "default_batch_kg": 1000.0,
  "route_type": "Extruded",
  "pellet_mm": 0.8,
  "float_type": "Floating"
}
```

### GET /preformulations/recommendations
Get top 3 closest matching templates.

Query params: `species`, `stage`, `process_type`, `pellet_mm` (optional)

## Seed Data

Run the seed SQL file to populate global templates:

```bash
sqlite3 backend/app.db < backend/scripts/seed_preformulations.sql
```

Or use Python:

```python
from app.db.session import SessionLocal
import sqlite3

db_path = "backend/app.db"
conn = sqlite3.connect(db_path)
with open("backend/scripts/seed_preformulations.sql", "r") as f:
    conn.executescript(f.read())
conn.close()
```

## Included Templates

1. **Fish → Tilapia Fry Floating** (0.8mm, 40-42% protein)
2. **Fish → Tilapia Grower Floating** (2.5mm, 30-32% protein)
3. **Fish → Tilapia Finisher Floating** (5mm, 26-28% protein)
4. **Fish → Carp/Pangas Sinking** (Pellet, 24-26% protein)
5. **Poultry → Broiler Starter** (Crumble, 20-22% protein)
6. **Poultry → Broiler Grower** (Pellet, 18-20% protein)
7. **Poultry → Layer Feed** (Mash, 16-18% protein)
8. **Cattle → Dairy Feed** (Pellet, 16-18% protein)
9. **Goat/Sheep → Goat/Sheep Feed** (Pellet, 14-16% protein)

## Frontend Pages

- `/preformulations`: List page with filters
- `/preformulations/[id]`: Detail page with calculate and copy-to-bom

## Validation Rules

- Sum of percent lines (excluding process aids) must be 100% ± 0.01%
- Cannot copy to BOM if validation fails
- All templates use PERCENT basis (converted to grams/ton when copying to BOM)

## Tenant Priority Logic

When listing templates:
1. Tenant-specific templates (tenant_id = current tenant) are shown first
2. Global templates (tenant_id IS NULL) are shown as fallback
3. If a tenant template exists with same code as global, tenant version takes priority

## Usage Example

1. Browse templates: `/preformulations?category=Fish&species=Tilapia`
2. View details: Click on a template row
3. Calculate: Enter target output (e.g., 2 tons) and click "Calculate"
4. Copy to BOM: Click "Copy to Draft BOM", enter product name and BOM code
5. Edit BOM: Redirected to BOM editor where you can modify the formulation

## Notes

- Templates are read-only (is_reference_only = true)
- Percent values are stored with 4 decimal precision
- Process aids (steam, water) are excluded from 100% total validation
- When copying to BOM, percent is converted to grams_per_ton: `grams_per_ton = percent * 10000`





